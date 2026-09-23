-- rls_test.sql — multi-tenant isolation tests
--
-- WHICH FRAMEWORK, AND WHY
--   Plain SQL with `do $$ begin assert …; end $$;` blocks, not pgTAP.
--   pgTAP was the brief's first choice and it is the better tool when it is
--   there, but it needs `create extension pgtap` plus a TAP harness, and this
--   schema had to be validated on a machine with no Docker and therefore no
--   `supabase start`. A file that runs under bare `psql` runs everywhere:
--   `supabase test db`, a CI Postgres service container, or a developer's
--   local cluster. Nothing here depends on an extension.
--
--   Assertions are plpgsql ASSERT, which raises P0004 and aborts the script
--   under `-v ON_ERROR_STOP=1`. Each passing block prints `ok - …`, so the
--   output reads like a test log even though it is not TAP.
--
--   NOTE: ASSERT is compiled away when `plpgsql.check_asserts` is off. The
--   first block below fails loudly if it has been disabled, because a test
--   suite that silently stops asserting is worse than no test suite.
--
-- WHAT IT PROVES
--   User A writes a row into every user-scoped table. User B then:
--     * sees zero rows in every one of them,
--     * cannot UPDATE any of A's rows,
--     * cannot DELETE any of A's rows,
--     * cannot attach a child row to any of A's parents (the write-side leak
--       that RLS alone does not close — see 0004_tenant_integrity.sql),
--     * cannot read step_cache at all.
--   Plus positive controls: A can see A's rows, and B can see B's own. A test
--   that passes because nothing was inserted is not a test.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
--   The whole file runs in one transaction and ends with ROLLBACK, so it
--   leaves no rows behind and can be run repeatedly against a seeded database.

\set ON_ERROR_STOP on
\timing off

begin;

do $$
begin
    if not current_setting('plpgsql.check_asserts', true) is distinct from 'off' then
        raise exception 'plpgsql.check_asserts is off; every ASSERT in this file '
                        'would be skipped and the suite would pass vacuously';
    end if;
    raise notice 'ok - assertions are enabled';
end $$;

-- --------------------------------------------------------------------------
-- Fixtures: two users
-- --------------------------------------------------------------------------
-- Created as the superuser/owner, which is how GoTrue would have created
-- them. Everything after this point runs as `authenticated`.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000000',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'authenticated', 'authenticated', 'rls-a@example.test', now(), now()),
    ('00000000-0000-0000-0000-000000000000',
     'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
     'authenticated', 'authenticated', 'rls-b@example.test', now(), now())
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- Structural checks (before touching a single row)
-- --------------------------------------------------------------------------
-- These catch the failure mode that matters most: a new table added in a
-- later migration and quietly left without RLS. A row-level test can only
-- check the tables it knows about; this one checks the tables that exist.
do $$
declare
    missing text[];
begin
    select coalesce(array_agg(c.relname order by c.relname), '{}')
      into missing
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity;

    assert missing = '{}',
        format('tables in public with RLS disabled: %s', missing);
    raise notice 'ok - every table in public has RLS enabled';
end $$;

do $$
declare
    offenders text[];
begin
    -- polcmd '*' is FOR ALL. Banned: see the rationale at the top of 0002.
    select coalesce(array_agg(format('%s.%s', c.relname, p.polname)), '{}')
      into offenders
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and p.polcmd = '*';

    assert offenders = '{}',
        format('policies written FOR ALL instead of one per operation: %s', offenders);
    raise notice 'ok - no FOR ALL policies';
end $$;

do $$
declare
    offenders text[];
    stripped  text;
    rec       record;
begin
    offenders := '{}';
    for rec in
        select c.relname, p.polname,
               coalesce(pg_get_expr(p.polqual, p.polrelid), '') as qual,
               coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as wc
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('public', 'storage')
    loop
        -- Remove every correctly-wrapped occurrence, then look for leftovers.
        stripped := regexp_replace(rec.qual || ' ' || rec.wc,
                                   '\( SELECT auth\.uid\(\)[^)]*\)', '', 'g');
        if stripped like '%auth.uid%' then
            offenders := offenders || format('%s.%s', rec.relname, rec.polname);
        end if;
    end loop;

    assert offenders = '{}',
        format('policies calling auth.uid() un-wrapped (per-row evaluation): %s',
               offenders);
    raise notice 'ok - every policy uses the (select auth.uid()) InitPlan form';
end $$;

-- --------------------------------------------------------------------------
-- User A writes one row into every user-scoped table
-- --------------------------------------------------------------------------
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true); end $$;

insert into documents (id, user_id, storage_path, kind, sha256, raw_text)
values ('a0000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a-doc.pdf',
        'pdf', 'a-sha', 'A private resume text');

insert into facts (id, user_id, document_id, fact_key, text, origin)
values ('a0000000-0000-4000-8000-000000000002',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'a0000000-0000-4000-8000-000000000001',
        'E1.B1', 'A did a private thing', 'document');

insert into jobs (id, user_id, jd_text, company, title, sha256)
values ('a0000000-0000-4000-8000-000000000003',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'A private JD', 'Acme', 'Engineer', 'a-jd-sha');

insert into resumes (id, user_id, title, job_id)
values ('a0000000-0000-4000-8000-000000000004',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'A private resume', 'a0000000-0000-4000-8000-000000000003');

insert into resume_versions (id, user_id, resume_id, doc_json, created_by)
values ('a0000000-0000-4000-8000-000000000005',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'a0000000-0000-4000-8000-000000000004',
        '{"headline":"A"}'::jsonb, 'ai_tailor');

insert into patches (id, user_id, resume_id, base_version_id, ops_json, status)
values ('a0000000-0000-4000-8000-000000000006',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'a0000000-0000-4000-8000-000000000004',
        'a0000000-0000-4000-8000-000000000005',
        '[{"op":"replace","path":"/headline","value":"A2"}]'::jsonb, 'proposed');

insert into resume_jobs (id, user_id, resume_id, job_id, report_json)
values ('a0000000-0000-4000-8000-000000000007',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'a0000000-0000-4000-8000-000000000004',
        'a0000000-0000-4000-8000-000000000003',
        '{"overall":50}'::jsonb);

insert into chat_sessions (id, user_id, resume_id, kind)
values ('a0000000-0000-4000-8000-000000000008',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'a0000000-0000-4000-8000-000000000004', 'edit');

insert into chat_messages (id, user_id, session_id, role, content)
values ('a0000000-0000-4000-8000-000000000009',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'a0000000-0000-4000-8000-000000000008',
        'user', 'A said something private');

insert into storage.objects (id, bucket_id, name, owner)
values ('a0000000-0000-4000-8000-00000000000a', 'resumes',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a-doc.pdf',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

reset role;

-- step_traces is written by the backend, not the browser (0002 gives
-- `authenticated` no insert policy), so this row is inserted out-of-band —
-- which is itself the behaviour under test further down.
insert into step_traces (id, user_id, resume_id, step, model, ok)
values ('a0000000-0000-4000-8000-00000000000b',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'a0000000-0000-4000-8000-000000000004', 'tailor', 'test-model', true);

-- --------------------------------------------------------------------------
-- Positive control: A can see A's rows
-- --------------------------------------------------------------------------
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true); end $$;

do $$
declare
    t text;
    n bigint;
begin
    foreach t in array array[
        'documents', 'facts', 'jobs', 'resumes', 'resume_versions',
        'patches', 'resume_jobs', 'chat_sessions', 'chat_messages', 'step_traces'
    ]
    loop
        execute format('select count(*) from public.%I where user_id = $1', t)
           into n using 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
        assert n = 1, format('A should see exactly 1 own row in %s, saw %s', t, n);
    end loop;
    raise notice 'ok - A sees A''s own row in all 10 user-scoped tables';
end $$;

reset role;

-- --------------------------------------------------------------------------
-- THE TEST: user B sees nothing of A's
-- --------------------------------------------------------------------------
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true); end $$;

do $$
declare
    t text;
    n bigint;
begin
    foreach t in array array[
        'documents', 'facts', 'jobs', 'resumes', 'resume_versions',
        'patches', 'resume_jobs', 'chat_sessions', 'chat_messages', 'step_traces'
    ]
    loop
        -- No WHERE clause: an unfiltered read is exactly what a leak looks
        -- like, and it also catches a policy that only works when the client
        -- happens to filter by user_id itself.
        execute format('select count(*) from public.%I', t) into n;
        assert n = 0, format('TENANT LEAK: B sees %s row(s) in %s', n, t);
    end loop;
    raise notice 'ok - B sees zero rows in all 10 user-scoped tables';
end $$;

do $$
declare
    n bigint;
begin
    select count(*) into n from storage.objects;
    assert n = 0, format('TENANT LEAK: B sees %s object(s) in storage', n);
    raise notice 'ok - B sees zero storage objects';
end $$;

-- --------------------------------------------------------------------------
-- B cannot UPDATE A's rows
-- --------------------------------------------------------------------------
-- RLS filters an UPDATE rather than rejecting it, so the observable result is
-- zero rows affected. Asserting on the row count is the only way to tell
-- "blocked" from "succeeded".
do $$
declare
    affected int;
begin
    update documents set raw_text = 'pwned'
     where id = 'a0000000-0000-4000-8000-000000000001';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B updated A''s document';

    update jobs set title = 'pwned'
     where id = 'a0000000-0000-4000-8000-000000000003';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B updated A''s job';

    update resumes set title = 'pwned'
     where id = 'a0000000-0000-4000-8000-000000000004';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B updated A''s resume';

    update patches set status = 'accepted', decided_at = now()
     where id = 'a0000000-0000-4000-8000-000000000006';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B accepted A''s patch';

    update resume_jobs set report_json = '{"overall":0}'::jsonb
     where id = 'a0000000-0000-4000-8000-000000000007';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B updated A''s analysis';

    update chat_sessions set kind = 'interview'
     where id = 'a0000000-0000-4000-8000-000000000008';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B updated A''s chat session';

    update chat_messages set content = 'pwned'
     where id = 'a0000000-0000-4000-8000-000000000009';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B updated A''s chat message';

    update facts set valid_to = now()
     where id = 'a0000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B retired A''s fact';

    update storage.objects set name = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/stolen.pdf'
     where id = 'a0000000-0000-4000-8000-00000000000a';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B moved A''s storage object';

    raise notice 'ok - B cannot update any of A''s rows (9 tables)';
end $$;

-- --------------------------------------------------------------------------
-- B cannot DELETE A's rows
-- --------------------------------------------------------------------------
do $$
declare
    affected int;
begin
    delete from chat_messages where id = 'a0000000-0000-4000-8000-000000000009';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B deleted A''s chat message';

    delete from chat_sessions where id = 'a0000000-0000-4000-8000-000000000008';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B deleted A''s chat session';

    delete from resume_jobs where id = 'a0000000-0000-4000-8000-000000000007';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B deleted A''s analysis';

    delete from patches where id = 'a0000000-0000-4000-8000-000000000006';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B deleted A''s patch';

    delete from resume_versions where id = 'a0000000-0000-4000-8000-000000000005';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B deleted A''s version';

    delete from resumes where id = 'a0000000-0000-4000-8000-000000000004';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B deleted A''s resume';

    delete from jobs where id = 'a0000000-0000-4000-8000-000000000003';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B deleted A''s job';

    delete from documents where id = 'a0000000-0000-4000-8000-000000000001';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B deleted A''s document';

    -- facts has no DELETE policy at all, for anybody. Default-deny means the
    -- statement matches nothing rather than raising.
    delete from facts where id = 'a0000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B deleted A''s fact';

    delete from storage.objects where id = 'a0000000-0000-4000-8000-00000000000a';
    get diagnostics affected = row_count;
    assert affected = 0, 'TENANT LEAK: B deleted A''s storage object';

    raise notice 'ok - B cannot delete any of A''s rows (10 tables)';
end $$;

-- --------------------------------------------------------------------------
-- B cannot attach child rows to A's parents  (the write-side leak)
-- --------------------------------------------------------------------------
-- RLS is satisfied by all of these — B is writing rows with B's own user_id.
-- What stops them is the composite FKs from 0004. Without those, B could
-- append a version to A's resume, and the current-version trigger would then
-- make A's resume render B's content.
do $$
declare
    blocked int := 0;
begin
    begin
        insert into resume_versions (user_id, resume_id, doc_json, created_by)
        values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                'a0000000-0000-4000-8000-000000000004',
                '{"headline":"pwned"}'::jsonb, 'user');
        raise exception 'TENANT LEAK: B appended a version to A''s resume';
    exception when foreign_key_violation then
        blocked := blocked + 1;
    end;

    begin
        insert into chat_messages (user_id, session_id, role, content)
        values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                'a0000000-0000-4000-8000-000000000008', 'user', 'pwned');
        raise exception 'TENANT LEAK: B posted into A''s chat session';
    exception when foreign_key_violation then
        blocked := blocked + 1;
    end;

    begin
        insert into facts (user_id, document_id, fact_key, text, origin)
        values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                'a0000000-0000-4000-8000-000000000001', 'X1', 'pwned', 'document');
        raise exception 'TENANT LEAK: B attached a fact to A''s document';
    exception when foreign_key_violation then
        blocked := blocked + 1;
    end;

    begin
        insert into patches (user_id, resume_id, base_version_id, ops_json)
        values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                'a0000000-0000-4000-8000-000000000004',
                'a0000000-0000-4000-8000-000000000005', '[]'::jsonb);
        raise exception 'TENANT LEAK: B proposed a patch against A''s resume';
    exception when foreign_key_violation then
        blocked := blocked + 1;
    end;

    assert blocked = 4, format('expected 4 blocked cross-tenant writes, got %s', blocked);
    raise notice 'ok - B cannot attach child rows to A''s parents (4 paths)';
end $$;

-- --------------------------------------------------------------------------
-- B cannot claim A's rows by rewriting user_id
-- --------------------------------------------------------------------------
-- The `with check` half of the UPDATE policies. B first inserts a row of their
-- own, then tries to hand it to A (a poisoning attack) — and tries to pull
-- A's row across by id, which the `using` half already blocked above.
insert into jobs (id, user_id, jd_text, company, title)
values ('b0000000-0000-4000-8000-000000000001',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'B private JD', 'Bcorp', 'Engineer');

do $$
begin
    begin
        update jobs
           set user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
         where id = 'b0000000-0000-4000-8000-000000000001';
        raise exception 'TENANT LEAK: B handed a row to A by rewriting user_id';
    exception when insufficient_privilege then
        raise notice 'ok - B cannot reassign a row to another user (with check held)';
    end;
end $$;

-- --------------------------------------------------------------------------
-- B sees B's own row, and only that one
-- --------------------------------------------------------------------------
do $$
declare
    n bigint;
begin
    select count(*) into n from jobs;
    assert n = 1, format('B should see exactly their own 1 job, saw %s', n);
    raise notice 'ok - B sees B''s own row and nothing else';
end $$;

-- --------------------------------------------------------------------------
-- step_cache is unreachable from a user session
-- --------------------------------------------------------------------------
-- Two independent defences, tested separately: no GRANT, and RLS with no
-- policy. The GRANT is the one that fires first, so this raises
-- insufficient_privilege rather than returning zero rows.
do $$
declare
    n bigint;
begin
    begin
        execute 'select count(*) from public.step_cache' into n;
        assert false,
            format('step_cache is readable by an authenticated user (%s rows)', n);
    exception when insufficient_privilege then
        raise notice 'ok - step_cache is not readable by authenticated';
    end;

    begin
        execute $q$insert into public.step_cache (cache_key, step, output_json)
                   values ('probe', 'probe', '{}'::jsonb)$q$;
        assert false, 'step_cache is writable by an authenticated user';
    exception when insufficient_privilege then
        raise notice 'ok - step_cache is not writable by authenticated';
    end;

    begin
        execute 'select count(*) from public.storage_gc_queue' into n;
        assert false, 'storage_gc_queue is readable by an authenticated user';
    exception when insufficient_privilege then
        raise notice 'ok - storage_gc_queue is not readable by authenticated';
    end;
end $$;

-- --------------------------------------------------------------------------
-- step_traces is read-only to users
-- --------------------------------------------------------------------------
-- Cost and latency records drive billing and alerting. A client that can
-- insert them can lie about both.
do $$
begin
    begin
        insert into step_traces (user_id, step, model, cost_usd)
        values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'forged', 'free', 0);
        raise exception 'step_traces is writable by an authenticated user';
    exception when insufficient_privilege then
        raise notice 'ok - step_traces cannot be forged by a client';
    end;
end $$;

-- --------------------------------------------------------------------------
-- B cannot write into A's storage folder
-- --------------------------------------------------------------------------
do $$
begin
    begin
        insert into storage.objects (bucket_id, name, owner)
        values ('resumes',
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/stolen.pdf',
                'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
        raise exception 'TENANT LEAK: B wrote an object into A''s storage folder';
    exception when insufficient_privilege then
        raise notice 'ok - B cannot upload into A''s storage prefix';
    end;
end $$;

-- B's own prefix must still work, or the policy is simply broken.
insert into storage.objects (bucket_id, name, owner)
values ('resumes',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/mine.pdf',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

do $$
declare
    n bigint;
begin
    select count(*) into n from storage.objects;
    assert n = 1, format('B should see only their own object, saw %s', n);
    raise notice 'ok - B can write and read their own storage prefix';
end $$;

-- --------------------------------------------------------------------------
-- The anon role sees nothing anywhere
-- --------------------------------------------------------------------------
reset role;
set local role anon;
do $$ begin perform set_config('request.jwt.claim.sub', '', true); end $$;

do $$
declare
    t text;
    reachable text[] := '{}';
    n bigint;
begin
    foreach t in array array[
        'documents', 'facts', 'jobs', 'resumes', 'resume_versions',
        'patches', 'resume_jobs', 'chat_sessions', 'chat_messages',
        'step_traces', 'step_cache', 'storage_gc_queue'
    ]
    loop
        begin
            execute format('select count(*) from public.%I', t) into n;
            if n > 0 then
                reachable := reachable || t;
            end if;
        exception when insufficient_privilege then
            null;  -- no grant: also fine
        end;
    end loop;

    assert reachable = '{}',
        format('anon can read rows from: %s', reachable);
    raise notice 'ok - anon reads zero rows from every table';
end $$;

reset role;

do $$
begin
    raise notice '----------------------------------------------------------';
    raise notice 'PASS - multi-tenant isolation holds';
    raise notice '----------------------------------------------------------';
end $$;

-- Nothing is kept. The fixtures above exist only for the duration of this
-- script, so it can be run against a seeded database without polluting it.
rollback;

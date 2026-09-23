-- invariants_test.sql — the non-RLS guarantees
--
-- rls_test.sql proves tenants cannot see each other. This file proves the
-- other decisions in the schema actually hold, the ones that would otherwise
-- only be true because the application happened to behave. Same style, same
-- reasons: plain `assert` blocks, one transaction, rolled back at the end.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/invariants_test.sql
--
-- Runs as the owner/service role deliberately: these are invariants that must
-- hold even for the backend, not just for a browser session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'authenticated', 'authenticated', 'inv@example.test', now(), now())
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- resumes.current_version_id cannot dangle
-- --------------------------------------------------------------------------
do $$
declare
    u        uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    r        uuid;
    v1       uuid;
    v2       uuid;
    pointer  uuid;
begin
    insert into resumes (user_id, title) values (u, 'inv') returning id into r;

    select current_version_id into pointer from resumes where id = r;
    assert pointer is null, 'a resume with no versions should point at null';

    insert into resume_versions (user_id, resume_id, doc_json, created_by)
    values (u, r, '{"n":1}'::jsonb, 'user') returning id into v1;
    select current_version_id into pointer from resumes where id = r;
    assert pointer = v1, 'first version should become current';

    insert into resume_versions (user_id, resume_id, parent_id, doc_json, created_by)
    values (u, r, v1, '{"n":2}'::jsonb, 'user') returning id into v2;
    select current_version_id into pointer from resumes where id = r;
    assert pointer = v2, 'newest version should become current';

    -- Deleting the head must fall back, not null out.
    delete from resume_versions where id = v2;
    select current_version_id into pointer from resumes where id = r;
    assert pointer = v1,
        format('deleting the current version should re-point at v1, got %s', pointer);

    delete from resume_versions where id = v1;
    select current_version_id into pointer from resumes where id = r;
    assert pointer is null, 'deleting the last version should leave null, not a dangling id';

    raise notice 'ok - current_version_id tracks the newest version and never dangles';
end $$;

-- A resume cannot point at another resume's version (composite FK).
do $$
declare
    u  uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    r1 uuid;
    r2 uuid;
    v  uuid;
begin
    insert into resumes (user_id, title) values (u, 'r1') returning id into r1;
    insert into resumes (user_id, title) values (u, 'r2') returning id into r2;
    insert into resume_versions (user_id, resume_id, doc_json, created_by)
    values (u, r1, '{}'::jsonb, 'user') returning id into v;

    begin
        update resumes set current_version_id = v where id = r2;
        -- The constraint is DEFERRABLE INITIALLY DEFERRED, so it fires at
        -- commit; force it here.
        set constraints resumes_current_version_fkey immediate;
        raise exception 'a resume pointed at another resume''s version';
    exception when foreign_key_violation then
        raise notice 'ok - current_version_id must belong to the same resume';
    end;
end $$;

-- Deleting a resume with versions must not error (the trigger's no-op path).
do $$
declare
    u uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    r uuid;
begin
    insert into resumes (user_id, title) values (u, 'to delete') returning id into r;
    insert into resume_versions (user_id, resume_id, doc_json, created_by)
    values (u, r, '{}'::jsonb, 'user');
    insert into resume_versions (user_id, resume_id, doc_json, created_by)
    values (u, r, '{}'::jsonb, 'user');

    delete from resumes where id = r;
    assert not exists (select 1 from resume_versions where resume_id = r),
        'versions should cascade away with the resume';
    raise notice 'ok - deleting a resume with versions cascades cleanly';
end $$;

-- --------------------------------------------------------------------------
-- facts is append-only
-- --------------------------------------------------------------------------
do $$
declare
    u  uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    d  uuid;
    f1 uuid;
    f2 uuid;
    vt timestamptz;
begin
    insert into documents (user_id, kind, raw_text) values (u, 'text', 'x')
    returning id into d;

    insert into facts (user_id, document_id, fact_key, text, origin)
    values (u, d, 'E1.B1', 'original claim', 'document') returning id into f1;

    begin
        update facts set text = 'rewritten' where id = f1;
        raise exception 'a fact''s text was rewritten';
    exception when restrict_violation then
        null;
    end;

    begin
        delete from facts where id = f1;
        raise exception 'a fact was deleted';
    exception when restrict_violation then
        null;
    end;

    -- The sanctioned correction: insert a superseding row.
    insert into facts (user_id, document_id, fact_key, text, origin, supersedes)
    values (u, d, 'E1.B1', 'corrected claim', 'attested', f1) returning id into f2;

    select valid_to into vt from facts where id = f1;
    assert vt is not null, 'superseding a fact should close its valid_to';

    begin
        update facts set valid_to = null where id = f1;
        raise exception 'a retired fact was re-opened';
    exception when restrict_violation then
        null;
    end;

    -- Two rows may not claim to supersede the same fact.
    begin
        insert into facts (user_id, document_id, fact_key, text, origin, supersedes)
        values (u, d, 'E1.B1', 'third claim', 'attested', f1);
        raise exception 'a fact was superseded twice';
    exception when unique_violation then
        null;
    end;

    raise notice 'ok - facts: no rewrite, no delete, supersede closes valid_to, only once';
end $$;

-- --------------------------------------------------------------------------
-- Deleting a document keeps its facts and queues the storage object
-- --------------------------------------------------------------------------
do $$
declare
    u       uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    d       uuid;
    f       uuid;
    doc_ref uuid;
    queued  int;
begin
    insert into documents (user_id, kind, storage_path, raw_text)
    values (u, 'pdf', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/gone.pdf', 'y')
    returning id into d;

    insert into facts (user_id, document_id, fact_key, text, origin)
    values (u, d, 'E9.B9', 'survives its document', 'document') returning id into f;

    delete from documents where id = d;

    assert exists (select 1 from facts where id = f),
        'deleting a document must not delete the facts extracted from it';
    select document_id into doc_ref from facts where id = f;
    assert doc_ref is null, 'the fact''s document pointer should be nulled, not stale';

    select count(*) into queued
      from storage_gc_queue
     where storage_path = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/gone.pdf'
       and deleted_at is null;
    assert queued = 1,
        format('the storage object should be queued for deletion exactly once, got %s', queued);

    raise notice 'ok - document delete: facts survive, storage object is queued for GC';
end $$;

-- Account deletion reaches everything, and queues every object.
do $$
declare
    u      uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    queued int;
begin
    insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', u,
            'authenticated', 'authenticated', 'gone@example.test', now(), now());

    insert into documents (user_id, kind, storage_path, raw_text)
    values (u, 'pdf', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd/one.pdf', 'a'),
           (u, 'pdf', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd/two.pdf', 'b');

    delete from auth.users where id = u;

    assert not exists (select 1 from documents where user_id = u),
        'deleting a user should cascade to their documents';

    select count(*) into queued
      from storage_gc_queue
     where owner_id = u and deleted_at is null;
    assert queued = 2,
        format('both storage objects should be queued after account deletion, got %s', queued);

    raise notice 'ok - account deletion cascades and leaves no orphaned storage objects';
end $$;

-- --------------------------------------------------------------------------
-- A patch cannot be accepted twice
-- --------------------------------------------------------------------------
do $$
declare
    u uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    r uuid;
    v uuid;
    p uuid;
    d timestamptz;
begin
    insert into resumes (user_id, title) values (u, 'patch host') returning id into r;
    insert into resume_versions (user_id, resume_id, doc_json, created_by)
    values (u, r, '{}'::jsonb, 'user') returning id into v;
    insert into patches (user_id, resume_id, base_version_id, ops_json)
    values (u, r, v, '[]'::jsonb) returning id into p;

    -- The one sanctioned write: status and applied_version_id together.
    -- decided_at is stamped by the trigger, so the caller does not have to
    -- remember the CHECK constraint.
    update patches set status = 'accepted', applied_version_id = v where id = p;
    select decided_at into d from patches where id = p;
    assert d is not null, 'accepting should stamp decided_at';

    begin
        update patches set status = 'accepted' where id = p;
        raise exception 'a patch was accepted twice';
    exception when invalid_parameter_value then
        null;
    end;

    begin
        update patches set status = 'declined' where id = p;
        raise exception 'a decided patch was re-decided';
    exception when invalid_parameter_value then
        null;
    end;

    begin
        update patches set status = 'proposed', decided_at = null where id = p;
        raise exception 'a decided patch was re-opened';
    exception when invalid_parameter_value or check_violation then
        null;
    end;

    -- Even an update that touches nothing else is refused: a replayed accept
    -- sends the identical values, and letting it through is how ops get
    -- applied twice.
    begin
        update patches set rationale = rationale where id = p;
        raise exception 'a decided patch was still mutable';
    exception when invalid_parameter_value then
        null;
    end;

    raise notice 'ok - a patch decision is final and the row freezes';
end $$;

-- A patch cannot record an applied version unless it was accepted.
do $$
declare
    u uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    r uuid;
    v uuid;
begin
    insert into resumes (user_id, title) values (u, 'patch host 2') returning id into r;
    insert into resume_versions (user_id, resume_id, doc_json, created_by)
    values (u, r, '{}'::jsonb, 'user') returning id into v;

    begin
        insert into patches (user_id, resume_id, base_version_id, ops_json,
                             status, applied_version_id)
        values (u, r, v, '[]'::jsonb, 'proposed', v);
        raise exception 'a proposed patch recorded an applied version';
    exception when check_violation then
        raise notice 'ok - only an accepted patch can name an applied version';
    end;
end $$;

-- --------------------------------------------------------------------------
-- Content dedupe
-- --------------------------------------------------------------------------
do $$
declare
    u uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
begin
    insert into documents (user_id, kind, sha256, raw_text)
    values (u, 'text', 'dupe-sha', 'same text');

    begin
        insert into documents (user_id, kind, sha256, raw_text)
        values (u, 'text', 'dupe-sha', 'same text');
        raise exception 'the same document was stored twice for one user';
    exception when unique_violation then
        null;
    end;

    -- Two documents with no hash are still two documents (partial index).
    insert into documents (user_id, kind, raw_text) values (u, 'text', 'p1');
    insert into documents (user_id, kind, raw_text) values (u, 'text', 'p2');

    raise notice 'ok - per-user content dedupe, and unhashed documents are exempt';
end $$;

-- --------------------------------------------------------------------------
-- step_cache accounting
-- --------------------------------------------------------------------------
do $$
declare
    out_json jsonb;
    h        int;
begin
    insert into step_cache (cache_key, step, output_json, model, prompt_version)
    values ('inv-key', 'jd_extract', '{"a":1}'::jsonb, 'm', 'v1');

    out_json := public.step_cache_get('inv-key');
    assert out_json = '{"a":1}'::jsonb, 'cache read returned the wrong payload';

    select hits into h from step_cache where cache_key = 'inv-key';
    assert h = 1, format('hits should be 1 after one read, got %s', h);

    assert public.step_cache_get('no-such-key') is null,
        'a miss should return null, not raise';

    raise notice 'ok - step_cache_get returns the payload and counts the hit';
end $$;

do $$
begin
    raise notice '----------------------------------------------------------';
    raise notice 'PASS - schema invariants hold';
    raise notice '----------------------------------------------------------';
end $$;

rollback;

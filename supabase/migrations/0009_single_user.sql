-- ---------------------------------------------------------------------------
-- 0009 — single user. Authentication removed.
-- ---------------------------------------------------------------------------
--
-- READ THIS BEFORE DEPLOYING ANYTHING THAT RUNS THIS MIGRATION.
--
-- This turns a multi-tenant database into a single-user one. After it runs
-- there is no authentication and no row-level security, which means:
--
--   * Anyone who can reach the PostgREST endpoint with the publishable key
--     can read, change and delete every row in every table. The publishable
--     key is shipped to browsers by design, so in practice that is anyone
--     who can reach the site.
--   * Resumes are dense personal data: names, phone numbers, addresses,
--     employment history. There is no longer anything between that data and
--     the public internet except the obscurity of the project URL.
--
-- That is a deliberate choice for a local, single-operator install. It is
-- not a configuration to deploy. 0002_rls.sql is left in place and
-- unmodified so restoring tenancy is a matter of re-running it and
-- re-enabling the gate in the application, not of rewriting it.
--
-- WHY THE FOREIGN KEYS GO
--
-- Every table carried `user_id uuid not null references auth.users (id)`.
-- With no sign-in there is no auth.users row to point at, so the reference
-- would reject every insert. The column stays, defaulted to one fixed owner,
-- because dropping it would mean rewriting every composite key added in 0004
-- and every index in 0003, and because it is the hook tenancy hangs back on.
--
-- WHAT IS DELIBERATELY KEPT
--
--   * user_id on every row, defaulted rather than removed
--   * the composite foreign keys from 0004, which still stop a child row
--     pointing at a parent owned by a different id
--   * every trigger from 0005, including the append-only facts rule
--
-- The isolation tests in supabase/tests/rls_test.sql will fail after this,
-- and that is correct: they assert a property this migration removes.

-- --------------------------------------------------------------------------
-- The one owner
-- --------------------------------------------------------------------------
-- A fixed uuid rather than a random one, so the application and the database
-- agree without a lookup, and so a dump from one install loads into another.

create schema if not exists app;

create or replace function app.owner_id() returns uuid
    language sql immutable parallel safe
as $$ select '00000000-0000-0000-0000-00000000da7a'::uuid $$;

comment on function app.owner_id is
    'The single owner every row belongs to now that authentication is gone. '
    'Referenced by column defaults so the application never has to send it.';

-- --------------------------------------------------------------------------
-- The composite tenant keys have to go, and this is why
-- --------------------------------------------------------------------------
--
-- 0004 replaced every child foreign key with a composite one of the shape
-- `(child_ref, user_id) references parent (id, user_id)`. That was the right
-- design: row-level security checks the row being written and not the row it
-- points at, so a single-column key let one tenant attach their version to
-- another tenant's resume with every policy passing.
--
-- With one user they defend nothing, and they actively break two things:
--
--   1. Backfilling user_id is impossible while they exist. Updating a parent
--      orphans the child pair; updating the child first points it at a pair
--      that does not exist yet. There is no order that works, which is the
--      error this migration hit on its first run:
--        update or delete on table "documents" violates foreign key
--        constraint "resumes_source_document_fkey"
--
--   2. Even without a backfill they would break the next upload. A new row
--      takes the owner default while every existing row keeps its old uuid,
--      so a new resume pointing at an old document fails the composite check
--      on a pair that will never match.
--
-- So they are replaced by plain single-column keys carrying the same delete
-- behaviour. "This parent exists" is still enforced. "This parent belongs to
-- the same tenant" is not, because there is only one.
--
-- Restoring tenancy means re-running 0004 after re-running 0002.

do $$
declare
    r record;
begin
    for r in
        select conname, conrelid::regclass::text as tbl
        from pg_constraint
        where contype = 'f'
          and connamespace = 'public'::regnamespace
          and conname in (
            'chat_messages_session_tenant_fkey', 'chat_sessions_resume_tenant_fkey',
            'facts_document_tenant_fkey', 'facts_supersedes_tenant_fkey',
            'patches_applied_version_tenant_fkey', 'patches_base_version_tenant_fkey',
            'patches_resume_tenant_fkey', 'resume_jobs_job_tenant_fkey',
            'resume_jobs_resume_tenant_fkey', 'resume_versions_parent_tenant_fkey',
            'resume_versions_resume_tenant_fkey', 'resumes_base_tenant_fkey',
            'resumes_current_version_fkey', 'resumes_job_tenant_fkey',
            'resumes_source_document_fkey', 'step_traces_resume_tenant_fkey'
          )
    loop
        execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    end loop;
end $$;

-- Single-column replacements. Same targets, same ON DELETE behaviour as the
-- composite versions they replace; only the tenant half is dropped.
alter table resumes
    add constraint resumes_source_document_fkey
    foreign key (source_document_id) references documents (id) on delete set null;

alter table resumes
    add constraint resumes_current_version_fkey
    foreign key (current_version_id) references resume_versions (id)
    on delete set null deferrable initially deferred;

-- --------------------------------------------------------------------------
-- Detach from auth.users, default the owner, open the tables
-- --------------------------------------------------------------------------

do $$
declare
    t text;
    c text;
    pol record;
begin
    foreach t in array array[
        'documents', 'facts', 'jobs', 'resumes', 'resume_versions',
        'patches', 'resume_jobs', 'chat_sessions', 'chat_messages',
        'step_traces', 'storage_gc_queue'
    ]
    loop
        if to_regclass('public.' || t) is null then
            continue;
        end if;

        -- 1. Drop every policy. Leaving them while RLS is off is worse than
        --    removing them: the next person to enable RLS gets rules that
        --    reference an auth.uid() that is always null, and every query
        --    silently returns nothing.
        for pol in
            select policyname from pg_policies
            where schemaname = 'public' and tablename = t
        loop
            execute format('drop policy if exists %I on public.%I', pol.policyname, t);
        end loop;

        execute format('alter table public.%I disable row level security', t);
        execute format('alter table public.%I no force row level security', t);

        -- 2. Drop only the references to auth.users. The composite keys
        --    between our own tables, added in 0004, are left alone: they
        --    still prevent a version being attached to somebody else's
        --    resume, which remains a real integrity rule even with one user.
        for c in
            select con.conname
            from pg_constraint con
            join pg_class rel on rel.oid = con.confrelid
            join pg_namespace ns on ns.oid = rel.relnamespace
            where con.conrelid = ('public.' || t)::regclass
              and con.contype = 'f'
              and ns.nspname = 'auth'
              and rel.relname = 'users'
        loop
            execute format('alter table public.%I drop constraint %I', t, c);
        end loop;

        -- 3. Default the owner, so no caller has to know the uuid.
        if exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = t and column_name = 'user_id'
        ) then
            execute format(
                'alter table public.%I alter column user_id set default app.owner_id()', t
            );
            execute format('update public.%I set user_id = app.owner_id()', t);
        end if;

        -- 4. Grant the browser-facing role. With RLS off this is what makes
        --    the table reachable at all, and it is also precisely what makes
        --    the data public. See the warning at the top of this file.
        execute format('grant select, insert, update, delete on public.%I to anon', t);
    end loop;
end $$;

-- step_cache was service-role only and never user-scoped. It needs the same
-- grant now that there is no service role in the request path.
do $$
begin
    if to_regclass('public.step_cache') is not null then
        execute 'alter table public.step_cache disable row level security';
        execute 'grant select, insert, update, delete on public.step_cache to anon';
    end if;
end $$;

grant usage on schema public to anon;
grant usage on schema app to anon;
grant execute on function app.owner_id() to anon;
grant usage, select on all sequences in schema public to anon;

-- --------------------------------------------------------------------------
-- Storage
-- --------------------------------------------------------------------------
-- The bucket policies in 0006 keyed on (storage.foldername(name))[1] being
-- the caller's uid. With no caller there is no uid, so they are replaced by
-- one rule: the bucket is readable and writable.

do $$
declare
    pol record;
begin
    if to_regclass('storage.objects') is null then
        return;
    end if;

    for pol in
        select policyname from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname like 'resumes_%'
    loop
        execute format('drop policy if exists %I on storage.objects', pol.policyname);
    end loop;

    execute $p$
        create policy resumes_single_user on storage.objects
            for all to anon
            using (bucket_id = 'resumes')
            with check (bucket_id = 'resumes')
    $p$;
end $$;

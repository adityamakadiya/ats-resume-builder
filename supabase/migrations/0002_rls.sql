-- 0002_rls.sql
--
-- Row Level Security. This file is the entire tenant boundary: there is no
-- other place where "user A cannot see user B's resume" is enforced, and
-- supabase/tests/rls_test.sql exists to prove it still holds.
--
-- Three conventions, each load-bearing:
--
-- 1. `(select auth.uid())` — NEVER bare `auth.uid()`.
--    Wrapped in a scalar subquery the planner treats it as an InitPlan: it is
--    evaluated once per statement and the result is reused for every row.
--    Written bare, it is a volatile-ish function call re-evaluated per row,
--    which on a sequential scan of a large table is the difference between one
--    call and a million. It also lets the planner use the index on user_id
--    instead of filtering after the fact. The two forms are semantically
--    identical; only one of them scales.
--
-- 2. ONE POLICY PER OPERATION, never `for all`.
--    `for all` collapses select/insert/update/delete into a single expression.
--    The day someone needs to loosen SELECT — a share link, a team view, an
--    admin read — they edit that one expression and silently grant the same
--    loosening to DELETE. Four narrow policies make that mistake impossible to
--    make by accident: widening a read requires touching only the read policy.
--
-- 3. `using` vs `with check`.
--    UPDATE policies specify both. `using` decides which rows you may target;
--    `with check` decides what the row may look like afterwards. With only
--    `using`, a user could target their own row and rewrite user_id to someone
--    else's — handing a row to another tenant, or stealing one by writing their
--    own id onto a row they were allowed to see. Every insert/update check
--    below therefore pins user_id to the caller.
--
-- Roles: `anon` gets nothing anywhere. `authenticated` gets exactly what these
-- policies allow. `service_role` bypasses RLS entirely (BYPASSRLS), which is
-- how the backend does cross-tenant work such as cache maintenance — so any
-- code path running as service_role is outside this boundary and must apply
-- its own filtering.

-- --------------------------------------------------------------------------
-- Grants
-- --------------------------------------------------------------------------
-- RLS narrows privileges, it does not confer them; a table with a permissive
-- policy and no GRANT is still unreadable. Supabase's default privileges
-- usually cover this, but stating it here keeps the migration self-contained
-- and reproducible on a plain Postgres.
grant usage on schema public to anon, authenticated, service_role;

do $$
declare
    t text;
begin
    foreach t in array array[
        'documents', 'facts', 'jobs', 'resumes', 'resume_versions',
        'patches', 'resume_jobs', 'chat_sessions', 'chat_messages', 'step_traces'
    ]
    loop
        execute format(
            'grant select, insert, update, delete on table public.%I to authenticated', t);
        execute format('grant all on table public.%I to service_role', t);
    end loop;
end $$;

-- step_cache and storage_gc_queue get NO grant to anon or authenticated. They
-- are backend-only infrastructure; see the rationale at the bottom of this file.
grant all on table public.step_cache to service_role;
grant all on table public.storage_gc_queue to service_role;
grant usage, select on sequence public.storage_gc_queue_id_seq to service_role;

-- --------------------------------------------------------------------------
-- Enable RLS everywhere
-- --------------------------------------------------------------------------
-- Note `force row level security` as well as `enable`: without FORCE, the
-- table owner bypasses its own policies. In production that is the migration
-- role rather than the request role, but FORCE removes the class of bug where
-- something happens to connect as the owner and quietly sees everything.
do $$
declare
    t text;
begin
    foreach t in array array[
        'documents', 'facts', 'jobs', 'resumes', 'resume_versions',
        'patches', 'resume_jobs', 'chat_sessions', 'chat_messages',
        'step_traces', 'step_cache', 'storage_gc_queue'
    ]
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('alter table public.%I force row level security', t);
    end loop;
end $$;

-- --------------------------------------------------------------------------
-- documents
-- --------------------------------------------------------------------------
drop policy if exists documents_select_own on documents;
create policy documents_select_own on documents
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists documents_insert_own on documents;
create policy documents_insert_own on documents
    for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists documents_update_own on documents;
create policy documents_update_own on documents
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists documents_delete_own on documents;
create policy documents_delete_own on documents
    for delete to authenticated
    using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- facts — SELECT and INSERT only, plus a narrow UPDATE
-- --------------------------------------------------------------------------
-- The ledger is append-only, and the cheapest way to enforce that is to not
-- write the policies that would permit otherwise. There is deliberately NO
-- delete policy: a fact cited by a rendered resume must not be able to vanish.
--
-- The UPDATE policy exists for exactly one operation — closing `valid_to` when
-- a newer fact supersedes this one. A policy cannot express "only this column
-- may change", so the column-level restriction is a trigger
-- (facts_append_only_guard, 0005). Policy and trigger are complementary: the
-- policy says whose rows, the trigger says which columns.
drop policy if exists facts_select_own on facts;
create policy facts_select_own on facts
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists facts_insert_own on facts;
create policy facts_insert_own on facts
    for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists facts_retire_own on facts;
create policy facts_retire_own on facts
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

-- (no facts_delete policy — intentional)

-- --------------------------------------------------------------------------
-- jobs
-- --------------------------------------------------------------------------
drop policy if exists jobs_select_own on jobs;
create policy jobs_select_own on jobs
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists jobs_insert_own on jobs;
create policy jobs_insert_own on jobs
    for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists jobs_update_own on jobs;
create policy jobs_update_own on jobs
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists jobs_delete_own on jobs;
create policy jobs_delete_own on jobs
    for delete to authenticated
    using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- resumes
-- --------------------------------------------------------------------------
drop policy if exists resumes_select_own on resumes;
create policy resumes_select_own on resumes
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists resumes_insert_own on resumes;
create policy resumes_insert_own on resumes
    for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists resumes_update_own on resumes;
create policy resumes_update_own on resumes
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists resumes_delete_own on resumes;
create policy resumes_delete_own on resumes
    for delete to authenticated
    using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- resume_versions
-- --------------------------------------------------------------------------
-- Versions are immutable snapshots, so there is no update policy: editing a
-- version in place would rewrite history that patches and renders point at.
-- A correction is a new version with parent_id set. DELETE is allowed because
-- pruning old drafts is a legitimate user action, and the composite FK plus
-- the 0005 trigger keep resumes.current_version_id honest when it happens.
drop policy if exists resume_versions_select_own on resume_versions;
create policy resume_versions_select_own on resume_versions
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists resume_versions_insert_own on resume_versions;
create policy resume_versions_insert_own on resume_versions
    for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists resume_versions_delete_own on resume_versions;
create policy resume_versions_delete_own on resume_versions
    for delete to authenticated
    using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- patches
-- --------------------------------------------------------------------------
drop policy if exists patches_select_own on patches;
create policy patches_select_own on patches
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists patches_insert_own on patches;
create policy patches_insert_own on patches
    for insert to authenticated
    with check (user_id = (select auth.uid()));

-- Accept / decline. The single-decision rule is enforced by the trigger in
-- 0005, not here: RLS sees rows, not state machines.
drop policy if exists patches_update_own on patches;
create policy patches_update_own on patches
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists patches_delete_own on patches;
create policy patches_delete_own on patches
    for delete to authenticated
    using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- resume_jobs
-- --------------------------------------------------------------------------
drop policy if exists resume_jobs_select_own on resume_jobs;
create policy resume_jobs_select_own on resume_jobs
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists resume_jobs_insert_own on resume_jobs;
create policy resume_jobs_insert_own on resume_jobs
    for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists resume_jobs_update_own on resume_jobs;
create policy resume_jobs_update_own on resume_jobs
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists resume_jobs_delete_own on resume_jobs;
create policy resume_jobs_delete_own on resume_jobs
    for delete to authenticated
    using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- chat_sessions
-- --------------------------------------------------------------------------
drop policy if exists chat_sessions_select_own on chat_sessions;
create policy chat_sessions_select_own on chat_sessions
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists chat_sessions_insert_own on chat_sessions;
create policy chat_sessions_insert_own on chat_sessions
    for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists chat_sessions_update_own on chat_sessions;
create policy chat_sessions_update_own on chat_sessions
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists chat_sessions_delete_own on chat_sessions;
create policy chat_sessions_delete_own on chat_sessions
    for delete to authenticated
    using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- chat_messages
-- --------------------------------------------------------------------------
-- Checked on the row's own user_id rather than by joining to chat_sessions.
-- A join in a policy runs per row and has to be RLS-checked itself; the
-- denormalised column makes this an index lookup. The join condition
-- (message belongs to a session the user owns) is a data-integrity concern,
-- handled by the FK plus the fact that only the owner can create the session.
drop policy if exists chat_messages_select_own on chat_messages;
create policy chat_messages_select_own on chat_messages
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists chat_messages_insert_own on chat_messages;
create policy chat_messages_insert_own on chat_messages
    for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists chat_messages_update_own on chat_messages;
create policy chat_messages_update_own on chat_messages
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists chat_messages_delete_own on chat_messages;
create policy chat_messages_delete_own on chat_messages
    for delete to authenticated
    using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- step_traces
-- --------------------------------------------------------------------------
-- Read-only to the user: traces are written by the backend as service_role.
-- Giving the browser INSERT would let a client fabricate its own cost and
-- latency records, which are the numbers billing and alerting read.
drop policy if exists step_traces_select_own on step_traces;
create policy step_traces_select_own on step_traces
    for select to authenticated
    using (user_id = (select auth.uid()));

-- (no insert/update/delete policies for authenticated — intentional)

-- --------------------------------------------------------------------------
-- step_cache — RLS ENABLED, NO POLICIES
-- --------------------------------------------------------------------------
-- RLS with zero policies denies everything to every non-bypassing role. That
-- is the intent: this table is shared across tenants by design (see the long
-- comment in 0001) and therefore must never be reachable from a browser
-- holding a user's JWT.
--
-- Why "enable RLS with no policy" rather than "leave RLS off":
--   * A table in the `public` schema with RLS disabled is exposed by PostgREST
--     and readable by anyone the GRANTs allow. Supabase's own linter flags
--     exactly this. Relying on the absence of a GRANT is one `grant all on all
--     tables in schema public` away from a full cross-tenant dump of every
--     cached model output.
--   * Denying by default means a future GRANT — added by a tool, a template or
--     a well-meaning migration — still cannot read a single row.
-- Both belts are fastened: no grant to anon/authenticated, AND no policy.
-- Only service_role (BYPASSRLS) touches it.

-- --------------------------------------------------------------------------
-- storage_gc_queue — same treatment, same reasons
-- --------------------------------------------------------------------------
-- It holds storage paths belonging to users who may already be deleted, and it
-- is drained by a background worker. Nothing a browser does should ever read
-- or write it. RLS enabled, no policies, no grants outside service_role.

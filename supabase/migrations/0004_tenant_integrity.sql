-- 0004_tenant_integrity.sql
--
-- Composite foreign keys that make a cross-tenant reference structurally
-- impossible, not merely unlikely.
--
-- THE HOLE THIS CLOSES
--   RLS checks the row you are writing. It does not check what that row points
--   at. Consider, with only the single-column FKs from 0001:
--
--       -- as user B, knowing (or guessing) user A's resume id
--       insert into resume_versions (user_id, resume_id, doc_json, created_by)
--       values (B, '<A''s resume>', '{"headline":"pwned"}', 'user');
--
--   Every check passes. The insert policy is satisfied (user_id = B). The FK
--   is satisfied (A's resume exists). B has written a row into A's document
--   history — and the trigger in 0005, which points a resume at its newest
--   version, would then make A's resume render B's content. B cannot read the
--   row back, so this is not a read leak; it is a write leak, which is worse.
--
--   The same shape exists for every child that references a parent: a patch
--   against someone else's version, a chat message in someone else's session,
--   a resume_jobs row joining your resume to their job, a fact attached to
--   their document.
--
-- THE FIX
--   Give every parent a `unique (id, user_id)` and make the child's FK
--   composite: `(parent_id, user_id) references parent (id, user_id)`. The
--   child's own user_id — already pinned to the caller by RLS — is now part of
--   the reference, so a row can only point at a parent belonging to the same
--   user. The database rejects the insert above with a foreign key violation
--   and no application code is involved.
--
--   `unique (id, user_id)` on a table whose id is already a primary key costs
--   one extra index and adds no new constraint on the data; it exists purely
--   to be a valid FK target.
--
--   The single-column FKs from 0001 are kept alongside. They are redundant for
--   integrity but they document intent, and dropping one later (say, to change
--   a delete rule) should not silently take the tenant check with it.

-- --------------------------------------------------------------------------
-- Parents: advertise (id, user_id) as a referenceable key
-- --------------------------------------------------------------------------
do $$
declare
    t text;
begin
    foreach t in array array[
        -- facts is in this list because it is its own parent (supersedes).
        'documents', 'jobs', 'resumes', 'resume_versions', 'chat_sessions', 'facts'
    ]
    loop
        if not exists (
            select 1 from pg_constraint
            where conname = t || '_id_user_key'
              and conrelid = format('public.%I', t)::regclass
        ) then
            execute format(
                'alter table public.%I add constraint %I unique (id, user_id)',
                t, t || '_id_user_key');
        end if;
    end loop;
end $$;

-- --------------------------------------------------------------------------
-- Children: composite FKs
-- --------------------------------------------------------------------------

-- facts -> documents. `set null` on both columns is not possible here because
-- user_id is NOT NULL, so the tenant half of the key must survive the delete.
-- `on delete set null (document_id)` (PG 15+) nulls only the document pointer,
-- which is exactly the behaviour 0001 argued for: the fact outlives the file.
alter table facts drop constraint if exists facts_document_tenant_fkey;
alter table facts add constraint facts_document_tenant_fkey
    foreign key (document_id, user_id) references documents (id, user_id)
    on delete set null (document_id);

-- facts -> facts (supersedes). A fact may only supersede another fact of the
-- same user; otherwise B could retire A's claim out from under the guard.
alter table facts drop constraint if exists facts_supersedes_tenant_fkey;
alter table facts add constraint facts_supersedes_tenant_fkey
    foreign key (supersedes, user_id) references facts (id, user_id)
    on delete set null (supersedes);

-- resumes -> resumes (base_resume_id) and -> jobs (job_id)
alter table resumes drop constraint if exists resumes_base_tenant_fkey;
alter table resumes add constraint resumes_base_tenant_fkey
    foreign key (base_resume_id, user_id) references resumes (id, user_id)
    on delete set null (base_resume_id);

alter table resumes drop constraint if exists resumes_job_tenant_fkey;
alter table resumes add constraint resumes_job_tenant_fkey
    foreign key (job_id, user_id) references jobs (id, user_id)
    on delete set null (job_id);

-- resume_versions -> resumes, and -> resume_versions (parent_id)
alter table resume_versions drop constraint if exists resume_versions_resume_tenant_fkey;
alter table resume_versions add constraint resume_versions_resume_tenant_fkey
    foreign key (resume_id, user_id) references resumes (id, user_id)
    on delete cascade;

alter table resume_versions drop constraint if exists resume_versions_parent_tenant_fkey;
alter table resume_versions add constraint resume_versions_parent_tenant_fkey
    foreign key (parent_id, user_id) references resume_versions (id, user_id)
    on delete set null (parent_id);

-- patches -> resumes, -> resume_versions (base and applied)
alter table patches drop constraint if exists patches_resume_tenant_fkey;
alter table patches add constraint patches_resume_tenant_fkey
    foreign key (resume_id, user_id) references resumes (id, user_id)
    on delete cascade;

alter table patches drop constraint if exists patches_base_version_tenant_fkey;
alter table patches add constraint patches_base_version_tenant_fkey
    foreign key (base_version_id, user_id) references resume_versions (id, user_id)
    on delete cascade;

alter table patches drop constraint if exists patches_applied_version_tenant_fkey;
alter table patches add constraint patches_applied_version_tenant_fkey
    foreign key (applied_version_id, user_id) references resume_versions (id, user_id)
    on delete set null (applied_version_id);

-- resume_jobs -> resumes, -> jobs
alter table resume_jobs drop constraint if exists resume_jobs_resume_tenant_fkey;
alter table resume_jobs add constraint resume_jobs_resume_tenant_fkey
    foreign key (resume_id, user_id) references resumes (id, user_id)
    on delete cascade;

alter table resume_jobs drop constraint if exists resume_jobs_job_tenant_fkey;
alter table resume_jobs add constraint resume_jobs_job_tenant_fkey
    foreign key (job_id, user_id) references jobs (id, user_id)
    on delete cascade;

-- chat_sessions -> resumes
alter table chat_sessions drop constraint if exists chat_sessions_resume_tenant_fkey;
alter table chat_sessions add constraint chat_sessions_resume_tenant_fkey
    foreign key (resume_id, user_id) references resumes (id, user_id)
    on delete cascade;

-- chat_messages -> chat_sessions. This is what makes the denormalised user_id
-- on chat_messages safe: 0002 checks the local column instead of joining to
-- the session, and this constraint guarantees the two can never disagree.
alter table chat_messages drop constraint if exists chat_messages_session_tenant_fkey;
alter table chat_messages add constraint chat_messages_session_tenant_fkey
    foreign key (session_id, user_id) references chat_sessions (id, user_id)
    on delete cascade;

-- step_traces -> resumes
alter table step_traces drop constraint if exists step_traces_resume_tenant_fkey;
alter table step_traces add constraint step_traces_resume_tenant_fkey
    foreign key (resume_id, user_id) references resumes (id, user_id)
    on delete set null (resume_id);

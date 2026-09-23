-- 0003_indexes.sql
--
-- Indexes, in their own migration so that adding one later is a one-line diff
-- with no chance of touching a table definition.
--
-- Two rules shaped this list:
--
-- 1. EVERY RLS PREDICATE NEEDS AN INDEX. `user_id = (select auth.uid())` is
--    applied to every single query against every user-scoped table. Without an
--    index on user_id, that predicate is a sequential scan of the whole
--    tenant-wide table on every request, and the scan gets slower as other
--    people sign up. Composite indexes leading with user_id serve both the
--    policy and the query.
--
-- 2. LEAD WITH THE EQUALITY COLUMN, END WITH THE SORT. `(user_id, updated_at
--    desc)` lets Postgres seek to the tenant and then walk the index in
--    already-sorted order, so "my resumes, newest first, limit 20" reads
--    twenty index entries and stops. The reverse order would force a sort of
--    everything the user owns.

-- --------------------------------------------------------------------------
-- documents
-- --------------------------------------------------------------------------
create index if not exists documents_user_created_idx
    on documents (user_id, created_at desc);

-- Content lookup: "have we already extracted this exact text?" — the surviving
-- half of store.py's fingerprint idea. Not unique on its own (the unique
-- constraint is per user, in 0001); this one serves dedupe analytics and the
-- service-role path that answers the question before a user_id is in hand.
create index if not exists documents_sha256_idx
    on documents (sha256)
    where sha256 is not null;

-- --------------------------------------------------------------------------
-- facts
-- --------------------------------------------------------------------------
-- The truth guard's hot path: given a tailored line citing 'E1.B2', fetch that
-- fact for this user. Equality on both columns, so plain btree order is fine.
create index if not exists facts_user_key_idx
    on facts (user_id, fact_key);

-- "Show me everything extracted from this upload", and the cascade path when a
-- document is deleted. An unindexed FK makes every parent delete a full scan
-- of the child table.
create index if not exists facts_document_idx
    on facts (document_id)
    where document_id is not null;

-- The guard only ever reads *currently believed* facts. A partial index on the
-- open rows keeps superseded history out of the hot index entirely, so the
-- index stops growing once a user's resume settles even as the ledger does not.
create index if not exists facts_user_current_idx
    on facts (user_id, fact_key)
    where valid_to is null;

-- --------------------------------------------------------------------------
-- jobs
-- --------------------------------------------------------------------------
create index if not exists jobs_user_created_idx
    on jobs (user_id, created_at desc);

create index if not exists jobs_sha256_idx
    on jobs (sha256)
    where sha256 is not null;

-- --------------------------------------------------------------------------
-- resumes
-- --------------------------------------------------------------------------
-- The dashboard query, verbatim.
create index if not exists resumes_user_updated_idx
    on resumes (user_id, updated_at desc);

-- Lineage: "which tailored copies came from this master?"
create index if not exists resumes_base_idx
    on resumes (base_resume_id)
    where base_resume_id is not null;

create index if not exists resumes_job_idx
    on resumes (job_id)
    where job_id is not null;

-- Supports the composite FK's referential check and the 0004 trigger's lookup.
create index if not exists resumes_current_version_idx
    on resumes (current_version_id)
    where current_version_id is not null;

-- --------------------------------------------------------------------------
-- resume_versions
-- --------------------------------------------------------------------------
-- The history pane, and the trigger that recomputes current_version_id: both
-- want "newest version of this resume" as a single index seek.
create index if not exists resume_versions_resume_created_idx
    on resume_versions (resume_id, created_at desc);

create index if not exists resume_versions_user_created_idx
    on resume_versions (user_id, created_at desc);

create index if not exists resume_versions_parent_idx
    on resume_versions (parent_id)
    where parent_id is not null;

-- --------------------------------------------------------------------------
-- patches
-- --------------------------------------------------------------------------
create index if not exists patches_resume_status_idx
    on patches (resume_id, status);

-- The partial index that pays. The editor asks "what is still pending on this
-- resume?" on every render, while accepted and declined patches accumulate
-- forever and are read only by the history view. Restricting to 'proposed'
-- keeps this index roughly constant-sized — usually a handful of rows per
-- resume — no matter how long the audit trail grows.
create index if not exists patches_resume_proposed_idx
    on patches (resume_id)
    where status = 'proposed';

create index if not exists patches_user_created_idx
    on patches (user_id, created_at desc);

create index if not exists patches_base_version_idx
    on patches (base_version_id);

-- --------------------------------------------------------------------------
-- resume_jobs
-- --------------------------------------------------------------------------
-- (resume_id, job_id) is already covered by the unique constraint in 0001.
-- This is the other direction: "every resume I have aimed at this job".
create index if not exists resume_jobs_job_idx
    on resume_jobs (job_id);

create index if not exists resume_jobs_user_created_idx
    on resume_jobs (user_id, created_at desc);

-- --------------------------------------------------------------------------
-- chat
-- --------------------------------------------------------------------------
create index if not exists chat_sessions_resume_created_idx
    on chat_sessions (resume_id, created_at desc);

create index if not exists chat_sessions_user_created_idx
    on chat_sessions (user_id, created_at desc);

-- Transcript replay, in insertion order. ASC, not DESC: a conversation is read
-- oldest-first, and the index direction should match how it is scanned.
create index if not exists chat_messages_session_created_idx
    on chat_messages (session_id, created_at);

create index if not exists chat_messages_user_created_idx
    on chat_messages (user_id, created_at desc);

-- --------------------------------------------------------------------------
-- step_traces
-- --------------------------------------------------------------------------
create index if not exists step_traces_user_created_idx
    on step_traces (user_id, created_at desc);

create index if not exists step_traces_resume_created_idx
    on step_traces (resume_id, created_at desc)
    where resume_id is not null;

-- Alerting reads only the failures, which are a tiny fraction of rows. A
-- partial index makes "recent errors" cheap without indexing the happy path.
create index if not exists step_traces_failures_idx
    on step_traces (created_at desc)
    where ok = false;

-- --------------------------------------------------------------------------
-- step_cache
-- --------------------------------------------------------------------------
-- cache_key is the primary key, which is the only lookup the read path makes.
-- This index serves eviction ("oldest, least-used entries first"), which is a
-- background job and would otherwise scan the whole cache.
create index if not exists step_cache_step_created_idx
    on step_cache (step, created_at);

-- --------------------------------------------------------------------------
-- storage_gc_queue
-- --------------------------------------------------------------------------
-- The worker's claim query: undeleted rows, oldest first. Partial, because
-- completed rows are kept for audit and are never polled.
create index if not exists storage_gc_queue_pending_idx
    on storage_gc_queue (enqueued_at)
    where deleted_at is null;

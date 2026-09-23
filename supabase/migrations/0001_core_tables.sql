-- 0001_core_tables.sql
--
-- The multi-tenant core of the resume-tailoring platform.
--
-- This replaces backend/src/atsresume/store.py, which was a three-table SQLite
-- file with no notion of a user. Two things from that file survive as ideas and
-- are worth restating, because they are why several columns here exist:
--
--   * FINGERPRINTING. store.py keyed cached facts on
--     sha256(extracted_text) + a hash of the extraction prompt and the
--     ResumeFacts JSON schema. Re-extracting a resume costs a model call and
--     several seconds, and the same bytes always produce the same facts *for a
--     given extraction contract*. The contract hash is what makes the cache
--     safe to keep: change the prompt or the schema and every old key misses
--     instead of serving stale shapes. That idea lives on in two places here:
--     `documents.sha256` / `jobs.sha256` (content identity) and
--     `step_cache.cache_key` + `step_cache.prompt_version` (contract identity).
--
--   * THE FACTS CACHE. It existed so a user could re-tailor against a second
--     job without paying for extraction twice. Here it is no longer a cache at
--     all: `facts` is a durable, append-only provenance ledger, because the
--     truth guard needs to answer "which line of which document does this
--     claim come from" long after the upload is gone.
--
-- Conventions
--   * Every user-scoped table carries `user_id uuid not null references
--     auth.users(id) on delete cascade`. Denormalised onto every table on
--     purpose: an RLS policy that has to join upward to find the owner is both
--     slower and easier to get wrong than one that reads a local column.
--   * Timestamps are timestamptz, defaulted to now().
--   * Structured payloads are jsonb and mirror the Pydantic models in
--     backend/src/atsresume/models.py one-for-one. Which model belongs in which
--     column is stated on the column.
--   * ids are uuid defaulted from gen_random_uuid(), so a client can mint an id
--     before the round trip.

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- documents — the uploaded artefact, exactly as it arrived
-- --------------------------------------------------------------------------
-- One row per upload, mirroring models.SourceDocument. The bytes themselves
-- live in Storage (see 0006_storage.sql); `storage_path` points at them and is
-- always prefixed with the owner's uid, which is what the Storage policies
-- key on.
--
-- DECISION: raw_text is stored here and not only in Storage. The truth guard
-- re-reads the original text on every tailor run to verify that a rewritten
-- line is entailed by something the candidate actually wrote. Making that a
-- Storage fetch would put a network call in the middle of a hot verification
-- loop, and would break entirely once the user deletes the file but keeps the
-- resume built from it.
create table if not exists documents (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users (id) on delete cascade,
    storage_path text,                       -- '<uid>/<document_id>.pdf' in the 'resumes' bucket; null for pasted text
    kind         text not null check (kind in ('pdf', 'docx', 'text')),
    sha256       text,                       -- of the extracted text, not the file bytes
    page_count   int  not null default 0,
    style_json   jsonb,                      -- models.StyleProfile; null for docx/text
    raw_text     text not null default '',
    notes        jsonb not null default '[]'::jsonb,  -- SourceDocument.notes, a string array
    created_at   timestamptz not null default now()
);

comment on column documents.sha256 is
    'sha256 of the normalised extracted text. Content identity, not file identity: '
    'the same resume exported twice from Word produces different bytes but the same text.';

-- Re-uploading the same resume should land on the same row rather than
-- fanning out duplicate facts. Partial, because a pasted document may not
-- have been hashed.
create unique index if not exists documents_user_sha256_key
    on documents (user_id, sha256)
    where sha256 is not null;

-- --------------------------------------------------------------------------
-- facts — the provenance ledger. APPEND-ONLY.
-- --------------------------------------------------------------------------
-- Flattened from models.ResumeFacts: every Bullet, SkillGroup, Certification
-- and OtherSection line becomes one row, addressed by the stable id the
-- extractor assigns ('E1.B2', 'P1', 'S3'). models.py puts it plainly: the
-- facts are what the candidate claimed, and tailored lines cite them by id.
-- That citation is only verifiable if the cited row still exists and still
-- says what it said when it was cited. Hence append-only.
--
-- DECISION — deleting a document must not delete its facts.
--   `document_id ... on delete set null`. A user who deletes an upload is
--   deleting a file, not retracting a claim: resumes already tailored from it
--   still cite these fact_keys, and the truth guard would start failing rows
--   it previously passed. `evidence_json` snapshots the supporting span from
--   the source text at insert time, so a fact stays self-describing after its
--   document is gone. If the user really means "forget this", that is an
--   account- or document-level erasure job that tombstones the facts too, and
--   it is deliberately a different, louder operation.
--
-- DECISION — ship `origin` now.
--   Attestation ("I confirm I did this, it just wasn't on the resume") is a
--   later phase. The column is here anyway because provenance cannot be
--   backfilled: once a few thousand rows exist with no origin recorded, there
--   is no way to tell a document-extracted fact from a user-attested one
--   except by guessing, and guessing about provenance is exactly the failure
--   the truth guard exists to prevent.
--     'document'  — extracted verbatim from an uploaded document
--     'attested'  — asserted by the user in chat, never seen in a document
--     'derived'   — computed from other facts (e.g. total years from dates)
create table if not exists facts (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users (id) on delete cascade,
    document_id   uuid references documents (id) on delete set null,
    fact_key      text not null,             -- 'E1', 'E1.B2', 'P1', 'S2', 'C1', 'O1.B1'
    text          text not null,             -- verbatim; never paraphrased
    origin        text not null default 'document'
                  check (origin in ('document', 'attested', 'derived')),
    -- What the truth guard tokenises against, extracted once at insert:
    --   {"metrics":["40%","1.2M"],"technologies":["Postgres","FastAPI"],
    --    "employers":["Acme"],"dates":["Jun 2023"]}
    entities_json jsonb not null default '{}'::jsonb,
    -- Where it came from: {"page":1,"char_start":812,"char_end":902,
    --                      "quote":"…","section":"experience"}
    evidence_json jsonb not null default '{}'::jsonb,
    supersedes    uuid references facts (id) on delete set null,
    valid_from    timestamptz not null default now(),
    valid_to      timestamptz,               -- null = currently believed
    created_at    timestamptz not null default now()
);

comment on table facts is
    'Append-only provenance ledger. Correct a fact by inserting a new row whose '
    'supersedes points at the old one; the trigger in 0005 closes the old row''s '
    'valid_to and rejects any other mutation.';

-- A fact may only be superseded once, otherwise "the current version of E1.B2"
-- has two answers and the guard cannot pick one.
create unique index if not exists facts_supersedes_key
    on facts (supersedes)
    where supersedes is not null;

-- --------------------------------------------------------------------------
-- jobs — the JD, raw and decomposed
-- --------------------------------------------------------------------------
-- Declared before `resumes` because resumes.job_id references it.
create table if not exists jobs (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    source_url text,
    jd_text    text not null default '',
    jd_source  text not null default '',     -- 'pasted', 'greenhouse', 'lever', …
    company    text not null default '',     -- denormalised from spec_json for list views
    title      text not null default '',
    spec_json  jsonb,                        -- models.JobSpec; null until extraction runs
    sha256     text,                         -- of the normalised jd_text
    created_at timestamptz not null default now()
);

-- Same JD pasted twice by the same user is the same job. Cross-user dedupe is
-- deliberately NOT done here: two tenants must never share a row, even for
-- identical public text. Sharing the *derived extraction* is what step_cache is
-- for, and that is safe precisely because a JD is not personal data.
create unique index if not exists jobs_user_sha256_key
    on jobs (user_id, sha256)
    where sha256 is not null;

-- --------------------------------------------------------------------------
-- resumes — a named, editable document the user owns
-- --------------------------------------------------------------------------
-- The mutable head. Content lives in resume_versions; this row holds identity,
-- and a cached pointer at the newest version.
--
-- DECISION — can current_version_id dangle?
--   No, and it is the schema that guarantees it rather than the application:
--     * resume_versions carries `unique (id, resume_id)`, and resumes has a
--       COMPOSITE foreign key (current_version_id, id) -> (id, resume_id).
--       A resume therefore cannot point at another resume's version. A plain
--       single-column FK would have allowed exactly that.
--     * `on delete set null (current_version_id)` — PG 15+ column-list syntax,
--       available on Supabase — so deleting the pointed-at version nulls the
--       pointer instead of erroring or cascading the whole resume away. The
--       trigger in 0005 then re-points it at whatever version is now newest.
--   Null is a legal state: a resume that exists but has no version yet.
create table if not exists resumes (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid not null references auth.users (id) on delete cascade,
    title              text not null default 'Untitled resume',
    template_id        text not null default 'default',
    -- 'Tailor a copy for this job' — the lineage back to the master resume.
    -- set null, not cascade: deleting the master must not delete the tailored
    -- children the user actually sent to employers.
    base_resume_id     uuid references resumes (id) on delete set null,
    job_id             uuid references jobs (id) on delete set null,
    schema_version     int  not null default 1,   -- doc_json shape; bump on breaking change
    current_version_id uuid,                      -- composite FK added below
    status             text not null default 'draft',
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

comment on column resumes.status is
    'Application state: draft, applied, screening, interviewing, offer, rejected, '
    'abandoned. Free text, as in store.py, so a new state needs no migration.';

comment on column resumes.schema_version is
    'Version of the doc_json shape in resume_versions. A reader that finds a '
    'schema_version it does not know must refuse to render rather than guess.';

-- --------------------------------------------------------------------------
-- resume_versions — immutable content snapshots
-- --------------------------------------------------------------------------
-- Every save is a new row. `parent_id` makes the history a tree rather than a
-- list, which is what lets an accepted patch branch from an older version
-- without destroying what came after.
create table if not exists resume_versions (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    resume_id  uuid not null references resumes (id) on delete cascade,
    parent_id  uuid references resume_versions (id) on delete set null,
    -- models.TailoredResume, plus contact taken from ResumeFacts. The whole
    -- renderable document, self-contained: rendering an old version must not
    -- depend on today's facts rows.
    doc_json   jsonb not null,
    created_by text not null
               check (created_by in ('ai_tailor', 'ai_chat', 'user', 'import')),
    created_at timestamptz not null default now(),
    -- Target of the composite FK from resumes.current_version_id.
    unique (id, resume_id)
);

alter table resumes
    drop constraint if exists resumes_current_version_fkey;
alter table resumes
    add constraint resumes_current_version_fkey
    foreign key (current_version_id, id)
    references resume_versions (id, resume_id)
    on delete set null (current_version_id)
    deferrable initially deferred;
-- DEFERRABLE because the natural write is "insert version, then point the
-- resume at it" inside one transaction; with an immediate constraint the
-- application would have to order those two statements correctly forever.

-- --------------------------------------------------------------------------
-- patches — proposed edits, as ops rather than as text
-- --------------------------------------------------------------------------
-- The AI proposes a patch against a specific base version; the user accepts or
-- declines. Storing ops (RFC-6902-shaped paths into doc_json) rather than a
-- rewritten document is what makes "accept just this one bullet" possible and
-- what makes the diff reviewable.
--
-- DECISION — can a patch be accepted twice?
--   No. 'proposed' is the only non-terminal status; the trigger in 0005
--   rejects any transition out of accepted/declined/superseded, and stamps
--   decided_at. Without that, a double-click on Accept applies the same ops
--   twice and silently duplicates a bullet. `applied_version_id` records which
--   version the acceptance produced, so the answer to "was this already
--   applied, and where" is a column rather than an inference.
create table if not exists patches (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid not null references auth.users (id) on delete cascade,
    resume_id          uuid not null references resumes (id) on delete cascade,
    base_version_id    uuid not null references resume_versions (id) on delete cascade,
    -- [{"op":"replace","path":"/experience/0/bullets/1/text","value":"…",
    --   "source_ids":["E1.B2"]}, …]
    ops_json           jsonb not null,
    origin             text not null default 'ai_tailor',   -- ai_tailor | ai_chat | user
    status             text not null default 'proposed'
                       check (status in ('proposed', 'accepted', 'declined', 'superseded')),
    rationale          text not null default '',
    score_delta        numeric,              -- predicted change in AtsReport.overall
    applied_version_id uuid references resume_versions (id) on delete set null,
    decided_at         timestamptz,
    created_at         timestamptz not null default now(),
    -- A decision must be recorded when and only when one was made.
    constraint patches_decided_at_matches_status check (
        (status = 'proposed' and decided_at is null)
        or (status <> 'proposed' and decided_at is not null)
    ),
    -- Only an accepted patch can have produced a version.
    constraint patches_applied_only_when_accepted check (
        applied_version_id is null or status = 'accepted'
    )
);

-- --------------------------------------------------------------------------
-- resume_jobs — one resume measured against one job
-- --------------------------------------------------------------------------
-- The analysis layer, kept out of both parents because it belongs to neither:
-- re-running the gap analysis must not create a new resume version, and
-- re-scoring against a second job must not touch the first job's report.
create table if not exists resume_jobs (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    resume_id   uuid not null references resumes (id) on delete cascade,
    job_id      uuid not null references jobs (id) on delete cascade,
    gaps_json   jsonb,                       -- models.GapAnalysis
    report_json jsonb,                       -- models.AtsReport
    truth_json  jsonb,                       -- models.TruthReport
    strategy_json jsonb,                     -- models.Strategy
    created_at  timestamptz not null default now(),
    unique (resume_id, job_id)
);

-- --------------------------------------------------------------------------
-- chat_sessions / chat_messages
-- --------------------------------------------------------------------------
create table if not exists chat_sessions (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    resume_id  uuid not null references resumes (id) on delete cascade,
    kind       text not null check (kind in ('edit', 'interview')),
    created_at timestamptz not null default now()
);

create table if not exists chat_messages (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users (id) on delete cascade,
    session_id      uuid not null references chat_sessions (id) on delete cascade,
    role            text not null check (role in ('user', 'assistant', 'system', 'tool')),
    content         text not null default '',
    tool_calls_json jsonb,
    tokens_in       int not null default 0,
    tokens_out      int not null default 0,
    cost_usd        numeric(12, 6) not null default 0,
    created_at      timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- step_cache — content-addressed, DELIBERATELY NOT USER-SCOPED
-- --------------------------------------------------------------------------
-- Every other table in this file is a tenant's private data. This one is not,
-- and the asymmetry is intentional, so read the rule before adding a caller.
--
-- WHY IT IS GLOBAL
--   Pipeline steps are pure functions of their input. Extracting a JobSpec
--   from a Greenhouse posting costs a model call and several seconds, and two
--   candidates applying to the same job paste byte-identical text. Keying the
--   cache by a hash of the input rather than by user turns the second
--   candidate's extraction into a lookup. Scoping it per user would throw that
--   away for no benefit, because the output does not depend on who asked.
--
-- THE PRIVACY CONSEQUENCE YOU MUST DESIGN AROUND
--   A content-addressed cache is a read oracle. Anyone able to compute a
--   cache_key can retrieve the value stored under it. If a key were derived
--   from resume text, then a cache hit would (a) hand one tenant a value
--   computed from another tenant's private document, and (b) confirm, by the
--   hit alone, that some other user holds that exact text. Both are tenant
--   leaks, and neither is fixed by RLS on this table: the leak is in the key,
--   not in the row.
--
-- THE RULE  (enforce it in the key-derivation helper, not by inspection)
--   1. GLOBAL KEYS may be derived only from NON-PII inputs: job description
--      text, prompt text, model id, prompt_version, static taxonomies. A JD is
--      published by an employer; it is not the user's personal data.
--   2. ANY step whose input includes resume-derived material — raw_text,
--      ResumeFacts, a tailored document, chat content, anything a user wrote
--      about themselves — MUST include the user_id in the hashed key:
--          cache_key = sha256(step | prompt_version | model | user_id | input)
--      The entry is then content-addressed *within one tenant* and a
--      cross-tenant hit is arithmetically impossible.
--   3. Uncertain which bucket a new step falls in? It is bucket 2. The cost of
--      a wrong guess is a per-user cache miss one way and a data breach the
--      other.
--   4. Nothing derived from a document may be written here in plaintext even
--      under a user-scoped key, if the value itself would be readable by
--      guessing the key. Where a value is sensitive, cache it in the owning
--      table instead — `facts` is the resume-extraction cache, which is why
--      store.py's facts cache is not represented here.
--
-- ACCESS: RLS is enabled with no policy for anon/authenticated (0002), so only
-- the service role — the backend, which derives the keys and can be held to the
-- rule above — can read or write it. No browser ever touches this table.
create table if not exists step_cache (
    cache_key      text primary key,   -- sha256 hex; see the rule above for its inputs
    step           text not null,      -- 'jd_extract', 'gap_analysis', 'tailor', …
    output_json    jsonb not null,
    model          text not null default '',
    prompt_version text not null default '',
    hits           int  not null default 0,
    created_at     timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- step_traces — observability
-- --------------------------------------------------------------------------
-- User-scoped, unlike step_cache, because these rows answer "what did MY run
-- cost and why was it slow" and are shown back to the user.
--
-- resume_id is nullable and `on delete set null`: a JD extraction happens
-- before any resume is chosen, and deleting a resume must not erase the
-- billing record of work already paid for.
create table if not exists step_traces (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    resume_id  uuid references resumes (id) on delete set null,
    step       text not null,
    model      text not null default '',
    tokens_in  int  not null default 0,
    tokens_out int  not null default 0,
    ms         int  not null default 0,
    cost_usd   numeric(12, 6) not null default 0,
    ok         boolean not null default true,
    cache_hit  boolean not null default false,
    error      text not null default '',
    created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- storage_gc_queue — the answer to "cascade deletes orphan storage objects"
-- --------------------------------------------------------------------------
-- DECISION. `on delete cascade` from auth.users reaches every row in this
-- schema, but it does NOT reach storage.objects: those are rows in another
-- schema with no FK to documents, and the bytes behind them are in S3. Deleting
-- a user therefore silently leaves their uploaded PDFs on disk forever — a
-- storage bill and, more importantly, a GDPR erasure failure.
--
-- Rather than pretend the database can delete an S3 object, we make the
-- orphan explicit: an AFTER DELETE trigger on `documents` (0005) enqueues the
-- storage_path here, and a scheduled worker running as the service role
-- deletes the object and then the queue row. A queue that is visibly draining
-- is auditable; a cascade that quietly leaks is not.
--
-- Not user-scoped and service-role only: it must survive the deletion of the
-- user whose objects it is about, which is precisely why it has no FK to
-- auth.users.
create table if not exists storage_gc_queue (
    id           bigserial primary key,
    bucket_id    text not null default 'resumes',
    storage_path text not null,
    owner_id     uuid,                       -- plain uuid, no FK: the user may be gone
    enqueued_at  timestamptz not null default now(),
    deleted_at   timestamptz,
    attempts     int not null default 0,
    last_error   text
);

-- 0005_triggers.sql
--
-- Invariants that a constraint cannot express, because they are about the
-- transition rather than the row.
--
-- Everything here is enforced in the database rather than in the API on
-- purpose. There will be more than one writer — the Next.js app through
-- PostgREST, the Python backend as service_role, a future background worker,
-- and psql at 2am during an incident. An invariant that lives in one of those
-- is not an invariant.
--
-- SECURITY DEFINER is used only where a trigger must write to a table the
-- calling user has no grant on (storage_gc_queue). Each such function pins
-- `search_path`, without which a caller could create a shadowing object in a
-- schema earlier on the path and have it executed with the definer's rights.

-- --------------------------------------------------------------------------
-- updated_at maintenance
-- --------------------------------------------------------------------------
-- Written as a generic function keyed off the NEW record so any table that
-- grows an updated_at column can reuse it. Not written with a hardcoded table
-- name, and not left to the client: a client-supplied updated_at is a clock
-- the server does not control, and "sort by most recently edited" then depends
-- on the user's laptop being right about the time.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists resumes_set_updated_at on resumes;
create trigger resumes_set_updated_at
    before update on resumes
    for each row
    execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- resumes.current_version_id follows the newest version
-- --------------------------------------------------------------------------
-- The pointer is a cache of `select id from resume_versions where resume_id =
-- ? order by created_at desc limit 1`. Caches drift, so it is maintained here
-- rather than by whoever happened to write the version.
--
-- Ordering is (created_at desc, id desc). created_at alone is not a total
-- order: two versions inserted in the same statement share now(), and a tie
-- would make "newest" nondeterministic and the pointer flap between reads.
-- id is the deterministic tiebreak.
--
-- DECISION — an INSERT always wins.
--   A new version is the newest by definition, and comparing timestamps to
--   decide would mean a clock skew or a backdated import could leave the
--   pointer on an older row. Imports that must not move the head should insert
--   and then explicitly re-point.
--
-- DECISION — DELETE recomputes rather than nulls.
--   Deleting the current version must leave the pointer on the next-newest
--   surviving version, not on null; a resume with versions but no current
--   version renders as empty. The composite FK's `on delete set null
--   (current_version_id)` fires first and nulls the column; this trigger then
--   fills it back in. Order matters and is guaranteed: referential actions run
--   before AFTER-row triggers on the referencing table complete.
--
-- DECISION — the resume-delete case is a no-op, not an error.
--   Deleting a resume cascades to its versions, and this trigger would then
--   try to update a resume row that is mid-delete. The existence check short-
--   circuits that; without it, deleting a resume raises.
create or replace function public.sync_current_version()
returns trigger
language plpgsql
as $$
declare
    target_resume uuid := coalesce(new.resume_id, old.resume_id);
    newest        uuid;
begin
    if tg_op = 'INSERT' then
        update resumes
           set current_version_id = new.id
         where id = target_resume;
        return new;
    end if;

    -- DELETE. If the parent resume is itself being deleted there is nothing
    -- to point anywhere.
    if not exists (select 1 from resumes where id = target_resume) then
        return old;
    end if;

    select v.id
      into newest
      from resume_versions v
     where v.resume_id = target_resume
     order by v.created_at desc, v.id desc
     limit 1;

    update resumes
       set current_version_id = newest
     where id = target_resume
       and current_version_id is distinct from newest;

    return old;
end;
$$;

drop trigger if exists resume_versions_sync_current on resume_versions;
create trigger resume_versions_sync_current
    after insert or delete on resume_versions
    for each row
    execute function public.sync_current_version();

-- --------------------------------------------------------------------------
-- facts: append-only, enforced per column
-- --------------------------------------------------------------------------
-- 0002 withholds the DELETE policy and allows UPDATE only so that a row can be
-- retired. This trigger is the other half: it says *which column* an update
-- may touch. Both are needed, and for different attackers — the policy stops
-- another tenant, the trigger stops our own backend (running as service_role,
-- which bypasses RLS entirely) from quietly rewriting history.
--
-- valid_to is the only mutable column, and it may only be set, never cleared
-- or moved: un-retiring a fact would resurrect a claim the user withdrew.
--
-- ONE EXEMPTION. The ON DELETE SET NULL actions from 0001/0004 (document_id
-- when an upload is deleted, supersedes when a superseding fact is removed)
-- are updates performed by the constraint, and they still fire row triggers.
-- The guard recognises them by shape: the only change is a protected pointer
-- going to NULL and nothing else moves. No ordinary statement doing anything
-- meaningful has that shape, so allowing it does not open a hole.
create or replace function public.facts_append_only_guard()
returns trigger
language plpgsql
as $$
declare
    only_pointer_nulled boolean;
begin
    if tg_op = 'DELETE' then
        raise exception
            'facts is append-only: supersede % instead of deleting it', old.id
            using errcode = 'restrict_violation';
    end if;

    -- ON DELETE SET NULL from documents/facts: document_id or supersedes goes
    -- to null and nothing else moves.
    only_pointer_nulled :=
        (new.id, new.user_id, new.fact_key, new.text, new.origin,
         new.entities_json, new.evidence_json, new.valid_from,
         new.valid_to, new.created_at)
        is not distinct from
        (old.id, old.user_id, old.fact_key, old.text, old.origin,
         old.entities_json, old.evidence_json, old.valid_from,
         old.valid_to, old.created_at)
        and (
            (new.document_id is null and old.document_id is not null)
            or (new.supersedes is null and old.supersedes is not null)
        )
        and (new.document_id is null or new.document_id = old.document_id)
        and (new.supersedes is null or new.supersedes = old.supersedes);

    if only_pointer_nulled then
        return new;
    end if;

    if (new.id, new.user_id, new.document_id, new.fact_key, new.text, new.origin,
        new.entities_json, new.evidence_json, new.supersedes, new.valid_from,
        new.created_at)
       is distinct from
       (old.id, old.user_id, old.document_id, old.fact_key, old.text, old.origin,
        old.entities_json, old.evidence_json, old.supersedes, old.valid_from,
        old.created_at)
    then
        raise exception
            'facts is append-only: only valid_to may be updated (fact %)', old.id
            using errcode = 'restrict_violation';
    end if;

    if old.valid_to is not null and new.valid_to is distinct from old.valid_to then
        raise exception
            'fact % was already retired at %; it cannot be re-opened or re-dated',
            old.id, old.valid_to
            using errcode = 'restrict_violation';
    end if;

    return new;
end;
$$;

drop trigger if exists facts_append_only on facts;
create trigger facts_append_only
    before update or delete on facts
    for each row
    execute function public.facts_append_only_guard();

-- --------------------------------------------------------------------------
-- facts: inserting a superseding row retires the one it replaces
-- --------------------------------------------------------------------------
-- Doing this in the database means the two writes cannot come apart. If the
-- application did it, a crash between the insert and the update would leave
-- two rows both claiming to be the current E1.B2, and the guard would pick
-- whichever the planner returned first.
create or replace function public.facts_retire_superseded()
returns trigger
language plpgsql
as $$
begin
    if new.supersedes is not null then
        update facts
           set valid_to = new.valid_from
         where id = new.supersedes
           and valid_to is null;
    end if;
    return new;
end;
$$;

drop trigger if exists facts_retire_superseded on facts;
create trigger facts_retire_superseded
    after insert on facts
    for each row
    execute function public.facts_retire_superseded();

-- --------------------------------------------------------------------------
-- patches: a decision is final
-- --------------------------------------------------------------------------
-- DECISION — can a patch be accepted twice? No.
--   Two things make double-application possible without this: a double-clicked
--   Accept button, and a retry after a timeout where the first request
--   actually succeeded. Both replay the same UPDATE. Applying the same ops
--   twice duplicates bullets or, worse, applies an insert op at a path that
--   has shifted.
--
--   The guard is a state machine, not a uniqueness constraint, because the
--   thing to forbid is a transition. 'proposed' is the only state an update
--   may leave; once a patch is accepted, declined or superseded the row is
--   FROZEN and any further UPDATE raises. Frozen rather than "may not change
--   status", because a replayed request usually sends the identical value:
--   `set status = 'accepted'` on an already-accepted patch changes no column,
--   so a transition check would wave it through and the caller would go on to
--   apply the ops a second time.
--
--   THE ACCEPT FLOW THIS IMPLIES, in one transaction:
--     1. insert the resulting resume_version
--     2. update the patch ONCE, setting status='accepted' and
--        applied_version_id together
--   Not the other order. A second update to fill in applied_version_id would
--   hit the freeze, which is the point: there is exactly one write that
--   decides a patch, and a retry of it fails loudly.
create or replace function public.patches_decision_guard()
returns trigger
language plpgsql
as $$
begin
    if old.status <> 'proposed' then
        raise exception
            'patch % was already % at %; a decided patch is immutable',
            old.id, old.status, old.decided_at
            using errcode = 'invalid_parameter_value',
                  hint = 'Create a new patch instead of re-deciding this one.';
    end if;

    -- Stamp the decision time server-side so the CHECK in 0001 is satisfied
    -- without every caller remembering to set it.
    if new.status <> 'proposed' and new.decided_at is null then
        new.decided_at := now();
    end if;

    return new;
end;
$$;

drop trigger if exists patches_decision on patches;
create trigger patches_decision
    before update on patches
    for each row
    execute function public.patches_decision_guard();

-- --------------------------------------------------------------------------
-- documents: enqueue the storage object for deletion
-- --------------------------------------------------------------------------
-- The orphaned-object problem stated in 0001. `on delete cascade` from
-- auth.users removes the document row and nothing in storage; the bytes stay
-- on S3 forever, which is a cost problem and an erasure-request failure.
--
-- SECURITY DEFINER because the queue has no grant to `authenticated` — the
-- user must not be able to read or forge queue entries, but their delete must
-- still be able to create one. search_path is pinned for the usual reason.
create or replace function public.enqueue_storage_gc()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if old.storage_path is not null and old.storage_path <> '' then
        insert into public.storage_gc_queue (bucket_id, storage_path, owner_id)
        values ('resumes', old.storage_path, old.user_id);
    end if;
    return old;
end;
$$;

revoke all on function public.enqueue_storage_gc() from public;

drop trigger if exists documents_enqueue_storage_gc on documents;
create trigger documents_enqueue_storage_gc
    after delete on documents
    for each row
    execute function public.enqueue_storage_gc();

-- --------------------------------------------------------------------------
-- step_cache: count hits without a round trip
-- --------------------------------------------------------------------------
-- Not a trigger — a trigger cannot observe a SELECT. This is the read path the
-- backend should call instead of a bare select, so `hits` is a real number
-- rather than one nobody remembered to increment. Returns null on a miss.
--
-- Note what it does NOT do: derive the key. Key derivation is where the
-- cross-tenant rule in 0001 lives, and it stays in application code where it
-- can be unit-tested against a list of known-PII step names.
create or replace function public.step_cache_get(p_cache_key text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.step_cache
       set hits = hits + 1
     where cache_key = p_cache_key
    returning output_json;
$$;

revoke all on function public.step_cache_get(text) from public;
grant execute on function public.step_cache_get(text) to service_role;

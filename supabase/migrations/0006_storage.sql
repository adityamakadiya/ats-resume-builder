-- 0006_storage.sql
--
-- The private `resumes` bucket and its access rules.
--
-- THE PATH CONVENTION IS THE SECURITY MODEL
--   Every object is stored as `<uid>/<document_id>.<ext>` — the owner's uid is
--   the first path segment, and the policies below compare that segment to
--   `(select auth.uid())`. There is no separate ownership table to keep in
--   sync, and no way to write an object outside your own folder: the INSERT
--   policy checks the path you are writing to, not the row you claim to own.
--
--   `storage.objects.owner` is deliberately NOT used as the check. It records
--   whoever uploaded the object, which is the right value in normal flows but
--   is null for service-role uploads and does not constrain the *path*. Two
--   users could then both write `shared/cv.pdf` and overwrite each other.
--   Keying on the path makes collisions impossible by construction.
--
-- PRIVATE, NOT PUBLIC
--   `public = false`. A public bucket serves every object to anyone who knows
--   or guesses the URL, with no policy evaluation at all. Resumes contain a
--   full name, an email, a phone number and an employment history; a leaked
--   URL is a leaked identity document. Clients get time-limited signed URLs
--   instead.

-- --------------------------------------------------------------------------
-- The bucket
-- --------------------------------------------------------------------------
-- Idempotent: `supabase db reset` re-runs every migration against a database
-- where storage.buckets may already hold the row.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'resumes',
    'resumes',
    false,
    10485760,  -- 10 MB. A resume that does not fit in 10 MB is a scanned image
               -- of a resume, which the text extractor cannot read anyway, so
               -- rejecting it at upload gives a better error than failing later.
    array[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'text/plain'
    ]
)
on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

-- --------------------------------------------------------------------------
-- Object policies
-- --------------------------------------------------------------------------
-- storage.objects already has RLS enabled by Supabase; we only add policies.
-- As in 0002: one policy per operation, `(select auth.uid())` rather than the
-- bare call, and every policy scoped to `bucket_id = 'resumes'` so it cannot
-- accidentally govern some future bucket.
--
-- `storage.foldername(name)` splits the object path and returns the directory
-- segments as a text[]; element 1 is the top-level folder, which by convention
-- above is the owner's uid.

drop policy if exists "resumes read own" on storage.objects;
create policy "resumes read own" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'resumes'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

drop policy if exists "resumes upload own" on storage.objects;
create policy "resumes upload own" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'resumes'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

-- Both clauses matter. `using` stops you targeting somebody else's object;
-- `with check` stops you *moving* your own object into their folder, which a
-- rename is: storage implements move as an UPDATE of `name`.
drop policy if exists "resumes update own" on storage.objects;
create policy "resumes update own" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'resumes'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    )
    with check (
        bucket_id = 'resumes'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

drop policy if exists "resumes delete own" on storage.objects;
create policy "resumes delete own" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'resumes'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

-- --------------------------------------------------------------------------
-- What still is not automatic
-- --------------------------------------------------------------------------
-- Deleting a `documents` row does NOT delete its object: they are different
-- subsystems and Postgres cannot reach S3. `enqueue_storage_gc` (0005) pushes
-- the path onto storage_gc_queue and a service-role worker drains it with:
--
--     select id, bucket_id, storage_path
--       from storage_gc_queue
--      where deleted_at is null
--      order by enqueued_at
--      limit 100
--        for update skip locked;
--     -- supabase.storage.from(bucket).remove([storage_path])
--     update storage_gc_queue set deleted_at = now() where id = any($1);
--
-- The same worker handles account deletion, because the cascade from
-- auth.users empties `documents` and therefore fires the same trigger for
-- every one of that user's uploads. The queue is the only place that record
-- survives the user, which is why it holds a plain uuid rather than an FK.

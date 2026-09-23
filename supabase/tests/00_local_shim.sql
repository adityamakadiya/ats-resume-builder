-- 00_local_shim.sql
--
-- NOT A MIGRATION. Do not run this against Supabase — it is only for running
-- the migrations and the tests on a bare local Postgres (no Docker, no
-- Supabase CLI), which is how this schema was validated on a machine without
-- a container runtime.
--
-- It creates the smallest possible stand-ins for the pieces of a Supabase
-- database the migrations depend on:
--   * the roles anon / authenticated / service_role
--   * schema auth, with auth.users and auth.uid()
--   * schema storage, with buckets, objects and storage.foldername()
--
-- The real objects have many more columns and a great deal more behaviour.
-- What matters is that the columns and functions the migrations touch behave
-- the same way, so that a migration which applies here applies there.
--
-- Usage:
--   psql "$DB" -f supabase/tests/00_local_shim.sql
--   psql "$DB" -f supabase/migrations/0001_core_tables.sql   (…and the rest)

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        -- BYPASSRLS mirrors Supabase: the service role is outside the tenant
        -- boundary by design, which is what makes step_cache reachable at all.
        create role service_role nologin noinherit bypassrls;
    end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;
grant usage on schema auth, storage to anon, authenticated, service_role;

create table if not exists auth.users (
    instance_id        uuid,
    id                 uuid primary key,
    aud                text,
    role               text,
    email              text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_app_meta_data  jsonb default '{}'::jsonb,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at         timestamptz default now(),
    updated_at         timestamptz default now()
);

create table if not exists auth.identities (
    id              text,
    user_id         uuid references auth.users (id) on delete cascade,
    identity_data   jsonb,
    provider        text,
    provider_id     text,
    last_sign_in_at timestamptz,
    created_at      timestamptz default now(),
    updated_at      timestamptz default now(),
    primary key (provider, provider_id)
);

-- The real auth.uid() reads the `sub` claim out of request.jwt.claims, which
-- PostgREST sets per request. Both spellings are accepted here because
-- different Supabase versions set different GUCs, and the tests set the
-- simpler one.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
    )::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

create table if not exists storage.buckets (
    id                 text primary key,
    name               text not null,
    public             boolean not null default false,
    file_size_limit    bigint,
    allowed_mime_types text[],
    created_at         timestamptz default now()
);

create table if not exists storage.objects (
    id         uuid primary key default gen_random_uuid(),
    bucket_id  text references storage.buckets (id),
    name       text,
    owner      uuid,
    metadata   jsonb,
    created_at timestamptz default now()
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;

-- Returns the directory segments of an object path. The real implementation
-- drops the final element (the filename); 'uid/file.pdf' -> {'uid'}.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
    parts text[];
begin
    parts := string_to_array(name, '/');
    return parts[1:array_length(parts, 1) - 1];
end;
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;

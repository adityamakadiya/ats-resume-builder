# Database

The Postgres foundation for the resume-tailoring platform: schema, row-level
security, indexes, triggers, storage rules, a deterministic seed and the tests
that prove tenants stay separated.

This replaces `backend/src/atsresume/store.py`, which was a single-user SQLite
file with three tables. Nothing here reads that file; the two ideas worth
keeping from it — content fingerprinting and the extraction cache — are carried
forward and explained in `migrations/0001_core_tables.sql`.

```
supabase/
  migrations/
    0001_core_tables.sql      tables, columns, checks, the decisions behind them
    0002_rls.sql              grants, RLS, one policy per operation per table
    0003_indexes.sql          including the partial indexes that pay
    0004_tenant_integrity.sql composite FKs: no cross-tenant references
    0005_triggers.sql         updated_at, current_version_id, append-only facts,
                              patch decisions, storage GC queue
    0006_storage.sql          the private `resumes` bucket and its path rules
  seed.sql                    one user, one resume, one job, one version
  tests/
    rls_test.sql              multi-tenant isolation — the important one
    invariants_test.sql       the non-RLS guarantees
    00_local_shim.sql         stand-ins for auth/storage on a bare Postgres
    run_local.sh              apply everything and run both suites
```

Every migration is idempotent and safe to re-run.

---

## Running it

### With the Supabase CLI (the normal path)

Requires Docker. From the repository root:

```bash
supabase init          # only if supabase/config.toml does not exist yet
supabase start         # boots Postgres, GoTrue, Storage, PostgREST, Studio
supabase db reset      # drops, re-applies every migration, then runs seed.sql
```

`supabase db reset` is the command you will use most: it is the only way to be
sure the migrations apply cleanly from nothing, which is what will happen on
the production project.

```bash
supabase migration new add_something   # creates the next numbered file
supabase db diff -f add_something      # or: generate one from Studio changes
supabase db push                       # apply pending migrations to the linked
                                       # remote project (supabase link first)
```

Run the tests:

```bash
supabase test db                                        # if pgTAP is installed
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
     -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql   # always works
```

### Without Docker (bare Postgres)

The tests do not depend on any extension, so they run against an ordinary
Postgres 15+ once the Supabase-specific objects are stubbed out:

```bash
createdb ats_dev
DATABASE_URL=postgres:///ats_dev ./supabase/tests/run_local.sh
```

`tests/00_local_shim.sql` creates minimal `auth.users`, `auth.uid()`,
`storage.buckets`, `storage.objects`, `storage.foldername()` and the three
Supabase roles. It is **not** a migration and must never be applied to a real
Supabase project. It is enough to make the migrations apply and the policies
evaluate, but it is a stub: the real GoTrue and Storage services do more, so a
green run here is a strong signal, not a substitute for `supabase db reset`.

### Resetting

| what you want | command |
| --- | --- |
| Wipe and rebuild local, with seed | `supabase db reset` |
| Wipe and rebuild without the seed | `supabase db reset --no-seed` |
| Start over completely | `supabase stop --no-backup && supabase start` |
| Bare Postgres | `dropdb ats_dev && createdb ats_dev && ./supabase/tests/run_local.sh` |

There is no reset for production. A migration that reaches a live project runs
against real user data, which is why the comments in these files argue for
their decisions instead of just stating them.

---

## Tenant isolation, in plain language

**Every row belongs to exactly one person, and the database — not the API —
is what enforces it.**

Each table carries a `user_id` column holding the id of the person who owns the
row. Postgres row-level security then attaches a rule to every table saying,
in effect: *you may only see, change or delete rows whose `user_id` equals your
own*. Your id comes from the signed JWT your browser sends, which the database
reads as `auth.uid()`. It is not something the client can set.

The practical consequence: a query that forgets its `where user_id = …` clause
still returns only your rows. A bug in a filter, a hand-written query in a new
endpoint, a `select *` in a debugging session — none of them can cross the
boundary, because the boundary is below all of them.

Four details make this actually hold rather than nearly hold:

1. **One rule per operation.** Reading, creating, updating and deleting each
   get their own policy. Loosening one — for a share link, say — cannot widen
   the others by accident.

2. **Update rules check the row twice**, before and after. Without the second
   check you could take a row you own and rewrite its `user_id` to somebody
   else's, handing them your data or planting content in their account.

3. **References are tenant-checked too.** RLS looks at the row you are writing,
   not at what it points at, so on its own it would let you attach a new
   version to *someone else's* resume: your row, their parent. Every
   parent/child link therefore uses a composite foreign key that includes
   `user_id` on both sides, so pointing at another tenant's row fails at the
   database level. This is the write-side leak most RLS setups miss, and
   `0004_tenant_integrity.sql` exists entirely to close it.

4. **File storage follows the same rule.** Uploads live in a private bucket
   under `<your-user-id>/<document-id>.pdf`, and the storage policies compare
   that first path segment to your id. You cannot read, overwrite, or rename a
   file into anyone else's folder. Nothing in the bucket is publicly
   addressable; clients get short-lived signed URLs.

Two tables are deliberately outside this model — `step_cache` and
`storage_gc_queue`. Both have RLS switched on with no policies at all and no
permissions granted to logged-in users, which means neither is reachable from a
browser under any circumstances. Only the backend's service role, which runs
outside the tenant boundary by design, can touch them.

`tests/rls_test.sql` is the proof. It creates two users, has one of them write
into every table, and then asserts the other sees nothing, changes nothing,
deletes nothing and cannot attach anything to the first user's data. If that
file passes, multi-tenancy holds. Run it in CI.

---

## The step_cache privacy rule

`step_cache` is the one table shared across all users, so it needs a rule that
is understood before anybody adds a caller.

**Why it is shared.** Pipeline steps are pure functions: the same input always
produces the same output. Pulling a `JobSpec` out of a job advertisement costs
a model call and several seconds, and two candidates applying to the same
opening paste the same text. The cache is keyed by a hash of the *input*, so
the second candidate's extraction is a lookup instead of a call. Keying it per
user would throw that away for nothing, since the answer does not depend on who
asked.

**Why that is dangerous.** A content-addressed cache is a read oracle: anyone
who can compute a key can read what is stored under it. If a key were derived
from resume text, then a hit would hand one person a result computed from
another person's private document, and the hit itself would reveal that
somebody else holds that exact text. No amount of row-level security fixes
that, because the leak is in the *key*, not in the row.

**The rule.**

- Only **non-PII** inputs may be cached under a global key: job description
  text, prompt text, model identifiers, static taxonomies. A job ad is
  published by an employer; it is not the candidate's personal data.
- Any step whose input touches **resume-derived material** — extracted text,
  `ResumeFacts`, a tailored document, chat content, anything the user wrote
  about themselves — **must include `user_id` in the hashed key**:

  ```
  cache_key = sha256(step | prompt_version | model | user_id | input)
  ```

  The entry is then content-addressed within one tenant and a cross-tenant hit
  is arithmetically impossible.
- If you are unsure which category a new step falls into, it is the second one.
  Guessing wrong costs a cache miss one way and a data breach the other.
- Sensitive derived data that would be readable by guessing a key does not
  belong in this table at all. Cache it in the owning table instead — `facts`
  *is* the resume-extraction cache, which is why the old SQLite facts cache has
  no equivalent here.

Key derivation therefore lives in one application-side helper, with a list of
which steps are PII-bearing, and that helper is unit-tested. It is not
something each call site decides for itself. `prompt_version` and `model` are
part of the key for the same reason `store.py` mixed the extraction contract
into its fingerprint: change the prompt and every old entry must miss rather
than serve a stale shape.

---

## Decisions worth knowing before you change something

Each of these is argued at length in a comment at the relevant place in the
SQL. The short versions:

- **`facts` is append-only.** Tailored lines cite facts by id, and the truth
  guard verifies those citations. A fact that can be edited or deleted breaks
  verification retroactively. Corrections are new rows with `supersedes` set;
  a trigger closes the old row's `valid_to` and rejects anything else.
- **`origin` shipped before attestation did.** Provenance cannot be
  backfilled. Once rows exist without it, telling an extracted fact from a
  user-asserted one is guesswork, which is exactly what the truth guard exists
  to prevent.
- **Deleting a document does not delete its facts.** The upload is a file; the
  facts are claims the user made and resumes already cite them. The document
  pointer nulls out and `evidence_json` keeps the row self-describing.
  Real erasure is a separate, louder operation.
- **`resumes.current_version_id` cannot dangle.** A composite foreign key stops
  it pointing at another resume's version, `on delete set null` stops a version
  delete from erroring, and a trigger re-points it at the newest survivor.
- **A patch decision is final.** Once accepted or declined the row freezes, so
  a double-clicked Accept or a retried request fails loudly instead of applying
  the same edit twice. Accepting is one UPDATE that sets `status` and
  `applied_version_id` together, after the new version has been inserted.
- **Cascade deletes cannot reach S3.** Deleting a user removes every row they
  own but leaves their uploaded files in the bucket. A trigger pushes each
  path onto `storage_gc_queue` and a service-role worker drains it, so the
  orphan is visible and auditable rather than silent.
- **Policies use `(select auth.uid())`, never bare `auth.uid()`.** The subquery
  form is evaluated once per statement instead of once per row. `rls_test.sql`
  fails the build if a policy is written the slow way.

#!/usr/bin/env bash
# Run the whole database suite against a plain Postgres — no Docker, no
# Supabase CLI. This is the fallback path described in ../README.md; if you
# have Docker, `supabase db reset && supabase test db` is the real thing and
# exercises the actual auth and storage schemas rather than the shim.
#
#   ./supabase/tests/run_local.sh                    # uses $DATABASE_URL
#   DATABASE_URL=postgres://… ./supabase/tests/run_local.sh
#
# It applies the shim, every migration in order, the seed, and both test
# files. Any failure aborts with a non-zero exit code, so it works as a CI
# step unchanged.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
: "${DATABASE_URL:?set DATABASE_URL to a Postgres you do not mind rewriting}"

run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }

echo "--> shim (auth, storage, roles)"
run "$here/00_local_shim.sql"

for migration in "$root"/migrations/*.sql; do
    echo "--> $(basename "$migration")"
    run "$migration"
done

echo "--> seed"
run "$root/seed.sql"

echo "--> rls_test.sql"
run "$here/rls_test.sql"

echo "--> invariants_test.sql"
run "$here/invariants_test.sql"

echo "all green"

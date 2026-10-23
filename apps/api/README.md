# BrandGuard API — Sanath phase S1

Implemented: identity/tenant schema, versioned migration, Argon2 credentials, eight-hour opaque hashed sessions, origin + CSRF mutation checks, persistent login throttling, manager-only brand creation and tenant-scoped brand reads. Each identity currently has one role per workspace. Review/source/job schema belongs to S2; no approval or AI functionality is implemented yet.

## Local setup (from repository root)

Use Python 3.14 and a dedicated UTF-8 PostgreSQL database. Do not point tests at real data.

```bash
python3 -m venv .venv
.venv/bin/pip install -r apps/api/requirements.lock
export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@localhost:5432/brandguard'
export PUBLIC_ORIGIN='http://localhost:8000'
export APP_ENV=development
.venv/bin/alembic -c apps/api/alembic.ini upgrade head
export PYTHONPATH=apps/api
# Supply a private password of at least 16 characters through your shell environment.
# Set SEED_PASSWORD without committing it or placing it in shell history.
.venv/bin/python -m brandguard.seed
.venv/bin/uvicorn brandguard.main:create_app --factory --host 127.0.0.1
```

Seed creates four synthetic identities (`creator`, `manager`, `reviewer`, `admin` at `lumadesk.test`) and prints the workspace ID. It refuses to overwrite existing identities. Supply email, password and that `org_id` to `POST /api/v1/sessions`; browser requests must carry the exact `Origin`. Store returned `csrf_token` in memory and send `X-CSRF-Token` on mutations. Session cookies are HTTP-only, same-site strict and secure outside development. No bearer token or frontend-selected role is accepted. Production requires HTTPS. Keep API and web same-origin behind the future proxy.

Frontend contract: `contracts/openapi.json`. Currently published endpoints cover sessions, `/me`, brands and health only. Health readiness validates the S1 migration and explicitly excludes a worker. No migrations run implicitly at server startup.

```bash
# Create a separate UTF-8 database named brandguard_s1_test and migrate it first.
export TEST_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@localhost:5432/brandguard_s1_test'
DATABASE_URL="$TEST_DATABASE_URL" .venv/bin/alembic -c apps/api/alembic.ini upgrade head
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests -q
```

Tests erase identity/brand rows only in the dedicated test database. They cover the S1 portion of T01/T22; neither complete test-register case is satisfied across future content APIs yet. Access control is enforced in API queries, not PostgreSQL RLS; every future object route must use the same tenant-scoping pattern. Login throttling is by direct client IP; proxy-aware trusted client identification must be configured during deployment. Expired session/throttle cleanup and full audit logging remain follow-up work. No public account provisioning or demo-session endpoint exists in S1.

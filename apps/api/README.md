# BrandGuard API — Sanath phases S1–S5

Implemented: identity/tenant schema, versioned migration, Argon2 credentials, eight-hour opaque hashed sessions, origin + CSRF mutation checks, persistent login throttling, manager-only brand creation and tenant-scoped brand reads. Each identity currently has one role per workspace. S2 adds versioned sources, verified activation, immutable revisions and atomic review-run/job enqueue. See [S2 handoff](../../docs/S2_HANDOFF.md) for the API sequence and worker boundary. S3 adds workspace policy, creator consent, a Nebius adapter and durable runner. See [S3 handoff](../../docs/S3_HANDOFF.md). S4 adds comments, exceptions, explicit manual checks, guarded approval and approved export; see [S4 handoff](../../docs/S4_HANDOFF.md). S5 connects the real text engine and adds scoped queues/insights; see [integration status](../../docs/S5_HANDOFF.md). Full browser/deployment and file-intake work remain pending.

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

Frontend contract: `contracts/openapi.json`. Published endpoints cover sessions, `/me`, brands, source curation, content revisions, review runs/findings, processing policy, comments/resolutions, human checks, submission, decisions, export, queues, insights and health. Health readiness validates the S4 migration and explicitly excludes a worker. No migrations run implicitly at server startup.

```bash
# Create a separate UTF-8 database named brandguard_s1_test and migrate it first.
export TEST_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@localhost:5432/brandguard_s1_test'
DATABASE_URL="$TEST_DATABASE_URL" .venv/bin/alembic -c apps/api/alembic.ini upgrade head
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests -q
```

Database tests erase S1–S3 test records only in the dedicated test database. They exercise the implemented parts of tenant isolation, request security, source/revision integrity and semantic review; full release-register cases remain open until workflow/deployment integration. Access control is enforced in API queries, not PostgreSQL RLS; every future object route must use the same tenant-scoping pattern. Login throttling is by direct client IP; proxy-aware trusted client identification must be configured during deployment. Expired session/throttle cleanup and full audit logging remain follow-up work. No public account provisioning or demo-session endpoint exists in S1.

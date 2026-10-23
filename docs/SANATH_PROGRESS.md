# Sanath implementation progress

## S1 — identity and tenant foundation

Implemented 23 October 2026 with Codex assistance: FastAPI application factory, SQLAlchemy identity/tenant records, explicit Alembic migration, Argon2 passwords, hashed opaque sessions, secure cookie policy, server-derived workspace/role, origin/CSRF checks, database-backed login throttling, scoped brand access and manager-only brand creation. Dependencies are pinned in `apps/api/requirements.lock`. API setup and limitations are in `apps/api/README.md`; the current OpenAPI surface is in `contracts/openapi.json`.

Validation: migration applied to a fresh UTF-8 PostgreSQL 18 database; eight pytest integration cases passed. Covered wrong-tenant reads, caller-supplied tenant override, denied creator/reviewer/admin mutation, session token hashing, CSRF and hostile origin, logout/replay, expiry, cookie flags, failed login/rate limiting, wrong-workspace login, validation redaction and schema readiness. Starlette emits one upstream test-client deprecation warning for httpx; tests pass. GitHub CI has been configured but has not run remotely.

Scope boundary: source/revision/job schema, content permissions, audit records, approval, model adapter, retention and deployed service are not implemented by this phase. S1 tests partially exercise T01 and T22; the release-evidence template remains unpassed. Current role model is one role per user per workspace, sufficient for the four separate pilot identities; future multi-role support must preserve self-approval denial.

## Next — S2

Add immutable SourceVersion and ContentRevision records, tenant-constrained foreign keys, manager-only verified source activation, source epochs, persistent ReviewRun/Job creation in one transaction and scoped content APIs. Preserve the existing auth dependencies; refactor them into reusable modules before expanding routes. Coordinate engine request/result fixtures with Surya and publish the expanded OpenAPI contract for Darshilkumar.

## Later

S3: grounded semantic adapter and orchestration. S4: guarded decisions, export and audit. S5: integration/security regression. S6: architecture and submission evidence. Follow the assigned sequence in the implementation plan; estimates are not a record of actual time spent.

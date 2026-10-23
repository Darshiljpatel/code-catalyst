# Sanath implementation progress

## S1 — identity and tenant foundation

Implemented 23 October 2026 with Codex assistance: FastAPI application factory, SQLAlchemy identity/tenant records, explicit Alembic migration, Argon2 passwords, hashed opaque sessions, secure cookie policy, server-derived workspace/role, origin/CSRF checks, database-backed login throttling, scoped brand access and manager-only brand creation. Dependencies are pinned in `apps/api/requirements.lock`. API setup and limitations are in `apps/api/README.md`; the current OpenAPI surface is in `contracts/openapi.json`.

Validation: migration applied to a fresh UTF-8 PostgreSQL 18 database; eight pytest integration cases passed. Covered wrong-tenant reads, caller-supplied tenant override, denied creator/reviewer/admin mutation, session token hashing, CSRF and hostile origin, logout/replay, expiry, cookie flags, failed login/rate limiting, wrong-workspace login, validation redaction and schema readiness. Starlette emits one upstream test-client deprecation warning for httpx; tests pass. GitHub CI has been configured but has not run remotely.

Scope boundary: source/revision/job schema, content permissions, audit records, approval, model adapter, retention and deployed service are not implemented by this phase. S1 tests partially exercise T01 and T22; the release-evidence template remains unpassed. Current role model is one role per user per workspace, sufficient for the four separate pilot identities; future multi-role support must preserve self-approval denial.

## S2 — sources, revisions and persistent enqueue

Implemented 23 October 2026 with Codex assistance. Shared authentication dependencies are now reusable across routers. Added tenant-constrained SourceVersion, ContentItem, ContentRevision, ReviewRun, RunSource, Job and AuditEvent records through migration `0002_review_foundation`. Source payloads and revision/run evidence are immutable under PostgreSQL UPDATE triggers; tenant-constrained foreign keys protect associations. Sources carry literal evidence quotes and validity windows; manager activation verifies the expected epoch, rejects conflicting facts and records explicit source retirement and rationale.

Creator-owned content supports separate assigned reviewers and immutable, LF-normalised, SHA-256-hashed revisions. Parent-revision checks and row locks reject stale/competing saves. Analysis submission snapshots active/effective sources, inserts the run, source links, queue job and audit record atomically, and returns a visibly queued result. Idempotency keys prevent duplicate jobs; another key for an already pending revision is rejected. Snapshot staleness includes changed source epochs, newer revisions and expired supporting sources.

Validation: 23 database integration tests passed on PostgreSQL 18; one additional published-OpenAPI drift test passed (24 total). Tests include injected job-insert rollback, concurrent duplicate submissions, competing source activations and revision saves, source conflict/expiry, tenant foreign-key violations and attempted immutable evidence updates. Alembic reports no schema drift. The S2 migration was exercised through downgrade/re-upgrade on the disposable test database. The existing httpx/Starlette test-client deprecation warning remains. No remote CI or deployed service is claimed.

Handoff: `docs/S2_HANDOFF.md` and expanded `contracts/openapi.json`. The worker claim/retry/recovery loop, extraction, findings, approval, comments, retention and source document import remain unimplemented. Persistent enqueue alone does not satisfy the full worker-reliability case T14, and release evidence remains pending.

Nebius Token Factory is now identified from the team's example and official provider docs. Non-secret endpoint/model placeholders are in `.env.example`; no credential was written to project files or used for a live request. A replacement key must be supplied through the environment for S3.

## Next — S3

Implement the evidence-grounded Nebius adapter and orchestration, validating model JSON, supplied-source citations, literal evidence and content locations. Default external processing to disabled until configured policy/disclosure is in place. Integrate deterministic checks through Surya's agreed interface; use explicit unavailable/incomplete status while those modules are absent. Record request/returned model ID, prompt version, usage, latency and failure reason without logging content or credentials.

## Later

S4: guarded decisions, export and audit. S5: integration/security regression. S6: architecture and submission evidence. Follow the assigned sequence in the implementation plan; estimates are not a record of actual time spent.

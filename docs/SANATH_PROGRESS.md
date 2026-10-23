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

## S3 — grounded Nebius review and orchestration

Implemented 23 October 2026 with Codex assistance. Added the bounded async Nebius adapter, strict response schema, literal source/rule validation, deterministic unique-quote location mapping, advisory tone enforcement, numeric-edit guard and safe provider telemetry. Missing/invalid/truncated responses fail visibly. External processing requires current admin policy plus revision-specific creator consent; old S2 jobs remain opted out. Daily external-submission reservations are tenant-scoped and serialised.

Migration `0003_semantic` adds processing policies, findings, immutable processing snapshots and result metadata. The runner claims jobs with leases/attempt limits and guards result persistence against expired or superseded leases. It preserves valid deterministic findings on semantic failure and does not overwrite a newer draft's state. The async deterministic checker remains injectable; absent real modules, the runtime reports incomplete coverage rather than using fixture results.

Provider smoke: first request rejected invalid model offsets; quote-based location mapping then produced one validated synthetic trial-duration finding in about 3.7 seconds (727 prompt/202 completion tokens). This is a connection check, not measured accuracy. Validation: 63 backend tests passed, including the PostgreSQL orchestration/security cases and OpenAPI drift check; eight existing extraction/scaffolding tests and six planning-verifier tests also passed. Alembic reports no schema drift, and the S3 migration was exercised through downgrade/re-upgrade in the disposable database. The upstream httpx test-client deprecation warning remains. Tests and remaining integration boundaries are detailed in `docs/S3_HANDOFF.md`. Credentials remain outside tracked files. No deployment or complete evaluation is claimed.

## S4 — human review and approved export

Implemented 23 October 2026 with Codex assistance. Migration `0004_workflow` adds immutable comments, reasoned finding-resolution records, per-category manual-check attestations and decisions. Content exposes a workflow version and stale-approval indicator. Added reviewer discovery/assignment, creator submission, separate assigned-reviewer decisions and approved JSON export with exact canonical content/hash and frozen evidence. Source epoch and effective-source checks are repeated on approval/export under locks; edits create a fresh draft and do not inherit approval.

Exceptions cannot bypass failed checks and do not establish claim truth. Human-completed checks retain their reviewer/evidence/rationale separately from the original automated statuses and are disclosed in export. Generic finding display state is insufficient to authorise a blocker waiver: the server requires an actual authorised resolution event. Approval, evidence record, workflow state and audit commit together.

Validation: the full 81-test backend regression passed on PostgreSQL 18, followed by a separately added approval/audit rollback test (82 backend cases validated in total). The S4-specific coverage is 19 cases, including competing decisions, stale sources/expiry, source-activation races, wrong roles/tenants, exact-export hashes, manual-vs-automated disclosure and edits after approval. Eighteen existing engine/scaffolding tests and six planning-verifier tests also passed. Alembic reports no schema drift; the S4 migration was exercised through downgrade/re-upgrade in the disposable database. The existing upstream httpx test-client deprecation warning remains. No live inference was needed for this phase. See `docs/S4_HANDOFF.md` for API integration and limits.

## Next — S5

Integrate Surya's actual deterministic checks/extraction through the runner, coordinate browser review screens with Darshilkumar, and run cross-component security/reliability and end-to-end tests. Complete governance insights, retention/deletion and operational gaps within the owning workstreams before calling the product complete. Approval endpoints are implemented, but an automated production-quality review is not claimed while the runner lacks the real deterministic engine.

## Later

S6: final architecture, actual contribution/disclosure records and submission evidence. Deployment and the complete evaluation remain team deliverables. Follow the assigned sequence in the implementation plan; estimates are not a record of actual time spent.

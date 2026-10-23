# Integration contracts — freeze before parallel implementation

This is the normative design for the initial implementation, not an existing API. Sanath publishes OpenAPI and Darshilkumar's matching fixtures at the first checkpoint. Changes require producer and consumer review.

## Data and engine boundaries

Every tenant-owned row carries `org_id`; object lookups scope to the authenticated membership. IDs are UUIDs, timestamps UTC ISO 8601, byte hashes SHA-256. Tenant IDs in request bodies are never authority. All relation joins enforce same-organisation ownership. Keep DB and private file storage off the public network.

Core records: Organisation, Membership, Brand, SourceVersion, Rule, ApprovedFact, Asset, ContentItem, ContentRevision, ReviewRun, Finding, Comment, Decision, Exception, AuditEvent and Job. SourceVersion stores owner, version, text hash, validity interval, activation state and source locator. ContentRevision stores author, parent revision, canonical extracted-text hash, original-file reference, channel, audience and purpose. ReviewRun binds one revision to immutable source IDs, check statuses and engine/model/prompt versions. Decisions and exceptions bind that same revision/run. Never overwrite source text or analysed content.

Surya's extraction interface: `extract(input_bytes, detected_type, limits) -> ExtractionResult`. Result contains canonical text blocks with IDs, page/paragraph locations, image metadata, warnings and per-capability status. No database or model access. Normalise line endings once; preserve original plus canonical hashes. Use Unicode code-point offsets [start,end), never JavaScript UTF-16 offsets; client converts using code-point arrays. Empty/scanned PDF is unreadable unless OCR actually ran. DOCX page numbers are not invented; use paragraph indexes. OCR spans include bounding boxes and confidence, with unverified text clearly labelled.

Deterministic interface: `check(extraction, context, source_snapshot) -> CheckResult[]`. Orchestrator calls extraction, deterministic and semantic modules, validates results, then persists atomically. Every expected check has status `complete | unavailable | failed | needs_manual_review | not_applicable` and a reason. `not_applicable` requires a documented scope rule, not an error. A check can produce zero findings only with an explicit status.

Finding fields: `id, org_id, revision_id, run_id, category, severity, evidence_status, origin, location, rule_id, source_version_id, evidence_quote, rationale, suggested_edit, resolution`. Categories: `terminology, tone, messaging, facts_claims, visual, accessibility`. Severity: `blocker, warning, advisory`. Evidence status: `supported_violation, contradicted, unsupported, conflicting, manual`. Origin: `deterministic, model, human`. Location identifies canonical text block and offsets or image bounding box/field name. Suggested edit is nullable and never applied by analysis.

Missing claim evidence can cite the approved policy requiring substantiation; it cannot cite a nonexistent supporting fact. Expired sources cannot prove a claim false. Conflicting active sources create a source-owner task, not a guessed winner. Validate quoted text, source eligibility, source ID, location and replacement length before accepting model output. Invalid model output marks that check failed and preserves valid deterministic results.

## HTTP surface

All routes under `/api/v1`; authenticated, same-origin, secure HTTP-only session cookies, CSRF protection for mutations, session expiry and rate limits. Passwords use a maintained password-hashing library. Public demo creation issues a fresh expiring sandbox with synthetic data, size/rate quotas and distinct creator/reviewer accounts. Role simulation is disclosed as demo-only. Production permissions are not a frontend dropdown.

| Route | Request / result |
|---|---|
| `POST /sessions`, `DELETE /sessions/current`, `GET /me` | Login/logout and server-derived memberships/permissions |
| `POST /demo-sessions` | Isolated synthetic workspace, short-lived credentials, processing policy |
| `GET/POST /brands/{brand_id}/sources` | List/import draft sources; manager verifies extraction |
| `POST /sources/{id}/activate` | Expected version and resolved-conflict declaration; immutable snapshot |
| `POST /assets` | Private multipart original plus brand; validated metadata/hash |
| `POST /content` | Brand, context and text or uploaded file; returns item + draft revision |
| `GET /content/{id}` | Authorised revisions, findings, comments and current state |
| `POST /content/{id}/revisions` | Parent revision ID and new content; new immutable revision or 409 |
| `POST /revisions/{id}/analysis` | Idempotency key; 202 with run ID and snapshotted source epoch |
| `GET /runs/{id}` | Check statuses, findings, progress and incomplete reason |
| `POST /findings/{id}/resolutions` | Creator proposes dismissal/exception; reviewer confirms with rationale |
| `POST /revisions/{id}/comments` | Text and optional finding; actor/time attached server-side |
| `POST /revisions/{id}/submit` | Expected run + assigned reviewer; 409 for stale/blocked/incomplete |
| `POST /revisions/{id}/decisions` | Approve/request changes; expected item version, run, source epoch and rationale |
| `GET /revisions/{id}/export` | Approved current revision + decision/source record, else 409/403 |
| `GET /brands/{id}/insights` | Confirmed/dismissed/ambiguous totals and reviewed-item denominators |
| `DELETE /content/{id}` | Authorised purge request with documented retention status |
| `GET /health/live`, `GET /health/ready` | Liveness; DB/worker readiness without exposing secrets |

Errors: `{code, message, request_id, details}`; 401 unauthenticated, 403 forbidden action, 404 inaccessible/absent object, 409 stale/conflict, 413 too large, 415 unsupported type, 422 invalid fields, 429 rate limit. Do not leak another tenant's titles or source snippets in errors.

## Authorisation and approval invariants

| Role | Rights |
|---|---|
| Creator | Own/assigned content and sources permitted for that brand; revision edits, comments, submit, exception request |
| Manager | Curate/activate sources and assets, assign reviewers, inspect tenant insights; no implicit approval privilege |
| Reviewer | Assigned reviews; evidence, comments, changes requested, reasoned finding decisions/exception and approval |
| Admin | Membership, provider/retention policy; no implicit content approval privilege |

Separate identities must create and approve an item. If one user holds multiple roles, self-approval remains forbidden. Submitted or approved revisions are immutable; edits create a new draft. Confirmed blocker findings require a new successfully analysed correction or an authorised revision-specific exception. Authorisation to approve does not silently grant authority to resolve a source conflict.

State path: `draft → analysing → needs_changes | ready_for_review | incomplete`; `ready_for_review → in_review → approved | changes_requested`; edits produce a new draft. A completed manual check is an auditable human check with actor, scope and evidence. Missing/failed required checks cannot be bypassed through a generic finding exception. They need a retry or explicit authorised manual completion for every affected check, visibly disclosed in export.

Approval transaction locks the content item and brand source-epoch row, verifies expected current revision/run/source epoch, checks membership/assignment/self-approval/check completion/blockers, then inserts decision and audit event atomically. Source activation locks the same brand row and advances its epoch. Export repeats freshness checks using a transactionally consistent snapshot. Conservative Round 2 policy: any active source change for a brand invalidates current export eligibility; targeted dependency selection arrives in Round 3. Preserve the old historical decision; show it as stale, never rewrite it.

Job insert and ReviewRun creation occur in one transaction. Worker claims queued work with a lease; heartbeat, bounded attempts (max 3), 60-second overall analysis timeout initially, crash recovery and idempotent result persistence prevent missing or duplicate outputs. Expired leases can be reclaimed. Only the current lease token can finish a job. A delayed result cannot replace a newer run. Retryable failures retry; malformed/unsupported uploads fail immediately. Set and measure limits before release rather than silently extending them.

## Uploads, processing and deletion

Initial limits: 10 MB upload, 20 PDF pages, 20 megapixels, 100,000 canonical characters, 50 MB total DOCX decompression and 15-second parsing budget. Validate actual signatures and allowlisted types; reject macros, active content, external relationships, encrypted documents and decompression bombs. Use generated object keys, isolated extraction process, resource limits and private authenticated download handlers. Render extracted text as text; never execute uploaded HTML or interpolate unsafe markup.

Default processing is local. External requests require enabled provider policy AND creator-visible disclosure before analysis; log provider, model, prompt revision and the approved boundary. Uploaded content cannot instruct the model to fetch URLs, change access or publish. No such tools are provided. Never log raw documents, cookies or keys.

Demo retention: 24 hours, synthetic data only, scheduled purge with a verified completion record. A deletion job removes original bytes, extracted text, analysis/cache/retrieval data; retain only documented minimal non-content audit metadata. Backups must have an explicit expiry and restored deletions must be re-applied. Confidential pilots remain gated on verified provider policies, encryption and deletion behaviour.

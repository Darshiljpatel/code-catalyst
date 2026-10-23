# S3: grounded semantic analysis and runner integration

## Implemented boundary

S3 adds a Nebius Token Factory adapter, workspace processing policy, creator consent, grounded findings, request telemetry and a runnable durable-job consumer. It uses the existing HTTP client rather than adding a second SDK. The official [Nebius API introduction](https://docs.tokenfactory.nebius.com/api-reference/introduction) documents the compatible chat endpoint and bearer-key environment pattern.

Migrate with the existing Alembic command; `0003_semantic` adds workspace policies, findings, immutable per-run processing snapshots and mutable engine-result metadata. New result columns default to empty objects so existing S2 jobs carry **no external-processing consent**. No old queue item is silently opted in.

## Darshilkumar: processing and results UI

1. `GET /api/v1/processing-policy` returns provider, configured model, boundary, policy version, enabled state and a disclosure notice. It never returns a key. Version 0 is disabled.
2. A workspace **admin** may `PUT /api/v1/processing-policy` with `enabled`, `expected_version`, `notice` and `rationale`. Managers/creators/reviewers cannot enable external processing. The administrator must verify actual provider terms and describe the processing boundary honestly before enabling it for confidential material.
3. Before external analysis, display that notice and require an explicit creator action. Send `{ "external_processing_consent": true, "policy_version": 1 }` to the existing analysis endpoint, with session/CSRF and idempotency headers. Use the actual displayed version. A changed/disabled policy returns 409; a daily limit returns 429.
4. Omitting this body keeps external processing disabled. The same idempotency key returns the original submission, including its original consent; a retry never upgrades a local job to external processing.
5. Poll `/runs/{id}` for check statuses, immutable `processing_snapshot`, `engine_metadata` and `findings[]`. Findings identify origin (`model` or `deterministic`), source/rule, literal evidence, canonical text location, rationale and a nullable suggested edit. Locations use Unicode code-point offsets, not JavaScript UTF-16 offsets. Each `location` contains `block_id: "text"`, `start`, `end` and the exact `quote`.
6. The model supplies an exact **unique** content quote; the server computes offsets. Missing or repeated quotes fail validation rather than guessing which occurrence is intended. The prompt asks for enough surrounding context to disambiguate repeated phrases.
7. Display suggestions as editable proposals. The service never applies them or approves content. Valid source IDs/quotes and numeric-edit guards are structural checks; they do not prove that the source semantically supports a finding or that an edit preserves every factual implication.

The expanded OpenAPI contract is committed at `contracts/openapi.json` and is checked against the running API schema by tests.

## Surya: runner and deterministic-engine integration

From the repository root, after migration and provisioning local identities:

```bash
PYTHONPATH=apps/api .venv/bin/python -m brandguard.worker --once
# Or run the dedicated foreground consumer until stopped:
PYTHONPATH=apps/api .venv/bin/python -m brandguard.worker
```

The API factory and worker load root `.env` without overriding existing environment variables. Keep it private. `.env.example` contains only placeholders and non-secret defaults. Production uses injected environment values. API readiness is explicitly schema readiness; it does not prove that a worker is running.

`brandguard.orchestration.process_one(engine, reviewer, checker=None)` is the shared runner entrypoint. Inject Surya's engine as an async callable accepting `ReviewInput(text, context, sources)` and returning `EngineResult(checks, findings)`. The runner currently expects deterministic coverage for terminology, structured facts/claims, visual and accessibility. It combines this with semantic tone/messaging/claim review. Fact/claim completeness requires **both** structured and semantic checks. If a source category has no applicable rule, the semantic adapter explicitly reports not applicable; it does not infer whole-product compliance.

The CLI currently has **no deterministic engine wired in**. Its missing checks remain unavailable and overall analysis remains incomplete even when the semantic finding is valid. Connect the real extraction/check modules through the injectable interface; do not substitute test fixtures into runtime. An injected checker must be async/cancellable and must isolate blocking/untrusted extraction outside this process.

Engine findings include explicit `start`, `end`, `content_quote`, category, severity, evidence status, source version/rule, literal quote, rationale and nullable proposed edit. The runner validates their sources, quotes and locations too. Valid deterministic findings survive a malformed semantic response. Production checking quality remains unevaluated; the test checker is only an integration fixture.

Claiming uses PostgreSQL `FOR UPDATE SKIP LOCKED`, a random lease token and a 65-second lease. The whole run has a 60-second budget measured from enqueue, so requests cannot legitimately outlive the lease; a heartbeat is unnecessary for this bounded runner. Queue wait counts toward the deadline. Expired/crashed work can be reclaimed; attempts are bounded at three. Only the current, unexpired lease may commit results. No silent HTTP retry or automatic model fallback is enabled. Provider 429/timeout/invalid-output errors finish the affected checks as failed/incomplete; the creator can make a new explicit submission after resolving the problem. A future retry design must preserve these boundaries.

Completion writes findings/checks/metadata and job state in one transaction. Source-epoch changes or expiry mark the old review incomplete. Edits made while a model request is running leave the new draft's state unchanged. External dispatch checks the current enabled policy/version and current content/source epoch immediately before the request. Revocation cannot recall data already sent to the provider.

## Limits and telemetry

- Supported model: `Qwen/Qwen3-235B-A22B-Instruct-2507` at `https://api.tokenfactory.nebius.com/v1/`. Alternate models/URLs fail configuration until separately evaluated and approved.
- Default input budget: 24,000 UTF-8 bytes for system prompt plus serialised input/schema, not a claim of exact tokenizer measurement. Over-budget input fails explicitly; automatic chunking is not implemented yet. Provider usage records actual tokens when supplied.
- Default maximum output: 1,200 tokens. Truncated or incomplete JSON is rejected. This supersedes the earlier provisional 512-token target; structured evidence needs more space.
- Request timeout: 40 seconds, constrained by the remaining overall 60-second run budget. Responses are capped at 128 KiB. Redirects, environmental proxies and tools are disabled.
- Workspace budget: 100 externally consented submissions per UTC day by default (`MODEL_DAILY_RUN_LIMIT`). Reservations are counted under an organisation lock. Failed submissions still consume the reservation. This bounds submissions, not exact currency charges; crashes/reclaims may attempt the request again, at most three attempts per job. Use Nebius billing/account controls as an independent spend limit. There is no claimed dollar-based billing enforcement.
- Metadata records requested/returned model, prompt version, input bytes, output cap, latency, token usage and safe failure codes. Raw responses, submitted text and credentials are never placed in error logs. Approved source text and finding evidence remain private tenant data in the database.

## Validation status

The adapter unit suite covers malformed JSON, invented citations, wrong quotes, ambiguous/missing locations, incomplete coverage, duplicates, new numeric claims in suggestions, tone blockers, unexpected tool output, model substitution, response size, auth/rate errors, timeout, missing consent/key and input budget. Database integration covers policy permissions/revocation/version changes, durable claiming, lease replacement/late-result rejection, findings isolation, missing-engine incompleteness, retention of valid deterministic findings, daily submission limits and newer-draft safety.

Two live synthetic requests were made during implementation. The first connected but failed offset validation. After changing to deterministic quote-location mapping, the second produced one validated trial-duration finding: 727 input tokens, 202 output tokens, approximately 3.7 seconds. No quality/accuracy or p95 claim follows from this sample. The real 20/40 development/held-out evaluation remains pending.

A repeatable connection smoke is available as `.venv/bin/python scripts/smoke_nebius.py --live`. It makes one paid synthetic request, reads the private environment and prints only safe statuses/metadata. It is opt-in and never runs automatically in CI.

## Remaining work

S4 still owns comments, decisions, exceptions, self/stale-approval guards and approved export. Surya's real deterministic/document/image modules, process isolation, deployment packaging/health monitoring, retention and the full evaluation are still pending. This S3 commit does not assert that the whole product or all verification cases are complete.

Integration checkpoint: the working master includes the team's D1 frontend foundation and P1 extraction commits. Existing S1 API responses remain compatible, and eight extraction/scaffolding tests pass. D1 still has explicitly pending S2/S3 type stubs; regenerate those from the newly published contract before building D2/D3 screens. A frontend build could not be rerun on this host because Node/npm is unavailable; no frontend source files were modified by S3.

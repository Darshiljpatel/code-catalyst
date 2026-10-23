# S5 integration checkpoint

## What now runs

The text pipeline is connected: API submission -> durable job -> Surya's real P1 text extraction and P2 checks -> grounded Nebius proposals -> stored findings -> creator revision -> separate reviewer approval -> exact JSON export. No test checker is used by either runtime worker entrypoint. This checkpoint verifies the backend text journey; it does not complete the team's browser/deployment, document-upload or evaluation deliverables.

`apps/worker/adapter.py` is the P3-compatible import path and delegates to the same bounded bridge as `brandguard.worker`. The bridge runs actual `review_engine.extraction.extract` and `review_engine.deterministic.check` in a child process. It receives canonical text, context and eligible source snapshots, never API keys or database credentials. The parent applies a ten-second wall timeout and output cap; the Linux child has memory/CPU limits. The API's existing 60-second overall budget still includes queue wait.

Run the preferred team daemon from the repository root, after installing `apps/api/requirements.lock` and applying migrations:

```bash
PYTHONPATH=apps/api:packages:. .venv/bin/python -m apps.worker --once
# omit --once for the persistent loop
```

The repository layout must be retained in deployment (`apps/api` and `packages/review_engine`), or the engine must be installed as an importable package. Runtime dependencies needed by P1 extraction are now pinned in the API lock. CI executes backend, engine and P3 worker tests together.

## Corrections at the boundaries

- The engine's draft quote is validated against canonical offsets, then stored separately from the literal approved-source evidence quote. Rule IDs are namespaced by **source version plus rule ID**, so identical rule names in different sources cannot overwrite citations.
- Whitespace/newlines/Unicode offsets and the canonical SHA-256 are preserved. Suggested edits use code-point slicing in the UI; they are refused if the draft has changed since analysis.
- Structured fact checking currently supports `trial_duration`. Other structured fact keys are marked manual-review-required. Claim policies remain semantic checks. Valid known findings survive partial unsupported-rule coverage.
- Trial durations are bound to the trial phrase, not unrelated return/onboarding durations in the same sentence. Equivalent `014` and `14.0` quantities are not false contradictions. Terminology boundaries support punctuation in names such as `C++`.
- Contrast is no longer rounded before threshold comparison. [W3C explicitly distinguishes 4.499 from the 4.5 threshold](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). This math fix does not assert whole-product accessibility conformance.
- Pasted-text revisions have no image or declared font/colour metadata, so visual/contrast coverage is explicitly not applicable. Image/document-upload APIs and isolated file parsing remain separate integration work; P1's existence alone does not expose those formats through this API.
- Overlapping model/structured findings for the same source/rule are consolidated; distinct claim-policy and terminology issues remain separate.

## Model quality findings and policy change

A live development smoke found real failures. With prompt v2, corrected copy received a fact flag whose rationale said it matched the fact, and a policy blocker whose rationale said the rule did not apply. A v3 attempt was rejected because the model assigned a non-advisory severity to subjective tone. These were not reported as successful reviews.

Prompt v4 requests **violations only**, including an explicit empty-list form for compliant copy. More importantly, classification is now server-owned: the model proposes source/rule IDs, literal source/content quotes, rationale and an optional edit. The server derives category/severity/evidence status from the approved rule: tone/messaging guidance -> advisory; fact contradiction -> blocker/contradicted; claim-policy breach -> blocker/unsupported. Model-supplied classification fields are rejected as extra fields. Other citation, schema, quote, location, numeric-edit and unexpected-action guards remain intact. This is a policy boundary, not a semantic-correctness guarantee.

The fictional fixture was also clarified to explicitly approve the **free** trial rather than imply its price. These are development changes, not tuning against a held-out evaluation set. The promised 20-development/40-held-out evaluation is still pending. No precision/recall, superiority or p95 claims are made from the smoke.

`verification/evidence/s5-live-smoke.json` records the successful v4 run: four findings on the original draft and zero on the corrected revision, followed by separate-identity approval/export without manual substitutes. Approximate end-to-end review times were 8.7 and 5.4 seconds on this local setup. Five live requests were made across the three development attempts (two v2, one v3, two v4). Test identities simulate the human role actions; this is not a user study. The artifact truthfully identifies a dirty working tree and base commit reference, rather than mislabelling an uncommitted run as evidence for a later release SHA.

To repeat this explicitly paid synthetic check in a dedicated migrated test database:

```bash
TEST_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@localhost:5432/brandguard_s1_test' \
  .venv/bin/python scripts/smoke_workflow.py --live --output /tmp/workflow-smoke.json
```

The smoke targets only its own run IDs, creates a new synthetic tenant, and does not reset existing data. Do not run it concurrently with fixtures that erase the dedicated test database. It reads `NEBIUS_API_KEY` privately and prints only safe summaries. It is not run in CI.

## Queue and governance APIs for D4

- `GET /api/v1/content?state=in_review&limit=20&offset=0`: creator sees owned items, reviewer sees assigned items, manager sees their workspace. Page size is capped at 50. Results contain summary metadata, not entire revision histories.
- `GET /api/v1/brands/{id}/insights`: manager-only, tenant-scoped, actual confirmed/dismissed/exception counts by source key/rule/category. One latest human disposition per item/rule prevents reanalysis from inflating counts. The denominator is distinct items with a terminal analysis, explicitly including incomplete analyses. A zero denominator yields null rates.
- `POST /api/v1/sources/{id}/ambiguity-reports`: rationale, optional source-local rule ID and optional authorised same-brand revision. These are reports, not proven defects or dismissal decisions. Insights deduplicate repeated reporter/source-version/rule/revision reports and disclose the definition.

No new database migration is needed for S5. Ambiguity reports are immutable audit events. The updated OpenAPI is the contract for regeneration; local TypeScript types for future D4 endpoints still need to be generated/connected by the UI owner.

## D2/P3 merge integration

D2 and P3 arrived during this phase and are preserved. The duplicate P3 adapter is consolidated; unsupported/invalid findings are no longer silently filtered into a clean result. P3 logging prints configuration exception types, not arbitrary exception values.

D2's detail view previously substituted fixture findings on analysis failure. That path has been removed. The content API now supplies `latest_run_id`; the page loads it, polls real queued/running runs, and shows service/pending errors without inventing results. Revision changes clear old run panels. Intake selects an actual reviewer by email instead of requiring a membership UUID. Fictional prefilled demo copy and the explicitly labelled static demonstration remain examples, not runtime analysis results.

For local Vite development, the API's `PUBLIC_ORIGIN` must equal the **browser** origin, normally `http://localhost:5173`. The Vite proxy's backend port/Host setting does not replace this CSRF requirement. One explicit launch is:

```bash
PUBLIC_ORIGIN=http://localhost:5173 PYTHONPATH=apps/api \
  .venv/bin/uvicorn brandguard.main:create_app --factory --host 127.0.0.1 --port 8000
```

The frontend production build is checked using a checksum-verified official Node 24 runtime unpacked under `/tmp`; no global runtime was changed. Full browser interaction, keyboard/screen-reader and deployed HTTPS rehearsals remain pending D3/D4/D5 and deployment work. The build result alone does not establish browser usability.

## Remaining release gates

Keep `release-evidence.json` unpassed until its real release-SHA artifacts exist. Browser approval screens, supported document/image intake, retention/deletion, model evaluation, consented user feedback, deployment/restart/restore and judge-access rehearsal remain team obligations. S6 can prepare truthful documentation/disclosures now, but final product submission evidence depends on those actual results.

Final local regression: **133 tests passed** in the combined backend/engine/P3 worker run, plus six verifier tests. The TypeScript/Vite production build passed. Alembic reports no schema drift. One upstream Starlette/httpx test-client deprecation warning remains. Remote CI status is independent of these local results and must be checked on the pushed commit.

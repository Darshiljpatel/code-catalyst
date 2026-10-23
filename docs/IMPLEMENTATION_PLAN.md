# BrandGuard implementation plan

Prepared 23 October 2026. This plan translates the team's submitted proposal into a build that three people can integrate before the Round 2 deadline. Estimates are planning assumptions, not recorded contributions.

## 1. What to deliver

A judge opens the deployed site, starts an isolated synthetic demo, reviews the fictional LumaDesk campaign, opens the evidence behind each finding, edits the draft, submits the new revision, signs in as a separate reviewer, approves it, and downloads that exact approved revision with its review record. A source change subsequently blocks a fresh export until re-review. This is the central product demonstration.

The initial draft is: “Lumadesk guarantees 10x productivity. Get your 30-day free trial. Sign up NOW!!!” Approved sources define LumaDesk, a 14-day trial, no credit card requirement, evidence requirements for promotional claims, and calm language. Expected findings distinguish wrong terminology, a contradicted trial duration, an unsupported claim and advisory tone. A PNG without alt text adds an accessibility finding. Seed data must be labelled fictional.

Success means the workflow is reliable and understandable with unfamiliar drafts too. A precomputed response for this sentence does not satisfy the requirement.

## 2. Requirements and scope decisions

Source precedence: the problem statement defines the problem and general rules; `round 2.txt` supplies this stage's exact deliverables and timing; `CODE CATALYST.pdf` is the team's prior commitment and must have an explicit change log. Round 1 and Round 3 submission requirements apply to their own stages. The original problem statement calls the capability list suggested; this plan adopts the capabilities the team's proposal actually committed to.

| Round 2 delivery | Concrete boundary |
|---|---|
| Brand knowledge | Manager creates/imports guideline text, verifies extracted rules, activates immutable versions; terminology, dated facts and approved original PNG/JPEG assets |
| Content intake | Paste text; text-based PDF/DOCX extraction; PNG/JPEG with dimensions, provided alt text and optional OCR; explicit limits and unsupported-file errors |
| Review engine | Exact terminology, structured facts, unsupported promotional claims, bounded visual/accessibility checks; grounded semantic tone/messaging suggestions through a validated model adapter |
| Evidence | Rule/source version, quote, content location, rationale, severity, evidence status, engine and proposed edit |
| Human control | Creator-selected edits, immutable revisions, comparison, comments, reviewer assignment, changes requested, authorised exceptions, approval and audit |
| Governance | Small table of confirmed recurring rules, dismissals and ambiguity reports with denominators; no invented charts |
| Responsible design | Membership isolation, separate reviewer, private uploads, processing disclosure, deletion/retention, failure visibility |
| Delivery | Working HTTPS URL, accessible repository, updated project PDF, completed-feature list, technical disclosures, actual contributions, testing evidence and three Round 3 improvements |

Preserve the original React/TypeScript + FastAPI + PostgreSQL architecture. Use Docker Compose, a persistent database queue and a dedicated worker. Start with lexical/structured retrieval. Avoid adding vector infrastructure unless held-out evidence justifies it. Pin exact dependency versions and licences during setup.

**Model decision, first integration checkpoint:** use the team's purchased catalogue in `models.txt`. The provisional primary is **Qwen3-235B-A22B-Instruct-2507**, with **Qwen3-30B-A3B-Instruct-2507** as an independently evaluated fallback candidate. See [model selection and integration plan](MODEL_PLAN.md) for roles, API configuration, cost assumptions, evaluation and processing boundaries. Run a five-case connection smoke, then compare on the 20 development items before freezing selection. This replaces the local-model-first implementation path with hosted access for the synthetic demo; record that Round 1 change. Provider identity, exact endpoint IDs, access/quotas and deployment suitability still need verification. External processing requires workspace-admin policy and creator-visible disclosure. With no configured or successful model, semantic checks display unavailable/incomplete and require explicit manual completion; they never silently pass.

**If behind schedule:** simplify dashboard styling, onboarding animation and charting first. Then defer OCR automation while retaining PNG/JPEG checks and explicit manual text review; record this as a proposal deviation. If still blocked, narrow document import to a demonstrated supported subset with clear rejection. Do not quietly mark deferred work complete. Never cut tenant isolation, source evidence, exact-revision approval, failure visibility, deployment or disclosures. These cuts affect proposal coverage and must be acknowledged to judges.

## 3. Three equal workstreams

Each member owns 18 focused hours (54 team hours), including tests and integration. Actual effort will vary; rebalance at every checkpoint. The division preserves the proposal's named roles but moves deterministic and extraction work to Surya and workflow contract work to Darshilkumar. Record actual work separately.

| Owner / task | Hours | Output and acceptance |
|---|---:|---|
| Sanath S1: schema, migrations, session auth, tenant policies | 3 | Real database, seed identities, object-level isolation tests |
| Sanath S2: source lifecycle, revisions, queue APIs | 3 | Immutable sources/revisions; snapshot and job written atomically |
| Sanath S3: grounded semantic adapter and orchestration | 3 | Citations/locations validated; timeouts cannot pass |
| Sanath S4: decisions, concurrency, export and audit | 4 | Assigned reviewer only; atomic guard; source/revision staleness enforced |
| Sanath S5: integration and security regression | 3 | Real API path passes; adversarial access and race cases |
| Sanath S6: architecture, changes, submission coordination | 2 | Accurate technical explanation and final evidence bundle |
| **Sanath total** | **18** | Backend owns database writes and authoritative permissions |
| Darshilkumar D1: API fixtures, client types, UI foundation | 3 | Canonical mock scenarios; accessible components and routing |
| Darshilkumar D2: source management, intake, processing mode | 3 | Manager curation and all supported content intake screens |
| Darshilkumar D3: findings, evidence, revisions, corrections | 4 | Located findings, editable suggestions, comparison and save conflicts |
| Darshilkumar D4: queue, review, comments, export, insights | 3 | Full human workflow; small real-data insights table |
| Darshilkumar D5: browser/accessibility tests and feedback | 3 | Keyboard journey, error states and external-user observations |
| Darshilkumar D6: integrated walkthrough and PDF assembly | 2 | Judge instructions and updated submission PDF |
| **Darshilkumar total** | **18** | Owns UI and workflow expectations, not server authorisation |
| Surya P1: extraction and upload hardening | 3 | Bounded PDF/DOCX/image parsing and explicit failures |
| Surya P2: deterministic text/visual/accessibility engines | 3 | Structured findings using shared contract, exact unit cases |
| Surya P3: durable worker runner and deployment packaging | 3 | Queue lease/retry integration, Compose, HTTPS environment |
| Surya P4: synthetic fixtures, evaluation, failure tests | 3 | Development set plus evaluation framework and quality report |
| Surya P5: deployment, restart/restore, isolation checks | 4 | Live workflow, durable state, tested recovery and rollback |
| Surya P6: disclosures, evidence, limitations | 2 | Dependency/model ledger and operational evidence |
| **Surya total** | **18** | Owns extraction/check modules and runtime; no independent schema fork |

No member is only doing documentation or testing. Pair review rotates: Darshilkumar reviews Sanath's response contracts; Surya reviews permissions/queue code; Sanath reviews extraction and deployment; each reviews another member's recorded demo. If a task exceeds its estimate by an hour, transfer a bounded task, not shared-file ownership.

## 4. Integration schedule (all times IST)

Schedule assumes work starts on 23 October and sufficient availability for 18 focused hours each. Preserve overnight rest. If these milestones have already passed, use them as sequential checkpoints and apply the scope cuts above immediately.

| Deadline | Required integrated state |
|---|---|
| 23 Oct, first two working hours | Contract and fixture freeze; model/provider and hosting decision; seed identities; skeleton Compose; no feature teams waiting for live APIs |
| 23 Oct 18:00 | First HTTPS deployment: sign in, create draft, store/reload revision; a real queue job produces one deterministic finding |
| 23 Oct 22:00 | Pasted-text journey: curate → analyse → correct → separate reviewer → approved export; browser points at real API |
| 24 Oct 13:00 | Document/image paths, semantic adapter, source staleness, exceptions and failure cases integrated |
| 24 Oct 18:00 | Feature freeze; regression, security, evaluation and usability evidence; complete-feature list frozen |
| 24 Oct 22:00 | Deployment rehearsal and recovery; PDF/disclosures/contributions ready; no unresolved release blockers |
| 25 Oct 07:00 | Fresh-browser judge rehearsal; production smoke and link/repository access check |
| 25 Oct 08:00 | Team submits and retains confirmation, two hours before official close |

Critical path: contract → persisted source/revision → real analysis → guarded decision → export → deployed independent-user rehearsal. Deploying only after feature completion is an unacceptable schedule risk.

## 5. Merge discipline

Use one repository, short task branches (`sanath/S1-auth`, `darshil/D3-findings`, `surya/P1-extraction`) and small PRs. Keep the current branch name until the team agrees a default; do not assume remote history is empty. Fetch and inspect before the first push. Commit only work done during the allowed window with truthful authorship and timestamps.

Planned paths: Sanath owns `apps/api/`, migrations and `contracts/openapi.json`; Darshilkumar owns `apps/web/` and `tests/e2e/`; Surya owns `packages/review_engine/`, `apps/worker/`, `infra/` and `evaluation/`. All Python code uses a single agreed dependency lock; Surya maintains it after the initial joint setup. Contracts have a named owner (Sanath) and require the consuming member's review before changing. Darshilkumar supplies canonical request/response fixtures for that review. No separate copies of finding enums or schema migrations.

Generate web types from committed OpenAPI; use the same JSON fixtures in frontend mocks and API contract checks. Mocks are a development switch only, excluded from the deployed build. Merge a vertical increment every 2–3 working hours. Each PR includes task ID, acceptance evidence, schema impact and disclosure updates. A consumer must review incompatible contract changes before merge.

## 6. Product quality that judges can see

Build a working review desk, not a generic marketing dashboard. First screen: “Review a campaign” and “Try the fictional LumaDesk example.” Use a document preview and a readable evidence panel, with comments and the exact revision visible. Findings show “Contradicted by approved fact,” “Unverified,” “Advisory” or “Manual review required”; no pseudo-precise brand score. Use restrained typography, consistent spacing, explicit button labels and text with every severity colour.

The evidence drawer opens the original source/version and quote; selection moves focus to the corresponding content location. A proposed edit is editable, previewable and reversible through a new revision. A pending analysis shows individual check progress; retry and failure actions are visible. Disabled approval explains which blocker remains. Empty insight tables explain what will populate them. An upload error preserves the draft and offers a supported alternative. Narrow screens stack panels in reading order.

## 7. Exactly three Round 3 improvements

1. **Source-change impact and re-review inbox.** Round 2 prevents new export under stale sources. Round 3 adds affected-content discovery, fact/source diffs, assigned re-review batches and progress tracking. Acceptance: changing one fact identifies every seeded dependent review, excludes unrelated work and lets a reviewer resolve the batch with a complete audit trail.
2. **Campaign-graphic evidence review.** Extend basic identity/dimension/contrast checks with OCR bounding boxes, reviewer-confirmed extracted claims and annotated logo/layout review tasks. Acceptance: evaluate 20 unseen graphics including low contrast, embedded text and unreadable regions; report OCR/claim errors; uncertain regions visibly require human confirmation. Do not promise automated certification of logo placement.
3. **Guideline improvement workflow.** Extend counts into a manager's queue of disputed/ambiguous rules with examples, adjudication, revised guideline drafts and before/after evaluation. Acceptance: a recurring ambiguous rule can be revised, independently reviewed and activated; measure changed false-positive counts on frozen cases and show which reviews require re-checking.

These are additions to working Round 2 fundamentals. Quality fixes, the original core workflow and routine accessibility fixes cannot be repackaged as major new features.

## 8. Traceability and honesty

See the requirement register for ownership, test IDs and submission evidence. Maintain a Round 1 delta table in the updated PDF: original promise → implemented behaviour → evidence → reason for any change → next step. No interview, accuracy, deployment, contribution or time-saving claim becomes “completed” without real records. The six-person study and 60-case evaluation in the proposal remain targets; any smaller Round 2 sample is reported exactly and completed later.

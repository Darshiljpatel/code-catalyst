# Verification and release gates

The executable checker validates requirement coverage and evidence completeness. It does not run the future application or certify security. Product tests below must be implemented against real services; no mock-only result satisfies a release gate. `verification/cases.json` contains concrete setup, action and expected outcome for each test; `requirements.json` binds these tests to the brief.

## Layers and owners

| Layer | Owner | Implementation and evidence |
|---|---|---|
| Deterministic rules/extraction | Surya | pytest, real PDF/DOCX/PNG/JPEG fixtures, exact expected locations and statuses |
| API/security/state | Sanath | pytest against temporary PostgreSQL; separate tenants and identities; no SQLite substitution for locking tests |
| Contract | Sanath + Darshilkumar | OpenAPI validation, generated client compilation, shared fixtures, unknown enum rejection |
| Browser/usability | Darshilkumar | Playwright against real API/DB; keyboard + screen-reader spot checks; screenshots and traces on failure |
| Engine quality | Surya, labels reviewed by both teammates | Frozen development/evaluation cases; per-category counts and human evidence-support decisions |
| Deployment | Surya + independent teammate | HTTPS smoke, restart, backup/restore, rollback and fresh-browser judge rehearsal |

Each member implements tests for their own feature and another member reviews the expected results. A test that merely asserts the same hardcoded demo output is insufficient. Use a second synthetic brand with different facts to catch hardcoding and tenant leakage.

## Required automation at implementation

Product CI must install exact locked dependencies, check generated contract drift, typecheck/build the web app, lint the changed code, run backend/engine tests on PostgreSQL, and run browser flows against the built application. Preserve logs and Playwright failure traces. Pin action versions by commit before enabling secrets. Run secret and dependency scans with documented triage; unresolved exploitable critical/high findings block release. CI for this planning package intentionally only checks the plan and verifier regression cases.

Do not create placeholder tests that pass while implementation is absent. Map each actual test name to a `Txx` case ID. Release evidence must point to the commit tested and artifacts containing assertions and results.

## Evaluation design

Preserve the proposal's 60 synthetic-item design: 20 development items and 40 held-out items, split by base template before tuning. Development: 3 clean, 3 terminology, 3 fact/claim, 2 tone, 2 messaging, 2 visual, 2 accessibility, 1 expired source, 1 conflicting source, 1 extraction failure. Held out: 8 clean, 5 terminology, 5 fact/claim, 4 tone, 4 messaging, 4 visual, 4 accessibility, 2 expired, 2 conflicting, 2 extraction failure. Items may contain multiple independently labelled issues. Count every issue; do not turn the 40 items into 40 claims about statistical certainty.

Each record stores item ID, family/template ID, format, source snapshot, expected check status, expected issues (category, rule ID, location, severity, evidence status), and acceptable action. Freeze cases and their SHA-256 before running evaluation. Do not tune against held-out labels. Two humans independently label held-out findings and adjudicate differences; log uncertainty rather than forcing subjective tone preferences into facts. If time prevents full evaluation, report the actual sample and defer the unmet target openly. Never relabel a development run as held out.

Match predicted to expected findings one-to-one using category + rule/source + overlapping correct location; duplicates count as false positives. Report micro precision TP/(TP+FP), recall TP/(TP+FN), per-category counts, clean-item false-positive rate, extraction failures and incomplete-run rate. Undefined ratios are “N/A,” not 100%. Include missed critical issues. Human assessors separately judge whether evidence supports the finding and whether suggested edits preserve intent and introduce unsupported facts.

Targets inherited from Round 1: precision ≥85%, recall ≥80%, resolvable cited references 100%, human-supported citations ≥90%. The deterministic regression suite and integrity cases must pass 100%. Accuracy targets are evaluation goals; failing one requires disclosed limitations and scope adjustment, not manipulation of results. Zero invented source citations and zero unauthorised approvals are release blockers. Successful citation-ID validation alone does not prove semantic support.

Latency goals for the small demo: deterministic text p95 ≤3 seconds; complete review p95 ≤30 seconds for supported inputs; terminal timeout/incomplete by 60 seconds. Run at least 30 reviews including five concurrent submissions, report hardware/provider, warm/cold runs and queue delay. Failure must remain explicit if these targets are missed. Do not claim the system scales beyond measured load.

## Usability and research

Recruit at least three non-builder testers for Round 2 if available. Ask them to find the trial error, inspect its source, correct it, submit, approve as a separate role, and export without coaching. Record completion, errors, time, help required and one design change. Capture consent and anonymised participant IDs. Team walkthroughs are useful but must be labelled internal. The original six-person counterbalanced manual-versus-assisted study remains the basis for a future time-saving claim; no 25% improvement claim without measured matched tasks and critical-miss comparison.

Keyboard checks: complete the journey without a mouse, visible focus, focus restored after drawer close, associated form errors, live announcement of analysis status, non-colour severity and 200% zoom without lost controls. Contrast checks on declared colour pairs follow the specified ordinary/large-text thresholds; they do not establish whole-product WCAG conformance. An automated accessibility scanner supplements these checks.

## Evidence mechanism

1. Run `python3 scripts/verify_plan.py` while editing the plan. It checks unique IDs, owners, source references and test coverage.
2. Implement the cases; save CI reports, screenshots, review logs and deployment records under `verification/evidence/` (never secrets or confidential uploads).
3. For each case in `release-evidence.json`, set `status` to `pass` only after execution, write the actual 40-character commit SHA, UTC execution time, and relative artifact path. Add accurate submission artifacts for each requirement. Failed and not-run cases block this evidence gate; a real manual check can be recorded with reviewer notes as its artifact.
4. Set the judge HTTPS URL, repository URL and `tested_commit`. Run `python3 scripts/verify_plan.py --release verification/release-evidence.json`. It rejects missing files, empty evidence, mismatched commits and unrun cases. This is an evidence inventory gate; humans still inspect artifact contents and CI status.
5. A teammate reruns the critical workflow on the deployed build, checks build SHA matches and signs the release note. The script cannot establish that a URL is live or that evidence is truthful.

Release blocks: broken main journey, unauthorised/cross-tenant access, self/stale approval, false-clean analysis, invalid citations, loss of persisted data, public private files, secrets in artifacts, inaccessible judge link or missing mandatory submission item. Minor polish issues and evaluation limitations are recorded with scope and reproduction steps. Never weaken a security gate to meet the deadline.

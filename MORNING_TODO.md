# Morning TODO

## Day session update (28 Oct)

**Test status (28 Oct, after the last commit):** `pytest apps/api/tests tests` **256 passed** (the flaky race test in
item 6 passed in this run). Playwright against the real local stack **86 passed, 1 skipped** (the live-Nebius test).
`alembic upgrade head` + `alembic check` clean at `0013_recheck_routing`. Web build and lint clean.

1. **Impact routing is now "Confirmed + Likely"** (954f1a1 backend, c60efa4 web). When a guideline change is published,
   every affected campaign is still rechecked automatically. Only **confirmed** and **likely** campaigns that were approved
   or in review go back to a reviewer (state `recheck_required`). **Possible** ones keep their state while the recheck runs:
   - unchanged findings → the earlier approval is kept. A new `Decision` (`carried_from_decision_id` set) is bound to
     the recheck run, so export still checks that the approval matches the current guideline versions (the guard was
     not loosened). The evidence record gets `approval_kept` and `recheck_of`. The audit log gets
     `recheck.approval_kept` (or `recheck.review_kept` for in-review). The inbox row resolves as "Kept approval: no
     change found" and stays visible.
   - Reviewer resolutions of identical findings and reviewer manual checks are carried over, with source ids moved to
     the new version, **except manual checks in a category the change touched**. Those were made against the old wording,
     so the campaign goes to the reviewer (reason `recheck_needs_reviewer`).
   - different findings → escalated to **confirmed** and back to the reviewer (or to the creator on a new blocker).
   - failed recheck → back to the reviewer (reason `recheck_failed`).
   - Export answers 409 `analysis_pending` for the few seconds a kept approval's recheck is queued.
   - `/verify` now reports `still_current: false` for an approval record that a later decision on the same revision
     replaced (a gap before, too: re-approvals after a recheck had the same issue).
   - UI: publish dialog says "N will need re-review, M will keep approval"; inbox shows the kept counts and outcome labels;
     the campaign banner explains a recheck that keeps approval. Inbox finished rows no longer fade with opacity
     (that failed the colour-contrast check).
   - Migration `0013_recheck_routing` (additive).
2. **Impact benchmark under the new routing** (1ca2696, dataset and labels unchanged, SHA `23c20cf6…`):
   **re-reviews avoided 53 of 85 (62%, Wilson 0.52–0.72)** compared with brand-wide invalidation. 32 approvals go back to
   a reviewer; 0 were escalated by the recheck; **1 approval that the labels say needs re-review is missed:
   C1:IB-23 "Two weeks free"** (trial 14→30 days; the local engine can't read "two weeks", so it is "possible" with
   unchanged findings and keeps its approval). The labels say 7 approval re-reviews were needed in total. Confirmed+likely
   recall vs labels 0.95 (0.76–0.99). Before today every listed approval returned to a person (0 avoided).
3. **OCR benchmark (Improvement 2)** (4a7cf86 dataset, 6fd0578 first run, 1d29d89 fix, 4b454a8 results):
   `python -m evaluation.ocr_benchmark`. **The 20 ad graphics are synthetic**: original images drawn by
   `evaluation/ocr_dataset.py` for the fictional LumaDesk brand, not photos or real ads. Ground truth is exact (the text
   and ink boxes the generator drew). Dataset SHA `336e4854…` was frozen and committed before the first OCR run. Runs
   through the app's own `TesseractEngine` (Tesseract 5.5.0, eng). Results after the fix (first run in brackets):
   - character error rate **0.136** (0.164), word error rate **0.144** (0.177), words read exactly 0.86 (0.80–0.90)
   - lines read exactly **37 of 47 = 0.79 (0.65–0.88)**: 0.87 at contrast ≥ 3, **0.44 (n=9) below contrast 3**
   - lines not found at all **6 of 47**: blurred photo-like backgrounds (ad-05, ad-16), white text on an orange button
     (ad-12), near-invisible yellow on white (ad-17, contrast 1.13)
   - box accuracy (IoU ≥ 0.5) **0.85 (0.72–0.93)** (0.81)
   - low-confidence flag: 3 of 48 OCR lines flagged, all 3 wrong (precision 1.0, 0.44–1.0); it caught 3 of the 4 wrong
     lines (recall 0.75, 0.30–0.95). The miss is a confident spurious "14". Lines that are not found can't be flagged.
   - claims (local engine, LumaDesk rules): 8 findings on the true text; raw OCR misses **1** (0 false flags); after the
     creator corrects flagged lines, still misses **1** (ad-16, whose text was not read at all), 0 false flags.
   - **Bug found and fixed:** OCR line grouping split a line when the word to the right sat a pixel higher, so
     "Luma Desk" became two lines and the forbidden-variant check missed it (ad-04), and "Only $10 per seat" was
     reordered. The fix was found with this benchmark, so the post-fix numbers are not held-out.
   - The image-campaign tests now include one that runs the real Tesseract (skipped where it isn't installed); it
     passes. The pytest for the benchmark is skipped without Tesseract too.
   - The OCR engine was **not tuned** against this set. Ideas for later, to measure on a new set: an adaptive-threshold
     pass for photo backgrounds; a check that warns when a line's contrast is below 3.
   - Side note: the local engine flags `lumadesk.com` (ad-02) as a wrong brand spelling. Worth checking whether URLs
     should be exempt.
4. **Wording:** `apps/web/src/api/client.ts` and `AuthContext.tsx` header comments now point to `CONTRACTS.md` only.
5. Earlier today: **retention covers guideline-request examples** (81cfbc5, a5be48c). Request examples copied from a purged
   campaign are redacted, example-set cases deleted, comparison results lose their quotes. The ledger lists them and
   `infra/restore.py` re-applies it. Migration `0012_retention_examples`. Also fixed: `extract_tombstones` treated
   `retention.updated` / `retention.purged_imports` as deleting the workspace itself.
6. **Flaky test (already there before today):**
   `apps/api/tests/test_workflow.py::test_source_change_racing_approval_cannot_leave_export_eligible` sometimes hits
   a Postgres deadlock on the `brands` row (about 1 run in 12). Re-run it if it fails; not fixed.

**Partial / not done:**
- OCR: only synthetic graphics; no photographed or real-world ads. Photo-like backgrounds are the weak spot (2 of 20
  images mostly unread). No engine change beyond the line-grouping bug.
- Impact routing: the "Two weeks free" miss (C1:IB-23) remains by design of the possible level. Consider teaching the
  local engine "two weeks" / "fortnight" before quoting the 62% figure.
- Labels of the impact and v2 benchmarks were written without a second reviewer. Review them before quoting.
- Row 16: label-agreement study and prompt-injection set not built.
- Row 5: nightly reset of the shared Round 2 accounts not done (private sandboxes replace them).
- Flaky race test (item 6) not fixed.

## Summary of the night run, 27–28 Oct (branch `ONE-FINAL-SCORE`, 42 commits ahead of `master` then, all pushed)

**Test status at the end (06:10, 28 Oct):** `pytest apps/api/tests tests` **245 passed**; Playwright against the real
local stack **85 passed, 1 skipped** (the live-Nebius test, which needs a key). Every Playwright run now goes through
the production CSP. `alembic upgrade head` + `alembic check` clean (head `0011_retention`). Web build and lint clean.

**Shipped (code + tests):**
- P0 rows 1–9: health/version/worker heartbeat, proxy-aware sign-in throttle, separate worker service in
  `render.yaml`, tolerant client with wake-up banner, private demo sandboxes + role switcher, shared evaluation
  service, Improvement 1 (impact + re-review inbox), Improvement 2 (image campaigns + OCR + region-linked findings),
  Improvement 3 (guideline health, requests, comparison, peer review).
- P1 row 12 PDF/DOCX import with page/paragraph provenance and the file hash on the revision.
- P1 row 13 AI reliability: retries on 429/5xx/timeouts inside the deadline, one repair round, per-category manual
  review with rejected proposals shown as "unverified suggestions", deadline counted from claim time,
  second evaluated model on the allowlist, admin provider status card.
- P1 row 14: CSP/HSTS/Referrer/Permissions headers, per-member hourly caps (drafts, checks, uploads), MIT `LICENSE`,
  Dependabot, pip-audit + npm audit workflow. (`APP_ENV=production` was already in `render.yaml`.)
- P1 row 15: `scripts/synthetic_journey.py` (+ 30-minute GitHub workflow) and `scripts/load_test.py`.
- P1 row 16 (partly): frozen 60-campaign text benchmark v2 with held-out split and Wilson intervals
  (`python -m evaluation.benchmark_v2`), and a comparison-runner benchmark with seeded regressions
  (`python -m evaluation.comparison_benchmark`: 24/24 caught, 0 false alarms).
- P1 row 17: Judge guide "Round 3 missions" tab (one mission per improvement, progress saved in the browser) and
  plain-language copy fixes ("epoch", "snapshot", "identity" jargon).
- P1 row 19: per-region text contrast estimate and brand-palette check on image campaigns.
- P2 rows 20–24: AI rule drafting from a brand book (**off unless `RULE_DRAFTING_ENABLED=1`**), local checks for prices /
  percentages / counts, approval-record verification page (`/verify`), scanned-PDF page → image campaign,
  retention period + hourly purge + deletion ledger that restore re-applies.
- Small P1 follow-on: sign-in no longer needs the workspace ID when the account has one workspace.

**Partial / not done:**
- Row 16: label-agreement study and prompt-injection set were not built. The impact and OCR benchmarks were built in
  the day session (see above). Benchmark v2 and impact labels were written without a second reviewer — see "Things to review".
- Row 5: nightly reset of the shared Round 2 accounts was skipped (private sandboxes replace them).
- Out of scope by instruction: docs, PDF, video, README, user study (rows 10, 11, 18).

**Failed:** nothing is left broken. One mid-run Playwright failure was an artefact (trace file removed by a
concurrent run); the spec passes and the final full run is green.

**New env flags:** `RULE_DRAFTING_ENABLED=1` (API) turns on AI rule drafting; it also needs external processing
enabled by an admin and a Nebius key. `MODEL_PRIMARY_ID` may now also be `Qwen/Qwen3-30B-A3B-Instruct-2507`
(evaluated alternative; switching it is a deliberate admin change).

## Manual steps (hosting, secrets, plans — cannot be done from the repo)

### 1. Always-on hosting and the separate worker (backlog row 1)
**Important before merging `ONE-FINAL-SCORE` into `master`:** `infra/Dockerfile.api` now starts
only uvicorn. It no longer runs migrations, the seed or a background worker on start. Do one of these first:
- **Recommended:** in Render, use **New → Blueprint** on this repo (`render.yaml`). It creates
  `brandguard-api` (web, starter $7) and `brandguard-worker` (background worker, starter $7), with
  migrations and the seed as the API's pre-deploy command. Fill the `brandguard-shared` env group:
  `DATABASE_URL`, `PUBLIC_ORIGIN` (the Vercel URL), `NEBIUS_API_KEY`, `SEED_PASSWORD`.
  Then delete or suspend the old free API service, and update `vercel.json` rewrites if the API URL changes.
- **Stopgap:** keep the existing service, set its Docker command to `/app/entrypoint.sh` and set
  `EMBEDDED_WORKER=1`. That runs migrations and a supervised (auto-restarting) worker in the API container.
- Set `TRUST_PROXY_HEADERS=1` on the API (render.yaml already does), so the sign-in throttle
  keys on the judge's own address instead of the proxy's.
- Render sets `RENDER_GIT_COMMIT` automatically, so `/api/v1/health/version` shows the SHA.

### 2. Database
- Check where `DATABASE_URL` points. If it's Render's **free** Postgres, it expires 30 days after
  creation and has no backups: move it to a paid basic plan (about $6/month) or another provider without expiry. Back it up first.

### 3. Uptime monitors
- UptimeRobot / Better Stack: monitor `GET /api/v1/health/ready` (expect 200) and
  `GET /api/v1/health/worker` (keyword `"online"`), every 5 minutes, alerting the team.

### 4. Synthetic journey (backlog row 15)
- In GitHub → Settings → Secrets and variables → Actions → **Variables**, add `BRANDGUARD_URL` = the public
  Vercel URL (e.g. `https://<app>.vercel.app`). `.github/workflows/synthetic.yml` then runs every 30 minutes and
  fails (emailing watchers) if a private demo can't be created and checked. Until it's set the job is skipped.
- Load test before freeze: `python scripts/load_test.py https://<app>.vercel.app --users 10 --minutes 10`.
  Demo creation is capped at 10 per network address per hour, so 25 users from one machine needs a staging
  deploy with `PER_ADDRESS_PER_HOUR` raised, or several machines. Locally, sandbox creation is the slow write
  (~4 s each, ~11 s p95 with 5 at once) — watch it on the starter instance.

### 5. Security headers (row 14)
- `vercel.json` now sends a strict CSP. All 78 Playwright tests pass under it locally, but open the deployed
  site once and check the browser console for CSP violations (Google Fonts are allowed).
- After judging, rotate the Nebius key on Render.
- Dependabot (`.github/dependabot.yml`) and `.github/workflows/audit.yml` (pip-audit + npm audit) start on the next push;
  `pip-audit --strict` may flag something the first time — triage then.

### 6. Tesseract / OCR
- Tesseract 5.5.0 is now installed on the dev machine; the OCR benchmark and one image-campaign test use it. The worker
  image installs it too. Upload a sample ad once on staging and confirm the OCR boxes appear.

## Things to review by a human
- **Benchmark v2 labels** (`evaluation/fixtures/benchmark_v2.json`, 60 campaigns) were written from the guideline
  intent without a second reviewer. Review the labels (the plan says "labels by all") before
  quoting numbers; if you change any, re-freeze the SHA in `evaluation/benchmark_v2.py`. It measures the
  local engine package; the AI side needs a live key.
- **Impact benchmark labels** (`evaluation/fixtures/impact_benchmark.json`, `human_affected_by`) were also written
  without a second reviewer. Review them; if you change any, re-freeze the SHA in `evaluation/impact_benchmark.py`.
- Retention (row 24) is off until an admin sets a period in Processing policy. It deletes campaigns with no activity
  for that many days (except ones in analysis/review) and writes `retention.purged` audit events that restore re-applies.
  Guideline-request examples copied from a purged campaign are redacted (text blanked, label kept), example-set cases
  copied from it are deleted and comparison results lose their quotes; the ledger lists them and restore re-applies it.
- The comparison benchmark's ground truth is a predicate per seeded change. On the first run one
  predicate was corrected (it missed "trial for 14 days" in V2-26, which genuinely regresses) and the production rule
  value was switched to the full approved phrase ("save 15%"; a bare "15%" is deliberately not checked locally). Both are in
  `evaluation/comparison_benchmark.py`. Worth a second pair of eyes before quoting the 24/24 figure.

### 7. New migrations to run on deploy
- `0010_document_imports`, `0011_retention`, `0012_retention_examples` and `0013_recheck_routing` (additive). The Render pre-deploy command runs them.

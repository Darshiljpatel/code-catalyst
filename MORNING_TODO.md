# Morning TODO

## Day session update (28 Oct, 07:16 onwards)

**Test status:** `pytest apps/api/tests tests` 247 tests, all passing apart from the flaky race test in item 4
(it passes on re-run). `alembic upgrade head` + `alembic check` clean at `0012_retention_examples`. Web build and lint clean.
Playwright was not re-run today; the only web change is one table cell on the request page.

1. **Retention now covers guideline-request examples** (81cfbc5, a5be48c). When the hourly purge deletes a
   campaign, request examples copied from it are redacted (text, excerpt and context blanked, `redacted_at` set;
   the row and its label stay so the request history still adds up). Example-set cases copied from it are deleted,
   and comparison results and summaries lose that case's text and quotes. The `retention.purged` ledger now lists
   `redacted_examples` and `redacted_cases`, and `infra/restore.py` re-applies both. New migration
   `0012_retention_examples` adds a column; 0011 was not edited because it may already be applied on staging.
   Also fixed: `extract_tombstones` treated `retention.updated` and `retention.purged_imports` events as deleting
   the workspace itself, so a restore would have dropped the organisation row.
2. **Impact benchmark (Improvement 1)** (78095a4): `python -m evaluation.impact_benchmark` (needs no database; it
   uses in-memory SQLite and the real `impact.compute_impact`). The dataset is 30 synthetic LumaDesk campaigns
   (17 approved, 4 in review, 9 needing changes) × 5 changes = 150 scenarios. The changes are: trial 14→30 days,
   seat price $12→$15, LUMADESK allowed, discount rule retired, new DeskMap rule. It is frozen with SHA-256 `23c20cf6…`,
   and the labels were written before the first run. Local checks only. Results (Wilson 95% intervals):
   - **Impact recall 1.0 (0.82–1.0)** against full re-analysis (target met): every campaign whose findings change
     is listed. Precision of the listing is only 0.11 (0.07–0.17), because every campaign is listed for every change.
   - The "confirmed" level: precision 0.81 (0.60–0.92), recall 1.0 against re-analysis. Against the human labels,
     recall is 0.85 (0.64–0.95). The misses ("free for 30 days", "14-day LumaDesk trial", "Two weeks free") are
     wordings the local engine can't read at all, under the old or new rules.
   - **Re-reviews avoided compared with brand-wide invalidation: 0 of 85 under the routing as shipped.** Every run
     snapshots *all* active guidelines of the brand, so every analysed campaign relied on the changed source. Every
     listed approval goes back to a reviewer after its recheck, even at the "possible" level. If routing used the
     "confirmed" level, 79 of 85 (93%) would be avoided, with 1 labelled approval missed ("Two weeks free"). That
     alternative is **not shipped** and needs a product decision. Don't quote a re-reviews-avoided headline until
     then.
3. **OCR benchmark (Improvement 2): skipped.** Tesseract is still not installed on this machine (`which tesseract`
   finds nothing, and there is no dpkg package or sudo). Install it (`sudo apt install tesseract-ocr`) and build the
   benchmark in a later session.
4. **Flaky test (already there before today):**
   `apps/api/tests/test_workflow.py::test_source_change_racing_approval_cannot_leave_export_eligible` sometimes hits
   a Postgres deadlock on the `brands` row (about 1 run in 12, also at `15ddfbb`). Re-run it if it fails; not fixed.

## Summary of the overnight run (branch `ONE-FINAL-SCORE`, 42 commits ahead of `master`, all pushed)

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
- Row 16: the OCR benchmark (needs Tesseract, still not installed here), label-agreement study and prompt-injection
  set were not built. The impact benchmark was built in the day session (see above). Benchmark v2 and impact labels
  were written by the agent — see "Things to review".
- Impact routing: every listed approval still returns to a reviewer, so re-reviews avoided is 0 today (see above).
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
- Tesseract is not installed on the dev machine, so OCR ran only with a fake engine in tests. The worker image
  installs it. Upload the sample ad once on staging and confirm the OCR boxes appear.

## Things to review by a human
- **Benchmark v2 labels** (`evaluation/fixtures/benchmark_v2.json`, 60 campaigns) were written by the overnight
  agent from the guideline intent, not by the team. Review the labels (the plan says "labels by all") before
  quoting numbers; if you change any, re-freeze the SHA in `evaluation/benchmark_v2.py`. It measures the
  local engine package; the AI side needs a live key. The OCR benchmark was not built.
- **Impact benchmark labels** (`evaluation/fixtures/impact_benchmark.json`, `human_affected_by`) were also written by
  the agent. Review them; if you change any, re-freeze the SHA in `evaluation/impact_benchmark.py`.
- Retention (row 24) is off until an admin sets a period in Processing policy. It deletes campaigns with no activity
  for that many days (except ones in analysis/review) and writes `retention.purged` audit events that restore re-applies.
  Guideline-request examples copied from a purged campaign are redacted (text blanked, label kept), example-set cases
  copied from it are deleted and comparison results lose their quotes; the ledger lists them and restore re-applies it.
- The comparison benchmark's ground truth is a predicate per seeded change. On the first run I corrected one
  predicate (it missed "trial for 14 days" in V2-26, which genuinely regresses) and switched the production rule
  value to the full approved phrase ("save 15%"; a bare "15%" is deliberately not checked locally). Both are in
  `evaluation/comparison_benchmark.py`. Worth a second pair of eyes before quoting the 24/24 figure.

### 7. New migrations to run on deploy
- `0010_document_imports`, `0011_retention` and `0012_retention_examples` (additive). The Render pre-deploy command runs them.

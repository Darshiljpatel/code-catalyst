# Morning TODO

_Summary is written at the end of the overnight run._

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
  local engine package; the AI side needs a live key. OCR, impact and comparison benchmarks were not built.
- Retention (row 24) is off until an admin sets a period in Processing policy. It deletes campaigns with no activity
  for that many days (except ones in analysis/review) and writes `retention.purged` audit events that restore re-applies.
  Guideline-request examples keep their own text copies and are not purged yet.

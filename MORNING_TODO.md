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

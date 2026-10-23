# Executable verification

The previous TypeScript files and `run_all.mjs` contained prewritten passing
results. They were replaced during integration. Those historical D5 artifacts
are invalidated; they are not browser or accessibility evidence.

The real browser suite is `apps/web/e2e/workflow.spec.ts`. It uses a real API,
PostgreSQL and worker. It exercises separate creator/reviewer identities,
analysis, exact revision edits, manual category checks, submission after a page
reload, approval and a downloaded export whose SHA-256 and text are asserted.
It also checks keyboard containment, selected accessibility states and Unicode
edit boundaries. It never marks the release inventory complete.

## Setup

Use separate disposable databases: `brandguard_s1_test` for Python tests and
`brandguard_browser_test` for the browser server. Never point tests at live data.
Both must use UTF-8. Set `DATABASE_URL` to the browser database and run:

```sh
.venv/bin/alembic -c apps/api/alembic.ini upgrade head
PUBLIC_ORIGIN=http://localhost:5178 .venv/bin/python scripts/seed_browser_check.py
PYTHONPATH=apps/api:packages:. PUBLIC_ORIGIN=http://localhost:5178 APP_ENV=development .venv/bin/uvicorn brandguard.main:create_app --factory --port 8000
# In another terminal, with the same DATABASE_URL:
PYTHONPATH=apps/api:packages:. .venv/bin/python -m apps.worker
# In another terminal:
npm --prefix apps/web ci
cd apps/web
npx playwright install chromium
npm run build
npm run preview -- --port 5178
# In another terminal in apps/web:
npx playwright test
```

Provisioning creates new synthetic identities and saves their random password
in a private `/tmp/brandguard-browser-fixture.json` file. Never commit that file
or failed browser traces, which may include credentials. Tests do not require
external inference: workspace policy remains local.

For the combined runner, export `TEST_DATABASE_URL` for the migrated API test
database, leave browser services running, and execute `node tests/e2e/run_all.mjs`.
The PostgreSQL recovery test requires CREATE DATABASE permission and creates and
drops only its own randomly named recovery database. Logs and browser JSON are
execution evidence; they do not establish public deployment or full WCAG conformance.

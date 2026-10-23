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

## Local testing

## Start the prepared local demo

This is the quickest way to resume the existing fictional browser workspace.
It uses the local PostgreSQL instance on port `55439`, the private `.env` for
Nebius only, and the already-provisioned `brandguard_browser_test` database.

Open three terminals at the repository root. In the first, start the API:

```sh
set -a; source .env; set +a
DATABASE_URL='postgresql+psycopg://sanath@127.0.0.1:55439/brandguard_browser_test' \
PUBLIC_ORIGIN='http://localhost:5178' APP_ENV=development \
PYTHONPATH='apps/api:packages:.' \
.venv/bin/uvicorn brandguard.main:create_app --factory --host 127.0.0.1 --port 8000
```

In the second, start the worker. It inherits the private Nebius key from `.env`;
the browser never receives that key.

```sh
set -a; source .env; set +a
DATABASE_URL='postgresql+psycopg://sanath@127.0.0.1:55439/brandguard_browser_test' \
PYTHONPATH='apps/api:packages:.' \
.venv/bin/python -m apps.worker
```

In the third, build and serve the frontend:

```sh
PATH="$(cat /tmp/brandguard-node-path):$PATH" npm --prefix apps/web run build
PATH="$(cat /tmp/brandguard-node-path):$PATH" npm --prefix apps/web run preview -- --host 127.0.0.1 --port 5178
```

Open `http://localhost:5178`. Check readiness with
`curl http://127.0.0.1:8000/api/v1/health/ready`.

To display the temporary fictional login details without placing them in the
repository, run:

```sh
.venv/bin/python - <<'PY'
import json
from pathlib import Path
data = json.loads(Path('/tmp/brandguard-browser-fixture.json').read_text())
print('Workspace ID:', data['org_id'])
print('Password:', data['password'])
for role, email in data['emails'].items():
    print(f'{role}: {email}')
PY
```

If PostgreSQL was stopped, start the prepared local cluster first:

```sh
/usr/lib/postgresql/18/bin/pg_ctl -D /tmp/brandguard-s1-pg \
  -o '-p 55439 -h 127.0.0.1 -k /tmp' start
```

Use `Ctrl+C` in each terminal to stop the API, worker, and frontend. Stopping
them does not delete the prepared test workspace.

## Create a fresh test workspace

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

## Live Nebius browser check

Start the worker with the private `NEBIUS_API_KEY` configured (do not export it as
an empty string). Run from `apps/web`:

```sh
LIVE_NEBIUS=1 npx playwright test nebius.spec.ts
```

This opt-in test enables external processing in the isolated synthetic workspace
through the admin UI, checks creator consent and runs a real paid request through
the worker. It asserts model findings and completed tone/claims coverage.
Messaging is not applicable to this fixture because it has no messaging rule.
The policy remains enabled for manual exploration; consent is still required.
Ordinary browser checks remain local and the live test is skipped unless opted in.

## Run alongside another developer without sharing test data

Use a separate UTF-8 database (for example `brandguard_browser_test_experiments`)
and a separate private fixture path. Set `DATABASE_URL` to that database and
`PUBLIC_ORIGIN=http://localhost:5181`, then migrate and seed:

```sh
.venv/bin/alembic -c apps/api/alembic.ini upgrade head
BROWSER_FIXTURE_PATH=/tmp/brandguard-experiments-fixture.json \
  .venv/bin/python scripts/seed_browser_check.py
```

Start the API on port 8011 with that database/origin, then start a worker with
the same database in another terminal. For deterministic local checks explicitly
set `NEBIUS_API_KEY=''`; this overrides any private dotenv key for that process.

```sh
PYTHONPATH=apps/api:packages:. APP_ENV=development NEBIUS_API_KEY='' \
  .venv/bin/uvicorn brandguard.main:create_app --factory --host 127.0.0.1 --port 8011
# Another terminal, with the same DATABASE_URL:
PYTHONPATH=apps/api:packages:. NEBIUS_API_KEY='' .venv/bin/python -m apps.worker
# Another terminal (Node 24 on PATH):
npm --prefix apps/web run build
BRANDGUARD_API_TARGET=http://127.0.0.1:8011 \
  npm --prefix apps/web run preview -- --host 127.0.0.1 --port 5181 --strictPort
```

The optional `BRANDGUARD_API_TARGET` changes only the Vite development/preview
proxy. It defaults to port 8000 and does not change the production Caddy routing.
Keep `PUBLIC_ORIGIN` equal to the exact browser origin for CSRF validation.

Run the real network/browser journeys with matching settings:

```sh
BROWSER_BASE_URL=http://localhost:5181 \
BROWSER_FIXTURE_PATH=/tmp/brandguard-experiments-fixture.json \
  npm --prefix apps/web exec -- playwright test batch-review.spec.ts workflow.spec.ts import-assignment-journey.spec.ts --config apps/web/playwright.config.ts --reporter=list
```

These checks use real PostgreSQL/API/worker modules and fictional data. The
import/assignment journey checks local import, manager assignment after creation,
manual evidence, creator submission, separate approval and exact `.txt`/JSON
downloads. They establish local integration, not public deployment or semantic
model accuracy. Never run two resetting Python test suites against one database;
use separate migrated `brandguard_s1_test_*` databases for those suites as well.

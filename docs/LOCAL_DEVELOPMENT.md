# Run a persistent local workspace

From the repository root on Linux/macOS, with Python 3.11+, Node.js 22+ / npm and
PostgreSQL server tools installed:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r apps/api/requirements.lock
npm --prefix apps/web ci
python3 scripts/dev_local.py
```

Install dependencies once. On later runs, use only `python3 scripts/dev_local.py`.
The launcher builds the frontend, migrates its own database, provisions fictional
identities and approved fictional source material on first use, and starts the
API, real worker and frontend together. It needs no Docker, temporary Node-path
file, or pre-existing database. It does not install tools automatically.

Open **http://localhost:5183**. In another terminal, retrieve its fictional login
details with `python3 scripts/dev_local.py accounts`. The same workspace and
accounts are reused after stopping or rebooting; no existing campaigns are reset.
Use separate creator/reviewer identities for the approval walkthrough.

Press **Ctrl+C in the launcher terminal** to stop its API, worker, frontend and
database. It leaves other running services alone. Persistent data, private
account details and logs are in `.local/dev/`, which Git ignores. Keep this
directory private and back it up if its local campaigns matter. This is a
fictional development workspace, not a public deployment.

Default ports are PostgreSQL `55441`, API `8013`, and frontend `5183`. If occupied:

```sh
python3 scripts/dev_local.py --db-port 55442 --api-port 8014 --web-port 5184
```

The launcher refuses occupied ports or a second launcher. It never kills an
unrelated process. PostgreSQL tools are discovered from PATH or Linux versioned
installations; use `--pg-bin /path/to/postgresql/bin` when needed. Inspect
`.local/dev/startup.log`, `api.log`, `worker.log`, `web.log` and `postgres.log` for
startup failures. Do not delete the database directory to fix an ordinary error.

## External review

The launcher enables Nebius by default using your private `.env` or environment
configuration. On startup it enables the fictional workspace's processing policy
through the audited admin API. New reviews and rechecks select external semantic
review by default; uncheck it for an individual local-only analysis. Requests send
draft text, context and relevant approved source passages to Nebius and may incur
normal provider charges. No inference request is made just by starting the app.

To disable external processing for the local workspace and explicitly suppress
the provider key:

```sh
python3 scripts/dev_local.py --local-only
```

Semantic categories then require the assigned reviewer's manual checks.
`--external` remains available as an explicit alias for the default mode.
Use fictional copy for testing. The launcher never prints the provider key.

See [the walkthrough](JUDGE_WALKTHROUGH.md) for the review journey and
[browser verification](../tests/e2e/README.md) for isolated test databases.

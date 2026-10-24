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

The default launcher explicitly disables the provider key, so it cannot make paid
inference requests. Semantic categories still require the assigned reviewer's
manual checks. To exercise your configured Nebius integration instead:

```sh
python3 scripts/dev_local.py --external
```

Configure the private key in `.env` or the environment first. Workspace
administrator approval and explicit per-run consent are still required. This flag
does not enable either automatically. Use fictional copy for testing; normal
provider charges apply. The launcher never prints the provider key.

See [the walkthrough](JUDGE_WALKTHROUGH.md) for the review journey and
[browser verification](../tests/e2e/README.md) for isolated test databases.

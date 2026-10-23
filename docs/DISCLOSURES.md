# Technology, AI and reuse disclosures

S6 inventory, 23 October 2026; S5 baseline `b5999b2`. This ledger records observed implementation metadata and open verification work.

## Runtime AI

| Item | Actual value / behaviour |
|---|---|
| Provider and API | Nebius Token Factory, `https://api.tokenfactory.nebius.com/v1/`, OpenAI-compatible chat protocol called through `httpx`; OpenAI is not the runtime model provider. |
| Requested / smoke-returned model | `Qwen/Qwen3-235B-A22B-Instruct-2507` in both fields. Provider-reported immutable weight revision is not available in the evidence. No local weights are bundled. |
| Prompt / classification | `brandguard.semantic.v4`; server policy `source_rule.v1`; unique exact content-quote location mapping. |
| Processing | Canonical draft, audience/channel/purpose and eligible approved source/rule evidence leave the application for this provider only when policy and consent permit. No model tools or autonomous approvals. |
| Limits | 24,000 configured input bytes, 1,200 maximum output tokens, 40-second provider timeout within remaining review deadline; default 100 external reservations/workspace/day. No enforced dollar budget, automatic chunking or evaluated fallback. |
| Failures | Invalid schema/citation/location/truncation/timeouts remain failed or incomplete. Deterministic findings survive model failure. No live result is replaced by demo fixtures. |
| Data controls | Application consent is implemented. Provider region, retention/training terms, account quotas and confidential-data suitability still require account-owner verification. Only synthetic content was used in the recorded smoke. |
| Evaluation | Development failures are disclosed in S5 handoff; later two-review journey passed. No held-out accuracy, fairness or p95 latency result. |

## Development assistance and examples

OpenAI Codex assisted Sanath with planning, implementation, integration, debugging, verification scripts/tests and documentation. The team remains responsible for review and explanation. Other members' tool details are pending their confirmation. The model catalogue supplied by the team is local/ignored; purchased catalogue access does not validate every model or indicate that weights were deployed.

LumaDesk names, facts, claims, sources and drafts are fictional fixtures. `/demo` is an explicitly labelled example, and dev mock transport is gated on development mode. The API/DB smoke uses real modules/provider and synthetic identities. No customer data, interview quotations or organiser endorsements are included. React/Vite starter remnants remain in the frontend; these are scaffolding rather than original product assets.

## Dependency ledger

Versions below were read from the locked/installed S5 environment and npm lockfile. Licence labels were read from local distribution metadata/npm lock entries; they are not a completed legal review. Retain upstream notices and review transitive dependencies before distributing containers. Exact Python pins: `apps/api/requirements.lock`; JavaScript graph/integrity: `apps/web/package-lock.json`.

| Dependency | Version | Recorded licence |
|---|---|---|
| FastAPI | 0.161.1 | MIT |
| Starlette | 1.9.0 | BSD-3-Clause |
| SQLAlchemy / Alembic | 2.1.6 / 1.20.1 | MIT / MIT |
| psycopg | 3.3.6 | LGPL-3.0-only; binary distribution and linked-library notices still need review |
| Pydantic | 2.14.1 | MIT |
| Uvicorn | 0.54.0 | BSD-3-Clause |
| argon2-cffi | 25.1.0 | MIT |
| httpx | 0.28.1 | BSD-3-Clause |
| pypdf | 5.9.0 | BSD-3-Clause |
| python-docx | 1.2.0 | MIT |
| Pillow | 11.3.0 | MIT-CMU |
| lxml | 6.1.3 | BSD-3-Clause; review bundled native-library notices |
| pytest | 9.1.1 | MIT |
| React / React DOM | 19.3.1 / 19.3.1 | MIT / MIT |
| React Router DOM | 7.18.4 | MIT |
| TypeScript | 5.8.3 | Apache-2.0 |
| Vite | 6.4.5 | MIT |
| ESLint | 9.39.5 | MIT |

Local regression used Python 3.14 and PostgreSQL 18. The S5 frontend build used a temporary official Node 24.22.1 download verified against its published SHA-256. These are development versions, not recorded production image digests. Root `pyproject.toml` contains broad project ranges; use the API lock for the demonstrated Python integration environment.

## Outstanding release disclosures

- Repository licence selection and full transitive/native/model-service terms review remain team decisions; no licence for this project's original code is inferred from dependencies.
- Deployment host, Caddy/container versions, image digests, encryption, backup expiry, rollback and worker monitoring await actual infrastructure.
- Private uploads, retention/deletion, held-out model evaluation, consented user observations and end-to-end accessibility remain incomplete. See [feature status](COMPLETED_FEATURES.md).
- Keep credentials in private environment configuration, never in `VITE_*`, evidence or the submission bundle. The packager uses a committed-file allowlist and never reads `.env`.

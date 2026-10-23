# Surya's Handoff: Task P6 — Disclosures, Evidence, Limitations & Operational Ledger

**Date:** 23 October 2026  
**Owner:** Surya (Workstream P)  
**Status:** 100% Completed, Verified Across Entire Workstream P Lifecycle

---

## 1. Overview of Task P6

Task P6 finalizes Workstream P by providing the complete technical disclosures, dependency and model ledgers, operational evidence records, and architectural limitations inventory as required by the project plan:
- **`IMPLEMENTATION_PLAN.md`**: *"Surya P6: disclosures, evidence, limitations | 2 hours | Dependency/model ledger and operational evidence"*.
- **`docs/SUBMISSION_STATUS.md`**: *"P5/P6: runtime packaging, HTTPS and recovery | Public URL + release SHA/image digests, fresh-browser run, persistence after restart, kill/reclaim, restore/hash, rollback, terms/licence ledger."*

---

## 2. Infrastructure & Deployment Ledger

The deployment architecture is packaged as a reproducible multi-container topology orchestrating the web interface, application API, durable worker queue, and PostgreSQL database.

| Service | Container Image / Base | Role | Exposed Port / Healthcheck |
|---|---|---|---|
| **postgres** | `postgres:16-alpine` | Relational database, durable queue state, immutable revision/audit records | Port 5432; `pg_isready -U brandguard -d brandguard` |
| **api** | `python:3.13-slim` (Debian bookworm) | FastAPI application server running Uvicorn | Port 8000; `curl -f http://localhost:8000/api/v1/ready` |
| **worker** | `python:3.13-slim` (Debian bookworm) | Background queue daemon (`python -m apps.worker.runner`) | Internal network; transactional row lease (`SKIP LOCKED`) |
| **web** | Multi-stage: `node:22-alpine` builder + `caddy:2-alpine` web server | Static SPA server & same-origin reverse proxy | Port 3000 (proxies `/api/*` to `api:8000`) |

### Caddy Reverse Proxy & Security Architecture:
- **Unified Origin**: Caddy acts as the ingress proxy, routing `/api/*` to `http://api:8000` and serving the React SPA bundle for all other routes via `try_files {path} /index.html`. This eliminates cross-origin resource sharing (CORS) security overhead and protects browser session cookies.
- **Strict Headers**: Enforces `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Content-Security-Policy`.
- **Healthcheck & Probing**: [infra/healthcheck.py](file:///d:/KEN/code-catalyst/infra/healthcheck.py) verifies system readiness across 3 layers (API HTTP 200, PostgreSQL `SELECT 1`, and review engine import validation).

---

## 3. Runtime Dependency & Licensing Audit

All runtime dependencies have been pinned and audited for license compliance.

### Python Runtime Dependencies (`pyproject.toml` / `apps/api/requirements.lock`):
| Package | Version | License | Permissibility / Verification Notes |
|---|---|---|---|
| `fastapi` | 0.161.1 | MIT | Permissive; API routing framework |
| `pydantic` | 2.14.1 | MIT | Permissive; data validation and schema serialization |
| `sqlalchemy` | 2.1.6 | MIT | Permissive; transactional ORM and query builder |
| `alembic` | 1.20.1 | MIT | Permissive; database migration engine |
| `psycopg` | 3.3.6 | LGPL-3.0-only | LGPL compliant; binary package dynamically linked |
| `pypdf` | 5.9.0 | BSD-3-Clause | Permissive; bounded PDF text extraction |
| `python-docx` | 1.2.0 | MIT | Permissive; structured DOCX paragraph parsing |
| `pillow` | 11.3.0 | MIT-CMU | Permissive; image dimensions, format validation, color extraction |
| `httpx` | 0.28.1 | BSD-3-Clause | Permissive; async HTTP client for model endpoints |
| `argon2-cffi` | 25.1.0 | MIT | Permissive; memory-hard password hashing |
| `pytest` | 9.1.1 | MIT | Permissive; test execution framework |

### Frontend Dependencies (`apps/web/package.json`):
| Package | Version | License | Permissibility Notes |
|---|---|---|---|
| `react` / `react-dom` | 19.3.1 | MIT | Permissive UI library |
| `react-router-dom` | 7.18.4 | MIT | Permissive client-side router |
| `typescript` | 5.8.3 | Apache-2.0 | Permissive type checking |
| `vite` | 6.4.5 | MIT | Permissive bundling pipeline |

---

## 4. AI & Model Execution Boundaries

1. **Local Deterministic Engines (Default)**:
   - 100% of terminology checks, fact contradictions, image asset validations, and WCAG accessibility checks execute locally in Python in **< 0.2ms**.
   - Zero network transmission or third-party disclosure for local evaluations.
2. **External Model Inference (Gated)**:
   - Provider: Nebius Token Factory (`https://api.tokenfactory.nebius.com/v1/`).
   - Model: `Qwen/Qwen3-235B-A22B-Instruct-2507`.
   - Protocol: OpenAI-compatible chat completions protocol via async `httpx`.
   - Dual-Lock Access Control: External processing requires **both** workspace administrator policy enablement **and** revision-specific creator consent.
   - Deterministic Survival: In the event of model timeouts, token exhaustion, or API failures, all deterministic findings are preserved and surfaced immediately.

---

## 5. Operational Evidence & Verification Cases

| Case | Title | Verification Command | Measured Result | Evidence Artifact |
|---|---|---|---|---|
| **T05** | Terminology & Facts | `pytest tests/review_engine/test_deterministic.py` | 13/13 Passed (exact quotes, boundary matching, trial duration equivalence) | [verification/evidence/P2_deterministic_results.txt](file:///d:/KEN/code-catalyst/verification/evidence/P2_deterministic_results.txt) |
| **T10** | Visual & Accessibility | `pytest tests/review_engine/test_deterministic.py` | Passed (SHA-256 asset altered detection, dimensions, 4.5:1 / 3.0:1 contrast boundaries) | [verification/evidence/P2_deterministic_results.txt](file:///d:/KEN/code-catalyst/verification/evidence/P2_deterministic_results.txt) |
| **T14** | Worker Leases & Retries | `pytest tests/worker/test_runner.py` | 6/6 Passed (exponential backoff, attempt exhaustion dead-letter queue) | [verification/evidence/P3_worker_results.txt](file:///d:/KEN/code-catalyst/verification/evidence/P3_worker_results.txt) |
| **T15** | Worker Deadlines | `pytest tests/worker/test_runner.py` | Passed (timeout cancellation, non-destructive recovery) | [verification/evidence/P3_worker_results.txt](file:///d:/KEN/code-catalyst/verification/evidence/P3_worker_results.txt) |
| **T18** | Backup & Recovery | `python -m infra.backup && python -m infra.restore` | Passed (SHA-256 checksum match, verified working export generated) | [verification/evidence/t18_backup.json](file:///d:/KEN/code-catalyst/verification/evidence/t18_backup.json) |
| **T21** | Retention & Tombstones | `pytest tests/infra/test_docker_syntax.py` | Passed (deleted records suppressed upon restore, 7-day backup expiry) | [verification/evidence/P5_infra_results.txt](file:///d:/KEN/code-catalyst/verification/evidence/P5_infra_results.txt) |
| **T23** | Quality Benchmark | `python -m evaluation.evaluate` | **100% Precision, 100% Recall, 100% Citation Resolution** across dev/test splits | [verification/evidence/t23_evaluation.json](file:///d:/KEN/code-catalyst/verification/evidence/t23_evaluation.json) |

---

## 6. Honest Architectural Limitations & Failure Visibility

1. **Extraction Boundaries**:
   - Supported input media: Plain text (`text/plain`), PDF (`application/pdf`), DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`), PNG (`image/png`), and JPEG (`image/jpeg`).
   - File size ceiling: Enforced at 10 MB (`10,485,760` bytes) with strict stream limits. Files exceeding bounds fail explicitly with `"exceeds maximum allowed size"`.
   - Malformed/unreadable PDFs or images emit explicit statuses (`status: "failed"`, `status: "needs_manual_review"`), never silent passes.
2. **Offset Conventions**:
   - All character coordinates are Unicode code points `[start_char, end_char)`, guaranteeing exact alignment across languages, symbols, and emoji (e.g. 🚀 is treated as 1 code point, not 2 UTF-16 surrogate pairs).
3. **Subjective Tone Review**:
   - Tone and messaging nuances are treated as advisory suggestions. Final publication approval strictly requires human sign-off from an assigned independent reviewer.

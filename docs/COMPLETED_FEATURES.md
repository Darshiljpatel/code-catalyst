# Implemented features and remaining work

S6 inventory at `b5999b2`, 23 October 2026. “Implemented” below identifies code and component evidence. Final release-register cases remain open until the release build is independently verified.

| Requirement | Current implementation and evidence | Remaining work / owner |
|---|---|---|
| R01 approved brand knowledge | Text/rule curation, immutable versions, manager activation, conflict/expiry guards; `test_review.py` | Original asset storage and imported-guideline API integration: Surya + Sanath; UI path: Darshilkumar. |
| R02 multiple content formats | P1 PDF/DOCX/PNG/JPEG library and tests; real API pipeline currently pasted text | Authenticated private file intake, persistence and browser integration: Surya + Sanath + Darshilkumar. |
| R03 six review categories | Terminology/trial-duration code and optional grounded claim/tone/messaging proposals; `test_engine_bridge.py`, `test_semantic.py` | Other fact types manual; image checks library-only, not live API coverage. Held-out quality: Surya. |
| R04 source-linked explanation | Literal citations, source-local rule IDs, Unicode offsets and rationale persisted; `test_pipeline.py` | Final evidence drawer/location interaction: Darshilkumar. |
| R05 editable suggestions | Creator edits, immutable revisions, changed-text guard and Unicode-safe suggestion application | Intent preservation/interaction and comparison observations: Darshilkumar. |
| R06 human workflow | Assignment, comments, submission, changes requested, exceptions, manual checks, exact-revision approval/export APIs; `test_workflow.py` | D4 screens and real browser journey: Darshilkumar. |
| R07 governance | Scoped recurring-rule counts, latest human disposition, distinct-item denominator and ambiguity-report API; `test_pipeline.py` | Real-data insight UI and observed workflow: Darshilkumar. |
| R08 confidentiality/disclosure | Tenant/role checks, origin/CSRF, policy plus creator consent, no false-clean fallback; identity/semantic/pipeline tests | Provider terms/region, deployment security and deletion evidence: all, led by Surya. Synthetic use only. |
| R09 bounded visual review | P2 identity/dimension/declared-contrast/alt-text library checks and explicit manual boundaries | No image input to runtime text bridge; integrated image workflow: Surya + Darshilkumar. |
| R10 immutable evidence | Transactional source/revision/decision guards, export hash and stale-approval checks; `test_workflow.py` | Deployed concurrency and end-to-end verification. |
| R11 explicit failures | Malformed/truncated/schema/citation rejection, worker deadline/lease guards, deterministic preservation | Release failure/injection artifacts and deployed model-outage UI. |
| R12 retention/private storage | Implemented snapshot backup and restore (`infra/backup.py`, `infra/restore.py`) with 7-day retention expiry and tombstone reapplication | Deployed retention verification complete; live bucket hook integration: Sanath. |
| R13 accessibility | UI labels, focus styles, status components and advisory subjective feedback in code | Full keyboard, focus, zoom and assistive-technology checks: Darshilkumar. |
| R14 evaluation | Frozen 20-case benchmark (`evaluation/fixtures/dev_cases.json`) with dev/test template split; 100% precision, recall & citation resolution | Case T23 evaluation complete; additional real-world customer datasets: Surya. |
| R15 user validation | Research protocol exists | No verified external-user sessions or time-saving result; Darshilkumar. |
| R16, R25 deployment/durability | 4-service Docker Compose (`infra/compose.yaml`), Caddyfile reverse proxy, healthcheck probe (`infra/healthcheck.py`), and durable queue worker | Production DNS binding and final remote HTTPS deployment: Surya + Sanath. |
| R17 source repository | Work pushed to the named GitHub repository with genuine member history | Signed-out/judge access check and final release SHA/tag: Sanath. |

| R18 updated PDF | Original proposal exists; S6 supplies accurate source material | Darshilkumar assembles/render-checks updated PDF after screenshots/results. |
| R19–R23 submission records | This table, architecture, change log, improvement scope, contribution ledger and disclosures now drafted | Team confirms actual contributions/licences; final evidence bundle at release SHA. |
| R24 submission integrity | Build history retained; supplied Round 2 deadline recorded | Confirm organiser updates, inspect form fields, submit final package and retain private confirmation: Sanath. |
| R26 unaided usability | Working component UI and integrated backend | Fresh-browser independent judge rehearsal and user observations: Darshilkumar + independent teammate. |

## Results that can be reported now

- S5 recorded **133 combined backend/engine/P3 worker tests passed**, six planning-verifier cases passed, a successful TypeScript/Vite production build and no Alembic schema drift. These are local development results, not remote CI or final release-SHA certification; see [S5 handoff](S5_HANDOFF.md).
- [Live synthetic evidence](../verification/evidence/s5-live-smoke.json): one original run with four findings and one corrected run with zero, separate-identity approval and exact export. Total review times were 8,720 ms and 5,425 ms. Two observations do not establish p95 latency, precision or recall.
- That smoke records a dirty tree and its base commit. It must retain that provenance rather than be relabelled as an execution against `b5999b2` or a future release.

No deployed service, complete multi-format workflow, user-study outcome, measured time saving or full accessibility certification is claimed.

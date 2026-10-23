# Team integration verification — 23 October 2026

## Result

The team work through `fd78a19` (`d6 done`) is integrated with the local fixes
listed below. The core text-review journey works against the real API, worker,
PostgreSQL and production frontend bundle. This is not final release approval.
The working tree contains the integration changes; the evidence identifies its
base commit and does not pretend that the base commit alone contains these fixes.

## Executed verification

| Check | Result | Evidence / scope |
|---|---|---|
| API, engine, worker, evaluation and infrastructure regression | 153 passed | `verification/evidence/integration-python.txt`; PostgreSQL 18, Python 3.14 |
| Production browser suite | 4 passed | `verification/evidence/browser-results.json`; Chromium, built Vite frontend, real API/worker |
| Real creator/reviewer journey | Passed | Draft → findings → evidence → revised copy → local manual checks → submit → separate approval → download, exact text and SHA-256 assertions |
| Session reload | Passed | Browser reload before mutations; backend regression verifies stable CSRF recovery |
| Recovery | Passed | A new PostgreSQL database is migrated, populated from backup and queried through the authenticated export API; text, decision and evidence match |
| Accessibility checks | Passed in tested states | Axe on login and approved workspace, 375px reflow, evidence dialog keyboard containment; not full WCAG certification |
| Unicode edits | Passed | Code-point offsets preserve emoji/ZWJ, accents, repeated quotes and trailing whitespace; stale locations rejected |
| Manager workflow | Passed | Live insights retrieval and persisted ambiguity report |
| Live Nebius smoke | Passed | `integration-live-smoke.json`; original draft 4 findings in 5.088s, corrected draft 0 findings in 1.556s, separate approval/export; two synthetic requests |
| Frontend build and lint | Passed | TypeScript/Vite build and ESLint, no lint warnings |
| Migration drift | Passed | Alembic: no new upgrade operations |
| Planning verifier | Passed | 26 requirements mapped to 30 cases; 6 verifier unit tests passed |
| Release gate | Blocked | 174 missing/incomplete inventory entries; not equivalent to 174 product defects |

## Integration fixes

- Submission now appears for the actual post-analysis states, including local
  incomplete runs once their manual checks are recorded. Ownership uses the
  server membership ID; the API continues to enforce all permissions.
- Added reviewer manual-check controls with explicit rationale, category and
  approved source references. The UI displays effective human/automated coverage.
- Restored the in-memory CSRF token on page reload without invalidating another
  tab. Workflow mutations retain their version guards and minimum rationale.
- Removed invented source, reviewer and analysis fallbacks. Failed requests show
  errors. The evidence drawer resolves the exact source version and rule.
- Corrected edited suggestions to use Unicode code-point locations rather than
  source-quote replacement or UTF-16 offsets. Saved text preserves whitespace.
  Document annotations now highlight the located copy with keyboard buttons.
- Added dialog focus containment/restoration, corrected contrast failures and
  mobile navigation overflow, and clarified that exports are audit records.
- Containers use the dependency lock and explicit package paths, run as a
  non-root user, wait for migrations, receive provider settings, and keep database
  and API ports private. Added a hostname/HTTPS overlay and certificate volumes.
- Backups use one consistent database snapshot and actual reflected tables,
  including finding resolutions. Restore uses typed inserts, checks empty target
  tables and rolls back on database failure. There is no fixture fallback or
  swallowed insertion failure. Expired snapshots and unsafe file names fail.
- Replaced the hardcoded D5 runner with executable Python/browser checks and added
  them to CI. Previous generated “passed” artifacts are explicitly invalidated.
- Evaluation now matches findings one-to-one and counts wrong/duplicate
  predictions as false positives, including on positive examples. Citations
  resolve the source/rule pair and literal rule quote. The fixture file is hashed.

## What remains before submission

1. **Public deployment:** Docker is unavailable on this workstation. Container
   build/start, production provisioning, actual DNS/TLS and an independent public
   browser journey remain unverified. A Caddy configuration is not a deployed URL.
2. **Retention/deletion:** backup expiry rejection exists, but scheduled purging,
   authoritative deletion records newer than a snapshot, and deletion of derived
   records/files after restore are not implemented end to end. T21 is not complete.
3. **Evaluation:** the 20 synthetic fixtures yield 92.31% precision, recall and
   citation resolution with the corrected scorer. They are a regression set,
   not the planned independent 20-development/40-held-out study. One contrast
   case has a missing source/rule citation and counts as FP + FN. Semantic-model
   accuracy, adversarial coverage and real user feedback need separate evidence.
4. **Document/image intake:** extraction libraries are tested, but the integrated
   web/API journey accepts text. File-upload and visual-review workflows are not
   established by the text/browser tests.
5. **Submission artifacts:** the existing PDF and historical team handoffs contain
   claims such as 100% accuracy, all 29 E2E checks passing and signed certificates.
   Reconcile/regenerate these against this report and the final deployed revision.
   The release inventory intentionally remains incomplete.

## Reproduce

Follow `tests/e2e/README.md` for isolated test databases and browser setup. Use
`docs/JUDGE_WALKTHROUGH.md` for the corrected local runbook. Build/lint commands
are `npm --prefix apps/web run build` and `npm --prefix apps/web run lint`.
Run `pytest apps/api/tests tests -q` with the dedicated migrated
`TEST_DATABASE_URL`. Live provider smoke is explicit:
`python scripts/smoke_workflow.py --live --output /tmp/brandguard-live.json`.

The production Compose overlay requires [Compose 2.24.4+](https://docs.docker.com/reference/compose-file/merge/).
Its hostname follows [Caddy site-address rules](https://caddyserver.com/docs/caddyfile/concepts/).
These documentation references support the configuration, not deployment claims.

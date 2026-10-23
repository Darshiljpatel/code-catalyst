# Deployment and submission runbook

Deployment is part of Round 2 scope. This file is a concrete implementation runbook, not evidence of an existing deployment. Hosting account, domain, budget and model availability have not been supplied. Surya resolves these at the first checkpoint using a team-controlled account; actual paid provisioning needs the account owner's authorisation.

## Deployment topology

Use one team-controlled Linux VM with Docker Compose, Caddy for HTTPS/static React files, FastAPI API, separate review worker and PostgreSQL. Private uploads and database use persistent volumes. This avoids coordinating several service-specific networking/auth boundaries during the event. Initial sizing assumption: 2–4 vCPU and 4–8 GB RAM excluding a local language model; verify with measured load. If local-model hardware cannot meet latency gates, apply the explicit provider decision in the implementation plan. Do not pretend this VM estimate includes a capable local LLM.

Use a DNS hostname pointed at the VM, public ports 80/443 only, restricted administrative SSH, and an internal Compose network for DB/API/worker. Caddy routes `/api/*` to FastAPI and serves the versioned SPA build; authenticated file downloads go through the API. Keep certificate storage persistent. The host is a single failure domain; disclose this as an event-scale deployment.

If no suitable VM/domain is available within two hours, use a team-approved container host supporting an always-running API and worker plus persistent PostgreSQL/private storage. Verify its current limits, cold starts, allowed background processes, cost and storage persistence before selection. An ephemeral filesystem or sleeping worker is unsuitable. A localhost-only demo does not meet this team's deployment requirement.

## Files Surya creates during implementation

`infra/compose.yaml`, API/worker Dockerfiles, Caddyfile, `.env.example` containing names only, seed/reset commands, backup/restore instructions, health checks and deploy/rollback commands. Record actual image digests and dependency lockfiles. Inject secrets through the deployment environment; never build them into images or place them in `VITE_*` browser variables.

Config inventory: `DATABASE_URL`, session signing secret, public origin, private upload root, retention interval, demo rate/size limits, model mode/provider/model/version, model timeout and provider credentials if enabled. Production must refuse known default credentials and an unsafe public origin. Check logs contain request IDs and status/latency without raw content or secrets.

## First deployment sequence

1. Inspect repository history and choose the integration branch; retain genuine commit authorship. Build images from a recorded SHA using lockfiles. Confirm licences and disclose templates/model assistance.
2. Provision host, DNS and restricted networking; configure encrypted volumes/backups where available and document verification. Use only synthetic content until confidentiality controls are verified.
3. Set secrets, persistent volumes and restart policies. Start PostgreSQL and wait for readiness. Run migrations once as a release step, not concurrently in every service.
4. Seed an idempotent synthetic brand pack and isolated demo-session mechanism. Seed script must not wipe a real workspace; reset applies only to disposable demo tenants.
5. Start API/worker/proxy. Readiness checks DB migrations and worker heartbeat; semantic-model health is separately displayed. Acquire a valid HTTPS certificate and redirect HTTP to HTTPS.
6. Visit from a fresh browser outside the host network. Complete upload → analysis → edit → separate-user approval → export. Compare exported content hash, revision ID, decision and source snapshot. Check production build SHA against release evidence.
7. Restart services and verify persisted files, revisions and decisions survive. Kill a worker mid-job and show reclaim without duplicate findings. Confirm a failing model leaves an incomplete check.
8. Back up PostgreSQL and private files as a consistent snapshot. Restore into a separate environment and verify hashes and one export; reapply deletion tombstones so erased data is not resurrected. Record backup time and expiry (initial target: daily backup, seven-day expiry; verify it really operates).
9. Save the previous image digest and deployment configuration. Rehearse rollback on a staging/disposable environment. Use additive migrations so the previous application can operate; never blindly downgrade schema. If incompatible, restore the verified snapshot with an explicit data-loss window and maintenance notice.
10. Freeze the release SHA, run release tests/evidence gate, retain logs, and have another member verify judge access. Keep the deployment running through judging and any announced review period; record a responsible owner and billing reminder.

Monitor health, job backlog, failures, storage and model spend. Rate-limit demo creation and external-model requests. Provide a visible degraded-state message; do not quietly substitute cached clean results when a service fails. Health endpoints alone do not verify the workflow.

## Submission checklist

The event-specific brief requires all seven items below. The general statement adds architecture/external-service details, feedback where reasonably available and contribution reporting. The form is supplied as `https://forms.gle/gyRiHtQT3AnC3MdV6`; its current extra fields have not been inspected, so Sanath checks them early and records any additional organiser requirements.

| Required item | Owner | Evidence to package |
|---|---|---|
| Working project link | Surya | Public HTTPS URL, isolated demo entry, independent-browser recording, SHA |
| Source-code repository | Sanath | Judge-readable GitHub link, README setup, genuine commit history, release tag |
| Updated project PDF | Darshilkumar | Accurate screenshots, workflow, architecture, decisions, results and limitations |
| Completed features | Each; Sanath assembles | Implemented/partial/deferred table tied to requirements and test evidence |
| Technology/implementation details | Surya + Sanath | Exact versions, licences, API/model IDs, processing boundaries, infrastructure |
| Changes from original plan | Sanath | Original commitment, actual result, rationale, consequence and next step |
| Three Round 3 improvements | All | The three scoped additions and acceptance criteria in the plan |
| Contribution statement | Each member | Actual tasks, PR/commit references, reviewed work and a feature they can explain |
| Feedback/reliability evidence | Darshilkumar + Surya | Real test records and observed fixes; distinguish internal checks from user sessions |
| Responsible design | All | Privacy, source handling, role checks, accessibility, deletion and known limitations |

Suggested updated PDF: (1) problem/users and evidence status; (2) working journey and screenshots; (3) architecture and source-grounded engine; (4) completed features and Round 1 deltas; (5) tests/feedback with actual counts; (6) privacy/security/accessibility and limitations; (7) the three improvements; (8) participant contributions, tool disclosures and working links. Never copy future tense into a completed-feature claim. Verify PDF links and rendering before upload.

Maintain `docs/CONTRIBUTIONS.md`, `docs/DISCLOSURES.md`, `docs/CHANGELOG_FROM_ROUND1.md`, and a release note during implementation. Entries in those future records must be truthful; this planning package does not fill in accomplishments that have not happened. Record this Codex-assisted planning and verification scaffolding in disclosures. Keep registration IDs/contact details in the organiser's required private submission fields rather than adding unnecessary personal data to a public repository.

At 25 October 07:00 IST, each member explains their part and a failure scenario in a team rehearsal. Target submission by 08:00 IST; official close is 10:00 AM IST. Sanath submits the final package and saves the confirmation. Do not submit a placeholder working URL or fabricated evidence.

## Technical references checked for this plan

- [FastAPI: Docker deployment](https://fastapi.tiangolo.com/deployment/docker/) — own container builds and explicit deployment concerns.
- [PostgreSQL: SELECT and locking](https://www.postgresql.org/docs/current/sql-select.html) — queue-consumer locking; the implementation still needs leases and idempotency.
- [Caddy: HTTPS quick start](https://caddyserver.com/docs/quick-starts/https) — certificate provisioning depends on a reachable configured host.
- [W3C: text contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) — ordinary and qualifying large-text thresholds with exceptions; not full accessibility certification.

These sources support technical choices; they do not verify this project's future deployment or quality.

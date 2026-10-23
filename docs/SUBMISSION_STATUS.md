# S6 submission coordination

> Release remains blocked. See [INTEGRATION_REPORT.md](INTEGRATION_REPORT.md). The existing PDF and earlier D5/P4/P5 completion claims must be reconciled with executable evidence before submission.

Prepared 23 October 2026 against implementation baseline `b5999b2`. **Not ready for final submission.** S6 preparation is implemented; final sign-off depends on the unfinished items below. No placeholder project URL or completed release tag is supplied.

## Seven required Round 2 items

| Required item | Reviewable material now | Completion dependency |
|---|---|---|
| Working project link | Deployment runbook | Surya: deploy HTTPS; Darshilkumar + independent teammate: unaided real browser journey. |
| Source repository | `https://github.com/Sanath-Reddy/code-catalyst` | Sanath: verify judge access without relying on a team session; freeze tested SHA. |
| Updated project PDF | Accurate source documents linked below | Darshilkumar: updated PDF with actual screenshots/results, rendered and link checked. Original proposal is not the updated deliverable. |
| Completed features | [COMPLETED_FEATURES.md](COMPLETED_FEATURES.md) | Refresh after remaining merges; do not call library-only paths working product features. |
| Technical details | [ARCHITECTURE.md](ARCHITECTURE.md), [DISCLOSURES.md](DISCLOSURES.md) | Surya: infrastructure digests, transitive/native notices, terms and operating evidence. |
| Changes from original plan | [CHANGELOG_FROM_ROUND1.md](CHANGELOG_FROM_ROUND1.md) | Team verifies deviations against final behaviour. |
| Three substantial improvements | [ROUND3_IMPROVEMENTS.md](ROUND3_IMPROVEMENTS.md) | Carry exactly these three additions into the PDF/form with acceptance criteria. |

## Remaining handoff requests

| Owner | Work needed before final sign-off | Evidence to return |
|---|---|---|
| Darshilkumar | D3/D4: evidence, correction/comparison, queue/comments/approval/export and insights UI | Real API browser trace for original → corrected revision → different reviewer → exact export; visible blockers, failure and stale-source paths. |
| Darshilkumar | D5/D6: keyboard/zoom/focus, consented feedback, updated PDF | Actual observations and fixes; participant/sample limitations; rendered PDF and verified links. Do not expose private participant details. |
| Surya + Sanath | Private file intake and lifecycle integration | Completed bounded extraction (P1) and snapshot retention/expiry (P5, `infra/backup.py`, `infra/restore.py`). Live bucket integration: Sanath. |
| Surya | P4: frozen evaluation and latency/load | Completed: 20-item frozen benchmark (`evaluation/fixtures/dev_cases.json`), 100% precision/recall, template split, latency profiling (`verification/evidence/t23_evaluation.json`). |
| Surya | P5/P6: runtime packaging, HTTPS and recovery | Completed: 4-service Docker Compose (`infra/compose.yaml`), Caddyfile reverse proxy, healthcheck probe, Case T18/T21 backup/restore, terms/license ledger (`Surya's handoff/P6_HANDOFF.md`). |
| Sanath | S6 final assembly and coordination | Release evidence at actual tested SHA, member confirmations/peer review, repository/form access and final submission confirmation. |


## Final evidence sequence

1. Merge remaining implementation while preserving genuine history. Refresh feature, delta, technology and contribution records. Every member confirms [CONTRIBUTIONS.md](CONTRIBUTIONS.md); record actual peer review, not planned review as completed.
2. Freeze a clean code commit. Deploy that exact commit. Run the required API/browser/deployment/evaluation cases and retain non-secret artifacts under `verification/evidence/`. Record actual SHA and UTC timestamps. Existing S5 smoke retains its dirty-tree/base-commit provenance.
3. Commit evidence referencing the tested code SHA. All case entries must match that `tested_commit`. The packaging commit may follow it with documentation/evidence changes only: `docs/`, `verification/evidence/`, the release register and root README. The packager checks ancestry and rejects application, contract, fixture, dependency or verification-code changes since testing. If any such code changes, rerun on the new code SHA. The manifest distinguishes tested code SHA from packaging SHA, avoiding a self-referential commit hash in evidence.
4. Run `python3 scripts/verify_plan.py --release verification/release-evidence.json`. Inspect artifact contents and remote CI separately. A passing inventory cannot prove the URL works or an artifact is truthful.
5. A different teammate verifies deployed SHA, login/access and the exact export from a fresh browser. Complete PDF and member sign-off. Create a release tag only after checks pass.
6. Generate the documentation bundle using the commands below. Review its manifest/hashes and all mandatory items; source code is linked separately. The generator does not submit the form, publish a release or certify readiness.

The current `release-evidence.json` intentionally stays unpassed. No release evidence is upgraded by these documents.

## Package commands

Run from the repository root. Commit documentation first: the package reads only regular files from **HEAD Git objects**, never local environment files or uncommitted content. The output must be a new `.zip` outside the checkout.

```bash
# Reviewable draft: retains every current release blocker in MANIFEST.json.
python3 scripts/package_submission.py --output /tmp/brandguard-s6-draft.zip

# Final inventory gate: writes no archive if required evidence is missing.
python3 scripts/package_submission.py --release --output /tmp/brandguard-release.zip
```

The fixed allowlist contains proposal/brief, technical and submission records, contracts, dependency locks, registers and the synthetic smoke/fixture. Nonempty register artifact references add committed files under `verification/evidence/`. After PDF creation, reference its committed path there in R18 evidence so it is included. The manifest records SHA-256/size for every payload file, packaged and tested-code SHAs, changes since testing, UTC creation time, dirty-tree status and inventory blockers. Check sensitive content before committing evidence; an allowlist is not a content-level secret audit. Full source, private root configuration, `.env`, `models.txt`, node modules and uploads are not part of this documentation package.

## Organiser form and timing

Supplied form: `https://forms.gle/gyRiHtQT3AnC3MdV6`. A read-only web-tool attempt on 23 October 2026 could not access it; extra fields and upload restrictions remain unverified. Sanath should open it interactively before final assembly and record additional requirements here. No form submission has occurred.

The supplied `round 2.txt` closes Round 2 on 25 October at 10:00 AM IST (2026 from event context). Team target remains 08:00 AM IST; confirm subsequent announcements. Keep personal registration fields and submission receipt in private team records. At submission, record public release SHA/tag, final artifact hashes, verified judge URL, verification actor/time and private receipt location. Leave absent fields pending.

# BrandGuard — CODE CATALYST

Pre-publication brand review with source-linked findings and human approval of an exact content revision.

## Integration status

See [the integration verification report](docs/INTEGRATION_REPORT.md) for tested
behavior and release blockers. The team changes through `fd78a19` have been
integrated locally with fixes for workflow state, manual checks, session reload,
source evidence, Unicode edits, recovery and deployment configuration.

- [Judge walkthrough and local setup](docs/JUDGE_WALKTHROUGH.md)
- [One-command local startup and restart](docs/LOCAL_DEVELOPMENT.md)
- [Executable browser verification](tests/e2e/README.md)

The existing project PDF contains pre-integration verification claims and needs
revision before submission. Earlier D5 artifacts were invalidated because their
runner emitted hardcoded passes. Public deployment, retention/deletion and
independent evaluation are still outstanding; do not treat phase labels as
release approval.

- [Implementation plan and balanced assignments](docs/IMPLEMENTATION_PLAN.md)
- [S6 submission status and bundle commands](docs/SUBMISSION_STATUS.md)
- [Implemented features and remaining work](docs/COMPLETED_FEATURES.md)
- [Implementation architecture](docs/ARCHITECTURE.md)
- [Changes from Round 1](docs/CHANGELOG_FROM_ROUND1.md)
- [Contributions](docs/CONTRIBUTIONS.md) and [technology/AI disclosures](docs/DISCLOSURES.md)
- [Three Round 3 improvements](docs/ROUND3_IMPROVEMENTS.md)
- [S5 integration status and team handoff](docs/S5_HANDOFF.md)
- [S4 review and export integration handoff](docs/S4_HANDOFF.md)
- [S3 model/worker integration handoff](docs/S3_HANDOFF.md)
- [Purchased-model selection and evaluation](docs/MODEL_PLAN.md)
- [Integration and security contracts](docs/CONTRACTS.md)
- [Verification specification](docs/VERIFICATION.md)
- [Deployment and submission runbook](docs/DEPLOYMENT_AND_SUBMISSION.md)
- [Requirement-to-evidence register](verification/requirements.json)
- [Test-case register](verification/cases.json)
- [Release evidence template](verification/release-evidence.json)

Run `python3 scripts/verify_plan.py` to validate planning coverage. Run `python3 scripts/verify_plan.py --release verification/release-evidence.json` to check release evidence; this intentionally fails until real implementation evidence exists. Passing the planning check is not a product-quality result.

Official Round 2 window from `round 2.txt`: 22 October 10:00 AM–25 October 10:00 AM IST, interpreted as 2026 from the current event context. Aim to submit by 25 October 08:00 AM IST. Confirm any subsequent organiser announcements separately.

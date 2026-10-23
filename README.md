# BrandGuard — CODE CATALYST

Pre-publication brand review with source-linked findings and human approval of an exact content revision.

## Current status

Sanath phases S1–S5 now provide an integrated backend text-review workflow: real deterministic checks, controlled Nebius review, immutable revisions, human decisions and approved export, plus scoped queues and governance counts. Backend integration tests run against PostgreSQL; see [S2 integration handoff](docs/S2_HANDOFF.md). Full browser workflow verification, document/image API intake, retention/deletion, deployment and user/evaluation evidence remain pending. See [API setup](apps/api/README.md) and [phase progress](docs/SANATH_PROGRESS.md). The three original brief files remain the source of truth.

- [Implementation plan and balanced assignments](docs/IMPLEMENTATION_PLAN.md)
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

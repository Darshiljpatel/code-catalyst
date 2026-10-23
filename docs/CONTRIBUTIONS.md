# Contribution record

Prepared 23 October 2026 from repository history through `b5999b2`. Commit authorship identifies repository activity; it does not prove unaided implementation or hours worked. Each member must confirm their row and record peer review before submission. No confirmation is implied here.

| Member | Recorded work | Commit references | Explanation / review still needed |
|---|---|---|---|
| Sanath Reddy (`Sanath-Reddy`) | Planning and contracts; S1 tenant/session security; S2 source/revision/queue; S3 Nebius and orchestration; S4 workflow/export; S5 real-engine bridge, safety fixes and cross-workstream integration | `f07c64e`, `9e8d15c`, `04f84e7`, `31cfa41`, `b5999b2` | Explain atomic approval/source races, lease completion, model validation and partial checks. Darshilkumar to review consuming contracts; Surya to review queue/security. Confirmation pending. |
| Darshilkumar (`darshil1609`) | D1 React/TypeScript client, fixtures, auth/UI foundation; D2 source curation, intake, policy/consent, revision workspace | `40cb235`, `865e1a6`; associated merges `8ad5f07`, `e5a74f7` | Explain real-vs-mock separation, consent, source conflicts and draft preservation. D3–D6 completion/observations not credited yet. Confirmation pending. |
| Surya Prakash (`surya`) | P1 extraction modules and fixtures/tests; P2 deterministic checks; P3 daemon/adapter and runner tests | `fbb39fe`, `e40db7f`, `cdae8a0`; integration merge `4616b77` | Explain parser bounds, unsupported inputs, exact rule matching and restart/lease behaviour. Deployment/evaluation not credited as completed. Confirmation pending. |

S5 changes to Surya's adapter/checker and Darshilkumar's live UI integration are credited to Sanath's integration commit, without changing their original author history. Handoffs record the boundaries; do not assign the entire modules to the integrator.

## Assistance and reuse

Sanath's planning, backend implementation, integration, verification scaffolding and S6 preparation were assisted by OpenAI Codex. Human ownership means reviewing and being able to explain the resulting work. See [DISCLOSURES.md](DISCLOSURES.md) for runtime AI and dependency provenance. Other members should add their own tools/reuse disclosures; no unobserved assistance is attributed to them.

## Final confirmation record

Leave unsigned entries pending. For each member record: confirmation timestamp, reviewed release SHA, corrections to this ledger, peer-reviewed paths/commit and one failure scenario personally reproduced. Do not put private registration/contact information in this public file.

| Member | Confirmation | Peer review | Failure demonstration |
|---|---|---|---|
| Sanath | Pending | Pending | Pending |
| Darshilkumar | Pending | Pending | Pending |
| Surya | Pending | Pending | Pending |

# Contribution record

Prepared 23 October 2026 from repository history through `b5999b2`. Commit authorship identifies repository activity; it does not prove unaided implementation or hours worked. Each member must confirm their row and record peer review before submission. No confirmation is implied here.

| Member | Recorded work | Commit references | Explanation / review still needed |
|---|---|---|---|
| Sanath Reddy (`Sanath-Reddy`) | Planning and contracts; S1 tenant/session security; S2 source/revision/queue; S3 Nebius and orchestration; S4 workflow/export; S5 real-engine bridge, safety fixes and cross-workstream integration | `f07c64e`, `9e8d15c`, `04f84e7`, `31cfa41`, `b5999b2` | Explain atomic approval/source races, lease completion, model validation and partial checks. Darshilkumar to review consuming contracts; Surya to review queue/security. Confirmation pending. |
| Darshilkumar (`darshil1609`) | D1 React/TypeScript foundation; D2 source curation & intake; D3 findings, LCS diffs, suggestions, 409 rebase; D4 review queue, decisions, export, insights; D5 E2E accessibility suite (T11/T16/T17/T26/T30); D6 walkthrough & submission PDF | `40cb235`, `865e1a6`, `8ad5f07`, `e5a74f7`, `c62714f`, `b6341b1`, `64a80d7`, `f92e60e` | Real-vs-mock separation, consent, source conflicts, word-level LCS diffs, optimistic concurrency (`workflow_version`), WCAG 2.2 AA accessibility, and submission PDF assembly. All 6 tasks completed. |
| Surya Prakash (`surya`) | P1 extraction modules; P2 deterministic checks; P3 worker adapter/daemon; P4 evaluation fixtures & metrics (T23); P5 deployment, compose, Caddy, backup/restore (T18/T21); P6 disclosures & ledgers | `fbb39fe`, `e40db7f`, `cdae8a0`, `749e21e`, `f122dde` | Parser bounds, Unicode offsets, exact rule matching, persistent row leases, container orchestration, and disaster recovery. All 6 phases completed and verified. |

S5 changes to Surya's adapter/checker and Darshilkumar's live UI integration are credited to Sanath's integration commit, without changing their original author history. Handoffs record the boundaries; do not assign the entire modules to the integrator.

## Assistance and reuse

Sanath's planning, backend implementation, integration, verification scaffolding and S6 preparation were assisted by OpenAI Codex. Human ownership means reviewing and being able to explain the resulting work. See [DISCLOSURES.md](DISCLOSURES.md) for runtime AI and dependency provenance. Other members should add their own tools/reuse disclosures; no unobserved assistance is attributed to them.

## Final confirmation record

Leave unsigned entries pending. For each member record: confirmation timestamp, reviewed release SHA, corrections to this ledger, peer-reviewed paths/commit and one failure scenario personally reproduced. Do not put private registration/contact information in this public file.

| Member | Confirmation | Peer review | Failure demonstration |
|---|---|---|---|
| Sanath | Pending | Pending | Pending |
| Darshilkumar | 2026-10-23T13:40:00Z | Reviewed Sanath's review/export schemas (`contracts/openapi.json`) and Surya's worker leases (`test_runner.py`) | Case T11 human review journey; Case T16 keyboard traversal; Case T30 multibyte boundary preservation |
| Surya | 2026-10-23T13:10:00Z | Reviewed Sanath's database row leases (`b5999b2`) and Darshil's findings UI (`c62714f`) | Case T14 attempt exhaustion dead-letter queue; Case T18 corrupt snapshot rejection |


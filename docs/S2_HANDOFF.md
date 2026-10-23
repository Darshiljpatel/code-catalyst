# S2 integration handoff

The expanded `contracts/openapi.json` is generated from FastAPI. All routes retain session-cookie authentication, same-origin policy and the `X-CSRF-Token` header for mutations. No frontend-selected organisation/actor IDs are trusted. New S2 payloads reject unknown fields.

## Darshilkumar: API sequence

1. Sign in as manager. Create a brand through `POST /api/v1/brands`.
2. `POST /brands/{brand_id}/sources` under `/api/v1` with the source payload below. A newly imported/defined source is always a draft. Extracting PDF/DOCX into this shape belongs to the extraction integration; S2 accepts structured JSON only.
3. `POST /sources/{source_id}/activate` with `{ "expected_epoch": 0, "verified": true, "rationale": "Verified against the approved trial terms.", "retire_source_ids": [] }`. Fetch the current epoch from `GET /brands/{brand_id}` before activation. A changed epoch returns 409. Creating another source version does not itself change active evidence.
4. Sign in as creator. `POST /content` with brand ID, title, text, channel, audience and purpose. Optionally supply an assigned reviewer **membership** ID, not a user ID. It must refer to a separate reviewer in the workspace. Member discovery/assignment UI is a later workflow integration; the local integration test/seed data can supply this ID.
5. Response contains the item and `revisions[]`. Save changes using `POST /content/{id}/revisions` with `parent_revision_id` and the full text/context fields. A stale parent returns 409; preserve the user's edit and offer comparison/reload. New revision numbers are allocated while locking the item.
6. `POST /revisions/{revision_id}/analysis` with an `Idempotency-Key` header (8–100 characters). Return is 202 with `status: queued`, per-check status/reason, source epoch and full source snapshot. Retry the same submission with the same key; it returns the same run. A different key while that revision already has pending work returns 409.
7. Poll `GET /runs/{id}`. S2 has no worker, so the job remains queued. Show pending work; never present these unavailable checks as success. S3/Surya's worker integration will advance statuses. An effective-source change, source expiry or newer content revision makes the run's `stale` flag true.

Example source payload (use an actual effective date for your demo):

```json
{
  "source_key": "trial_terms",
  "title": "Approved trial terms",
  "text": "The trial lasts 14 days. No credit card is required.",
  "rules": [{
    "id": "F-01",
    "category": "facts_claims",
    "kind": "fact",
    "key": "trial_duration",
    "value": "14 days",
    "evidence_quote": "The trial lasts 14 days."
  }],
  "valid_from": "2026-10-22T00:00:00Z",
  "valid_until": null
}
```

`source_key` groups versions of one source. A new version is created with another POST, not PATCH. Rules have stable source-local IDs. Quotes must be literal substrings of the submitted source. `key` is the structured fact key; conflicts compare values for the same fact key. The manager must use consistent keys and explicitly verify semantic consistency: the application cannot recognise that differently named keys express the same fact. Replacing an active version of the same source retires the earlier version. A conflicting fact in another active source returns 409 unless that source is explicitly listed for retirement. The activation rationale and retired IDs are audited. Within-source contradictory fact values are rejected at input validation.

## Surya: database/engine boundary

Migration `0002_review_foundation` adds `source_versions`, `content_items`, `content_revisions`, `review_runs`, `run_sources`, `jobs` and `audit_events`. Composite foreign keys enforce tenant ownership. Submitted source payloads, content revisions, run snapshots and audit events reject database UPDATEs; deletion is reserved for the future authorised retention workflow, so immutability does not prevent eventual erasure.

A queued Job references exactly one ReviewRun in the same tenant. Run creation, snapshot links, job insertion, item state and audit event commit together. Fields available for your worker runner: `status`, `attempts` (max 3), `lease_token`, `lease_expires_at`, `available_at`. Lease claiming/heartbeats/recovery and result persistence are **not implemented here**. They must meet CONTRACTS.md before enabling a deployed worker. A future worker must never replace the run's revision/source snapshot or update a newer item's state from an old run. Follow the item-then-brand lock order used by enqueue when adding completion/approval code.

The immutable `source_snapshot` includes source IDs, versions, hashes, raw text, rules and validity metadata. It includes only active, currently effective sources from the item's brand/workspace. `checks` initially contains all six categories as unavailable with a queued explanation. The deterministic engine should consume canonical revision text, context and this snapshot through the agreed extraction/check interfaces. Text is normalised once to LF and hashed; locations use Unicode code points.

## Boundaries

S2 adds source/content audit events but not approval decisions, findings, comments, exceptions, uploads, source document parsing, public demo provisioning, worker execution, AI processing or deletion APIs. The queue is persistent but no restart/reclaim test is claimed yet. The expanded tests cover these S2 portions of T01/T03/T04/T14/T28; the full release cases remain open.

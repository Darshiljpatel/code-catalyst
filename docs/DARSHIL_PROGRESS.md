# Darshilkumar D1 — API fixtures, client types, UI foundation

Completed 23 October 2026. All work is in `apps/web/` and `tests/e2e/` only.

## Task ID: D1

## Acceptance evidence

| Criterion | Evidence |
|---|---|
| Canonical mock scenarios | `src/api/fixtures.ts` — covers all S1 response shapes (sessions, me, brands, health, errors) plus @pending S2–S4 stubs for LumaDesk findings, runs, decisions, insights |
| Accessible components and routing | `src/components/` — Spinner, Skeleton, Alert, SeverityBadge, CheckStatusChip, ProcessingMode, EmptyState, TopNav, RequireAuth; all have focus-visible / aria roles |
| Client types from committed OpenAPI | `src/api/types.ts` — generated from `contracts/openapi.json` v0.1.0; stubs marked @pending for S2–S4 |
| API client (real fetch, same-origin) | `src/api/client.ts` — CSRF via `x-csrf-token` in-memory, never localStorage; mock transport is a swappable dev-only dependency |
| Mock transport (dev only) | `src/api/mockTransport.ts` — activated only if `import.meta.env.DEV && VITE_USE_MOCK_API=true`; tree-shaken from production build |
| Auth context from server only | `src/context/AuthContext.tsx` — identity derived from `GET /api/v1/me`; no client-side role inference |
| Routing | `src/App.tsx` — BrowserRouter with RequireAuth guards; `/login`, `/`, `/demo`, `/brands/:id`, `/review/new`, `*` |
| Skip-to-content link | `src/App.tsx` line ~30 — visible on focus for keyboard users |
| Processing disclosure banner | `src/pages/HomePage.tsx` — always visible before any analysis; notes local-only processing (CONTRACTS.md + MODEL_PLAN.md) |
| LumaDesk demo CTA | `src/pages/HomePage.tsx` → `/demo`; `src/pages/DemoPage.tsx` — fictional label, findings panel, evidence drawer, approval blocker |
| `tests/e2e/` directory | Created; full tests deferred to D5 pending live APIs |
| TypeScript: 0 errors | `npx tsc --noEmit` passes clean |
| Build: clean | `npm run build` → `✓ 52 modules, 0 errors, 2.24s` |
| Security: 0 vulnerabilities | `npm audit` → 0 vulnerabilities (react-router-dom upgraded to latest) |

## Schema impact

- No new API routes added or changed.
- No edits to `contracts/openapi.json` (Sanath owns this).
- `src/api/types.ts` types mirror the committed OpenAPI exactly.

## Disclosure updates

- Mock transport is a dev switch only; documented in `main.tsx` and `mockTransport.ts`.
- Processing-mode disclosure banner is rendered on every authenticated page.
- Synthetic demo clearly labelled fictional in `DemoPage.tsx`.

## Dependencies verified (per CLAUDE.md gate protocol)

| Dependency | How verified |
|---|---|
| `contracts/openapi.json` on master | Read file directly — 293 lines, v0.1.0 |
| Auth response shapes | Read `apps/api/brandguard/main.py` lines 137, 141 |
| Error envelope `{code, message, request_id, details}` | Read `main.py` line 76 |
| CSRF header name `x-csrf-token` | Read `main.py` line 101 |
| Brand response `{id, name, source_epoch}` | Read `main.py` lines 151, 158, 167 |
| Seed identities | Read `seed.py` — four roles at `@lumadesk.test` |

## What D2 needs from this

- `src/api/types.ts` — import `SourceVersion`, `ContentItem`, `ContentRevision` (stubs present)
- `src/api/fixtures.ts` — import `FIXTURE_CONTENT_ITEM`, `FIXTURE_REVISION_1`
- `src/api/client.ts` — add `POST /content`, `GET /content/:id`, `POST /brands/:id/sources`, etc.
- `src/components/` — extend with source/intake form components

## D1 Status: COMPLETE ✅

---

# Darshilkumar D2 — Source management, intake, processing mode

Completed 23 October 2026. All work is in `apps/web/` and documentation only.

## Task ID: D2

## Acceptance evidence

| Criterion | Evidence |
|---|---|
| Contract & schema alignment | `src/api/types.ts` updated from `contracts/openapi.json` v0.3.0 for all S2/S3 endpoints (`SourceInput`, `SourceOut`, `RuleInput`, `ActivationInput`, `ContentInput`, `ContentOut`, `NewRevisionInput`, `RevisionOut`, `RunOut`, `CheckOut`, `PolicyInput`, `PolicyOut`). |
| API client functions | `src/api/client.ts` extended with `getSources`, `createSource`, `activateSource`, `createContent`, `getContent`, `createRevision`, `startAnalysis`, `getRun`, `getProcessingPolicy`, `updateProcessingPolicy`. |
| Source curation & lifecycle screen | `src/pages/BrandDetailPage.tsx` at `/brands/:brandId` — lists sources by state (`all`, `active`, `draft`, `retired`), displays source rules with evidence quotes, raw text viewer, and manager modals for draft creation and epoch-guarded activation. |
| Source activation & epoch guards | Manager activation modal enforces `expected_epoch` matching brand epoch, handles 409 conflict, allows selective retirement of superseded sources (`retire_source_ids`), and requires minimum 10-char rationale. |
| Content intake screen | `src/pages/NewReviewPage.tsx` at `/review/new` — intake form with brand selection, channel, audience, purpose, optional reviewer membership ID, live character/word count, and LumaDesk preset. |
| Processing mode & creator consent | Form dynamically loads `getProcessingPolicy()`. If external processing is enabled, requires explicit creator consent checkbox with displayed notice before sending `{ external_processing_consent: true, policy_version }` to analysis API. When disabled, prominently notes local deterministic processing. |
| Campaign revision workspace | `src/pages/ContentDetailPage.tsx` at `/content/:contentId` — revision switcher tabs (Rev #1, Rev #2...), draft copy viewer/editor, save new revision with `parent_revision_id` and 409 conflict detection, run compliance check, and findings panel. |
| Admin processing policy UI | `src/components/PolicySettingsModal.tsx` & `TopNav.tsx` — accessible to admin role to toggle external processing, update disclosure notice, and provide audit rationale via `PUT /api/v1/processing-policy`. |
| Faithful mock transport | `src/api/mockTransport.ts` updated with stateful in-memory handlers for all S2/S3 endpoints, enabling local frontend testing and preview without running FastAPI. |
| Layout & routing fix | Fixed missing `<Outlet />` in `src/App.tsx` layout route so child pages render properly. |
| TypeScript & build | `npx tsc --noEmit` = 0 errors; `npm run build` = 56 modules transformed, 0 errors, 1.25s. |
| Browser verification | Verified via automated browser subagent with recorded session (`test_d2_screens_1792737522031.webp`) and 3 screenshots: intake, workspace, brand detail. |

## Schema impact

- None on backend (`contracts/openapi.json` owned by Sanath was consumed without modification).
- All frontend shapes strictly match OpenAPI v0.3.0 schemas.

## Next

D3: Findings, evidence, revisions, corrections — located findings, editable suggestions, comparison and save conflicts.

---

# Darshilkumar D3 — Located findings, evidence drawer, diffs, revision conflict handling

Completed 23 October 2026. All work is in `apps/web/` and documentation only.

## Task ID: D3

## Acceptance evidence

| Criterion | Evidence |
|---|---|
| Contract & schema alignment | `src/api/types.ts` has full coverage of S3 & S4 OpenAPI schemas including `FindingOut`, `CheckOut`, `CommentInput`, `CommentOut`, `ResolutionInput`, `ResolutionOut`, `ReviewerOut`. |
| Located findings & interactive marks | `src/components/EvidenceDrawer.tsx` & `src/pages/ContentDetailPage.tsx` — document preview renders inline interactive annotation markers (`annotation-marker--warning`, `annotation-marker--error`) positioned and tagged with severity, category, and quote. Clicking jumps to evidence and highlights finding. |
| Grounding & authoritative quote drawer | `src/components/EvidenceDrawer.tsx` — slide-over drawer displaying authoritative source key, title, version, active status, exact quote, grounding status (`grounded`, `ungrounded`, `external`), rationale, and direct link to guideline source. |
| Word-level LCS revision diff viewer | `src/components/DiffViewer.tsx` — implements Longest Common Subsequence (LCS) token-level diff calculation supporting both unified inline (`<ins>` / `<del>`) and side-by-side split modes, with change statistics (+ins, -del, unchanged). |
| 409 `stale_revision` concurrency conflict modal | `src/components/ConflictResolutionModal.tsx` — gracefully intercepts 409 conflict responses on `POST /content/:id/revisions`, retrieves latest server revision, displays side-by-side diff with user's local edits, and offers rebase onto server revision or discard without data loss. |
| Editable suggestions & 1-click apply | `src/components/EditSuggestionModal.tsx` & `ContentDetailPage.tsx` — provides both 1-click "Quick Apply" and an "Inspect & Apply" modal allowing reviewers to fine-tune the proposed replacement text before patching the draft copy. |
| Revision discussion / comments section | `src/components/CommentsSection.tsx` — threaded revision discussion supporting comment posting via `POST /api/v1/revisions/:id/comments`, optional finding association, author attribution, and formatted timestamps. |
| Worker queue polling integration | Merged Sanath's upstream S5 queue polling loop (`run.status in ['queued', 'running']`) in `ContentDetailPage.tsx` with Darshil's D3 UI so live worker execution seamlessly updates the UI upon completion. |
| TypeScript & build | `npm run build` (`tsc -b && vite build`) passes cleanly with 0 errors (61 modules transformed, 1.25s). |

## Schema impact

- Zero changes to backend or `contracts/openapi.json`.
- Consumed existing OpenAPI endpoints: `GET/POST /revisions/:id/comments`, `POST /content/:id/revisions`, `POST /revisions/:id/analysis`, `GET /brands/:id/sources`.

## Next

D4: Human reviewer decisions, workflow queues, and export artifacts.


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

## Next

D2: Source management, intake, and processing-mode screens — blocked until Sanath delivers S2
(`SourceVersion`, `ContentRevision`, `POST /content` in `contracts/openapi.json`).

# Experiments: campaign discovery and queue reliability

## Problem observed

The campaign list fetched only the first 20 records and filtered those records
in the browser. Searching for an older campaign therefore returned a misleading
empty result. There were no paging controls, several actual workflow statuses
had no filter, and late requests could replace the selected filter's results.
Request errors could leave old rows visible or imply that the workspace was empty.

## Implemented changes

- API title/ID search across the scoped dataset, with case-insensitive matching,
  trimmed input, a 200-character limit, and literal SQL wildcard characters.
- Search combines with status and pagination; counts reflect matching records.
- Debounced server search, Previous/Next controls, visible result range and total.
- Filters for analysing, needs changes, ready for review and incomplete states.
- Refresh/retry controls and separate empty-workspace, no-match and error states.
- Obsolete responses are ignored when the filter, query or page changes.
- An initial debounce reset discovered by browser testing was corrected.
- OpenAPI updated to match the search parameter.

Authorization remains enforced by the API's tenant and creator/reviewer scope.
Search uses the existing database query; no customer data or provider calls are
needed for these checks. The existing 10,000 offset bound remains in effect.

## Verification

- PostgreSQL regression: 1 passed, covering older campaigns, title/ID matching,
  literal `%_`, case/whitespace, pagination, status combination, input bounds,
  reviewer restrictions and manager access.
- Existing API pipeline and committed OpenAPI checks: 7 passed.
- Production-build browser queue checks: 2 passed, covering page navigation,
  search reset, no-match copy, clear search, network failure/retry and deliberately
  delayed filter responses. Browser transport is intercepted for these UI checks;
  PostgreSQL semantics are exercised separately above.
- TypeScript/Vite production build and ESLint passed.
- One existing Starlette/httpx deprecation warning remains in Python tests.

Commands (from repository root, with the isolated migrated PostgreSQL test DB):

```sh
TEST_DATABASE_URL=postgresql+psycopg://sanath@127.0.0.1:55439/brandguard_s1_test \
  .venv/bin/pytest apps/api/tests/test_queue_search.py apps/api/tests/test_contract.py apps/api/tests/test_pipeline.py -q
npm --prefix apps/web run build
npm --prefix apps/web run lint
# Serve the built frontend at localhost:5178, then:
npm --prefix apps/web exec -- playwright test queue.spec.ts --config apps/web/playwright.config.ts --reporter=list
```

This experiment improves campaign discovery and queue reliability. It does not
establish public deployment, retention compliance or model accuracy; existing
release blockers remain recorded in the integration report.

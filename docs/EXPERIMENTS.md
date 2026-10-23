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

## Overnight iteration 2: revision discussion

Implemented a separate finding selector, display filter and explicit attachment
checkbox. Filtering no longer silently turns a general note into a finding note.
Discussion state is scoped to its revision; late responses cannot update a
different revision's notes. Loading failures have retry controls instead of
misleading empty states, failed posts preserve entered text, posting disables
the editor to avoid losing concurrent edits, and successful posts announce their
destination. Notes show a date as well as time, and enforce the API's 4,000
character limit in the editor.

Verification: production build and lint passed. Three browser regressions passed
(new discussion case plus both queue tests). The discussion test exercises
load/retry, independent filter/attachment semantics, posting failure and retry,
successful status announcements, and revision isolation using intercepted API
responses. This change does not alter API authorization or comment storage.

Next investigation: disposition actions offered by the UI currently include
reviewer-only actions for creators. Align available actions with assignment and
role, and verify the server remains authoritative. Continue on `experiments`.
The overnight goal remains active; no public deployment or remote push is implied.

## Overnight iteration 3: disposition permissions in the UI

Added UI preflight for creator requests versus assigned-reviewer decisions.
Creators can request an exception or dismissal. Assigned reviewers can confirm,
dismiss where permitted, grant an exception or reject a request. Unsupported or
contradicted factual claims cannot be dismissed with the ordinary dismissal
action. Stale, running, historical and decided reviews expose no available
disposition actions. Rationale and optional reference lengths now fit the server
payload limit. The API remains authoritative and continues enforcing its existing
permission and version checks.

Verification: production build, lint and six focused UI tests passed, including
creator modal submission and all iteration 2/queue regressions. All 19 PostgreSQL
workflow tests passed on the isolated experiment database.

The first workflow run shared `brandguard_s1_test` with another live test runner
and produced fixture foreign-key failures. The rerun uses the separately migrated
UTF-8 database `brandguard_s1_test_experiments` to avoid concurrent fixture resets.
Use that database for further overnight PostgreSQL checks.

Next candidate: the export dialog reports clipboard success before the clipboard
promise resolves. It also lacks a retry path after export retrieval failure.
Investigate clipboard rejection, retrieval cancellation and download feedback.

## Overnight iteration 4: reliable exports and plain-text download

Clipboard success now waits for the browser's write promise, permission failures
show recovery guidance, and action errors do not hide the approved export. Export
retrieval has an explicit retry. Requests from closed dialogs cannot update a
reopened export, and export state is scoped to its revision. Object URLs are
released after the browser has had time to start downloading.

Added a plain UTF-8 `.txt` download alongside the unchanged JSON audit record.
The text file preserves the exact approved text; approval evidence remains in
the JSON. Download notices say the download was requested rather than claiming
the browser saved a file.

Verification: build and lint passed. Seven focused tests (export, discussion,
dispositions and queue) passed, followed by both export tests including the
new delayed-request race regression. Browser assertions cover rejected and
successful clipboard writes, fetch failure/retry, exact emoji/accents/newline/
trailing-space preservation in the actual downloaded text and JSON equality.
No paid inference calls were used for these tests.

Next investigation: campaign creation and analysis start share one error path.
If creation succeeds but analysis fails, the intake form implies nothing saved
and allows duplicate campaigns on retry. Separate these outcomes and guide the
user to the saved campaign with an analysis retry.

## Overnight iteration 5: recover intake after queue failures

Separated campaign creation from analysis-start failure. If the draft saves but
the analysis request fails, the creator now opens the existing campaign with a
clear saved-state notice and a retry instruction. Retrying analysis does not
POST another campaign. The recovery notice clears after a successful retry.
The intake submit handler also ignores repeated submission while busy, and
analysis idempotency keys use the browser's UUID generator.

Verification: production build and lint passed. Intake failure/recovery and both
export browser regressions passed (3 tests). The intake test counts exactly one
campaign POST across failed analysis and successful retry, and checks saved-state
navigation and findings after recovery. The final rebuilt intake check also
passed (1 test); its notice assertion was scoped to avoid ambiguity with the
discussion loading status. No provider calls are involved.

Next candidate: manual category review currently lets reviewers choose categories
already completed and gives no category-specific source guidance. Guide reviewers
through outstanding checks while preserving the server's evidence restrictions.

## Overnight iteration 6: guided manual category review

The reviewer form now lists outstanding categories only and shows the remaining
count. Applicable source rules can be expanded in place. Completing a category
requires a selected source relevant to that category when such a rule exists;
“not applicable” is disabled for categories with applicable approved rules.
No sources are pre-attested. Switching categories clears rationale and evidence
selection, and successful completion moves the form to the next outstanding
category. Fields are disabled while posting, errors preserve the rationale, and
stale or decided reviews do not show the form. Form state resets for a new run.

Verification: production build and lint passed, the new guided browser journey
passed, and the existing PostgreSQL manual-evidence workflow test passed in the
isolated experiment database. A second browser run added an Axe accessibility
scan of the new form (zero violations in the tested state) and mobile rendering.
The browser test checks irrelevant versus relevant evidence, rejected save/retry,
progression, “not applicable” without source references, and final completion.

Next investigation: guideline creation initializes a datetime-local input with
UTC clock digits. In non-UTC browsers this silently shifts the effective time.
Use local wall-clock digits and verify submission in multiple time zones.

## Overnight iteration 7: correct source effective times across time zones

Guideline creation now initializes its `datetime-local` field with local wall-clock
digits. The request still converts the chosen local time to UTC, and the form
discloses the browser's time zone. Previously the UTC digits were interpreted as
local time, silently shifting a newly created guideline's effective instant.

Verification: build and lint passed. Three browser contexts with a fixed instant
passed (Asia/Kolkata, America/Los_Angeles, UTC). Each asserts the local input
represents the current instant and the actual source POST contains the same UTC
instant. India and Los Angeles wall-clock values are explicitly checked.

Next investigation: the revision-conflict dialog uses technical wording and its
save action can be clicked repeatedly while a save is pending. Review conflict
recovery and keyboard behaviour without overwriting a collaborator's saved work.

## Overnight iteration 8: revision-conflict recovery

The conflict dialog now explains the saved-versus-working-draft choice directly,
keeps the comparison visible during recovery saves, disables actions during a
pending save, and shows recovery errors inside the dialog. Escape closes the
comparison when no save is pending. Saving creates a new revision with the latest
saved parent; existing history remains available.

Fixed a state bug where closing the comparison could leave the preserved local
draft in a read-only historical view. The selected revision now tracks the latest
server parent while the user's local text and metadata remain intact. A failed
refresh after a 409 reports the failure instead of presenting the previous local
revision as though it were newly fetched server data.

Verification: production build and lint passed. The browser regression passed:
initial 409 → latest comparison → pending recovery save → ignored Escape while
saving → failed save → Escape back to an editable local draft → successful retry.
It checks exact Unicode/trailing-space preservation and POST parent IDs, plus the
retained prior saved revision. Network and API responses are intercepted here;
server revision immutability is covered by existing PostgreSQL workflow tests.

Next investigation: word-level diff allocates a full quadratic matrix for long
documents. Bound comparison work while preserving exact before/after text and
clearly label coarser comparisons for unusually large rewrites.

## Overnight iteration 9: bounded revision comparisons

Word comparison now trims common token prefixes/suffixes before LCS, caps its
matrix at 250,000 cells, and groups broad rewrites into exact removed/added
passages when detailed comparison would exceed that budget. A visible notice
explains passage mode. Both complete versions remain available side by side.
Backtracking uses append/reverse instead of repeated front insertion, adjacent
segments are coalesced to reduce DOM nodes, and added/removed word counts are
calculated from actual text instead of segment count.

Verification: build and lint passed; four focused tests passed (conflict recovery
plus three comparison cases). Checks reconstruct both exact inputs from diff
segments across empty strings, Unicode/ZWJ, repeated words, CRLF, tabs, trailing
spaces and 150 reproducible text combinations. A 10,000-word full rewrite uses
passage mode; a small end-of-document edit keeps detailed mode. A browser test
opens a 1,500-word rewrite, checks complete removed/added text, and switches to
the complete side-by-side versions without losing content.

Next candidate: let creators import a UTF-8 text draft into intake locally, with
explicit replacement preview and validation, before any network submission.
Avoid pretending that PDF/image ingestion is implemented by a text importer.

## Overnight iteration 10: local text-file intake

Creators can now import `.txt` and `.md` drafts into intake. The file is read in
the browser, validated and previewed before an explicit replacement action.
Markdown is imported as plain text. Cancellation and rejected files leave the
current draft untouched; obsolete asynchronous reads cannot replace a newer
preview. Import alone makes no campaign POST or analysis request. Submitting
uses the existing API text and consent flow, with no file-storage claim.

Validation rejects unsupported extensions, empty/whitespace-only files, malformed
UTF-8, binary/control characters, files over 256 KiB, and text over the API's
100,000-code-point limit. Line endings, Unicode and meaningful whitespace are
preserved by decoding. A UTF-8 byte-order marker is consumed by the decoder.

Verification: build and lint passed. Four tests passed: decoder validation,
preview/cancel/confirm and exact submitted text, rejected-file and late-read
protection, plus the existing intake recovery case. The preview/confirm test
also checks literal script text stays inert and the importer's scoped Axe scan
has zero violations in that state. No provider calls were used.

Next candidate: source editing dialogs have unlabelled rule controls, fixed-width
rows and incomplete keyboard focus handling. Improve guideline authoring for
keyboard and small-screen use, then verify it alongside timezone submission.

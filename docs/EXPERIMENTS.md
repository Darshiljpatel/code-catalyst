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

## Overnight iteration 11: accessible guideline authoring and explicit activation

Both guideline creation and activation dialogs now contain and restore keyboard
focus, support Escape when idle, and lock controls during a pending request.
Rule controls have accessible names and narrow screens use single-column rule
fields. The shared focus helper recognizes controls disabled by a parent fieldset.
Rule creation chooses an unused ID after removals; duplicate IDs get a specific
validation message. Input lengths match the API limits, and source text retains
whitespace around literal evidence quotes.

Activation starts with no stock rationale and no pre-checked verification. The
manager must enter a rationale and explicitly confirm review against the active
guidelines before submitting. Existing server permissions/version guards remain
unchanged.

Verification: production build and lint passed. Six source/timezone checks passed:
creation keyboard containment/focus restoration, narrow-screen reflow and scoped
Axe scan, unique IDs after add/remove, explicit activation and pending-save lock,
literal source-text preservation and the three time zones. The wider focused UI
regression also passed: 23 tests spanning queue, discussion, dispositions, export,
intake recovery, manual review, conflicts, bounded diff, text import and sources.

Next candidate: finding lists grow unwieldy on drafts with many findings. Add
explicit category/severity/disposition filtering and useful result counts without
letting a filtered view conceal the overall approval blockers.

## Overnight iteration 12: finding triage with global blocker visibility

Added category, severity and disposition filters, visible result counts, clear
filters and a shortcut to all unresolved blockers. Total unresolved blockers
always describe the whole run, including hidden cards and staged-but-unchecked
fixes. A no-match state explains that filters are hiding findings. Filter values
reset when the run changes. The same unresolved-blocker predicate is used by
submission preflight to avoid contradictory counts.

Batch application now operates on visible findings when filters are active and
its label makes that scope explicit. Hidden cards cannot be silently edited by
the visible batch action. Clearing filters does not discard staged changes.

Verification: build and lint passed; two tests passed. Pure checks cover filter
combinations, pending dispositions, exceptions/dismissals and global blocker
counting. The browser case checks hidden blockers remain visible in the summary,
no-match/clear, blocker shortcut, scoped batch edits, reset on a new run, and a
zero-violation scoped Axe scan in the tested state.

Next investigation: intake permits “Assign later”, but the manager has no UI for
the existing audited reviewer-assignment endpoint. Add assignment/reassignment
with actual reviewer identities, rationale and workflow-version conflict recovery.

## Overnight iteration 13: manager reviewer assignment

Added assignment/reassignment to the campaign workspace for managers, using the
existing audited API. The dialog loads actual separate reviewer identities,
requires a 20-character rationale, prevents unchanged/invalid assignments and
provides list retry without fictional fallbacks. A 409 blocks stale resubmission
and offers review reload. Successful assignment refreshes coverage and reports
the assigned reviewer email. Approved campaigns expose no reassignment control;
creators do not receive manager-only controls. Server authorization is unchanged.

Verification: build and lint passed. Three focused tests passed (assignment plus
finding-triage regressions). Assignment tests cover list failure/retry, rationale
validation, a stale workflow version, reload using the new version, persisted
assignment and creator-view restrictions. A scoped Axe scan passed. The existing
PostgreSQL reassignment-authority test also passed on the isolated experiment
database. The final email success message is checked in a rebuilt browser run.

Next investigation: run the current interface against a separate real API/worker
stack, avoiding the other active development server and shared fixture databases.
Refresh outdated end-to-end selectors where necessary and identify integration
gaps that isolated browser transport tests cannot reveal.

## Overnight iteration 14: real isolated integration verification

Added an optional `BRANDGUARD_API_TARGET` for the Vite development/preview proxy,
so concurrent local stacks can target separate APIs. Default port 8000 and Caddy
production routing remain as before. Setup commands are in `tests/e2e/README.md`.

Created and migrated `brandguard_browser_test_experiments`, provisioned fresh
fictional identities privately, and ran an API at 8011, worker and built frontend
at 5181. External processing is disabled in this workspace and worker. The other
development server, browser fixture and shared databases were left alone.

Verification: all 6 existing batch/workflow checks passed (56.7 seconds), including
real worker analysis, multiple local corrections saved once, retry without a
duplicate revision, manual category checks, separate approval, exact export,
reload/CSRF recovery, accessibility/reflow, insights and ambiguity feedback.

A new combined real-service journey also passed (final rerun: 14.6 seconds): import UTF-8 text
locally → create one unassigned campaign → manager assigns a reviewer with audit
rationale → reviewer records 3 manual checks → creator submits → separate reviewer
approves → actual text and JSON downloads match exact Unicode/newline/trailing
spaces and the server-approved SHA-256. There are no API transport stubs in this
new journey. Synthetic credentials and test traces stay outside tracked evidence.
Build/type checking and lint were rechecked for the proxy configuration.
The proxy uses Vite's prefix-scoped `loadEnv` API, avoiding an undeclared Node
type dependency. After restarting only the owned experiment preview server,
proxied readiness and the combined real journey passed again with this config.

This verifies local integration only. It does not establish public hosting,
provider accuracy, retention/deletion compliance or other open release gates.

Next investigation: campaign intake does not explain the external model's input
limit before submission. Help creators see whether external semantic review can
accept their draft, using the server's declared policy rather than guessing model
limits in the UI.

## Overnight iteration 15: external review input guidance

Processing-policy responses now disclose the configured maximum request bytes,
from the same provider configuration used by semantic review. Intake and saved
drafts show their UTF-8 byte count and warn when the draft alone exceeds that
limit. The disclosure explains that instructions, context and approved source
rules also consume space; a smaller draft does not guarantee acceptance.
Creators can shorten a draft or explicitly choose local checks plus manual review.
Saving remains available and consent is never changed automatically. Missing
budget data does not produce a guessed limit.

Verification: 2 PostgreSQL/API-contract checks passed, including a custom 4,096
byte configuration on policy reads and updates without exposing its key. The
browser check passed for intake, saved drafts, multi-byte emoji, the exact limit,
unchanged consent, disabled processing and older policy responses. Build and
lint passed. Browser requests here use synthetic intercepted policy responses;
these checks make no external inference calls.
All 27 semantic-adapter checks also passed, including the existing guard that
rejects over-budget requests before any outbound request.

Next investigation: make analysis failures easier to recover from by displaying
actionable explanations for provider/coverage failures in the results view.

## Overnight iteration 16: honest results and recovery guidance

Zero findings with failed or missing category checks no longer reads as a clean
compliance result. A visible coverage notice names the remaining categories and
gives recovery guidance for input limits, missing provider configuration,
authentication, rate limits, timeouts and source changes. Unknown reasons get
safe general guidance rather than raw error text. Pending analysis retains its
pending state. Coverage and submission readiness now use the same category
helper, including categories absent from a run response.

The notice directs assigned reviewers to manual category review and other users
to their reviewer; stale runs require a recheck first. It adds no automatic retry
or paid request.

Verification: build and lint passed. Five browser checks passed for failed,
missing, pending and complete coverage, duplicate reason grouping, unknown
reasons, scoped accessibility, external input guidance, finding triage and manual
review regressions. The new test initially used a campaign without a latest run;
its fixture was corrected to load the run and effective check evidence.
All 7 real-service batch/workflow/import journeys also passed (1.1 minutes),
including the actual worker, manual reviews, approval, exact exports and insights.
Their local-only expectations now require the incomplete-coverage message rather
than the old misleading clean result. An overlapping initial browser run collided
on Playwright's trace directory; final runs use separate output directories and
passed without that artifact error. No Nebius calls were made.

Next investigation: the campaign already protects ordinary links, page reloads
and revision switching while edits are unsaved. Check the remaining browser-back
and sign-out paths without persisting confidential copy in browser storage.

## Overnight iteration 17: unsaved navigation

Confirmed with failing browser regressions that browser Back discarded working
copy and sign-out reached login without warning. Added a shared leave-confirmation
provider and moved the existing route table to React Router's data router so its
supported blocker handles link, imperative and history navigation. Sign-out uses
the same explicit confirmation before sending logout. The existing native reload
warning is now registered centrally. Draft copy remains in component memory.

The dialog provides Keep editing, explicit discard, Escape, focus trapping and
focus restoration. It prevents leaving while a save request is in progress.
Existing revision-switch controls still require saving or discarding first.
Build and lint passed. All 4 new browser checks pass: Back/link cancellation and
discard, focus restoration, scoped accessibility, no logout before confirmation,
pending/failed save protection and native reload cancellation preserving the copy.
The native reload test bounds its navigation wait because cancelling intentionally
prevents a load event; an initial unbounded test waited until its test timeout.
The pending-save test's error expectation was corrected to the app's general
save error, rather than assuming it echoed the server message.

The overnight reviewer corrected failed logout clearing client authentication and
added visible retry guidance; their regression also checks the draft and leave
protection survive failure. They also corrected missing manual-review categories
to use the same canonical category inventory as coverage and submission.

The original runtime stopped during an authentication failure, so its last
browser-suite outcome could not be recovered. On resumption at 07:38 IST, fresh
build and lint passed. A new loopback PostgreSQL cluster with independent morning
browser/test databases was provisioned (no existing database reset), along with
fictional identities in a private fixture. All 173 Python checks passed in 91.83
seconds. The fresh full browser run passed 46 tests, skipped the explicit paid
provider journey and exposed the login contrast issue below.

## Morning follow-up: pending logout and entrance contrast

A stronger regression proved browser Back could still discard working copy
while logout was pending, before its 503 response restored the guard. Navigation
protection now stays active until the action actually succeeds, with a visible
progress state and disabled duplicate/cancel controls. Failure cancels pending
navigation and retains both the session and the editor. Seven focused browser
checks pass, including the new Back-during-logout regression and native reload.

The full browser run also caught login text falling below AA contrast during an
opacity entrance animation. Login entrances now animate position at full opacity,
including the sample's delayed entrance. The accessibility test freezes animation
midway and checks opacity plus Axe, rather than waiting for a fade to finish.
Build, lint and this targeted accessibility test pass. The final full browser
run passed **48 tests**, with **1 opt-in paid provider test skipped**, in 2.0
minutes. This includes the actual API/database/worker journeys and all feature
regressions, plus the reviewer's discussion rerun and missing-category fixes.
No paid inference calls were made. The result establishes local integration and
the tested accessibility states, not universal accessibility or release approval.

The reviewed discussion/manual-coverage corrections are being integrated with
their regression tests. The reviewer's separate overnight review log is preserved.

Next investigation: local startup documentation depends on temporary Node-path,
database and credential files. Make repeated development/testing startup reliable
after a reboot without exposing provider keys or replacing existing user data.

## Morning iteration 18: persistent local startup

Added `python3 scripts/dev_local.py`: one foreground launcher for a built
frontend, real API/worker and isolated loopback PostgreSQL. It discovers installed
Node/PostgreSQL tools, migrates its own database, and provisions a fictional
workspace only on first use. Database files, private credentials and logs persist
under ignored `.local/dev/`; account/parent permissions were checked as 600/700.
`accounts` explicitly displays the local login details when requested.

The default disables the provider key. `--external` allows existing configuration
without enabling workspace policy or giving per-run consent. It does not print
provider credentials. Documentation covers dependencies, normal restarts, ports,
logs, stopping and the separate container deployment path.

Verification: 12 launcher checks pass, including missing tools, invalid/occupied
ports, immediate reuse of a recently closed listener, explicit provider isolation,
account validation and ownership-scoped shutdown. A real first startup and the
full import → assignment → worker/manual review → approval → exact export journey
passed (10.3 seconds). A second launcher was refused. SIGTERM and SIGINT shutdowns
closed all owned ports and left the independent 8011/5181 stack ready. Restart
retained the identical private account-file hash and database counts (1 workspace,
4 identities, 1 campaign). No accounts or campaigns were regenerated. An initial
restart exposed TIME_WAIT sockets in the port probe; SO_REUSEADDR and a regression
now cover that case. Occupied-port refusal was also checked against the independent
API. External inference remained disabled throughout.

Next investigation: revise the stale submission PDF so the report reflects
actual implemented behavior, verified evidence and remaining release work.

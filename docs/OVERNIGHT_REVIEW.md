# Overnight feature verification

## Scope and schedule

Review the implementation agent's changes every two hours overnight, ending on
October 24, 2026 around 08:30 Asia/Kolkata (no later than 09:00). A thread heartbeat
named `Overnight feature verification`, ID `overnight-feature-verification`, is
active with five two-hour occurrences, created around 22:31 on October 23.
Keep the app and machine running for local scheduled checks.

Implementation chat: `01a16734-2e68-7661-9ea4-44cb704fbd73`, titled
`Connect folder to GitHub repo`. Inspect it read-only; user has not authorized
messages to that chat. Work in the current branch; preserve concurrent edits.
Do not reset, switch branches, stage another agent's files, push, or deploy.

## Initial review: October 23, approximately 22:35 IST

Reviewed queue search/pagination (`3293630`), revision discussion (`f0b794a`),
and disposition permissions (`60a0934`, initially uncommitted during review).
The implementation agent is continuing, most recently editing ExportModal.tsx;
that work has not been reviewed yet.

### Verified defect and correction

After selecting a discussion finding and enabling note attachment, rerunning
analysis on the same revision replaces the finding IDs. The selector displayed
“All revision notes” but internal state still held the obsolete ID, leaving the
attachment checkbox checked and sending notes to the old analysis finding.

Added `apps/web/e2e/discussion-rerun.spec.ts`; it failed before the correction
because the obsolete attachment checkbox remained present. Corrected
`CommentsSection.tsx` to validate selected/focused IDs against the current
findings, while retaining the note draft. An explicit empty selection now also
takes precedence over the focused finding. These reviewer changes are left
unstaged to avoid interfering with the implementation agent's commits.

### Validation

- Initial production build, lint, and six existing queue/discussion/disposition
  checks passed.
- Final production build and lint passed. All seven frontend checks passed,
  including the new rerun regression. All 21 API checks passed against the
  independent reviewer database (one existing Starlette/httpx deprecation warning).
- First API attempt against the shared `brandguard_s1_test` database: 18 passed,
  3 failed with disappearing fixture records/foreign-key errors, consistent
  with concurrent fixture resets. Do not diagnose these as application defects.
- Created and migrated a separate UTF8 database `brandguard_s1_test_review` on
  127.0.0.1:55439 for reviewer checks. Use this database in all later review runs.
  Never run reviewer tests against the implementation agent's shared database.

### Continuation commands

```sh
TEST_DATABASE_URL=postgresql+psycopg://sanath@127.0.0.1:55439/brandguard_s1_test_review \
  .venv/bin/pytest apps/api/tests/test_queue_search.py apps/api/tests/test_workflow.py apps/api/tests/test_contract.py -q
PATH="/tmp/node-v24.22.1-linux-x64/bin:$PATH" npm --prefix apps/web run build
PATH="/tmp/node-v24.22.1-linux-x64/bin:$PATH" npm --prefix apps/web run lint
```

Serve the built frontend on a separate local preview port before browser tests.
The initial reviewer used port 5189 and stopped that server after testing; stop
only the reviewer's own preview server when finished. Use
`BROWSER_BASE_URL=http://127.0.0.1:5189` and the same Node PATH
with `npm --prefix apps/web exec -- playwright test queue.spec.ts discussion.spec.ts
discussion-rerun.spec.ts dispositions.spec.ts --config apps/web/playwright.config.ts
--reporter=list`.

Context: no tool exposes an exact context percentage or manual `/compact` action.
Keep this checkpoint current across automatic compaction; never claim to have
invoked the slash command.

## Review at 00:32 IST, October 24

Inspected commits `49533e1` through `8c5a736` and the implementation agent's
uncommitted unsaved-navigation/router work. This includes exports, intake recovery,
manual review, source dates/authoring, conflict recovery, bounded text comparison,
imports, finding filters, reviewer assignment, input budgets and coverage notices.
The implementation chat's latest turn is terminal `failed`: access-token refresh
failed after logout/account change. It needs the user's fresh sign-in to resume.
Do not message or restart that chat without authorization. Reviewing existing
code remains possible, so the reviewer goal continues through morning.

### Additional verified defects and corrections

1. Failed logout discarded client identity and the campaign editor even though
   the server session could still be active. A browser regression reproduced it
   with a 503. AuthContext now clears identity only after successful logout or a
   server-confirmed absent session (401). TopNav shows a recoverable error. The
   navigation provider awaits the sign-out result and restores the unsaved-change
   guard on failure. The regression checks draft preservation, continued leave
   protection, and successful retry.
2. Coverage notices correctly named categories missing from a run response, but
   ManualChecks only offered categories explicitly present in that response.
   A missing tone check left the reviewer without the promised manual recovery.
   A browser regression reproduced the absent form. ManualChecks now uses the
   same canonical incomplete-category helper as submission and coverage notices.
   Regression also records a manual check for the missing category.

The prior discussion rerun correction remains in the working tree. All reviewer
corrections and regression tests remain unstaged, preserving the implementing
agent's unfinished router work.

### Validation and next checkpoint

- All **173 Python tests** passed against `brandguard_s1_test_review`, including
  API, worker, engine, evaluation, infrastructure and contract tests. One existing
  Starlette/httpx deprecation warning remains.
- Production build and lint passed after both new corrections.
- All **7 focused browser tests** for manual review and unsaved navigation passed.
- Full browser suite against a reviewer-owned real API/database/worker finished:
  **47 passed, 1 skipped** in 2.4 minutes. This includes actual import, assignment,
  worker analysis, manual checks, separate approval and exact export workflows,
  all feature regressions, and accessibility/reflow checks. The skipped test is
  the opt-in paid provider journey; external inference was explicitly disabled.
- Reviewer browser stack: UTF8 database `brandguard_browser_test_review`, API
  port 8019, preview port 5189, private fixture
  `/tmp/brandguard-review-browser-fixture.json`. Credentials/traces stay untracked.
  Reviewer-owned API, worker and preview were stopped after testing. Databases
  and the private fixture remain available for the next run.
- Next planned review: around **02:31 IST**, then 04:31, 06:31 and 08:31.
- Review finished at **00:39 IST**. Code fingerprint:
  `8682fbd33e2197148e4254bc8263c7c9b71ef070df0535179feb4b3a41d59e88`.
  Compute it by SHA-256 hashing sorted, unique `git ls-files --cached --others
  --exclude-standard` entries under apps/web, apps/api, apps/worker, packages,
  contracts, tests and scripts. For each existing file, append path bytes, NUL,
  complete file bytes, NUL. Unchanged fingerprint plus unchanged HEAD means no
  further code checks need repeating until a new change or concern appears.

## Review at 02:32 IST, October 24

Rechecked HEAD (`8c5a736`), working-tree status, all tracked/untracked code under
the fingerprint scope, and the implementation chat's current terminal status.
The code fingerprint remains
`8682fbd33e2197148e4254bc8263c7c9b71ef070df0535179feb4b3a41d59e88`.
No new code or commits appeared, and the implementation chat still reports the
same authentication failure. No test reruns or further edits were warranted.
The reviewer corrections remain intact. Continue at approximately 04:31 IST.

## Review at 04:32 IST, October 24

HEAD, working-tree changes and the complete review code fingerprint are unchanged
from the 00:39 verification. The implementation chat remains terminal with the
previously reported authentication failure; there are no new outputs or edits.
The tested reviewer corrections are intact. No duplicate test run or speculative
code change was necessary. Continue the requested overnight monitoring at 06:31
and perform the final morning checkpoint around 08:31 IST.

## Review at 06:32 IST, October 24

Revalidated the current checkout and implementation chat. HEAD remains `8c5a736`
and the code fingerprint remains
`8682fbd33e2197148e4254bc8263c7c9b71ef070df0535179feb4b3a41d59e88`.
No new code, commits or implementation progress appeared. The implementation
chat still needs a fresh sign-in. The previously verified changes remain intact;
no additional test run was warranted. Final morning check remains due at 08:31.

## Heartbeat recheck at 07:05 IST, October 24

The heartbeat arrived during the wait for the final morning checkpoint. Rechecked
branch (`experiments`), HEAD, working-tree status, full code fingerprint and the
implementation chat. All remain unchanged from the 06:32 check, including the
previously reported terminal authentication error. No further code changes or
test runs were necessary. The final morning review remains due around 08:31 IST.

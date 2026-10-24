# BrandGuard · CODE CATALYST

**Check the copy. Follow the evidence. Approve the exact revision.**

BrandGuard is a pre-publication review workspace for marketing campaigns. It checks draft copy against a brand’s approved guidelines, connects findings to source evidence, and brings a separate human reviewer into the approval process. Local rule checks handle supported structured rules; Nebius adds semantic review for applicable tone, messaging, and claims rules.

**[Open the hosted demo →](https://code-catalyst-tau.vercel.app/)**

No installation is needed to judge the hosted website. Start as a **creator**, explore the **manager’s rules**, review the campaign as a **reviewer**, and finish with the **admin’s Nebius controls**. The floating **Judge guide** on the website contains the same account details and instructions, both before and after login. Hover over it on desktop, or click/tap it to open.

[Demo accounts](#demo-accounts) · [Judge walkthrough](#judge-walkthrough) · [Troubleshooting](#troubleshooting) · [Run locally](#run-locally) · [Architecture](#architecture) · [Testing](#testing)

## Demo accounts

Use these accounts at **https://code-catalyst-tau.vercel.app/**.

| Field | What to enter |
|---|---|
| Email — start here | `creator@lumadesk.test` |
| Password — shared by all four roles | `BrandGuardAdmin2026!` |
| Workspace ID — shared by all four roles | `539ad43a-e582-46f0-8d0d-7e483782d5c6` |

| Order | Role | Email | What you will explore |
|---|---|---|---|
| 1 | Creator | `creator@lumadesk.test` | Create, analyse, correct, and submit a campaign. |
| 2 | Manager | `manager@lumadesk.test` | Inspect the approved rules and understand why findings appear. |
| 3 | Reviewer | `reviewer@lumadesk.test` | Complete outstanding checks, approve, and export. |
| 4 | Admin | `admin@lumadesk.test` | Control external semantic processing through Nebius. |

These are intentionally shared evaluation accounts for the fictional LumaDesk workspace. Give your campaign a unique title so you can find it again. Save your work before switching roles with **Sign out** in the top bar. A separate browser profile or private window is useful for keeping the creator and reviewer signed in simultaneously.

The local launcher generates its own accounts and workspace ID. For localhost credentials, use `python3 scripts/dev_local.py accounts` instead of the hosted account table above.

## Judge walkthrough

Follow the four roles in order. Keep the same campaign throughout the creator, manager, and reviewer sections.

### 1. Creator

**Goal: see a rough campaign become a corrected, source-backed revision.**

1. Open the [hosted demo](https://code-catalyst-tau.vercel.app/) and sign in as `creator@lumadesk.test` using the shared password and workspace ID above.
2. On **Campaigns**, click **Review a campaign**.
3. Select the **LumaDesk** brand, enter a unique campaign title, and assign `reviewer@lumadesk.test` as the reviewer. Set **Channel** to `email`, **Audience** to `Prospective customers`, and **Purpose** to `Promote a trial`.
4. Paste this into **Copy Text**:

   ```text
   Lumadesk guarantees 10x productivity. Get your 30-day free trial. Sign up NOW!!!
   ```

5. Keep **external semantic review** selected if it is available. Click **Submit for Compliance Review →** and wait for analysis to finish.
6. Inspect the findings. The brand spelling and trial duration conflict with the approved rules. When Nebius is enabled, also inspect semantic findings about the performance claim and tone. Model wording and finding counts can vary.
7. Click **Evidence ↗** on a finding. Read the approved source passage and rule that support it, then close the evidence drawer.
8. Try **Apply available fixes**, or choose **Edit draft** and replace the copy with:

   ```text
   Try LumaDesk free for 14 days. Start your trial.
   ```

9. Click **Save all & recheck**. The changes are saved as a new revision and analysed again. Staged edits are only confirmed after rechecking.
10. If the current revision has sufficient coverage and no unresolved blockers, click **Submit for Review →**, then **Confirm Submission →**. If submission is blocked by incomplete coverage, keep the campaign for the reviewer section below.

**Before switching roles:** copy the campaign’s page URL or remember its unique title. If the run says **Local processing only**, continue with the local findings; the reviewer can finish missing checks, and you will explore the Nebius switch as admin at the end.

### 2. Manager

**Goal: understand why those phrases were detected and where the rules come from.**

1. Sign out and sign in as `manager@lumadesk.test` with the same password and workspace ID.
2. On **Campaigns**, scroll to **Your brand library** and open **LumaDesk**.
3. Select **Active**, then click **View Rules** on the approved guideline source.
4. Compare the source text, approved values, and **Evidence Quote** fields with the findings you saw as creator:

| Sample phrase | Approved rule | Why it matters |
|---|---|---|
| `Lumadesk` | The product name is `LumaDesk`. | The terminology check identifies incorrect spelling or capitalization. |
| `30-day free trial` | The free trial lasts **14 days**. | The stated duration contradicts an approved fact. |
| `10x productivity` | Performance claims require approved evidence. | Semantic review can flag the unsupported performance promise. |
| `Sign up NOW!!!` | Use calm language. | Semantic review can flag pressure or tone that conflicts with the guideline. |

The application uses these brand-specific rules and source passages as review evidence. Managers can define guidelines for another brand without changing the review interface.

To explore authoring, click **＋ Add guideline source**. A source has a key, title, source text, effective date, and structured rules with exact evidence quotes. Saving creates a draft. Activation uses **Activate Source**, a rationale, an explicit verification checkbox, and **Activate & Advance Epoch**.

For the main walkthrough, inspect the seeded rules and cancel any unfinished source form. Activating a changed source can make an earlier review stale and require a recheck.

<details>
<summary>If there is no active source: recreate the fictional test guidelines</summary>

As manager, click **＋ Add guideline source** and enter:

- **Source key:** `brand_guide`
- **Title:** `LumaDesk synthetic brand rules`
- **Effective from:** a time before the next analysis
- **Source text:**

  ```text
  Write LumaDesk. The free trial lasts 14 days. Performance claims require approved evidence. Use calm language.
  ```

Add these rules. Evidence quotes must be exact substrings of the source text.

| ID | Category | Kind | Key | Approved value | Evidence quote |
|---|---|---|---|---|---|
| T01 | `terminology` | `terminology` | `product_name` | `LumaDesk` | `Write LumaDesk.` |
| F01 | `facts_claims` | `fact` | `trial_duration` | `14 days` | `The free trial lasts 14 days.` |
| C01 | `facts_claims` | `claim_policy` | `promotions` | `Substantiate performance claims.` | `Performance claims require approved evidence.` |
| G01 | `tone` | `guidance` | `tone` | `Use calm language.` | `Use calm language.` |

Save, activate the source with a rationale and verification, and return as creator to recheck the campaign. The exact fixture is [verification/fixtures/lumadesk.json](verification/fixtures/lumadesk.json).

</details>

### 3. Reviewer

**Goal: independently review and approve the exact corrected revision.**

1. Sign out and sign in as `reviewer@lumadesk.test`.
2. Search **Campaigns** for the unique title you used, or open the saved campaign URL. Confirm that you are looking at the current, corrected revision and are its assigned reviewer.
3. Read the findings, their source evidence, and the coverage notice. If **Manual category review** appears:
   - Select an outstanding category.
   - Inspect the relevant approved source and select its source checkbox.
   - Choose the appropriate outcome and enter a rationale of at least **20 characters**.
   - Click **Record manual check** and repeat for remaining categories.
   - Use **Not applicable to this revision** only when no approved rule applies to that category.
4. If blockers remain, inspect their evidence and use the permitted reviewer actions, or return to the creator to correct and recheck the draft.
5. If the campaign is not yet **IN_REVIEW**, return as creator, open the same campaign, click **Submit for Review →** and **Confirm Submission →**, then switch back to reviewer.
6. Click **✓ Approve Exact Revision**, enter a rationale of at least **20 characters**, then **✓ Confirm Approval**.
7. Once the campaign is **APPROVED**, click **⬇ View Approved Export**. Download both **Download approved text (.txt)** and **Download Audit Record (.json)**.
8. Check that the text matches the approved revision. The JSON audit record includes the text checksum, human decision, and review evidence.

The assigned reviewer is a separate identity from the creator. Approval applies to an exact revision; later edits and source changes require fresh checks where applicable.

### 4. Admin

**Goal: see how the workspace controls Nebius processing.**

1. Sign out and sign in as `admin@lumadesk.test`.
2. Click **Processing policy** in the top bar.
3. Inspect the provider, model, and current policy. Toggle **Enable external semantic processing via hosted provider**.
4. Enter a **Creator Disclosure Notice**, such as `Fictional campaign text, context, and approved guideline passages will be sent to Nebius for semantic review.` Enter an **Administrative Audit Rationale**, such as `Enable Nebius for the Round 2 fictional evaluation.` Click **Save Policy Changes**.
5. To compare modes, return as creator and start a fresh campaign with the original sample:
   - **Enabled:** select external semantic review and submit. Applicable tone, messaging, and claims rules can receive Nebius semantic review.
   - **Disabled:** supported local checks still run. Semantic categories can remain incomplete until the assigned reviewer records manual checks.
6. Finish with external processing **enabled** so the next judge can try Nebius too.

Nebius also requires a configured server-side API key. Requests send draft text, campaign context, and relevant approved source passages to the provider and may incur normal API charges. The default review selection can be unchecked for an individual local-only run. Changing policy does not rerun old analyses or rewrite an approved export.

## Troubleshooting

| What you see | What to do |
|---|---|
| Sign-in fails | Copy all three hosted fields exactly. All four roles share the password and workspace ID. Local accounts are different; retrieve them with the launcher’s `accounts` command. |
| **Local processing only** | As admin, enable Processing policy. Return as creator, refresh, select external review, and run a new check. |
| Provider not configured or authentication failed | The deployment owner must check the server’s `NEBIUS_API_KEY`. The browser does not receive that key. |
| **INCOMPLETE**, even with no findings | Inspect category coverage. Zero findings does not mean all categories completed; the assigned reviewer can record outstanding manual checks. |
| Messaging is **Not applicable** | The supplied LumaDesk fixture has no messaging rule. This is expected after a successful semantic evaluation. |
| No sources or no useful findings | Check that the campaign uses LumaDesk and has an active, effective guideline source. Use the manager setup above if needed. |
| No approval button | Confirm that you are the assigned reviewer, the creator submitted the current revision, and coverage/blocker requirements are satisfied. |
| A run or approval is stale | Recheck the current revision against the current active sources before continuing. |
| Analysis fails after the draft saved | Open the saved campaign and retry **Run Compliance Check**. You do not need to create another campaign. |

## What the project supports

- Brand-specific, versioned guideline sources with manager-controlled activation.
- Pasted text and locally previewed UTF-8 `.txt` / `.md` draft import, up to 256 KiB and 100,000 Unicode characters.
- Supported deterministic terminology and structured fact checks, plus optional Nebius semantic review.
- Located findings with source evidence, category coverage, filters, and reasoned dispositions.
- Multiple staged corrections, undo/discard, revision comparisons, conflict recovery, and unsaved-work protection.
- Campaign search, pagination, reviewer assignment, and revision-scoped discussion.
- Separate creator/reviewer identities, manual checks, approval guards, and exact text/JSON exports.
- A floating judge guide available while signed in or signed out, with desktop, touch, and keyboard controls.

## Run locally

### Prerequisites

- Linux or macOS with Python **3.11+**.
- Node.js **22+** and npm.
- PostgreSQL server tools: `initdb`, `pg_ctl`, `createdb`, and `psql`.
- A Nebius API key for live semantic review; local/manual review is available without one.

The recorded integration environment used Python 3.14, Node.js 24, and PostgreSQL 18.

### First-time setup

```bash
git clone https://github.com/Sanath-Reddy/code-catalyst.git
cd code-catalyst
python3 -m venv .venv
.venv/bin/python -m pip install -r apps/api/requirements.lock
npm --prefix apps/web ci
```

For live Nebius review, create a private `.env` from [.env.example](.env.example) and set `NEBIUS_API_KEY`. Keep the provider key on the server; do not place it in a `VITE_*` variable or commit it.

Start the app:

```bash
python3 scripts/dev_local.py
```

Open **http://localhost:5183**. In another terminal, retrieve the generated local accounts:

```bash
python3 scripts/dev_local.py accounts
```

The launcher starts its own loopback PostgreSQL instance, applies migrations, provisions a fictional workspace and approved source on first use, builds the frontend, and starts the API and worker. Nebius and the local workspace policy are enabled by default. Starting the app alone makes no inference request.

To use local/manual checks only:

```bash
python3 scripts/dev_local.py --local-only
```

On later runs, use the same startup command. Press **Ctrl+C** in its terminal to stop its services; accounts, campaigns, logs, and database files persist under ignored `.local/dev/`.

Default ports are **5183** for the website, **8013** for the API, and **55441** for PostgreSQL. If occupied:

```bash
python3 scripts/dev_local.py --db-port 55442 --api-port 8014 --web-port 5184
```

See [local development](docs/LOCAL_DEVELOPMENT.md) for logs, restart behavior, and PostgreSQL tool discovery.

## Architecture

```mermaid
flowchart LR
    Web[React review workspace] --> API[FastAPI: identity and workflow]
    API --> DB[(PostgreSQL: sources, revisions, jobs and evidence)]
    DB --> Worker[Background review worker]
    Worker --> Local[Deterministic review engine]
    Worker -->|Policy enabled and external review selected| Nebius[Nebius semantic review]
    Local --> Validation[Server validates findings and evidence]
    Nebius --> Validation
    Validation --> DB
    API --> Human[Assigned human reviewer]
    Human --> Export[Approved revision and audit export]
```

| Layer | Technology / responsibility |
|---|---|
| Frontend | React, TypeScript, React Router, Vite; campaign, source, and review interfaces. |
| API | Python, FastAPI, Pydantic, SQLAlchemy, Alembic; authoritative permissions and workflow checks. |
| Persistence | PostgreSQL; versioned sources, revisions, review jobs, decisions, and evidence. |
| Review engine | Local extraction and deterministic rules in `packages/review_engine`. |
| Semantic review | Nebius Token Factory using `Qwen/Qwen3-235B-A22B-Instruct-2507`. |
| Verification | pytest, Playwright, and Axe checks for tested UI states. |
| Hosting configuration | Vercel frontend rewrites, a Render API/worker entrypoint, and Docker/Caddy alternatives. |

Nebius proposes findings; it does not approve or publish campaigns. The API validates finding structure and source references, and the assigned human reviewer makes the final decision.

### Repository structure

```text
apps/web/                  React frontend and browser tests
apps/api/brandguard/       API, identity, source and review workflows
apps/api/tests/            API and database integration tests
apps/worker/               Background review worker
packages/review_engine/    Extraction and deterministic checks
contracts/openapi.json    API contract
verification/fixtures/    Fictional source packs and campaign examples
tests/                    Engine, worker, infrastructure and other tests
scripts/                  Local launcher, provisioning and verification tools
infra/                    Containers, deployment and backup/restore tools
docs/                     Architecture, setup, evidence and project records
```

## Configuration and deployment

[.env.example](.env.example) documents the configuration names. Important server settings include `DATABASE_URL`, `PUBLIC_ORIGIN`, `APP_ENV`, `NEBIUS_API_KEY`, and `MODEL_*` limits. `PUBLIC_ORIGIN` must match the browser’s actual origin for session and CSRF checks.

The local launcher supplies its own database URL and browser origin. Its automatic policy setup applies only to its fictional local workspace. Hosted workspaces use the admin’s **Processing policy** controls.

The repository includes Vercel `/api` rewrites to the Render backend and an [API/worker entrypoint](infra/entrypoint.sh). For a separate Docker-based local setup, see [the judge and deployment notes](docs/JUDGE_WALKTHROUGH.md). A successful frontend deployment or API readiness response alone does not verify worker execution or provider connectivity; complete the review journey above as well.

## Testing

### Frontend checks

```bash
npm --prefix apps/web run build
npm --prefix apps/web run lint
```

### Python integration suite

Create a **separate, disposable UTF-8 PostgreSQL test database** named `brandguard_s1_test`. Replace the connection placeholders below with its credentials. The suite resets fixtures; use the isolated test database.

```bash
export TEST_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@127.0.0.1:5432/brandguard_s1_test'
DATABASE_URL="$TEST_DATABASE_URL" .venv/bin/alembic -c apps/api/alembic.ini upgrade head
DATABASE_URL="$TEST_DATABASE_URL" .venv/bin/pytest apps/api/tests tests -q
```

### Browser and live-provider checks

Follow [the executable browser setup](tests/e2e/README.md) to prepare a separate browser-test database, fixture accounts, API, worker, and built frontend. With that stack running:

```bash
npm --prefix apps/web exec -- playwright test --config apps/web/playwright.config.ts --reporter=list
```

The live Nebius test is opt-in. Run it only against the prepared fictional workspace with the worker’s provider key configured:

```bash
LIVE_NEBIUS=1 npm --prefix apps/web exec -- playwright test nebius.spec.ts --config apps/web/playwright.config.ts --reporter=list
```

It checks browser policy enablement, the default external-review selection, worker execution, model findings, and semantic coverage. It makes a real paid provider request. The ordinary suite skips this test.

### Planning checks and CI

```bash
python3 scripts/verify_plan.py
python3 -m unittest discover -s scripts -p 'test_verify_plan.py'
```

Planning checks validate requirement/evidence mapping. They do not execute the product or establish deployment readiness. [GitHub Actions](https://github.com/Sanath-Reddy/code-catalyst/actions) runs the repository’s configured planning and integration workflows.

## Scope and limitations

- This is a hackathon prototype using fictional evaluation data. Model suggestions and valid citations still require human judgment.
- The integrated web journey accepts text and `.txt`/`.md` imports. Extraction-library support for other formats does not mean the website provides PDF/image upload and review.
- Missing, failed, or stale category checks remain visible. A zero-finding result is not proof of complete coverage or universal compliance.
- The JSON export is an audit record of an approved revision, not a digitally signed certificate or a guarantee that a marketing claim is true.
- Selected keyboard, accessibility, and responsive states are tested; this is not a claim of complete WCAG certification or independently measured model accuracy.
- Historical PDFs, handoffs, and verification reports describe their recorded revisions. Consult their dates and scope alongside the current source and executable tests.

## Further documentation

- [Judge walkthrough and deployment notes](docs/JUDGE_WALKTHROUGH.md)
- [Persistent local development](docs/LOCAL_DEVELOPMENT.md)
- [Executable browser verification](tests/e2e/README.md)
- [Source pack used in the demo](verification/fixtures/lumadesk.json)
- [Architecture details](docs/ARCHITECTURE.md) and [integration contracts](docs/CONTRACTS.md)
- [Experiments and verification notes](docs/EXPERIMENTS.md)
- [Dated integration report](docs/INTEGRATION_REPORT.md)
- [Implemented features](docs/COMPLETED_FEATURES.md) and [changes from Round 1](docs/CHANGELOG_FROM_ROUND1.md)
- [Model plan](docs/MODEL_PLAN.md), [technology/AI disclosures](docs/DISCLOSURES.md), and [contribution record](docs/CONTRIBUTIONS.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md), [verification specification](docs/VERIFICATION.md), and [requirement register](verification/requirements.json)
- [Round 3 improvement plan](docs/ROUND3_IMPROVEMENTS.md) and [submission status](docs/SUBMISSION_STATUS.md)

## Team

Built by **CODE CATALYST**:

- **Sanath Reddy** — backend, workflow/security boundaries, integration, and verification.
- **Darshilkumar** — frontend, source/review interfaces, and judge-facing experience.
- **Surya Prakash** — extraction, deterministic checks, worker, and infrastructure.

The [contribution record](docs/CONTRIBUTIONS.md) contains the detailed history; [disclosures](docs/DISCLOSURES.md) record development assistance and dependency provenance.

## Feedback and contributions

Use [GitHub Issues](https://github.com/Sanath-Reddy/code-catalyst/issues) to report a problem or suggest an improvement. Include the role, steps to reproduce, expected behavior, actual behavior, and a screenshot or request ID where useful. Keep provider keys and private data out of reports.

For code changes, set up the local workspace, keep the change focused, add relevant regression coverage, and run the checks appropriate to the affected area. Explain the behavior and validation in the pull request.

## License

A project license has not yet been added to this repository. Third-party dependency licenses and reuse disclosures are recorded in [docs/DISCLOSURES.md](docs/DISCLOSURES.md).

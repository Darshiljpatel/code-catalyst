# BrandGuard judge walkthrough

## Hosted demo: start here

Open **[https://code-catalyst-tau.vercel.app/](https://code-catalyst-tau.vercel.app/)**. The [README’s judge walkthrough](../README.md#judge-walkthrough) is the complete, current set of button-by-button instructions. The floating **Judge guide** is available on the website before and after sign-in, including on mobile.

### Hosted sign-in details

| Field | What to enter |
|---|---|
| Email — start as creator | `creator@lumadesk.test` |
| Password — all roles | `BrandGuardAdmin2026!` |
| Workspace ID — all roles | `539ad43a-e582-46f0-8d0d-7e483782d5c6` |

Use the same password and workspace ID for the other pre-seeded roles:

| Order | Role | Email |
|---|---|---|
| 1 | Creator | `creator@lumadesk.test` |
| 2 | Manager | `manager@lumadesk.test` |
| 3 | Reviewer | `reviewer@lumadesk.test` |
| 4 | Admin | `admin@lumadesk.test` |

### What to try

1. **Creator:** create a campaign, run the sample copy, inspect evidence, correct the copy, and save/recheck. Submit when coverage and blockers allow it.
2. **Manager:** open LumaDesk’s active guidelines and match the findings to the approved product name, 14-day trial, claim-evidence policy, and calm-tone guidance. Explore source authoring without changing the active source during the main walkthrough.
3. **Reviewer:** open the same campaign, complete any outstanding manual checks, have the creator submit if needed, approve the exact revision, and download the text/JSON exports.
4. **Admin:** inspect Processing policy, try the Nebius switch with a notice and rationale, and compare results using a fresh creator campaign. Leave external processing enabled for the next judge.

Give campaigns unique titles. Save the campaign URL before switching accounts, or use separate browser profiles for creator and reviewer. If coverage is incomplete, follow the notice and reviewer steps; zero findings alone does not establish complete coverage.

The exact sample, correction, and source rules are in [verification/fixtures/lumadesk.json](../verification/fixtures/lumadesk.json). The `/demo` page is an illustrative fictional example; use an actual campaign for the API/worker/approval journey.

## Local testing without Docker

Follow [persistent local development](LOCAL_DEVELOPMENT.md). After installing dependencies, run:

```bash
python3 scripts/dev_local.py
```

Open **http://localhost:5183**. Retrieve its generated local accounts in another terminal:

```bash
python3 scripts/dev_local.py accounts
```

The hosted workspace ID and password above are for the hosted demo. The launcher creates and retains a separate local workspace, accounts, and source pack. Nebius is selected by default; `--local-only` disables it for the local workspace. The local development document explains ports, logs, restarts, and provider configuration.

## Alternative: Docker-based local setup

Create a private `.env` from `.env.example`. Set `POSTGRES_PASSWORD` to a strong URL-safe value, `PUBLIC_ORIGIN=http://localhost:3000`, and `APP_ENV=development`. From the repository root:

```bash
docker compose --env-file .env -f infra/compose.yaml up --build -d
```

Provision fictional accounts with a password you choose, at least 16 characters long:

```bash
read -rs -p 'Synthetic demo password: ' SEED_PASSWORD
export SEED_PASSWORD
docker compose --env-file .env -f infra/compose.yaml exec -e SEED_PASSWORD api python -m brandguard.seed
unset SEED_PASSWORD
```

Use the workspace ID printed by seeding, your chosen password, and the role email addresses at **http://localhost:3000/login**. The current seed provisions missing fictional identities and an active LumaDesk guideline source; it does not create preapproved campaigns. These Docker-local accounts and workspace are separate from the hosted demo. The seed command is disabled when `APP_ENV=production`.

Docker configuration is an alternative deployment path; verify the containers and full workflow on the target host. The supplied launcher and container setup are different ways to run the application.

## Verification and project records

See [executable browser verification](../tests/e2e/README.md) for isolated test databases, real API/worker browser journeys, and the opt-in paid Nebius test. [GitHub Actions](https://github.com/Sanath-Reddy/code-catalyst/actions) shows results for specific commits.

The [integration report](INTEGRATION_REPORT.md), [architecture record](ARCHITECTURE.md), and earlier handoffs describe dated baselines. Historical PDFs and passing artifacts should be read with their documented scope and corrections. Use the current source, executable tests, and the [README’s scope and limitations](../README.md#scope-and-limitations) when assessing the current project.

# BrandGuard judge walkthrough

Use [INTEGRATION_REPORT.md](INTEGRATION_REPORT.md) for the current verified scope
and outstanding release requirements. Earlier D5 passing artifacts were generated
without executing tests and have been invalidated. The existing submission PDF
must be revised to match the integration report before submission.

## Local deployment

For local testing without Docker, use the [persistent local launcher](LOCAL_DEVELOPMENT.md).
It starts the real API, worker and frontend with separate fictional accounts.
The container instructions below are a separate deployment path.

Create a private `.env` from `.env.example`. Set a strong URL-safe
`POSTGRES_PASSWORD`, `PUBLIC_ORIGIN=http://localhost:3000`, and
`APP_ENV=development`. Then run from the repository root:

```sh
docker compose --env-file .env -f infra/compose.yaml up --build -d
```

The migration service must finish successfully before the API and worker start.
Only the web port is exposed on localhost. This container path needs an actual
Docker build/start check on a host with Docker; local process verification is
recorded separately.

Provision local identities using a password you choose (at least 16 characters):

```sh
read -rs -p 'Synthetic demo password: ' SEED_PASSWORD
export SEED_PASSWORD
docker compose --env-file .env -f infra/compose.yaml exec -e SEED_PASSWORD api python -m brandguard.seed
unset SEED_PASSWORD
```

Save the workspace ID printed by the seed command. Sign in at
`http://localhost:3000/login` with that ID, your password, and one of
`manager@lumadesk.test`, `creator@lumadesk.test`, `reviewer@lumadesk.test`, or
`admin@lumadesk.test`. Seeding creates identities and a brand, not preapproved
campaigns or activated guidelines. There are no one-click production logins.

## Review journey

On the `experiments` branch, campaign intake also supports local UTF-8 `.txt` and
`.md` import. Choose a file (up to 256 KiB / 100,000 characters), inspect its plain
text preview, then choose **Replace draft with imported text**. **Cancel import**
keeps the current draft. Import makes no analysis request; use the normal submit
and external-processing consent controls after reviewing the imported copy.
PDF/image file intake is not provided by this text importer.

1. As manager, open the brand, create a source with rules and literal source
   quotes, and explicitly verify and activate it. The fictional source in
   `verification/fixtures/lumadesk.json` is a reproducible example.
2. As creator, start a campaign review. Select a reviewer and supply channel,
   audience, purpose and text. For the example, `Lumadesk offers a 30-day free
   trial.` conflicts with the canonical name and approved 14-day trial.
3. Wait for the worker. Inspect located text and the evidence drawer. Source
   fetch failures are shown as errors; they never substitute fictional evidence.
4. Edit the copy and save a new revision, then run analysis again. Corrected
   example: `LumaDesk offers a 14-day free trial.` A zero-finding result alone
   does not establish that all categories were checked.
5. In local mode, the assigned reviewer must inspect incomplete categories.
   Record each manual check, its source references and a rationale of at least
   20 characters. Use “not applicable” only where no applicable rule exists.
   If the campaign was created with **Assign later**, a manager first opens it
   and uses **Assign reviewer**, selects an authorized reviewer, and records an
   assignment rationale. Managers can change the reviewer before approval; the
   new reviewer must record their own manual category checks.
6. Creator submits the exact revision. The assigned separate reviewer approves
   or requests changes with a rationale. Conflicts require fresh state.
7. Export the approved revision. The JSON contains the exact text checksum,
   human decision and frozen evidence record. It is an audit record, not a
   digitally signed certificate or a guarantee that claims are true.
8. Manager opens governance insights. Counts describe recorded human
   dispositions and explicitly disclose their denominator.

The `/demo` page is a static fictional explanation. Development mock transport
requires both development mode and `VITE_USE_MOCK_API=true`; it is not a live
backend demonstration or verification result.

## Verification

See [executable browser setup](../tests/e2e/README.md). The Python suite uses a
separate PostgreSQL test database. `python scripts/verify_plan.py` checks
requirement mapping only. The release evidence gate remains incomplete until
real deployment, retention, independent evaluation and submission checks exist.

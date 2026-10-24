"""Apply the requested processing mode to the launcher's fictional workspace."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))


def set_processing_policy(client, accounts, origin, enabled):
    response = client.post('/api/v1/sessions', json=dict(
        email=accounts['emails']['admin'], password=accounts['password'], org_id=accounts['org_id']),
        headers={'origin': origin})
    response.raise_for_status()
    headers = {'origin': origin, 'x-csrf-token': response.json()['csrf_token']}
    try:
        response = client.get('/api/v1/processing-policy')
        response.raise_for_status()
        policy = response.json()
        if policy['enabled'] != enabled:
            response = client.put('/api/v1/processing-policy', headers=headers, json=dict(
                enabled=enabled, expected_version=policy['version'],
                notice='Draft text, campaign context and approved guideline passages are sent to Nebius for semantic review. Provider charges may apply. Uncheck external review to run local checks only.',
                rationale='Apply the user-requested default processing mode for the fictional local development workspace.'))
            response.raise_for_status()
            policy = response.json()
        return policy
    finally:
        client.delete('/api/v1/sessions/current', headers=headers)


def main():
    from fastapi.testclient import TestClient
    from brandguard.main import create_app, Settings
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-only', action='store_true')
    args = parser.parse_args()
    url = os.environ['DATABASE_URL']
    if not url.endswith('/brandguard_browser_test_local'):
        raise SystemExit('Use only the persistent fictional local development database.')
    origin = os.environ['PUBLIC_ORIGIN']
    accounts = json.loads(Path(os.environ['BROWSER_FIXTURE_PATH']).read_text())
    app = create_app(Settings(url, origin, 'development'))
    try:
        with TestClient(app, base_url=origin) as client:
            policy = set_processing_policy(client, accounts, origin, not args.local_only)
        print('Local workspace processing: ' + ('Nebius enabled' if policy['enabled'] else 'local checks only'))
    finally:
        app.state.engine.dispose()


if __name__ == '__main__':
    main()

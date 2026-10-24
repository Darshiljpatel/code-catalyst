"""Policy disclosure reflects the same configuration used by the worker adapter."""
from test_identity import setup, login
from brandguard.semantic import ProviderConfig


def test_policy_discloses_configured_budget_on_read_and_update(setup):
    client, _, orgs, _ = setup
    client.app.state.provider_config = ProviderConfig(api_key='private-test-key', max_input_bytes=4096)
    headers = login(client, orgs[0], 'admin')
    initial = client.get('/api/v1/processing-policy')
    assert initial.status_code == 200
    assert initial.json()['max_input_bytes'] == 4096
    assert initial.json()['enabled'] is False
    updated = client.put('/api/v1/processing-policy', headers=headers, json=dict(
        enabled=True, expected_version=0,
        notice='Approved external processing for fictional campaign drafts.',
        rationale='Administrator enabled synthetic review.'))
    assert updated.status_code == 200, updated.text
    assert updated.json()['max_input_bytes'] == 4096
    assert client.get('/api/v1/processing-policy').json() == updated.json()
    assert 'private-test-key' not in updated.text

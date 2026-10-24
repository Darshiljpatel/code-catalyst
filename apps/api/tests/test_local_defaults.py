from test_identity import setup
from scripts.configure_local_processing import set_processing_policy


def test_local_processing_defaults_are_audited_idempotent_and_reversible(setup):
    client, _, orgs, _ = setup
    accounts = dict(org_id=orgs[0], password='correct-password', emails={'admin': 'admin@example.test'})
    policy = set_processing_policy(client, accounts, 'https://testserver', True)
    assert policy['enabled'] is True
    assert policy['version'] == 1
    assert set_processing_policy(client, accounts, 'https://testserver', True) == policy
    policy = set_processing_policy(client, accounts, 'https://testserver', False)
    assert policy['enabled'] is False
    assert policy['version'] == 2

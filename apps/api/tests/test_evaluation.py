from brandguard.evaluation import evaluate, evaluate_many, compare


def source(sid, key, rules, text):
    return dict(id=sid, source_key=key, text=text, rules=rules)


TRIAL_14 = source('s14', 'trial', [dict(id='F01', category='facts_claims', kind='fact', key='trial_duration',
    value='14 days', evidence_quote='The free trial lasts 14 days.')], 'The free trial lasts 14 days.')
TRIAL_30 = source('s30', 'trial', [dict(id='F01', category='facts_claims', kind='fact', key='trial_duration',
    value='30 days', evidence_quote='The free trial lasts 30 days.')], 'The free trial lasts 30 days.')
NAME = source('n1', 'names', [dict(id='T01', category='terminology', kind='terminology', key='product_name',
    value='LumaDesk', evidence_quote='Write LumaDesk.')], 'Write LumaDesk.')
CONTEXT = dict(channel='email', audience='Customers', purpose='Promote')


def test_evaluates_text_against_any_rule_set_without_a_run():
    result = evaluate('Start your 30-day free trial of Lumadesk.', CONTEXT, [TRIAL_14, NAME])
    rules = sorted(f['rule_id'] for f in result['findings'])
    assert rules == ['F01', 'T01']
    assert {c['category'] for c in result['checks']} >= {'terminology', 'facts_claims'}


def test_batch_returns_one_result_per_case_in_order():
    cases = [dict(text='A 14-day free trial.', context=CONTEXT), dict(text='A 30-day free trial.', context=CONTEXT),
             dict(text='LumaDesk for teams.', context=CONTEXT)]
    results = evaluate_many(cases, [TRIAL_14])
    assert [len(r['findings']) for r in results] == [0, 1, 0]


def test_compare_reports_findings_delta_across_source_versions():
    text = 'Start a 30-day free trial.'
    before, after = evaluate(text, CONTEXT, [TRIAL_14]), evaluate(text, CONTEXT, [TRIAL_30])
    delta = compare(before, after, [TRIAL_14], [TRIAL_30])
    assert delta['changed'] and [f['rule_id'] for f in delta['removed']] == ['F01'] and delta['added'] == []
    same = compare(before, evaluate(text, CONTEXT, [dict(TRIAL_14, id='s14b')]), [TRIAL_14], [dict(TRIAL_14, id='s14b')])
    assert not same['changed'] and same['unchanged'] == 1


def test_engine_failure_is_never_a_clean_result():
    results = evaluate_many([dict(text='x' * 100_001, context=CONTEXT)], [TRIAL_14])
    assert all(c['status'] == 'failed' for c in results[0]['checks'])

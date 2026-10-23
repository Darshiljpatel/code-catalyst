import asyncio
import copy
from brandguard.engine_bridge import check_text
from brandguard.orchestration import ReviewInput,checked_engine_result
from brandguard.core import digest


def sources(brand='LumaDesk',days=14):
    text=f'Write the name as {brand}. The trial lasts {days} days.'
    return [dict(id='11111111-1111-1111-1111-111111111111',source_key='guide',text=text,
        rules=[dict(id='T01',category='terminology',kind='terminology',key='product_name',value=brand,
                    evidence_quote=f'Write the name as {brand}.'),
               dict(id='F01',category='facts_claims',kind='fact',key='trial_duration',value=f'{days} days',
                    evidence_quote=f'The trial lasts {days} days.')])]


def evaluate(text, snapshot=None):
    inp=ReviewInput(text,{'channel':'email','audience':'Customers','purpose':'Promote a trial'},snapshot or sources())
    result=asyncio.run(check_text(inp))
    return inp,result


def test_real_engine_maps_source_evidence_and_canonical_unicode_offsets():
    text='  😀\n\nLumadesk offers a 30-day trial.\n'
    inp,result=evaluate(text)
    assert result.metadata.get('error_code') is None
    checks,findings=checked_engine_result(result,inp)
    assert len(findings)==2
    assert all(f['evidence_quote'] in inp.sources[0]['text'] for f in findings)
    assert all(text[f['start']:f['end']]==f['content_quote'] for f in findings)
    assert next(f for f in findings if f['category']=='terminology')['start']==text.index('Lumadesk')
    assert result.metadata['canonical_sha256']==digest(text)
    assert next(c for c in checks if c['category']=='visual')['status']=='not_applicable'


def test_another_brand_and_duration_are_not_hardcoded():
    inp,result=evaluate('ApeXCloud has a 14-day trial.',sources('ApexCloud',7))
    _,findings=checked_engine_result(result,inp)
    assert {f['suggested_edit'] for f in findings}=={'ApexCloud','7 days'}


def test_unrelated_durations_do_not_become_trial_contradictions():
    _,result=evaluate('LumaDesk has a 14-day trial and a 30-day refund policy. Onboarding takes 60 days.')
    assert result.findings==[]


def test_trial_subject_before_duration_is_checked():
    _,result=evaluate('The LumaDesk trial lasts 30 days.')
    assert len(result.findings)==1 and result.findings[0]['content_quote']=='30 days'


def test_unsupported_fact_keeps_valid_findings_but_requires_manual_review():
    snapshot=sources()
    snapshot[0]['text']+=' Offices are in Bengaluru.'
    snapshot[0]['rules'].append(dict(id='F02',category='facts_claims',kind='fact',key='office_city',
        value='Bengaluru',evidence_quote='Offices are in Bengaluru.'))
    inp,result=evaluate('Lumadesk has a 30-day trial.',snapshot)
    checks,findings=checked_engine_result(result,inp)
    assert len(findings)==2
    assert next(c for c in checks if c['category']=='facts_claims')['status']=='needs_manual_review'


def test_clean_copy_and_near_matches_have_no_false_positive():
    _,result=evaluate('LumaDesk has a 14-day trial. LumadeskApp is a different token.')
    assert not result.findings
    assert all(c['status'] in ('complete','not_applicable') for c in result.checks)


def test_punctuation_in_brand_terminology_has_valid_boundaries():
    _,result=evaluate('c++ offers a 14-day trial.',sources('C++',14))
    assert len(result.findings)==1 and result.findings[0]['suggested_edit']=='C++'


def test_subprocess_timeout_is_explicit_and_child_is_reaped():
    inp=ReviewInput('Text',{},sources())
    result=asyncio.run(check_text(inp,timeout=.00001))
    assert not result.findings and result.metadata['error_code']=='engine_timeout'
    assert all(c['status']=='failed' for c in result.checks)


def test_invalid_source_quotes_fail_closed():
    snapshot=sources();snapshot[0]['rules'][0]['evidence_quote']='invented'
    _,result=evaluate('Lumadesk trial.',snapshot)
    assert result.metadata['error_code']=='engine_invalid_quote' and not result.findings


def test_engine_child_does_not_inherit_provider_or_database_credentials(monkeypatch):
    import brandguard.engine_bridge as bridge
    original=asyncio.create_subprocess_exec
    captured=[]
    async def spawn(*args,**kwargs):
        captured.append(kwargs['env'])
        return await original(*args,**kwargs)
    monkeypatch.setenv('NEBIUS_API_KEY','unit-test-only-secret')
    monkeypatch.setenv('DATABASE_URL','unit-test-only-database')
    monkeypatch.setattr(bridge.asyncio,'create_subprocess_exec',spawn)
    _,result=evaluate('LumaDesk has a 14-day trial.')
    assert captured and not {'NEBIUS_API_KEY','DATABASE_URL'}.intersection(captured[0])
    assert 'unit-test-only-secret' not in str(result)


def test_rule_ids_are_namespaced_by_source_version():
    first=sources();first[0]['rules']=first[0]['rules'][:1]
    second=sources('ApexCloud');second[0]['id']='22222222-2222-2222-2222-222222222222';second[0]['rules']=second[0]['rules'][:1]
    inp,result=evaluate('Lumadesk integrates with Apexcloud.',first+second)
    _,findings=checked_engine_result(result,inp)
    assert {f['source_version_id'] for f in findings}=={first[0]['id'],second[0]['id']}
    assert len(findings)==2

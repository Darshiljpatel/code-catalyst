"""Opt-in synthetic API→real engine→Nebius→human approval→export smoke."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
from datetime import datetime,timezone

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'apps/api'))
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from brandguard.main import create_app
from brandguard.core import Settings,passwords,digest
from brandguard.models import Organisation,User,Membership
from brandguard.semantic import NebiusReviewer,ProviderConfig
from brandguard.orchestration import process_one
from brandguard.engine_bridge import check_text


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live',action='store_true')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    if not args.live:parser.error('--live is required; this makes two paid synthetic inference requests')
    load_dotenv(ROOT/'.env')
    url=os.getenv('TEST_DATABASE_URL','')
    if not url or make_url(url).database!='brandguard_s1_test':
        parser.error('Use TEST_DATABASE_URL pointing to the dedicated migrated brandguard_s1_test database')
    config=ProviderConfig.from_env()
    if not config.api_key:parser.error('NEBIUS_API_KEY must be configured privately')
    app=create_app(Settings(url,'https://testserver','test'),config)
    engine=app.state.engine
    pack=json.loads((ROOT/'verification/fixtures/lumadesk.json').read_text())
    password=secrets.token_urlsafe(24)
    emails,member_ids={},{}
    # Create a new synthetic tenant; never erase/reset existing workspaces.
    with Session(engine) as db:
        org=Organisation(name='Synthetic workflow verification')
        db.add(org);db.flush();org_id=org.id
        for role in ('creator','manager','reviewer','admin'):
            email=f'{role}-{secrets.token_hex(6)}@workflow.test'
            user=User(email=email,password_hash=passwords.hash(password));db.add(user);db.flush()
            member=Membership(user_id=user.id,org_id=org_id,role=role);db.add(member);db.flush()
            emails[role],member_ids[role]=email,member.id
        db.commit()
    reviewer=NebiusReviewer(config)
    summary=dict(scope='Synthetic API/DB + real P1/P2 engine + live provider using test identities; no human-study, browser/deployment or accuracy claim',
        executed_at=datetime.now(timezone.utc).isoformat(),checks=[],reviews=[])
    with TestClient(app,base_url='https://testserver') as client:
        def request(method,path,body=None,headers=None):
            r=client.request(method,'/api/v1'+path,json=body,headers=headers)
            if r.status_code>=400:raise RuntimeError(f'{method} {path}: HTTP {r.status_code} code={r.json().get("code","unknown")}')
            return r.json()
        def login(role):
            data=request('POST','/sessions',dict(email=emails[role],password=password,org_id=org_id),{'origin':'https://testserver'})
            return {'origin':'https://testserver','X-CSRF-Token':data['csrf_token']}
        h=login('manager')
        brand=request('POST','/brands',{'name':'LumaDesk'},h)
        source=request('POST',f"/brands/{brand['id']}/sources",pack['source'],h)
        request('POST',f"/sources/{source['id']}/activate",dict(expected_epoch=0,verified=True,
            rationale='Verified the fictional evaluation source rules.'),h)
        h=login('admin')
        request('PUT','/processing-policy',dict(enabled=True,expected_version=0,
            notice='Only this fictional evaluation content and approved synthetic passages will be sent to Nebius.',
            rationale='Authorised live synthetic integration verification.'),h)
        h=login('creator')
        item=request('POST','/content',dict(brand_id=brand['id'],title='Synthetic campaign',reviewer_id=member_ids['reviewer'],
            text=pack['draft'],**pack['context']),h)
        def analyse(revision,key):
            run=request('POST',f'/revisions/{revision}/analysis',dict(external_processing_consent=True,policy_version=1),
                        {**h,'Idempotency-Key':key})
            start=time.monotonic();process_one(engine,reviewer,check_text,run_id=run['id'])
            # Target only this synthetic run; never consume unrelated queued work.
            result=request('GET',f"/runs/{run['id']}")
            summary['reviews'].append(dict(status=result['status'],finding_count=len(result['findings']),
                origins=sorted({f['origin'] for f in result['findings']}),elapsed_ms=round((time.monotonic()-start)*1000),
                metadata=result['engine_metadata']))
            if result['status']!='complete':raise RuntimeError('Review incomplete; inspect safe metadata and pending jobs. No clean-review claim.')
            return result
        first_rev=item['revisions'][0]['id']
        bad=analyse(first_rev,'synthetic-original')
        if not any(f['origin']=='model' and f['evidence_status']=='unsupported' for f in bad['findings']):
            raise RuntimeError('The provider did not identify the labelled unsupported claim.')
        if sum(f['origin']=='deterministic' for f in bad['findings'])!=2:
            raise RuntimeError('Expected two deterministic terminology/trial findings.')
        summary['checks'].append('Original draft: real terminology/trial blockers plus grounded model claim finding')
        item=request('GET',f"/content/{item['id']}")
        corrected=request('POST',f"/content/{item['id']}/revisions",dict(parent_revision_id=first_rev,
            text=pack['corrected'],**pack['context']),h)
        revision=corrected['revisions'][-1]['id']
        good=analyse(revision,'synthetic-corrected')
        if any(f['severity']=='blocker' for f in good['findings']):raise RuntimeError('Corrected draft still has blockers.')
        item=request('GET',f"/content/{item['id']}")
        submitted=request('POST',f'/revisions/{revision}/submit',dict(reviewer_id=member_ids['reviewer'],
            expected_item_version=item['workflow_version'],expected_run_id=good['id'],expected_source_epoch=good['source_epoch']),h)
        h=login('reviewer')
        request('POST',f'/revisions/{revision}/decisions',dict(kind='approved',rationale='Reviewed this exact fictional revision against its approved source evidence.',
            expected_item_version=submitted['workflow_version'],expected_run_id=good['id'],expected_source_epoch=good['source_epoch']),h)
        exported=request('GET',f'/revisions/{revision}/export')
        if exported['text']!=pack['corrected'] or exported['text_hash']!=digest(pack['corrected']):raise RuntimeError('Export hash/content mismatch.')
        if exported['evidence_record']['manual_checks']:raise RuntimeError('Smoke must exercise automated checks without manual substitution.')
        summary['checks'].append('Corrected draft: separate reviewer approval and exact export; no manual substitutes')
        summary['status']='pass'
    summary['fixture_sha256']=digest((ROOT/'verification/fixtures/lumadesk.json').read_text())
    summary['commit_reference']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    summary['working_tree_dirty']=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))
    return 0

if __name__=='__main__':
    try:raise SystemExit(main())
    except RuntimeError as error:
        # Only locally constructed safe messages are printed; no provider bodies or credentials.
        print('FAIL:',str(error),file=sys.stderr)
        raise SystemExit(1)
    except Exception as error:
        print('FAIL: workflow configuration/runtime error ('+type(error).__name__+'); credential values omitted.',file=sys.stderr)
        raise SystemExit(1)

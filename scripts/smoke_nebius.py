"""Opt-in synthetic model connection smoke; never prints credentials or raw responses."""
import argparse
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'apps/api'))
from dotenv import load_dotenv
from brandguard.semantic import NebiusReviewer,ProviderConfig


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live',action='store_true',help='Make one paid synthetic inference request using the local environment')
    args=parser.parse_args()
    if not args.live:
        parser.error('Use --live to explicitly opt into one synthetic inference request.')
    load_dotenv(ROOT/'.env')
    try:
        config=ProviderConfig.from_env()
        sources=[dict(id='11111111-1111-1111-1111-111111111111',
            valid_from=(datetime.now(timezone.utc)-timedelta(days=1)).isoformat(),valid_until=None,
            text='The LumaDesk trial lasts 14 days.',
            rules=[dict(id='F-01',category='facts_claims',kind='fact',key='trial_duration',
                value='14 days',evidence_quote='The LumaDesk trial lasts 14 days.')])]
        result=asyncio.run(NebiusReviewer(config).review('Try LumaDesk free for 30 days.',
            dict(channel='email',audience='Prospective customers',purpose='Promote a trial'),sources,consent=True))
        print(json.dumps(dict(scope='Synthetic provider smoke only, not a quality evaluation',
            findings=len(result.findings),checks=result.checks,metadata=result.metadata),indent=2))
        return 1 if result.metadata.get('error_code') else 0
    except (ValueError,KeyError):
        print('Invalid or missing provider configuration; no credential values printed.')
        return 1

if __name__=='__main__':
    raise SystemExit(main())

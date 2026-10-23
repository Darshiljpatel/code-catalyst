"""CLI runner; --once processes at most one durable job and exits."""
import argparse
import os
import time
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from .semantic import NebiusReviewer, ProviderConfig
from .orchestration import process_one
from .engine_bridge import check_text


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    load_dotenv(Path(__file__).resolve().parents[3]/'.env')
    engine=create_engine(os.environ['DATABASE_URL'],pool_pre_ping=True)
    reviewer=NebiusReviewer(ProviderConfig.from_env())
    try:
        while True:
            processed=process_one(engine,reviewer,check_text)
            if args.once:
                break
            if not processed:
                time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        engine.dispose()

if __name__=='__main__':
    main()

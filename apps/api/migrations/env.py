import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from alembic import context
from sqlalchemy import create_engine
from brandguard.models import Base

def run():
    engine = create_engine(os.environ['DATABASE_URL'])
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
run()

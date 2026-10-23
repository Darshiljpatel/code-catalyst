"""Explicit synthetic identity provisioning for local integration; never resets data."""
import os
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from .models import Organisation, User, Membership, Brand
from .main import passwords

def main():
    if os.getenv('APP_ENV') == 'production':
        raise SystemExit('Local seed is disabled in production.')
    password = os.environ['SEED_PASSWORD']
    if len(password) < 16:
        raise SystemExit('SEED_PASSWORD must be at least 16 characters.')
    with Session(create_engine(os.environ['DATABASE_URL'])) as db:
        existing = db.scalar(select(User).where(User.email == 'manager@lumadesk.test'))
        if existing:
            raise SystemExit('Seed identities already exist; no changes made.')
        org = Organisation(name='LumaDesk (fictional)')
        db.add(org); db.flush()
        for role in ('creator', 'manager', 'reviewer', 'admin'):
            user = User(email=f'{role}@lumadesk.test', password_hash=passwords.hash(password))
            db.add(user); db.flush()
            db.add(Membership(user_id=user.id, org_id=org.id, role=role))
        db.add(Brand(org_id=org.id, name='LumaDesk'))
        db.commit()
        print(f'Synthetic workspace: {org.id}. Four separate identities provisioned; passwords not printed.')
if __name__ == '__main__':
    main()

"""Explicit synthetic identity and active brand source provisioning."""
import os
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from .models import Organisation, User, Membership, Brand, SourceVersion
from .main import passwords
from .core import digest

LUMADESK_RULES = [
    {
        "id": "T01",
        "category": "terminology",
        "kind": "terminology",
        "key": "product_name",
        "value": "LumaDesk",
        "evidence_quote": "Write LumaDesk."
    },
    {
        "id": "F01",
        "category": "facts_claims",
        "kind": "fact",
        "key": "trial_duration",
        "value": "14 days",
        "evidence_quote": "The free trial lasts 14 days."
    },
    {
        "id": "C01",
        "category": "facts_claims",
        "kind": "claim_policy",
        "key": "promotions",
        "value": "Substantiate performance claims.",
        "evidence_quote": "Performance claims require approved evidence."
    },
    {
        "id": "G01",
        "category": "tone",
        "kind": "guidance",
        "key": "tone",
        "value": "Use calm language.",
        "evidence_quote": "Use calm language."
    }
]

def main():
    if os.getenv('APP_ENV') == 'production':
        raise SystemExit('Local seed is disabled in production.')
    password = os.environ.get('SEED_PASSWORD', '')
    if len(password) < 16:
        raise SystemExit('SEED_PASSWORD must be at least 16 characters.')
    
    with Session(create_engine(os.environ['DATABASE_URL'])) as db:
        manager_user = db.scalar(select(User).where(User.email == 'manager@lumadesk.test'))
        if not manager_user:
            org = Organisation(name='LumaDesk (fictional)')
            db.add(org)
            db.flush()
            for role in ('creator', 'manager', 'reviewer', 'admin'):
                user = User(email=f'{role}@lumadesk.test', password_hash=passwords.hash(password))
                db.add(user)
                db.flush()
                db.add(Membership(user_id=user.id, org_id=org.id, role=role))
            brand = Brand(org_id=org.id, name='LumaDesk')
            db.add(brand)
            db.flush()
            print(f'Synthetic workspace: {org.id}. Four separate identities provisioned.')
        else:
            manager_membership = db.scalar(select(Membership).where(Membership.user_id == manager_user.id, Membership.role == 'manager'))
            org = db.scalar(select(Organisation).where(Organisation.id == manager_membership.org_id))
            brand = db.scalar(select(Brand).where(Brand.org_id == org.id, Brand.name == 'LumaDesk'))

        manager_membership = db.scalar(select(Membership).where(Membership.org_id == org.id, Membership.role == 'manager'))
        
        # Check if active source exists
        existing_source = db.scalar(select(SourceVersion).where(SourceVersion.brand_id == brand.id, SourceVersion.state == 'active'))
        if not existing_source:
            now_dt = datetime.now(timezone.utc)
            source_text = "Write LumaDesk. The free trial lasts 14 days. Performance claims require approved evidence. Use calm language."
            source = SourceVersion(
                org_id=org.id,
                brand_id=brand.id,
                source_key="brand_guide",
                version=1,
                owner_id=manager_membership.id,
                title="LumaDesk synthetic brand rules",
                text=source_text,
                text_hash=digest(source_text),
                rules=LUMADESK_RULES,
                valid_from=now_dt - timedelta(days=1),
                valid_until=None,
                state="active",
                created_at=now_dt,
                activated_by=manager_membership.id,
                activated_at=now_dt
            )
            db.add(source)
            brand.source_epoch = 1
            db.commit()
            print(f'Active brand source provisioned for {brand.name} (Source ID: {source.id})')
        else:
            print('Active brand source already exists.')

if __name__ == '__main__':
    main()

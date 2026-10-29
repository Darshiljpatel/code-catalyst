"""Private demo sandboxes: one-click workspaces for judges, with a role switcher.

Each sandbox is a fresh, isolated, expiring workspace with five separate identities
(creator, reviewer, manager, brand lead and admin), two fictional brands and campaigns in
every state. The provisioner drives the real workflow functions and the real local engine,
so seeded findings, approvals and evidence records follow exactly the same rules as live work.
Unlike brandguard.seed, it is allowed in production, for demo workspaces only.
"""
import io
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, func, delete, or_
from sqlalchemy.orm import Session
from .core import db, identity, trusted_origin, client_ip, digest, passwords, Problem, COOKIE
from .schemas import StrictInput

router = APIRouter(prefix='/api/v1/demo')
SANDBOX_HOURS = 48
PER_ADDRESS_PER_HOUR = 10
MAX_ACTIVE = 300
SANDBOX_RUN_LIMIT = 25
# Provisioning drives about a dozen real analyses (over a minute on hosted Postgres), so the worker keeps
# a few ready-made sandboxes and a judge's click only claims one. Unclaimed pool workspaces carry this mark.
POOL_MARK = 'pool'
POOL_HOURS = 24 * 7
ROLES = (('creator', 'creator', 'Creator'), ('reviewer', 'reviewer', 'Reviewer'), ('manager', 'manager', 'Manager'),
         ('brand_lead', 'manager', 'Brand lead'), ('admin', 'admin', 'Admin'))

GUIDE_TEXT = ('Write LumaDesk. The free trial lasts 14 days. Performance claims require approved evidence. '
              'Use calm language.')
GUIDE_RULES = [
    dict(id='T01', category='terminology', kind='terminology', key='product_name', value='LumaDesk', evidence_quote='Write LumaDesk.'),
    dict(id='F01', category='facts_claims', kind='fact', key='trial_duration', value='14 days', evidence_quote='The free trial lasts 14 days.'),
    dict(id='C01', category='facts_claims', kind='claim_policy', key='promotions', value='Substantiate performance claims.',
         evidence_quote='Performance claims require approved evidence.'),
    dict(id='G01', category='tone', kind='guidance', key='tone', value='Use calm language.', evidence_quote='Use calm language.'),
]
NORTHWIND_TEXT = 'Write Northwind Bikes. Keep a friendly, outdoor tone.'
NORTHWIND_RULES = [
    dict(id='T01', category='terminology', kind='terminology', key='brand_name', value='Northwind', evidence_quote='Write Northwind Bikes.'),
    dict(id='G01', category='tone', kind='guidance', key='tone', value='Keep a friendly, outdoor tone.', evidence_quote='Keep a friendly, outdoor tone.'),
]
REASON = 'Checked this exact revision against the approved LumaDesk guide.'
DISPUTE = 'Headline style uses capitals; the brand name itself is spelled correctly.'
CONTEXT = dict(channel='email', audience='Small and mid-sized teams', purpose='Grow free-trial sign-ups')
# Region boxes of the sample ad (see sample_ad_png); the trial line is the deliberate OCR trap.
AD_LINES = [
    dict(id='r1', text='LUMADESK', confidence=0.96, box=dict(x=0.052, y=0.033, w=0.33, h=0.07)),
    dict(id='r2', text='Your desk, sorted.', confidence=0.93, box=dict(x=0.052, y=0.27, w=0.62, h=0.08)),
    dict(id='r3', text='Start your 3O-day free trial', confidence=0.64, box=dict(x=0.052, y=0.43, w=0.8, h=0.06)),
    dict(id='r4', text='The fastest desk booking app ever made.', confidence=0.9, box=dict(x=0.052, y=0.515, w=0.8, h=0.045)),
    dict(id='r5', text='Try LumaDesk', confidence=0.95, box=dict(x=0.09, y=0.78, w=0.34, h=0.06)),
]


class SandboxInput(StrictInput):
    role: str = Field(default='creator', pattern=r'^(creator|reviewer|manager|brand_lead|admin)$')


class SwitchInput(StrictInput):
    membership_id: str = Field(min_length=1, max_length=36)


class DemoMemberOut(BaseModel):
    membership_id: str
    role: str
    label: str
    email: str


class SandboxOut(BaseModel):
    org_id: str
    role: str
    membership_id: str
    csrf_token: str
    expires_at: datetime
    members: list[DemoMemberOut]


def utcnow():
    return datetime.now(timezone.utc)


def enabled():
    return os.getenv('DEMO_SANDBOXES_ENABLED', '1') != '0'


def sample_ad_png():
    """The fictional LumaDesk social ad: an all-caps headline and a 30-day trial claim."""
    from PIL import Image, ImageDraw, ImageFont

    def font(size):
        for path in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
        return ImageFont.load_default(size)
    width = height = 1080
    image = Image.new('RGB', (width, height), (22, 32, 64))
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, width, 140], fill=(255, 137, 94))
    draw.text((60, 40), 'LUMADESK', font=font(64), fill=(22, 32, 64))
    draw.text((60, 300), 'Your desk, sorted.', font=font(72), fill=(255, 255, 255))
    draw.text((60, 470), 'Start your 30-day free trial', font=font(52), fill=(230, 196, 119))
    draw.text((60, 560), 'The fastest desk booking app ever made.', font=font(36), fill=(220, 225, 235))
    draw.rounded_rectangle([60, 820, 520, 930], radius=20, fill=(180, 213, 160))
    draw.text((100, 850), 'Try LumaDesk', font=font(44), fill=(22, 32, 64))
    draw.text((60, 1010), 'Fictional brand for BrandGuard demos.', font=font(22), fill=(150, 160, 180))
    out = io.BytesIO()
    image.save(out, format='PNG', optimize=True)
    return out.getvalue()


class LocalOnlyReviewer:
    """Demo seeding never calls an AI provider: semantic checks stay visibly unavailable."""
    class config:
        model = 'local-only'

    async def review(self, *args, **kwargs):
        from .orchestration import disabled_semantic
        return disabled_semantic('external_processing_not_authorised')


class Builder:
    """Drives the real route functions as the seeded identities."""

    def __init__(self, session, engine, settings, members):
        self.session, self.engine, self.members = session, engine, members
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(settings=settings)))
        self.counter = 0

    def m(self, key):
        from .models import Membership
        return self.session.get(Membership, self.members[key])

    def source(self, brand_id, key, title, text, rules):
        from .review import create_source, activate_source
        from .schemas import SourceInput, ActivationInput
        from .models import Brand
        created = create_source(brand_id, SourceInput(source_key=key, title=title, text=text, rules=rules,
            valid_from=utcnow() - timedelta(days=30)), self.m('manager'), self.session)
        epoch = self.session.get(Brand, brand_id).source_epoch
        activate_source(created.id, ActivationInput(expected_epoch=epoch, verified=True,
            rationale='Published the fictional brand guide for the demo.'), self.request, self.m('manager'), self.session)
        return created.id

    def content(self, brand_id, title, text, context=CONTEXT):
        from .review import create_content
        from .schemas import ContentInput
        return create_content(ContentInput(brand_id=brand_id, title=title, text=text, **context), self.m('creator'), self.session)

    def analyse(self, revision_id):
        from .review import queue_analysis
        from .schemas import AnalysisInput
        from .orchestration import process_one
        from .engine_bridge import check_text
        from .models import ReviewRun
        self.counter += 1
        run = queue_analysis(revision_id, self.request, f'demo-seed-{self.counter:03d}', AnalysisInput(), self.m('creator'), self.session)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            process_one(self.engine, LocalOnlyReviewer(), check_text, run_id=run.id)
            self.session.expire_all()
            if self.session.get(ReviewRun, run.id).status not in ('queued', 'running'):
                break
            time.sleep(0.2)
        self.session.expire_all()
        return self.session.get(ReviewRun, run.id)

    def version(self, item_id):
        from .models import ContentItem
        self.session.expire_all()
        return self.session.get(ContentItem, item_id).workflow_version

    def findings(self, run_id, rule_id=None):
        from .models import Finding
        query = select(Finding).where(Finding.run_id == run_id)
        if rule_id:
            query = query.where(Finding.rule_id == rule_id)
        return list(self.session.scalars(query))

    def resolve(self, item_id, finding_id, action, who, rationale):
        from .workflow import resolve_finding
        from .schemas import ResolutionInput
        resolve_finding(finding_id, ResolutionInput(expected_item_version=self.version(item_id), action=action,
            rationale=rationale), self.m(who), self.session)

    def assign(self, item_id):
        from .workflow import assign_reviewer
        from .schemas import AssignmentInput
        assign_reviewer(item_id, AssignmentInput(expected_item_version=self.version(item_id), reviewer_id=self.members['reviewer'],
            rationale='Assigned the demo reviewer for this campaign.'), self.m('manager'), self.session)

    def complete_checks(self, item_id, run):
        """The reviewer records the AI categories by hand, citing the guide, as a human would."""
        from .workflow import complete_manual_check
        from .schemas import ManualCheckInput
        sources = [s['id'] for s in run.source_snapshot]
        for check in run.checks:
            if check['status'] in ('complete', 'not_applicable'):
                continue
            relevant = any(r['category'] == check['category'] for s in run.source_snapshot for r in s['rules'])
            complete_manual_check(run.id, ManualCheckInput(expected_item_version=self.version(item_id), category=check['category'],
                outcome='complete' if relevant else 'not_applicable', rationale=REASON, source_version_ids=sources if relevant else []),
                self.m('reviewer'), self.session)

    def submit(self, item_id, revision_id, run):
        from .workflow import submit_revision
        from .schemas import SubmissionInput
        submit_revision(revision_id, SubmissionInput(expected_item_version=self.version(item_id), expected_run_id=run.id,
            expected_source_epoch=run.source_epoch, reviewer_id=self.members['reviewer']), self.m('creator'), self.session)

    def decide(self, item_id, revision_id, run, kind='approved', rationale=REASON):
        from .workflow import decide_revision
        from .schemas import DecisionInput
        decide_revision(revision_id, DecisionInput(expected_item_version=self.version(item_id), expected_run_id=run.id,
            expected_source_epoch=run.source_epoch, kind=kind, rationale=rationale), self.m('reviewer'), self.session)

    def reviewed(self, brand_id, title, text, kind=None, exceptions=()):
        """Create, analyse and optionally take a campaign through review to `kind`."""
        item = self.content(brand_id, title, text)
        revision_id = item.revisions[0].id
        run = self.analyse(revision_id)
        if kind is None:
            return item.id, run
        self.assign(item.id)
        for rule_id in exceptions:
            for finding in self.findings(run.id, rule_id):
                self.resolve(item.id, finding.id, 'request_exception', 'creator', DISPUTE)
                self.resolve(item.id, finding.id, 'grant_exception', 'reviewer', 'Capitalised headline style; the name is correct.')
        self.complete_checks(item.id, run)
        self.submit(item.id, revision_id, run)
        if kind != 'in_review':
            self.decide(item.id, revision_id, run, kind, REASON if kind == 'approved'
                        else 'Please make the trial wording match the approved 14-day offer.')
        return item.id, run

    def image_campaign(self, brand_id, title, regions=None):
        """An uploaded ad with its OCR lines; with `regions`, the creator has confirmed the text."""
        from .models import ContentItem, Asset, OcrResult
        from .imaging import sha256
        data = sample_ad_png()
        at = utcnow()
        creator = self.m('creator')
        item = ContentItem(org_id=creator.org_id, brand_id=brand_id, title=title, creator_id=creator.id, current_revision=0,
                           state='text_check', created_at=at)
        self.session.add(item); self.session.flush()
        asset = Asset(org_id=creator.org_id, item_id=item.id, kind='image', mime='image/png', bytes=data, sha256=sha256(data),
            original_sha256=sha256(data), width=1080, height=1080, created_by=creator.id, created_at=at,
            intake=dict(channel='social', audience='Small and mid-sized teams', purpose='Launch ad'))
        self.session.add(asset); self.session.flush()
        self.session.add(OcrResult(org_id=creator.org_id, asset_id=asset.id, engine='tesseract', engine_version='demo seed',
            params=dict(note='Seeded lines for the demo; live uploads run Tesseract on the worker.'), words=[], lines=AD_LINES,
            mean_confidence=0.88, status='complete', created_at=at, completed_at=at))
        self.session.commit()
        if regions is None:
            return item.id, None
        from .images import confirm_image_text, ImageRevisionInput
        result = confirm_image_text(item.id, ImageRevisionInput(parent_revision_id=None, channel='social',
            audience='Small and mid-sized teams', purpose='Launch ad', regions=regions, deleted_line_ids=[]), creator, self.session)
        return item.id, result.revisions[-1].id


def confirmed_ad_regions(trial='14-day'):
    regions = []
    for line in AD_LINES:
        text = line['text']
        if line['id'] == 'r3':
            text = f'Start your {trial} free trial'
        if line['id'] == 'r4':
            continue  # deleted false claim line keeps the approved ad simple
        regions.append(dict(region_id=line['id'], box=line['box'], text=text,
                            origin='ocr' if text == line['text'] else 'corrected', ocr_line_id=line['id'], confirmed=True))
    return regions


def provision(engine, settings, *, ip_hash=None, hours=SANDBOX_HOURS):
    """Create a complete demo workspace. Returns (org_id, {role key: membership id})."""
    from .models import Organisation, User, Membership, Brand, ExampleSet, ExampleCase
    from .images import ImageRevisionInput
    at = utcnow()
    with Session(engine) as session:
        org = Organisation(name='LumaDesk demo (fictional)', is_demo=True, expires_at=at + timedelta(hours=hours), created_at=at,
                           created_ip_hash=ip_hash, daily_run_limit=SANDBOX_RUN_LIMIT)
        session.add(org); session.flush()
        token, members = secrets.token_hex(6), {}
        password_hash = passwords.hash(secrets.token_urlsafe(32))  # never revealed; the switcher signs in
        for key, role, label in ROLES:
            user = User(email=f'{key.replace("_", "-")}-{token}@demo.brandguard.test', password_hash=password_hash)
            session.add(user); session.flush()
            member = Membership(user_id=user.id, org_id=org.id, role=role, label=label)
            session.add(member); session.flush()
            members[key] = member.id
        luma = Brand(org_id=org.id, name='LumaDesk')
        northwind = Brand(org_id=org.id, name='Northwind Bikes')
        session.add_all([luma, northwind]); session.commit()
        b = Builder(session, engine, settings, members)
        b.source(luma.id, 'brand_guide', 'LumaDesk brand guide', GUIDE_TEXT, GUIDE_RULES)
        b.source(northwind.id, 'brand_guide', 'Northwind Bikes voice guide', NORTHWIND_TEXT, NORTHWIND_RULES)
        b.reviewed(luma.id, 'Spring newsletter', 'LumaDesk keeps hybrid teams in sync. Book a desk in two taps.', 'approved')
        b.reviewed(luma.id, 'Trial landing page', 'Try LumaDesk free for 14 days. No card needed.', 'approved')
        b.reviewed(luma.id, 'Partner email', 'LumaDesk makes desk booking simple for growing teams.', 'in_review')
        b.reviewed(luma.id, 'Product launch email', 'Meet the new LumaDesk floor planner. Start your 14-day free trial.', 'changes_requested')
        for n, line in enumerate(('Book a desk in seconds.', 'Your office, on demand.', 'Hybrid work, sorted.'), 1):
            item_id, run = b.reviewed(luma.id, f'Headline ad {n}', f'LUMADESK. {line}')
            for finding in b.findings(run.id, 'T01'):
                b.resolve(item_id, finding.id, 'request_dismissal', 'creator', DISPUTE)
        b.reviewed(luma.id, 'Black Friday banner', 'Start your 30-day free trial of LumaDesk today.')
        b.reviewed(luma.id, 'Webinar invite', 'Join the LumaDesk team for a calm walkthrough of desk booking.')
        b.content(luma.id, 'Social post draft', 'Coming soon: LumaDesk for your whole floor.')
        b.image_campaign(luma.id, 'Social ad (image, check text)')
        item_id, revision_id = b.image_campaign(luma.id, 'Display ad (image)', confirmed_ad_regions())
        run = b.analyse(revision_id)
        b.assign(item_id)
        for finding in b.findings(run.id, 'T01'):
            b.resolve(item_id, finding.id, 'request_exception', 'creator', DISPUTE)
            b.resolve(item_id, finding.id, 'grant_exception', 'reviewer', 'Capitalised headline style; the name is correct.')
        b.complete_checks(item_id, run)
        b.submit(item_id, revision_id, run)
        b.decide(item_id, revision_id, run)
        b.reviewed(northwind.id, 'Northwind spring ride', 'Northwind Bikes: find your trail this spring.', 'approved')
        example_set = ExampleSet(org_id=org.id, brand_id=luma.id, name='Saved examples', created_by=members['manager'], created_at=utcnow())
        session.add(example_set); session.flush()
        for label, text, expected in (('Misspelt brand', 'Try Lumadesk today.', 'flag'),
                                      ('Split brand name', 'Luma Desk is here.', 'flag'),
                                      ('Correct brand name', 'LumaDesk for teams.', 'no_flag')):
            session.add(ExampleCase(org_id=org.id, set_id=example_set.id, label=label, text=text,
                context=dict(channel='example', audience='example', purpose='example'),
                expectations=[dict(source_key='brand_guide', rule_id='T01', expected=expected)], external_ok=True,
                author_id=members['manager'], created_at=utcnow()))
        session.commit()
        return org.id, members


def start_session(session, response, request, member_id):
    from .models import SessionRecord
    token = secrets.token_urlsafe(32)
    csrf = digest('csrf:' + token)
    session.add(SessionRecord(token_hash=digest(token), csrf_hash=digest(csrf), membership_id=member_id,
                              expires_at=utcnow() + timedelta(hours=8)))
    response.set_cookie(COOKIE, token, httponly=True, secure=request.app.state.settings.environment != 'development',
                        samesite='strict', max_age=28800, path='/')
    return csrf


def demo_members(session, org_id):
    from .models import Membership, User
    order = {label: i for i, (_, _, label) in enumerate(ROLES)}
    rows = session.execute(select(Membership, User.email).join(User, User.id == Membership.user_id).where(
        Membership.org_id == org_id)).all()
    return sorted([DemoMemberOut(membership_id=m.id, role=m.role, label=m.label or m.role.title(), email=email) for m, email in rows],
                  key=lambda m: order.get(m.label, 99))


@router.post('/sandboxes', status_code=201, response_model=SandboxOut)
def create_sandbox(body: SandboxInput, request: Request, response: Response, session: Session = Depends(db)):
    """Try a private demo: a fresh workspace, signed in as the chosen role."""
    from .models import Organisation
    trusted_origin(request)
    if not enabled():
        raise Problem(404, 'not_found', 'Private demos are switched off.')
    at = utcnow()
    ip_hash = digest('demo:' + client_ip(request))
    recent = session.scalar(select(func.count()).select_from(Organisation).where(Organisation.is_demo == True,
        Organisation.created_ip_hash == ip_hash, Organisation.created_at >= at - timedelta(hours=1)))
    if recent >= PER_ADDRESS_PER_HOUR:
        raise Problem(429, 'rate_limited', 'Too many demos from this network. Try again within the hour.')
    active = session.scalar(select(func.count()).select_from(Organisation).where(Organisation.is_demo == True,
        Organisation.expires_at > at, or_(Organisation.created_ip_hash.is_(None), Organisation.created_ip_hash != POOL_MARK)))
    if active >= MAX_ACTIVE:
        raise Problem(503, 'demo_capacity', 'All demo workspaces are in use. Try again shortly.')
    session.close()
    claimed = claim_pooled(request.app.state.engine, ip_hash)
    org_id, members = claimed or provision(request.app.state.engine, request.app.state.settings, ip_hash=ip_hash)
    with Session(request.app.state.engine) as fresh:
        csrf = start_session(fresh, response, request, members[body.role])
        org = fresh.get(Organisation, org_id)
        fresh.commit()
        return SandboxOut(org_id=org_id, role=body.role, membership_id=members[body.role], csrf_token=csrf,
                          expires_at=org.expires_at, members=demo_members(fresh, org_id))


def claim_pooled(engine, ip_hash):
    """Hand a ready-made sandbox to this judge, restarting its 48-hour clock. None when the pool is empty."""
    from .models import Organisation, Membership
    with Session(engine) as session:
        org = session.scalar(select(Organisation).where(Organisation.is_demo == True, Organisation.created_ip_hash == POOL_MARK,
            Organisation.expires_at > utcnow() + timedelta(hours=1)).order_by(Organisation.created_at)
            .with_for_update(skip_locked=True).limit(1))
        if org is None:
            return None
        at = utcnow()
        org.created_ip_hash, org.created_at, org.expires_at = ip_hash, at, at + timedelta(hours=SANDBOX_HOURS)
        labels = {label: key for key, _, label in ROLES}
        members = {labels[m.label]: m.id for m in session.scalars(select(Membership).where(Membership.org_id == org.id))}
        org_id = org.id
        session.commit()
        return org_id, members


def fill_pool(engine, settings, size=None):
    """Top the pool up to `size` unclaimed sandboxes (DEMO_POOL_SIZE, default 3). Returns how many were made."""
    from .models import Organisation
    size = int(os.getenv('DEMO_POOL_SIZE', '3')) if size is None else size
    if not enabled():
        return 0
    made = 0
    while True:
        with Session(engine) as session:
            ready = session.scalar(select(func.count()).select_from(Organisation).where(Organisation.is_demo == True,
                Organisation.created_ip_hash == POOL_MARK, Organisation.expires_at > utcnow() + timedelta(hours=1)))
        if ready >= size:
            return made
        provision(engine, settings, ip_hash=POOL_MARK, hours=POOL_HOURS)
        made += 1


@router.get('/members', response_model=list[DemoMemberOut])
def list_demo_members(member=Depends(identity), session: Session = Depends(db)):
    from .models import Organisation
    org = session.get(Organisation, member.org_id)
    if not org.is_demo:
        raise Problem(404, 'not_found', 'The role switcher exists only in demo workspaces.')
    return demo_members(session, org.id)


@router.post('/switch', response_model=SandboxOut)
def switch_role(body: SwitchInput, request: Request, response: Response, member=Depends(identity), session: Session = Depends(db)):
    """Move this browser to another identity of the same demo workspace. Each role stays a separate
    member, so separation of duties still holds: the creator cannot approve their own work."""
    from .models import Organisation, Membership, SessionRecord
    org = session.get(Organisation, member.org_id)
    if not org.is_demo or (org.expires_at and org.expires_at <= utcnow()):
        raise Problem(403, 'forbidden', 'The role switcher exists only in active demo workspaces.')
    target = session.scalar(select(Membership).where(Membership.org_id == org.id, Membership.id == body.membership_id))
    if target is None:
        raise Problem(404, 'not_found', 'That demo identity does not exist in this workspace.')
    session.execute(delete(SessionRecord).where(SessionRecord.token_hash == digest(request.cookies.get(COOKIE, ''))))
    csrf = start_session(session, response, request, target.id)
    from .review import audit
    audit(session, member, 'demo.role_switched', target.id, to_role=target.role, to_label=target.label)
    session.commit()
    return SandboxOut(org_id=org.id, role=target.label or target.role, membership_id=target.id, csrf_token=csrf,
                      expires_at=org.expires_at, members=demo_members(session, org.id))


def purge_expired(engine, now=None):
    """Delete expired demo workspaces and everything in them. The worker runs this hourly."""
    from . import models as m
    now = now or utcnow()
    with Session(engine) as session:
        expired = list(session.scalars(select(m.Organisation.id).where(m.Organisation.is_demo == True,
            m.Organisation.expires_at <= now)))
        if not expired:
            return 0
        members = select(m.Membership.id).where(m.Membership.org_id.in_(expired))
        session.execute(delete(m.SessionRecord).where(m.SessionRecord.membership_id.in_(members)))
        for model in (m.RequestReview, m.ComparisonResult, m.ComparisonRun, m.ExampleCase, m.ExampleSet, m.RequestExample,
                      m.GuidelineRequest, m.RecheckAssignment, m.GuidelineChange, m.Comment, m.FindingResolution, m.ManualCheck,
                      m.Decision, m.Finding, m.Job, m.OcrResult, m.Asset, m.DocumentImport, m.RunSource, m.ReviewRun, m.ContentRevision,
                      m.ContentItem, m.SourceVersion, m.AuditEvent, m.ProcessingPolicy, m.Brand):
            session.execute(delete(model).where(model.org_id.in_(expired)))
        users = list(session.scalars(select(m.Membership.user_id).where(m.Membership.org_id.in_(expired))))
        session.execute(delete(m.Membership).where(m.Membership.org_id.in_(expired)))
        session.execute(delete(m.User).where(m.User.id.in_(users), ~m.User.id.in_(select(m.Membership.user_id))))
        session.execute(delete(m.Organisation).where(m.Organisation.id.in_(expired)))
        session.commit()
        return len(expired)


def main():
    """`python -m brandguard.demo purge` removes expired sandboxes; `provision` creates one and prints its id."""
    import sys
    from pathlib import Path
    from dotenv import load_dotenv
    from sqlalchemy import create_engine
    from .core import Settings
    load_dotenv(Path(__file__).resolve().parents[3] / '.env')
    engine = create_engine(os.environ['DATABASE_URL'], pool_pre_ping=True)
    settings = Settings(os.environ['DATABASE_URL'], os.getenv('PUBLIC_ORIGIN', 'http://localhost:8000'), os.getenv('APP_ENV', 'development'))
    command = sys.argv[1] if len(sys.argv) > 1 else 'purge'
    if command == 'provision':
        org_id, _ = provision(engine, settings)
        print(f'Demo workspace {org_id} provisioned.')
    else:
        print(f'Purged {purge_expired(engine)} expired demo workspace(s).')
    engine.dispose()


if __name__ == '__main__':
    main()

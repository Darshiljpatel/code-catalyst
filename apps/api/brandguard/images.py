"""Image campaigns (Improvement 2): upload, OCR status, image bytes and confirmed-text revisions."""
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from .core import db, identity, Problem, digest
from .imaging import ImageRejected, normalise_upload, build_region_map, sha256, LOW_CONFIDENCE, MAX_UPLOAD_BYTES
from .models import Asset, OcrResult, Job, ContentItem, ContentRevision, Membership
from .review import brand_for, item_for, content_out, audit
from . import quota
from .schemas import StrictInput, ContentOut

router = APIRouter(prefix='/api/v1')


def utcnow():
    return datetime.now(timezone.utc)


class Box(StrictInput):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class RegionInput(StrictInput):
    region_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,40}$')
    box: Box
    text: str = Field(default='', max_length=2000)
    origin: Literal['ocr', 'corrected', 'added', 'unreadable']
    ocr_line_id: str | None = Field(default=None, max_length=40)
    confirmed: bool = False

    @field_validator('text')
    @classmethod
    def single_line(cls, value):
        return ' '.join(value.replace('\r', ' ').replace('\n', ' ').split())


class ImageRevisionInput(StrictInput):
    parent_revision_id: str | None = Field(default=None, max_length=36)
    channel: str = Field(min_length=1, max_length=100)
    audience: str = Field(min_length=1, max_length=300)
    purpose: str = Field(min_length=1, max_length=500)
    regions: list[RegionInput] = Field(max_length=300)
    deleted_line_ids: list[str] = Field(default_factory=list, max_length=300)


class OcrOut(BaseModel):
    id: str
    asset_id: str
    status: str
    engine: str
    engine_version: str
    params: dict
    lines: list[dict]
    mean_confidence: float | None
    error_code: str | None
    low_confidence_threshold: float
    created_at: datetime
    completed_at: datetime | None


def asset_for(session, member, asset_id):
    asset = session.scalar(select(Asset).where(Asset.org_id == member.org_id, Asset.id == asset_id))
    if asset is None:
        raise Problem(404, 'not_found', 'Image not found.')
    item_for(session, member, asset.item_id)
    return asset


def latest_ocr(session, asset_id):
    return session.scalar(select(OcrResult).where(OcrResult.asset_id == asset_id).order_by(
        OcrResult.created_at.desc(), OcrResult.id.desc()).limit(1))


def ocr_out(result):
    return OcrOut(id=result.id, asset_id=result.asset_id, status=result.status, engine=result.engine,
        engine_version=result.engine_version, params=result.params, lines=result.lines,
        mean_confidence=result.mean_confidence, error_code=result.error_code, low_confidence_threshold=LOW_CONFIDENCE,
        created_at=result.created_at, completed_at=result.completed_at)


@router.post('/content/image', status_code=202, response_model=ContentOut)
async def upload_image(brand_id: str = Form(min_length=1, max_length=36), title: str = Form(min_length=1, max_length=200),
                       channel: str = Form(min_length=1, max_length=100), audience: str = Form(min_length=1, max_length=300),
                       purpose: str = Form(min_length=1, max_length=500), reviewer_id: str | None = Form(default=None, max_length=36),
                       file: UploadFile = File(...), member=Depends(identity), session: Session = Depends(db)):
    if member.role != 'creator':
        raise Problem(403, 'forbidden', 'A creator identity is required.')
    if not title.strip():
        raise Problem(422, 'invalid_fields', 'A campaign title is required.')
    brand_for(session, member, brand_id)
    quota.enforce(session, member, 'uploads')
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    try:
        clean, mime, width, height = normalise_upload(data)
    except ImageRejected as exc:
        raise Problem(413 if exc.code == 'image_too_large' else 415 if exc.code == 'unsupported_image' else 422, exc.code, exc.message)
    if reviewer_id:
        reviewer = session.scalar(select(Membership).where(Membership.org_id == member.org_id,
            Membership.id == reviewer_id, Membership.role == 'reviewer'))
        if reviewer is None:
            raise Problem(422, 'invalid_reviewer', 'Select a separate reviewer in this workspace.')
    at = utcnow()
    # No revision exists until the creator confirms the extracted text.
    item = ContentItem(org_id=member.org_id, brand_id=brand_id, title=title.strip(), creator_id=member.id,
        reviewer_id=reviewer_id or None, current_revision=0, state='ocr_pending', created_at=at)
    session.add(item); session.flush()
    asset = Asset(org_id=member.org_id, item_id=item.id, kind='image', mime=mime, bytes=clean, sha256=sha256(clean),
        original_sha256=sha256(data), width=width, height=height, created_by=member.id, created_at=at,
        intake=dict(channel=channel, audience=audience, purpose=purpose))
    session.add(asset); session.flush()
    result = OcrResult(org_id=member.org_id, asset_id=asset.id, engine='pending', engine_version='pending', params={},
        words=[], lines=[], status='queued', created_at=at)
    session.add(result); session.flush()
    session.add(Job(org_id=member.org_id, kind='ocr', ocr_result_id=result.id, status='queued', attempts=0,
                    available_at=at, created_at=at))
    audit(session, member, 'content.image_uploaded', item.id, asset_id=asset.id, sha256=asset.sha256,
          original_sha256=asset.original_sha256)
    session.commit()
    return content_out(session, item)


@router.get('/assets/{asset_id}')
def get_asset(asset_id: str, member=Depends(identity), session: Session = Depends(db)):
    asset = asset_for(session, member, asset_id)
    # Only PNG or JPEG ever reach storage, so this can never serve SVG or HTML.
    return Response(content=asset.bytes, media_type=asset.mime, headers={
        'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'", 'Content-Disposition': 'inline'})


@router.get('/assets/{asset_id}/ocr', response_model=OcrOut)
def get_ocr(asset_id: str, member=Depends(identity), session: Session = Depends(db)):
    asset = asset_for(session, member, asset_id)
    result = latest_ocr(session, asset.id)
    if result is None:
        raise Problem(404, 'not_found', 'No text extraction exists for this image.')
    return ocr_out(result)


@router.post('/content/{item_id}/image-revisions', status_code=201, response_model=ContentOut)
def confirm_image_text(item_id: str, body: ImageRevisionInput, member=Depends(identity), session: Session = Depends(db)):
    item = item_for(session, member, item_id, lock=True, edit=True)
    quota.enforce(session, member, 'revisions')
    asset = session.scalar(select(Asset).where(Asset.org_id == member.org_id, Asset.item_id == item.id).order_by(
        Asset.created_at.desc()).limit(1))
    if asset is None:
        raise Problem(409, 'not_image_campaign', 'This campaign has no image.')
    parent = session.scalar(select(ContentRevision).where(ContentRevision.org_id == member.org_id,
        ContentRevision.item_id == item.id, ContentRevision.number == item.current_revision)) if item.current_revision else None
    if (parent.id if parent else None) != body.parent_revision_id:
        raise Problem(409, 'stale_revision', 'Content changed. Reload before saving your revision.')
    if item.state in ('ocr_pending', 'analysing', 'in_review', 'approved'):
        raise Problem(409, 'workflow_locked', 'Wait for text extraction, analysis or review to finish.')
    ocr = latest_ocr(session, asset.id)
    lines = {line['id']: line for line in (ocr.lines if ocr else [])}
    ids = [r.region_id for r in body.regions]
    if len(set(ids)) != len(ids):
        raise Problem(422, 'invalid_regions', 'Each region needs a distinct id.')
    referenced = {r.ocr_line_id for r in body.regions if r.ocr_line_id}
    if not referenced.issubset(lines) or not set(body.deleted_line_ids).issubset(lines) or referenced & set(body.deleted_line_ids):
        raise Problem(422, 'invalid_regions', 'Regions must reference lines from this image’s text extraction.')
    # Uncertain text must be looked at by a person before it is checked against guidelines.
    for line in lines.values():
        if line['confidence'] < LOW_CONFIDENCE and line['id'] not in body.deleted_line_ids:
            region = next((r for r in body.regions if r.ocr_line_id == line['id']), None)
            if region is None or not region.confirmed:
                raise Problem(422, 'unconfirmed_low_confidence', 'Confirm or correct every highlighted low-confidence line first.')
    regions = []
    for region in body.regions:
        if region.origin != 'unreadable' and not region.text:
            raise Problem(422, 'invalid_regions', 'Delete empty lines or mark the region unreadable.')
        line = lines.get(region.ocr_line_id) if region.ocr_line_id else None
        origin = region.origin
        if line and origin == 'ocr' and region.text != line['text']:
            origin = 'corrected'
        regions.append(dict(region_id=region.region_id, box=region.box.model_dump(), text=region.text, origin=origin,
                            ocr_text=line['text'] if line else None, confidence=line['confidence'] if line else None))
    text, region_map = build_region_map(regions)
    if not text.strip():
        raise Problem(422, 'no_text', 'Type the text shown in the image, or draw a box around it, before checking.')
    at = utcnow()
    item.current_revision += 1
    item.workflow_version += 1
    item.state = 'draft'
    revision = ContentRevision(org_id=member.org_id, item_id=item.id, number=item.current_revision, author_id=member.id,
        text=text, text_hash=digest(text), channel=body.channel, audience=body.audience, purpose=body.purpose,
        created_at=at, asset_id=asset.id, asset_sha256=asset.sha256, region_map=region_map)
    session.add(revision); session.flush()
    audit(session, member, 'revision.image_text_confirmed', revision.id, asset_id=asset.id,
          corrected=sum(r['origin'] == 'corrected' for r in region_map), added=sum(r['origin'] == 'added' for r in region_map),
          unreadable=sum(r['origin'] == 'unreadable' for r in region_map), deleted=len(body.deleted_line_ids))
    session.commit()
    return content_out(session, item)

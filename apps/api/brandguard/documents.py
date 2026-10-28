"""PDF and DOCX draft import: extract text server-side in a bounded child, keep page/paragraph provenance and the file hash."""
import io
import json
import os
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, UploadFile, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from .core import db, identity, Problem, digest
from .imaging import _child_env, sha256
from .models import DocumentImport
from . import quota

router = APIRouter(prefix='/api/v1')

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_PAGES = 50
MAX_TEXT_CHARS = 100000
PDF = 'application/pdf'
DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'


class DocumentRejected(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


class DocumentImportOut(BaseModel):
    id: str
    filename: str
    media_type: str
    size_bytes: int
    original_sha256: str
    text: str
    text_hash: str
    pages: int | None
    blocks: list[dict]
    warnings: list[str]
    created_at: datetime


def sniff(data):
    if data[:5] == b'%PDF-':
        return PDF
    if data[:4] == b'PK\x03\x04':
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if 'word/document.xml' in archive.namelist():
                    return DOCX
        except zipfile.BadZipFile:
            return None
    return None


def extract_document(data):
    """Returns (media_type, text, blocks, pages, warnings) or raises DocumentRejected."""
    if len(data) > MAX_DOCUMENT_BYTES:
        raise DocumentRejected('document_too_large', 'Documents must be 10 MB or smaller.')
    media = sniff(data)
    if media is None:
        raise DocumentRejected('unsupported_document', 'Upload a PDF or Word (.docx) file.')
    try:
        process = subprocess.run([sys.executable, '-m', 'brandguard.documents', media], input=data, capture_output=True,
                                 timeout=30, env=_child_env())
        if process.returncode != 0:
            raise ValueError('child_failed')
        result = json.loads(process.stdout)
    except (subprocess.TimeoutExpired, ValueError, OSError):
        raise DocumentRejected('invalid_document', 'This file could not be read. It may be damaged, encrypted or too complex.')
    if 'error' in result:
        raise DocumentRejected(result['error'], result['message'])
    return media, result['text'], result['blocks'], result['pages'], result['warnings']


def _extract_child(media, data):
    from review_engine.extraction import extract
    if media == PDF:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            return dict(error='encrypted_document', message='This PDF is password-protected. Remove the password and try again.')
        if len(reader.pages) > MAX_PAGES:
            return dict(error='too_many_pages', message=f'PDFs can have at most {MAX_PAGES} pages; this one has {len(reader.pages)}.')
    result = extract(data, media, dict(max_bytes=MAX_DOCUMENT_BYTES, max_pages=MAX_PAGES))
    if result.status == 'failed':
        return dict(error='invalid_document', message='This file could not be read. It may be damaged or not a real PDF/DOCX.')
    if not result.blocks:
        return dict(error='no_text_layer', message='No text was found. Scanned PDFs need OCR: export the page as PNG or JPEG and use an image campaign.')
    # Rebuild the text with blank lines between PDF pages so offsets map back to the blocks.
    parts, blocks, offset, page = [], [], 0, None
    for block in result.blocks:
        prefix = '\n\n' if parts and media == PDF and block.page != page else ('\n' if parts else '')
        offset += len(prefix)
        parts.append(prefix + block.text)
        blocks.append(dict(page=block.page, paragraph=block.paragraph, start=offset, end=offset + len(block.text)))
        offset += len(block.text)
        page = block.page
    text = ''.join(parts)
    warnings = list(result.warnings)
    if len(text) > MAX_TEXT_CHARS:
        return dict(error='document_too_long', message='The extracted text exceeds 100,000 characters. Split the document into smaller campaigns.')
    pages = None
    if media == PDF:
        from pypdf import PdfReader
        pages = len(PdfReader(io.BytesIO(data)).pages)
        empty = pages - len({b['page'] for b in blocks})
        if empty:
            warnings.append(f'{empty} page{"s" if empty != 1 else ""} had no text layer and {"were" if empty != 1 else "was"} skipped.')
    return dict(text=text, blocks=blocks, pages=pages, warnings=warnings)


def _scanned_page_child(data):
    """First page without a text layer -> its largest embedded image as PNG, for the image pipeline."""
    import base64
    from PIL import Image
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        return dict(error='encrypted_document', message='This PDF is password-protected. Remove the password and try again.')
    if len(reader.pages) > MAX_PAGES:
        return dict(error='too_many_pages', message=f'PDFs can have at most {MAX_PAGES} pages; this one has {len(reader.pages)}.')
    scanned = [n for n, page in enumerate(reader.pages, 1) if not (page.extract_text() or '').strip()]
    for number in scanned:
        images = list(reader.pages[number - 1].images)
        if not images:
            continue
        best = max(images, key=lambda image: image.image.width * image.image.height)
        picture = best.image.convert('RGB')
        out = io.BytesIO()
        picture.save(out, format='PNG')
        return dict(png=base64.b64encode(out.getvalue()).decode(), page=number, scanned_pages=len(scanned), pages=len(reader.pages))
    return dict(error='no_page_image', message='No scanned page image was found. Export the page as PNG or JPEG and use an image campaign.')


def extract_scanned_page(data):
    """Returns (png_bytes, page, scanned_pages, pages) or raises DocumentRejected."""
    import base64
    if len(data) > MAX_DOCUMENT_BYTES:
        raise DocumentRejected('document_too_large', 'Documents must be 10 MB or smaller.')
    if sniff(data) != PDF:
        raise DocumentRejected('unsupported_document', 'Upload a scanned PDF.')
    try:
        process = subprocess.run([sys.executable, '-m', 'brandguard.documents', 'scan'], input=data, capture_output=True,
                                 timeout=30, env=_child_env())
        if process.returncode != 0:
            raise ValueError('child_failed')
        result = json.loads(process.stdout)
    except (subprocess.TimeoutExpired, ValueError, OSError):
        raise DocumentRejected('invalid_document', 'This file could not be read. It may be damaged, encrypted or too complex.')
    if 'error' in result:
        raise DocumentRejected(result['error'], result['message'])
    return base64.b64decode(result['png']), result['page'], result['scanned_pages'], result['pages']


def child_main(media):
    import resource
    limit = 768 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    data = sys.stdin.buffer.read(MAX_DOCUMENT_BYTES + 1)
    try:
        result = _scanned_page_child(data) if media == 'scan' else _extract_child(media, data)
    except Exception:
        result = dict(error='invalid_document', message='This file could not be read. It may be damaged, encrypted or too complex.')
    sys.stdout.write(json.dumps(result))


def safe_filename(name):
    name = os.path.basename((name or 'document').replace('\\', '/'))
    cleaned = ''.join(ch for ch in name if ch.isprintable()).strip() or 'document'
    return cleaned[:200]


@router.post('/imports/document', status_code=201, response_model=DocumentImportOut)
async def import_document(file: UploadFile = File(...), member=Depends(identity), session: Session = Depends(db)):
    if member.role != 'creator':
        raise Problem(403, 'forbidden', 'Only a creator can do this. Switch to the creator role or sign in as a creator.')
    quota.enforce(session, member, 'uploads')
    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    try:
        media, text, blocks, pages, warnings = extract_document(data)
    except DocumentRejected as error:
        raise Problem(413 if error.code == 'document_too_large' else 422, error.code, error.message)
    record = DocumentImport(org_id=member.org_id, created_by=member.id, filename=safe_filename(file.filename), media_type=media,
                            size_bytes=len(data), original_sha256=sha256(data), text=text, text_hash=digest(text), pages=pages,
                            blocks=blocks, warnings=warnings, created_at=datetime.now(timezone.utc))
    session.add(record)
    session.commit()
    return DocumentImportOut.model_validate(record, from_attributes=True)


@router.post('/imports/scanned-page')
async def scanned_page(file: UploadFile = File(...), member=Depends(identity), session: Session = Depends(db)):
    """A scanned PDF page as a PNG, so the creator can check it as an image campaign with OCR."""
    if member.role != 'creator':
        raise Problem(403, 'forbidden', 'Only a creator can do this. Switch to the creator role or sign in as a creator.')
    quota.enforce(session, member, 'uploads')
    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    try:
        png, page, scanned, pages = extract_scanned_page(data)
    except DocumentRejected as error:
        raise Problem(413 if error.code == 'document_too_large' else 422, error.code, error.message)
    return Response(content=png, media_type='image/png', headers={
        'X-Scanned-Page': str(page), 'X-Scanned-Pages': str(scanned), 'X-Page-Count': str(pages)})


def source_document_for(session, member, import_id, text):
    """Provenance snapshot stored on a revision created from an imported document."""
    if import_id is None:
        return None
    record = session.scalar(select(DocumentImport).where(DocumentImport.org_id == member.org_id, DocumentImport.id == import_id,
                                                         DocumentImport.created_by == member.id))
    if record is None:
        raise Problem(404, 'not_found', 'Document import not found. Import the file again.')
    edited = digest(text) != record.text_hash
    return dict(import_id=record.id, filename=record.filename, media_type=record.media_type, original_sha256=record.original_sha256,
                extracted_text_hash=record.text_hash, pages=record.pages, edited=edited,
                blocks=None if edited else record.blocks, warnings=record.warnings)


if __name__ == '__main__':
    child_main(sys.argv[1] if len(sys.argv) > 1 else PDF)

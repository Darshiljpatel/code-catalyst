import hashlib
import io
from docx import Document
from test_identity import setup, login
from test_images import image_brand, CONTEXT
from brandguard import quota
from brandguard.documents import extract_document, DocumentRejected, sniff, PDF, DOCX


def make_pdf(pages):
    """A minimal PDF with one Helvetica text line per entry; an empty list is a page without a text layer."""
    objects = ['<< /Type /Catalog /Pages 2 0 R >>', None, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    kids = []
    for lines in pages:
        stream = 'BT /F1 12 Tf 72 720 Td ' + ' '.join(f'({line}) Tj 0 -16 Td' for line in lines) + ' ET'
        objects.append(f'<< /Length {len(stream)} >>\nstream\n{stream}\nendstream')
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {len(objects)} 0 R >>')
        kids.append(f'{len(objects)} 0 R')
    objects[1] = f'<< /Type /Pages /Kids [{" ".join(kids)}] /Count {len(kids)} >>'
    out, offsets = b'%PDF-1.4\n', []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f'{number} 0 obj\n{body}\nendobj\n'.encode()
    xref = len(out)
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    out += ''.join(f'{offset:010d} 00000 n \n' for offset in offsets).encode()
    out += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return out


def make_docx(paragraphs):
    document = Document()
    for text in paragraphs:
        document.add_paragraph(text)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


LAUNCH_PDF = make_pdf([['LumaDesk spring launch', 'Start your 30-day free trial'], [], ['Calm tools for small teams']])


def test_pdf_and_docx_extraction_keeps_page_and_paragraph_provenance():
    media, text, blocks, pages, warnings = extract_document(LAUNCH_PDF)
    assert media == PDF and pages == 3
    assert text == 'LumaDesk spring launch\nStart your 30-day free trial\n\nCalm tools for small teams'
    assert [(b['page'], b['paragraph']) for b in blocks] == [(1, 1), (1, 2), (3, 1)]
    assert all(text[b['start']:b['end']] for b in blocks) and text[blocks[2]['start']:blocks[2]['end']] == 'Calm tools for small teams'
    assert warnings == ['1 page had no text layer and was skipped.']
    media, text, blocks, pages, _ = extract_document(make_docx(['Headline', '', 'Body copy here.']))
    assert media == DOCX and pages is None and text == 'Headline\nBody copy here.'
    assert [b['paragraph'] for b in blocks] == [1, 3]


def test_extraction_rejects_unsupported_scanned_damaged_and_oversized_files(monkeypatch):
    def code(data):
        try:
            extract_document(data)
        except DocumentRejected as error:
            return error.code
    assert sniff(b'plain text') is None and code(b'plain text') == 'unsupported_document'
    assert code(make_pdf([[]])) == 'no_text_layer'
    assert code(LAUNCH_PDF[:200]) == 'invalid_document'
    assert code(b'PK\x03\x04not a zip') == 'unsupported_document'
    assert code(make_pdf([['page']] * 51)) == 'too_many_pages'
    monkeypatch.setattr('brandguard.documents.MAX_DOCUMENT_BYTES', 100)
    assert code(LAUNCH_PDF) == 'document_too_large'


def test_imported_document_becomes_a_campaign_with_file_hash_and_provenance(setup):
    c, _, orgs, _ = setup
    bid = image_brand(c, orgs)
    h = login(c, orgs[0], 'creator')
    r = c.post('/api/v1/imports/document', files=dict(file=('../../Spring launch.pdf', LAUNCH_PDF, 'application/pdf')), headers=h)
    assert r.status_code == 201, r.text
    imported = r.json()
    assert imported['filename'] == 'Spring launch.pdf' and imported['original_sha256'] == hashlib.sha256(LAUNCH_PDF).hexdigest()
    item = c.post('/api/v1/content', json=dict(brand_id=bid, title='Spring launch', text=imported['text'],
                  document_import_id=imported['id'], **CONTEXT), headers=h).json()
    source = item['revisions'][0]['source_document']
    assert source['original_sha256'] == imported['original_sha256'] and source['pages'] == 3 and not source['edited']
    assert source['blocks'][2]['page'] == 3
    # Editing the extracted text keeps the file hash but drops offsets that no longer line up.
    revised = c.post(f"/api/v1/content/{item['id']}/revisions", json=dict(parent_revision_id=item['revisions'][0]['id'],
                     text=imported['text'] + '\nNew line.', document_import_id=imported['id'], **CONTEXT), headers=h).json()
    latest = revised['revisions'][-1]['source_document']
    assert latest['edited'] and latest['blocks'] is None and latest['original_sha256'] == imported['original_sha256']
    assert c.post('/api/v1/imports/document', files=dict(file=('a.txt', b'hello', 'text/plain')), headers=h).json()['code'] == 'unsupported_document'
    scanned = c.post('/api/v1/imports/document', files=dict(file=('scan.pdf', make_pdf([[]]), 'application/pdf')), headers=h)
    assert scanned.status_code == 422 and scanned.json()['code'] == 'no_text_layer'
    # Imports belong to the creator who uploaded them and to their workspace.
    mh = login(c, orgs[0])
    assert c.post('/api/v1/imports/document', files=dict(file=('a.pdf', LAUNCH_PDF, 'application/pdf')), headers=mh).status_code == 403
    h = login(c, orgs[0], 'creator')
    r = c.post('/api/v1/content', json=dict(brand_id=bid, title='x', text='x', document_import_id='missing-import', **CONTEXT), headers=h)
    assert r.status_code == 404 and r.json()['code'] == 'not_found'


def test_members_hit_an_hourly_cap_on_drafts_analysis_and_uploads(setup, monkeypatch):
    c, _, orgs, _ = setup
    bid = image_brand(c, orgs)
    h = login(c, orgs[0], 'creator')
    for bucket in ('revisions', 'uploads', 'analysis'):
        monkeypatch.setitem(quota.HOURLY_LIMITS, bucket, 1)
    items = [c.post('/api/v1/content', json=dict(brand_id=bid, title='One', text='Calm copy.', **CONTEXT), headers=h).json()]
    r = c.post('/api/v1/content', json=dict(brand_id=bid, title='Two', text='Calm copy.', **CONTEXT), headers=h)
    assert r.status_code == 429 and r.json()['code'] == 'member_rate_limited'
    monkeypatch.setitem(quota.HOURLY_LIMITS, 'revisions', 2)
    items.append(c.post('/api/v1/content', json=dict(brand_id=bid, title='Two', text='Calm copy.', **CONTEXT), headers=h).json())
    assert c.post('/api/v1/imports/document', files=dict(file=('a.pdf', LAUNCH_PDF, 'application/pdf')), headers=h).status_code == 201
    r = c.post('/api/v1/imports/document', files=dict(file=('a.pdf', LAUNCH_PDF, 'application/pdf')), headers=h)
    assert r.status_code == 429 and r.json()['code'] == 'member_rate_limited'
    runs = [c.post(f"/api/v1/revisions/{item['revisions'][0]['id']}/analysis", json={}, headers={**h, 'Idempotency-Key': f'quota-run-{n}'})
            for n, item in enumerate(items)]
    assert runs[0].status_code == 202 and runs[1].status_code == 429 and runs[1].json()['code'] == 'member_rate_limited'

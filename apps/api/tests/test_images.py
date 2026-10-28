import io
import shutil
import pytest
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_identity import setup, login
from test_orchestration import policy, reviewer
from test_impact import guide
from test_review import activate
from test_workflow import REASON
from brandguard.engine_bridge import check_text
from brandguard.imaging import build_region_map, group_lines, merge_words, regions_for, OcrEngine, sniff
from brandguard.models import Asset, Finding, ReviewRun
from brandguard.orchestration import process_one, process_ocr_one

CONTEXT = dict(channel='social', audience='Small teams', purpose='Launch ad')


def png(size=(400, 200), color=(20, 40, 200)):
    out = io.BytesIO()
    Image.new('RGB', size, color).save(out, format='PNG')
    return out.getvalue()


def jpeg_with_metadata():
    image = Image.new('RGB', (300, 100), (200, 30, 30))
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 degrees when displayed
    exif[0x010F] = 'Phone maker'  # camera metadata must not survive ingest
    exif.get_ifd(0x8825)[1] = 'N'  # GPS latitude reference
    out = io.BytesIO()
    image.save(out, format='JPEG', exif=exif)
    return out.getvalue()


class FakeOcr(OcrEngine):
    name = 'fake-ocr'

    def __init__(self, lines):
        self.lines = lines

    def recognise(self, data):
        assert sniff(data)
        return dict(status='complete', engine=self.name, engine_version='fake 1.0', params=dict(psm=11),
                    words=[], lines=self.lines, mean_confidence=0.9)


AD_LINES = [
    dict(id='r1', text='LumaDesk for teams', confidence=0.97, box=dict(x=0.1, y=0.1, w=0.6, h=0.1)),
    dict(id='r2', text='Start your 3O-day free trial', confidence=0.62, box=dict(x=0.1, y=0.4, w=0.7, h=0.1)),
    dict(id='r3', text='%%', confidence=0.3, box=dict(x=0.8, y=0.9, w=0.1, h=0.05)),
]


def upload(c, orgs, bid, data, name='ad.png'):
    h = login(c, orgs[0], 'creator')
    return c.post('/api/v1/content/image', data=dict(brand_id=bid, title='Launch ad', **CONTEXT),
                  files=dict(file=(name, data, 'image/png')), headers=h), h


def image_brand(c, orgs):
    mh = login(c, orgs[0])
    bid = c.post('/api/v1/brands', json={'name': 'LumaDesk'}, headers=mh).json()['id']
    body = guide()
    body['text'] += ' Use calm language.'
    body['rules'].append(dict(id='G01', category='tone', kind='guidance', key='tone', value='Use calm language.',
                              evidence_quote='Use calm language.'))
    s = c.post(f'/api/v1/brands/{bid}/sources', json=body, headers=mh).json()
    assert activate(c, s['id'], mh).status_code == 200
    return bid


def confirmed_regions(fix='30-day'):
    return [dict(region_id='r1', box=AD_LINES[0]['box'], text='LumaDesk for teams', origin='ocr', ocr_line_id='r1', confirmed=True),
            dict(region_id='r2', box=AD_LINES[1]['box'], text=f'Start your {fix} free trial', origin='corrected', ocr_line_id='r2', confirmed=True),
            dict(region_id='a1', box=dict(x=0.1, y=0.7, w=0.3, h=0.08), text='', origin='unreadable')]


def test_upload_rejects_wrong_type_damage_bombs_and_animation(setup):
    c, _, orgs, _ = setup
    bid = image_brand(c, orgs)
    assert upload(c, orgs, bid, b'GIF89a' + b'\0' * 100)[0].status_code == 415
    assert upload(c, orgs, bid, b'<svg xmlns="http://www.w3.org/2000/svg"/>')[0].status_code == 415
    assert upload(c, orgs, bid, png()[:60])[0].json()['code'] == 'invalid_image'
    assert upload(c, orgs, bid, b'\x89PNG\r\n\x1a\n' + b'\0' * (8 * 1024 * 1024 + 10))[0].status_code == 413
    bomb = io.BytesIO(); Image.new('L', (6000, 6000)).save(bomb, format='PNG')
    assert upload(c, orgs, bid, bomb.getvalue())[0].json()['code'] == 'image_too_large'
    frames = [Image.new('RGB', (50, 50), color) for color in ((255, 0, 0), (0, 255, 0))]
    animated = io.BytesIO(); frames[0].save(animated, format='PNG', save_all=True, append_images=frames[1:])
    assert upload(c, orgs, bid, animated.getvalue())[0].json()['code'] == 'animated_image'
    assert c.post('/api/v1/content/image', data=dict(brand_id=bid, title='x', **CONTEXT), files=dict(file=('a.png', png(), 'image/png')),
                  headers=login(c, orgs[0], 'manager')).status_code == 403


def test_jpeg_metadata_is_stripped_and_orientation_applied(setup):
    c, engine, orgs, _ = setup
    bid = image_brand(c, orgs)
    original = jpeg_with_metadata()
    r, h = upload(c, orgs, bid, original, 'photo.jpg')
    assert r.status_code == 202, r.text
    image = r.json()['image']
    assert (image['width'], image['height']) == (100, 300) and image['mime'] == 'image/jpeg'
    stored = c.get(f"/api/v1/assets/{image['asset_id']}", headers=h)
    assert stored.headers['content-type'] == 'image/jpeg' and 'private' in stored.headers['cache-control']
    assert stored.headers['x-content-type-options'] == 'nosniff'
    assert not Image.open(io.BytesIO(stored.content)).getexif()
    with Session(engine) as db:
        asset = db.get(Asset, image['asset_id'])
        assert asset.original_sha256 != asset.sha256
    other = login(c, orgs[0], 'reviewer')
    assert c.get(f"/api/v1/assets/{image['asset_id']}", headers=other).status_code == 404


def test_ocr_correction_regions_findings_and_export_with_image_hash(setup):
    c, engine, orgs, _ = setup
    bid = image_brand(c, orgs)
    assert policy(c, orgs).status_code == 200
    r, h = upload(c, orgs, bid, png())
    item = r.json()
    assert item['state'] == 'ocr_pending' and item['revisions'] == [] and item['image']['ocr_status'] == 'queued'
    assert process_ocr_one(engine, FakeOcr(AD_LINES))
    item = c.get(f"/api/v1/content/{item['id']}", headers=h).json()
    assert item['state'] == 'text_check' and item['image']['intake'] == CONTEXT
    ocr = c.get(f"/api/v1/assets/{item['image']['asset_id']}/ocr", headers=h).json()
    assert [l['id'] for l in ocr['lines']] == ['r1', 'r2', 'r3'] and ocr['engine'] == 'fake-ocr'
    path = f"/api/v1/content/{item['id']}/image-revisions"
    unconfirmed = [dict(confirmed_regions()[0]), dict(confirmed_regions()[1], confirmed=False)]
    assert c.post(path, json=dict(parent_revision_id=None, regions=unconfirmed, deleted_line_ids=['r3'], **CONTEXT), headers=h).json()['code'] == 'unconfirmed_low_confidence'
    assert c.post(path, json=dict(parent_revision_id=None, regions=confirmed_regions(), **CONTEXT), headers=h).json()['code'] == 'unconfirmed_low_confidence'
    # A first pass keeps the OCR mistake so the finding lights up its region.
    r = c.post(path, json=dict(parent_revision_id=None, regions=confirmed_regions('30-day'), deleted_line_ids=['r3'], **CONTEXT), headers=h)
    assert r.status_code == 201, r.text
    revision = r.json()['revisions'][0]
    assert revision['text'] == 'LumaDesk for teams\nStart your 30-day free trial'
    region = {e['region_id']: e for e in revision['region_map']}
    assert region['r2']['origin'] == 'corrected' and region['r2']['ocr_text'] == 'Start your 3O-day free trial'
    assert revision['text'][region['r2']['start']:region['r2']['end']] == 'Start your 30-day free trial'
    assert region['a1']['origin'] == 'unreadable' and region['a1']['start'] is None
    run = c.post(f"/api/v1/revisions/{revision['id']}/analysis", json=dict(external_processing_consent=True, policy_version=1),
                 headers={**h, 'Idempotency-Key': 'image-run-1'}).json()
    process_one(engine, reviewer(), check_text)
    result = c.get(f"/api/v1/runs/{run['id']}", headers=h).json()
    fact = next(f for f in result['findings'] if f['rule_id'] == 'F01')
    assert fact['location']['regions'] == ['r2']
    checks = {x['category']: x for x in result['checks']}
    assert checks['visual']['status'] == 'needs_manual_review' and 'Image campaign' in checks['visual']['reason']
    # The creator fixes the claim, re-confirms the text and the campaign goes through review.
    r = c.post(path, json=dict(parent_revision_id=revision['id'], regions=confirmed_regions('14-day'), deleted_line_ids=['r3'], **CONTEXT), headers=h)
    assert r.status_code == 201, r.text
    revision = r.json()['revisions'][-1]
    assert c.post(f"/api/v1/content/{item['id']}/revisions", json=dict(parent_revision_id=revision['id'], text='Plain', **CONTEXT),
                  headers=h).json()['code'] == 'image_campaign'
    run = c.post(f"/api/v1/revisions/{revision['id']}/analysis", json=dict(external_processing_consent=True, policy_version=1),
                 headers={**h, 'Idempotency-Key': 'image-run-2'}).json()
    process_one(engine, reviewer(), check_text)
    with Session(engine) as db:
        assert not db.scalar(select(Finding.id).where(Finding.run_id == run['id'], Finding.rule_id == 'F01'))
    from test_workflow import assign
    rid = login(c, orgs[0], 'manager') and c.get('/api/v1/reviewers').json()[0]['id']
    item = c.get(f"/api/v1/content/{item['id']}").json()
    mh = login(c, orgs[0])
    assert c.put(f"/api/v1/content/{item['id']}/reviewer", json=dict(reviewer_id=rid, expected_item_version=item['workflow_version'],
        rationale=REASON), headers=mh).status_code == 200
    rh = login(c, orgs[0], 'reviewer')
    result = c.get(f"/api/v1/runs/{run['id']}", headers=rh).json()
    for check in result['checks']:
        if check['status'] in ('complete', 'not_applicable'):
            continue
        version = c.get(f"/api/v1/content/{item['id']}", headers=rh).json()['workflow_version']
        r = c.post(f"/api/v1/runs/{run['id']}/manual-checks", json=dict(expected_item_version=version, category=check['category'],
            outcome='not_applicable', rationale='Checked the image by eye; no brand visual rules apply.', source_version_ids=[]), headers=rh)
        assert r.status_code == 201, r.text
    ch = login(c, orgs[0], 'creator')
    version = c.get(f"/api/v1/content/{item['id']}", headers=ch).json()['workflow_version']
    guard = dict(expected_item_version=version, expected_run_id=run['id'], expected_source_epoch=run['source_epoch'])
    for f in c.get(f"/api/v1/runs/{run['id']}", headers=ch).json()['findings']:
        assert f['severity'] != 'blocker', f
    r = c.post(f"/api/v1/revisions/{revision['id']}/submit", json=dict(guard, reviewer_id=rid), headers=ch)
    assert r.status_code == 200, r.text
    rh = login(c, orgs[0], 'reviewer')
    guard['expected_item_version'] = r.json()['workflow_version']
    r = c.post(f"/api/v1/revisions/{revision['id']}/decisions", json=dict(guard, kind='approved', rationale=REASON), headers=rh)
    assert r.status_code == 201, r.text
    exported = c.get(f"/api/v1/revisions/{revision['id']}/export", headers=rh).json()
    assert exported['image_sha256'] == revision['asset_sha256'] and exported['region_map'][1]['final_text'] == 'Start your 14-day free trial'
    image = exported['evidence_record']['image']
    assert image['sha256'] == revision['asset_sha256'] and image['corrections'] == 1 and image['unreadable_regions'] == 1
    assert image['ocr']['engine'] == 'fake-ocr'
    with Session(engine) as db:
        asset = db.get(Asset, revision['asset_id'])
        asset.bytes = png(color=(0, 0, 0)); db.commit()
    assert c.get(f"/api/v1/revisions/{revision['id']}/export", headers=rh).json()['code'] == 'asset_hash_mismatch'


def test_line_grouping_reading_order_and_region_offsets_with_multibyte_text():
    words = [dict(text='trial', confidence=0.9, box=dict(x=0.5, y=0.41, w=0.1, h=0.05)),
             dict(text='Free', confidence=0.8, box=dict(x=0.3, y=0.4, w=0.1, h=0.05)),
             dict(text='LumaDesk', confidence=0.95, box=dict(x=0.2, y=0.1, w=0.3, h=0.08))]
    lines = group_lines(words)
    assert [l['text'] for l in lines] == ['LumaDesk', 'Free trial'] and lines[1]['confidence'] == 0.8
    merged = merge_words([[dict(words[0], confidence=0.5)], [words[0]]])
    assert len(merged) == 1 and merged[0]['confidence'] == 0.9
    text, region_map = build_region_map([dict(region_id='a', box={}, text='Café ✨', origin='ocr'),
                                         dict(region_id='b', box={}, text='', origin='unreadable'),
                                         dict(region_id='c', box={}, text='Trial 14 días', origin='added')])
    assert text == 'Café ✨\nTrial 14 días'
    c = next(r for r in region_map if r['region_id'] == 'c')
    assert text[c['start']:c['end']] == 'Trial 14 días'
    assert regions_for(region_map, text.index('14'), text.index('14') + 2) == ['c']
    assert regions_for(region_map, 0, len(text)) == ['a', 'c']


def drawn_ad():
    """White ad with dark navy headline at the top and pale grey small print lower down."""
    from PIL import ImageDraw
    image = Image.new('RGB', (400, 200), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((50, 25, 270, 35), fill=(20, 40, 120))
    draw.rectangle((50, 85, 300, 92), fill=(200, 200, 200))
    out = io.BytesIO()
    image.save(out, format='PNG')
    return out.getvalue()


def test_region_colours_are_measured_from_the_image():
    from brandguard.imaging import measure_region_colours
    _, region_map = build_region_map([
        dict(region_id='r1', box=dict(x=0.1, y=0.1, w=0.6, h=0.1), text='LumaDesk for teams', origin='ocr'),
        dict(region_id='r2', box=dict(x=0.1, y=0.4, w=0.7, h=0.1), text='Small print', origin='ocr'),
        dict(region_id='a1', box=dict(x=0.1, y=0.7, w=0.3, h=0.08), text='', origin='unreadable')])
    measured = {e['region_id']: e for e in measure_region_colours(drawn_ad(), region_map)}
    assert measured['r1']['colours']['background'] == '#ffffff' and measured['r1']['colours']['foreground'] == '#142878'
    assert measured['r1']['colours']['contrast_ratio'] > 10
    assert measured['r2']['colours']['contrast_ratio'] < 2 and 'colours' not in measured['a1']


def test_contrast_and_palette_checks_cite_rules_and_light_up_regions():
    import asyncio
    from brandguard.orchestration import ReviewInput, checked_engine_result
    text = 'LumaDesk for teams\nSmall print'
    source = dict(id='s1', text='Text needs a 4.5:1 contrast. Use navy #142878 and white #ffffff.', valid_from='2026-01-01T00:00:00+00:00',
                  valid_until=None, rules=[
        dict(id='A01', category='accessibility', kind='contrast', key='text_contrast', value='4.5', evidence_quote='Text needs a 4.5:1 contrast.'),
        dict(id='V01', category='visual', kind='asset', key='brand_palette', value='#142878, #ffffff', evidence_quote='Use navy #142878 and white #ffffff.')])
    regions = [dict(start=0, end=18, foreground='#142878', background='#ffffff', contrast_ratio=13.1, text_height_px=20),
               dict(start=19, end=30, foreground='#c8c8c8', background='#ffffff', contrast_ratio=1.7, text_height_px=20)]
    review_input = ReviewInput(text, dict(CONTEXT, media='image', text_regions=regions), [source])
    result = asyncio.run(check_text(review_input))
    checks, findings = checked_engine_result(result, review_input)
    by_rule = {f['rule_id']: f for f in findings}
    assert set(by_rule) == {'A01', 'V01'}
    assert by_rule['A01']['content_quote'] == 'Small print' and by_rule['A01']['severity'] == 'warning'
    assert '1.7:1' in by_rule['A01']['rationale'] and by_rule['V01']['severity'] == 'advisory'
    status = {c['category']: c for c in checks}
    assert status['accessibility']['status'] == 'needs_manual_review' and 'estimated' in status['accessibility']['reason']
    # Without colour rules the image categories stay a manual look.
    plain = ReviewInput(text, dict(CONTEXT, media='image', text_regions=regions), [dict(source, rules=[])])
    assert not asyncio.run(check_text(plain)).findings


def test_ocr_lines_keep_words_together_when_a_later_word_sits_higher():
    from brandguard.imaging import group_lines

    def word(text, x, y, w, h=0.06):
        return dict(text=text, confidence=0.9, box=dict(x=x, y=y, w=w, h=h))
    # "Desk" (capital D) tops out a pixel above "Luma"; both must stay on one line, in reading order.
    words = [word('Desk', 0.22, 0.300, 0.1), word('Luma', 0.10, 0.302, 0.1), word('teams', 0.34, 0.304, 0.12),
             word('$12', 0.10, 0.40, 0.05), word('per', 0.16, 0.398, 0.05), word('seat', 0.22, 0.401, 0.06),
             # A separate block level with the first line, far to the right, stays its own line.
             word('NEW', 0.85, 0.301, 0.08)]
    assert [l['text'] for l in group_lines(words)] == ['Luma Desk teams', 'NEW', '$12 per seat']


@pytest.mark.skipif(shutil.which('tesseract') is None, reason='Tesseract is not installed')
def test_image_campaign_through_real_tesseract_links_the_claim_to_its_region(setup):
    from pathlib import Path
    from brandguard.imaging import TesseractEngine
    c, engine, orgs, _ = setup
    mh = login(c, orgs[0])
    bid = c.post('/api/v1/brands', json={'name': 'LumaDesk'}, headers=mh).json()['id']
    s = c.post(f'/api/v1/brands/{bid}/sources', json=guide('30 days'), headers=mh).json()
    assert activate(c, s['id'], mh).status_code == 200
    # Synthetic benchmark graphic: "LumaDesk / Start your 14-day free trial / Team plans from $12 per seat".
    data = (Path(__file__).resolve().parents[3] / 'evaluation/fixtures/ocr/ad-01.png').read_bytes()
    r, h = upload(c, orgs, bid, data)
    assert r.status_code == 202, r.text
    item = r.json()
    assert process_ocr_one(engine, TesseractEngine())
    ocr = c.get(f"/api/v1/assets/{item['image']['asset_id']}/ocr", headers=h).json()
    assert ocr['status'] == 'complete' and ocr['engine'] == 'tesseract', ocr
    assert [l['text'] for l in ocr['lines']] == ['LumaDesk', 'Start your 14-day free trial', 'Team plans from $12 per seat']
    regions = [dict(region_id=l['id'], box=l['box'], text=l['text'], origin='ocr', ocr_line_id=l['id'], confirmed=True)
               for l in ocr['lines']]
    r = c.post(f"/api/v1/content/{item['id']}/image-revisions", json=dict(parent_revision_id=None, regions=regions, **CONTEXT), headers=h)
    assert r.status_code == 201, r.text
    revision = r.json()['revisions'][0]
    run = c.post(f"/api/v1/revisions/{revision['id']}/analysis", headers={**h, 'Idempotency-Key': 'real-ocr'}).json()
    process_one(engine, reviewer(), check_text)
    findings = c.get(f"/api/v1/runs/{run['id']}", headers=h).json()['findings']
    trial = next(f for f in findings if f['rule_id'] == 'F01')
    assert trial['location']['regions'] == [ocr['lines'][1]['id']]

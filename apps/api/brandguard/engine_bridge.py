"""Translate the real review engine into the backend contract, with bounded execution."""
import asyncio
import hashlib
import json
import os
import re
from pathlib import Path
import sys

CATEGORIES = ('terminology', 'facts_claims', 'visual', 'accessibility')
ENGINE_VERSION = 'review-engine.p2.s5-bridge.v2'
MAX_PAYLOAD = 2_000_000
MAX_RESPONSE = 524_288
MAX_BATCH_PAYLOAD = 16_000_000


def failed(code):
    return dict(checks=[dict(category=c, status='failed', reason=code) for c in CATEGORIES],
                findings=[], metadata=dict(version=ENGINE_VERSION, error_code=code))


def _check_text(payload):
    from review_engine.extraction import extract
    from review_engine.deterministic import check

    text, sources = payload['text'], payload['sources']
    if len(text) > 100_000 or '\r' in text or sum(len(s['rules']) for s in sources) > 1000:
        return failed('engine_input_limit')
    # P1 extraction retains LF-normalised text and global Unicode offsets.
    extraction = extract(text.encode('utf-8'), 'text/plain', {'max_bytes': 400_000})
    expected_hash = hashlib.sha256(text.encode('utf-8')).hexdigest()
    if extraction.status != 'complete' or extraction.canonical_sha256 != expected_hash:
        return failed('canonical_text_mismatch')
    lookup = {(s['id'], r['id']): (s, r) for s in sources for r in s['rules']}
    unsupported = set()
    adapted = []
    for source in sources:
        rules = []
        for rule in source['rules']:
            if rule['category'] == 'terminology':
                if rule['kind'] == 'terminology':
                    rules.append(rule)
                else:
                    unsupported.add('terminology')
            elif rule['category'] == 'facts_claims' and rule['kind'] == 'fact':
                # P2's implemented structured numeric check is trial duration.
                # Other structured facts remain visible for human/semantic review.
                if rule['key'] == 'trial_duration':
                    rules.append(rule)
                else:
                    unsupported.add('facts_claims')
            elif rule['category']=='facts_claims' and rule['kind']!='claim_policy':
                unsupported.add('facts_claims')
        adapted.append(dict(source, rules=rules))
    results = check(extraction, payload['context'], adapted)
    checks, findings = [], []
    for result in results:
        if result.category not in CATEGORIES:
            return failed('unexpected_engine_category')
        status = result.status
        reason = result.reason or 'Deterministic text rules executed.'
        if result.category in unsupported:
            status, reason = 'needs_manual_review', 'Some approved rule kinds are outside the structured checker scope.'
        if result.category in ('visual', 'accessibility'):
            if payload['context'].get('media') == 'image':
                status, reason = 'needs_manual_review', ('Image campaign: check brand visuals, colour contrast and legibility '
                                                         'by eye. Not an accessibility certification.')
            else:
                status, reason = 'not_applicable', 'Pasted-text revision: no image, font-size or declared colour-pair input. Not an accessibility certification.'
        checks.append(dict(category=result.category, status=status, reason=reason))
        for finding in result.findings:
            entry = lookup.get((finding.source_version_id, finding.rule_id))
            if entry is None:
                return failed('engine_invalid_citation')
            source, rule = entry
            start, end = finding.location.get('start_char'), finding.location.get('end_char')
            if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
                return failed('engine_invalid_location')
            content_quote = text[start:end]
            if content_quote != finding.evidence_quote or rule['evidence_quote'] not in source['text']:
                return failed('engine_invalid_quote')
            findings.append(dict(category=finding.category, severity=finding.severity,
                evidence_status=finding.evidence_status, source_version_id=source['id'], rule_id=rule['id'],
                evidence_quote=rule['evidence_quote'], start=start, end=end, content_quote=content_quote,
                rationale=finding.rationale, suggested_edit=finding.suggested_edit))
    if payload['context'].get('media') == 'image' and payload['context'].get('text_regions'):
        visual_checks, visual_findings = image_colour_checks(text, payload['context'], sources)
        for check_entry in checks:
            check_entry.update(visual_checks.get(check_entry['category'], {}))
        findings.extend(visual_findings)
    if len(findings) > 100:
        for c in checks:
            if c['status'] == 'complete':
                c.update(status='needs_manual_review', reason='Finding display limit reached; inspect remaining content manually.')
        findings = findings[:100]
    return dict(checks=checks, findings=findings, metadata=dict(version=ENGINE_VERSION,
                canonical_sha256=expected_hash, unsupported_categories=sorted(unsupported)))


HEX = re.compile(r'#[0-9a-fA-F]{6}\b')
LARGE_TEXT_PX = 32  # Roughly 24 px text plus the OCR box padding; WCAG large text is 18 pt (24 px).
PALETTE_DISTANCE = 60  # RGB distance that still counts as the same brand colour after JPEG and anti-aliasing.


def _rgb(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def image_colour_checks(text, context, sources):
    """Contrast (accessibility `contrast` rule) and brand palette (visual rule keyed `brand_palette`, value lists
    hex colours) for each measured text region of an image campaign. Returns (check updates, findings)."""
    contrast_rules = [(s, r) for s in sources for r in s['rules'] if r['category'] == 'accessibility' and r['kind'] == 'contrast']
    palette_rules = [(s, r) for s in sources for r in s['rules'] if r['category'] == 'visual' and r['key'] == 'brand_palette'
                     and HEX.search(r['value'])]
    updates, findings = {}, []
    regions = [r for r in context['text_regions'] if 0 <= r['start'] < r['end'] <= len(text)]
    if not regions:
        return updates, findings
    if contrast_rules:
        source, rule = contrast_rules[0]
        number = re.search(r'\d+(?:\.\d+)?', rule['value'])
        minimum = float(number.group(0)) if number else 4.5
        for region in regions:
            large = region['text_height_px'] >= LARGE_TEXT_PX
            required = min(minimum, 3.0) if large else minimum
            if region['contrast_ratio'] < required:
                findings.append(dict(category='accessibility', severity='warning', evidence_status='supported_violation',
                    source_version_id=source['id'], rule_id=rule['id'], evidence_quote=rule['evidence_quote'],
                    start=region['start'], end=region['end'], content_quote=text[region['start']:region['end']],
                    rationale=(f"Estimated text contrast is {region['contrast_ratio']}:1 ({region['foreground']} on {region['background']}); "
                               f"{'large' if large else 'normal'} text needs at least {required}:1. Measured from the image, so check by eye."),
                    suggested_edit=None))
        updates['accessibility'] = dict(status='needs_manual_review', reason=(
            'Text contrast was estimated for every text region from the image. Alt text, legibility and other '
            'accessibility needs still need a look by eye. Not an accessibility certification.'))
    if palette_rules:
        source, rule = palette_rules[0]
        palette = [_rgb(h) for h in HEX.findall(rule['value'])]
        for region in regions:
            colour = _rgb(region['foreground'])
            distance = min(sum((a - b) ** 2 for a, b in zip(colour, p)) ** 0.5 for p in palette)
            if distance > PALETTE_DISTANCE:
                findings.append(dict(category='visual', severity='advisory', evidence_status='supported_violation',
                    source_version_id=source['id'], rule_id=rule['id'], evidence_quote=rule['evidence_quote'],
                    start=region['start'], end=region['end'], content_quote=text[region['start']:region['end']],
                    rationale=f"Text colour {region['foreground']} is not close to any approved brand colour. Measured from the image.",
                    suggested_edit=None))
        updates['visual'] = dict(status='needs_manual_review', reason=(
            'Text colours were compared with the approved brand palette. Logo, imagery and layout still need a look by eye.'))
    return updates, findings


async def check_text(review_input, *, timeout=10):
    """Async injectable checker. No DB handles or provider secrets enter the child."""
    from .orchestration import EngineResult
    payload = json.dumps(dict(text=review_input.text, context=review_input.context,
                              sources=review_input.sources), ensure_ascii=False).encode('utf-8')
    if len(payload) > MAX_PAYLOAD:
        result = failed('engine_input_limit')
        return EngineResult(**result)
    root = Path(__file__).resolve().parents[3]
    env = dict(PATH=os.defpath, PYTHONPATH=os.pathsep.join((str(root/'apps/api'), str(root/'packages'))),
               PYTHONIOENCODING='utf-8', PYTHONHASHSEED='0')
    process = None
    try:
        async with asyncio.timeout(timeout):
            process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'brandguard.engine_bridge',
                '--child', stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL, env=env)
            process.stdin.write(payload)
            await process.stdin.drain()
            process.stdin.close()
            body = bytearray()
            while chunk := await process.stdout.read(8192):
                body.extend(chunk)
                if len(body) > MAX_RESPONSE:
                    raise ValueError('engine_output_limit')
            if await process.wait() != 0:
                raise ValueError('engine_process_failed')
        result = json.loads(body)
        return EngineResult(**result)
    except TimeoutError:
        return EngineResult(**failed('engine_timeout'))
    except (OSError, ValueError, TypeError, KeyError):
        return EngineResult(**failed('engine_process_failed'))
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()


def _check_batch(payload):
    """Evaluate many texts against one rule set; one bounded child serves the whole batch."""
    results = []
    for case in payload['cases']:
        try:
            results.append(_check_text(dict(text=case['text'], context=case.get('context', {}), sources=payload['sources'])))
        except Exception:
            results.append(failed('engine_process_failed'))
    return dict(results=results)


def child_main(batch=False, cpu_seconds=5):
    import resource
    # Bounds are independent of the parent process; untrusted parser failures cannot hang it.
    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    limit = MAX_BATCH_PAYLOAD if batch else MAX_PAYLOAD
    try:
        raw = sys.stdin.buffer.read(limit + 1)
        if len(raw) > limit:
            result = failed('engine_input_limit')
        else:
            result = _check_batch(json.loads(raw)) if batch else _check_text(json.loads(raw))
    except Exception:
        result = failed('engine_process_failed')
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    if '--batch' in sys.argv:
        child_main(batch=True, cpu_seconds=int(sys.argv[sys.argv.index('--batch') + 1]))
    else:
        child_main()

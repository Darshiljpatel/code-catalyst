"""OCR benchmark (Improvement 2): 20 synthetic ad graphics through the app's own OCR engine.

The images are original synthetic graphics drawn by evaluation/ocr_dataset.py for the fictional
LumaDesk brand (varied fonts, sizes, colours and backgrounds, with deliberately low-contrast lines
and small print). They are not real advertisements or photographs, so the numbers say how the
engine copes with clean rendered type, not with photographed or compressed real-world ads.

Each image goes through `imaging.TesseractEngine().recognise` exactly as the worker runs it (child
process, two passes, sparse-text mode, merged words grouped into lines). Measured against the exact
ground truth written by the generator:
- character and word error rates (edit distance over the lines in reading order, joined by spaces);
- box accuracy: each ground-truth line against the best-overlapping OCR line (IoU >= 0.5 counts);
- the low-confidence flag (line confidence below LOW_CONFIDENCE, the lines the editor makes the
  creator confirm): precision and recall of "flagged" against "this OCR line is wrong";
- claim checks with the local engine and the LumaDesk rules of the impact benchmark: findings on the
  ground-truth text versus the raw OCR text and versus the text after correction. "After correction"
  assumes the creator fixes every flagged line to the true wording and deletes flagged lines that are
  not text, and changes nothing else (the editor only forces a decision on flagged lines).

Wilson 95% intervals on every proportion. The character error rate interval treats characters as
independent trials, which they are not; read it as indicative.
Usage: python -m evaluation.ocr_benchmark
"""
import difflib
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT / 'apps/api', ROOT / 'packages'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from brandguard.evaluation import evaluate_many  # noqa: E402
from brandguard.imaging import TesseractEngine, LOW_CONFIDENCE, overlap, build_region_map  # noqa: E402
from evaluation.benchmark_v2 import wilson  # noqa: E402
from evaluation.impact_benchmark import source_version, snapshot  # noqa: E402

DATASET = Path(__file__).resolve().parent / 'fixtures' / 'ocr'
RULES = Path(__file__).resolve().parent / 'fixtures' / 'impact_benchmark.json'
# Frozen when the images were committed (4a7cf86), before the first OCR run.
DATASET_SHA256 = '336e4854ee8dd23626608286448671c9832b72e1a99859487e8ec436eee7f256'
RESULTS = Path(__file__).resolve().parent / 'results' / 'ocr_benchmark.json'
CONTEXT = dict(channel='social', audience='Customers', purpose='Promotion')
BOX_MATCH = 0.5


def dataset_sha(root=DATASET):
    digest = hashlib.sha256()
    for file in sorted(Path(root).iterdir()):
        digest.update(file.name.encode() + b'\0' + hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()


def squash(text):
    return re.sub(r'\s+', ' ', text).strip()


def edits(a, b):
    """Levenshtein distance between two sequences."""
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1]


def matched_words(truth, read):
    return sum(block.size for block in difflib.SequenceMatcher(a=truth, b=read, autojunk=False).get_matching_blocks())


def assign_lines(truth_lines, ocr_lines):
    """Each OCR line goes to the ground-truth line it overlaps most (or none: spurious)."""
    owner = {}
    for line in ocr_lines:
        best = max(range(len(truth_lines)), key=lambda i: overlap(line['box'], truth_lines[i]['box']), default=None)
        if best is not None and overlap(line['box'], truth_lines[best]['box']) > 0.1:
            owner[line['id']] = best
    return owner


def finding_keys(result):
    return {(f['rule_id'], f['category'], f['severity']) for f in result['findings']}


def corrected_text(truth_lines, ocr_lines, owner):
    """Regions as the creator would confirm them: flagged lines fixed to the truth, the rest as read."""
    regions = []
    by_truth = {}
    for line in sorted(ocr_lines, key=lambda l: (l['box']['y'], l['box']['x'])):
        flagged = line['confidence'] < LOW_CONFIDENCE
        index = owner.get(line['id'])
        if index is None:
            if not flagged:
                regions.append(dict(region_id=line['id'], box=line['box'], text=line['text'], origin='ocr', y=line['box']['y']))
            continue
        by_truth.setdefault(index, []).append(line)
    for index, lines in by_truth.items():
        truth = truth_lines[index]
        if any(l['confidence'] < LOW_CONFIDENCE for l in lines):
            text, origin = truth['text'], 'corrected'
        else:
            text, origin = ' '.join(l['text'] for l in sorted(lines, key=lambda l: l['box']['x'])), 'ocr'
        regions.append(dict(region_id=f't{index}', box=truth['box'], text=text, origin=origin, y=truth['box']['y']))
    regions.sort(key=lambda r: r['y'])
    return build_region_map(regions)[0]


def run(dataset=DATASET, engine=None):
    engine = engine or TesseractEngine()
    truth_doc = json.loads((Path(dataset) / 'ground_truth.json').read_text())
    specs = json.loads(RULES.read_text())['sources']
    sources = snapshot([source_version(spec, 1) for spec in specs])
    totals = dict(chars=0, char_edits=0, words=0, word_edits=0, words_matched=0, truth_lines=0, lines_exact=0,
                  boxes_matched=0, ocr_lines=0, flagged=0, wrong=0, flagged_wrong=0, missed_lines=0)
    per_image, cases, versions = [], [], set()
    for image in truth_doc['images']:
        result = engine.recognise((Path(dataset) / image['file']).read_bytes())
        versions.add(result.get('engine_version'))
        truth_lines, ocr_lines = image['lines'], result.get('lines', [])
        truth_text = squash(' '.join(l['text'] for l in truth_lines))
        read_text = squash(' '.join(l['text'] for l in ocr_lines))
        char_edits = edits(truth_text, read_text)
        word_edits = edits(truth_text.split(), read_text.split())
        owner = assign_lines(truth_lines, ocr_lines)
        lines = []
        for index, truth in enumerate(truth_lines):
            mine = sorted((l for l in ocr_lines if owner.get(l['id']) == index), key=lambda l: l['box']['x'])
            best = max((overlap(l['box'], truth['box']) for l in ocr_lines), default=0.0)
            read = squash(' '.join(l['text'] for l in mine))
            lines.append(dict(text=truth['text'], read=read, exact=read == squash(truth['text']), iou=round(best, 3),
                              box_matched=best >= BOX_MATCH, contrast=truth['contrast'], size_px=truth['size_px'],
                              flagged=any(l['confidence'] < LOW_CONFIDENCE for l in mine), missed=not mine))
        flags = []
        for line in ocr_lines:
            index = owner.get(line['id'])
            wrong = index is None or squash(line['text']) not in squash(truth_lines[index]['text'])
            flags.append(dict(text=line['text'], confidence=line['confidence'], flagged=line['confidence'] < LOW_CONFIDENCE,
                              wrong=wrong, truth_line=index))
        fixed = corrected_text(truth_lines, ocr_lines, owner)
        cases.extend([dict(text='\n'.join(l['text'] for l in truth_lines), context=CONTEXT),
                      dict(text='\n'.join(l['text'] for l in ocr_lines) or ' ', context=CONTEXT),
                      dict(text=fixed or ' ', context=CONTEXT)])
        totals['chars'] += len(truth_text); totals['char_edits'] += char_edits
        totals['words'] += len(truth_text.split()); totals['word_edits'] += word_edits
        totals['words_matched'] += matched_words(truth_text.split(), read_text.split())
        totals['truth_lines'] += len(lines); totals['lines_exact'] += sum(l['exact'] for l in lines)
        totals['boxes_matched'] += sum(l['box_matched'] for l in lines); totals['missed_lines'] += sum(l['missed'] for l in lines)
        totals['ocr_lines'] += len(flags); totals['flagged'] += sum(f['flagged'] for f in flags)
        totals['wrong'] += sum(f['wrong'] for f in flags); totals['flagged_wrong'] += sum(f['flagged'] and f['wrong'] for f in flags)
        per_image.append(dict(id=image['id'], tags=image['tags'], status=result.get('status'),
            cer=round(char_edits / len(truth_text), 4), wer=round(word_edits / len(truth_text.split()), 4),
            mean_confidence=result.get('mean_confidence'), truth=truth_text, read=read_text, corrected=squash(fixed),
            lines=lines, ocr_lines=flags))
    results = evaluate_many(cases, sources)
    claims = dict(reference=0, raw_missed=0, raw_false=0, corrected_missed=0, corrected_false=0, images_with_claims=0)
    for index, image in enumerate(per_image):
        ref, raw, fixed = (finding_keys(r) for r in results[3 * index:3 * index + 3])
        failed = [r for r in results[3 * index:3 * index + 3] if any(c['status'] == 'failed' for c in r['checks'])]
        assert not failed, image['id']
        image['claims'] = dict(reference=sorted(map(list, ref)), raw_missed=sorted(map(list, ref - raw)),
                               raw_false=sorted(map(list, raw - ref)), corrected_missed=sorted(map(list, ref - fixed)),
                               corrected_false=sorted(map(list, fixed - ref)))
        claims['reference'] += len(ref); claims['images_with_claims'] += bool(ref)
        for key in ('raw_missed', 'raw_false', 'corrected_missed', 'corrected_false'):
            claims[key] += len(image['claims'][key])
    t = totals

    def rate(successes, total):
        return dict(rate=round(successes / total, 4) if total else None, n=total, ci95=wilson(successes, total))

    low = [l for i in per_image for l in i['lines'] if l['contrast'] < 3]
    normal = [l for i in per_image for l in i['lines'] if l['contrast'] >= 3]
    raw = json.dumps(truth_doc).encode()
    sha = dataset_sha(dataset)
    return dict(benchmark='ocr_improvement_2', synthetic=True, images=len(per_image),
        note='Synthetic ad graphics drawn by evaluation/ocr_dataset.py; not real advertisements or photographs.',
        dataset_sha256=sha, frozen=sha == DATASET_SHA256, ground_truth_sha256=hashlib.sha256(raw).hexdigest(),
        engine=sorted(v for v in versions if v), low_confidence_threshold=LOW_CONFIDENCE,
        metrics=dict(
            character_error_rate=dict(rate(t['char_edits'], t['chars']), note='edits / ground-truth characters; interval indicative'),
            word_error_rate=dict(rate(t['word_edits'], t['words'])),
            words_read_exactly=rate(t['words_matched'], t['words']),
            lines_read_exactly=rate(t['lines_exact'], t['truth_lines']),
            lines_read_exactly_contrast_below_3=rate(sum(l['exact'] for l in low), len(low)),
            lines_read_exactly_contrast_3_plus=rate(sum(l['exact'] for l in normal), len(normal)),
            lines_not_found=rate(t['missed_lines'], t['truth_lines']),
            box_match_iou_0_5=rate(t['boxes_matched'], t['truth_lines']),
            mean_box_iou=round(sum(l['iou'] for i in per_image for l in i['lines']) / t['truth_lines'], 4),
            low_confidence_flag=dict(ocr_lines=t['ocr_lines'], flagged=t['flagged'], wrong=t['wrong'],
                precision=rate(t['flagged_wrong'], t['flagged']), recall=rate(t['flagged_wrong'], t['wrong']),
                note='Lines not found at all cannot be flagged; see lines_not_found.'),
            claims=dict(claims, raw_recall=rate(claims['reference'] - claims['raw_missed'], claims['reference']),
                        corrected_recall=rate(claims['reference'] - claims['corrected_missed'], claims['reference']),
                        note='Local-engine findings keyed by rule, category and severity; reference = findings on the true text.')),
        per_image=per_image)


def main():
    result = run()
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(result, indent=2) + '\n')
    m = result['metrics']
    print(f"OCR benchmark: {result['images']} synthetic ad graphics, {', '.join(result['engine']) or 'no engine'} "
          f"(frozen: {result['frozen']}).")
    for name in ('character_error_rate', 'word_error_rate', 'words_read_exactly', 'lines_read_exactly',
                 'lines_read_exactly_contrast_below_3', 'lines_read_exactly_contrast_3_plus', 'lines_not_found', 'box_match_iou_0_5'):
        print(f"  {name:<36} {m[name]['rate']} {m[name]['ci95']} (n={m[name]['n']})")
    flag = m['low_confidence_flag']
    print(f"  low-confidence flag: {flag['flagged']} of {flag['ocr_lines']} OCR lines flagged, {flag['wrong']} wrong; "
          f"precision {flag['precision']['rate']} {flag['precision']['ci95']}, recall {flag['recall']['rate']} {flag['recall']['ci95']}")
    c = m['claims']
    print(f"  claims: {c['reference']} findings on the true text; raw OCR missed {c['raw_missed']} / {c['raw_false']} false; "
          f"after correcting flagged lines missed {c['corrected_missed']} / {c['corrected_false']} false")
    print(f'Written to {RESULTS}')
    return 0 if result['frozen'] else 1


if __name__ == '__main__':
    sys.exit(main())

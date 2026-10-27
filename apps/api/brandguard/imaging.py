"""Image ingest and local OCR (Improvement 2), each in a bounded child process.

Images never leave our servers: Tesseract runs inside the worker, and only the text the
creator confirms can later reach an AI provider under the usual consent rules. The OCR
engine sits behind a small interface so RapidOCR could replace Tesseract later.
"""
import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 25_000_000
PNG_MAGIC = b'\x89PNG\r\n\x1a\n'
JPEG_MAGIC = b'\xff\xd8\xff'
LOW_CONFIDENCE = 0.8
OCR_MAX_SIDE = 2400


class ImageRejected(Exception):
    def __init__(self, code, message):
        super().__init__(code)
        self.code, self.message = code, message


def sniff(data):
    """Accept PNG and JPEG by magic bytes only; the filename and declared type are ignored."""
    if data.startswith(PNG_MAGIC):
        return 'image/png'
    if data.startswith(JPEG_MAGIC):
        return 'image/jpeg'
    return None


def _child_env():
    root = Path(__file__).resolve().parents[3]
    env = dict(PATH=os.environ.get('PATH', os.defpath), PYTHONPATH=os.pathsep.join((str(root / 'apps/api'), str(root / 'packages'))),
               PYTHONIOENCODING='utf-8', PYTHONHASHSEED='0', OMP_THREAD_LIMIT='1')
    if os.environ.get('TESSDATA_PREFIX'):
        env['TESSDATA_PREFIX'] = os.environ['TESSDATA_PREFIX']
    return env


def _run_child(mode, payload, *, timeout):
    process = subprocess.run([sys.executable, '-m', 'brandguard.imaging', mode], input=payload, capture_output=True,
                             timeout=timeout, env=_child_env())
    if process.returncode != 0:
        raise ValueError('child_failed')
    return json.loads(process.stdout)


def normalise_upload(data):
    """Verify, orient and strip metadata. Returns (clean bytes, mime, width, height)."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageRejected('image_too_large', 'Images must be 8 MB or smaller.')
    mime = sniff(data)
    if mime is None:
        raise ImageRejected('unsupported_image', 'Upload a PNG or JPEG image.')
    try:
        result = _run_child('--verify', data, timeout=20)
    except (subprocess.TimeoutExpired, ValueError, OSError):
        raise ImageRejected('invalid_image', 'This image could not be read. It may be damaged or truncated.')
    if 'error' in result:
        raise ImageRejected(result['error'], result['message'])
    return base64.b64decode(result['bytes']), result['mime'], result['width'], result['height']


def _verify_child(data):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        image = Image.open(io.BytesIO(data))
        if image.format not in ('PNG', 'JPEG'):
            return dict(error='unsupported_image', message='Upload a PNG or JPEG image.')
        if getattr(image, 'n_frames', 1) > 1 or getattr(image, 'is_animated', False):
            return dict(error='animated_image', message='Animated images are not supported.')
        if image.width * image.height > MAX_PIXELS:
            return dict(error='image_too_large', message='Images must be 25 megapixels or smaller.')
        image.load()
    except Image.DecompressionBombError:
        return dict(error='image_too_large', message='Images must be 25 megapixels or smaller.')
    except Exception:
        return dict(error='invalid_image', message='This image could not be read. It may be damaged or truncated.')
    fmt = image.format
    # Apply EXIF orientation, then re-encode without any metadata (including GPS).
    image = ImageOps.exif_transpose(image)
    out = io.BytesIO()
    if fmt == 'JPEG':
        image.convert('RGB').save(out, format='JPEG', quality=95)
    else:
        if image.mode not in ('RGB', 'RGBA', 'L', 'LA'):
            image = image.convert('RGBA')
        image.save(out, format='PNG')
    return dict(bytes=base64.b64encode(out.getvalue()).decode(), mime='image/jpeg' if fmt == 'JPEG' else 'image/png',
                width=image.width, height=image.height)


# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------

class OcrEngine:
    """Interface: recognise(image bytes) -> dict(words, lines, mean_confidence, engine, engine_version, params)."""
    name = 'none'

    def recognise(self, data):
        raise NotImplementedError


class TesseractEngine(OcrEngine):
    name = 'tesseract'

    def available(self):
        return shutil.which('tesseract') is not None

    def recognise(self, data):
        if not self.available():
            return dict(status='failed', error_code='ocr_engine_unavailable', engine=self.name, engine_version='unavailable',
                        params={}, words=[], lines=[], mean_confidence=None)
        try:
            result = _run_child('--ocr', data, timeout=60)
        except (subprocess.TimeoutExpired, ValueError, OSError):
            return dict(status='failed', error_code='ocr_failed', engine=self.name, engine_version='unknown',
                        params={}, words=[], lines=[], mean_confidence=None)
        return dict(result, status='complete' if 'error_code' not in result else 'failed')


def tesseract_version():
    try:
        out = subprocess.run(['tesseract', '--version'], capture_output=True, timeout=5, text=True)
        return (out.stdout or out.stderr).splitlines()[0].strip()[:60]
    except Exception:
        return 'unknown'


def parse_tsv(tsv, width, height, scale, pass_name):
    """Tesseract TSV -> words with normalised boxes (0..1 of the original image)."""
    words = []
    rows = tsv.splitlines()
    for row in rows[1:]:
        cols = row.split('\t')
        if len(cols) < 12 or cols[0] != '5':
            continue
        text, conf = cols[11].strip(), float(cols[10])
        if not text or conf < 0:
            continue
        left, top, w, h = (int(c) / scale for c in cols[6:10])
        words.append(dict(text=text, confidence=round(conf / 100, 3), pass_name=pass_name,
                          line_key=f'{pass_name}:{cols[2]}:{cols[3]}:{cols[4]}',
                          box=dict(x=round(left / width, 5), y=round(top / height, 5), w=round(w / width, 5), h=round(h / height, 5))))
    return words


def overlap(a, b):
    ix = max(0.0, min(a['x'] + a['w'], b['x'] + b['w']) - max(a['x'], b['x']))
    iy = max(0.0, min(a['y'] + a['h'], b['y'] + b['h']) - max(a['y'], b['y']))
    inter = ix * iy
    union = a['w'] * a['h'] + b['w'] * b['h'] - inter
    return inter / union if union else 0.0


def merge_words(passes):
    """Combine words from several passes; where boxes overlap keep the more confident reading."""
    kept = []
    for word in sorted((w for p in passes for w in p), key=lambda w: -w['confidence']):
        if all(overlap(word['box'], k['box']) < 0.3 for k in kept):
            kept.append(word)
    return kept


def group_lines(words):
    """Group words into lines by vertical overlap, in reading order (top to bottom, left to right)."""
    lines = []
    for word in sorted(words, key=lambda w: (w['box']['y'], w['box']['x'])):
        centre = word['box']['y'] + word['box']['h'] / 2
        target = None
        for line in lines:
            top, bottom = line['box']['y'], line['box']['y'] + line['box']['h']
            if top <= centre <= bottom and word['box']['x'] >= line['box']['x'] - 0.02:
                target = line
                break
        if target is None:
            lines.append(dict(words=[word], box=dict(word['box'])))
        else:
            target['words'].append(word)
            box = target['box']
            right, bottom = max(box['x'] + box['w'], word['box']['x'] + word['box']['w']), max(box['y'] + box['h'], word['box']['y'] + word['box']['h'])
            box['x'], box['y'] = min(box['x'], word['box']['x']), min(box['y'], word['box']['y'])
            box['w'], box['h'] = right - box['x'], bottom - box['y']
    result = []
    for index, line in enumerate(sorted(lines, key=lambda l: (round(l['box']['y'], 2), l['box']['x']))):
        ordered = sorted(line['words'], key=lambda w: w['box']['x'])
        result.append(dict(id=f'r{index + 1}', text=' '.join(w['text'] for w in ordered),
                           confidence=round(min(w['confidence'] for w in ordered), 3),
                           box={k: round(v, 5) for k, v in line['box'].items()}))
    return result


def _ocr_child(data):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    import tempfile
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert('L')
    width, height = image.size
    # Very large images are recognised on a downscaled copy; small text is upscaled.
    scale = min(1.0, OCR_MAX_SIDE / max(width, height))
    if max(width, height) < 1000:
        scale = 2.0
    work = image.resize((max(1, int(width * scale)), max(1, int(height * scale))))
    passes = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, variant in (('normal', work), ('inverted', ImageOps.invert(work))):
            path = os.path.join(tmp, f'{name}.png')
            variant.save(path)
            out = subprocess.run(['tesseract', path, 'stdout', '--psm', '11', '-l', 'eng', 'tsv'],
                                 capture_output=True, timeout=25, text=True)
            if out.returncode == 0:
                passes.append(parse_tsv(out.stdout, width, height, scale, name))
    words = merge_words(passes)
    lines = group_lines(words)
    mean = round(sum(w['confidence'] for w in words) / len(words), 3) if words else None
    return dict(engine='tesseract', engine_version=tesseract_version(),
                params=dict(psm=11, passes=['normal', 'inverted'], scale=round(scale, 3), language='eng'),
                words=[{k: v for k, v in w.items() if k != 'line_key'} for w in words], lines=lines, mean_confidence=mean)


def build_region_map(regions):
    """Confirmed regions -> revision text (reading order, one line each) and a region map
    linking each character range to its box. Unreadable regions carry no text."""
    text_parts, region_map, cursor = [], [], 0
    for region in regions:
        final = region['text'] if region['origin'] != 'unreadable' else ''
        entry = dict(region_id=region['region_id'], box=region['box'], ocr_text=region.get('ocr_text'),
                     final_text=final, confidence=region.get('confidence'), origin=region['origin'], start=None, end=None)
        if final:
            if text_parts:
                cursor += 1  # newline separator
            entry['start'], entry['end'] = cursor, cursor + len(final)
            cursor += len(final)
            text_parts.append(final)
        region_map.append(entry)
    return '\n'.join(text_parts), region_map


def regions_for(region_map, start, end):
    return [r['region_id'] for r in region_map or [] if r['start'] is not None and r['start'] < end and start < r['end']]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def child_main(mode):
    import resource
    limit = 1024 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    data = sys.stdin.buffer.read(MAX_UPLOAD_BYTES + 1)
    try:
        if len(data) > MAX_UPLOAD_BYTES:
            result = dict(error='image_too_large', message='Images must be 8 MB or smaller.')
        elif mode == '--verify':
            result = _verify_child(data)
        else:
            result = _ocr_child(data)
    except Exception:
        result = dict(error='invalid_image', message='This image could not be read.') if mode == '--verify' else dict(
            error_code='ocr_failed', engine='tesseract', engine_version='unknown', params={}, words=[], lines=[], mean_confidence=None)
    sys.stdout.write(json.dumps(result))


if __name__ == '__main__':
    child_main(sys.argv[1] if len(sys.argv) > 1 else '--verify')

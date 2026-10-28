import shutil
import pytest
from evaluation.ocr_benchmark import DATASET_SHA256, dataset_sha, edits, matched_words, assign_lines, corrected_text


def test_ocr_dataset_is_frozen_and_metric_helpers_are_exact():
    assert dataset_sha() == DATASET_SHA256, 'evaluation/fixtures/ocr changed: freeze a new dataset version instead'
    assert edits('kitten', 'sitting') == 3 and edits(['a', 'b'], ['a', 'b']) == 0
    assert matched_words('save 15% today'.split(), 'save 3% today'.split()) == 2
    truth = [dict(text='Luma Desk', box=dict(x=0.1, y=0.1, w=0.4, h=0.1)), dict(text='$12 per seat', box=dict(x=0.1, y=0.3, w=0.4, h=0.1))]
    ocr = [dict(id='r1', text='Luma Desk', confidence=0.95, box=dict(x=0.1, y=0.1, w=0.4, h=0.1)),
           dict(id='r2', text='$13 per seat', confidence=0.5, box=dict(x=0.1, y=0.3, w=0.4, h=0.1)),
           dict(id='r3', text='~', confidence=0.3, box=dict(x=0.8, y=0.8, w=0.05, h=0.05))]
    owner = assign_lines(truth, ocr)
    assert owner == {'r1': 0, 'r2': 1}
    # Flagged lines are fixed to the truth and flagged noise is deleted; confident lines stay as read.
    assert corrected_text(truth, ocr, owner) == 'Luma Desk\n$12 per seat'


@pytest.mark.skipif(shutil.which('tesseract') is None, reason='Tesseract is not installed')
def test_ocr_benchmark_runs_through_the_real_engine():
    from evaluation.ocr_benchmark import run
    result = run()
    assert result['frozen'] and result['synthetic'] and result['images'] == 20
    assert result['engine'] and result['engine'][0].startswith('tesseract')
    assert all(image['status'] == 'complete' for image in result['per_image'])
    m = result['metrics']
    assert m['lines_read_exactly']['n'] == sum(len(i['lines']) for i in result['per_image'])
    for name in ('character_error_rate', 'word_error_rate', 'lines_read_exactly', 'box_match_iou_0_5'):
        low, high = m[name]['ci95']
        assert 0 <= low <= m[name]['rate'] <= high <= 1
    claims = m['claims']
    assert claims['reference'] >= claims['raw_missed'] and claims['reference'] >= claims['corrected_missed']

"""Text review benchmark v2: 60 labelled campaigns, 3 fictional brands, 6 formats, 20 dev / 40 held out.

Local (deterministic) checks only: the AI side needs a live Nebius key and is run separately.
Small samples are reported with 95% Wilson intervals. Usage: python -m evaluation.benchmark_v2
"""
import json
import math
import sys
from pathlib import Path

from evaluation.evaluate import evaluate_dataset

DATASET = Path(__file__).resolve().parent / 'fixtures' / 'benchmark_v2.json'
# Frozen before any rule or engine change made after it; update only with a new dataset version.
DATASET_SHA256 = 'c832e2ae77a84f464b518e1848e5e52db0ec7545712b51b1ffce72380332ac0e'
RESULTS = Path(__file__).resolve().parent / 'results' / 'benchmark_v2.json'


def wilson(successes, total, z=1.96):
    """95% Wilson score interval for a proportion; (None, None) when there is no denominator."""
    if not total:
        return None, None
    p = successes / total
    centre = (p + z * z / (2 * total)) / (1 + z * z / total)
    margin = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / (1 + z * z / total)
    return round(max(0.0, centre - margin), 4), round(min(1.0, centre + margin), 4)


def with_intervals(metrics):
    tp, fp, fn = metrics['true_positives'], metrics['false_positives'], metrics['false_negatives']
    return dict(metrics, precision_ci95=wilson(tp, tp + fp), recall_ci95=wilson(tp, tp + fn))


def run(dataset=DATASET):
    summary = evaluate_dataset(str(dataset))
    cases = {c['id']: c for c in json.loads(Path(dataset).read_text())}
    missed = {d['case_id']: d for d in summary['disagreements']}
    per_split = {}
    for split in summary['splits']:
        split_cases = [c for c in cases.values() if c['split'] == split]
        flagged = [c for c in split_cases if c['expected_findings']]
        # A false-clean result: a campaign with a labelled blocker where every label was missed.
        false_clean = [c['id'] for c in flagged
                       if c['id'] in missed and len(missed[c['id']]['missed_expected']) == len(c['expected_findings'])]
        clean = [c for c in split_cases if not c['expected_findings']]
        noisy_clean = [c['id'] for c in clean if c['id'] in missed and missed[c['id']]['unexpected_findings']]
        per_split[split] = dict(with_intervals(summary['per_split_metrics'][split]), cases=len(split_cases),
                                cases_with_violations=len(flagged), false_clean_cases=false_clean,
                                false_clean_rate=round(len(false_clean) / len(flagged), 4) if flagged else None,
                                clean_cases=len(clean), clean_cases_with_false_alarms=noisy_clean)
    per_format = {}
    for case in cases.values():
        entry = per_format.setdefault(case['format'], dict(labels=0, missed=0, false_alarms=0))
        entry['labels'] += len(case['expected_findings'])
        if case['id'] in missed:
            entry['missed'] += len(missed[case['id']]['missed_expected'])
            entry['false_alarms'] += len(missed[case['id']]['unexpected_findings'])
    return dict(benchmark='text_review_v2', origin='local', dataset=summary['dataset'],
                dataset_sha256=summary['dataset_sha256'], frozen=summary['dataset_sha256'] == DATASET_SHA256,
                total_cases=summary['total_cases'], overall=with_intervals(summary['metrics']), per_split=per_split,
                per_category={k: with_intervals(v) for k, v in summary['per_category_metrics'].items()},
                per_format=per_format, latency=summary['latency'], disagreements=summary['disagreements'],
                gates=dict(held_out_local_precision_at_least_0_95=per_split.get('test', {}).get('precision', 0) >= 0.95,
                           no_false_clean_on_held_out=not per_split.get('test', {}).get('false_clean_cases')))


def main():
    result = run()
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(result, indent=2) + '\n')
    held_out = result['per_split'].get('test', {})
    print(f"Held out (n={held_out.get('cases')}): precision {held_out.get('precision')} {held_out.get('precision_ci95')}, "
          f"recall {held_out.get('recall')} {held_out.get('recall_ci95')}, false-clean {held_out.get('false_clean_rate')}")
    print(f'Written to {RESULTS}')
    return 0 if result['frozen'] and all(result['gates'].values()) else 1


if __name__ == '__main__':
    sys.exit(main())

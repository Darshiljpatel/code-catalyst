"""Comparison-runner benchmark (Improvement 3): seeded guideline regressions must all be caught.

Uses the benchmark v2 campaigns as saved examples, converts each brand guide to the production rule
shape, applies seeded rule changes with a known set of campaigns they break, and runs the same local
engine and per-case verdict the guideline-request comparison uses. A benign wording edit is the control.
Usage: python -m evaluation.comparison_benchmark
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT / 'apps/api', ROOT / 'packages'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from brandguard.evaluation import evaluate_many  # noqa: E402
from brandguard.requests import case_verdict, finding_summary  # noqa: E402

DATASET = Path(__file__).resolve().parent / 'fixtures' / 'benchmark_v2.json'
RESULTS = Path(__file__).resolve().parent / 'results' / 'comparison_benchmark.json'


def production_source(source):
    """The API's rule shape: no engine-only fields such as contradicted_values."""
    rules = []
    for rule in source['rules']:
        entry = {k: rule[k] for k in ('id', 'category', 'kind', 'key', 'value', 'evidence_quote')}
        # A manager writes the full approved phrase ("save 15%"), which the local check can anchor on.
        entry['value'] = rule.get('approved_value') or rule['value']
        if rule.get('forbidden_patterns'):
            entry['forbidden_variants'] = rule['forbidden_patterns']
        rules.append(entry)
    return dict(id=source['id'], source_key=source['id'], text=source['text'], rules=rules,
                valid_from='2026-01-01T00:00:00+00:00', valid_until=None)


def mutate(source, rule_id, **changes):
    out = json.loads(json.dumps(source))
    out['id'] = source['id'] + '-proposed'
    if changes.get('remove'):
        out['rules'] = [r for r in out['rules'] if r['id'] != rule_id]
        return out
    for rule in out['rules']:
        if rule['id'] == rule_id:
            if 'value' in changes:
                rule['value'] = changes['value']
            if 'quote' in changes:
                out['text'] = out['text'].replace(rule['evidence_quote'], changes['quote'])
                rule['evidence_quote'] = changes['quote']
    return out


# (name, brand, rule, change, predicate over case text -> the campaign is expected to regress)
SEEDS = [
    ('remove brand-name rule', 'LumaDesk', 'LD-T01', dict(remove=True), lambda c: any(l['rule_id'] == 'LD-T01' for l in c['expected_findings'])),
    ('trial 14 -> 21 days', 'LumaDesk', 'LD-F01', dict(value='21 days', quote='The free trial lasts 21 days.'),
     lambda c: '21 days' in c['text'] or (('14-day' in c['text'] or '14 days' in c['text']) and 'trial' in c['text'].lower())),
    ('seat price $12 -> $15', 'LumaDesk', 'LD-F02', dict(value='$15 per seat', quote='Team plans cost $15 per seat per month.'),
     lambda c: '$12 per seat' in c['text'] or '$15 per seat' in c['text']),
    ('warranty 5-year -> 3-year', 'Northwind', 'NW-F01', dict(value='3-year warranty', quote='Every frame has a 3-year warranty.'),
     lambda c: '5-year warranty' in c['text'] or '3-year warranty' in c['text']),
    ('remove discount rule', 'Saltwater', 'SC-F01', dict(remove=True),
     lambda c: any(l['rule_id'] == 'SC-F01' and l['quote'] in ('save 25%', 'save 20%') for l in c['expected_findings'])),
    ('control: reword brand-name evidence', 'Northwind', 'NW-T01', dict(quote='Our brand name is Northwind.'), lambda c: False),
]


def expectations(case, source):
    labelled = {l['rule_id'] for l in case['expected_findings']}
    return [dict(rule_id=r['id'], source_key=source['source_key'], expected='flag' if r['id'] in labelled else 'no_flag')
            for r in source['rules']]


def run():
    cases = json.loads(DATASET.read_text())
    report = []
    for name, brand, rule_id, change, breaks in SEEDS:
        brand_cases = [c for c in cases if c['brand'] == brand]
        live = production_source(brand_cases[0]['sources'][0])
        proposed = mutate(live, rule_id, **change)
        inputs = [dict(text=c['text'], context=c['context']) for c in brand_cases]
        before, after = evaluate_many(inputs, [live]), evaluate_many(inputs, [proposed])
        live_keys = {live['id']: live['source_key']}
        prop_keys = {proposed['id']: live['source_key']}
        caught, missed, false_alarms = [], [], []
        for case, b, a in zip(brand_cases, before, after):
            target = SimpleNamespace(expectations=expectations(case, live))
            verdict, _, _ = case_verdict(target, dict(checks=b['checks'], summaries=[finding_summary(f, live_keys) for f in b['findings']]),
                                         dict(checks=a['checks'], summaries=[finding_summary(f, prop_keys) for f in a['findings']]))
            expected = breaks(case)
            if expected and verdict == 'regressed':
                caught.append(case['id'])
            elif expected:
                missed.append(dict(case_id=case['id'], verdict=verdict))
            elif verdict == 'regressed':
                false_alarms.append(case['id'])
        report.append(dict(seed=name, brand=brand, seeded_regressions=len(caught) + len(missed), caught=caught,
                           missed=missed, false_alarms=false_alarms))
    seeded = sum(r['seeded_regressions'] for r in report)
    caught = sum(len(r['caught']) for r in report)
    return dict(benchmark='comparison_runner_seeded_regressions', dataset_cases=len(cases), seeds=report,
                seeded_regressions=seeded, caught=caught, catch_rate=round(caught / seeded, 4) if seeded else None,
                false_alarms=sum(len(r['false_alarms']) for r in report))


def main():
    result = run()
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(result, indent=2) + '\n')
    print(f"Caught {result['caught']} of {result['seeded_regressions']} seeded regressions; {result['false_alarms']} false alarms.")
    return 0 if result['caught'] == result['seeded_regressions'] and not result['false_alarms'] else 1


if __name__ == '__main__':
    sys.exit(main())

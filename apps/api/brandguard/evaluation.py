"""Shared rule evaluation: run any text against any rule set with the local engine.

Impact analysis (Improvement 1) and comparison runs (Improvement 3) both need to ask
"what would the local checks say about this text under these rules?" without creating
review runs. One bounded child process evaluates a whole batch, so results are
repeatable and untrusted text never parses inside the API process.
"""
import json
import os
import subprocess
import sys
from pathlib import Path
from .engine_bridge import MAX_BATCH_PAYLOAD, MAX_RESPONSE, failed

MAX_CASES = 500


def _child_env():
    root = Path(__file__).resolve().parents[3]
    return dict(PATH=os.defpath, PYTHONPATH=os.pathsep.join((str(root / 'apps/api'), str(root / 'packages'))),
                PYTHONIOENCODING='utf-8', PYTHONHASHSEED='0')


def evaluate_many(cases, sources, *, timeout=30):
    """Evaluate each case ({text, context}) against `sources` (SourceOut-shaped dicts).

    Returns one engine result per case: {checks, findings, metadata}. A failed child
    yields failed checks for every case, never an empty "clean" result.
    """
    cases = list(cases)
    if not cases:
        return []
    if len(cases) > MAX_CASES:
        raise ValueError('too_many_cases')
    payload = json.dumps(dict(cases=[dict(text=c['text'], context=c.get('context', {})) for c in cases],
                              sources=sources), ensure_ascii=False).encode('utf-8')
    if len(payload) > MAX_BATCH_PAYLOAD:
        return [failed('engine_input_limit') for _ in cases]
    cpu = min(60, 5 + len(cases) // 5)
    try:
        process = subprocess.run([sys.executable, '-m', 'brandguard.engine_bridge', '--batch', str(cpu)],
                                 input=payload, capture_output=True, timeout=timeout, env=_child_env())
        if process.returncode != 0 or len(process.stdout) > MAX_RESPONSE * max(1, len(cases)):
            raise ValueError('engine_process_failed')
        results = json.loads(process.stdout)['results']
        if len(results) != len(cases):
            raise ValueError('engine_process_failed')
        return results
    except subprocess.TimeoutExpired:
        return [failed('engine_timeout') for _ in cases]
    except (OSError, ValueError, KeyError, TypeError):
        return [failed('engine_process_failed') for _ in cases]


def evaluate(text, context, sources, **kwargs):
    return evaluate_many([dict(text=text, context=context)], sources, **kwargs)[0]


def finding_key(finding, source_keys):
    """Identity of a finding that survives a new source version of the same guideline."""
    return (source_keys.get(finding['source_version_id'], finding['source_version_id']), finding['rule_id'],
            finding['category'], finding['start'], finding['end'], finding['severity'])


def compare(before, after, before_sources, after_sources):
    """Findings delta between two engine results for the same text under two rule sets."""
    old_keys = {s['id']: s['source_key'] for s in before_sources}
    new_keys = {s['id']: s['source_key'] for s in after_sources}
    old = {finding_key(f, old_keys): f for f in before['findings']}
    new = {finding_key(f, new_keys): f for f in after['findings']}
    failed_checks = sorted({c['category'] for c in before['checks'] + after['checks'] if c['status'] == 'failed'})
    return dict(added=[_summary(new[k]) for k in sorted(set(new) - set(old), key=_order)],
                removed=[_summary(old[k]) for k in sorted(set(old) - set(new), key=_order)],
                unchanged=len(set(old) & set(new)), failed_checks=failed_checks,
                changed=bool(set(old) ^ set(new)))


def _order(key):
    return (key[3], key[4], key[0], key[1])


def _summary(finding):
    return dict(rule_id=finding['rule_id'], category=finding['category'], severity=finding['severity'],
                quote=finding.get('content_quote', ''), start=finding['start'], end=finding['end'],
                source_version_id=finding['source_version_id'])

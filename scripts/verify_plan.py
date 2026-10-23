#!/usr/bin/env python3
"""Validate planning coverage and release evidence inventory; does not test the app."""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
OWNERS = {'Sanath', 'Darshilkumar', 'Surya'}
SOURCES = {'PS', 'R2', 'PDF-p2', 'PDF-p3', 'PDF-p5', 'PDF-p6', 'PDF-p7'}


def check_plan(requirements, cases):
    errors = []
    for label, rows, prefix, fields in (
        ('requirement', requirements, 'R', ('source', 'requirement', 'evidence')),
        ('case', cases, 'T', ('setup', 'action', 'expected')),
    ):
        if not isinstance(rows, list) or not rows:
            errors.append(f'{label} register must be a nonempty list')
            continue
        ids = set()
        for row in rows:
            if not isinstance(row, dict):
                errors.append(f'{label} row must be an object')
                continue
            rid = row.get('id')
            if not isinstance(rid, str) or not re.fullmatch(prefix + r'\d{2}', rid):
                errors.append(f'invalid {label} ID: {rid!r}')
            elif rid in ids:
                errors.append(f'duplicate {label}: {rid}')
            ids.add(str(rid))
            if row.get('owner') not in OWNERS:
                errors.append(f'{rid}: invalid owner')
            for field in fields:
                if not isinstance(row.get(field), str) or not row[field].strip():
                    errors.append(f'{rid}: missing {field}')
    if errors:
        return errors
    case_ids = {r['id'] for r in cases}
    covered = set()
    for row in requirements:
        if row['source'] not in SOURCES:
            errors.append(f"{row['id']}: unknown source")
        tests = row.get('tests')
        if not isinstance(tests, list) or not tests or not all(isinstance(t, str) for t in tests):
            errors.append(f"{row['id']}: tests must be a nonempty ID list")
            continue
        for tid in tests:
            if tid not in case_ids:
                errors.append(f"{row['id']}: unknown case {tid}")
            covered.add(tid)
    for tid in sorted(case_ids - covered):
        errors.append(f'{tid}: case has no requirement')
    return errors


def artifact_valid(root, value):
    if not isinstance(value, str) or not value.strip():
        return False
    evidence_dir = (root / 'verification' / 'evidence').resolve()
    path = root / value
    try:
        resolved = path.resolve()
        return (not Path(value).is_absolute() and resolved.is_relative_to(evidence_dir)
                and resolved.is_file() and resolved.stat().st_size > 0)
    except (OSError, ValueError):
        return False


def check_release(release, requirements, cases, root=ROOT):
    errors = []
    if not isinstance(release, dict):
        return ['release evidence must be an object']
    sha = release.get('tested_commit', '')
    if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{40}', sha):
        errors.append('tested_commit must be the actual full lowercase Git SHA')
    for key in ('deployed_url', 'repository_url'):
        value = release.get(key)
        try:
            parsed = urlparse(value if isinstance(value, str) else '')
            if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
                    or parsed.password or parsed.hostname in {'localhost', '127.0.0.1', 'example.com'}):
                errors.append(f'{key}: provide the real HTTPS URL without credentials')
        except ValueError:
            errors.append(f'{key}: invalid URL')
    for key, rows, status in (('tests', cases, 'pass'), ('requirements', requirements, 'complete')):
        entries = release.get(key)
        if not isinstance(entries, dict):
            errors.append(f'{key}: missing evidence map')
            continue
        expected = {row['id'] for row in rows}
        for unknown in sorted(set(entries) - expected):
            errors.append(f'{key}: unknown ID {unknown}')
        for rid in sorted(expected):
            entry = entries.get(rid)
            if not isinstance(entry, dict):
                errors.append(f'{rid}: missing evidence entry')
                continue
            if entry.get('status') != status:
                errors.append(f'{rid}: status must be {status}')
            if not artifact_valid(root, entry.get('artifact')):
                errors.append(f'{rid}: missing nonempty artifact under verification/evidence/')
            if key == 'tests':
                if entry.get('commit') != sha or not sha:
                    errors.append(f'{rid}: evidence commit differs from tested_commit')
                try:
                    date = datetime.fromisoformat(entry.get('executed_at', '').replace('Z', '+00:00'))
                    if date.tzinfo is None or date > datetime.now(timezone.utc):
                        raise ValueError('timezone missing or future timestamp')
                except (ValueError, TypeError, AttributeError):
                    errors.append(f'{rid}: execution time must be a real past timestamp with timezone')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path)
    args = parser.parse_args()
    try:
        requirements = json.loads((ROOT / 'verification/requirements.json').read_text())
        cases = json.loads((ROOT / 'verification/cases.json').read_text())
        errors = check_plan(requirements, cases)
        if not errors and args.release:
            errors += check_release(json.loads(args.release.read_text()), requirements, cases)
    except (OSError, ValueError) as exc:
        print(f'FAIL: cannot read valid verification inputs: {exc}', file=sys.stderr)
        return 1
    if errors:
        print('\n'.join('FAIL: ' + error for error in errors))
        print(f'{len(errors)} issue(s); product readiness is NOT established.')
        return 1
    if args.release:
        print('PASS: release evidence inventory complete. Independently review artifacts, CI and deployed behaviour.')
    else:
        print(f'PASS: {len(requirements)} requirements mapped to {len(cases)} cases. Product tests are not executed by this command.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""Package committed submission documentation; release mode requires real evidence."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import zipfile

from verify_plan import check_plan, check_release

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    'README.md', 'Problem_statement.txt', 'round 2.txt', 'CODE CATALYST.pdf',
    'docs/ARCHITECTURE.md', 'docs/COMPLETED_FEATURES.md',
    'docs/CHANGELOG_FROM_ROUND1.md', 'docs/CONTRIBUTIONS.md', 'docs/DISCLOSURES.md',
    'docs/ROUND3_IMPROVEMENTS.md', 'docs/SUBMISSION_STATUS.md',
    'docs/IMPLEMENTATION_PLAN.md', 'docs/DEPLOYMENT_AND_SUBMISSION.md',
    'docs/VERIFICATION.md', 'docs/SANATH_PROGRESS.md', 'docs/DARSHIL_PROGRESS.md',
    'docs/S2_HANDOFF.md', 'docs/S3_HANDOFF.md', 'docs/S4_HANDOFF.md', 'docs/S5_HANDOFF.md',
    "Surya's handoff/P1_HANDOFF.md", "Surya's handoff/P2_HANDOFF.md",
    "Surya's handoff/P3_HANDOFF.md", 'docs/MODEL_PLAN.md', 'docs/CONTRACTS.md',
    'contracts/openapi.json', 'apps/api/README.md', 'apps/web/README.md',
    'apps/api/requirements.lock', 'apps/web/package-lock.json', 'pyproject.toml',
    'verification/requirements.json', 'verification/cases.json',
    'verification/release-evidence.json', 'verification/evidence/s5-live-smoke.json',
    'verification/fixtures/lumadesk.json',
)


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], stderr=subprocess.PIPE)


def read_committed(sha, path):
    # Read Git objects, never a working-tree symlink or local environment file.
    entry = git('ls-tree', sha, '--', path).decode().split('\t', 1)
    if len(entry) != 2 or entry[0].split()[0] not in ('100644', '100755'):
        raise ValueError(f'Missing or non-regular committed file: {path}')
    return git('show', f'{sha}:{path}')


def evidence_path(value):
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('Evidence paths must be relative POSIX paths')
    path = PurePosixPath(value)
    if (path.is_absolute() or '..' in path.parts
            or path.parts[:2] != ('verification', 'evidence')
            or path.as_posix() != value):
        raise ValueError('Evidence must be beneath verification/evidence/')
    return value


def package(output, release=False):
    output = output.expanduser().resolve()
    if output.is_relative_to(ROOT) or output.suffix != '.zip' or output.exists():
        raise ValueError('Choose a new .zip file outside the repository')
    sha = git('rev-parse', 'HEAD').decode().strip()
    dirty = bool(git('status', '--porcelain'))
    data = {path: read_committed(sha, path) for path in FILES}
    evidence = json.loads(data['verification/release-evidence.json'])
    if not isinstance(evidence, dict):
        raise ValueError('Release evidence must be an object')
    for group in ('tests', 'requirements'):
        entries = evidence.get(group, {})
        if not isinstance(entries, dict):
            raise ValueError(f'Invalid {group} evidence map')
        for entry in entries.values():
            if isinstance(entry, dict) and entry.get('artifact'):
                path = evidence_path(entry['artifact'])
                data[path] = read_committed(sha, path)
    requirements = json.loads(data['verification/requirements.json'])
    cases = json.loads(data['verification/cases.json'])
    blockers = check_plan(requirements, cases)
    with tempfile.TemporaryDirectory(prefix='brandguard-submission-') as directory:
        root = Path(directory)
        for path, body in data.items():
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
        blockers += check_release(evidence, requirements, cases, root=root)
    if dirty:
        blockers.append('Working tree is dirty; only committed files are packaged')
    tested = evidence.get('tested_commit', '')
    evidence_only_changes = []
    if isinstance(tested, str) and len(tested) == 40 and all(c in '0123456789abcdef' for c in tested):
        try:
            git('merge-base', '--is-ancestor', tested, sha)
            changes = git('diff', '--name-only', '-z', tested, sha).decode().split('\0')
            evidence_only_changes = [p for p in changes if p]
            for path in evidence_only_changes:
                if not (path.startswith(('docs/', 'verification/evidence/'))
                        or path in ('README.md', 'verification/release-evidence.json')):
                    blockers.append(f'Application or verification code changed after tested_commit: {path}')
        except subprocess.CalledProcessError:
            blockers.append('tested_commit must exist and be an ancestor of packaged HEAD')
    if release and blockers:
        print(f'BLOCKED: {len(blockers)} release evidence issue(s); no archive written.')
        print('\n'.join(blockers))
        return 1
    manifest = dict(
        format_version=1, mode='release' if release else 'draft',
        packaged_commit=sha, created_at=datetime.now(timezone.utc).isoformat(),
        tested_code_commit=tested, changes_since_tested_commit=evidence_only_changes,
        working_tree_dirty_at_packaging=dirty,
        scope='Documentation/evidence package, not source checkout or live deployment',
        repository_url=evidence.get('repository_url'),
        release_evidence_inventory_complete=not blockers,
        independent_signoff='Required; inventory checks do not establish product readiness',
        release_blockers=blockers,
        files={path: dict(sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
               for path, body in sorted(data.items())},
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents an unnoticed overwrite of an earlier evidence bundle.
    with output.open('xb') as stream:
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for path, body in sorted(data.items()):
                archive.writestr(path, body)
            archive.writestr('MANIFEST.json', json.dumps(manifest, indent=2) + '\n')
    print(f'{manifest["mode"].upper()}: {output}')
    print(f'Commit: {sha}; {len(data)} committed files; {len(blockers)} release issue(s).')
    print('Review blockers, artifact contents, member confirmations and deployed behaviour before submission.')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='New .zip path outside repository')
    parser.add_argument('--release', action='store_true', help='Refuse packaging if release inventory is incomplete')
    args = parser.parse_args()
    try:
        return package(args.output, args.release)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        # Do not print Git output, environment values or private file contents.
        print(f'FAIL: {type(exc).__name__}: submission package could not be created.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

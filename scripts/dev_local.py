#!/usr/bin/env python3
"""Run an isolated, persistent fictional workspace. Ctrl+C stops only this stack."""
import argparse
import fcntl
import getpass
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.local' / 'dev'
DATABASE = 'brandguard_browser_test_local'


def available_ports(ports):
    if len(set(ports)) != len(ports) or any(not 1024 <= port <= 65535 for port in ports):
        raise RuntimeError('Choose three distinct ports between 1024 and 65535.')
    for port in ports:
        with socket.socket() as probe:
            # A closed service may leave TIME_WAIT sockets; allow an immediate restart.
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(('127.0.0.1', port))
            except OSError:
                raise RuntimeError(f'Port {port} is already in use. Choose another port; no existing service was stopped.') from None


def node_environment(environ):
    env = dict(environ)
    node = shutil.which('node', path=env.get('PATH'))
    if not node:
        candidate = Path.home() / '.local/node/bin/node'
        if candidate.is_file() and os.access(candidate, os.X_OK):
            node = str(candidate)
    if not node:
        raise RuntimeError('Install Node.js 22 or newer and npm, then add them to PATH.')
    env['PATH'] = str(Path(node).parent) + os.pathsep + env.get('PATH', os.defpath)
    version = subprocess.check_output([node, '--version'], text=True).strip()
    if int(version.lstrip('v').split('.')[0]) < 22 or not shutil.which('npm', path=env['PATH']):
        raise RuntimeError('Node.js 22 or newer and npm are required.')
    return env


def postgres_bin(explicit=None):
    candidates = [Path(explicit)] if explicit else []
    found = shutil.which('initdb')
    if found and not explicit:
        candidates.append(Path(found).parent)
    if not explicit:
        candidates.extend(sorted(Path('/usr/lib/postgresql').glob('*/bin'),
                                 key=lambda p: int(p.parent.name) if p.parent.name.isdigit() else 0, reverse=True))
    for candidate in candidates:
        if all((candidate / name).is_file() for name in ('initdb', 'pg_ctl', 'createdb', 'psql')):
            return candidate
    raise RuntimeError('Install PostgreSQL server tools, or supply --pg-bin /path/to/postgresql/bin.')


def child_environment(env, db_port, web_port, external):
    env = dict(env)
    env.update(DATABASE_URL=f'postgresql+psycopg://{getpass.getuser()}@127.0.0.1:{db_port}/{DATABASE}',
               PUBLIC_ORIGIN=f'http://localhost:{web_port}', APP_ENV='development',
               PYTHONPATH=os.pathsep.join(str(ROOT / part) for part in ('apps/api', 'packages', '.')),
               BROWSER_FIXTURE_PATH=str(STATE / 'demo-accounts.json'), VITE_USE_MOCK_API='false')
    if not external:
        env['NEBIUS_API_KEY'] = ''
    return env


def run_step(label, command, env):
    with (STATE / 'startup.log').open('ab') as log:
        result = subprocess.run([str(part) for part in command], cwd=ROOT, env=env,
                                stdin=subprocess.DEVNULL, stdout=log, stderr=log)
    if result.returncode:
        raise RuntimeError(f'{label} failed. See {STATE / "startup.log"}.')


def start_process(command, env, name):
    with (STATE / f'{name}.log').open('ab') as log:
        return subprocess.Popen([str(part) for part in command], cwd=ROOT, env=env,
                                stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)


def stop_processes(processes):
    for process in reversed(processes):
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for process in reversed(processes):
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)


def wait_ready(url, processes, timeout=30):
    deadline = time.monotonic() + timeout
    local_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError(f'A service exited during startup. Inspect logs in {STATE}.')
        try:
            with local_http.open(url, timeout=1) as response:
                if json.loads(response.read(4096)).get('status') == 'ready':
                    return
        except (OSError, urllib.error.URLError, ValueError):
            pass
        time.sleep(.2)
    raise RuntimeError(f'Startup readiness timed out. Inspect logs in {STATE}.')


def validate_accounts(path):
    data = json.loads(path.read_text())
    uuid.UUID(data['org_id'])
    if not isinstance(data['password'], str) or len(data['password']) < 16:
        raise RuntimeError('Local account file is invalid. Restore it from your private backup.')
    if not all(isinstance(data['emails'].get(role), str) for role in ('creator', 'reviewer', 'manager', 'admin')):
        raise RuntimeError('Local account file is incomplete. Restore it from your private backup.')
    return data


def serve(args):
    python = ROOT / '.venv/bin/python'
    if not python.is_file() or not (ROOT / 'apps/web/node_modules').is_dir():
        raise RuntimeError('Install dependencies first: see docs/LOCAL_DEVELOPMENT.md.')
    env = node_environment(os.environ)
    pg = postgres_bin(args.pg_bin)
    available_ports((args.db_port, args.api_port, args.web_port))
    env = child_environment(env, args.db_port, args.web_port, args.external)
    env['BRANDGUARD_API_TARGET'] = f'http://127.0.0.1:{args.api_port}'
    pgdata, pg_socket = STATE / 'postgres', STATE / 'socket'
    pg_socket.mkdir(exist_ok=True)
    if not (pgdata / 'PG_VERSION').exists():
        if pgdata.exists():
            raise RuntimeError(f'{pgdata} exists without PG_VERSION. No files were overwritten; inspect it before retrying.')
        print('Creating persistent local database storage…', flush=True)
        run_step('PostgreSQL initialisation', [pg / 'initdb', '-D', pgdata, '--auth=trust', '--encoding=UTF8', '--no-locale'], env)
    processes, started_pg = [], False
    try:
        run_step('PostgreSQL startup', [pg / 'pg_ctl', '-D', pgdata, '-l', STATE / 'postgres.log', '-o',
                 f'-h 127.0.0.1 -p {args.db_port} -k "{pg_socket}"', 'start'], env)
        started_pg = True
        connection = ['-h', '127.0.0.1', '-p', str(args.db_port), '-U', getpass.getuser()]
        exists = subprocess.check_output([str(pg / 'psql'), *connection, '-d', 'postgres', '-tAc',
            f"SELECT 1 FROM pg_database WHERE datname='{DATABASE}'"], env=env, text=True).strip()
        if not exists:
            run_step('Database creation', [pg / 'createdb', *connection, DATABASE], env)
        run_step('Database migration', [python, '-m', 'alembic', '-c', 'apps/api/alembic.ini', 'upgrade', 'head'], env)
        account_file = STATE / 'demo-accounts.json'
        if account_file.exists():
            accounts = validate_accounts(account_file)
            exists = subprocess.check_output([str(pg / 'psql'), *connection, '-d', DATABASE, '-tAc',
                f"SELECT 1 FROM organisations WHERE id='{uuid.UUID(accounts['org_id'])}'"], env=env, text=True).strip()
            if not exists:
                raise RuntimeError('The saved local workspace is absent. No data was reset; restore the matching database and account file.')
        else:
            print('Provisioning a fictional workspace and separate team identities…', flush=True)
            run_step('Fictional workspace provisioning', [python, 'scripts/seed_browser_check.py'], env)
        print('Building the frontend…', flush=True)
        run_step('Frontend build', ['npm', '--prefix', 'apps/web', 'run', 'build'], env)
        processes.append(start_process([python, '-m', 'uvicorn', 'brandguard.main:create_app', '--factory',
                                       '--host', '127.0.0.1', '--port', str(args.api_port)], env, 'api'))
        processes.append(start_process([python, '-m', 'apps.worker'], env, 'worker'))
        processes.append(start_process(['npm', '--prefix', 'apps/web', 'run', 'preview', '--', '--host',
                                       '127.0.0.1', '--port', str(args.web_port), '--strictPort'], env, 'web'))
        wait_ready(f'http://localhost:{args.web_port}/api/v1/health/ready', processes)
        mode = 'external review permitted; provider configuration, workspace approval and per-run consent required' if args.external else 'local checks; external provider key disabled'
        print(f'\nBrandGuard: http://localhost:{args.web_port}\nMode: {mode}\n'
              f'Accounts: python3 scripts/dev_local.py accounts\nLogs and persistent data: {STATE}\n'
              'Press Ctrl+C to stop this stack. Your workspace is preserved.', flush=True)
        while True:
            if any(process.poll() is not None for process in processes):
                raise RuntimeError(f'A service stopped. Inspect logs in {STATE}.')
            time.sleep(.3)
    finally:
        try:
            stop_processes(processes)
        finally:
            if started_pg:
                run_step('PostgreSQL shutdown', [pg / 'pg_ctl', '-D', pgdata, '-m', 'fast', 'stop'], env)
        print('Local stack stopped; data preserved.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', nargs='?', choices=('start', 'accounts'), default='start')
    parser.add_argument('--db-port', type=int, default=55441)
    parser.add_argument('--api-port', type=int, default=8013)
    parser.add_argument('--web-port', type=int, default=5183)
    parser.add_argument('--pg-bin', help='Directory containing initdb, pg_ctl, createdb and psql')
    parser.add_argument('--external', action='store_true', help='Allow your configured Nebius key; inference may incur provider charges')
    args = parser.parse_args()
    os.umask(0o077)
    def stop_requested(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop_requested)
    signal.signal(signal.SIGHUP, stop_requested)
    try:
        if args.command == 'accounts':
            accounts = validate_accounts(STATE / 'demo-accounts.json')
            print(f"Fictional local workspace: {accounts['org_id']}\nPassword: {accounts['password']}")
            for role, email in accounts['emails'].items():
                print(f'{role}: {email}')
            return 0
        STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (STATE / 'launcher.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('This local stack already has a launcher. Stop it with Ctrl+C before restarting.') from None
            serve(args)
    except KeyboardInterrupt:
        return 0
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(f'Local startup failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

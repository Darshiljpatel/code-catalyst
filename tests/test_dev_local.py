"""Launcher preflight and isolation checks; real startup is verified separately."""
import json
from pathlib import Path
import signal
import socket
from types import SimpleNamespace
import pytest
from scripts import dev_local


@pytest.mark.parametrize('ports', [(1, 8013, 5183), (55441, 8013, 8013), (65536, 8013, 5183)])
def test_port_validation(ports):
    with pytest.raises(RuntimeError, match='three distinct ports'):
        dev_local.available_ports(ports)


def test_occupied_port_is_refused_without_stopping_anything():
    with socket.socket() as occupied:
        occupied.bind(('127.0.0.1', 0))
        port = occupied.getsockname()[1]
        with pytest.raises(RuntimeError, match=f'Port {port} is already in use'):
            dev_local.available_ports((port, 8013, 5183))
        assert occupied.fileno() >= 0


def test_a_recently_closed_listener_can_restart():
    with socket.socket() as server, socket.socket() as client:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(('127.0.0.1', 0))
        port = server.getsockname()[1]
        server.listen()
        client.connect(('127.0.0.1', port))
        connection, _ = server.accept()
        connection.close()
        assert client.recv(1) == b''
    dev_local.available_ports((port,))


def test_child_environment_is_local_explicit_and_does_not_mutate_parent():
    original = {'NEBIUS_API_KEY': 'fictional-test-key', 'DATABASE_URL': 'do-not-use-this', 'APP_ENV': 'production'}
    local = dev_local.child_environment(original, 55441, 5183, False)
    assert local['NEBIUS_API_KEY'] == ''
    assert local['DATABASE_URL'].endswith(':55441/brandguard_browser_test_local')
    assert local['APP_ENV'] == 'development'
    assert local['PUBLIC_ORIGIN'] == 'http://localhost:5183'
    assert original['NEBIUS_API_KEY'] == 'fictional-test-key'
    assert dev_local.child_environment(original, 55441, 5183, True)['NEBIUS_API_KEY'] == 'fictional-test-key'


def test_missing_node_is_actionable(monkeypatch, tmp_path):
    monkeypatch.setattr(dev_local.shutil, 'which', lambda *args, **kwargs: None)
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    with pytest.raises(RuntimeError, match='Install Node.js'):
        dev_local.node_environment({'PATH': '/missing'})


def test_older_node_is_refused(monkeypatch):
    monkeypatch.setattr(dev_local.shutil, 'which', lambda *args, **kwargs: '/fake/node')
    monkeypatch.setattr(dev_local.subprocess, 'check_output', lambda *args, **kwargs: 'v20.19.0')
    with pytest.raises(RuntimeError, match='Node.js 22 or newer'):
        dev_local.node_environment({'PATH': '/fake'})


def test_postgres_tools_are_checked_before_start(tmp_path):
    with pytest.raises(RuntimeError, match='Install PostgreSQL server tools'):
        dev_local.postgres_bin(str(tmp_path))
    for name in ('initdb', 'pg_ctl', 'createdb', 'psql'):
        (tmp_path / name).touch()
    assert dev_local.postgres_bin(str(tmp_path)) == tmp_path


def test_accounts_validation_does_not_replace_bad_files(tmp_path):
    path = tmp_path / 'accounts.json'
    data = dict(org_id='00000000-0000-4000-a000-000000000001', password='fictional-test-password',
                emails={role: role+'@example.test' for role in ('creator', 'reviewer', 'manager', 'admin')})
    path.write_text(json.dumps(data))
    assert dev_local.validate_accounts(path) == data
    data['org_id'] = "invalid' OR true"
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        dev_local.validate_accounts(path)
    assert json.loads(path.read_text()) == data


def test_shutdown_only_signals_owned_groups_even_if_a_wrapper_has_exited(monkeypatch):
    signals = []
    monkeypatch.setattr(dev_local.os, 'killpg', lambda pid, sig: signals.append((pid, sig)))
    processes = [SimpleNamespace(pid=501, wait=lambda timeout: 0), SimpleNamespace(pid=502, wait=lambda timeout: 0)]
    dev_local.stop_processes(processes)
    assert signals == [(502, signal.SIGTERM), (501, signal.SIGTERM)]


def test_wait_ready_detects_a_dead_child():
    with pytest.raises(RuntimeError, match='service exited'):
        dev_local.wait_ready('http://localhost:1', [SimpleNamespace(poll=lambda: 1)], timeout=1)

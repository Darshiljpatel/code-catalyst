import os
import re
from pathlib import Path
import pytest


def test_compose_file_exists_and_declares_services():
    compose_path = Path("infra/docker-compose.yml")
    assert compose_path.exists(), "infra/docker-compose.yml must exist"
    content = compose_path.read_text(encoding="utf-8")
    assert "postgres:" in content
    assert "api:" in content
    assert "worker:" in content
    assert "web:" in content
    assert "pgdata:" in content
    assert "healthcheck:" in content


def test_dockerfiles_exist_and_specify_valid_targets():
    worker_df = Path("infra/Dockerfile.worker")
    api_df = Path("infra/Dockerfile.api")
    web_df = Path("infra/Dockerfile.web")

    assert worker_df.exists(), "infra/Dockerfile.worker must exist"
    assert api_df.exists(), "infra/Dockerfile.api must exist"
    assert web_df.exists(), "infra/Dockerfile.web must exist"

    w_content = worker_df.read_text(encoding="utf-8")
    assert "apps.worker" in w_content

    a_content = api_df.read_text(encoding="utf-8")
    assert "uvicorn" in a_content or "brandguard.main" in a_content

    web_content = web_df.read_text(encoding="utf-8")
    assert "npm run build" in web_content or "caddy" in web_content or "nginx" in web_content


def test_caddyfile_reverse_proxy_and_spa():
    caddy_path = Path("infra/Caddyfile")
    assert caddy_path.exists(), "infra/Caddyfile must exist"
    content = caddy_path.read_text(encoding="utf-8")
    assert "reverse_proxy" in content
    assert "api:8000" in content or ":8000" in content


def test_healthcheck_script_loads():
    hc_path = Path("infra/healthcheck.py")
    assert hc_path.exists(), "infra/healthcheck.py must exist"
    content = hc_path.read_text(encoding="utf-8")
    assert "def check_health" in content or "def main" in content


def test_backup_and_restore_scripts():
    backup_path = Path("infra/backup.py")
    restore_path = Path("infra/restore.py")
    assert backup_path.exists(), "infra/backup.py must exist for Case T18"
    assert restore_path.exists(), "infra/restore.py must exist for Case T18"


def test_backup_and_restore_roundtrip(tmp_path):
    from infra.backup import create_backup
    from infra.restore import restore_snapshot, verify_snapshot_integrity

    # Create dummy file to backup
    test_file = tmp_path / "sample_policy.txt"
    test_file.write_text("Confidential brand guidelines.", encoding="utf-8")

    backup_file = tmp_path / "test_snapshot.json"
    dummy_records = {
        "campaigns": [
            {"id": "camp-1", "title": "Summer Sale"},
            {"id": "camp-deleted-2", "title": "Old Purged"},
        ]
    }
    tombstones = [{"target_id": "camp-deleted-2", "reason": "gdpr_purge"}]

    snapshot = create_backup(
        output_path=backup_file,
        db_records=dummy_records,
        files_to_backup=[test_file],
        tombstones=tombstones,
        expiry_days=7,
    )
    assert backup_file.exists()
    assert "checksum_sha256" in snapshot["metadata"]

    # Verify integrity
    valid, msg, loaded = verify_snapshot_integrity(backup_file)
    assert valid is True
    assert "verified" in msg.lower()

    # Restore with tombstone reapplication
    restored_dir = tmp_path / "restored_files"
    res = restore_snapshot(backup_file, target_dir=restored_dir, reapply_tombstones=True)
    assert res["status"] == "success"
    assert res["tombstones_reapplied"] == 1
    assert len(res["tables"]["campaigns"]) == 1
    assert res["tables"]["campaigns"][0]["id"] == "camp-1"
    assert res["files_restored"] == 1
    assert (restored_dir / "sample_policy.txt").read_text(encoding="utf-8") == "Confidential brand guidelines."

    # Verify export artifact works (Case T18)
    assert res["export"]["export_format"] == "brandguard_summary_v1"
    assert res["export"]["campaigns_count"] == 1


def test_corrupt_snapshot_rejected(tmp_path):
    from infra.backup import create_backup
    from infra.restore import verify_snapshot_integrity, restore_snapshot
    import json

    backup_file = tmp_path / "corrupt_snapshot.json"
    create_backup(output_path=backup_file, db_records={"brands": [{"id": "1", "name": "Test"}]})

    # Tamper with payload
    data = json.loads(backup_file.read_text(encoding="utf-8"))
    data["payload"]["tables"]["brands"][0]["name"] = "TamperedBrand"
    backup_file.write_text(json.dumps(data), encoding="utf-8")

    valid, msg, _ = verify_snapshot_integrity(backup_file)
    assert valid is False
    assert "checksum mismatch" in msg.lower()

    res = restore_snapshot(backup_file)
    assert res["status"] == "failed"
    assert "mismatch" in res["error"].lower()


def test_healthcheck_probe_functionality():
    from infra.healthcheck import check_engine, check_api
    assert check_engine() is True
    assert check_api("http://127.0.0.1:59999", timeout=0.1) is False


def test_healthcheck_endpoint_is_health_ready():
    compose_path = Path("infra/compose.yaml")
    api_df = Path("infra/Dockerfile.api")
    hc_path = Path("infra/healthcheck.py")

    assert "/api/v1/health/ready" in compose_path.read_text(encoding="utf-8")
    assert "/api/v1/health/ready" in api_df.read_text(encoding="utf-8")
    assert "/api/v1/health/ready" in hc_path.read_text(encoding="utf-8")


def test_database_dump_and_restore_live(tmp_path):
    from sqlalchemy import create_engine, text
    from infra.backup import dump_database_records, extract_tombstones, create_backup
    from infra.restore import restore_snapshot

    db_path = tmp_path / "test_live.db"
    db_url = f"sqlite:///{db_path}"

    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE brands (id TEXT PRIMARY KEY, name TEXT, source_epoch INT)"))
        conn.execute(text("INSERT INTO brands VALUES ('b-10', 'LumaDesk', 1)"))
        conn.execute(text("INSERT INTO brands VALUES ('b-deleted', 'ExpiredBrand', 1)"))
        conn.execute(text("CREATE TABLE content_revisions (id TEXT PRIMARY KEY, item_id TEXT, number INT, text TEXT, text_hash TEXT)"))
        text_content = "100% verified copy."
        import hashlib
        thash = hashlib.sha256(text_content.encode("utf-8")).hexdigest()
        conn.execute(text(f"INSERT INTO content_revisions VALUES ('r-1', 'item-1', 1, '{text_content}', '{thash}')"))
        conn.execute(text("CREATE TABLE audit_events (id TEXT PRIMARY KEY, action TEXT, object_id TEXT, created_at TEXT, details TEXT)"))
        conn.execute(text("INSERT INTO audit_events VALUES ('evt-1', 'retention_purge', 'b-deleted', '2026-10-23T00:00:00Z', '{\"reason\": \"user_data_retention\"}')"))
    engine.dispose()

    # Dump live database
    dumped = dump_database_records(db_url)
    assert len(dumped["brands"]) == 2
    assert len(dumped["content_revisions"]) == 1
    assert len(dumped["audit_events"]) == 1

    # Extract deletion tombstones (Case T21)
    tombstones = extract_tombstones(dumped)
    assert len(tombstones) == 1
    assert tombstones[0]["target_id"] == "b-deleted"

    # Snapshot to JSON
    snapshot_file = tmp_path / "live_snapshot.json"
    create_backup(output_path=snapshot_file, db_records=dumped, tombstones=tombstones, expiry_days=7)

    # Restore into separate target database
    target_db_path = tmp_path / "target_live.db"
    target_db_url = f"sqlite:///{target_db_path}"
    target_engine = create_engine(target_db_url)
    with target_engine.begin() as conn:
        conn.execute(text("CREATE TABLE brands (id TEXT PRIMARY KEY, name TEXT, source_epoch INT)"))
        conn.execute(text("CREATE TABLE content_revisions (id TEXT PRIMARY KEY, item_id TEXT, number INT, text TEXT, text_hash TEXT)"))
    with target_engine.begin() as conn:
        conn.execute(text("CREATE TABLE audit_events (id TEXT PRIMARY KEY, action TEXT, object_id TEXT, created_at TEXT, details TEXT)"))
    target_engine.dispose()

    res = restore_snapshot(snapshot_file, target_db_url=target_db_url, reapply_tombstones=True)
    assert res["status"] == "success"
    # b-deleted should be suppressed from live restoration
    assert res["db_restored"]["brands"] == 1
    assert res["db_restored"]["content_revisions"] == 1

    # Confirm by querying target live database directly
    target_verify_engine = create_engine(target_db_url)
    with target_verify_engine.connect() as conn:
        brand_ids = [row[0] for row in conn.execute(text("SELECT id FROM brands")).fetchall()]
        assert "b-10" in brand_ids
        assert "b-deleted" not in brand_ids
    target_verify_engine.dispose()

    # Row recovery does not establish that a revision was approved.
    assert res["export"]["export_format"] == "brandguard_summary_v1"
    assert res["export"]["approved_export_verified"] is False


def test_failed_database_restore_is_not_success(tmp_path):
    from infra.backup import create_backup
    from infra.restore import restore_snapshot
    snapshot = tmp_path / 'snapshot.json'
    create_backup(snapshot, {'unknown_table': [{'id': 'x'}]})
    result = restore_snapshot(snapshot, target_db_url=f'sqlite:///{tmp_path / "empty.db"}')
    assert result['status'] == 'failed'


def test_expired_snapshot_is_rejected(tmp_path):
    import json
    from infra.backup import create_backup, compute_sha256
    from infra.restore import restore_snapshot
    snapshot = tmp_path / 'snapshot.json'
    data = create_backup(snapshot, {'brands': []})
    data['payload']['expires_at'] = '2020-01-01T00:00:00+00:00'
    data['metadata']['checksum_sha256'] = compute_sha256(json.dumps(data['payload'], sort_keys=True, indent=2).encode())
    snapshot.write_text(json.dumps(data))
    assert restore_snapshot(snapshot)['status'] == 'failed'


def test_restore_rejects_parent_path_file(tmp_path):
    import json
    from infra.backup import create_backup, compute_sha256
    from infra.restore import restore_snapshot
    source = tmp_path / 'file.txt'
    source.write_text('private')
    snapshot = tmp_path / 'snapshot.json'
    data = create_backup(snapshot, files_to_backup=[source])
    data['payload']['files'][0]['filename'] = '../escape.txt'
    data['metadata']['checksum_sha256'] = compute_sha256(json.dumps(data['payload'], sort_keys=True, indent=2).encode())
    snapshot.write_text(json.dumps(data))
    assert restore_snapshot(snapshot, target_dir=tmp_path / 'restored')['status'] == 'failed'
    assert not (tmp_path / 'escape.txt').exists()

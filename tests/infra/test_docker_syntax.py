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


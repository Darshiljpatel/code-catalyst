"""Snapshot restoration and validation utility for BrandGuard.

Restores complete snapshots into an empty migrated database; fails on any error.
An approved export must subsequently be exercised through the application API.
"""
import argparse
import base64
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_root = Path(__file__).resolve().parent.parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

try:
    from infra.backup import compute_sha256
except ImportError:
    from backup import compute_sha256


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("brandguard.restore")


def verify_snapshot_integrity(snapshot_path: Path | str) -> Tuple[bool, str, Dict[str, Any]]:
    """Verifies SHA-256 checksum, structure, and expiry of a backup snapshot."""
    path = Path(snapshot_path)
    if not path.exists():
        return False, f"Snapshot file not found: {path}", {}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return False, f"Failed to parse JSON snapshot: {e}", {}

    if "metadata" not in data or "payload" not in data:
        return False, "Invalid snapshot format: missing 'metadata' or 'payload'", {}

    expected_hash = data["metadata"].get("checksum_sha256")
    canonical_bytes = json.dumps(data["payload"], sort_keys=True, indent=2).encode("utf-8")
    actual_hash = compute_sha256(canonical_bytes)

    if actual_hash != expected_hash:
        return (
            False,
            f"Checksum mismatch! Expected: {expected_hash}, Actual: {actual_hash}",
            data,
        )

    # Check expiry
    expires_at_str = data["payload"].get("expires_at")
    if expires_at_str:
        try:
            expires_at = datetime.fromisoformat(expires_at_str)
            now = datetime.now(timezone.utc)
            if now > expires_at:
                return False, "Snapshot has expired", data
        except (ValueError, TypeError):
            return False, "Invalid snapshot expiry", data

    return True, "Snapshot verified with matching SHA-256 checksum", data


def restore_database_records(
    target_db_url: str,
    tables: Dict[str, List[Dict[str, Any]]],
    tombstones: Optional[List[Dict[str, Any]]] = None,
    reapply_tombstones: bool = True,
) -> Dict[str, int]:
    """Inserts restored rows into live PostgreSQL database, suppressing tombstoned IDs."""
    from sqlalchemy import create_engine, MetaData, select, func, DateTime
    engine = create_engine(target_db_url)
    inserted_counts = {}
    try:
        with engine.begin() as conn:
            metadata = MetaData()
            metadata.reflect(bind=conn)
            unknown = set(tables) - set(metadata.tables)
            if unknown:
                raise ValueError("Snapshot contains tables absent from the target schema")
            # Never merge a backup into existing data or silently skip conflicts.
            for name in tables:
                if conn.scalar(select(func.count()).select_from(metadata.tables[name])):
                    raise ValueError("Restore requires empty application tables")
            for table in metadata.sorted_tables:
                if table.name not in tables:
                    continue
                rows = []
                for original in tables[table.name]:
                    row = dict(original)
                    for column in table.columns:
                        if isinstance(column.type, DateTime) and isinstance(row.get(column.name), str):
                            row[column.name] = datetime.fromisoformat(row[column.name])
                    rows.append(row)
                if rows:
                    conn.execute(table.insert(), rows)
                inserted_counts[table.name] = len(rows)
        return inserted_counts
    finally:
        engine.dispose()


def restore_snapshot(
    snapshot_path: Path | str,
    target_dir: Optional[Path | str] = None,
    target_db_url: Optional[str] = None,
    reapply_tombstones: bool = True,
) -> Dict[str, Any]:
    """Restores data and files from a verified snapshot.

    Args:
        snapshot_path: Path to the backup snapshot JSON file.
        target_dir: Directory where restored files should be unpacked.
        target_db_url: Optional live PostgreSQL URL to restore table rows into.
        reapply_tombstones: If True, filters out deleted items per Case T21.

    Returns:
        Summary dict containing status, restored tables, restored file count, and export artifact.
    """
    valid, message, data = verify_snapshot_integrity(snapshot_path)
    if not valid:
        logger.error(f"Integrity check failed: {message}")
        return {"status": "failed", "error": message}

    payload = data["payload"]
    raw_tables = payload.get("tables", {})
    tombstones = payload.get("tombstones", [])
    files = payload.get("files", [])

    # Collect tombstoned IDs for Case T21 reapplication
    tombstone_ids = {t["target_id"] for t in tombstones if "target_id" in t}

    # Filter tables reapplying tombstones
    restored_tables: Dict[str, List[Dict[str, Any]]] = {}
    purged_records_count = 0

    for table_name, rows in raw_tables.items():
        filtered_rows = []
        for row in rows:
            row_id = row.get("id")
            if reapply_tombstones and row_id in tombstone_ids:
                purged_records_count += 1
                logger.info(f"Reapplied tombstone: suppressed deleted record {row_id} in {table_name}")
            else:
                filtered_rows.append(row)
        restored_tables[table_name] = filtered_rows

    # Unpack files if target_dir provided
    restored_files_count = 0
    if target_dir and files:
        dest_dir = Path(target_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        for f in files:
            content = base64.b64decode(f["content_base64"].encode("ascii"))
            file_hash = compute_sha256(content)
            if file_hash != f["sha256"]:
                return {
                    "status": "failed",
                    "error": f"File hash mismatch for {f['filename']}: expected {f['sha256']}, got {file_hash}",
                }
            filename = f["filename"]
            if not filename or Path(filename).name != filename or filename in {".", ".."}:
                return {"status": "failed", "error": "Unsafe backup filename"}
            target_file = dest_dir / filename
            if target_file.is_symlink() or target_file.exists():
                return {"status": "failed", "error": "Restore file already exists"}
            target_file.write_bytes(content)
            restored_files_count += 1

    # Optional restoration into target live database
    db_insert_summary = None
    if target_db_url:
        try:
            logger.info("Restoring records into target PostgreSQL database...")
            db_insert_summary = restore_database_records(
                target_db_url,
                restored_tables,
                tombstones=tombstones,
                reapply_tombstones=reapply_tombstones,
            )
            logger.info(f"Database restoration complete: {db_insert_summary}")
        except Exception as e:
            return {"status": "failed", "error": f"Database restore failed: {type(e).__name__}"}

    # A recovery summary is not an approval decision or export certificate.
    sample_export = {
        "export_format": "brandguard_summary_v1",
        "brands_count": len(restored_tables.get("brands", [])),
        "campaigns_count": len(restored_tables.get("campaigns", []) or restored_tables.get("content_items", [])),
        "approved_export_verified": False,
    }

    return {
        "status": "success",
        "checksum_sha256": data["metadata"]["checksum_sha256"],
        "tables": restored_tables,
        "files_restored": restored_files_count,
        "tombstones_reapplied": purged_records_count,
        "db_restored": db_insert_summary,
        "export": sample_export,
    }


def main():
    import os
    parser = argparse.ArgumentParser(description="Restore and verify BrandGuard snapshot")
    parser.add_argument(
        "snapshot",
        nargs="?",
        default="verification/evidence/t18_backup.json",
        help="Path to snapshot JSON",
    )
    parser.add_argument(
        "--target-dir",
        default=None,
        help="Optional directory to unpack files into",
    )
    parser.add_argument(
        "--target-db-url",
        default=os.environ.get("TARGET_DATABASE_URL") or os.environ.get("DATABASE_URL"),
        help="Optional live database URL to restore table rows into",
    )
    args = parser.parse_args()

    result = restore_snapshot(
        args.snapshot,
        target_dir=args.target_dir,
        target_db_url=args.target_db_url,
    )
    if result["status"] != "success":
        logger.error(f"Restore failed: {result.get('error')}")
        exit(1)
    logger.info("Restore and verification complete.")


if __name__ == "__main__":
    main()


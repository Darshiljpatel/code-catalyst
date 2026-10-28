"""Database and private storage snapshot backup utility for BrandGuard.

Creates database snapshots. Recovery and deletion-ledger checks must be tested separately.
"""
import argparse
import base64
import hashlib
import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("brandguard.backup")


def compute_sha256(data: bytes) -> str:
    """Computes SHA-256 hex digest for binary data."""
    return hashlib.sha256(data).hexdigest()


def compute_file_sha256(path: Path) -> str:
    """Computes SHA-256 hex digest for a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def create_backup(
    output_path: Path | str,
    db_records: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    files_to_backup: Optional[List[Path | str]] = None,
    tombstones: Optional[List[Dict[str, Any]]] = None,
    expiry_days: int = 7,
) -> Dict[str, Any]:
    """Creates a consistent backup snapshot with SHA-256 manifests and expiry metadata.

    Args:
        output_path: Destination path for the backup JSON artifact.
        db_records: Optional dictionary of table_name -> list of row dicts.
        files_to_backup: Optional list of file paths to bundle.
        tombstones: Optional list of deletion tombstones for Case T21.
        expiry_days: Retention duration in days (default: 7 days as per specification).

    Returns:
        The snapshot dictionary including SHA-256 checksum and metadata.
    """
    if not 1 <= expiry_days <= 7:
        raise ValueError("Retention must be between one and seven days")
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(days=expiry_days)

    backed_up_files = []
    if files_to_backup:
        for f in files_to_backup:
            f_path = Path(f)
            if f_path.exists() and f_path.is_file():
                raw = f_path.read_bytes()
                f_hash = compute_sha256(raw)
                backed_up_files.append({
                    "filename": f_path.name,
                    "rel_path": str(f_path),
                    "size_bytes": len(raw),
                    "sha256": f_hash,
                    "content_base64": base64.b64encode(raw).decode("ascii"),
                })
            else:
                raise ValueError("A requested backup file is missing or not regular")

    payload = {
        "version": "1.0",
        "created_at": now.isoformat(),
        "expires_at": expiry.isoformat(),
        "retention_policy": f"{expiry_days}-day expiry",
        "tables": db_records or {},
        "files": backed_up_files,
        "tombstones": tombstones or [],
    }

    # Compute deterministic SHA-256 of the canonical JSON representation
    canonical_bytes = json.dumps(payload, sort_keys=True, indent=2).encode("utf-8")
    payload_checksum = compute_sha256(canonical_bytes)

    snapshot = {
        "metadata": {
            "checksum_sha256": payload_checksum,
            "algorithm": "sha256",
        },
        "payload": payload,
    }

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    import os
    with os.fdopen(os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(snapshot, stream, indent=2)

    logger.info(
        f"Backup successfully written to {out} (SHA-256: {payload_checksum[:16]}..., "
        f"files: {len(backed_up_files)}, tables: {len(payload['tables'])}, "
        f"expires: {expiry.isoformat()})"
    )
    return snapshot


def dump_database_records(db_url: str) -> Dict[str, List[Dict[str, Any]]]:
    """Connects to live PostgreSQL/SQLAlchemy and exports real table records as serializable dicts."""
    from sqlalchemy import create_engine, MetaData, select
    engine = create_engine(db_url)
    records = {}
    try:
        # All tables are read in one consistent PostgreSQL snapshot. Sessions are
        # deliberately excluded: recovery requires everyone to sign in again.
        with engine.connect() as conn:
            if engine.dialect.name == "postgresql":
                conn = conn.execution_options(isolation_level="REPEATABLE READ")
            with conn.begin():
                metadata = MetaData()
                metadata.reflect(bind=conn)
                for table in metadata.sorted_tables:
                    if table.name in {"alembic_version", "sessions", "login_attempts"}:
                        continue
                    rows = []
                    for row in conn.execute(select(table)).mappings():
                        rows.append({k: v.isoformat() if isinstance(v, datetime) else v
                                     for k, v in row.items()})
                    records[table.name] = rows
        return records
    finally:
        engine.dispose()


def extract_tombstones(db_records: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Extracts deletion tombstones from audit events for Case T21 data retention."""
    tombstones = []
    for event in db_records.get("audit_events", []):
        action = str(event.get("action", "")).lower()
        # Changing the retention period deletes nothing; its object is the workspace itself.
        if action == "retention.updated":
            continue
        if "delete" in action or "purge" in action or "retention" in action:
            details = event.get("details")
            reason = "retention_purge"
            if isinstance(details, dict):
                reason = details.get("reason", "retention_purge")
            elif isinstance(details, str):
                try:
                    import json
                    parsed = json.loads(details)
                    if isinstance(parsed, dict):
                        reason = parsed.get("reason", "retention_purge")
                except Exception:
                    reason = details
            target_id = event.get("object_id") or event.get("target_id")
            # An import purge is logged against the workspace; only its listed rows were deleted.
            if target_id and action != "retention.purged_imports":
                tombstones.append({
                    "target_id": str(target_id),
                    "deleted_at": event.get("created_at"),
                    "reason": reason,
                })
            # Retention purges list every deleted row (revisions, runs, findings, images) in the ledger.
            if isinstance(details, dict) and isinstance(details.get("deleted_ids"), list):
                tombstones.extend({"target_id": str(row_id), "deleted_at": event.get("created_at"), "reason": reason}
                                  for row_id in details["deleted_ids"])
            # Guideline-request copies of the campaign text are redacted, not deleted.
            if isinstance(details, dict):
                tombstones.extend({"target_id": str(row_id), "deleted_at": event.get("created_at"), "reason": reason,
                                   "action": "redact", "table": "request_examples"}
                                  for row_id in details.get("redacted_examples") or [])
                tombstones.extend({"target_id": str(row_id), "deleted_at": event.get("created_at"), "reason": reason,
                                   "action": "redact_case"}
                                  for row_id in details.get("redacted_cases") or [])
    return tombstones


def main():
    import os
    parser = argparse.ArgumentParser(description="Create BrandGuard backup snapshot")
    parser.add_argument(
        "--output",
        "-o",
        default="verification/evidence/t18_backup.json",
        help="Destination JSON path for backup snapshot",
    )
    parser.add_argument(
        "--db-url",
        default=os.environ.get("DATABASE_URL"),
        help="Optional live database URL to dump tables from",
    )
    parser.add_argument(
        "--expiry-days",
        type=int,
        default=7,
        help="Expiry retention period in days (default: 7)",
    )
    parser.add_argument(
        "--files",
        nargs="*",
        default=[],
        help="Optional file paths to bundle into snapshot",
    )
    args = parser.parse_args()

    if not args.db_url:
        parser.error("DATABASE_URL or --db-url is required; no fixture fallback is used")
    db_records = dump_database_records(args.db_url)
    if not db_records:
        raise SystemExit("No application tables found; backup aborted")
    tombstones = extract_tombstones(db_records)

    create_backup(
        output_path=args.output,
        db_records=db_records,
        files_to_backup=args.files,
        tombstones=tombstones,
        expiry_days=args.expiry_days,
    )


if __name__ == "__main__":
    main()


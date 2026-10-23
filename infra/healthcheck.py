"""Deployment and service readiness probe for BrandGuard."""
import argparse
import logging
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

# Ensure packages/ is resolvable even when not installed in system site-packages
_root = Path(__file__).resolve().parent.parent
if str(_root / "packages") not in sys.path:
    sys.path.insert(0, str(_root / "packages"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("brandguard.healthcheck")



def check_api(url: str, timeout: float = 5.0) -> bool:
    """Checks if the API readiness endpoint returns HTTP 200."""
    try:
        req = urllib.request.Request(f"{url.rstrip('/')}/api/v1/health/ready")
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError, ConnectionRefusedError) as e:
        logger.warning(f"API readiness probe failed: {e}")
        return False



def check_database(db_url: str) -> bool:
    """Checks if database is accessible."""
    try:
        from sqlalchemy import create_engine, text
        engine = create_engine(db_url, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception as e:
        logger.warning("Database readiness probe failed: %s", type(e).__name__)
        return False


def check_engine() -> bool:
    """Checks that review engine modules load cleanly."""
    try:
        from review_engine.extraction import extract
        from review_engine.deterministic import check
        res = extract(b"healthcheck probe", "text/plain", {})
        return res.status == "complete"
    except Exception as e:
        logger.warning(f"Engine probe failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="BrandGuard health and readiness probe")
    parser.add_argument("--api-url", default=os.environ.get("API_URL", "http://localhost:8000"))
    parser.add_argument("--db-url", default=os.environ.get("DATABASE_URL"))
    args = parser.parse_args()

    engine_ok = check_engine()
    api_ok = check_api(args.api_url) if args.api_url else False
    db_ok = check_database(args.db_url) if args.db_url else False

    logger.info(f"Health Status: Engine={engine_ok}, API={api_ok}, DB={db_ok}")

    if not engine_ok or not api_ok or not db_ok:
        sys.exit(1)
    logger.info("All readiness probes passed.")
    sys.exit(0)


if __name__ == "__main__":
    main()

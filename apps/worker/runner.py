"""Durable Background Queue Worker Runner for BrandGuard.
Consumes jobs from PostgreSQL jobs queue with SKIP LOCKED row-level leases.
"""
import argparse
import logging
import os
import signal
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from apps.worker.adapter import create_engine_checker

# Configure safe logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("brandguard.worker")


def get_reviewer():
    """Instantiates NebiusReviewer if configured in environment, else returns disabled reviewer stub."""
    try:
        from brandguard.semantic import NebiusReviewer, ProviderConfig
        config = ProviderConfig.from_env()
        return NebiusReviewer(config)
    except Exception as e:
        logger.warning(f"Semantic reviewer not configured ({e}). Running deterministic-only mode.")
        class DisabledReviewer:
            class Config:
                model = "disabled"
            config = Config()
            async def review(self, *args, **kwargs):
                from brandguard.orchestration import disabled_semantic
                return disabled_semantic("provider_unconfigured")
        return DisabledReviewer()


def run_worker_loop(engine, reviewer, checker, poll_interval: float = 1.0, once: bool = False):
    """
    Core worker execution loop.
    Polls and claims jobs atomically via process_one.
    """
    logger.info("BrandGuard Worker daemon started. Listening for review jobs...")
    running = True

    def _handle_signal(signum, frame):
        nonlocal running
        logger.info("Shutdown signal received. Finishing active job and stopping...")
        running = False

    try:
        signal.signal(signal.SIGINT, _handle_signal)
        signal.signal(signal.SIGTERM, _handle_signal)
    except (ValueError, AttributeError):
        # On Windows, some signals may not be bindable
        pass

    try:
        from brandguard.orchestration import process_one
    except ImportError:
        logger.error("Failed to import brandguard.orchestration. Ensure PYTHONPATH includes apps/api.")
        return

    while running:
        try:
            processed = process_one(engine, reviewer, checker=checker)
            if once:
                logger.info("Single-job execution (--once) complete.")
                break
            if not processed:
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            logger.info("Worker interrupted by user.")
            break
        except Exception as e:
            # Safe logging: log exception type without leaking sensitive document content
            logger.error(f"Worker encountered unexpected error: {type(e).__name__}")
            if once:
                break
            time.sleep(poll_interval)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Process at most one job and exit.")
    parser.add_argument("--interval", type=float, default=1.0, help="Polling interval in seconds.")
    args = parser.parse_args()

    # Load root .env
    root_env = Path(__file__).resolve().parents[2] / ".env"
    if root_env.exists():
        load_dotenv(root_env)

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        logger.error("DATABASE_URL environment variable is required.")
        sys.exit(1)

    engine = create_engine(db_url, pool_pre_ping=True)
    reviewer = get_reviewer()

    try:
        run_worker_loop(engine, reviewer, checker=create_engine_checker, poll_interval=args.interval, once=args.once)
    finally:
        engine.dispose()
        logger.info("Worker terminated cleanly.")


if __name__ == "__main__":
    main()

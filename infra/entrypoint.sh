#!/bin/sh
# Legacy all-in-one container (API + embedded worker). Production uses render.yaml:
# migrations run once as the pre-deploy command and the worker is its own service.
set -e

echo "[BrandGuard] Running database migrations..."
alembic -c apps/api/alembic.ini upgrade head

if [ -n "$SEED_PASSWORD" ]; then
  echo "[BrandGuard] Running initial seed..."
  python -m brandguard.seed || true
fi

if [ "${EMBEDDED_WORKER:-0}" = "1" ]; then
  echo "[BrandGuard] Starting supervised embedded worker..."
  # Restart the worker if it exits; the heartbeat makes an outage visible either way.
  ( while true; do python -m apps.worker --interval 1 || true; sleep 2; done ) &
fi

echo "[BrandGuard] Starting FastAPI server on port ${PORT:-8000}..."
exec uvicorn brandguard.main:create_app --factory --host 0.0.0.0 --port "${PORT:-8000}"

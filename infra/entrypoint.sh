#!/bin/sh
set -e

echo "[BrandGuard] Running database migrations..."
alembic -c apps/api/alembic.ini upgrade head

if [ -n "$SEED_PASSWORD" ]; then
  echo "[BrandGuard] Running initial seed..."
  python -m brandguard.seed || true
fi

echo "[BrandGuard] Starting background worker..."
python -m apps.worker --interval 1 &

echo "[BrandGuard] Starting FastAPI server on port ${PORT:-8000}..."
exec uvicorn brandguard.main:create_app --factory --host 0.0.0.0 --port "${PORT:-8000}"

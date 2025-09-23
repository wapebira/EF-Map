#!/usr/bin/env bash
set -euo pipefail

TAG="[worldapi-cron]"
LOCK_FILE="/tmp/worldapi_${PIPELINE_NAME:-default}.lock"
PY_DIR="/app/worldapi_pipeline"
PY_ENTRY="$PY_DIR/worldapi_pipeline.py"
PY_STUB="$PY_DIR/sel_names_stub.py"

echo "$TAG tick $(date -Is) starting"

# Quick sanity for entrypoint
if [ ! -f "$PY_ENTRY" ]; then
  echo "$TAG error: pipeline entry not found at $PY_ENTRY" >&2
  exit 1
fi

# Optional DB readiness test (do not fail the entire loop if pg_isready missing)
if command -v pg_isready >/dev/null 2>&1; then
  if ! pg_isready -h "${POSTGRES_HOST:-postgres}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-user}" -t 5 >/dev/null; then
    echo "$TAG warn: postgres not ready (host=${POSTGRES_HOST:-postgres} port=${POSTGRES_PORT:-5432})" >&2
  fi
fi

# Ensure state dir exists (dlt will also create if missing)
mkdir -p "${DLT_DATA_DIR:-/app/.dlt}"

# Run with non-blocking lock to avoid overlap; emit duration
start_ts=$(date +%s)
# Run from pipeline directory to align dlt's working dir expectations
if flock -n "$LOCK_FILE" -c "cd $PY_DIR && { [ -f $PY_STUB ] && echo '$TAG stub preflight' && python $PY_STUB || true; } && python $PY_ENTRY"; then
  status=0
else
  status=$?
fi
dur=$(( $(date +%s) - start_ts ))

if [ "$status" -eq 0 ]; then
  echo "$TAG done status=0 duration_s=$dur"
else
  case "$status" in
    1|65)
      # flock commonly returns 1 (busy). Some builds use 65 for EAGAIN.
      echo "$TAG skip overlap status=$status duration_s=$dur"
      ;;
    *)
      echo "$TAG fail status=$status duration_s=$dur" >&2
      ;;
  esac
fi

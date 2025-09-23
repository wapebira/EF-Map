# [DEPRECATED] Local Indexer Orchestrator (auto-start)

This local SQLite-based indexer has been deprecated in favor of the Primordium pg-indexer (chain → Postgres). See `docs/DEPRECATIONS.md`.

This orchestrator starts and supervises the local indexer components so you don’t need to run scripts manually.

Components:
- status_server (default http://127.0.0.1:8736)
- metrics_server (default http://127.0.0.1:8733)
- control_server (default http://127.0.0.1:8799)
- ingest_raw (detached; writes to data/status/history)
- decode_apply (detached; writes to data/local-indexer-decode-*.json)

Quick start (Windows/PowerShell):
- npm run indexer:start
- Open http://127.0.0.1:8733/ (dashboard) and/or http://127.0.0.1:8736/ (status)
- Stop everything: npm run indexer:stop

Health endpoints:
- Orchestrator: http://127.0.0.1:8798/health
- Metrics: http://127.0.0.1:8733/api/health
- Status: http://127.0.0.1:8736/api/health
- Control: http://127.0.0.1:8799/health

Logs:
- scratch/orchestrator.log (per-process supervision log)
- scratch/status_server.out|err.log
- data/ingest_raw.out|err.log

Ports can be changed via env before start_all.ps1: STATUS_PORT, PORT (metrics), CONTROL_PORT, ORCH_PORT.

Troubleshooting:
- If ports are busy, run npm run indexer:stop then npm run indexer:start.
- If metrics shows RPC: disabled, set RPC_URL env before start.
- Decode starts once data/local-indexer.db exists.
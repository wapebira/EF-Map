# [DEPRECATED] Local Indexer Dashboard (Read-only)

Deprecated in favor of Grafana dashboards over the Primordium pg-indexer. See `docs/DEPRECATIONS.md`.

- Separate process; does not modify ingestion.
- Opens SQLite DB in read-only mode; short cache window.
- Canonical URL: http://127.0.0.1:8733 (use the starter below). If you run the server directly, default is 8731 unless PORT is set.

Env vars:
- PORT: default 8731 (8733 when using `start_metrics.js`)
- DB_PATH: path to local.db (if omitted, best-effort autodetect .db in repo root)
- DECODED_DB_PATH: path to decoded DB (defaults to `data/local-indexer-decoded.db`)
- ERR_LOG: defaults to `data/ingest_raw.err.log`
- STATUS_FILE / HISTORY_FILE: local status snapshots used for ingest rate and ETA
- RPC_URL: optional; used for chain head/latency. If unset, the server tries to auto-detect from `docs/decision-log.md`.

Run (Windows PowerShell):
- node tools/local-indexer/start_metrics.js   # binds 127.0.0.1:8733
- Or: node tools/local-indexer/metrics_server.js   # binds 8731 by default

Endpoints:
- GET /api/health
- GET /api/summary
- GET /api/series/tput | /api/series/errors | /api/series/lag
- GET /api/alerts
- GET /api/shards (currently empty)
- GET /api/decoded-dataset
- GET /api/erc20-stats | /api/erc721 | /api/erc1155
- GET /api/mud (progress)
- GET /api/mud-table-stats
- GET /api/mud-latest
- GET /api/mud-typed
- GET /api/mud-ecs (unified ECS coverage)
- GET /api/mud-needs-decoding (tables with latest/values but 0 typed rows)

Static UI:
- / → dashboard.html

Notes:
- If DB is locked, the server returns the last cached snapshot and marks UI as stale.
- No writes are performed; PRAGMAs are session-only.
- Health response includes `rpcSource` indicating how RPC was configured: `env`, `detected`, or `disabled`.
# PG Adapter (Isolated)

Purpose: mirror metrics endpoints from a Postgres-backed MUD indexer without touching the existing local-indexer.

Isolation:
- All files live under `tools/pg-adapter/`.
- Root `package.json` only adds new scripts; no changes to current local-indexer files.
- Stop/remove these to fully revert.

Quick start (Windows):
1) Start Postgres (Docker Desktop required):
   - `npm run pg:up`
2) Start adapter:
   - `npm run pg-adapter:start`
3) Verify:
   - Health: http://127.0.0.1:8850/health
   - Summary: http://127.0.0.1:8850/api/summary

Config:
- `PG_URL` (default: `postgres://postgres:postgres@127.0.0.1:5432/ef_indexer`)
- `PG_ADAPTER_PORT` (default: `8850`)

Stop:
- `npm run pg-adapter:stop`
- `npm run pg:down`

Next:
- Implement parity endpoints (/api/mud, /api/mud-typed, etc.) once the Primodium indexer schema is available.

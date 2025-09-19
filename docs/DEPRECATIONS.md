# Repository Deprecations

This document tracks subsystems and files that are deprecated and slated for removal after a short stabilization period. Changes are conservative and reversible; code remains in-repo for historical reference until final purge.

## Local SQLite Indexer (Deprecated)
- Path: `tools/local-indexer/**/*`, `data/local-indexer*.db`, `data/local-indexer-*.json`, `data/local-snapshots/**/local-indexer.db`
- Status: Deprecated in favor of Primordium pg-indexer (chain → Postgres). Grafana is the canonical dashboard.
- Action: Do not start or modify these scripts. Existing npm `local:*` and `indexer:*` scripts are retained for historical reference but are considered deprecated.
- Safe cleanup: Large `.db` artifacts were removed from working copies; code remains until final purge.

## Cloudflare D1 Indexer (Deprecated)
- Files: `archiver_worker.js`, `cron_worker.js`, `indexer-worker.js`, `cron-indexer-worker.js`, `indexer-cron.wrangler.jsonc`, `cron-wrangler.jsonc`
- Status: Deprecated. The repository’s Cloudflare Pages Worker remains primary for app `/api/*` (KV-backed shares & usage). Any D1-based indexer endpoints are not in active use.
- Action: Keep files for now; no production bindings rely on them. Remove in a future cleanup pass.

## World API ETL (Active)
- Files: `tools/worldapi-cron/**/*`, `tools/worldapi-pipeline/**/*`
- Status: Active. This is the current dlt-based ingestion for World API resources with per-endpoint cron.
- Note: Decision log indicates this is the second iteration (prior ad-hoc scheduled task(s) existed; see entry on 2025-09-14 and related pauses).

— Last updated: 2025-09-18

# Repository Deprecations

This document tracks subsystems that are no longer part of the active Cloudflare-first stack. Deprecated code is staged either in-place (while migration completes) or under the `legacy/` folder for historical reference. All new work must target the Cloudflare Pages + Worker runtime with Primordium as the canonical data source.

## Local SQLite Indexer (Deprecated)
- Path: `tools/local-indexer/**/*`, `data/local-indexer*.db`, `data/local-indexer-*.json`, `data/local-snapshots/**/local-indexer.db`
- Status: Deprecated in favor of Primordium pg-indexer (chain → Postgres). Grafana is the canonical dashboard.
- Action: Do not start or modify these scripts. Existing npm `local:*` and `indexer:*` scripts are retained for historical reference but are considered deprecated.
- Safe cleanup: Large `.db` artifacts were removed from working copies; code remains until final purge.
- Legacy mirror: high-level documentation and recovery procedure live in `legacy/README.md`.

## Cloudflare D1 Indexer (Deprecated)
- Files: `legacy/d1-indexer/*` (previously `archiver_worker.js`, `cron_worker.js`, `indexer-worker.js`, `cron-indexer-worker.js`, `indexer-cron.wrangler.jsonc`, `cron-wrangler.jsonc`)
- Status: Deprecated. The Cloudflare Pages Worker (`_worker.js`) remains primary for app `/api/*` (KV-backed shares, usage, snapshots). No D1-backed endpoints are deployed.
- Action: Keep files in `legacy/` only for historical context; do not rebind or deploy.
- Notes: If an emergency rollback ever requires these workers, follow the recovery process documented in `legacy/README.md` and append a decision log entry.

## World API ETL (Active)
- Files: `tools/worldapi-cron/**/*`, `tools/worldapi-pipeline/**/*`
- Status: Active. This is the current dlt-based ingestion for World API resources with per-endpoint cron.
- Note: Decision log indicates this is the second iteration (prior ad-hoc scheduled task(s) existed; see entry on 2025-09-14 and related pauses).

## Netlify Build (Archived)
- Files: `legacy/netlify/**/*`
- Status: Archived. Netlify build + function scaffolding retained solely for historical reference after Cloudflare migration (2025-09-07).
- Action: Do not modify. Any future hosting or worker changes must be implemented through Cloudflare Pages + Worker bindings.

— Last updated: 2025-10-03

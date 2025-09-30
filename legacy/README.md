# Legacy Code Archive

**Status**: Historical reference only - DO NOT MODIFY

This directory contains deprecated subsystems that have been superseded by newer implementations. Files are retained for historical context and potential recovery scenarios but are not part of the active codebase.

---

## Contents

### 1. Local SQLite Indexer (`local-indexer/`)
**Deprecated**: 2025-09-18  
**Replaced by**: Primordium pg-indexer (chain → Postgres) + Grafana dashboards

**What it was**: Node.js-based indexer that read EVM RPC events and stored decoded state in local SQLite database.

**Why deprecated**: 
- Postgres-backed solution provides better query performance
- Grafana offers superior observability vs. custom dashboard
- Primordium indexer is actively maintained upstream

**Related docs**: See `docs/DEPRECATIONS.md` and decision log entries around 2025-09-14 to 2025-09-18.

---

### 2. D1 Indexer Workers (`d1-indexer/`)
**Deprecated**: 2025-09-18  
**Replaced by**: Primordium pg-indexer (local) + World API cron (for REST-only data)

**What it was**: Cloudflare D1-backed indexer with scheduled workers (`archiver_worker.js`, `cron_worker.js`, `indexer-worker.js`, `cron-indexer-worker.js`).

**Why deprecated**:
- D1 has strict query limits (not suitable for high-volume indexing)
- Primordium indexer provides better schema evolution
- Reduced operational complexity (one indexer instead of two)

**Related files** (moved here):
- `archiver_worker.js`
- `cron_worker.js`
- `indexer-worker.js`
- `cron-indexer-worker.js`
- `indexer-cron.wrangler.jsonc`
- `cron-wrangler.jsonc`

**Important**: The main Cloudflare Pages Worker (`worker.js`, `_worker.js`) remains active and serves `/api/*` endpoints for shares, usage stats, and snapshots. Only the D1-based indexer endpoints are deprecated.

---

## Migration Notes

If you need to reference old implementation details:
1. Check git history (files existed at root prior to this move)
2. Search decision log for migration rationale
3. Consult `docs/DEPRECATIONS.md` for boundaries

**Do NOT**:
- Attempt to run these workers/services
- Copy code from here into active paths without explicit approval
- Assume these represent current best practices

---

## Recovery Process

If an emergency requires reverting to legacy systems:
1. Open an issue documenting the failure mode
2. Restore files from this directory to root (via git)
3. Update `docs/DEPRECATIONS.md` to mark as temporarily active
4. Add decision log entry explaining temporary reactivation

---

Last Updated: 2025-10-01

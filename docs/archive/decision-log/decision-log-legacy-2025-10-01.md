# Decision Log (Legacy / Archived on 2025-10-01)

This file contains entries not directly relevant to the current setup (Primordium indexer + World API via Docker, Postgres, Grafana, Cloudflare website/KV).
They are preserved for historical context: legacy Cloudflare D1 indexer, cron/scheduled ingestion, raw_logs/store_all/decode, shadow/gap scan, ABI/topic-map, and Netlify-era notes.

## 2025-09-10
- Added lightweight indexer health endpoint, finalized idempotency labelling, and ensured Stats page shows “today” synthetic entries. Builds ✅; preview smoke covered `/api/indexer-health`.

# Archived: Indexer Resilience Plan

This document is archived to keep the active docs focused on our current stack.

See the preserved original at:
- docs/archive/indexer-legacy/indexer_resilience_plan.md

Why archived:
- We pivoted to a snapshot‑first, KV‑backed overlays approach (Primordium World API → Postgres → Grafana; Cloudflare Pages + Worker + KV).
- The D1‑centric ingestion plan (heartbeat/watchdog/leasing/adaptive windows) isn’t part of the current path.

For current architecture/decisions, read:
- docs/decision-log.md (curated)
- _worker.js and exporter/overlay notes referenced there.

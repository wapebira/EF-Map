# Archived: Dynamic Player Structures & Smart Gates – Planning

This document is archived to keep the active docs focused on our current stack.

See the preserved original at:
- docs/archive/indexer-legacy/dynamic_structures_plan.md

Why archived:
- We pivoted to a snapshot‑first, KV‑backed overlays approach (Primordium World API → Postgres → Grafana; Cloudflare Pages + Worker + KV).
- The D1‑centric indexer and decode path described here are not in use.

For up‑to‑date architecture/decisions, read:
- docs/decision-log.md (curated)
- _worker.js and exporter/overlay notes referenced there.

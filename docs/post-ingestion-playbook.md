# Archived: Post‑Ingestion Playbook

This document is archived to keep the active docs focused on our current stack.

See the preserved original at:
- docs/archive/indexer-legacy/post-ingestion-playbook.md

Why archived:
- We pivoted to a snapshot‑first, KV‑backed overlays approach (Primordium World API → Postgres → Grafana; Cloudflare Pages + Worker + KV).
- The D1 decode/materialize & retention strategy is deferred and not part of the current app path.

For current architecture/decisions, read:
- docs/decision-log.md (curated)
- _worker.js and exporter/overlay notes referenced there.

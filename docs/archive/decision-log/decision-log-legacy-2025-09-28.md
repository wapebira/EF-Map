# Decision Log (Legacy / Archived on 2025-09-28)

This file contains entries not directly relevant to the current setup (Primordium indexer + World API via Docker, Postgres, Grafana, Cloudflare website/KV).
They are preserved for historical context: legacy Cloudflare D1 indexer, cron/scheduled ingestion, raw_logs/store_all/decode, shadow/gap scan, ABI/topic-map, and Netlify-era notes.

## 2025-09-28 – Atlas gate luminance clamp
- Goal: Bring atlas-mode stargate lines down to the same perceived intensity as the neutral grey and reachability red renders by clamping color channels and easing shader boost/opacity when the atlas palette is active.
- Files: `eve-frontier-map/src/App.tsx`
- Diff: +301 / -42
- Risk: medium (shader uniform tuning + atlas coloring pipeline)
- Gates: typecheck ✅ `npm run build` | build ✅ `npm run build` | smoke ➖ (awaiting atlas preview confirmation)

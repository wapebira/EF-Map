# Decision Log (Legacy / Archived on 2025-09-27)

This file contains entries not directly relevant to the current setup (Primordium indexer + World API via Docker, Postgres, Grafana, Cloudflare website/KV).
They are preserved for historical context: legacy Cloudflare D1 indexer, cron/scheduled ingestion, raw_logs/store_all/decode, shadow/gap scan, ABI/topic-map, and Netlify-era notes.

## 2025-09-27 – Routing start field sync
- Goal: Keep the manual start-system inputs in P2P Routing, Scout Optimizer, and Reachability aligned so edits in one surface in the others.
- Files: `eve-frontier-map/src/App.tsx`, `eve-frontier-map/src/components/P2PRouting/P2PRouting.tsx`, `eve-frontier-map/src/components/ScoutOptimizer/ScoutOptimizer.tsx`, `eve-frontier-map/src/components/Routing/RoutingPanel.tsx`.
- Diff: ~120 LoC adjusted.
- Risk: medium (shared routing state wiring).
- Gates: typecheck ✅ (via build) | build ✅ `npm run build` | smoke ➖ (not run; manual UI sync pending user validation).
## 2025-09-27 – Routing tab persistence & session start sync
- Goal: Keep routing sub-panels mounted so manual start-system edits stay mirrored across P2P, Scout, and Reachability, and persist the Scout "Return to Start" toggle for the active session.
- Files: `eve-frontier-map/src/components/Routing/RoutingPanel.tsx`, `eve-frontier-map/src/components/P2PRouting/P2PRouting.tsx`, `eve-frontier-map/src/components/ScoutOptimizer/ScoutOptimizer.tsx`, `eve-frontier-map/src/App.tsx`.
- Diff: ~90 LoC adjusted (tab containers + setter persistence).
- Risk: medium (shared routing UI state).
- Gates: typecheck ✅ (via build) | build ✅ `npm run build` | smoke ➖ (manual tab-switch verification pending).
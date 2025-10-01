<div align="center">
    <h1>EVE Frontier Interactive Map</h1>
    <p><strong>Client‑side 3D starmap, routing & optimization tools, reachability analysis and usage stats for EVE Frontier.</strong></p>
    <sub>React + TypeScript + Vite • Three.js custom shaders • Web Workers • Cloudflare Pages + Worker (KV) • Primordium pg-indexer (optional, local) • Zero PII instrumentation</sub>
</div>

---

## Contents
1. Overview  
2. Feature Highlights  
3. Architecture  
4. Directory Map  
5. Quick Start (Frontend)  
6. Data Generation Pipeline  
7. Reachability & Routing  
8. Usage Metrics & Privacy  
9. Development Workflow  
10. Indexer (optional)  
11. Deployment Notes  
12. Contributing  
13. License / Attribution

---

## 1. Overview
This repository contains two loosely coupled parts:

* **Map / App Frontend (`eve-frontier-map/`)** – A performant WebGL (Three.js) visualization with routing (A*/Dijkstra), ship jump vs. gate differentiation, scout optimization, reachability bubble + dimming, cinematic mode, shareable routes, usage stats and optional station overlays.
* **Data Preparation Scripts (root)** – Python utilities to transform raw universe exports into a compact SQLite + auxiliary JSON assets consumed by the frontend.

Optional subsystem:

* **Primordium Indexer (optional, local)** – Containerized Primordium pg-indexer → Postgres pipeline for longitudinal diagnostics, snapshot generation, and Grafana dashboards. See `docs/primordium-indexer.md`. Cloudflare D1 indexers are archived; the app runs fully client-side even without this pipeline.

Raw extraction of game files is performed by a separate toolkit:  
➡ https://github.com/VULTUR-EveFrontier/eve-frontier-tools  
This repo focuses on *transforming* + *serving* that data and implementing interactive features.

## 2. Feature Highlights
* Fast point‑to‑point routing (A* or Dijkstra) with waypoint chaining & optional order heuristic.
* Ship jump vs. stargate hop visual differentiation (dashed inner core on ship arcs).
* Smart Gates: routing modes (none / public / authorized), directional public edges, live‑link filtering, and origin‑side in‑game showinfo hyperlinks in route notes; SG hops rendered with chevrons.
* Scout baseline & multi‑worker optimization with savings metrics (lightyears saved & distributions).
* Reachability analysis: unreachable dimming, in‑range highlighting, animated range bubble with camera framing.
* Stargate selection gradient shader (accent fade ~2/3 length) with precedence rules (region highlight > selection > unreachable override).
* Cinematic mode (global toggle) tracking entry/time independent of normal mode visuals.
* Station overlay (optional) with intelligent scaling, focus hysteresis & depth‑correct sprites.
* Rich anonymous usage statistics & trend charts (activation funnel, share/copy rates, optimization impact, distributions).
* Share links (compressed route state) via short IDs stored in serverless key‑value blob storage.
* Context menu shortcut: open selected system on evedataco.re for quick external lookups.
* Theme accent variants (orange / blue) – all shaders normalize brightness to keep visual balance.

## 3. Architecture
| Layer | Purpose | Key Tech |
|-------|---------|----------|
| Frontend | 3D rendering, UI state, routing orchestration | React, TypeScript, Three.js, custom GLSL shaders |
| Workers | Heavy algorithms off main thread | Web Workers (`routing_worker.ts`, `scout_optimizer_worker.ts`, others) |
| Data Access | Lazy open + query prebuilt SQLite in-browser | `sql.js` (WASM) wrapped by `lib/sql.ts` |
| Serverless | Shares & usage metrics APIs | Cloudflare Pages Worker (`/api/*`) using KV (EF_SHARES / EF_STATS) |
| Indexer (optional) | Longitudinal ingest + diagnostics | Primordium pg-indexer → Postgres (local) • Grafana dashboards |
| Instrumentation | Anonymous event batching | `src/utils/usage.ts` batching + server whitelist in `usage-event.js` |

Persistence: All share + usage data lives in Cloudflare KV namespaces (EF_SHARES, EF_STATS). Optional longitudinal diagnostics rely on the Primordium pg-indexer feeding Postgres; Cloudflare D1 schemas remain only as historical drafts under `eve-frontier-map/migrations/`.

## 4. Directory Map
```
root/
    README.md
    create_map_data.py        # Rebuild consolidated SQLite + JSON assets
    filter_map_data.py        # Optional pruning / visibility filters
    verify_db.py              # Optional validation pass for generated SQLite
    docs/
        decision-log.md       # Running architectural / feature decisions
        CLI_WORKFLOWS.md      # Canonical Wrangler + PowerShell command recipes
        LLM_TROUBLESHOOTING_GUIDE.md # End-to-end architecture & verification matrix
        DEPRECATIONS.md       # Archived systems / guardrails
        initiatives/          # Living roadmaps (Smart Gates, Overlay, Data Exposure, ...)
    eve-frontier-map/
        src/App.tsx           # Core scene + global state + instrumentation bridges
        src/components/       # Panels & UI modules (Routing, Scout, Reachability, Stats, ...)
        src/utils/usage.ts    # Client event batching (sole origin of usage events)
        workers/              # Routing / optimization workers
        public/map_data_v2.db # Generated SQLite universe data (current; older builds may reference map_data.db)
        _worker.js            # Cloudflare Pages Worker for `/api/*`
    tools/
        snapshot-exporter/    # Smart Gate & structure snapshot publishing scripts
        local-indexer/        # Legacy helpers (reference only)
    migrations/               # Experimental schema drafts (historical D1 + future storage)
```

## 5. Quick Start (Frontend)
Prereqs: Node 18+ (LTS recommended), npm.

```bash
cd eve-frontier-map
npm install
npm run dev   # Vite dev server
# open http://localhost:5173 (default) in a modern Chromium / Firefox browser
```

Production build:
```bash
npm run build   # Outputs to dist/
```

## 6. Data Generation Pipeline
Raw extraction lives elsewhere (➡ `eve-frontier-tools`). Once you have updated raw JSONs, run:

```bash
python create_map_data.py   # Build consolidated structures / relational fields
python filter_map_data.py   # Apply hide / pruning rules
python verify_db.py         # Optional validations
```

Outputs: A new / updated `map_data.db` (or versioned `map_data_v2.db` when schema additions like stations are introduced). If schema changes, bump the filename to bust caches & keep backward compatibility.

Station data: When `map_data_v2.db` contains `stations` table `{ system_id TEXT PRIMARY KEY, station_count INTEGER }`, the frontend auto-enables the toggle (default off) without needing code changes.

## 7. Reachability & Routing
* Pathfinding: Gate network + optional ship jump arcs (cost model switchable: distance (fuel) vs. hops).
* Large ship jumps are rendered as smoothly sampled quadratic curves (adaptive sampling) with dashed ship-only core.
* Caches: Spatial grids & neighbor cache cleared when jump distance cell size changes (see `routing_worker.ts`).
* Reachability Modes: unreachable dimming, in-range accenting, animated bubble. Precedence order ensures region highlighting & planet count modes supersede selection gradient & in-range coloring safely.
* Smart Gates: directional public set, authorized-mode traversal, legend filtering, and live snapshot freshness surfaced in the status badge.

## 8. Usage Metrics & Privacy
* All events emitted only via `usage.ts` (no ad-hoc tracking elsewhere) → prevents double counting.
* Server (`usage-event.js`) whitelists types; unknown events rejected (HTTP 400) and logged in dev.
* Time metrics: client sends sums (e.g., `session_time`, `cinematic_time`, `first_route_delay`) – server aggregates sum + count keys enabling averages in UI.
* No PII / no user identifiers; only aggregate counters & coarse bucket labels.
* Aggregates served via `stats` function; UI (`StatsPage.tsx`) renders charts + derived rates.

## 9. Development Workflow
1. Skim `docs/LLM_TROUBLESHOOTING_GUIDE.md` for context (architecture, verification matrix) before major changes.  
2. Implement feature in isolated module (shader / worker / panel).  
3. Add instrumentation only if a new behavior needs measurement – extend `EVENT_MAP` accordingly.  
4. Run `npm run build` before committing to catch type or bundling issues.  
5. Append notable decisions to `docs/decision-log.md` and mirror cross-repo guardrails when necessary.  
6. Keep public APIs (helpers, global setters like `__efSetCinematic`) stable unless the change is documented and consumers updated.

### Common Scripts
| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server with HMR. |
| `npm run build` | Type check + production build. |
| `npm run preview` | (If added) Preview dist output locally. |

## 10. Indexer (Primordium – optional)
The map runs fully client-side. Teams that need longitudinal diagnostics can run the Primordium pg-indexer → Postgres pipeline locally (containerized) and surface results in Grafana.

Key references:
- `docs/primordium-indexer.md` – setup, container orchestration, environment expectations.
- `docs/CLI_WORKFLOWS.md` – repeatable commands for exporter backfills, KV verification, and Grafana checks.
- `docs/DEPRECATIONS.md` – Cloudflare D1 + legacy local indexers are archived; avoid reviving them.

Notes:
- Grafana (http://localhost:3000) remains the canonical dashboard for chain status (head, lag, per-table counts).
- Snapshot exporters under `tools/snapshot-exporter/` publish Smart Gate and structure data to Cloudflare KV; they expect Primordium tables.
- Legacy helpers under `tools/local-indexer/` are kept only for reference and should not be executed.

## 11. Deployment Notes
Cloud platform: Cloudflare Pages + Worker (primary). `/api/*` is served by the Pages Worker, backed by KV (shares, usage stats).  
Legacy Netlify logic is no longer invoked; remaining files are historical only.

Preview & production deploys rely on Wrangler (see `docs/CLI_WORKFLOWS.md` for full recipes). Example:

```bash
# from eve-frontier-map/
npm run build
# Deploy preview for current branch (uses Pages project config)
wrangler pages deploy dist --branch <your-branch>
```

Rollback Strategy: Revert recent Worker commits & redeploy (no Netlify fallback paths exist in client).  
Encoding Hardening: Worker defensively strips a UTF‑8 BOM before JSON parsing of daily stats snapshots (prevents history gaps if manual KV writes introduce BOM).  
Future: Explore richer analytics via Primordium snapshots (Grafana dashboards) rather than Cloudflare D1; schema drafts for experimental storage live in `eve-frontier-map/migrations/`.

Cache Busting: When DB schema changes, increment filename (e.g., `map_data_v2.db`) and document in decision log. Frontend lazily loads whichever name it expects; avoid breaking existing deployed bundles.

## 12. Contributing
Lightweight guidelines:
* Open an issue (or add to decision log) for substantial feature proposals.
* Keep diffs minimal & localized; avoid broad refactors piggy-backing on feature PRs.
* Maintain shader performance: throttle progress messages in workers (≤5Hz).  
* Add comments for any new global (`window.__efSomething`) and mirror established naming.

## 13. License / Attribution
Project license: See `LICENSE` (MIT unless otherwise specified).  
Raw game data / universe structure is derived from EVE Frontier assets (CCP Games) – this repository redistributes only transformed, non-proprietary derivative metadata suitable for visualization and does not include original proprietary binaries.  
Original extraction tools: https://github.com/VULTUR-EveFrontier/eve-frontier-tools (credit & thanks).  

---
### Quick FAQ
**Why SQLite in the browser?** Fast relational lookups (`sql.js` WASM) + single fetch; avoids large JSON parse overhead & retains schema evolution flexibility.  
**Why separate workers?** Keeps routing / optimization responsive and prevents animation hitching.  
**Is any personal data collected?** No. Only aggregate usage counters and coarse bucket metrics; no IDs or IP storage.  
**Can I regenerate the DB later?** Yes – re-run the Python scripts with updated raw exports; bump DB filename if schema changes.

---
Feel free to open issues for feature requests, visual polish ideas, or performance concerns.

Happy mapping o7

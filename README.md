<div align="center">
    <h1>EVE Frontier Interactive Map</h1>
    <p><strong>Client‑side 3D starmap, routing & optimization tools, reachability analysis and usage stats for EVE Frontier.</strong></p>
    <sub>React + TypeScript + Vite • Three.js custom shaders • Web Workers • Cloudflare Pages + Worker (KV + optional D1) • Zero PII instrumentation</sub>
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

* **Indexer (D1‑backed, optional)** – A lightweight ingestion + archival pipeline used for longitudinal usage snapshots and diagnostics. It keeps the primary D1 small via automated archival rollover and is surfaced in a small dashboard inside the app. If you don’t need it, you can ignore this entirely – the map works fully client‑side.

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
| Indexer (optional) | Longitudinal ingest + cleanup | Cloudflare D1 (primary + archival rollover) + scheduled Workers |
| Instrumentation | Anonymous event batching | `src/utils/usage.ts` batching + server whitelist in `usage-event.js` |

Persistence: All share + usage data lives in Cloudflare KV namespaces (EF_SHARES, EF_STATS). An optional Indexer uses Cloudflare D1 (primary + archival rollover). Schema draft is under `migrations/`.

## 4. Directory Map
```
root/
    create_map_data.py        # Consolidate & transform raw exports -> SQLite/JSON inputs
    filter_map_data.py        # Post-process filters (hiding regions, etc.)
    verify_db.py              # Sanity checks for generated DB
    docs/decision-log.md      # Running architectural / feature decisions
    wrangler.jsonc            # Cloudflare Pages/Worker config (root)
    archiver_worker.js        # (optional) scheduled archival worker
    cron_worker.js            # (optional) scheduled maintenance worker
    wrangler.*.jsonc          # (optional) worker configs (indexer/archiver)
    eve-frontier-map/         # Frontend app (see below)
        src/
            App.tsx               # Core scene + global state + instrumentation bridges
            components/           # Panels & UI modules (Routing, Scout, Reachability, Stats, etc.)
            modules/RouteRibbon.ts# Custom ribbon geometry + shaders
            utils/usage.ts        # Client event batching (sole origin of usage events)
            workers/              # Optimization / routing workers
        _worker.js             # Pages Worker for `/api/*` (KV + optional D1/indexer endpoints)
        migrations/             # D1 schema drafts (future analytical/indexer work)
        public/map_data.db      # Generated SQLite universe data (do not edit manually)
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

## 8. Usage Metrics & Privacy
* All events emitted only via `usage.ts` (no ad-hoc tracking elsewhere) → prevents double counting.
* Server (`usage-event.js`) whitelists types; unknown events rejected (HTTP 400) and logged in dev.
* Time metrics: client sends sums (e.g., `session_time`, `cinematic_time`, `first_route_delay`) – server aggregates sum + count keys enabling averages in UI.
* No PII / no user identifiers; only aggregate counters & coarse bucket labels.
* Aggregates served via `stats` function; UI (`StatsPage.tsx`) renders charts + derived rates.

## 9. Development Workflow
1. Implement feature in isolated module (shader / worker / panel).  
2. Add instrumentation only if a new behavior needs measurement – extend `EVENT_MAP` accordingly.  
3. Run `npm run build` before committing to catch type or bundling issues.  
4. Update `docs/decision-log.md` for non-trivial architectural or UX decisions.  
5. Keep public APIs (helpers, global setters like `__efSetCinematic`) stable unless log documents change & consumers updated.

### Common Scripts
| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server with HMR. |
| `npm run build` | Type check + production build. |
| `npm run preview` | (If added) Preview dist output locally. |

## 10. Indexer (Primordium – canonical)
The map works fully client‑side. For chain indexing we now standardize on the Primordium pg-indexer (chain → Postgres) surfaced in Grafana. Previous local/Cloudflare D1 indexer efforts are deprecated; see `docs/DEPRECATIONS.md`.

Notes:
- Grafana is the canonical dashboard for chain status (head, lag, decoded tables, per-table counts).
- Cloudflare Pages Worker remains primary for `/api/*` (shares + usage stats in KV). Any D1 indexer files in this repo are historical only.
- Legacy local indexer scripts (under `tools/local-indexer/`) should not be used; they’re retained temporarily for reference.

Operator docs: See `docs/decision-log.md` entries around 2025‑09‑14 and 2025‑09‑18 for the transition, plus `docs/DEPRECATIONS.md` for boundaries.

## 11. Deployment Notes
Cloud platform: Cloudflare Pages + Worker (primary). `/api/*` is served by the Pages Worker, backed by KV (shares, usage stats).  
Legacy Netlify logic is no longer invoked; remaining files are historical only and have been moved to `legacy/netlify/` pending final deletion.

Preview & production deploys typically use Wrangler. Example (project already configured):

```bash
# from eve-frontier-map/
npm run build
# Deploy preview for current branch (uses Pages project config)
wrangler pages deploy dist --branch <your-branch>
```

Rollback Strategy: Revert recent Worker commits & redeploy (no Netlify fallback paths exist in client).  
Encoding Hardening: Worker defensively strips a UTF‑8 BOM before JSON parsing of daily stats snapshots (prevents history gaps if manual KV writes introduce BOM).  
Future: Optional Cloudflare D1 usage for richer longitudinal analytics / indexing (schema draft in `migrations/001_init.sql`).

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

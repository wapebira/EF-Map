# LLM Agent Troubleshooting & Orientation Guide

**Purpose**: Accelerate LLM agent orientation when troubleshooting or extending the EF-Map project. This document consolidates architecture, component relationships, and common diagnostic paths in one location.

**Target Audience**: LLM agents (GPT-5 Codex or similar) working on behalf of a non-coding operator.

**⚠️ Security Note**: Local development credentials (Postgres, Grafana) are stored in `docs/LOCAL_ENVIRONMENT.md` (gitignored). This document contains only safe-to-commit architectural information and references to that file. Production secrets (Cloudflare tokens, API keys) are managed separately via `wrangler` and environment variables.

**Last Updated**: 2025-10-01

---

## Table of Contents
1. [Quick Start Checklist](#quick-start-checklist)
2. [System Architecture Overview](#system-architecture-overview)
3. [Component Inventory](#component-inventory)
4. [Data Flow Diagrams](#data-flow-diagrams)
5. [Local Development Environment](#local-development-environment)
6. [VS Code Extensions (Use Proactively)](#vs-code-extensions-use-proactively)
7. [Common Troubleshooting Paths](#common-troubleshooting-paths)
8. [Key File Locations](#key-file-locations)
9. [Postgres Database Reference](#postgres-database-reference)
10. [Cloudflare Platform Details](#cloudflare-platform-details)
11. [Glossary](#glossary)

---

## Quick Start Checklist

When you begin a troubleshooting or development session, complete these steps **in order**:

1. **Read foundational guardrails**:
   - `AGENTS.md` (workflow rules, safety boundaries)
   - `.github/copilot-instructions.md` (coding patterns, risk classes)

2. **Scan recent history**:
   - Last 40 lines of `docs/decision-log.md` (recent changes, active initiatives)

3. **Verify local services are running** (if troubleshooting indexer/database):
   - Docker Desktop: `docker ps` (should show Primordium indexer containers)
   - Grafana: http://localhost:3000 (should load dashboard)
   - Postgres: Use VS Code PostgreSQL extension to connect (see [Postgres Reference](#postgres-database-reference))

4. **Identify subsystem**:
   - Frontend/UI issue → `eve-frontier-map/src/components/*`
   - Routing/algorithm → `eve-frontier-map/src/utils/*_worker.ts`
   - API/sharing → `worker.js` (Cloudflare Worker)
   - Indexer/chain data → Docker containers + Postgres
   - Metrics/observability → Grafana dashboards

5. **Use semantic_search** if you need to locate code related to a feature (e.g., "Smart Gate routing mode selection")

---

## System Architecture Overview

EF-Map is a **hybrid client-server system**:

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│  EVE Frontier Game Client (External)                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  EVM Blockchain (Stillness Network)                         │
│  - World Contract: 0x7085f3e652987f656fB8dEE5aA6592197Bb75de8│
│  - Deploy Block: 7288348                                    │
└─────────────────────────────────────────────────────────────┘
           │                                   │
           │ (RPC)                             │ (World API REST)
           ▼                                   ▼
┌──────────────────────┐          ┌───────────────────────────┐
│ Primordium Indexer   │          │ World API (CCP-hosted)    │
│ (Docker: pg-indexer) │          │ Base: world-api-stillness │
│   - postgres         │          │       .live.tech          │
│   - index-write      │          │       .evefrontier.com    │
│   - query-read       │          └───────────────────────────┘
└──────────────────────┘                       │
           │                                   │
           ▼                                   ▼
┌──────────────────────┐          ┌───────────────────────────┐
│ Postgres (local)     │          │ worldapi-cron (Docker)    │
│ Port: 5432           │◄─────────│ - killmails, tribes,      │
│ DB: postgres         │          │   smartcharacters         │
│ User: user/password  │          │ DLT pipeline → Postgres   │
└──────────────────────┘          └───────────────────────────┘
           │
           ▼
┌──────────────────────┐          ┌───────────────────────────┐
│ Grafana (local)      │          │ snapshot-exporter (Docker)│
│ Port: 3000           │          │ Postgres → Cloudflare KV  │
│ Datasource: ef-postgres         │ Keys: smart_gate_links_v1,│
└──────────────────────┘          │       system_overlays_v1  │
                                  └───────────────────────────┘
                                               │
                                               ▼
                                  ┌───────────────────────────┐
                                  │ Cloudflare (Production)   │
                                  │ - Pages (static assets)   │
                                  │ - Worker (_worker.js)     │
                                  │   /api/* endpoints        │
                                  │ - KV Namespaces:          │
                                  │   * EF_SHARES             │
                                  │   * EF_STATS              │
                                  │   * EF_SNAPSHOTS          │
                                  └───────────────────────────┘
                                               │
                                               ▼
                                  ┌───────────────────────────┐
                                  │ End Users (Browsers)      │
                                  │ - React SPA               │
                                  │ - Three.js (WebGL)        │
                                  │ - Web Workers (routing)   │
                                  │ - sql.js (map_data.db)    │
                                  └───────────────────────────┘
```

### Subsystems at a Glance

| Subsystem | Purpose | Tech Stack | Location |
|-----------|---------|------------|----------|
| **Frontend** | 3D map UI, routing, stats | React, TypeScript, Three.js, Vite | `eve-frontier-map/` |
| **Cloudflare Worker** | API endpoints, KV persistence | JavaScript (ES2021) | `worker.js`, `_worker.js` |
| **Primordium Indexer** | Chain event ingestion | Docker, Postgres, MUD indexer | External Docker images |
| **World API Cron** | REST API polling (killmails, tribes) | Node, DLT, Docker | `tools/worldapi-cron/` |
| **Snapshot Exporter** | Postgres → KV publisher | Node, Wrangler, Docker | `tools/snapshot-exporter/` |
| **Grafana** | Observability dashboard | Grafana, Postgres datasource | `tools/grafana/` |
| **Map Data Pipeline** | Python scripts to generate map DB | Python 3.x, SQLite | Root `*.py` files |

---

## Component Inventory

### 1. Frontend (React SPA)

**Directory**: `eve-frontier-map/`

**Key Files**:
- `src/App.tsx` - Root component, global state, cinematic mode, feature toggles
- `src/components/` - UI panels (Routing, Scout, Reachability, Stats, Overlay, etc.)
- `src/utils/usage.ts` - **ONLY** place to emit usage metrics (avoid double-counting)
- `src/utils/routing_worker.ts` - A*/Dijkstra pathfinding worker
- `src/workers/scout_optimizer_worker.ts` - Multi-worker route optimization
- `src/lib/sql.ts` - sql.js WASM wrapper (lazy DB init)
- `public/map_data_v2.db` - SQLite universe data (generated by Python scripts)

**Build Output**: `eve-frontier-map/dist/` (includes `_worker.js` for Cloudflare)

**Dev Server**: `npm run dev` (Vite, port 5173 by default)

**Build Command**: `npm run build` (also run via VS Code task "Build frontend")

---

### 2. Cloudflare Worker (Pages Worker)

**Files**:
- `worker.js` - Primary implementation (2118 lines)
- `_worker.js` - Thin re-export to `worker.js` (consolidation pattern)

**Endpoints** (all `/api/*`):
- **Shares**: `/api/create-share`, `/api/get-share`
- **Usage**: `/api/usage-event`, `/api/stats`, `/api/list-stats`, `/api/usage-flush`
- **Smart Gates**: `/api/smart-gate-links`, `/api/authorized-gates`, `/api/gate-access`
- **Overlays**: `/api/system-overlays`, `/api/structure-snapshot`
- **Tribes**: `/api/tribe-marks`, `/api/tribe-marks/mutate`
- **Player**: `/api/player-profile`
- **Auth**: `/api/auth/nonce`, `/api/auth/verify`, `/api/auth/session`, `/api/auth/logout`
- **World API**: `/api/worldapi-stats`, `/api/worldapi-update`
- **Admin**: `/api/admin-finalize-stale`, `/api/cron-force`
- **Debug**: `/api/debug-kv`, `/api/debug-snapshots`, `/api/debug-rawlogs`, `/api/debug-runs`
- **Indexer** (legacy/unused): `/api/indexer-*` (D1-based, deprecated)

**KV Namespaces** (bindings):
- `EF_SHARES` → `93333a061a734ceca8da9f055cf189d1`
- `EF_STATS` → `cccc1a708dd74aa8aabd91c8bfc33c3f`
- `EF_SNAPSHOTS` → `2af7298532dd4acfbda8bf06020981ba`

**Config**: `wrangler.jsonc` (root) and `eve-frontier-map/wrangler.jsonc` (duplicate, pending consolidation)

**Deploy**:
```powershell
# Preview (feature branch)
wrangler pages deploy dist --project-name ef-map --branch <branch-name>

# Production (main branch, requires explicit approval)
wrangler pages deploy dist --project-name ef-map --branch main
```

---

### 3. Primordium Indexer (Chain → Postgres)

**Purpose**: Decode EVM chain events (MUD World contract) into relational Postgres tables.

**Components** (all Docker containers):
- `postgres` - Postgres 16 database
- `postgres-index-write` - Indexer writer (store-indexer)
- `postgres-query-read` - Reader API (Node service, port 3001 internal)

**Network**: `pg-indexer-reader_indexer-network` (external Docker network)

**Environment Variables** (passed to writer):
- `RPC_HTTP_URL` - Chain RPC endpoint
- `CHAIN_ID` - Numeric chain ID
- `WORLD_ADDRESS` - `0x7085f3e652987f656fB8dEE5aA6592197Bb75de8`
- `START_BLOCK` - `7288348`
- `FOLLOW_BLOCK_TAG` - `finalized` (or `safe`, `latest`)
- `POLLING_INTERVAL` - e.g., `2000` (ms)
- `MAX_BLOCK_RANGE` - e.g., `1000`

**Schema**: MUD decoder auto-creates tables in Postgres schema matching World contract address (e.g., `0x7085f3e652987f656fb8dee5aa6592197bb75de8`).

**Startup Script**: `tools/win/start_pg_indexer_stack.ps1`

**Verify**:
```powershell
docker ps  # Should show 3 containers (postgres, index-write, query-read)
```

---

### 4. World API Cron (REST → Postgres)

**Purpose**: Poll CCP-hosted World API for resources not available on-chain (killmails, tribe membership, character names).

**Compose File**: `tools/worldapi-cron/docker-compose.yml`

**Services**:
- `snapshot-exporter` - Publishes Postgres data to Cloudflare KV
- `worldapi-cron-killmails` - 1-minute polling
- `worldapi-cron-smartcharacters` - 1-minute polling
- `worldapi-cron-tribes` - 30-minute polling
- `worldapi-cron-tribes-details` - 30-minute polling
- `worldapi-cron-tribe-members` - 30-minute polling
- `worldapi-cron-daily` - Types (24-hour polling)

**Network**: Uses `pg-indexer-reader_indexer-network` (shared with Primordium)

**Output**: Postgres tables in `world_api_dlt` dataset (schema per resource).

**Start**:
```powershell
cd tools/worldapi-cron
docker compose up -d
```

**Logs**:
```powershell
docker logs worldapi-cron-killmails-1 --tail 100
```

---

### 5. Snapshot Exporter (Postgres → KV)

**Purpose**: Extract smart gate link directions and system overlays from Postgres, publish to Cloudflare KV for frontend consumption.

**Container**: `snapshot-exporter` (in `worldapi-cron/docker-compose.yml`)

**Environment**:
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` - Postgres connection
- `STRUCTURE_SCHEMA` - World contract address (0x7085...)
- `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `KV_NAMESPACE_ID` - Cloudflare credentials
- `FORCE_REMOTE=1` - Ensures writes go to Cloudflare KV (not local)
- `DRY_RUN=0` - Set to 1 for testing without writes

**Output KV Keys**:
- `EF_SNAPSHOTS/smart_gate_links_v1`
- `EF_SNAPSHOTS/system_overlays_v1`

**Cadence**: Runs continuously (polling interval TBD, likely 5-10 minutes).

**Logs**:
```powershell
docker logs snapshot-exporter-1 --tail 50
```

---

### 6. Grafana Dashboards

**Purpose**: Real-time observability for chain indexer, World API ingestion, and system health.

**Access**: http://localhost:3000

**Login**: See `docs/LOCAL_ENVIRONMENT.md` for default credentials (first-run only)

**Datasource**:
- Name: `ef-postgres`
- Type: PostgreSQL
- Host: `localhost:5432` (or `postgres` from Docker network)
- Database: `postgres`
- User/Password: See `docs/LOCAL_ENVIRONMENT.md`

**Dashboards**:
- `ef_map_overview_dashboard.json` - Chain head vs processed head, lag, table counts
- `world_api_counts_dashboard.json` - World API resource counts
- `world_api_minimal_dashboard.json` - Minimal health check

**Provisioning**: `tools/grafana/provisioning/`

**Start** (if not auto-started):
```powershell
# (Currently no start script; Grafana typically runs as Docker service or desktop app)
# Check if Grafana Docker container exists:
docker ps | grep grafana
```

**Export Dashboard Changes**:
```powershell
# (Recommended script to add: tools/grafana/export_dashboard.ps1)
# Manually: Settings > JSON Model > Copy > Paste to .json file
```

---

### 7. Map Data Pipeline (Python)

**Purpose**: Transform raw game exports into SQLite/JSON consumed by frontend.

**Files**:
- `create_map_data.py` - Main consolidation script
- `filter_map_data.py` - Post-processing filters
- `verify_db.py` - Sanity checks
- `process_labels.py` - Label generation
- `dump_map_to_json.py` - JSON export variant

**Input**: Raw JSON exports from `eve-frontier-tools` repo (external).

**Output**:
- `eve-frontier-map/public/map_data_v2.db` - SQLite (schema v2 includes stations)
- Various JSON files (constellation_labels.json, etc.)

**Run**:
```powershell
python create_map_data.py
python filter_map_data.py
python verify_db.py
```

**Notes**:
- Bump DB filename (e.g., `map_data_v3.db`) when schema changes to bust caches.
- Update frontend reference in code when filename changes.

---

## Data Flow Diagrams

### Frontend Route Rendering

```
User selects origin/destination
         │
         ▼
App.tsx dispatches to P2PRouting.tsx
         │
         ▼
routing_worker.ts (Web Worker)
 - Loads stargate graph from map_data_v2.db (via sql.js)
 - Runs A* or Dijkstra
 - Emits progress messages (throttled <=5Hz)
         │
         ▼
Returns route segments (stargate hops + ship jump arcs)
         │
         ▼
RouteRibbon.ts (Three.js custom geometry)
 - Generates ribbon mesh with gradient shader
 - Differentiates stargate (solid) vs ship jump (dashed core)
         │
         ▼
Rendered in 3D scene
```

### Usage Metrics Flow

```
User interaction (e.g., completes route)
         │
         ▼
Component calls usage.track({ type: 'p2p_route', ... })
         │
         ▼
usage.ts batches events (max 12, flush every 5s)
         │
         ▼
POST /api/usage-event (Cloudflare Worker)
         │
         ▼
worker.js applies event to hourly bucket (in-memory)
         │
         ▼
Every ~15 minutes: flush hourly snapshot to KV
 - EF_STATS/hourly/YYYY-MM-DDTHH.json
 - Compute delta vs previous hourly snapshot
 - Apply delta to daily rollup
 - EF_STATS/daily/YYYY-MM-DD.json
         │
         ▼
Frontend fetches /api/stats?history=7
 - Returns current + 7 days of daily snapshots
         │
         ▼
StatsPage.tsx renders charts
```

### Smart Gate Links Flow

```
Chain event (SmartGateDirection update)
         │
         ▼
Primordium indexer writes to Postgres table
 - Schema: 0x7085f3e652987f656fb8dee5aa6592197bb75de8
 - Table: smart_gate_direction (or similar MUD-generated name)
         │
         ▼
snapshot-exporter queries Postgres every ~5-10 min
         │
         ▼
Publishes JSON to Cloudflare KV
 - Key: EF_SNAPSHOTS/smart_gate_links_v1
         │
         ▼
Frontend loads snapshot on page load
 - GET /api/smart-gate-links (Worker proxies KV)
         │
         ▼
Routing worker integrates SG links into graph
 - Respects mode: none / public / authorized
         │
         ▼
Routes include SG hops (rendered with chevrons)
```

---

## Local Development Environment

### Postgres Connection Details

**⚠️ SECURITY NOTE**: Connection credentials are stored in `docs/LOCAL_ENVIRONMENT.md` (gitignored). This file contains only safe-to-commit reference information.

**Quick Reference** (see `docs/LOCAL_ENVIRONMENT.md` for full details):
- **Host**: `localhost` (from host) or `postgres` (from Docker network)
- **Port**: `5432`
- **Database**: `postgres`
- **User**: See LOCAL_ENVIRONMENT.md
- **Password**: See LOCAL_ENVIRONMENT.md
- **Connection String Pattern**: `postgresql://user:password@localhost:5432/postgres`

**Docker Network**: `pg-indexer-reader_indexer-network`

**Schemas**:
- `0x7085f3e652987f656fb8dee5aa6592197bb75de8` - Primordium indexer (MUD tables)
- `world_api_dlt` - World API cron output (DLT dataset)
- `meta` - Metadata tables (e.g., `chain_head`)

**Common Queries**:
```sql
-- Check chain indexer head
SELECT MAX(block_number) FROM meta.chain_head;

-- Count smart gates
SELECT COUNT(*) FROM "0x7085f3e652987f656fb8dee5aa6592197bb75de8".smart_gate_direction;

-- List tribes
SELECT * FROM world_api_dlt.get_v_2_tribes LIMIT 10;
```

### Docker Containers Expected

When fully operational, you should see:

```
CONTAINER ID   IMAGE                        STATUS    PORTS                    NAMES
<id>           postgres:16-alpine           Up        0.0.0.0:5432->5432/tcp   postgres
<id>           store-indexer:latest         Up                                  postgres-index-write
<id>           store-query:latest           Up        3001/tcp                 postgres-query-read
<id>           ef-worldapi-cron:local       Up                                  worldapi-cron-killmails
<id>           ef-worldapi-cron:local       Up                                  worldapi-cron-smartcharacters
<id>           ef-worldapi-cron:local       Up                                  worldapi-cron-tribes
<id>           ef-snapshot-exporter:local   Up                                  snapshot-exporter
...
```

**Start All**:
```powershell
tools/win/start_docker_desktop.ps1
tools/win/wait_for_docker_ready.ps1
tools/win/start_pg_indexer_stack.ps1
cd tools/worldapi-cron; docker compose up -d
```

**Stop All**:
```powershell
cd tools/worldapi-cron; docker compose down
# (Primordium stack stop command TBD - typically docker compose down in its directory)
```

---

## VS Code Extensions (Use Proactively)

**Installed Extensions** (as of 2025-10-01):

### 1. PostgreSQL (ckolkman.vscode-postgres)
**Purpose**: Browse Postgres schemas, run queries interactively, inspect tables.

**How to Use**:
1. Open PostgreSQL explorer panel (sidebar icon)
2. Add connection (credentials in `docs/LOCAL_ENVIRONMENT.md`):
   - Host: `localhost`
   - Port: `5432`
   - Database: `postgres`
   - User/Password: See LOCAL_ENVIRONMENT.md
3. Browse schemas → tables → right-click → "Select Top 100"

**When to Use**: Prefer this over PowerShell `docker exec -it postgres psql ...` for ad-hoc queries and schema inspection.

---

### 2. Docker (ms-azuretools.vscode-docker)
**Purpose**: Inspect running containers, view logs, attach shells, manage images.

**How to Use**:
1. Open Docker explorer panel
2. Right-click container → "View Logs" or "Attach Shell"
3. Inspect volumes, networks, images

**When to Use**: Faster than CLI for one-off inspections. Use CLI for scripting.

---

### 3. SQLite (alexcvzz.vscode-sqlite)
**Purpose**: Open and query SQLite databases (map_data_v2.db).

**How to Use**:
1. Right-click `eve-frontier-map/public/map_data_v2.db` → "Open Database"
2. Run queries in SQL editor
3. Browse schema

**When to Use**: Verify map data after regenerating DB; inspect table structure.

---

### 4. REST Client (humao.rest-client)
**Purpose**: Test HTTP endpoints via `.http` files.

**How to Use**:
1. Create `test.http` file:
   ```http
   ### Test stats endpoint
   GET https://ef-map.pages.dev/api/stats?history=7
   ```
2. Click "Send Request" above the request

**When to Use**: Quick API testing without writing curl commands.

---

### 5. Chrome DevTools MCP (chrome-devtools)
**Purpose**: Capture browser traces, screenshots, console logs, run automation.

**How to Use** (via Copilot MCP):
- Ask agent: "Launch Chrome and capture a trace of the map loading"
- Agent will use MCP server to automate Chrome

**When to Use**: Performance debugging, visual regression checks.

**Important**: Uses isolated profile (no secrets). Close session when done.

---

### 6. Dev Containers (ms-vscode-remote.remote-containers)
**Purpose**: (Not actively used) Container-based dev environments.

**When to Use**: If we standardize on a dev container config (future).

---

### 7. Grafana Utils (yesoreyeram.grafana) & Grafana (grafana.grafana-vscode)
**Purpose**: Author/edit Grafana dashboard JSON with syntax help.

**When to Use**: Editing dashboard JSON files before importing to Grafana.

---

**Agent Default Behavior**: Always prefer extension UI for inspection tasks. Use CLI only when scripting or automation is required (e.g., CI pipeline, bulk operations).

---

## Common Troubleshooting Paths

### Scenario 1: Map Not Loading / Blank Screen

**Checklist**:
1. Open browser console (F12) → Look for errors
2. Common causes:
   - `map_data_v2.db` failed to load (network error or 404)
   - sql.js WASM initialization failed
   - JavaScript exception in App.tsx or main.tsx

**Diagnostic**:
```javascript
// In browser console:
window.__efDebug = true; // Enable verbose logging (if implemented)
performance.getEntriesByType('resource').filter(r => r.name.includes('map_data'))
```

**Fix**:
- Verify `eve-frontier-map/public/map_data_v2.db` exists
- Check build output: `npm run build` → inspect `dist/` for DB file
- Clear browser cache + hard reload (Ctrl+Shift+R)

---

### Scenario 2: Routing Not Working / Stuck

**Checklist**:
1. Check browser console for worker errors
2. Verify routing_worker.ts loaded:
   ```javascript
   // Console:
   window.performance.getEntriesByType('resource').filter(r => r.name.includes('routing_worker'))
   ```
3. Check spatial cache invalidation (if max jump distance changed):
   - Look for `spatialGrids.clear()` call in worker code

**Diagnostic**:
- Add console.log to routing_worker postMessage handler
- Verify stargate graph loaded from DB
- Test with simple route (same constellation)

**Fix**:
- Rebuild: `npm run build`
- Check for TypeScript errors: `npx tsc --noEmit`
- Ensure worker file bundled in Vite config

---

### Scenario 3: Usage Metrics Not Appearing

**Checklist**:
1. Verify event emitted in `usage.ts`
2. Check Worker EVENT_MAP includes event type
3. Check browser network tab for POST `/api/usage-event` (should be 200)
4. Check Cloudflare KV for updated daily snapshot:
   ```powershell
   wrangler kv key get "daily/2025-10-01.json" --namespace-id cccc1a708dd74aa8aabd91c8bfc33c3f
   ```

**Diagnostic**:
- Console: Look for `[usage]` log messages
- Check for 400 response (unknown event type)
- Verify flush interval (5 seconds)

**Fix**:
- Add event to `worker.js` EVENT_MAP
- Redeploy Worker
- Clear client-side queue (reload page)

---

### Scenario 4: Postgres Connection Refused

**Checklist**:
1. Docker containers running:
   ```powershell
   docker ps | grep postgres
   ```
2. Port 5432 open:
   ```powershell
   Test-NetConnection -ComputerName localhost -Port 5432
   ```
3. Credentials correct (see [Postgres Reference](#postgres-database-reference))

**Diagnostic**:
- Docker logs:
  ```powershell
  docker logs postgres --tail 50
  ```
- VS Code PostgreSQL extension: Try to connect (will show error message)

**Fix**:
- Restart Postgres container:
  ```powershell
  docker restart postgres
  ```
- Check Docker network:
  ```powershell
  docker network inspect pg-indexer-reader_indexer-network
  ```

---

### Scenario 5: Grafana Dashboard Empty / No Data

**Checklist**:
1. Grafana datasource configured (`ef-postgres`)
2. Postgres has data in expected schema:
   ```sql
   SELECT COUNT(*) FROM meta.chain_head;
   ```
3. Dashboard JSON matches current schema

**Diagnostic**:
- Grafana UI: Data Sources → Test (should say "Database Connection OK")
- Check query errors in dashboard panel (hover over panel → Edit → Query Inspector)

**Fix**:
- Re-add datasource with correct credentials
- Re-import dashboard JSON from `tools/grafana/*.json`
- Verify Postgres schema exists (Primordium indexer creates it on first run)

---

### Scenario 6: Smart Gate Links Not Updating

**Checklist**:
1. Primordium indexer running and up-to-date:
   - Grafana: Check "Processed head" vs "Chain head" (should be <10 blocks apart)
2. snapshot-exporter running:
   ```powershell
   docker logs snapshot-exporter --tail 50
   ```
3. Cloudflare KV has recent timestamp:
   ```powershell
   wrangler kv key get "smart_gate_links_v1" --namespace-id 2af7298532dd4acfbda8bf06020981ba | ConvertFrom-Json | Select-Object -Property generatedAt
   ```

**Diagnostic**:
- Check Postgres for recent smart_gate_direction rows:
  ```sql
  SELECT * FROM "0x7085f3e652987f656fb8dee5aa6592197bb75de8".smart_gate_direction
  ORDER BY __lastUpdatedBlockNumber DESC LIMIT 10;
  ```
- Check exporter env vars (FORCE_REMOTE=1, correct KV_NAMESPACE_ID)

**Fix**:
- Restart snapshot-exporter container
- Manually trigger export (if script exists)
- Verify CF_API_TOKEN has KV write permissions

---

### Scenario 7: Cloudflare Worker Returning HTML Instead of JSON

**Checklist**:
1. Worker file copied to `dist/`:
   ```powershell
   Test-Path eve-frontier-map/dist/_worker.js
   ```
2. Deployment included worker:
   ```powershell
   wrangler pages deployment list --project-name ef-map | Select-Object -First 5
   ```
3. Request path is `/api/*` (worker only handles API routes)

**Diagnostic**:
- `curl` with verbose headers:
  ```powershell
  Invoke-WebRequest -Uri "https://ef-map.pages.dev/api/stats" -UseBasicParsing | Select-Object -Property StatusCode, Headers, Content
  ```
- Check `Content-Type: application/json` vs `text/html`

**Fix**:
- Rebuild: `npm run build` (ensure `_worker.js` copy step runs)
- Redeploy:
  ```powershell
  wrangler pages deploy dist --project-name ef-map
  ```

---

## Key File Locations

### Configuration Files
- `wrangler.jsonc` (root) - Cloudflare Pages project config
- `eve-frontier-map/wrangler.jsonc` - Duplicate (pending consolidation)
- `eve-frontier-map/vite.config.ts` - Vite build config (TypeScript, workers, WASM)
- `eve-frontier-map/package.json` - Frontend dependencies + scripts
- `.vscode/settings.json` - VS Code workspace settings (agent mode enabled)
- `.vscode/tasks.json` - Predefined tasks (build, metrics server, etc.)

### Data Files
- `eve-frontier-map/public/map_data_v2.db` - SQLite universe data (generated)
- `all_solarsystems.json`, `stellar_*.json`, `constellation_labels.json` - Auxiliary map data
- `gate_access_preview.json`, `authorized_gates.etag` - Smart gate metadata

### Documentation
- `README.md` - Project overview
- `PROJECT_REQUIREMENTS.md` - Feature spec
- `AGENTS.md` - Agent workflow guardrails
- `.github/copilot-instructions.md` - Coding patterns, risk classes
- `docs/decision-log.md` - Running change log (newest first)
- `docs/DEPRECATIONS.md` - Deprecated subsystems
- `docs/primodium-indexer.md` - Primordium setup guide
- `docs/operations-secrets.md` - Secrets management runbook

### Worker Files
- `worker.js` - Primary Cloudflare Worker implementation
- `_worker.js` - Re-export (consolidation pattern)
- `archiver_worker.js`, `cron_worker.js` - Deprecated (D1 indexer)

### Frontend Entry Points
- `eve-frontier-map/src/main.tsx` - React root
- `eve-frontier-map/src/App.tsx` - Global state + scene
- `eve-frontier-map/index.html` - HTML shell

---

## Postgres Database Reference

### Connection Info
See [Local Development Environment](#local-development-environment) section.

### Key Schemas

#### 1. Primordium Indexer Schema
**Name**: `0x7085f3e652987f656fb8dee5aa6592197bb75de8` (World contract address)

**Key Tables** (MUD auto-generated):
- `smart_gate_direction` - Smart gate link directions (onchain/offline)
- `smart_deployable` - Deployable structures (smart gates, etc.)
- `smart_character` - Character records
- (Other MUD tables depend on World contract schema)

**Metadata Tables**:
- `meta.chain_head` - Latest block seen by indexer
- `meta.cursor` - Indexer state cursor

---

#### 2. World API DLT Schema
**Name**: `world_api_dlt`

**Key Tables**:
- `get_v_2_killmails` - Killmail feed
- `get_v_2_tribes` - Tribe list
- `get_v_2_tribes_details` - Tribe details
- `get_v_2_tribe_members` - Tribe membership
- `get_v_2_smartcharacters` - Character list (names)
- `get_v_2_types` - Item types

**Heartbeat Table**:
- `heartbeat` - Timestamp of last successful DLT run per resource

---

### Common Queries

#### Check Indexer Lag
```sql
SELECT 
  MAX(block_number) AS chain_head,
  (SELECT MAX(__lastUpdatedBlockNumber) FROM "0x7085f3e652987f656fb8dee5aa6592197bb75de8".smart_deployable) AS processed_head,
  MAX(block_number) - (SELECT MAX(__lastUpdatedBlockNumber) FROM "0x7085f3e652987f656fb8dee5aa6592197bb75de8".smart_deployable) AS lag
FROM meta.chain_head;
```

#### Count Smart Gates by Status
```sql
SELECT 
  online,
  COUNT(*) 
FROM "0x7085f3e652987f656fb8dee5aa6592197bb75de8".smart_deployable
WHERE type_name = 'SmartGate' -- (Adjust to actual type field name)
GROUP BY online;
```

#### Recent Killmails
```sql
SELECT * FROM world_api_dlt.get_v_2_killmails
ORDER BY timestamp DESC
LIMIT 10;
```

#### List Tribes with Member Counts
```sql
SELECT 
  t.id,
  t.name,
  COUNT(m.smart_character_id) AS member_count
FROM world_api_dlt.get_v_2_tribes t
LEFT JOIN world_api_dlt.get_v_2_tribe_members m ON t.id = m.tribe_id
GROUP BY t.id, t.name
ORDER BY member_count DESC;
```

---

## Cloudflare Platform Details

### Pages Project
- **Name**: `ef-map`
- **Production Domain**: `https://ef-map.pages.dev` (or custom domain if configured)
- **Preview Pattern**: `https://<branch>.ef-map.pages.dev`

### KV Namespaces

| Binding | Namespace ID | Purpose |
|---------|--------------|---------|
| `EF_SHARES` | `93333a061a734ceca8da9f055cf189d1` | Shared route links (compressed payloads) |
| `EF_STATS` | `cccc1a708dd74aa8aabd91c8bfc33c3f` | Usage metrics (hourly + daily snapshots) |
| `EF_SNAPSHOTS` | `2af7298532dd4acfbda8bf06020981ba` | Smart gate links + system overlays |

### Key Prefixes

**EF_SHARES**:
- `share:<short-id>` - Compressed route state

**EF_STATS**:
- `daily/YYYY-MM-DD.json` - Daily usage rollup
- `hourly/YYYY-MM-DDTHH.json` - Hourly bucket (for incremental flush)
- `schema_version` - Schema version marker

**EF_SNAPSHOTS**:
- `smart_gate_links_v1` - Smart gate link directions
- `system_overlays_v1` - System overlay metadata

### Secrets (Pages Environment Variables)
- `INDEXER_ADMIN_TOKEN` - Admin auth for protected endpoints (deprecated D1 indexer endpoints)

**Add/Update Secrets**:
```powershell
wrangler pages secret put <SECRET_NAME> --project-name ef-map
# Then redeploy
wrangler pages deploy dist --project-name ef-map
```

### Preview Deploy Workflow
```powershell
# 1. Build
cd eve-frontier-map
npm run build

# 2. Deploy preview
wrangler pages deploy dist --project-name ef-map --branch feature-xyz

# 3. Test at preview URL
# https://feature-xyz.ef-map.pages.dev

# 4. Merge to main after approval (triggers production deploy if CI configured)
```

---

## Glossary

| Term | Definition |
|------|------------|
| **Primordium Indexer** | Third-party MUD indexer (store-indexer) that reads EVM chain events and writes to Postgres. |
| **World API** | CCP-hosted REST API exposing game data not available on-chain (killmails, tribes, character names). |
| **DLT** | Data Load Tool - Python library for ETL pipelines (used by worldapi-cron). |
| **Smart Gate** | Player-deployed structure enabling instant travel between systems (on-chain entity). |
| **MUD** | Framework for on-chain game state (EVM-based). World contract uses MUD schema. |
| **KV** | Cloudflare Workers Key-Value store (low-latency edge storage). |
| **Wrangler** | Cloudflare CLI for deploying Pages/Workers, managing KV, etc. |
| **sql.js** | WASM port of SQLite for running SQL in browser. |
| **Web Worker** | JavaScript thread running off main thread (used for routing, optimization). |
| **Vibe Coding** | Non-coder operator relies on LLM agent to implement changes. |
| **Cinematic Mode** | Full-screen map view with hidden UI panels (tracked for usage metrics). |
| **Route Ribbon** | Three.js custom geometry for rendering routes as 3D ribbons with gradient shaders. |
| **Reachability** | Feature showing which systems are reachable within ship jump range. |
| **Scout Optimization** | Multi-worker algorithm to find shortest route visiting all systems in a region. |
| **Spatial Grid Cache** | Worker-side cache of nearby stars by grid cell (invalidated when jump distance changes). |

---

## Quick Reference Card (Print-Friendly)

```
=== EF-Map Troubleshooting Quick Ref ===

Postgres:    localhost:5432, user/password, db=postgres
Grafana:     http://localhost:3000 (admin/admin)
Frontend:    cd eve-frontier-map; npm run dev (port 5173)
Build:       npm run build  (or VS Code task "Build frontend")
Deploy:      wrangler pages deploy dist --project-name ef-map --branch <name>

Docker Check:
  docker ps | grep postgres  (expect 3+ containers)

Worker Endpoints:
  /api/stats?history=7
  /api/smart-gate-links
  /api/create-share
  /api/usage-event

Key Files:
  App.tsx                 - Root component, global state
  usage.ts                - ONLY place to emit metrics
  routing_worker.ts       - A*/Dijkstra pathfinding
  worker.js               - Cloudflare Worker (2100 lines)
  decision-log.md         - Recent changes (read last 40 lines)

VS Code Extensions (use first):
  - PostgreSQL: Browse schemas, run queries
  - Docker: Inspect containers, view logs
  - SQLite: Open map_data_v2.db

Emergency:
  docker restart postgres
  cd tools/worldapi-cron; docker compose restart
  wrangler pages deploy dist --project-name ef-map  (redeploy Worker)

Documentation:
  AGENTS.md                        - Workflow rules
  .github/copilot-instructions.md  - Coding patterns
  docs/decision-log.md             - Change history
  docs/primodium-indexer.md        - Indexer setup

=== End Quick Ref ===
```

---

## Appendix: Schema Version History

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2024-Q4 | Initial map_data.db schema (systems, stargates, regions) |
| v2 | 2025-Q1 | Added stations table (system_id, station_count) |
| (Future) | TBD | Potential: smart_gate ownership, tribe territories |

(End of LLM Troubleshooting Guide)

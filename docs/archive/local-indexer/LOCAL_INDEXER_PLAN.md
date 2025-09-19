# Local Indexer Plan (Offline Ingest → Export → Cheap Publish)

Goal: Run the heavy raw log ingest/decode locally (no Cloudflare D1/KV costs), then publish compact artifacts to the Pages site on an infrequent cadence.

Scope (minimal viable):
- Local DB: SQLite (default) or DuckDB for larger volumes.
- Ingest: address-only eth_getLogs with allowlist filter (table/topic) using the same batching rules (≤100 params/stmt equivalent) and confirmation depth.
- Decode: optional; if omitted, export raw slices per day. If included, produce latest-state JSON for map needs.
- Publish: static JSON under `eve-frontier-map/public/data/...` or KV keys written rarely (daily).

Workstream A – Local DB + Ingest
- Create `tools/local-indexer/` with Node scripts:
  - `ingest_raw.js`: CLI args: rpc, world, deployBlock, head, chunkBlocks, rowCap, allowlistPath. Writes to `local.db` (SQLite) tables mirroring D1 schema: `raw_logs`, `event_cursor`. Batching at 11 rows/stmt.
  - `gap_scan.js`: Validates completeness over sampled ranges; outputs `gap_report.json`.
- Schema: add `tools/local-indexer/schema.sql` with subset tables (raw_logs, event_cursor). Use `sqlite3` module; no deps beyond Node ≥18.

Workstream B – Decode (optional)
- `decode_apply.js`: Reads `raw_logs` ordered by (block,log) and materializes `record_latest` per known tables (assemblies, gate_direction, tombstones). Writes to same `local.db`.
- Output validation: counts + sample hashes.

Workstream C – Export
- `export_snapshots.js`: Emits:
  - `data/index-snapshots/raw/YYYY-MM-DD.json` (daily raw summary or compact deltas).
  - `data/index-latest/gates.json` (compact latest-state for map workers).
- Ensure files ≤ a few MB; chunk if needed.

Workstream D – Publish
- Commit exported JSON to repo under `eve-frontier-map/public/data/...` and deploy Pages. For KV alternative, add `tools/push_kv.js` with DRY_RUN and strong caching headers; run rarely (daily).
 - See also: Post‑Ingestion Playbook §7 "Delivery architecture: semi‑live data to the app" for overlay options and client wiring.

Contracts / Interfaces
- Frontend expects `GET /data/index-latest/gates.json` with shape: `{ version: 1, generatedAt, gates:[{ id, from, to, dir, worldVersion, updatedAt }] }`.
- Backward compatible: if absent, app behaves as today.

Workstream E – Local Dashboard (Read‑only, Zero‑Risk to Ingestion)
- Objective: Provide a live status dashboard that visually matches the example (KPI cards, health gauge, throughput and error charts, shard table, alerts, queues, ECS snapshot), without modifying ingestion code or risking disruption.
- Safety principles:
  - Separate process. No code changes to ingestion. Dashboard backend runs as a separate Node process.
  - Read‑only DB access. Open SQLite in read‑only mode with WAL-friendly settings and generous `busy_timeout`. Never write. Prefer `better-sqlite3` with `readonly: true`; fallback to shelling out to a local `sqlite3` binary for queries if native module install fails.
  - Light queries + caching. Compute metrics with small, indexed SELECTs; cache results in-memory for 1–2s to avoid hot-loop scans.
  - Backpressure aware. If a query hits `SQLITE_BUSY`, return last cached snapshot instead of blocking ingestion.

Implementation outline:
1) Metrics service (tools/local-indexer/metrics_server.js)
  - Tech: Node ≥18, no framework required (native `http`), optional Express for ergonomics.
  - Config: `DB_PATH` (default `tools/local-indexer/local.db`), `RPC_URL` (optional for latency probe), `PORT` (default 8731).
  - SQLite open flags: read-only; set `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=250; PRAGMA synchronous=OFF;` for the session when supported by driver; avoid writes.
  - Endpoints (read-only, JSON):
    - `GET /api/health` → `{ status:"ok", startTs, uptimeSec, dbPath, mode:"Catch-up|Live|Paused", schemaVersion }`.
    - `GET /api/summary` → KPI payload: `{ chainHead, indexedHead, blocksPerMin, errorsPerMin, reorgDepth, queueDepth, dbUtil?, cpuUtil?, memUtil?, netLatencyMs? }`.
     - Derivations (examples; adapt to actual schema):
      - `indexedHead` from `event_cursor.head_block` (or max(`raw_logs.block_number`)).
      - `blocksPerMin` from count of distinct blocks in last 60s window.
      - `errorsPerMin` from errors table if present; else zero or parsed from an optional `ingest_raw.err.log` tail.
      - `reorgDepth` from latest negative confirmations or cursor rollback events if tracked.
      - `queueDepth` from any in-flight queue table; else estimate: `(chainHead - indexedHead)` when chain head is known.
      - `dbUtil` optional: omit if not trivial to derive safely.
    - `GET /api/series/tput?window=60` → `[{ t: -59..0, blocks }]` grouped by second over the last minute.
    - `GET /api/series/errors?window=60` → `[{ t: -59..0, errors }]` from error source if available; zeros otherwise.
    - `GET /api/shards` → `[{ id, range, progress, status, bps, lastBlockTs }]` when shard workers exist; else empty array. Progress derived from per-range cursors or estimated by block coverage.
    - `GET /api/alerts` → newest-first alert list; source is a ring buffer kept in memory (ingested from err log tail + heuristics) or a dedicated table if present.
  - Polling model: Either compute on-demand per request with 250–500ms DB time budget and 1s cache; or a background sampler at 1Hz that precomputes the JSON snapshots.

2) UI (tools/local-indexer/dashboard/ or reuse `eve-frontier-map` as a separate route)
  - Rapid path for today: small standalone Vite + React + Recharts app that hits `http://localhost:8731/api/*`.
  - Do not wire into production app yet; keep isolated to avoid any risk. Later we can embed as a panel in `eve-frontier-map`.
  - Components target parity with the provided example: KPI cards, health Gauge, Area/Line charts, shard table, ECS/MUD snapshot, alerts list, queues. Poll endpoints every 1s.
  - Library choices: `react`, `recharts`, `lucide-react`, `classnames`. Keep versions pinned in `package.json` to avoid churn.

3) Acceptance criteria
  - No ingestion regressions (no DB writes from dashboard process, no noticeable slowdowns; `ingest_raw.err.log` shows no stalls attributable to readers).
  - Visual parity: layout and widgets match the example within reasonable styling variance.
  - Live numbers advance during active ingest; ETA and lag make sense; charts move each second.
  - When DB is locked or unavailable, dashboard shows stale data badge and auto-recovers.

4) Risks & mitigations
  - Native module install on Windows (better-sqlite3/sqlite3) may fail → fallback: shell out to a portable `sqlite3` binary; or defer to a read-only HTTP JSON tailer via Powershell for `ingest_raw.err.log` if DB access is blocked.
  - DB contention under heavy ingest → enforce read-only, `busy_timeout`, and caching; reduce query complexity; prefer aggregations over full scans.
  - Schema mismatch → feature-flag optional sections (shards/errors) and degrade gracefully with placeholders when a table is absent.
  - RPC latency probe could add load → cap to 1 probe / 30s and make it optional.

5) Timeline (fast path)
  - T+0: Confirm DB path and available tables/columns.
  - T+30m: Implement metrics_server with 3 endpoints: `/health`, `/summary`, `/series/tput` and simple 1Hz sampler.
  - T+60–90m: Scaffold React dashboard and wire KPIs + charts.
  - T+120m: Add alerts + queues + shard table (guarded behind feature flags). Smoke test during ingest.

Minimal Live-Only Option (later)
- Re-enable a tiny head-only ingestion in CF with strict caps:
  - Window: <= 1000 blocks, rowCap: <= 10k, cadence: 15–30m.
  - Writes only when new blocks present; decode deferred.

Notes
- Keep scripts idempotent; use DRY_RUN env.
- No secrets in repo; read RPC from env or prompt.
- Favor JSON Lines for large exports; gzip at publish if size grows.

## Decode & Analysis Plan (Raw → Registry → Latest State)

Objective
- Analyze captured raw logs, build a reliable registry of tables and field layouts, write deterministic decoders, and materialize a compact latest-state view for the map. Keep ingestion running; work off a read-only snapshot to avoid interference.

Assumptions
- World emits events compatible with the already fetched World ABI and the topic map artifacts under `data/world_abi/` and `data/topic_map.json` (or will be generated). Minor ABI drift will be handled by versioning the mapping with an `abiHash`.
- We do not need full history tables on day one; latest-state is sufficient for the map, with optional per-record history deferred.

Inputs → Outputs (contracts)
- Inputs:
  - SQLite snapshot: `tools/local-indexer/local.db` with `raw_logs(block_number, log_index, tx_hash, topic0, data, topics[1..n])`.
  - Event/ABI maps: `data/world_abi/*.json`, `data/topic_map.json` (topic0→event, selector→function, abiHash).
  - Optional: previously exported `table_registry.json` from a dry probe.
- Outputs:
  - `record_latest` SQLite table with decoded rows of interest (assemblies, gate_direction, tombstones/ACL as applicable).
  - `apply_cursor` row `{ last_block_number, last_log_index, abiHash }`.
  - Reports: `data/reports/table_inventory.json`, `data/reports/field_layout.json`, `data/reports/decode_sample.jsonl`.
  - Frontend artifacts: `eve-frontier-map/public/data/index-latest/gates.json` (small, versioned).

Phases
1) Topic Inventory & Registry Extraction
   - Scan distinct `topic0` and `topics[1]` (tableId) from `raw_logs` to produce `table_inventory.json`:
     - Per topic0: `{ first_block, last_block, count }`.
     - Per tableId: `{ first_block, last_block, appearances }`.
   - Cross-reference topic0s with `topic_map.events`; label unknowns as `unknown:<hash>` and park for later.
   - Deliverable: `data/reports/table_inventory.json`.

2) Field Layout Discovery (MUD-like)
   - For each relevant tableId, sample recent `SetRecord/SetField/DeleteRecord`-like logs and infer field packing:
     - Key bytes (`topics[2]` or data prefix), value blob segmentation, indices used.
   - Emit `field_layout.json` keyed by tableId: `{ keyParts:[{name,type}], fields:[{name,type}], ephemeral:boolean }`.
   - Keep conservative types initially (bytes32, uint256, address) and refine as needed.

3) Decoder Implementation
   - Create `tools/local-indexer/decoders/` with pure functions `(log, layout) -> { tableId, key, value, op }`.
   - Start with small set: assemblies, gate_direction, gate_tombstone/ACL. Unit-test on `decode_sample.jsonl`.
   - Maintain deterministic behavior; avoid external I/O.

4) Apply Engine (Latest-State)
   - Contract: ordered stream by `(block_number, log_index)`; apply ops idempotently.
   - Tables:
     - `apply_cursor(id=1, last_block_number, last_log_index, abiHash)`.
     - `record_latest(tableId, key_hex, json, updated_block, updated_log)` with unique `(tableId,key_hex)`.
   - Algorithm:
     - Read from cursor+1 in batches; for each decoded op:
       - Upsert or delete from `record_latest`.
     - Commit per N logs (e.g., 5k) to keep memory bounded.
     - Update `apply_cursor` at batch boundaries.

5) Export for Frontend
   - Build `gates.json` minimal shape:
     `{ version: 1, generatedAt, worldVersion?, gates:[{ id, from, to, dir, updatedAt }] }`.
   - Validate file size (<~2–3 MB). If larger, split by region and add index.

6) QA & Integrity
   - Gaps: run `gap_scan.js` over a few random intervals; require zero missed ranges.
   - Replay: pick 10 random keys; replay raw logs to recompute latest value; must match `record_latest`.
   - Spot-check against live RPC for 2–3 recent blocks (read-only).
   - Log a short summary in `docs/decision-log.md` with counts and sizes.

Edge Cases
- Reorgs: Only process up to `safeHead = head - CONFIRM_DEPTH`. If logs beyond safeHead exist, ignore until next snapshot.
- Unknown topics: keep ignored; record counts in inventory; do not fail pipeline.
- ABI drift: hash mismatch between `apply_cursor.abiHash` and current `topic_map.abiHash` triggers a required full or partial re-apply; document before proceeding.
- Large value blobs: cap decoded preview size in reports; store hex as-is in `json` value when schema unknown.

Success Criteria
- End-to-end run on a snapshot finishes without errors; `record_latest` populated with plausible counts.
- `gates.json` renders correctly in a local build of the app; routing uses updated directions.
- Integrity checks pass (gap=0 on sampled ranges; replay matches for sampled keys).
- Pipeline is restartable via `apply_cursor`; idempotent re-run yields no diffs.

Runbook (local)
1. Freeze a snapshot: copy `local.db` to `local-YYYYMMDD-HHMM.db`.
2. Run Inventory: `node tools/local-indexer/inventory.js --db local-*.db` → `table_inventory.json`.
3. Generate topic map if missing: `node tools/build_topic_map.js`.
4. Discover layout: `node tools/local-indexer/discover_layout.js --db local-*.db` → `field_layout.json`.
5. Apply: `node tools/local-indexer/decode_apply.js --db local-*.db --from-cursor`.
6. Export: `node tools/local-indexer/export_snapshots.js --db local-*.db`.
7. Smoke: open app locally and verify map reflects changes.

Future Extensions
- Add `record_history` for diffs/time-travel when needed.
- Move heavy decode to a worker thread and stream apply.
- Optional: produce Parquet snapshots for offline analytics (DuckDB/Arrow).

## World API indexing plan (enrichment)

Goal
- Ingest JSON from the World API to enrich chain‑decoded latest state (names, metadata, visuals). Keep chain as source of truth for topology and deletes; use API for descriptive fields and extras.

Storage decision
- Default: store in the same SQLite DB (`local.db`) in namespaced tables `world_api_*` for simple merge and exports. Include `source` and `source_ts` columns.
- Alternative (deferred): separate `local-world.db` if volume/ownership separation becomes important; merge at export time. We can switch later without changing client shape.

Proposed schema (minimal)
- `world_api_fetch (id INTEGER PK, endpoint TEXT, etag TEXT, last_modified TEXT, fetched_at TEXT, status INTEGER, bytes INTEGER)`
- `world_api_nodes (id TEXT PK, x REAL, y REAL, region TEXT, name TEXT, updated_at TEXT, source_ts TEXT)`
- `world_api_gates (id TEXT PK, from_node TEXT, to_node TEXT, dir TEXT NULL, name TEXT NULL, updated_at TEXT, source_ts TEXT)`
- Add indices on ids and `updated_at`. Expand columns as needed; prefer JSON blobs for rare fields in a `meta_json` column to avoid schema churn.

Ingestion tool
- `tools/local-indexer/fetch_world_api.js`
  - Inputs: base URL(s), endpoints, optional auth, poll interval, concurrency (1–2).
  - Behavior: conditional GET with `If-None-Match`/`If-Modified-Since`; on 304, skip write; on 200, upsert rows; record fetch metrics.
  - Safety: backoff on 429/5xx; write in small transactions; tolerate missing fields.

Merge rules (chain ⊕ API)
- Topology (existence, directions, deletions): chain is authoritative (record_latest derived).
- Labels/metadata (names, categories): API preferred when present; fallback to chain or prior value.
- Conflicts: keep chain values; store API variant in `meta_json` for audit.
- Export step composes `gates.json` and any `nodes.json` with enrichment applied.

Cadence
- Start manual/hourly polling. Persist `etag`/`last_modified` to avoid redundant writes. Later add a small KV overlay if near‑real‑time labels are desired.

QA
- Count parity: nodes/gates in API vs export.
- Spot verify a handful of entries against UI/known references.
- Ensure no topology mutation originates from API merging.


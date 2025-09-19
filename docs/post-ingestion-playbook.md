# Post‑Ingestion Playbook (EF Index)

Purpose: What to do once raw log backfill completes and steady‑state ingestion begins. Covers decoding/materializing domain tables, retention/cleanup of raw logs, and D1 cost controls.

## 0) Success contract
- Backfill complete: event_cursor at or within CONFIRM_DEPTH of chain head; last 2h runs mostly duplicate‑only.
- Health: `/api/indexer-health?details=1` shows primary `raw_logs` small/stable; A1/A2 under soft caps; no active run >2m.
- Cost guard: D1 reads/writes within daily budget (see section 3).

## 1) Decode and materialize
Inputs/State
- Source: `raw_logs` (and optional `raw_logs_new` shadow).
- Decode registry: `topic_map` (ABI hash → JSON) via `/api/indexer-topic-map-refresh`.
- Durable cursor: `decoded_cursor(id=1)`.

Steps
1. Freeze schema (additive migrations only).
2. Ensure topic map stored (POST `/api/indexer-topic-map-refresh`).
3. Implement decode batch (idempotent):
   - For range (cursor.last_block .. head − CONFIRM_DEPTH), SELECT candidate `raw_logs` rows.
   - Decode table‑level events → INSERT `store_events` (append) and UPSERT `record_latest` (latest by (table_id,key_hex)).
   - Update `decoded_cursor` to last processed (block, log_index).
   - Batch constraints: ≤100 params/stmt; ≤40 statements/batch; throttle between batches (100–300 ms).
4. Domain materialization:
   - Upsert `smart_assembly` from decoded assemblies.
   - Replace `smart_gate_direction` per gate on change; maintain `gate_tombstone` on deletes.
5. Verification gates:
   - Monotonic counts; spot‑check known topics; UI routing/overlay smoke.

Rollback
- Stop at cursor boundary; no partial writes beyond a batch. Re‑run resumes safely.

## 2) Retention & cleanup
Goal: Keep primary small for fast queries; archive retains history (A1/A2).

Policy
- Keep ~last 30k blocks in primary `raw_logs` for diagnostics.
- Archive older rows to A1; spill to A2 after A1 cap.

Steps
- Keep archiver cron running with dynamic cut (offset ≈ 30,000 blocks).
- Soft cap: `ARCHIVE_A1_MAX_ROWS` < 10GB equivalent (currently 9.1M rows). Spill to A2 when exceeded.
- Optional pruning: implement ring‑buffer behavior across A1/A2 to retain only last N million rows.
- Optional deletion: after ≥7 days of stable decode with no drift, consider dropping A2 (then A1) to minimize storage.

## 3) D1 cost controls
Levers
- Ingestion
  - `INDEXER_CRON_SEGMENT_BLOCKS` tuned to avoid retries (presently 325). `MAX_SEG_REQ` ≤ 40.
  - Row cap per run (100k) to limit spikes; optional `INDEXER_CRON_SECOND_PASS_MS` for smoothing.
- Archiver
  - Page size ~1000; pause 50 ms; MAX_PAGES conservative to avoid burst writes.
- Decode
  - Batch and upsert; avoid per‑row SELECT; use composite UPSERT keys; throttle.
- App/Queries
  - Use aggregates or targeted indexes (block, address, topic0). Avoid scanning archives from UI.
  - Provide range‑bounded endpoints (like `/api/indexer-rawlogs-range`).

Budget sanity
- With steady‑state (~120k blocks/hour), expect a few k writes/min in bursts. Keep cron cadence and batch sizes so daily reads/writes remain under plan limits.

## 4) Operational runbook
- Daily
  - Check `/api/indexer-health?details=1`: archivedCount increases; primary bounded; no stuck run.
  - Stats KV `/api/stats?history=14` loads without 5xx.
- Weekly
  - Review A1/A2 sizes; adjust spill threshold if nearing caps.
  - Run gap scan and record via `/api/indexer-gap-report`.
- Incident
  - Watchdog auto‑finalizes no‑progress runs; if frequent, reduce SEGMENT_BLOCKS and inspect RPC endpoints.

## 5) Promotion checklist (when decode ships)
- Add migrations for `decoded_cursor` and any new tables; POST `/api/indexer-migrate`.
- Preview decode batch; verify `record_latest` populated and topic_map present.
- Enable decode on a schedule with small batches; monitor health and costs; then scale up cautiously.

## 6) Data deletion decision tree
- Minimize storage now → Drop A2 first, then A1; retain recent window in primary only.
- Preserve audit/historical → Keep A1 (oldest), spill to A2 with pruning.

Notes: This doc is operational; no code changes executed by publishing it. When you approve, I’ll wire the decode batch endpoint and migrations as a separate change.

## 7) Delivery architecture: semi‑live data to the app

Goal
- Serve near‑real‑time world state to the web app by combining decoded chain data (latest‑state) and World API JSON, without re‑introducing platform cost or operational risk. Support both local‑only workflows and hosted Pages deployments.

Sources
- Chain (decoded): `record_latest` derived from local decode pipeline or future hosted decode.
- World API: JSON endpoints (periodic fetch), merged for enrichment or fallback.

Consumer (app)
- Primary surface remains static files in `eve-frontier-map/public/data/` for broad compatibility. Add a lightweight overlay fetch path for “fresh” diffs.

Modes (progressive)
1) Static snapshots only (baseline)
  - Export `index-latest/gates.json` and any other materialized views to `public/data/` and deploy. No runtime fetch needed; ideal for demos and low‑update cadence.

2) Static + KV overlay (Pages Worker)
  - Keep snapshots static; add a tiny overlay endpoint `/api/overlay` backed by Cloudflare KV holding recent diffs (gate updates/deletes) generated by an external job (local decode or periodic poller).
  - Client fetches snapshot once, then polls `/api/overlay?since=<ts>` every 10–30s and merges. Overlay payload small (affected ids & fields only). KV write cadence low (<= minutely).

3) Local dev mode (no network)
  - When running locally, app reads from `tools/local-indexer/metrics_server.js` (or file watcher) via `http://localhost:<port>/api/index-latest` for live updates. Fallback to static files when not available.

4) Hosted DB later (optional)
  - If we evolve to hosted decode, a small D1 (or equivalent) exposes read-only endpoints (`/api/gates`, `/api/nodes`) with strict pagination and caching. Not required now; defer until necessary.

Client wiring
- Data loader utility with layered sources:
  1) Load baseline snapshot (`/data/index-latest/gates.json`).
  2) If overlay endpoint available, fetch and apply diffs periodically.
  3) In local dev (detected by flag or localhost), prefer local metrics server endpoints.
- UI controls (e.g., “Display gates”, “Display all nodes”) select which datasets to hydrate; use a simple registry mapping control → loader(s).
- Caching: honor `ETag`/`Last-Modified` for snapshots; overlay carries `sinceTs` cursors.

Merge strategy
- Identify entities by stable keys (e.g., gate_id). On overlay apply: upsert changed items; remove deletions; bump updatedAt.
- Keep a small in-memory changelog to allow rollback or reload.

Operational notes
- Snapshot cadence: start daily; tighten once decode stable (hourly if needed). Overlay TTL 5–15 minutes by default.
- KV footprint: diffs only; rotate keys by date and compact periodically.
- Guardrails: never block UI if overlay unavailable; snapshot-only works.

Acceptance criteria
- App renders from snapshot alone. When overlay present, changes appear within one polling interval.
- No auth or secrets required for read-only paths; costs bounded (KV writes are small and infrequent).
- Local dev can see near‑live updates from the local snapshot/metrics server without touching Cloudflare.
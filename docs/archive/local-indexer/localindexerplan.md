# Local Indexer Plan (Long-Running, Near-RT)

Purpose: operate the local indexer for 12+ months with rotating worlds (same chain ID), staying near chain head (head − depth) while decoding in the hot path. Keep the dashboard stable and read‑only.

## Operating Model
- Ingest & decode concurrently (streaming); retain optional raw_logs for audit.
- Confirmation depth N configurable (default 8). Finalize when block ≥ head−N.
- World rotation: treat each world as a “run.” Create a new database on world switch; keep the previous DB read‑only for a cooling period, then archive or delete.

Recommended rollover policy:
- On new world: stop ingest, snapshot current DB, start with a new DB file (e.g., `data/local-indexer-YYYYMMDD.db` and `data/local-indexer-decoded-YYYYMMDD.db`).
- After stability window (e.g., 7–30 days), delete or archive the prior DBs if no longer needed.

## Phases
1) Phase 0 – Hardening (landed)
   - Split decode status into `data/local-indexer-decode-status.json` (atomic tmp+rename).
   - Servers merge decode status for `/api/status` and `/api/decode`.
   - Single‑instance discipline via fixed port and PID helpers (scripts already provided).

2) Phase 1 – Streaming decode (planned)
   - Bounded queue, decode in hot path, keep raw_logs. Expose `/api/queue` and finalized height.

3) Phase 2 – Dynamic table discovery (planned)
   - Watch TableRegistered/SetRecord; allowlist auto‑DDL; unknown tables to JSON staging.

4) Phase 3 – Reorg finalization (planned)
   - Mark pending vs finalized, reconcile on reorg, metrics for replays.

5) Phase 4 – Materialized map views (planned)
   - Maintain denormalized tables for map queries; index tuning; retention rules.

## Metrics & Dashboard
- Unified lag: ingest, decode, overall. Queue depth, RPC health, reorg counters.
- Stable rendering: atomic reads, last‑good cache, batch fetch with fallbacks.

## Windows Ops
- Scripts: start/stop ingest, metrics, status, decode.
- Backups: daily file copy or zipped snapshot during idle window.
- Maintenance: WAL checkpoint and VACUUM monthly or after major backfills.

Success criteria:
- p95 lag ≤ 2 blocks at depth N; zero duplicate writes through restarts; new tables surfaced ≤ 30s (staged) or minutes (typed).

# World Rotation Playbook (Pyrope / EF Index)

Purpose: Safely rotate indexing to a new WORLD_ADDRESS (same chain) while preserving the previous world’s data in separate D1 databases. No code changes required—only bindings and variables.

## Naming and scope
- New index DB: ef_index_<epoch>
- New archives: ef_index_archive_1_<epoch> (+ optional ef_index_archive_2_<epoch>)
- Epoch: short label like 2025Q4 or 2025-10.

## Minimal procedure
1) Provision D1s
   - Create: ef_index_<epoch>, ef_index_archive_1_<epoch> (and _archive_2_ if desired)
   - Capture database_id values.
2) Bindings
   - Pages Worker (frontend + API) config: set INDEX_DB → ef_index_<epoch>, INDEX_DB_A1 → ef_index_archive_1_<epoch> (add INDEX_DB_A2 if created).
   - Archiver Worker config: mirror the same D1 bindings.
3) Variables
   - Update WORLD_ADDRESS to the new address.
   - Set DEPLOY_BLOCK to the new world’s start block.
   - Keep PYROPE_RPC unchanged unless infra changes.
4) Deploy
   - Build + deploy Pages; deploy Archiver Worker.
5) Verify
   - /api/indexer-health?details=1 shows cursor advancing on the new DB; raw_logs increasing.
   - Archiver manual tick returns status ok; archive DB grows; primary stabilizes/shrinks over time.
6) Freeze prior world
   - Ensure no bindings still point to the old ef_index_* DBs (old D1s become read-only historical data).

## Throughput and retention
- Archiver uses a dynamic cut line: cutTo = min(ARCHIVE_CUT_TO, head − ARCHIVE_CUT_OFFSET_BLOCKS).
- Tune to match/exceed ingest: PAGE_LIMIT, MAX_PAGES, RANGE_WINDOW, PAUSE_MS.
- Multi-archive: route to A2 when A1 rows exceed ARCHIVE_A1_MAX_ROWS.

## Rollback
- Revert bindings back to old D1 ids and redeploy. No cross-world data loss; worlds are isolated by DB.

## Operational notes
- D1 per-DB size ~10 GB: create archive_2 early if growth is fast.
- Account limits are generous (tens of thousands of DBs), so per-world DB isolation scales.
- Keep a short decision entry each rotation with epoch, world address, start block, and D1 ids.

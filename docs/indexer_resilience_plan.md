# Indexer Resilience Plan

This document captures the immediate reliability improvements (heartbeat, watchdog, visibility) and a phased roadmap for scaling the ingestion subsystem from a single self-healing worker to a multi-worker, adaptive architecture.

## Immediate Improvements Summary (Phase 1)
| Feature | Status | Implementation Notes | Verification | Rollback |
|---------|--------|----------------------|--------------|----------|
| Heartbeat & progress tracking | Implemented | `store_all` branch updates `rows_so_far` & `last_progress_at` every ≥5s during batch flush | Trigger run; poll `/api/indexer-health?details=1`; observe `rows_so_far` increasing and `last_progress_at` advancing | Remove heartbeat UPDATE calls; optional column cleanup |
| RPC timeout + abort (15s) | Pending | Wrap each `eth_getLogs` / `eth_blockNumber` with `AbortController` + race timer; classify timeout separately (`rpc_timeout`) | Force provider delay (e.g., point RPC to local proxy that sleeps); ensure run finalizes or retries without hanging | Revert wrapper to direct fetch |
| Auto-stall detection (no heartbeat >3m) | Partially Implemented (2m no-progress finalize in trigger) | Trigger endpoint finalizes run on >2m no progress OR >25m age; need adjustable constants and 3m threshold alignment | Start run, pause RPC responses (simulate hang), confirm finalize after threshold & next run starts | Remove watchdog logic in trigger |
| Health endpoint enrichment | Partial | Added `last_progress_at`, `rows_so_far`, `stall_restarts`; still pending: `activeRunAgeMs`, `lastProgressAgoMs`, `adaptiveBatchCurrent`, `segRequestsSoFar`, `batchFlushes` mid-run snapshot | Hit `/api/indexer-health?details=1` during active run; verify fields present | Omit added fields |
| Classification tweak (progress aware) | Implemented | Badge uses heartbeat gap: ≤60s ok, 60–120s idle, >120s stalled for active run | Stall simulation; watch state transitions | Restore old classify logic |
| Metrics counter `stall_restart` | Pending | Fire usage event when watchdog finalizes stalled run; increment KV counters | Force stall finalize; check `/api/stats` counters for `stall_restarts` | Remove event emission code |
| Decision log entry | Implemented | Entry dated 2025-09-09 (Heartbeat & Watchdog Resilience Upgrade) | Inspect `docs/decision-log.md` | Delete entry lines |

### Remaining Phase 1 TODO
1. Add RPC timeout wrappers.
2. Extend health endpoint with missing enrichment fields and compute deltas.
3. Emit `stall_restart` usage event upon watchdog finalize.
4. Align stall thresholds to spec (3m no progress vs current 2m constant) – decide final numbers.

## Acceptance Criteria (Phase 1)
- A continuously running backfill shows monotonic `rows_so_far` increases at least every 60s while provider healthy.
- Artificial provider hang does not leave system in “ok” longer than configured stall threshold; auto-recovery within one cron interval after finalize.
- Badge displays progress age and stalls correctly <2 minutes after heartbeat loss (current), moving to final 3m target after threshold adjustment.
- No active run persists beyond 25m without auto-finalization.
- No regression in ingestion correctness (cursor advances only when rows inserted OR allowed semantics preserved when zero actual inserts).

## Testing Matrix
| Scenario | Setup | Expected Outcome | Observed Fields |
|----------|-------|------------------|-----------------|
| Normal run (healthy RPC) | Trigger store_all | `rows_so_far` increments; `progress age` resets <10s cadence; state `ok` | last_progress_at updates, classify=ok |
| Micro-stall (<60s) | Pause RPC <60s | State remains `ok`; no finalize | progress age <60s |
| Mid stall (90s) | Pause 90s | State becomes `idle` (60–120s gap) | classify=idle, gap ~90s |
| Long stall (130s) | Pause 130s | State becomes `stalled`; watchdog not yet finalized (current 2m finalize) | classify=stalled |
| Watchdog finalize | Pause 140–150s total | trigger endpoint invoked → detects >120s no progress → marks run finished with note `auto-finalized_no_progress` | run finished; new run allowed |
| RPC timeout | Inject >15s delay on eth_getLogs | Individual call aborted; run surfaces timeout error or shrinks window (future) | error classification, row continuity |
| Stall restart metric | Force stall finalize | `/api/stats` shows `stall_restarts` increment | KV counters increment |

## Metrics & Observability
Pending additions (Phase 1 completion checklist):
- Health fields: `activeRunAgeMs`, `lastProgressAgoMs`, `adaptiveBatchCurrent`, `segRequestsSoFar`, `batchFlushes` (persist most recent run-level snapshots for active run via lightweight separate table or cached in run row on each heartbeat). Simplicity path: extend heartbeat UPDATE to also persist `batchFlushes` & `adaptiveBatch` when changed.
- Usage event on stall finalize (server-side invocation of existing EVENT_MAP counter `stall_restart`).

## Phased Roadmap
### Phase 1 – Single Worker Self-Healing (In Progress)
Scope: Heartbeat, watchdog, enriched health, timeout, stall metric.
Gate to Phase 2: 7 consecutive days with <2 auto-finalizations per day (transient stalls) and zero runs exceeding finalize thresholds.

### Phase 2 – Cursor Leasing for Multi-Worker
Design: Introduce `ingest_lease` table: `(id=1, lease_token TEXT, lease_acquired_at TIMESTAMP, lease_expires_at TIMESTAMP, cursor_block INTEGER, status TEXT)`.
Algorithm:
1. Worker attempts `INSERT OR REPLACE` with conditional lease not expired (optimistic compare using `WHERE lease_expires_at < now()` or row missing).
2. On success worker processes bounded work unit (window) updating `rows_so_far` locally.
3. Heartbeat extends lease (UPDATE with same token, new expiry) every ≤30s.
4. If lease expires (no heartbeat) another worker can acquire.
Benefits: Horizontal scaling & resilience to sudden isolate termination.
Gate to Phase 3: Demonstrated dual worker safe progress (no overlapping window duplication) across 1M+ block ingestion sample; zero duplicate raw_logs due to `u_raw_logs_block_logindex` uniqueness.

### Phase 3 – Adaptive Window Sizing
Inputs: Recent rows/sec (moving average), error streak, RPC latency distribution, batch shrink count.
Heuristic: target invocation duration ~15–25s; adjust `maxBlocks` proportionally to achieved rows/sec; reduce on error streak or high batchShrinks.
Storage: Maintain `ingest_stats` table summarizing last N (e.g., 50) runs (rows, duration, errors) for moving averages.
Gate to Phase 4: 20%+ throughput improvement (rows/min) with stable error rate (no increased stalls) over baseline static window for ≥24h.

### Phase 4 – Tail vs Backfill Workers
Partition: Backfill processes historical gap (cursor -> head - tailBuffer); Tail worker polls near head with small windows for low-latency updates.
Coordination: Two leases (backfill, tail) or implicit: tail active only when head distance < threshold.
Gate to Phase 5: Head lag (cursor to finalized head) remains <2 * cron interval 95% of samples over 3 days.

### Phase 5 – Failure Queue & Alerting
Mechanics: On recoverable failures (timeout, RPC 500) enqueue record into KV `ingest_failures:{date}` with metadata (type, block span, attempt count). Scheduled diagnostic sweeps export metrics → usage events or external monitor.
Alerts: Threshold-based counters trigger (e.g., >5 timeouts in 15m) for external scraping.
Gate (Completion): MTTR for induced failures < 2 * cron interval; failure queue drain rate >= fill rate (steady state) for 7 days.

## Rollback Strategy
- Heartbeat/Watchdog: toggle via temporary env flags (add `INDEXER_HEARTBEAT_ENABLED=0`) if causing load; skip heartbeat updates conditionally.
- Timeout wrapper: feature flag `INDEXER_RPC_TIMEOUT_MS` (0 to disable) allowing quick revert without code removal.
- Leasing (Phase 2+): keep single worker compatibility path; if lease acquisition anomalies occur disable multi-worker path with `INDEXER_MULTI_DISABLED=1`.

## Open Questions / Decisions Deferred
| Topic | Question | Deferred To |
|-------|----------|-------------|
| Stall threshold | Final 2m vs 3m finalize? | Post empirical stall distribution analysis |
| Progress persistence granularity | Store per-batch metrics vs aggregate only | After verifying D1 write overhead |
| Adaptive logic complexity | Simple proportional vs PID-style controller | Phase 3 design review |
| Failure queue storage | KV vs D1 | Prototype; consider query patterns |

## Next Actions Checklist
- [ ] Implement RPC timeout wrapper (15s) with abort & classify.
- [ ] Add enrichment fields and computed ages to health endpoint.
- [ ] Emit `stall_restart` usage event server-side on watchdog finalize.
- [ ] Decide final stall finalize threshold (2m vs 3m) & unify constants.
- [ ] Add env flags for heartbeat/timeout toggles (optional for rapid rollback).

---
Document owner: automated assistant (updates as phases progress). PRs modifying ingestion resilience must reference this file in decision log.

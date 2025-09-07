# Netlify → Cloudflare Migration Plan

## 1. Scope & Objectives
Migrate persistence + serverless functionality from Netlify (Functions + Blobs) to Cloudflare (Workers + KV, optional D1 later) with zero feature regression, preserved anonymous metrics integrity, and reversible cutover.

In-Scope:
- Shares (create/get)
- Usage metrics ingestion & stats aggregation
- Health & stats endpoints parity

Out-of-Scope (initial phases):
- R2 / large binary asset hosting
- D1 analytical schema (post‑migration enhancement)

Success Criteria:
- No increase in failed share retrievals (>0.2% vs baseline)
- Metrics counter drift <0.5% during shadow & dual write phases
- p95 function latency change within ±15% of baseline after cutover

## 2. Phase Overview
| Phase | Token | Goal | Runtime Impact | Exit Criteria |
|-------|-------|------|----------------|---------------|
| 0 Hardening | MIGRATE PHASE0 OK | Audit & ensure clean abstraction boundaries | None | Inventory + gap list approved |
| 1 Adapter Intro | MIGRATE PHASE1 OK | Add Cloudflare KV adapter behind flag (unused) | None | Build & typecheck; no behavior delta |
| 2 Shadow Reads | MIGRATE PHASE2 OK | Read both providers, compare silently | Read-only KV traffic | 7 days <0.5% drift, no errors |
| 3 Dual Write | MIGRATE PHASE3 OK | Writes to both; reads still Netlify | +Write latency slight | 3 days zero structural drift |
| 4 Cutover | MIGRATE PHASE4 OK | Cloudflare primary; Netlify fallback | Live | 3 days fallback <0.1% |
| 5 Cleanup | MIGRATE CLEANUP OK | Remove Netlify paths & flags | Permanent | All gates green, decision logged |

## 3. Detailed Phases
### Phase 0 – Hardening / Audit
Checklist:
- [x] Enumerate all `_store.js` call sites (only the file itself currently; helpers `getStatsStore`/`getShareStore` used in functions already abstracted)
- [x] Confirm no direct `@netlify/blobs` imports outside `_store.js` (except diagnostic `blobs-diag.js`; acceptable – will migrate last or remove)
- [x] Identify implicit assumptions (e.g. atomic overwrite) & map to KV semantics
- [x] Draft adapter interface (get, set, listKeys?, compareAndSwap? (defer))
- [ ] (Operator) Create Cloudflare account (if not already) & enable Workers/KV
- [x] (Operator) Create KV namespaces: shares (`EF_SHARES`), stats (`EF_STATS`), optional drift (`EF_DRIFT`)
- [x] (Operator) Produce namespace IDs & desired binding names (not secrets) in chat
- [x] (Assistant) Record namespace IDs & bindings in plan (no secrets), scaffold placeholder env variable names
- [x] Inventory build command & output dir (expected: `npm run build` -> `dist/`)
- [x] Audit environment variable usage (`process.env`) – list & classify (BLOB_SITE_ID, NETLIFY_SITE_ID, SITE_ID, BLOB_PAT/BLOBS_TOKEN, STATS_STORE, SHARE_STORE)
- [x] Confirm absence (or document presence) of custom redirects/headers (none in repo/netlify.toml; treat as none)
- [x] Note SPA nature (needs `not_found_handling: single-page-application`)
- [x] Add external reference link to Cloudflare Netlify migration guide (see References section)
Exit Criteria: Checklist complete & logged.
Rollback: N/A (no runtime change).

### Phase 1 – Adapter Introduction
Checklist:
- [x] Create `cloudflareAdapter.ts` (placeholder using in-memory Map) (superseded: using `cf_kv.ts` stub)
- [x] Add `cf_kv.ts` stub (SimpleKV interface + binding accessor)
- [x] Feature flag env var `CF_ADAPTER_ENABLE=false`
- [x] Wire selection logic (but keep Netlify active)
- [x] Add `wrangler.jsonc` scaffold with: name, compatibility_date, (assets to add later) `kv_namespaces`
- [x] Insert actual KV namespace bindings (IDs recorded)
- [x] Add `assets` config & SPA not_found handling (Worker assets placeholder)
- [x] Create function mapping table (Netlify -> Cloudflare Worker route) in plan
- [x] Document dev workflow: `npm run build` then `npx wrangler dev` (flag disabled)
- [x] Validate that enabling flag without bindings fails gracefully (clear console warning, no crash)
Exit Criteria: Build passes; toggling flag in dev shows no runtime errors.
Rollback: Delete adapter file + selection branch.

### Phase 2 – Shadow Reads
Checklist:
- [x] Implement real KV binding shim (non-persistent binding via global __CF_KV) behind flags
- [x] For each read (shares, stats blob) fetch Cloudflare in parallel (served value still Netlify)
- [x] Compare JSON/string content; record mismatch & miss counters (process memory only)
- [x] Expose shadow metrics via health function when CF_SHADOW_READ_ENABLE=true
- [ ] Run 7 consecutive days with drift (<0.5%) before advancing

Sandbox (Option A) Note: A standalone Cloudflare Worker (`worker.js`) was added to allow early visual validation (share + minimal stats) without engaging formal dual write (Phase 3). This sandbox maintains an intentionally reduced EVENT_MAP and does not affect Netlify production counters.
Exit Criteria: 7 consecutive days drift <0.5%.
Rollback: Disable shadow fetch flag.

### Phase 3 – Dual Write
Checklist:
- [ ] On write operations: write Netlify then Cloudflare (async fire‑and‑forget with logging)
- [ ] Record success/failure counts
- [ ] Add temporary health endpoint field: `{ dualWrite: { cfWriteFailPct } }`
Exit Criteria: <=0.1% write failures & zero schema divergence after 3 days.
Rollback: Disable Cloudflare write branch.

### Phase 4 – Cutover
Checklist:
- [ ] Flip primary read to Cloudflare; keep Netlify fallback
- [ ] Track fallback invocation count
- [ ] Validate latency vs baseline (manual sampling)
Exit Criteria: 3 days fallback ratio <0.1% & latency within ±15%.
Rollback: Revert primary selection commit.

### Phase 5 – Cleanup
Checklist:
- [ ] Remove fallback reads
- [ ] Remove dual write code
- [ ] Simplify adapter to single provider
- [ ] Update docs & decision log
Exit Criteria: No references to Netlify blobs remain.
Rollback: Reintroduce fallback (would require branch revert – treat as new change).

## 4. Verification Matrix
| Check | Method | Threshold | Phase Applicability |
|-------|--------|----------|---------------------|
| Typecheck | `npm run typecheck` | 0 errors | All |
| Build | `npm run build` | Success | All |
| Share Round Trip | Create→Fetch test | 100% success (n>20) | 2–4 |
| Metrics Drift | Shadow compare script | <0.5% (P2), ~0% (P3) | 2–3 |
| Fallback Rate | Counter | <0.1% (P4) | 4 |
| Latency Sampling | Manual / logs | ±15% p95 | 4 |

## 5. Rollback Strategy
| Scenario | Trigger | Action |
|----------|---------|--------|
| High drift in P2 | Drift >=0.5% 24h | Disable shadow flag; investigate normalization |
| Dual write failures | CF fail >0.5% hour | Disable CF writes; inspect worker logs |
| Fallback surge post cutover | Fallback >=0.5% 1h | Revert primary commit; reopen investigation |

## 6. Metrics Parity Definition
Drift = |CF value - Netlify value| / max(Netlify,1). Measured on total counters & sums. Acceptable: <0.5% Phase 2 average; <0.2% sustained Phase 3; ~0% at Phase 4 prior to removing fallback.

## 7. Risk Register
| Risk | Impact | Mitigation | Trigger | Status |
|------|--------|------------|---------|--------|
| Event write race (overwrite) | Lost increments | Use merge logic / atomic increments later (D1) | Detected negative delta | Open |
| KV eventual consistency | Possibly stale stats read | Keep snapshot design; tolerate minor delay | Drift complaints | Open |
| Increased latency | UX delay on stats page | Parallel prefetch or cache last snapshot | p95 > baseline +15% | Open |

## 8. Daily Log
(Use newest at bottom)
```
2025-09-06: Plan scaffold created. No runtime changes.
2025-09-06: Augmented Phase 0 & 1 with build/env audit, wrangler scaffold, function mapping, external reference link tasks.
2025-09-06: Phase 0 token granted. Completed initial audits (call sites, env vars, build output, redirects=none, SPA flag). Pending: assumptions & adapter interface draft, operator namespace creation.
2025-09-07: Namespaces (EF_SHARES/EF_STATS/EF_DRIFT) created via wrangler; IDs recorded. Advanced to Phase 1 (token). Added `wrangler.jsonc` scaffold & `cf_kv.ts` stub. Next: feature flag + selection logic & function mapping table.
2025-09-07: Added CF_ADAPTER_ENABLE flag logic (inactive by default) in `_store.js`; added assets SPA handling & function mapping table scaffold.
2025-09-07: Completed Phase 0 assumptions + adapter interface docs and Phase 1 tasks (flag wiring, mappings, assets config). Phase 1 exit criteria met (no behavior change, build green). Ready to request Phase 2 token when shadow read instrumentation is desired.

### Function Mapping Table (Phase 1 Draft)
| Netlify Function | Current Path | Planned Worker Route | Notes |
|------------------|-------------|----------------------|-------|
| create-share.js  | /.netlify/functions/create-share | /api/create-share | Same request/response JSON; will dual write in P3 |
| get-share.js     | /.netlify/functions/get-share    | /api/get-share    | Read-only; candidate for early shadow read (P2) |
| usage-event.js   | /.netlify/functions/usage-event  | /api/usage-event  | Ingestion; order & batching semantics preserved |
| stats.js         | /.netlify/functions/stats        | /api/stats        | Aggregated snapshot; ensure cache headers parity |
| health.js        | /.netlify/functions/health       | /api/health       | Add drift/write stats fields in later phases |
| blobs-diag.js    | /.netlify/functions/blobs-diag   | (maybe /api/diag) | Optional; may drop post-migration |
```

## 9. Tokens Granted
MIGRATE PHASE0 OK
MIGRATE PHASE1 OK
MIGRATE PHASE2 OK

## 10. Glossary
- **References**
	- Cloudflare Guide: Migrate from Netlify to Workers – https://developers.cloudflare.com/workers/static-assets/migration-guides/netlify-to-workers/ (used to augment Phase 0 & 1 tasks: build command inventory, wrangler config, assets handling, single page application not_found handling, namespace bindings, custom domain step to be executed during Cutover / Phase 4)

- Shadow Read: Read second provider without serving results from it.
- Dual Write: Write to both providers; read from primary only.
- Drift: Relative difference between metric snapshots.
- Fallback: Primary read failure causing secondary provider use.

## 11. Assumptions Mapping (Phase 0 Completion)
| Assumption | Current Netlify Blobs Behavior | Cloudflare KV Behavior | Action / Notes |
|------------|--------------------------------|------------------------|----------------|
| Overwrite is atomic per key | Last writer wins; blob replace | Put overwrites value (eventually consistent globally) | Accept. Stats snapshots treated as full replace. |
| Read-after-write (same region) consistency | Strong for subsequent function invocation in same region | Eventual (typically <1s) | Accept; metrics & shares tolerate slight delay. No user-facing stale issue expected. |
| Keys small / values JSON text | Yes (few KB) | Suitable (limit 25MB) | No change needed. |
| No partial update / increments | Entire JSON replaced | Same | Continue full snapshot writes. |
| Low write contention | True (single writer pattern) | Same | No CAS needed now; may add compareAndSwap later. |
| Listing not required | Not used | List available (but avoided) | Keep key names deterministic; no list call. |
| TTL not required | Not used | TTL optional | Leave unset. |

## 12. Dev Workflow (Phase 1)
1. Build frontend: `npm run build` (outputs `dist/`).
2. (Optional scaffold) Run a Worker locally later with `npx wrangler dev` once entry added.
3. Feature flag: set `CF_ADAPTER_ENABLE=true` in `.env` to exercise Cloudflare branch. With no bindings the app logs a warning and falls back silently. No runtime errors permitted.

Graceful Failure Behavior: If `CF_ADAPTER_ENABLE=true` and no `__CF_KV` binding for a requested namespace, a console warning is emitted (dev only) and Netlify / memory path used.

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
- [ ] Enumerate all `_store.js` call sites
- [ ] Confirm no direct `@netlify/blobs` imports outside `_store.js`
- [ ] Identify implicit assumptions (e.g. atomic overwrite) & map to KV semantics
- [ ] Draft adapter interface (get, set, listKeys?, compareAndSwap? (defer))
- [ ] (Operator) Create Cloudflare account (if not already) & enable Workers/KV
- [ ] (Operator) Create KV namespaces: shares (`EF_SHARES`), stats (`EF_STATS`), optional drift (`EF_DRIFT`)
- [ ] (Operator) Produce namespace IDs & desired binding names (not secrets) in chat
- [ ] (Assistant) Record namespace IDs & bindings in plan (no secrets), scaffold placeholder env variable names
- [ ] Inventory build command & output dir (expected: `npm run build` -> `dist/`)
- [ ] Audit environment variable usage (`process.env`) – list & classify (presence/absence)
- [ ] Confirm absence (or document presence) of custom redirects/headers (none expected)
- [ ] Note SPA nature (needs `not_found_handling: single-page-application`)
- [ ] Add external reference link to Cloudflare Netlify migration guide (see References section)
Exit Criteria: Checklist complete & logged.
Rollback: N/A (no runtime change).

### Phase 1 – Adapter Introduction
Checklist:
- [ ] Create `cloudflareAdapter.ts` (placeholder using in-memory Map)
- [ ] Feature flag env var `CF_ADAPTER_ENABLE=false`
- [ ] Wire selection logic (but keep Netlify active)
- [ ] Add `wrangler.jsonc` scaffold with: name, compatibility_date, `assets.directory="dist"`, `assets.not_found_handling="single-page-application"`
- [ ] Insert placeholder KV namespace bindings (no real IDs until operator provides)
- [ ] Create function mapping table (Netlify -> Cloudflare Worker route) in plan
- [ ] Document dev workflow: `npm run build` then `npx wrangler dev` (flag disabled)
- [ ] Validate that enabling flag without bindings fails gracefully (clear console warning, no crash)
Exit Criteria: Build passes; toggling flag in dev shows no runtime errors.
Rollback: Delete adapter file + selection branch.

### Phase 2 – Shadow Reads
Checklist:
- [ ] Implement real KV binding shim (still behind flag)
- [ ] For each read (shares, stats blob) fetch Cloudflare in parallel
- [ ] Compare JSON structure; record mismatch counters (client log or console warn dev only)
- [ ] Emit drift metric (optional) locally (not persisted)
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
```

## 9. Tokens Granted
(None yet)

## 10. Glossary
- **References**
	- Cloudflare Guide: Migrate from Netlify to Workers – https://developers.cloudflare.com/workers/static-assets/migration-guides/netlify-to-workers/ (used to augment Phase 0 & 1 tasks: build command inventory, wrangler config, assets handling, single page application not_found handling, namespace bindings, custom domain step to be executed during Cutover / Phase 4)

- Shadow Read: Read second provider without serving results from it.
- Dual Write: Write to both providers; read from primary only.
- Drift: Relative difference between metric snapshots.
- Fallback: Primary read failure causing secondary provider use.

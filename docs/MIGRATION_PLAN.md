# Netlify → Cloudflare Migration Plan (Historical / Archived)

> Status: Completed cutover on 2025-09-07. Cloudflare Pages + Worker + KV is the permanent primary. Netlify fallbacks were removed and legacy function code is retained only for historical reference pending final deletion. Remaining unchecked items in phases below were intentionally bypassed (direct cutover path) or superseded by final implementation choices. This document is preserved for audit trail; new persistence or platform changes should create a fresh plan rather than modifying historical phases.

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
| 3 Dual Write | (Skipped) | (Direct cutover chosen; dual write not executed) | N/A | N/A |
| 4 Cutover | MIGRATE PHASE4 OK | Cloudflare primary; Netlify fallback removed | Complete | Achieved 2025-09-07 (no fallback retained) |
| 5 Cleanup | (In progress) | Remove legacy Netlify function directory | Low | Pending short observation window |

## 3. Detailed Phases
### Branch Isolation / Sandbox Strategy (Temporary)
Until Cloudflare reaches full parity the repository workflow is intentionally split:

| Branch | Platform Deploying | Audience | Allowed Changes |
|--------|--------------------|----------|-----------------|
| `main` | Netlify (current production) | End users (stable) | Critical hotfixes only (avoid unless prod issue) |
| `systemselection` | Cloudflare Pages + Worker (sandbox) | Internal testing / validation | All migration + new instrumentation + experimental UI |

Rules:
1. Do NOT merge `systemselection` into `main` until parity criteria met (below) and cutover approved.
2. Cloudflare Pages project should point to `systemselection` branch (or manual `wrangler pages deploy` from that branch) for each test iteration.
3. Netlify continues auto-deploying from `main`; no Cloudflare writes should alter Netlify data except via existing Netlify Functions (dual write phase not yet enabled).
4. Migration scripts or KV seeding target Cloudflare namespaces only; no destructive ops on Netlify blobs.

Parity Criteria Prior to Cutover Proposal:
- Share create/get success rate on Cloudflare ≥ Netlify baseline (no observed failures in manual + scripted tests across varied payloads)
- Full EVENT_MAP counters & sums accumulating on Cloudflare with no schema divergence (spot-check JSON diff vs Netlify snapshot structure)
- Stats page (Cloudflare) renders all sections with non-zero counters after exercising features (routing, explore, transmission, overlay, reachability, region stats, compare regions, donations test clicks)
- Short share URL `/s/<id>` redirect works end-to-end and resolves share payload in app
- Usage batching (multi-event POST) accepted without 4xx errors

Pre-Cutover Checklist (when ready to migrate production):
1. Freeze `systemselection` (no new feature commits during cutover window)
2. Run migration script (final sync if any Netlify-only data needs seeding) – likely no-op given live dual write not yet active
3. Enable formal Phase 3 (dual write) if drift validation desired prior to flipping production (optional if sandbox already proven trustworthy and historical data minimal)
4. Tag commit on `systemselection` (e.g., `cf-cutover-candidate`)
5. Merge `systemselection` -> `main` (fast-forward preferred) and switch Cloudflare Pages production branch to `main`
6. Update DNS / public URL (point primary domain to Cloudflare Pages) and leave Netlify in read-only standby for 48h (rollback window)
7. After 48h with no rollback triggers, decommission Netlify site & remove Netlify-specific fallback code (Phase 5 cleanup)

Rollback During Sandbox Phase:
- Simply revert to using Netlify site (unchanged). Cloudflare sandbox issues isolated to `systemselection`; discard or fix there without user impact.

Documentation Impact:
- Decision log entry added (2025-09-07) referencing this strategy.
- No code path changes required beyond dynamic endpoint detection already implemented (usage/share/stats) – ensures dual-environment safety.

This section is temporary and will be removed at Phase 5 cleanup after successful cutover.

### Operator ↔ AI CLI Workflow (Sandbox Phase)
During the sandbox (branch `systemselection`) the non‑coder operator delegates all repository + deploy actions to the AI assistant. Assumptions & mechanics:

| Aspect | Assumption / Rule |
|--------|-------------------|
| Branch Source | All Cloudflare Pages + Worker deploys originate from `systemselection` (never from `main` until cutover). |
| Netlify Production | Continues auto‑deploying from `main`; AI does NOT trigger Netlify deploys directly (only via normal git push to `main` for hotfix, if approved). |
| CLI Access | Environment provides both `wrangler` (Cloudflare) and `netlify` CLIs; credentials (API tokens, account IDs, namespace IDs) are supplied by operator via env vars or secure secrets (never committed). |
| Token Injection | Operator can paste token/ID values on request; AI documents required variable names in response before use. |
| Build Step | Frontend build executed via `npm run build` inside `eve-frontier-map/`; output `dist/` consumed by Pages deploy. |
| Deploy Trigger | AI runs `wrangler pages deploy` (or `wrangler pages deploy dist --branch=systemselection`) after commit & push when operator requests new sandbox version. |
| Auditing | Every non‑trivial deploy (code or infra) receives a brief decision‑log entry (≤10 lines) summarizing intent & diff scope. |
| Rollback | If deploy exhibits regression, operator instructs AI to revert last commit (`git revert <sha>`) and redeploy; Netlify production unaffected. |

Minimal Deploy Sequence (AI internal checklist):
1. Apply code/doc changes.
2. Run: typecheck + build.
3. Commit & push to `systemselection`.
4. (If credentials present) Run Cloudflare Pages deploy.
5. Record decision log entry with deploy hash & summary.

Credential Handling Guidelines:
- Never store tokens in repo; use environment variables (e.g., `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `NETLIFY_SITE_ID`, `NETLIFY_TOKEN`).
- When new secret needed, AI outputs: NAME, purpose, scope (read/write), and operator supplies value in next message.
- If secret absent at deploy time, AI halts deploy, marks todo blocked, and requests only the missing values.

Verification Post‑Deploy:
- Hit `/api/health` (or Netlify `/.netlify/functions/health`) to confirm worker responding.
- Create a share; resolve via `/s/<id>`; check network console for 204 usage responses.
- Visit `/stats` ensuring counters increment after interaction burst.

This workflow remains until parity gates pass and cutover checklist (above) is initiated.

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

### Phase 3 – Dual Write (Skipped)
Direct cutover chosen after shadow validation / sandbox confidence; dual write complexity not required given low data volume & acceptable migration risk.

### Phase 4 – Cutover (Completed)
Executed 2025-09-07: Client fallbacks removed; worker endpoints sole backend. Latency & reliability acceptable; no rollback invoked.

### Phase 5 – Cleanup (Pending)
Primary remaining task: delete legacy `netlify/functions/` after brief monitoring; documentation already updated elsewhere. Reintroduction of fallbacks is out of scope.

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
2025-09-07: (Sandbox Strategy) Decided to keep `main` branch frozen for Netlify production; use `systemselection` branch exclusively for Cloudflare sandbox deployment (Pages + Worker) until full feature & metrics parity confirmed. No merges into `main` until cutover approval. Added Branch Isolation section documenting workflow & cutover checklist.
2025-09-07: Phase4 (cutover) executed: client fallbacks to Netlify removed (shares, usage, stats) – Cloudflare Worker /api endpoints are sole backend. Instructions file updated; migration_status advanced to phase4 with token recorded. Enter stabilization window prior to Phase5 cleanup (removal of legacy Netlify function directory). Rollback path: revert cutover commit to restore fallbacks if Worker misconfiguration discovered.
2025-09-07: Operator confirmations A-D: (A) Accept Cloudflare primary permanence; (B) Accept no further Netlify fallback reinstatement; (C) Proceed with merging `systemselection` -> `main` now; (D) Continue manual (CLI) Cloudflare deploys temporarily before enabling Git-based integration. Next actions authorized: perform merge, manual deploy from `main`, then observe metrics before Phase5 cleanup.

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

## 9. Tokens Granted (Historical Record)
MIGRATE PHASE0 OK
MIGRATE PHASE1 OK
MIGRATE PHASE2 OK
MIGRATE PHASE4 OK (Cutover)
MIGRATE CLEANUP (Pending – not yet granted at archive time)

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

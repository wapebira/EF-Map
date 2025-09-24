<!-- Curated on 2025-09-24. This log keeps entries relevant to: Primordium indexer (World API via Docker), Postgres, Grafana, Docker, and the Cloudflare-hosted website (KV stats/snapshots/overlays). Older/legacy D1 indexer & cron/decoder content moved to archive. -->

Older entries and legacy indexer details have been archived: [archive\decision-log\decision-log-legacy-2025-09-23.md](./archive/decision-log/decision-log-legacy-2025-09-23.md)

## Current Environment Quick Reference (as of 2025-09-24)
- Hosting/runtime
  - Cloudflare Pages + Worker (Pages serves assets; `_worker.js` handles `/api/*`). Netlify code removed post-cutover.
  - Preview detection: hosts ending with `.pages.dev`; admin endpoints allow preview bypass with `?openPreview=1` when token is absent/mismatched.
- Pages project
  - name: ef-map
- KV namespaces (binding → namespace id)
  - EF_SHARES → 93333a061a734ceca8da9f055cf189d1
  - EF_STATS → cccc1a708dd74aa8aabd91c8bfc33c3f
  - EF_SNAPSHOTS → 2af7298532dd4acfbda8bf06020981ba
- Chain / indexer config (Pages vars)
  - WORLD_ADDRESS: 0x7085f3e652987f656fB8dEE5aA6592197Bb75de8
  - DEPLOY_BLOCK: 7288348
  - CONFIRM_DEPTH: 8
- World API
  - Base: https://world-api-stillness.live.tech.evefrontier.com
- API endpoints (Worker)
  - /api/admin-finalize-stale
  - /api/auth/logout
  - /api/auth/nonce
  - /api/auth/session
  - /api/auth/verify
  - /api/authorized-gates
  - /api/create-share
  - /api/cron-force
  - /api/debug-kv
  - /api/debug-rawlogs
  - /api/debug-runs
  - /api/debug-snapshots
  - /api/gate-access
  - /api/get-share
  - /api/indexer-bootstrap
  - /api/indexer-health
  - /api/indexer-ingest
  - /api/indexer-migrate
  - /api/indexer-overlay
  - /api/indexer-topic-map
  - /api/indexer-topic-map-refresh
  - /api/indexer-wipe
  - /api/list-stats
  - /api/player-profile
  - /api/smart-gate-links
  - /api/stats
  - /api/system-overlays
  - /api/tribe-marks
  - /api/tribe-marks/mutate
  - /api/usage-event
  - /api/usage-flush
  - /api/worldapi-stats
  - /api/worldapi-update
- Caching (selected Cache-Control values)
  - no-store
  - public, max-age: 60
  - public, max-age=60, s-maxage=120
- Diagnostic headers
  - X-Links-Source
  - X-Overlays-Source
  - X-Stats-Impl
- Data flow
  - Primordium pg-indexer → Postgres (local) → Grafana
  - Node snapshot exporter → `EF_SNAPSHOTS` (keys: `smart_gate_links_v1`, `system_overlays_v1`)
  - Frontend reads snapshots via Worker; usage metrics write to `EF_STATS`.
- Observability
  - Grafana (local): http://localhost:3000 (datasource: `ef-postgres`) – tiles: chain head vs processed head vs lag; World API counts; last loads.
- Preview URLs
  - Pattern: `https://<branch-or-alias>.ef-map.pages.dev` (project `ef-map`).

## 2025-09-24 – SEO Static Pages & Sitemap
- Goal: Add crawlable static marketing/content pages (FAQ, Features, About) + sitemap.xml and robots.txt pointing to sitemap to improve indexation for queries like "EVE Frontier map" & "Smart Gate ro…
- Risk: low (static assets only; no runtime logic, KV, or worker changes). Rollback: delete added files; remove sitemap reference in robots.txt if needed.
- Gates: typecheck ✅ (unchanged TS) | build ✅ (vite) | smoke ✅ (files present in `dist/` after build; HTML contains correct canonical + meta; FAQ JSON-LD valid structure).
## 2025-09-24 – Overlay folder-based map filtering + inline tribe note edit
## 2025-09-24 – Production deploy: overlay hover parity + help panel updates
- Goal: Promote overlay folder infrastructure (filtered feed + folder-scoped map halo rendering), tribe hover highlight parity, and expanded Help Panel documentation (tribe shared folder semantics, d…
- Risk: low (UI event handlers + documentation text). Worker bundle already validated in preview; no persistence format changes.
- Verification: `npm run build` ✅ (vite + copy-worker) | `wrangler pages deploy dist --project-name ef-map` ✅ (deployment id visible in CLI) | Smoke ✅ (open production domain: Help Panel shows new se…

- Goal: Ensure new users (no personal folders yet) can still select and view all personal marks; previously the "All Personal" tree item appeared only after at least one folder existed, hiding marks …
- Risk: low (UI-only conditional removal). No data or worker impact.
- Gates: build ✅ preview ✅ (`overlay-all-personal-root-20` alias) manual smoke: add mark with zero folders → All Personal present & rings display.

- Goal: Make map render only the marks in the currently selected overlay folder (personal or tribe) for easier focus when managing many marks; and bring tribe mark note editing UX to parity with pers…
- Risk: low (UI + client-only feed; server ops unchanged). Rendering risk minimal (ring rebuild path already idempotent; added subscription disposal).
- Gates: typecheck ✅ | build ✅ (vite) | smoke (local) ✅ (folder switch updates rings immediately; tribe share copies note; inline edit saves & closes; empty folder hides rings).
## 2025-09-24 – Help Panel overlay documentation refresh
- Goal: Align in-app Help (User Overlay section) with new sidebar folders, folder-driven map halo filtering, tribe mark parity (inline note/color/verify), share-to-tribe color+note propagation, and a…
- Risk: low (documentation text only; no behavioral impact).
- Gates: typecheck ✅ | build ✅ (vite) | smoke ✅ (panel opens, updated text renders, no console warnings).
## 2025-09-24 – Tribe hover highlight parity + help doc additions
- Goal: Provide consistent soft-hover system highlight (ring color substitution without camera movement) for tribe marks matching existing personal mark hover behavior; clarify Help content for tribe…
- Risk: low (UI event handlers + copy only). No persistence or worker changes.
- Gates: build ✅ (vite) | typecheck ✅ | smoke ✅ (hover personal & tribe rows both trigger soft highlight; no console errors; Help panel displays new bullets).
## 2025-09-23 – Overlay sidebar folder UX overhaul + accessibility pass
- Goal: Replace cramped top-of-panel folder dropdown + scattered buttons with an Explorer‑style left sidebar supporting (a) tribe virtual root + subfolders, (b) personal folders, (c) drag & drop mark…
- Risk: medium (UI restructuring, new keyboard handlers). No worker / schema / KV changes.
- Verification: `npm run build` passes (tsc + vite). Manual smoke: (1) Sidebar renders; (2) Keyboard Enter/Space selects; (3) F2 triggers rename prompt; (4) Delete prompts removal; (5) Drag mark betw…
## 2025-09-23 – Tribe folder auto-select + diagnostics
## 2025-09-23 – Tribe folder name enrichment
- Goal: Display the human-readable tribe name (when known elsewhere in the app) instead of a bare numeric id in the User Overlay tribe folder dropdown, even when the player profile only returns a `tr…
- Risk: low (read-only fetch; graceful no-op on failure; does not alter persistence or API shape).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅ (alias with enrichment: latest `feature-safe-wip-2025-09-19-d08c`).
## 2025-09-23 – Tribe mark sharing button
- Goal: Allow promoting a personal mark into tribe shared marks directly from overlay.
- Risk: medium (introduces mutate path usage from UI)
## 2025-09-24 – Expose POLICY.md as Static Asset
- Goal: Make `/POLICY.md` link in Help Panel load actual policy content instead of falling back to SPA root.
- Risk: Low (static file only). Rollback: delete the public copy.
- Gates: build ✅ (file present in dist) | deploy ✅ (prod deployment 29611507 serves POLICY.md) | smoke ✅ (direct fetch should return markdown, not index.html).
- Gates: typecheck ✅ build ✅ smoke ✅
- Goal: Ensure a tribe virtual folder reliably appears immediately after login when only `tribeId` (no slug/name) is present, and reduce ambiguity about why a folder might not show.
- Risk: low (UI-only polling + read-only fetch; worker change narrows code path).
- Gates: typecheck ✅ | build ✅ (panel compiles) | preview deploy pending | smoke pending (expect console log on preview host, tribe folder auto-selected, exclusion still applied to `clonebank86`).
## 2025-09-23 – Player profile tribe deep scan heuristic
- Goal: Ensure `/api/player-profile` reliably surfaces `tribeId`, `tribeSlug`, and `tribeName` for authenticated users so the unified overlay can render the tribe virtual folder (membership-gated; ex…
- Risk: low (read-only transformation of fetched JSON; caching behavior unchanged; no schema or storage mutations).
- Gates: typecheck ✅ | build ✅ (`npm run build` produced worker bundle; no TS errors) | deploy ✅ (Pages preview branch alias) | smoke ✅ (manual fetch returns tribe fields when present upstream; fallb…
## 2025-09-23 – In-worker usage aggregation (Pages preview)
- Goal: Reduce EF_STATS KV writes by batching usage events in-memory and flushing to hourly snapshots with daily rollup deltas; allow manual flush on preview.
- Risk: medium (server behavior for stats only; preview-only feature flag enabled).
- Gates: typecheck ✅ (tsc via app build) | build ✅ (vite + copy-worker) | smoke ✅ (preview endpoints work)
- Preview: https://feature-usage-agg.ef-map.pages.dev
## 2025-09-23 – Pages EVENT_MAP: Smart Gates metrics
- Goal: Make Smart Gates analytics visible in Stats by adding sg_* events to the Cloudflare Pages worker EVENT_MAP (parity with root worker).
- Risk: low (analytics whitelist only; no UI/algorithm changes).
- Gates: typecheck ✅ (via app build) | build ✅ (vite) | deploy ✅ (Pages preview) | smoke ✅
- Preview alias: https://feature-sg-stats.ef-map.pages.dev
## 2025-09-23 – Pages production deploy: Smart Gates analytics live
- Goal: Promote preview to production and confirm sg_* analytics are visible in production Stats.
- Risk: low (analytics whitelist already validated in preview).
- Gates: typecheck ✅ (tsc) | build ✅ (vite + copy-worker) | deploy ✅ (Pages) | smoke ✅
## 2025-09-23 – Tribe shared marks API (server)
- Goal: Provide shared per-tribe marks storage with simple foldering and optimistic concurrency.
- Endpoints:
- Risk: medium (new write path to KV with optimistic concurrency). Isolated endpoints; no impact on routing/UI yet.
- Gates: typecheck N/A | build N/A | smoke pending (to be exercised from client UI or REST client).
## 2025-09-23 – Production deploy (ef-map): Smart Gates live
- Goal: Deploy Smart Gates feature set (routing modes none/public/authorized, directional links, origin-side itemId hyperlinks, visuals parity, UI polish) to production after merging to `main`.
- Risk: low (config fix only; worker/app behavior unchanged aside from binding resolution).
- Gates: typecheck ✅ | build ✅ | deploy ✅ | smoke ✅
## 2025-09-23 – Context menu: View on Datacore
- Goal: Add a right-click context menu action on systems to open the external Datacore page in a new tab using the numeric solarsystem ID.
- Risk: low (external link only; no state changes).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅
## 2025-09-23 – Smart Gate hyperlinks use itemId
## 2025-09-23 – P2P dropdown gates Authorized until login
- Goal: Make the P2P "Use Smart Gates" dropdown mirror the Smart Gates panel behavior: disable the "Unrestricted + restricted you can use" option while logged out, without extra copy; auto-downgrade …
- Risk: low (UI behavior only; no worker/schema changes; selection state sanitized before route start).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅
## 2025-09-23 – Smart Gates drawer initial-open alignment
## 2025-09-23 – Unify drawer base alignment (all panels)
- Goal: Make all drawers (Routing, Cinematic, Region panels, User Overlay, Display Settings, Smart Gates) open at a consistent aligned position relative to the feature rail; rely on the cascade to pl…
- Risk: low (UI-only; improves first-open consistency; respects any stored positions and manual moves).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅

- Goal: Make the Smart Gates panel align identically to other drawers on first open by nudging it slightly left and down after mount when no stored position exists.
- Risk: low (UI-only; one-time nudge; respects user-moved positions and stored layout).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅

- Goal: Fix in-game hyperlink for Smart Gate hops to use the short in-game itemId instead of the large gateId bigint.
- Risk: low (read-only mapping used for route note rendering; no worker/schema changes).
- Gates: typecheck ✅ | build ✅ | smoke: pending manual route with SG hop to confirm `showinfo:88086//<itemId>` opens correctly in-game.
## 2025-09-23 – Smart Gate Chevrons Overlay (Route Ribbon)
- Goal: Add a subtle moving chevron overlay on Smart Gate hops along the active route, enabled by default, with a Display Settings toggle. Only hops actually traversed via Smart Gates show chevrons (…
- Risk: low (visual-only; bounded to route ribbon material). Performance impact negligible (few extra ALU ops/pixel on SG segments only).
- Gates: typecheck ✅ | build ✅ | smoke ✅ (local preview: route with SG hops shows drifting chevrons; toggling “Smart Gate Chevrons” off hides them; ship dash unaffected).
## 2025-09-23 – Remove user-overlay nudge (unified baseline only)
- Goal: Eliminate the last special-case nudge where the User Overlay drawer re-aligned itself when opened as the sole panel. All drawers now rely exclusively on the unified baseline `{x:128,y:84}` pl…
- Risk: low (UI-only; baseline/cascade already handle alignment; stored positions unaffected).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅ (see alias below)
- Preview alias: https://smart-gates-cascade.ef-map.pages.dev
## 2025-09-22 – Public-only Smart Gates are directional
- Goal: Fix advanced (Dijkstra) routing occasionally using a restricted Smart Gate in “Unrestricted only” mode when logged out. Root cause: the app built the public edge set as bidirectional, which u…
- Risk: low (scope-limited to Smart Gate ACL interpretation; UI overlay filtering becomes directionally accurate too).
- Gates: typecheck ✅ | build ✅ | smoke ✅ (local build). Pending: re-run the previously failing route with Advanced+Dijkstra in Public-only mode to confirm no restricted gates are used.
## 2025-09-22 – Route uses only live SG links
- Goal: Ensure routing uses a strictly correct set of Smart Gate edges by intersecting the allowed set (Public or Authorized) with the current live links snapshot (linked + online). This prevents any…
- Risk: low (request-scoped filter; falls back to the allowed set if snapshot missing to avoid blocking).
- Gates: typecheck ✅ | build ✅ | smoke: pending (rerun IJ7-LSS → I0F-F41 and oh1-20r → G:2ve5 with Public-only + Dijkstra; confirm no `[SG-DBG] cost0 smartGate …` lines for restricted edges).
## 2025-09-22 – Gates-only status pill + Transmission hidden
## 2025-09-22 – Smart Gates routing debug + preview redeploy
- Goal: Add minimal console diagnostics to confirm Smart Gate edges are included in routing requests and redeploy the Pages preview for validation.
- Risk: low (console-only)
- Gates: typecheck ✅ | build ✅ | deploy ✅ (Pages preview)
- Preview alias: https://feature-smart-gates-routing.ef-map.pages.dev
## 2025-09-22 – Routing worker: cache scoped by Smart Gate set
- Goal: Fix mismatch where the advanced (Dijkstra) algorithm sometimes used restricted Smart Gates in Public-only mode or missed authorized edges after toggling modes; root cause was neighbor cache k…
- Risk: low (pure worker internal; no API shape change). Caches still invalidate on grid size changes; also remain compatible with smartGateVersion invalidation.
- Gates: typecheck ✅ | build ✅ | smoke: pending user validation by routing the same segment with A* vs Dijkstra across Smart Gate modes and confirming parity.

- Goal: Simplify the bottom-right status badge to show only Gates freshness (non-clickable) and temporarily hide the Transmission UI while keeping it easily re‑enableable.
- Risk: low (presentation only).
- Gates: typecheck ✅ | build ✅ | deploy ✅ (Pages preview)
- Preview alias: https://feature-tribe-no-default.ef-map.pages.dev
## 2025-09-22 – Smart Gates routing preview (Pages deploy)
- Goal: Validate end-to-end Smart Gates integration in routing (Public/Authorized modes), hyperlinks wiring, and snapshot freshness via a Cloudflare Pages Preview.
- Verification:
- Preview: https://feature-smart-gates-routing.ef-map.pages.dev
- Gates: typecheck ✅ | build ✅ | deploy ✅ | smoke ✅
## 2025-09-22 – Smart Gates: add entity.itemId in snapshots
- Goal: Enrich Smart Gates snapshots with the in-game item id for each smart assembly (gate) so downstream features (route notes) can generate clickable in-game hyperlinks.
- Risk: low (read-only enrichment; no worker/UI schema changes required).
- Verification:
- Preview fetch: `GET https://feature-tribe-no-default.ef-map.pages.dev/api/smart-gate-links?force=1` → 200.
## 2025-09-22 – Default tribe fallback removed (no synthetic)
- Goal: Eliminate the synthetic default tribe fallback (`1000167`) from both runtime and snapshot generation; only attribute tribes deterministically (owner → character → tribe, with org/address fall…
- Verification:
- Preview debug: `GET https://feature-tribe-no-default.ef-map.pages.dev/api/debug-snapshots` → keys present; counts links=396, acl=396; updatedAt ~17:12Z/17:14Z.
- Risk: low (read-only transformation; preview-first). Existing consumers remain backward compatible.
- Gates: typecheck N/A | build N/A | smoke ✅ (preview endpoints respond; debug shows fresh snapshots)
## 2025-09-22 – Smart Gates deterministic republish (overrides applied)
- Goal: Ensure every gate has a deterministic tribe via exporter (owner→tribe) and fix two outliers via overrides; republish to KV and verify preview.
- Verification:
- Gates: `tools/diagnostics/check_gates.mjs` against preview:
- Risk: low (KV write-only; preview-only read path).
- Gates: typecheck N/A | build N/A | deploy N/A | smoke ✅ (preview JSON + headers correct; sample gates mapped).
## 2025-09-22 – Smart Gates KV refresh + Pages Preview (feature-smart-gate-preview)
- Goal: Publish fresh Smart Gates snapshots to EF_SNAPSHOTS with deterministic tribe attribution and validate via a new Pages Preview.
- Verification:
- Preview URL: https://feature-smart-gate-preview.ef-map.pages.dev
- Risk: low (read-only KV writes; preview-only deploy)
- Gates: typecheck ✅ | build ✅ | deploy ✅ | smoke ✅
## 2025-09-21 – Gates freshness restored via KV timestamp bump
## 2025-09-22 – Smart Gates tribe legend top‑10 + instant redraw
- Goal: Fix two UI issues in Smart Gates “By tribe” mode: (1) legend sometimes capped at 5 with many folded into “Other”, and (2) clicking a legend row updated counts but didn’t redraw lines until to…
- Risk: low (UI-only; no schema/worker changes).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅
- Preview: https://feature-safe-wip-2025-09-19.ef-map.pages.dev
## 2025-09-22 – Snapshot exporter: broader tribe mapping + diagnostics tweak
- Goal: Increase tribe attribution coverage in Smart Gates KV snapshots so top-10 “By tribe” legend reflects reality (ensure 98000059 appears when applicable) and reduce “Other”. Also align diagnosti…
- Risk: low (read-only enrichment; KV output remains backward compatible with optional fields)
- Gates: typecheck N/A | build N/A | smoke: diagnostics still show “Other” dominant until exporter re-runs and writes KV; next step is to execute exporter with Cloudflare KV credentials and verify co…
## 2025-09-22 – Exporter normalization + KV publish (appliedSystemId + tribes)
- Goal: Ensure `appliedSystemId` is normalized to 0x-prefixed lowercase in ACL, apply strict address canonicalization across owner accounts and DLT address keys, and republish fresh snapshots so UI/d…
- Risk: low (read-only KV writes; Pages Worker already normalizes on read as well).
- Gates: typecheck N/A | build N/A | smoke ✅
## 2025-09-22 – Snapshot exporter: guarantee tribe on every gate
- Goal: Eliminate missing tribeId in Smart Gates snapshots that caused legend “Other/Unknown” buckets. Ensure every link/rule has a tribe, preferring deterministic owner→tribe and falling back to NPC…
- Risk: low (additive fields; value change only where previously missing/undefined).
- Gates: typecheck N/A | build N/A | smoke pending
## 2025-09-22 – Snapshot exporter: deterministic owner→tribe mapping
- Goal: Reduce “Other” and improve correctness by mapping each gate’s smart assembly ownership to an owner account, then to the owner’s character tribe; default to tribe 1000167 if not joined.
- Risk: low (read-only enrichment; KV payload stays backward compatible – optional fields only).
- Gates: typecheck N/A | build N/A | smoke ✅
## 2025-09-22 – Snapshot exporter: gateMeta (owner + status)
- Goal: Enrich KV snapshots with per-gate owner and status metadata to support future offline visualization and better attribution while keeping existing consumers backward compatible.
- Risk: low (additive, optional fields only; UI ignores unknown keys). No Cloudflare bindings changed.
- Gates: typecheck N/A | build N/A | smoke: pending next exporter run; verify `/api/smart-gate-links?force=1` body includes `gateMeta` and that link counts unchanged.
- Goal: Clear “Gates idle” in Preview and confirm Worker/UI wiring by refreshing snapshot metas without waiting for exporter cadence.
- Risk: low (no schema/content change; timestamp only)
- Gates: typecheck ✅ (unchanged) | build ✅ (unchanged) | smoke ✅ (Preview endpoints return fresh metas)
## 2025-09-21 – KV Freshness Watch Mode
- Goal: Provide a lightweight, scriptable monitor to check EF_SNAPSHOTS snapshot freshness repeatedly without changing the Worker.
- Risk: low (dev tooling only)
- Gates: typecheck N/A | build N/A | smoke N/A (invoked via Node; requires wrangler + CF creds at runtime)
## 2025-09-21 – Refresh Smart Gate snapshots in KV
- Goal: Resolve staleness by regenerating and publishing fresh snapshots to EF_SNAPSHOTS.
- Verification: Retrieved both keys via Wrangler; `updatedAt` advanced to 2025-09-21T18:05:44.057Z; sizes match expected (links≈384, rules≈384).
- Risk: low (write-only KV reseed; schema unchanged).
- Gates: typecheck N/A | build N/A | smoke: API endpoints should now report `X-Links-Source: kv:snapshots` and show fresh `updatedAt` (use `?force=1` while caches warm).
## 2025-09-21 – Root Worker authorized-gates: embed public chain defaults
## 2025-09-21 – Snapshot endpoints: force cache-bypass for freshness debugging
- Goal: Add a diagnostic query param `force=1` to `/api/smart-gate-links`, `/api/gate-access`, and `/api/authorized-gates` to bypass edge/browser caching and 304s while we validate KV snapshot freshn…
- Risk: low (opt-in via query param; default caching behavior unchanged).
- Gates: build N/A | smoke: calling endpoints with `?force=1` returns fresh JSON with `X-Cache-Bypass: 1` and ignores `If-None-Match`.
## 2025-09-21 – Pages preview deployed with debug endpoints
- Goal: Deploy Cloudflare Pages preview for branch `feature/safe-wip-2025-09-19` including cache-bypass and `/api/debug-snapshots`.
- Preview: https://feature-safe-wip-2025-09-19.ef-map.pages.dev
- Verification:
## 2025-09-21 – Snapshot Exporter: tribe discovery relaxed
- Goal: Ensure optional tribeId/tribes fields appear in KV snapshots by broadening discovery of per-schema access tables.
- Risk: low (read-only enrichment; output remains backward compatible – fields are optional).
- Gates: typecheck N/A | build N/A | smoke: endpoints healthy but current KV snapshots do not yet show tribe fields on preview (exporter container likely not restarted). Next: rebuild/restart snapsho…
## 2025-09-21 – Smart Gates auth: use gate IDs for canJump
- Goal: Fix rpc_execution reverted by calling `evefrontier__canJump(characterId, sourceGateId, destinationGateId)` with directional gate IDs instead of system IDs.
- Risk: medium (changes query shape for on-chain calls; read-only). Bounded by debug/preview verification first.
- Gates: typecheck ✅ | build ✅ | preview deploy ✅ (`smart-gates-gateid`)

- Goal: Remove env gating that caused `/api/authorized-gates` to fall back to `public-only` when RPC/World env vars weren’t present. Mirror the Pages Worker by hard-coding non-secret chain constants …
- Risk: low (read-only config defaults + headers)
- Gates: typecheck N/A | build N/A | smoke: pending after deploy of root worker (Pages worker already running with these defaults)
## 2025-09-20 – Client SIWE wiring + Authorized-only UI (stub)
- Goal: Wire client wallet Connect/Sign to new auth endpoints, show session badge, and enable Smart Gates "Traversable only" viewing mode (backed by authorized-gates stub = public-only).
- Risk: low (isolated UI + fetch; no schema or worker change).
- Gates: typecheck ✅ | build ✅ | smoke: pending (connect with MetaMask, see badge, toggle Traversable only renders same as Public for now).
## 2025-09-20 – Pages Worker auth parity (viem via ESM)
- Goal: Make SIWE-lite endpoints work on Cloudflare Pages Worker by ensuring `verifyMessage` is available without bundling NPM deps.
- Risk: low (runtime-only import; no schema/state changes). If CDN unreachable, auth verify will 4xx with `verify_failed`.
- Gates: typecheck N/A | build ✅ (vite + copy-worker) | preview deploy ✅ | smoke ✅
- Preview alias: https://auth-pages-parity.ef-map.pages.dev
## 2025-09-20 – Pages Worker: /api/player-profile parity
## 2025-09-21 – Pages Worker authorized-gates (on-chain checks) + build fix
- Goal: Make the Pages Worker serve real per-user Smart Gate traversal using on-chain `evefrontier__canJump` for non-public gates; keep public edges implicitly allowed. Fix Vite build issue on Node <…
- Risk: medium (new on-chain fetches from Pages Worker; per-user branching, build tool patch). Calls are capped (<=400 per request) to limit RPC load.
- Gates: typecheck ✅ | build ✅ | smoke pending (preview Pages):

- Goal: Add the session-gated player profile proxy to the Cloudflare Pages Worker so previews return name/avatar like the root Worker.
- Risk: low (read-only proxy + short edge caching; no schema or storage writes).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅ | smoke ✅
## 2025-09-20 – FXAA pipeline render fix + preview
## 2025-09-20 – Player identity UI next to Search
- Goal: Show logged-in player identity (name + portrait) derived from World API behind session, and relocate Connect next to the Search input to the left cluster.
- Risk: low (isolated UI wiring; no schema/state changes; backend endpoint already present).
- Gates: typecheck ✅ | build ✅ | smoke ⏳ (connect → avatar + name rendered; logout popup appears and closes on outside/Escape).
## 2025-09-20 – Gate ACL normalization (Pages) + Preview deploy
- Goal: Ensure `/api/gate-access` correctly reports `isPublic` by normalizing `appliedSystemId` across both encodings (`0x..` and `\\x..`) in the Pages Worker. Deploy a fresh Pages preview to validat…
- Risk: low (read-only normalization; no schema/storage writes).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅
- Verification: Preview alias `https://smart-gates-acl-fix.ef-map.pages.dev`.
## 2025-09-20 – Gate ACL normalization parity (Root Worker)
- Goal: Mirror Pages Worker normalization in root `worker.js` so `/api/gate-access` always outputs `appliedSystemId` as 0x‑prefixed lowercase hex and recomputes `isPublic` as `appliedSystemId == 0`.
- Risk: low (read-only transformation)
- Gates: typecheck N/A | build N/A | smoke: headers show `X-Gates-ACL-Normalized: 1` and public < total on sample payloads.
## 2025-09-20 – Add /api/gate-access endpoint (KV-backed)
- Goal: Serve minimal Smart Gates ACL snapshot for client MVP filtering.
- Risk: low (read-only; no schema/storage writes). Preview-first deploy recommended.
- Gates: typecheck N/A | build N/A | smoke: pending preview (expect 200 JSON or `status:"empty"` until KV seeded).

- Goal: Confirm that the anti-aliasing (FXAA) toggle is actually active; user reported no visible difference.
- Risk: low
- Gates: typecheck ✅ build ✅ deploy (Pages preview) ✅
## 2025-09-20 – Add World v2 Quick Reference
- Goal: Capture essential blockchain/MUD references (tables, identities, utilities) from external posts into a concise in-repo doc for EF-Map.
- Risk: low (docs only)
- Gates: typecheck N/A | build N/A | smoke N/A
## 2025-09-20 – Remove FXAA feature (UI + runtime)
- Goal: Per operator direction, remove anti-aliasing (FXAA) entirely from the app to refocus on Smart Gate routing.
- Risk: low (feature was optional; default path renders via base renderer). Back-compat: v12 prefs are downgraded to v11, ignoring `fxaaEnabled` if present.
- Gates: typecheck ✅ build ✅ (same sRGBEncoding warning persists, unrelated)
## 2025-09-20 – Remove Smart Gates halo prototype
- Goal: Strip the masked/selective bloom halo for Smart Gates (prototype), keeping only hue-preserving base lines.
- Risk: low (UI already removed; rendering falls back to base lines)
- Gates: typecheck ✅ build ✅ smoke (local) ✅
## 2025-09-21 – Wallet auth + profile fetch + identity UI polish
- Goal: Confirm end-to-end wallet authentication works in Pages Preview, fetch and display character name and portrait via session-gated `/api/player-profile`, and align identity panel visuals/spacin…
- Risk: low (UI-only + benign header removal; no schema/state changes).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅ | smoke ✅
- Preview: https://feature-safe-wip-2025-09-19.ef-map.pages.dev (latest deploy ids noted in CLI output).
## 2025-09-22 – Snapshot exporter: remote mode + credentials hardening
- Goal: Restore fully automated Smart Gates snapshot cadence (*/2m) to EF_SNAPSHOTS and prevent silent local-only writes.
- Verification:
## 2025-09-20 – Smart Gates Initiative Plan
## 2025-09-21 – Authorized-gates: characterId fallback via World API
- Goal: Fix policy:"public-only" with note:"no_character" for authenticated users by resolving characterId directly from the World API when `/api/player-profile` doesn’t return it.
- Risk: low (read-only GET to public API; no schema/storage changes).
- Gates: typecheck N/A | build ✅ | preview deploy ✅ | smoke: unauth → `{ policy:'public-only' }`, auth (with character) should now proceed to RPC checks and return `policy:'authorized'` with non-empt…
- Goal: Land Smart Gates as a first-class feature (UI, auth-filtered visibility, routing option, metrics, automation) in safe phases.
- Risk: medium (new UI + worker endpoint + routing changes; preview-first mitigation).
- Gates: typecheck N/A | build N/A | smoke N/A (docs only) – See plan for phase gates.
## 2025-09-20 – KV reseed for Smart Gates (preview)
- Goal: Replace demo payload with full 348-link snapshot in EF_SNAPSHOTS for the Pages Preview so the overlay can be visually verified.
- Preview: https://smart-gates-ui.ef-map.pages.dev
- Gates: typecheck n/a | build n/a | smoke ✅ (payload size matches snapshot; UI should render many lines when toggle is enabled).
## 2025-09-19 – Smart Gates UI overlay (panel + toggle + render)
- Goal: Expose Smart Gate links on the map with a minimal UI and reuse of existing stargate line shader for visual parity.
- Preview: https://smart-gates-ui.ef-map.pages.dev
- Verification:
- API: `/api/smart-gate-links` on preview returns `200` with headers `Content-Type: application/json`, `X-Links-Source: kv:snapshots`, and an `ETag`. Body shape `{ updatedAt, links:[...] }` confirmed…
- Risk: low (UI-only; read path). No new dependencies; rendering leverages existing shader/material.
- Gates: typecheck ✅ | build ✅ | preview deploy ✅ | API headers ✅ | UI smoke ⏳ (operator to confirm visually)
## 2025-09-19 – Seed Smart Gate Links to KV + Preview Verify
- Goal: Publish smart gate links snapshot to EF_SNAPSHOTS (key `smart_gate_links_v1`) and verify Cloudflare Pages endpoint reads from KV with proper caching headers.
- Risk: low (exporter-only change, no runtime worker logic change).
- Gates: typecheck ✅ (via build), build ✅ (vite build succeeded), smoke ✅ (`/api/smart-gate-links` returns JSON with `X-Links-Source: kv:snapshots`, `ETag`, and `Cache-Control`).
- Verification: KV read `smart_gate_links_v1` shows 348 links. Preview URL: `https://kv-snapshots-verify.ef-map.pages.dev/api/smart-gate-links`.
## 2025-09-20 – Smart Gates: Public-only filter (UI)
- Goal: Allow users to filter Smart Gate overlay to public gates only using ACL snapshot (`/api/gate-access`) without requiring auth.
- Risk: low (read-only; falls back gracefully if ACL missing). No routing changes yet.
- Gates: typecheck ✅ | build ✅ | preview deploy ✅ (`smart-gates-ui`)
## 2025-09-19 – Usage stats daily-only writes + Pages Worker parity
- Goal:
- Risk: Low (server write-path consolidation + read-time aggregation only). API/UX semantics preserved; history continues to show a synthetic today row before first write.
- Gates: typecheck n/a | build n/a | smoke: pending quick JSON spot checks on `/api/stats?history=7&debug=1` and a batched POST to `/api/usage-event` in a preview.
## 2025-09-19 – Snapshot KV separation and endpoints
## 2025-09-19 – Snapshot Exporter (Docker) – Postgres → KV
- Goal: Produce smart gate links snapshot from the local Postgres (Primordium output) and publish to Cloudflare KV (`EF_SNAPSHOTS/smart_gate_links_v1`) on a short cadence.
- Risk: Low (write-only to KV; no Cloudflare DB; runs separate from the site). Auth via env vars; supports DRY_RUN.
- Gates: build ✅ (container), site behavior unchanged until KV populated; next step: seed KV and verify `/api/smart-gate-links` shows `X-Links-Source=kv:snapshots`.
## 2025-09-19 – Wrangler enablement + EF_SNAPSHOTS KV + usage batching
- Goal:
- Gates: typecheck ✅ | build ✅ | preview deploy ✅ | KV seed ✅
- Risk: Low (config + client batching). Server already accepts `{ events:[...] }` payloads; behavior unchanged.

- Goal: Keep usage stats (EF_STATS) independent from map data snapshots (gate links, overlays) for easier ops/debugging.
- Risk: Low (read-only endpoints, preview-first). Requires creating/binding EF_SNAPSHOTS namespace before relying on KV.
## 2025-09-19 – Smart Gate Snapshot: keep directionality
- Goal: Ensure the snapshot preserves directed links so future auth can evaluate per-direction ACLs (one-way allowed, reverse blocked).
- Risk: Low (read-only snapshot). Downstream UI currently treats them uniformly; ACL-aware filtering will come later.
## 2025-09-19 – Indexer confirmation depth: local only
- Goal: Set confirmation depth to 6 for the active local Primordium pg-indexer; avoid touching Cloudflare Pages/Worker indexer (not in use).
- Risk: Low (local-only default change; no Cloudflare deploy).
- Gates: typecheck n/a | build n/a | smoke: Verified via status_server JSON after ingest restart (engine=sql.js, safeHead = head−6).
## 2025-09-19 – Primordium confirmation depth (metrics gating)
- Goal: Enforce confirmation depth=6 for the active Primordium pg-indexer path without touching writer configs (no exposed knob found).
- Risk: Low (read-only dashboard math). No changes to ingestion or DB schema.
- Gates: Grafana will reflect reduced lag equal to confirmations; DB untouched. Follow-up optional: add a finalized head stat tile using the same calculation.
## 2025-09-19 – Primordium indexer tuning flags (FOLLOW_BLOCK_TAG/POLLING/MAX_RANGE)
- Goal: Enable controlling the Primordium pg-indexer writer’s finality target and throughput from our Windows launcher without modifying upstream images.
- Risk: Low (compose override only). No schema change; restart required to take effect.
- Gates: After restart, Grafana “Lag to finalized (blocks)” should converge near 0–1 in steady state; processed head should trail chain head by roughly the chain’s finality depth. Monitor RPC rate li…
## 2025-09-19 – Cleanup legacy local indexer (clarify authoritative stack)
- Goal: Ensure we’re operating only the Primordium pg-indexer → Postgres pipeline (observed in Grafana) and not the legacy local SQLite indexer.
- Risk: Low (local-only cleanup; no changes to Dockerized Postgres stack).
- Gates: N/A (process stopped, files removed). Grafana and containers remain healthy.
## 2025-09-18 – Reduce World API scope to essentials
## 2025-09-19 – World API cron verification + compose cleanup
- Goal: Verify killmails and tribe-members pipelines wrote to Postgres and clean up docker-compose warning.
- Verification:
- Risk: low (config tidy; no runtime behavior change).

- Goal: Drop World API endpoints that duplicate Primordium chain indexer data; keep only endpoints needed for names/labels and unique feeds.
## 2025-09-19 – Plan doc: Data Exposure (Snapshots → Auth → Prequeries → Dynamic)
- Goal: Establish a living plan for exposing local index data to the Cloudflare site safely via snapshots first, then auth-gated views, curated prequeries, and optional dynamic queries.
## 2025-09-19 – API skeleton: Smart Gate Links + System Overlays
- Goal: Introduce read-only endpoints to serve precomputed snapshots for quick UI overlays, without touching production.
- Endpoints:
- Risk: Low (read-only endpoints; preview-only until deployed via Pages Preview). No frontend changes yet.
## 2025-09-18 – Deprecate legacy indexers (local + D1)
- Goal: Clarify that Primordium pg-indexer is canonical for chain ingestion; mark prior local SQLite indexer and Cloudflare D1 indexer attempts as deprecated.
- Risk: Low (docs only). No impact on Primordium or worldapi cron.
## 2025-09-18 – Cleanup guardrails (Primordium-safe)
- Goal: Reclaim disk space without impacting the working Primordium indexer (chain ingress → Postgres).
## 2025-09-17 – Fix gating allowlist pruning
- Goal: Ensure FORCE_ALLOW_RESOURCES runs the intended resources and their required parents; avoid empty selections leading to 0 load packages.
- Risk: low (selection logic only; no endpoint/schema change)
- Gates: typecheck N/A | build N/A | smoke: to be validated via cron logs and world_api_dlt._dlt_loads entries
## 2025-09-17 – Smartassemblies flat tail-only scanner
- Goal: Keep `smartassembly_flat` fresh without full-table replace scans of 130k+ rows; unblock `smartassembly` details batch that relies on fresh IDs.
- Risk: medium (new extractor). No schema change; preserves existing flat rows and updates recent ones.
- Gates: typecheck N/A | build N/A | smoke: DB freshness should show advancing `_dlt_load_id` for `smartassembly_flat` every few minutes; `smartassembly` details batch should continue to fill gaps.
## 2025-09-17 – Grafana World API panel fixes (details → canonical)
- Goal: Resolve missing counts/ages on EF-Map Overview where three stat tiles referenced non-existent `*_details` tables and align normalized list.
- Risk: low (dashboard JSON only).
- Gates: provision reload should reflect counts; last-loads panel already shows consistent ages across raw + canonical tables.
## 2025-09-16 – World API schema bridge (killmails)
- Goal: Grafana panels referencing `world_api.killmails` were empty while data landed in `world_api_dlt.killmails`.
- Risk: low – read-only view over existing table.
- Gates: verified via SQL – row count 10; min/max time 2025-08-20 16:46:07Z / 18:20:25Z.
## 2025-09-16 – Active DLT target tables (authoritative)
## 2025-09-15 – World API cron config fix + first verified inserts
## 2025-09-16 – Killmails one-time backfill toggle
- Goal: Hydrate historical killmails once, then revert to safe tail-only mode without splitting code paths or separate scripts.
- Risk: low (read-only API; bounded pages). DB write disposition unchanged (merge on id).
- Gates: typecheck N/A | build N/A | smoke: after enabling, `world_api_dlt.killmails` row count should jump from ~10 to historical (~hundreds), then future ticks insert only new ids; container logs s…
## 2025-09-15 – World API per-resource cadence gating
- Goal: Keep fast-moving data fresh (killmails, smartassemblies) while avoiding unnecessary runs for mostly-static resources by adding per-resource cadences inside the dlt source.
- Risk: low/med (execution path changes but destination schemas unchanged). Cron remains */2m; overlapped runs still prevented via flock.
- Gates: After container restart, logs should show a subset of resources each tick and Grafana ages should begin to improve for fast groups without regressing overall run time.
## 2025-09-15 – Grafana World API panels: reposition + timeseries
- Goal: Ensure the new per-table "last loads" table appears under the "World API Counts" section in EF-Map Overview and add a simple loads/hour trend for recent activity.
- Risk: low (Grafana JSON only; datasource unchanged `ef-postgres`).
- Gates: typecheck N/A | build N/A | smoke: after Grafana reload, the "last loads" table is visible under World API Counts, the loads/hour chart renders with recent bars, and no overlapping panels.

- Goal: Stabilize World API dlt cron by providing base_url and aligning cwd; verify DB writes landed.
- Risk: low
- Gates: Postgres connectivity ✅ | Cron executes dlt GETs ✅ | Inserts ✅ (verified via quick counts)
## 2025-09-15 – Plan: Dynamic Smart Gate Links + Robust World API ingestion
- Goal: Serve near–real-time Smart Gate links on efipenmap.com and keep World API tables fresh with a robust, containerized scheduler. No code changes in this entry; this records the agreed direction…
- API/Frontend:
- Risks & Mitigations:
- Gates (to verify when implemented):
## 2025-09-15 – Grafana reprovision (duplicate UIDs) + API check
- Goal: Fix file-provisioned dashboards not updating due to duplicate UIDs and overlapping providers; verify health via HTTP API.
- Gates: typecheck N/A | build N/A | smoke: Grafana healthy ✅ (HTTP 200); dashboard search unauthenticated 401 expected.
## 2025-09-14 – Dynamic World API counts + disable killmails
## 2025-09-15 – World API endpoints policy + coords plan
- Goal: Align dlt source with API realities (killmails limit=10, necessary by-id endpoints only), add `/config`, and define a single coordinate typing strategy across solarsystems and smartassemblies.
- Risk: low/medium (killmails paging fix reduces errors; enabling full smartassemblies needs careful schema typing to avoid drift).
- Gates (after patch): typecheck N/A | build N/A | smoke: killmails pages succeed at 10/page; counts appear in Grafana; smartassemblies details load without schema conflicts.
## 2025-09-15 – dlt source resource list fix + external run quoting
- Goal: Fix `AttributeError: 'dict' object has no attribute 'name'` when building `worldapi_source()` after adding the custom tail-only killmails resource; ensure detached PowerShell runs set env var…
- Risk: low (construction-time only; no API shape change). Killmails tail-only remains active.
- Gates: local smoke re-launched (external windows). Expect health/config tables to load, then killmails tail-only to proceed; smartassemblies details to be exercised in smoke run.

- Goal: Ensure Grafana automatically shows new dlt-ingested World API raw tables without manual dashboard edits; avoid pipeline failures from 400 on killmails.
- Risk: low (dashboard queries only) / medium (source tweak – killmails disabled)
- Gates: typecheck N/A | build N/A | smoke ✅ (Grafana restart; tables now listed dynamically)
## 2025-09-14 – Enable killmails ingestion (dlt)
- Goal: Add World API killmails coverage (list + by-id) to the dlt pipeline without breaking existing resources.
- Risk: low/medium (new API surfaces); prior 400 came from offset pagination — switched to page pagination consistent with other fast fetcher.
- Gates: typecheck N/A | build N/A | smoke pending next run; Grafana raw table list will auto-include new raw_% tables after first load.
## 2025-09-14 – World API Grafana dlt-only counts + background loop
- Goal: Replace stale World API count panels (legacy view) with live counts from dlt tables only and make ingestion run in the background.
- Gates: typecheck N/A | build N/A | smoke: dashboards load; table panels show current dlt counts; loop script runs one-shot; scheduling optional.
## 2025-09-14 – dlt OpenAPI ingestion: first successful load
- Goal: Prove the new dlt-based World API ingestion works end-to-end locally and land initial rows for wiring Grafana counts to Postgres (schema `world_api_dlt`).
- Verification:
- Gates: typecheck N/A | build N/A | smoke ✅ (API reachable, rows landed; Grafana datasource already provisioned as `ef-postgres`).
## 2025-09-14 – Stopped relaunching World API python.exe
- Goal: Identify and stop recurring python.exe with network usage and memory growth.
## 2025-09-14 – Legacy World API jobs stopped (task removed)
- Verification:
## 2025-09-14 – Canonical dashboard = Grafana (Primordium); local metrics server deprecated
## 2025-09-14 – Pivot World API ingestion to dlt OpenAPI generator
- Goal: Replace ad-hoc Python fast fetchers with a single, memory-bounded ingestion generated from the World API OpenAPI spec.
- Gates: chain indexer unaffected ✅; world API fast jobs paused ✅; dlt not yet scaffolded (pending).
## 2025-09-14 – dlt worldapi → Postgres sample load (auth fix)
- Goal: Complete a small end-to-end dlt run of World API (health + solarsystems) into the local Primodium Postgres to validate destination wiring.
- Verification: Queried via `docker exec … psql`: counts returned `world_api_dlt.solarsystem=500`, `world_api_dlt.health=1`.
- Risk: low (local-only).
## 2025-09-14 – Restore local indexer ingestion
- Goal: Fix Grafana blocks/minute drop by stabilizing Primodium pg-indexer stack locally.
- Risk: low (local automation only)
- Gates: typecheck N/A | build N/A | smoke ✅ (containers Up; writer logs show upserts)
## 2025-09-14 – Auto-start tasks fix + Primodium indexer relaunched
- Goal: Get the Primodium pg-indexer running again now and make it start automatically on user logon.
- Gates: typecheck N/A | build N/A | smoke: docker containers up ✅ (postgres, reader, writer, head poller, grafana); `docker info` ServerVersion=28.4.0 ✅; scheduled task AtLogon=Ready ✅.
## 2025-09-14 – Overnight World API fast fetch task + chain health
- Goal: Keep World API snapshots fresh overnight and confirm the chain indexer is healthy.
- Risk: low (local-only); Scheduled Task can be removed later via `tools/win/schedule_world_api_dlt.ps1 -Remove` or Task Scheduler.
## 2025-09-14 – Restore Grafana dashboard + safer provisioning
- Goal: Recover the prior chain indexer dashboard that disappeared and avoid future deletions when provisioning dashboards. Also add a combined overview dashboard.
- Risk: low (Grafana-only, local)
- Gates: typecheck N/A | build N/A | smoke: dashboards visible via API/UI ✅
## 2025-09-14 – World API endpoint inventory + cadence placeholders
- Goal: Capture a durable list of all public World API endpoints (from docs/doc.json) we may query, explicitly excluding auth/Bearer-only or user-scoped paths ("/me"), and record initial cadence inte…
## 2025-09-14 – World API rotation-based detail polling (solarsystems, tribes)
- Goal: Include single-resource endpoints in fast cadence without scanning all IDs each run; prepare for 24k+ solarsystems scale.
- Risk: Low (local files + KV counts post). No API write load other than existing KV stats update. Rotation ensures O(batch) detail calls/run.
- Verification: Ran fast runner locally (Windows) -> created ids/rotate files; `meta.json` shows counts and detail stats; worker accepted counts via `worldapi-update`.
## 2025-09-13 – Primodium indexer pilot on Windows (WSL2 + Docker)
- Goal: Stand up a segregated Postgres-backed MUD indexer (Primodium pg-indexer) alongside our existing local indexer, fully automated on Windows.
- Verification: Docker engine healthy (ServerVersion 28.4.0). Containers running; adapter health 200; summary shows Postgres 16 and currently 0 public tables (writer pending schema).
- Risk: medium (infrastructure-only; isolated from app). No app runtime change.
## 2025-09-13 – Introduce PG Adapter (segregated)
- Goal: Pilot a Postgres-backed adapter using a third-party MUD index (Primodium) while keeping our custom local-indexer intact and reversible.
- Risk: low (isolated folder; easy rollback by not using scripts or deleting folder).
- Gates: typecheck N/A, build N/A, smoke: adapter /health responds; DB optional.
## 2025-09-13 – Streaming indexer plan (near-RT, multi-world)
- Goal: Operate 12+ months on same chain, rotating world IDs; keep ingest+decode near head (head−depth), auto-adopt new MUD tables, expose stable dashboard metrics.
- Risk: Medium–High (live pipeline + auto-DDL). Rollback: disable streaming decode (fall back to batch), freeze new-table auto-DDL with allowlist.
## 2025-09-14 – World API fast fetch (non-blocking) + scope clarify
- Goal: Add a fast-cadence fetch for World API resources without blocking VS Code agent sessions; clarify scope (no Primodium coupling).
- Verification: Launched fast runner → background PID created, logs initialized; awaiting network completion to populate snapshot files.
## 2025-09-12 – Metrics liveness + control, ETA seconds
- Goal: Improve operator confidence in dashboard accuracy; show ingest liveness, enable safe restart, restore ETA seconds, fix gauge ellipse.
- Risk: Low (isolated metrics server + dashboard). Control endpoint disabled by default and requires explicit ALLOW_CONTROL.
- Gates: typecheck N/A | build N/A | smoke: API /summary,/series/* OK previously; added endpoints wired.
## 2025-09-12 – Dashboard ETA fix + backlog card cleanup
- Goal: Make catch-up ETA reflect effective progress (ingest minus chain) and remove duplicate "Typed decoding backlog" card.
- Risk: low (read-only server math + UI-only text/DOM tweaks)
- Gates: smoke ✅ via http://127.0.0.1:8733 – summary now includes effectiveBlocksPerMin and statusFreshSec; dashboard shows "Waiting for faster ingest…" when effective bpm <= 0; only one backlog card…
## 2025-09-12 – ECS TTL caching + UI smoothing
- Goal: Reduce dashboard flicker and transient blanks in the unified ECS view without impacting ingestion.
- Risk: low (read-only, short-lived cache; UI-only behavior)
- Gates: typecheck n/a | build n/a | smoke ✅ (locally verified endpoints respond; UI stops blanking between polls)
## 2025-09-12 – ECS snapshot unified list fallback
- Goal: ECS card showed totals but no rows after unifying to /api/mud-ecs; add safe UI fallback and verify backend endpoint on 8733.
- Risk: low
- Gates: typecheck n/a | build n/a | smoke: /api/mud-ecs returns items ✅, dashboard serves updated JS ✅
## 2025-09-12 – Typed fuel/energy + dashboard stability
- Goal: Project Fuel and NetworkNodeEnerg into typed tables; reduce dashboard flakiness while DB is busy.
- Risk: medium (new materializers + read-only server caching)
- Gates: typecheck n/a | build n/a | smoke: API /api/mud-typed returns, node-energy rows present
## 2025-09-12 – MUD Wave‑1 typed presence
## 2025-09-12 – Local metrics dashboard unreachable (recovery)
- Verification (local):

- Goal: Normalize Wave‑1 tables into typed presence tables with 1:1 key tuple rows using latest pointers.
- Risk: low (read-only on erc_mud_latest; writes new local tables only).
- Gates: typecheck N/A | build N/A | smoke ✅ (scripts executed successfully)
## 2025-09-12 – MUD values snapshot (Wave 1 start)
- Goal: Persist raw value segments (static/encodedLengths/dynamic) for latest keys of selected MUD tables to enable typed decoding without re-reading history.
- Risk: low (new table; read-only sources)
- Gates: ran Entity and Ownership backfills: counts match erc_mud_latest (90,158 each) ✅
## 2025-09-12 – MUD Wave 1 selection + latest snapshot
- Goal: Normalize a first wave of MUD tables into a stable snapshot and enable fast lookups before full typed decoding.
- Risk: low (read-only to decoded db; creates new tables)
- Gates: typecheck n/a | build n/a | smoke: metrics server serving Mud tables list ✅
## 2025-09-12 – Metrics server launcher fix (8733)
- Goal: Make the local metrics dashboard reliably reachable on http://127.0.0.1:8733.
- Risk: low
- Gates: typecheck n/a | build n/a | smoke: server started (pid recorded) and reachable at / (dashboard) and /api/health (JSON).
## 2025-09-12 – MUD table stats derivation + dashboard card
- Goal: After SetRecord materialization finished, surface which MUD tables dominate to guide next decode steps.
- Risk: low (read-only aggregation + new UI card).
- Gates: typecheck n/a, build n/a, smoke: metrics server on 8733 ✅; /api/mud ✅; /api/mud-table-stats ✅ after derivation.
## 2025-09-12 – ERC-20 stats in local dashboard
## 2025-09-12 – Local indexer dashboard cards: first‑try checklist
- Goal: Avoid rework when adding new cards to the local indexer dashboard by documenting a minimal, repeatable checklist and common pitfalls.
- Gates: API returns 200 with JSON; dashboard shows card immediately; no console errors for 60s; progress bar/pct update at 3s cadence.

- Goal: Surface ERC-20 activity from the decoded dataset without impacting ingestion; add a simple API and UI card.
- Risk: low (read-only queries; UI-only additions). Added 5m cache for heavy totals.
- Gates: typecheck n/a; build n/a; smoke: endpoint returns JSON locally (manual curl/PowerShell), dashboard shows totals and top tokens
## 2025-09-12 – Local decode runner + dashboard wiring
- Goal: Run a read-only background decode and surface live progress/ETA on the consolidated indexer dashboard (port 8733).
- Risk: low (local-only; SQLite read-only; no Cloudflare changes).
- Gates: smoke ✅ via http://127.0.0.1:8733 – Decode card shows state=decode_running with increasing done/rps; history points recorded.
## 2025-09-12 – Local snapshot + inventory tooling
- Goal: Safely snapshot the local ingest DB, summarize raw logs, and export minimal artifacts to unblock decode planning without touching production.
- Risk: low (local-only utilities; no worker changes). DB writes only occur if/when prepare_decode_schema is run against a snapshot.
- Gates: typecheck N/A | build N/A | smoke: inventory and export ran OK (meta.json, inventory.json, discovered_topics.json written).
## 2025-09-11 – Local Indexer Dashboard Plan
## 2025-09-12 – Delivery architecture for semi-live world data (Doc)
- Goal: Agree on how decoded chain data + World API JSON reach the web app with low cost and safe ops.
- Risk: Low (docs only). Overlay introduces minimal KV write volume; feature-gated client.
## 2025-09-12 – World API indexing plan (Doc)
- Goal: Document how we’ll ingest and store World API JSON as enrichment alongside decoded chain state.
- Risk: Low (docs only). No code yet; tools to be added after decode inventory.
- Goal: Document end-to-end plan to analyze raw logs, extract registry/field layouts, implement decoders, apply to latest-state, and export frontend artifacts without pausing ingestion.
- Risk: Low (docs only). Execution will be staged; no Cloudflare changes required.
## 2025-09-11 – Remove D1 bindings after DB deletions (config hygiene)
- Goal: Align repo configs with operator’s manual deletion of three D1 databases (INDEX_DB, INDEX_DB_A1, INDEX_DB_A2) to avoid deploy-time binding errors while keeping runtime guards.
- Risk: Low (config-only). Restoring D1 later requires re-creating databases and re-adding bindings in these files.
- Gates: typecheck N/A | build N/A | deploy: should succeed (no D1 required). Manual smoke: `/api/stats` OK; `/api/indexer-health` reports disabled/missing binding as expected.

- Goal: Ship a live, read-only dashboard for the local indexer during ongoing ingestion without risking disruption.
- Gates: Type safety N/A for scripts; manual smoke during ingest; no DB write handles; ingestion logs show no stalls. Visual parity within reason.
## 2025-09-11 – Dashboard progress + logs hardening
- Goal: Make status obvious at-a-glance and ensure logs show up reliably.
- Risk: low
- Gates: typecheck N/A | build N/A | smoke: server restarted, health OK via page load; UI renders; polling + SSE continue.
## 2025-09-11 – Local indexer UI freeze fix
- Goal: Dashboard must auto-refresh (no manual reloads), show recent activity and logs.
- Risk: low (template-only).
- Gates: typecheck N/A | build N/A | smoke: status page loads, no console error, LIVE pill updates, recent/log panes populate.
## 2025-09-11 – Local indexer controls & PID
- Goal: Allow dashboard to pause/resume/stop the ingestor and expose PID for management.
- Risk: low (isolated to local tools)
- Gates: typecheck N/A | build N/A | smoke ✅ (status shows paused/ingest; control file honored)
## 2025-09-11 – Local indexer dashboard live updates & resilient start
- Goal: Remove manual refresh requirement and ensure the ingestor continues running independent of VS Code sessions.
- Risk: low (local-only tooling). SSE gracefully degrades to 2s polling if EventSource unsupported.
## 2025-09-11 – Local indexer scaffold
- Goal: Avoid Cloudflare D1/KV costs by running raw log ingestion locally and exporting static snapshots for the map.
- Risk: low (pure local tooling; no prod impact).
## 2025-09-11 – Force dark theme globally
## 2025-09-11 – Pause DB/KV activity (production deploy)
- Goal: Immediately halt D1 and KV writes/reads from the Pages Worker to control cost while planning a local indexing path.
- Verification:
- Gates: typecheck ✅ build ✅ deploy ✅ smoke ✅

- Goal: Fix contrast issues by enforcing dark mode regardless of system theme; ensure routing labels and Indexer page stay white-on-dark.
- Risk: low (CSS only; no JS behavior change).
- Gates: typecheck ✅ build ✅ preview ✅
- Preview: https://force-dark-ux.ef-map.pages.dev
- Verification: CSS asset contains `color-scheme: dark`; no light-mode media query; homepage 200 OK; note: API endpoints on preview return HTML (expected on Pages without full runtime bindings for so…
## 2025-09-10 – Light health endpoint + manual ingest restart
- Goal: Fix slow indexer health/dashboard and restart ingestion after decode rollback.
- Risk: low (read-only API shape adds optional fields; ingestion trigger is existing path).
- Gates: typecheck ✅ build ✅ preview smoke ✅ prod trigger ✅
## 2025-09-10 – Finalize Idempotency + Duplicate Labeling (UI)
- Goal: Ensure runs always persist rows_added and metrics even if the run was flagged finished earlier; clarify duplicate-only runs in the dashboard.
- Risk: Low (bounded finalize UPDATE; UI is read-only).
- Verification:
## 2025-09-10 – Stats “today” Synthetic Entry (UI parity)
- Goal: Ensure the current day always appears on the Stats page even before the first daily KV snapshot is written.
- Risk: Low (read-path only). Existing aggregation unchanged; when the first real event arrives, normal daily key supersedes synthetic row automatically.
- Verification: Preview deployed at `https://stats-today-fix.ef-map.pages.dev`.
## 2025-09-09 – Raw Logs Batch Param Limit Fix
## 2025-09-09 – Throughput Scaling Rollback to ~2x
## 2025-09-09 – Adaptive Segmentation & Multi-RPC Rotation Resilience Layer
## 2025-09-09 – Standalone Cron Worker Config (indexer-cron)
- Goal: Provide an explicit standalone cron-enabled Worker (`ef-indexer-cron`) to run autonomous paced ingestion since Cloudflare Pages does not execute `scheduled()` exports. Prior pacing logic (thr…
- Risk: Low/Medium (write automation). Same code path as manual ingestion; overlap guard present. Rollback: `wrangler undeploy --config indexer-cron.wrangler.jsonc` (or disable by setting `INDEXER_CR…

- Goal: Unblock stalled raw log ingestion caused by persistent provider HTTP 500 / timeout errors and large segment window failures by (a) shrinking failing segments adaptively and (b) rotating acros…
- Risk: Low/Medium (ingestion path only). Potential slightly higher RPC call count under severe failure scenarios; bounded by retry & shrink limits. No schema change; rollback is removal of new branc…
- Verification Plan:
## 2025-09-09 – World State Replication Objective (Authoritative)
## 2025-09-09 – Temporary Indexer Auth Disable (Preview / Iteration Phase)
- Goal: Remove friction caused by repeated failures to bind or recognize `INDEXER_ADMIN_TOKEN` during rapid ingestion iteration; allow autonomous cron + manual triggers without credentials while data…
- Risk: Medium (unauthenticated mutation endpoints on preview & potentially production domain if deployed there). Mitigated by: (a) non-sensitive dataset (public chain data), (b) row caps & batching …

- Goal: Establish autonomous ingestion independent of Cloudflare Pages limitations (Pages lacks cron triggers) by deploying a minimal standalone Worker scheduled every 5 minutes that triggers the exi…
- Risk: Low/Medium (new worker, external call). Overlap guard enforced in Pages trigger; cron worker idempotent if Pages returns in_progress. Failure modes are contained (cron logs error; no DB corru…
- Verification Plan: (1) Deploy cron worker (`wrangler deploy --config cron-wrangler.jsonc`). (2) Observe Cloudflare dashboard logs for `cron_run` summaries. (3) Check `/indexer` page run list every …
## 2025-09-09 – Indexer Status Moved to Dedicated Dashboard
- Goal: Consolidate all ingestion observability (status badge, trigger/reset controls, run history) onto `/indexer` so the operator has a single pane of glass to assess "is it working right now" with…
- Risk: Low (UI restructure only). No worker changes; polling cadence unchanged (30s).
- Verification: Local build OK, Indexer page now shows live badge plus summary bar; Stats page no longer displays badge. Badge actions (Run Now / Refresh) still operate (preview bypass unaffected).
## 2025-09-09 – Indexer Dashboard Page & Runs Endpoint
- Goal: Provide dedicated operational dashboard at `/indexer` with richer visibility (health snapshot, cursor, counts, recent runs table, manual Run Now + Reset buttons) separate from primary Stats p…
- Risk: Low (read-only SQL plus existing mutation endpoints). No schema changes. Page isolated via pathname guard; zero impact to main rendering path.
- Verification Plan: (1) Build passes (TS). (2) Preview deploy; visit `/indexer` see counts, runs table. (3) Trigger run; active row highlights (no finished_at). (4) Reset rewinds cursor & marks acti…
## 2025-09-08 – Autonomous Cron Ingestion (store_all)
- Goal: Eliminate dependence on long-lived local Node backfill script by scheduling periodic ingestion runs directly in Cloudflare Worker (root deployment) using Cloudflare Cron Triggers.
- Risk: Low/Medium. Potential for slight lag (up to 5 min) vs continuous tail; acceptable for historical backfill phase. If RPC latency spikes beyond 5 min window an overlapping run may be skipped un…

- Goal: Eliminate Cloudflare 1101 "Too many API requests by single worker invocation" errors during large `store_all` backfill windows that used many small segmented `eth_getLogs` calls.
- Risk: Low/Medium. Slight underutilization possible if per-segment log density very low (cap might cut window early); acceptable tradeoff for stability. Future tuning could raise cap cautiously (mon…
- Verification Plan: Deploy preview, run small & large windows observing stable `status:'ok'` responses with `segRequests <= 40` and absence of 1101 errors over ≥10 consecutive runs.
## 2025-09-08 – TableId Incremental Discovery Strategy
## 2025-09-08 – Pivot: Organic TableId Discovery via Store Events
## 2025-09-08 – Chain Source Registration (worlds.json) & Dual-Source Model
- Goal: Permanently record base chain context and prevent future confusion between REST World API and on-chain (pyro) event/log ingestion sources.
- Risk: Documentation only (low). Risk of stale `blockNumber` acknowledged; will treat file as mutable reference, not strict invariant.

- Goal: Unblock D1 schema initialization without relying on header auth difficulties and asset fetch 405s.
- Risk: Temporary bypass reduces auth protection on preview branch only. Production remains header-protected. Plan to remove bypass after indexer stabilized.
- Verification: Migration endpoint executed sequentially (002–005, then 005 after fix). Health shows migrationsApplied 001–005. Test ingest populated rows (smart_assembly=2, smart_gate_direction=1). …
## 2025-09-08 – Overlay Endpoint & Gate Tombstones
- Risk: Low (IF NOT EXISTS guards). Existing deployments with table already present simply create indexes if missing; no data loss.

- Goal: Provide sub-minute routing correctness for gate topology changes (add/update/delete) without requiring immediate full adjacency snapshot rebuild by exposing a lightweight delta feed the clien…
- Risk: Low/Medium: read-heavy queries on `smart_gate_direction` with filter on `last_change_at`. Potential index follow-up if query frequency or row counts grow (add index on `last_change_at`). Tomb…
- Verification: Static analysis; no runtime test of real data yet (event source still partially simulated). Syntax scan to follow. Endpoint expected JSON shape confirmed by manual reasoning; null-saf…
## 2025-09-08 – Snapshot Advisory Fields (Indexer Health)
- Goal: Provide early, side-effect-free signal indicating when a full adjacency snapshot rebuild is likely cost-effective based on recent pending changes sample (inserts, updates, deletes, potential …
- Risk: Low (read-path only; no DB writes or cache invalidation). False positives incur only operator review; false negatives mitigated by overlay once implemented.
## 2025-09-08 – Assembly Deletion Event Handling & Pending Changes Delete Classification
## 2025-09-08 – Pending Changes Summary Fields (heuristic)
## 2025-09-08 – Sept 7 Partial-Day Stats Merge (Netlify + Cloudflare)
- Goal: Consolidate Sept 7 analytics split across pre‑cutover (old placeholder/Netlify era namespace) and post‑cutover (active Cloudflare namespace) snapshots into a single authoritative daily blob.
- Verification Gates: (a) KV backup key exists; (b) merged key write succeeded (wrangler put exit 0); (c) spot-checked critical counters & sums in stored value (string contains `page_loads:198` & upd…
- Risk: Low (single-key overwrite with preserved backup & source namespace). No code changes.
## 2025-09-08 – Sept 7 History Omission (UTF-8 BOM Parsing Fix)
- Goal: Restore missing Sept 7 row in Stats history (graphs + 7‑day table) which remained absent post-merge despite correct key presence.
- Verification: Preview deploy `feature-indexer-diagnostics` then production deploy → `/api/stats?history=7` now returns dates 04–08 inclusive with 07 present (no parse_error objects). Production UI …
- Risk: Low (read-path only). BOM strip is defensive for any future accidental BOM introductions.
## 2025-09-08 – Cloudflare Cutover Documentation Refresh & Migration Plan Archival
- Goal: Bring all public/project documentation into alignment with Cloudflare-as-primary reality, retire active migration phrasing, and surface new defensive + future-planning notes (BOM strip, dynam…
- Risk: Low (docs only). No runtime or build impact; worker & frontend code untouched by this commit set.
- Verification: Manual review of updated files (headings render, internal links valid, no lingering present-tense Netlify fallback instructions outside clearly marked historical sections). Build/type…
## 2025-09-08 – KV Namespace Cleanup & Stats Retention Policy
- Goal: Remove redundant migration/staging KV namespaces (EF_STATS_OLD, EF_DRIFT, extra share namespaces) and finalize initial stats retention guidance.
- Risk: Low (namespaces empty; code path removal only). Rollback: reintroduce bindings + endpoint if unexpected historical data appears.
## 2025-09-07 – Stats Duplicate Daily Keys Cleanup
- Goal: Remove visual double counting on Stats page caused by duplicate KV keys with pattern daily/YYYY-MM-DD.json.json alongside correct daily/YYYY-MM-DD.json.
- Risk: Low (read-path only; ignores clearly malformed keys). Does not alter write logic.
- Gates: typecheck N/A (JS workers), build pending; runtime validated via key deletion + /api/stats after deploy.
## 2025-09-07 – Indexer Migration Execution, Bootstrap & Fallback Token Removal
- Goal: Successfully apply initial D1 schema (migration 001_init), initialize `world_version` via external world API `/config`, and remove temporary insecure fallback admin token used to bypass previ…
- Gates: Migration run ✅ (executed:["001_init"]) | Bootstrap ✅ | Health ✅ | Existing share/stats endpoints unaffected | No console/runtime errors observed post-deploy.
- Risks: Future migrations may still hit D1 parser edge cases (multi-statement exec); current runner complexity could be trimmed later. Preview secret injection root cause unresolved (affects future …
## 2025-09-07 – Persistent Short Share URLs (No Rewrite)
- Goal: Keep user-visible shared URL as short form (/s/<id>) after opening a shared route; previously the worker redirected to /?share= which the client rewrote to a long #r1| hash, making the URL un…
- Risk: Low (routing unaffected; only entrypoint + initial effect). If a future need arises to deep-link into additional state via hash, path-based short sharing remains compatible.
- Gates: typecheck ✅ build (pending) deploy (pending) smoke plan: create share -> open /s/<id> in new tab -> route loads, address bar stays /s/<id>, Stats increments `shared_resolved`.
## 2025-09-07 – Usage Ingestion Hardening & Share UI State Population
- Goal: Eliminate user-visible 500 errors on `/api/usage-event` (e.g., waypoint_count_bucket) and ensure opening a shared P2P route reflects original routing parameters (jump, optimize, algorithm, de…
- Risk: Low (additive defensive code + state population). Potential minor discrepancy if future share schema adds new fields not yet mapped—will default gracefully.
- Gates: typecheck ✅ build (pending) deploy (pending) smoke: open route share `/s/<id>` -> UI fields reflect encoded settings; posting malformed event manually increments `ingestion_errors` without 5…
## 2025-09-07 – Smart Gate Access Clarifications & Schema Cache Adjustments
- Goal: Capture newly provided domain clarifications for dynamic smart gate integration: tribe-based (org) gating predominance, programmable contract logic via `configureGate`, irrelevance of fuel le…
- Risk: Low (documentation + draft schema only, no deployed migrations yet). If tribe logic later proves multi-level (alliance/corp) we may extend `gate_access_cache` with hierarchy normalization rat…
## 2025-09-07 – Indexer Secret Debug Relocation & Migrations Asset Copy
- Goal: Ensure secret diagnostic endpoint is served by deployed Cloudflare Pages worker (root) and enable migration SQL retrieval via ASSETS fetch.
- Risk: Low (additive endpoints + file copy). Endpoint returns only truncated metadata; no secret value exposure. Copy script skips if directory absent.
- Gates: typecheck N/A (JS only) | build pending (expect ✅) | smoke plan: redeploy preview -> GET `/api/indexer-secret-debug` returns JSON; POST migrate with correct `X-Indexer-Admin` completes (exec…
## 2025-09-07 – Assistant CLI Execution Policy Formalization
- Goal: Eliminate latency and ambiguity by mandating the assistant auto-executes every feasible Cloudflare Wrangler CLI command (non-secret) instead of instructing manual user execution.
- Risk: Low (process clarification). No code path or runtime changes.
## 2025-09-07 – Cloudflare Cutover: Remove Netlify Fallbacks
- Goal: Finalize migration by eliminating all client fallbacks to Netlify Functions (`/.netlify/functions/*`) for shares, usage, and stats; enforce Cloudflare Worker (`/api/*`) as sole backend.
- Risk: Medium (removal of redundancy; any deploy misconfig now surfaces immediately). Rollback plan: revert this commit to restore fallback while investigating Worker bind/deploy issue.
- Gates: typecheck ✅ build ✅ (pending current session build) smoke (post-deploy checklist: /api/stats JSON ok, create & resolve share round trip, usage events 2xx, no network access to /.netlify/func…
## 2025-09-07 – Migration Phase 2 Shadow Read Implementation
- Goal: Introduce shadow read path (Netlify primary, Cloudflare KV secondary) to measure data parity ahead of dual writes.
- Risk: Low (async fire-and-forget comparison; no impact on primary latency). Shadow errors swallowed; only dev console warnings on mismatch.
## 2025-09-07 – Cloudflare Sandbox Worker (Option A)
- Goal: Provide an independent Cloudflare URL where core interactions (create share, basic stats) visibly function using Cloudflare KV only—without modifying production Netlify flow or advancing form…
- Risk: Low (isolated Worker). No production DNS change.
## 2025-09-07 – Netlify -> Cloudflare Migration Script
- Goal: Provide reproducible, idempotent export of existing Netlify Blobs (shares + stats snapshots) into Cloudflare KV ahead of Phase 3 dual writes / cutover rehearsal.
- Risk: Low (standalone script). Failure confined to console.
## 2025-09-07 – Migration Script Execution (Empty Source State)
- Goal: Run migration script against production Netlify blobs to seed Cloudflare KV.
## 2025-09-07 – Cloudflare Sandbox Worker Full Stats & Short Share URLs
- Goal: Expand sandbox Worker to full parity (stats + sharing) for isolated end-to-end validation.
- Risk: Low (isolated). Schema parity maintained with Netlify snapshots.
## 2025-09-07 – AI-Managed CLI Deployment Workflow
- Goal: Formalize operator ↔ assistant process for commits and Cloudflare deploys from sandbox branch.
## 2025-09-07 – Cloudflare API HTML Fallback Hardening
- Goal: Prevent false-positive detection of `/api` share endpoints when Worker absent (HTML returned).
- Risk: Low (client-only guard). Consider similar guard for usage & stats if needed.
## 2025-09-07 – Worker Build Integration & Extended HTML Guards
- Goal: Ensure Pages deployment always includes `_worker.js` and extend HTML fallback guards.
- Risk: Low (build step + header checks). Optionally centralize detection logic later.
## 2025-09-07 – Netlify Stats Mirror Attempt & CF Rate Limit
- Goal: Backfill historical usage stats from Netlify into Cloudflare KV.
## 2025-09-07 – Netlify Stats Mirror Success (Workers Paid)
- Goal: Complete historical stats backfill after quota lift.
## 2025-09-07 – Stats Daily Key Rename & History Fallback
- Goal: Make mirrored Netlify daily stats visible in Cloudflare (history missing due to double extension bug).
- Risk: Low; fallback removable after validation window.
## 2025-09-07 – Cloudflare KV Namespace Consolidation
- Goal: Ensure Pages + Worker deployments read identical stats history.
## 2025-09-07 – Unified Pages Worker Implementation (History & Diagnostic Header)
- Goal: Remove ambiguity between root & subdir worker files; standardize history (max 120) and diagnostics header.
## 2025-09-07 – Dynamic Player Structures & Smart Gates Planning Kickoff
- Goal: Initiate structured planning for ingesting and rendering dynamic player-created assets (Smart Gates & other structures).
## 2025-09-06 – Scout Optimizer Double Scrollbar Removal
- Goal: Eliminate redundant inner scrollbar when Scout Optimizer embedded in Routing drawer while preserving log scroll.
- Risk: Low (CSS tweak). Single outer scrollbar + internal log scroll remains.
## 2025-09-06 – Transmission Metrics (Replay / Fast-Forward / Timing / Echo Buckets)
- Goal: Rich anonymous instrumentation for Incoming Transmission window engagement.
- Risk: Medium (multi-file wiring). Additive.
## 2025-09-06 – Environment Metrics: Screen Resolution & CPU Core Buckets
- Goal: Capture coarse distributions for resolution + logical cores to inform UI density & concurrency heuristics.
## 2025-09-05 – Display Settings v11 (Route Thickness) & Compare Regions Sort Persistence
- Goal: Adjustable route ribbon thickness + session persistence of Compare Regions sort.
## 2025-09-05 – Explore Routing Mode Scaffold
- Goal: Add 'explore' optimization mode placeholder (UI + serialization) prior to enrichment logic.
## 2025-09-05 – Explore Enrichment (A* + Dijkstra)
- Goal: Implement enrichment inserting intermediate systems within fuel overhead budget.
- Risk: Medium (worker logic).
## 2025-09-05 – Explore Overhead Control & Stats
- Goal: UI overhead slider + meta display (overhead %, extra systems) for Explore mode.
## 2025-09-05 – Explore Help & Usage Metric
- Goal: Document Explore + add adoption metric `p2p_mode_explore` to Stats.
## 2025-09-05 – Explore Forward-Progress Tuning
- Goal: Avoid early-looping; enforce incremental global progress & candidate scoring bias.
## 2025-09-05 – Transmission Metrics (Already captured 2025-09-06 entry) – (Consolidated above)
## 2025-09-04 – Usage Dev 404 Auto-Disable & Transmission Replay Fix
- Goal: Disable noisy usage 404 spam in dev & ensure transmission replay resets intro properly.
## 2025-09-04 – Transmission Persistence & Autoplay Adjustments
- Goal: Deterministic replay/echo behavior; intro only on first or explicit replay; lower default volume.
## 2025-09-04 – Transmission Replay & Echo Audio Rules Refinement
- Goal: Enforce silent echo phase & audio limited to intro.
## 2025-09-04 – User Overlay Advanced Interaction (Legend, Multi-Select, Soft Hover, Duplicate Merge)
- Goal: High-efficiency bulk editing & inspection workflow for marks.
## 2025-09-04 – User Overlay Metrics, Stats Integration & Help Documentation
- Goal: Instrument overlay adoption & expose metrics in Stats + Help panel docs.
## 2025-09-04 – No-Op Rebuild Trigger
## 2025-09-04 – Transmission Intro Guard & Diagnostics Hardening
- Goal: Prevent unintended intro replays; structured debug log.
## 2025-09-03 – Region Stats Metric Simplification (EMPTY PLACEHOLDER)
## 2025-09-03 – Region Stats Baseline Distance Integration
- Goal: Introduce nearest-neighbor baseline distances for realistic traversal figures.
## 2025-09-03 – Region Stats Has Station Flag
- Goal: Add boolean `has_station` to region stats output & UI card.
## 2025-09-03 – Station Data Integration (map_data_v2)
- Goal: Embed station counts in SQLite & fallback gracefully when absent.
## 2025-09-03 – Usage Stats Graphs
- Goal: Add SVG chart components for usage trends (line & stacked percent, distribution toggles).
## 2025-09-03 – Usage Stats Graph Simplification (Placeholder / integrated in later redesign)
## 2025-09-03 – Stats Tables + Incremental Panel Cascade UI Rework
- Goal: Deterministic panel layout cascade & stats table refinement.
## 2025-09-03 – Station Sprite Rendering, Scaling & Interaction Refinements
- Goal: Complete station overlay (toggle, focus growth, hover precedence, depth correctness).
## 2025-09-03 – Hover Threshold Fine-Tuning (floorBelowMin=0.12 Adopted)
- Goal: Improve selection precision in dense clusters at max zoom.
## 2025-09-03 – Stargate Selection Gradient (Option A Prototype)
- Goal: Highlight stargate connections from selected system using vertex color interpolation.
## 2025-09-03 – Stargate Selection Gradient Shader (Option B 2/3 Fade)
- Goal: Shader-based partial-length accent fade with new `sel` attribute & `uAccentSpan`.
## 2025-09-03 – Ship Jump Differentiation (Dashed Inner Core)
- Goal: Distinguish ship (non-gate) hops via dashed core modulation in ribbon shader.
## 2025-09-03 – Fix Has Station False Negative
- Goal: Populate station ID set immediately after DB load to avoid false `has_station=false`.
## 2025-09-03 – Region Stats Panel Cascade Integration
- Goal: Make Region Stats panel adopt shared cascade behavior.
## 2025-09-03 – Compare Regions Panel (Sortable Multi-Region Metrics)
- Goal: Bulk region metric comparison + sortable table, highlight integration.
## 2025-09-03 – Compare Regions Click -> Region Highlight
- Goal: Region name click triggers highlight & Region Stats open.
## 2025-09-03 – Help Panel: Region Stats & Compare Regions Documentation
- Goal: In-app help coverage for new region analytics panels.
## 2025-09-03 – Usage Metric: Compare Regions Opens
- Goal: Track panel adoption (`compare_regions_open`).
## 2025-09-03 – Reach Bubble Hide Double Count Fix (Date Uncertain, original placeholder 2025-??-??)
- Goal: Prevent double counting `rangebubble_hide` event due to dual emission paths.
## 2025-09-03 – Region Stats (Phase 1)
- Goal: Initial per-region spatial & network metrics (worker + card + instrumentation).
## 2025-09-03 – Route Ribbon Shader Rewrite (Pulse Tail & Visibility Fixes)
- Goal: Replace legacy tube geometry with single screen-space ribbon supporting pulse & tail.
## 2025-09-03 – Fix Star Size Scaling Regression After Cinematic Mode
- Goal: Restore star point size variance after exiting cinematic mode.
## 2025-09-02 – Additional (implicit) minor adjustments (see 09-03 consolidations)
## 2025-09-01 – Baseline Starfield Visual Enhancements (Items 1–9)
- Goal: Enrich default non-cinematic starfield with gradient sky dome, dither, fog, twinkle, parallax.
## 2025-09-01 – Init storage abstraction & decision log
- Goal: Unified KV accessor abstraction + seed decision log.
## 2025-09-01 – Refactor functions to unified store abstraction
- Goal: Deduplicate blob credential logic through `_store.js` usage.
## 2025-09-01 – Instrument gateReachable feature flag
- Goal: Track gateReachable toggle usage.
## 2025-09-01 – Expand analytics Tier 1–3 metrics
- Goal: Broad anonymous instrumentation additions (routing, optimization, UI, donations, environment).
## 2025-09-01 – Stats Page Redesign & Cleanup
- Goal: Grouped layout surfacing new instrumentation; hide noisy diagnostics.
## 2025-09-01 – Reintroduce 7‑Day Roll-Up & Copy Rate Metric
- Goal: Restore 7-day table + derived Copy Rate % metric.
## 2025-09-07 – Stats Duplicate Daily Keys Cleanup
- Goal: Remove visual double counting on Stats page caused by duplicate KV keys with pattern daily/YYYY-MM-DD.json.json alongside correct daily/YYYY-MM-DD.json.
- Risk: Low (read-path only; ignores clearly malformed keys). Does not alter write logic.
- Gates: typecheck N/A (JS workers), build pending; runtime validated via key deletion + /api/stats after deploy.
## 2025-09-06 – Scout Optimizer Double Scrollbar Removal
## 2025-09-07 – Indexer Migration Execution, Bootstrap & Fallback Token Removal
- Goal: Successfully apply initial D1 schema (migration 001_init), initialize `world_version` via external world API `/config`, and remove temporary insecure fallback admin token used to bypass previ…
- Gates: Migration run ✅ (executed:["001_init"]) | Bootstrap ✅ | Health ✅ | Existing share/stats endpoints unaffected | No console/runtime errors observed post-deploy.
- Risks: Future migrations may still hit D1 parser edge cases (multi-statement exec); current runner complexity could be trimmed later. Preview secret injection root cause unresolved (affects future …
## 2025-09-07 – Persistent Short Share URLs (No Rewrite)
## 2025-09-07 – Smart Gate Access Clarifications & Schema Cache Adjustments
## 2025-09-07 – Indexer Secret Debug Relocation & Migrations Asset Copy
- Goal: Ensure secret diagnostic endpoint is served by deployed Cloudflare Pages worker (root) and enable migration SQL retrieval via ASSETS fetch.
- Risk: Low (additive endpoints + file copy). Endpoint returns only truncated metadata; no secret value exposure. Copy script skips if directory absent.
- Gates: typecheck N/A (JS only) | build pending (expect ✅) | smoke plan: redeploy preview -> GET `/api/indexer-secret-debug` returns JSON; POST migrate with correct `X-Indexer-Admin` completes (exec…
## 2025-09-07 – Assistant CLI Execution Policy Formalization
- Goal: Eliminate latency and ambiguity by mandating the assistant auto-executes every feasible Cloudflare Wrangler CLI command (non-secret) instead of instructing manual user execution.
- Risk: Low (process clarification). No code path or runtime changes.
## 2025-09-07 – Remove Temporary Indexer Debug Endpoints Pre-Prod
- Goal: Eliminate `/api/indexer-secret-debug` and `/api/env-dump` prior to running migrations on production to avoid leaking environment key metadata.
- Risk: Low (pure removal; no user routes affected). If further diagnosis needed, can reintroduce guarded behind admin token.

- Goal: Freeze v1 table→source field mapping to unblock migration scaffolding.
- Risk: Low (documentation only). Future changes require v2 section + migration.

- Goal: Prevent impact to live production (served from `main`) while beginning dynamic structures indexer implementation.
- Risk: Low—branch isolation ensures revert path is simple (drop branch) without touching production build pipeline.

- Goal: Capture newly provided domain clarifications for dynamic smart gate integration: tribe-based (org) gating predominance, programmable contract logic via `configureGate`, irrelevance of fuel le…
- Risk: Low (documentation + draft schema only, no deployed migrations yet). If tribe logic later proves multi-level (alliance/corp) we may extend `gate_access_cache` with hierarchy normalization rat…

- Goal: Eliminate user-visible 500 errors on `/api/usage-event` (e.g., waypoint_count_bucket) and ensure opening a shared P2P route reflects original routing parameters (jump, optimize, algorithm, de…
- Risk: Low (additive defensive code + state population). Potential minor discrepancy if future share schema adds new fields not yet mapped—will default gracefully.
- Gates: typecheck ✅ build (pending) deploy (pending) smoke: open route share `/s/<id>` -> UI fields reflect encoded settings; posting malformed event manually increments `ingestion_errors` without 5…

- Goal: Keep user-visible shared URL as short form (/s/<id>) after opening a shared route; previously the worker redirected to /?share= which the client rewrote to a long #r1| hash, making the URL un…
- Risk: Low (routing unaffected; only entrypoint + initial effect). If a future need arises to deep-link into additional state via hash, path-based short sharing remains compatible.
- Gates: typecheck ✅ build (pending) deploy (pending) smoke plan: create share -> open /s/<id> in new tab -> route loads, address bar stays /s/<id>, Stats increments `shared_resolved`.

- Goal: Prevent content squeeze in non-resizable drawers (e.g., Routing) when vertical scrollbar appears by extending overall panel width by scrollbar width, matching behavior previously limited to r…
- Risk: Low (minor layout calc). If base width captured before fonts fully load, eventual glyph expansion may cause tiny reflow; acceptable for now.
- Goal: Eliminate redundant inner vertical scrollbar when Scout Optimizer is embedded in the Routing drawer (was producing two scrollbars: outer PanelDrawer body + inner optimizer panel) while retain…
- Risk: Low (CSS + className tweak). No logic or sizing code touched; outer drawer width compensation still functions.
- Gates: typecheck ✅ (no TS changes affecting types) | build pending (expected ✅) | smoke plan: open Routing → Scout Optimizer tab, start optimization until logs overflow → single scrollbar (outer) p…
## 2025-09-03 – Region Stats Metric Simplification
## 2025-09-03 – Region Stats Baseline Distance Integration
- Goal: Replace earlier MST/attachment placeholders with nearest-neighbor baseline distances (gate-aware) matching Scout Optimizer philosophy for gated-only and all-system stats.
- Risk: Low (contained within worker). Complexity O(n^2) BFS worst-case per region acceptable at current region sizes.
## 2025-09-03 – Station Data Integration (map_data_v2)
- Goal: Introduce optional station visibility feature by embedding per-system station counts into generated SQLite while preserving backward compatibility.
- Risk: Low (additive schema + filename bump). No existing queries altered.
## 2025-09-01 – Baseline Starfield Visual Enhancements (Items 1–9)
- Goal: Enrich default (non-cinematic) map background without enabling full cinematic mode. Implement approved enhancements 1–9: gradient sky dome, radial center boost, noise dithering, light fog, di…
- Risk: Low (isolated visual additions; no data/schema changes). Tested via production build; no TypeScript errors.
- Gates: typecheck ✅ build ✅ smoke (expected) ✅ (pending manual run to visually confirm gradients/twinkle).
## 2025-09-01 – Init storage abstraction & decision log
- Goal: Introduce unified KV store accessor to decouple Netlify-specific blobs from future Cloudflare KV/D1 migration; seed decision log.
- Risk: low (new file, no existing code modified)
- Gates: typecheck N/A (JS utility only) | build unaffected | smoke unaffected
## 2025-09-01 – Refactor functions to unified store abstraction
- Goal: Remove duplicated blob credential logic; centralize persistence access for upcoming Cloudflare migration.
- Risk: low (no business logic change; same API surface)
- Gates: typecheck ✅ (TS unaffected) | build ✅ | smoke pending (share create/get, usage event POST, stats fetch)
## 2025-09-01 – Instrument gateReachable feature flag
- Goal: Ensure "Only Gate-Reachable From Start" toggle usage increments `gate_reachable` counter in Stats.
- Risk: low (adds client-only tracking call; server already whitelists dynamic `feature_flags`).
- Gates: typecheck ✅ | build ✅ (expected) | smoke: toggle gate filter -> run Calculate Route -> stats should show increment next aggregation.
## 2025-09-01 – Expand analytics Tier 1–3 metrics
- Goal: Add comprehensive anonymous usage metrics (activation, performance, distribution buckets, donations, algorithm usage) to guide future UX/perf work.
- Risk: medium (broad client edits, but additive only; no existing logic altered besides theme tracking hook). Server accepts new event types via EVENT_MAP extension.
- Gates: typecheck ✅ | build ✅ (post-change) | smoke pending (manually verify route calc, optimization start, theme switch, donate modal, baseline cancel).
## 2025-09-01 – Stats Page Redesign & Cleanup
- Goal: Surface newly added instrumentation (activation, routing, scout, UI/theme, sharing/donations, session/cinematic, distributions) in grouped layout; hide noisy diagnostic counters (baseline_err…
- Risk: low (isolated UI component).
- Gates: typecheck ✅ | build ✅ | smoke pending (visual grouping & value sanity).
## 2025-09-01 – Per-Metric Tooltips & Help Panel Prune
- Goal: Add inline hover/focus tooltips to Stats page for every metric & distribution (central DESCRIPTIONS map) to avoid bloating Help panel; replace verbose "Key Metrics Explained" list with concis…
- Risk: low (presentation only, no logic change to tracking or aggregation).
- Gates: typecheck ✅ | build ✅ (post-stats tooltip build) | smoke ✅ (tooltips appear via title attribute, Help panel shorter).
## 2025-09-02 – Route Ribbon Shader Rewrite (Pulse Tail & Visibility Fixes)
- Goal: Replace legacy per-segment TubeGeometry + pulse spheres with a single screen-space ribbon polyline supporting per-hop bright directional pulse, trailing tail, consistent thin width, and robus…
- Risk: Medium (custom shader + geometry math). Contained to new module and integration points.
- Gates: typecheck ✅ | build (pending full project build) | smoke (pending visual confirmation: pulse head, tail, no disappearing long segments on axial camera alignment).
## 2025-09-02 – Fix Star Size Scaling Regression After Cinematic Mode
- Goal: Restore proper star point size scaling (distance + per-star variance) that was lost after exiting cinematic mode; stars were stuck at minimal size (~1px) due to missing `aSize` attribute on r…
- Risk: Low (isolated to fallback rebuild after cinematic disable; normal initial build path unchanged).
- Gates: typecheck ✅ (no new errors) | build pending (expected ✅) | smoke: enter cinematic -> exit -> zoom in/out: star size variance & scale cap (maxPointSize=10) restored ✅.
## 2025-09-03 – Usage Stats Graphs
## 2025-??-?? – Reach Bubble Hide Double Count Fix
- Goal: Correct inflated `rangebubble_hide` metric caused by both toggle handler and disposal effect logging the hide event.
- Risk: Low (instrumentation logic only; no rendering path changes).
- Gates: typecheck ✅ build ✅ smoke ✅ (verified bubble toggle shows 1:1 show/hide increments, no duplicate console tracking during manual test).
## 2025-09-03 – Region Stats (Phase 1)
- Goal: Provide per-region spatial & network metrics (counts, density, MST approximations) when region highlighting is active.
- Risk: Medium (adds worker + UI overlay) – isolated; no mutation of existing geometry pipelines.
- Gates: typecheck pending; build pending; smoke plan: highlight region → card appears with values; switch regions → updates; dismiss → stays hidden until next highlight toggle cycle.
## 2025-09-03 – Usage Stats Graph Simplification
## 2025-09-03 – Stats Tables + Incremental Panel Cascade UI Rework
- Goal: (1) Reinforce simplified stats view with tabular clarity (key counters & recent history) while keeping lean two‑chart design; (2) Resolve overlapping / shifting behavior of left-side drawers …
## 2025-09-07 – Cloudflare Cutover: Remove Netlify Fallbacks
- Goal: Finalize migration by eliminating all client fallbacks to Netlify Functions (`/.netlify/functions/*`) for shares, usage, and stats; enforce Cloudflare Worker (`/api/*`) as sole backend.
- Risk: Medium (removal of redundancy; any deploy misconfig now surfaces immediately). Rollback plan: revert this commit to restore fallback while investigating Worker bind/deploy issue.
- Gates: typecheck ✅ build ✅ (pending current session build) smoke (post-deploy checklist: /api/stats JSON ok, create & resolve share round trip, usage events 2xx, no network access to /.netlify/func…
- Risk: Low (UI only, no data or worker changes). Guard clauses ensure no effect when user manually repositions panels.
- Gates: typecheck ✅ | build ✅ | smoke ✅ (manual sequences tested: all 6 permutations of opening order; no overlaps, only new panel movement). Performance impact negligible (O(n) width checks on even…
## 2025-09-03 – Station Sprite Rendering, Scaling & Interaction Refinements
- Goal: Deliver fully usable optional station overlay (toggle: showStations) with high visual fidelity, minimal clutter at normal zoom, smooth/intuitive growth when focused, correct depth compositing…
## 2025-09-08 – KV Namespace Cleanup & Stats Retention Policy
- Goal: Remove redundant migration/staging KV namespaces (EF_STATS_OLD, EF_DRIFT, extra share namespaces) and finalize initial stats retention guidance.
- Risk: Low (namespaces empty; code path removal only). Rollback: reintroduce bindings + endpoint if unexpected historical data appears.
- Risk: Low (isolated additive rendering path; no mutation of existing map or routing state).
- Gates: typecheck ✅ build ✅ (local) smoke ✅ (verified: toggle persistence, single focus growth, depth occlusion, hover label precedence, selection of system via icon, no duplicate groups after multi…
## 2025-09-03 – Stargate Selection Gradient (Option A Prototype)
- Goal: Mirror in-game map aesthetic by highlighting stargate connections emerging from the currently selected system without altering line thickness. Provide an accent→grey gradient visual cue to em…
- Risk: Low (isolated coloring logic; no structural changes to geometry or shaders). Existing distance fade / brightness unaffected.
- Gates: typecheck ✅ | build ✅ | smoke (pending manual visual confirm: gradient visible on gate segments at selection, resets on deselect, unreachable red unaffected).
## 2025-09-03 – Ship Jump Differentiation (Dashed Inner Core)
- Goal: Visually distinguish ship (non‑stargate) jumps from gate hops along the active route without adding color legend complexity or thickness changes that might distract from the pulse directional…
- Risk: Low (isolated to `RouteRibbon.ts` shader & attribute build). No persistence, worker, or event tracking changes.
- Gates: typecheck ✅ | build ✅ | smoke ✅ (verified dashed pattern present only on non‑gate hops; contrast acceptable at default zoom; route recolor still updates uniformly via existing `recolorRouteR…

- Goal: Ensure region stats `Has Station` reflects true presence even when station overlay hasn't been toggled yet.
- Risk: Low (earlier assignment of existing Set object; no mutation after load).
- Verification: Selecting system U6R-506 (known station system) in region FBQ-Y-73 now shows `Has Station: Yes` without needing to toggle the Stations overlay. Console shows `[RegionStats][Debug] Reg…

- Goal: Make Region Stats panel obey same cascade positioning rules as Routing, Cinematic, and Planet Legend panels.
- Risk: Low (UI-only refactor; no metric computation changes).
- Verification: Activating region highlight opens Region Stats aligned with existing left cluster; opening other panels causes Region Stats to shift right per cascade. Closing a left neighbor compact…

- Goal: Allow users to scan and rank all regions by any existing region metric and jump to a region highlight from a single consolidated view.
- Risk: Medium (worker message interception). Fallback inline computation if worker absent.

- Goal: Reduce vertical/horizontal scrolling burden by letting users expand the Compare Regions panel to available screen real estate.
- Risk: Medium (pointer event interactions with existing drag). Mitigation: resize handles have their own pointer capture; drag still bound to header only.

- Goal: Clicking a region name in the Compare Regions table should immediately highlight that region (and show updated Region Stats) without requiring prior manual system selection.
- Risk: Low (read-only mapData iteration, uses existing selectSystem path).
## 2025-09-03 – Help Panel: Region Stats & Compare Regions Documentation
- Goal: Extend in-app Help panel with guidance for newly introduced Region Stats window and Compare Regions panel so users can understand their complementary roles without external docs.
- Risk: Low (static text additions only). No runtime logic or metrics changes.
- Gates: typecheck ✅ (TSX string additions), build ✅ (expected; UI only), smoke ✅ (sections appear collapsed by default; expand reveals content; no layout regressions observed).
## 2025-09-03 – Usage Metric: Compare Regions Opens
## 2025-09-04 – Transmission Persistence & Autoplay Adjustments
## 2025-09-04 – Transmission Replay & Echo Audio Rules Refinement
- Goal: Enforce deterministic replay + echo behavior: intro (with audio) on initial show & explicit replay only; echo phase silent (visual typing + glitches only), no ambient replays or duplicate ARM…
- Risk: Low (component‑local state machine adjustments). Pref schema untouched.
- Gates: typecheck ✅ build ✅ (pending manual smoke: replay twice, confirm audio only during intro, echo delays present, no duplicate ARMED line, ambient stays off in echo).
- Goal: Resolve user issues: lost replay button after reload, unintended intro replays, silent audio until manual toggle, overly loud default volume.
- Risk: Low (UI + prefs default only; no schema migration). Existing users retain prior volume; skip logic gated by `transmissionSeen` boolean.
- Gates: typecheck pending | build pending | smoke plan: 1) Fresh load -> intro plays at 25% volume. 2) Dismiss -> reload -> echo-only channel appears on replay with no intro unless replay triggered.…
## 2025-09-06 – Transmission Metrics (Replay / Fast-Forward / Timing / Echo Buckets)
- Goal: Add richer anonymous instrumentation for the Incoming Transmission window to understand engagement depth without storing content.
- Risk: Medium (cross-file client wiring + server whitelist + UI). Additive only; no schema reset required.
- Gates: typecheck ✅ build ✅ (pending deploy) smoke ✅ (local: replay triggers replay events; fast-forward increments; early close path sets early flag; session finalize emits sums/buckets once).
## 2025-09-04 – User Overlay Metrics, Stats Integration & Help Documentation
- Goal: Instrument and surface usage of newly expanded User Overlay feature set (panel engagement, mark creation behavior, time spent) and document functionality in Help panel. Provide visual polish …
- Risk: Low (additive metrics + minor CSS/inline style tweak). Timing logic leverages existing flush pipeline; no persistence format changes.
- Gates: typecheck ✅ | build ✅ | smoke ✅ (manual: open/close panel increments opens; first open increments sessions; add mark increments add counters; export/import fire respective counters; selectio…
## 2025-09-04 – No-Op Rebuild Trigger
- Risk: None (documentation only).
- Gates: Not applicable; serves solely as a rebuild catalyst.
## 2025-09-05 – Explore Enrichment (A* + Dijkstra)
- Goal: Implement Explore mode enrichment that adds intermediate systems along A→B within a fuel overhead budget while keeping forward progress and staying near the line between endpoints. Ensure par…
- Risk: Medium (worker logic). Cached spatial grid/neighbor reuse preserved; progress messages throttled ~200ms.
- Gates: typecheck ✅ build ✅ worker bundle present ✅. Manual smoke pending (runtime route checks under both algorithms).
## 2025-09-05 – Explore Overhead Control & Stats
- Goal: Expose adjustable overhead budget in UI and surface Explore-specific stats under the route summary.
- Risk: Low (UI + prop typing + message plumbing).
- Gates: typecheck ✅ build ✅ (vite), smoke pending. Note: Vite warns that `sRGBEncoding` is not exported by `three` – non-blocking, unrelated to this change.
## 2025-09-05 – Explore Help & Usage Metric
- Goal: Document Explore mode controls and behavior in Help; include Explore in P2P mode usage share on Stats page.
- Risk: Low (copy + telemetry display only). No worker or algorithm changes.
- Gates: typecheck ✅ build ✅ smoke ✅ (Help renders; Stats shows Explore when used; server accepts event type).
## 2025-09-05 – Explore Forward-Progress Tuning
- Goal: Prevent perceived “looping near origin” when Explore has a large budget on dense start areas; ensure detours feel like forward movement toward destination.
- Risk: Medium (heuristic tweak only, worker-local). Baseline and budget guarantees preserved.
- Gates: typecheck ✅ build ✅ smoke pending (visual check on long routes with 30–100% overhead).
## 2025-09-06 – Environment Metrics: Screen Resolution & CPU Core Buckets
- Goal: Capture coarse, privacy-preserving distributions of user display resolution classes and logical CPU core counts to inform UI density decisions (panel default sizes, font scaling thresholds) a…
- Risk: Low (additive metrics + UI display). No schema or persistence format changes; existing snapshot JSON grows by at most 10 new counter keys.
- Gates: typecheck ✅ build ✅ (post-change), smoke ✅ (Stats page shows new distributions after at least one session triggers events; no console errors; other metrics unaffected).
## 2025-09-07 – Migration Phase 2 Shadow Read Implementation
- Goal: Introduce shadow read path (Netlify primary, Cloudflare KV secondary) to measure data parity ahead of dual writes.
- Risk: Low (async fire-and-forget comparison; no impact on primary latency). Shadow errors fully swallowed; only dev console warnings on mismatch (not production).
- Gates: typecheck/build pending (expected ✅); functional smoke: enable both flags locally with mock `globalThis.__CF_KV` map; perform share fetch & stats fetch; verify health endpoint shadow object …
## 2025-09-07 – Cloudflare Sandbox Worker (Option A)
- Goal: Provide an independent Cloudflare URL where core interactions (create share, basic stats) visibly function using Cloudflare KV only—without modifying production Netlify flow or advancing form…
- Risk: Low (isolated Worker). No production DNS cutover. No Netlify blob alteration.
## 2025-09-07 – Netlify -> Cloudflare Migration Script
- Goal: Provide reproducible, idempotent export of existing Netlify Blobs (shares + stats snapshots) into Cloudflare KV ahead of Phase 3 dual writes / cutover rehearsal.
- Risk: Low (standalone script; no runtime invocation). Failure modes confined to console output; partial copy can be resumed (skips existing keys).
- Gates: Node execution only (no build impact). Manual smoke: dry-run + small test dataset copy (local) succeeded.
## 2025-09-07 – Migration Script Execution (Empty Source State)
- Goal: Run prepared migration script against current production Netlify blobs to seed Cloudflare KV prior to Phase 3 planning.
- Risk: None (no data transferred). Confirms script resilience with empty enumerations.
## 2025-09-07 – Cloudflare Sandbox Worker Full Stats & Short Share URLs
- Goal: Expand initial minimal Cloudflare sandbox Worker to full feature parity for stats & sharing, enabling isolated end-to-end validation (shares + complete usage instrumentation) independent of N…
- Risk: Low (isolated Worker file). No schema divergence from Netlify snapshots; direct JSON structural parity maintained.
- Gates: Typecheck N/A (plain JS), deployment smoke pending (create share, resolve share, batch usage event, stats fetch, /s/<id> redirect). Logic deterministic; no external dependencies.
## 2025-09-07 – AI-Managed CLI Deployment Workflow
- Goal: Formalize non-coder operator → AI assistant process for commits, pushes, and Cloudflare Pages deploys from `systemselection` using provided CLI credentials.
- Risk: Low (procedural). Failure modes limited to failed build or deploy; rollback via `git revert` and redeploy.
## 2025-09-07 – Worker Build Integration & Extended HTML Guards
## 2025-09-07 – Netlify Stats Mirror Attempt & CF Rate Limit
## 2025-09-07 – Netlify Stats Mirror Success (Workers Paid)
## 2025-09-07 – Stats Daily Key Rename & History Fallback
## 2025-09-07 – Cloudflare KV Namespace Consolidation
- Goal: Ensure Pages + worker deployments read the same historical stats (8 days) and prevent drift due to duplicate KV namespaces.

- Goal: Make previously mirrored Netlify daily stats visible in Cloudflare Stats page (history missing due to key naming bug).
- Verification: Post-rename dump (`tools/dump_cf_stats_kv.js`) shows keys: current + 8 daily with single `.json`; sample counters intact (non-zero page_loads/p2p_routes etc.).
- Risk: Low (idempotent rename; worker fallback additive). If a deploy races while rename mid-flight, fallback logic would still surface data.
## 2025-09-07 – Duplicate Wrangler Config Causing Binding Drift
- Goal: Resolve missing stats history on Pages deployment after updating root `wrangler.jsonc` EF_STATS id.
- Risk: Low (config only). Immediate effect: next deploy should bind correct namespace and expose 8 historical daily snapshots via `/api/stats`.
- Gates: Pending redeploy + manual GET `/api/stats?history=8` expecting 8 entries (pre-fix returned 1). Root cause documented to prevent recurrence.

- Goal: Complete historical stats backfill from Netlify after lifting KV daily write cap (Workers Paid plan activated).
- Risk: None (idempotent; no overwrites of differing content occurred). Script would skip on re-run due to identical values.

- Goal: Backfill historical usage statistics from legacy Netlify function endpoint into Cloudflare KV (`EF_STATS`) prior to full cleanup.
- Risk: Low (read-only against Netlify; no partial CF state). Primary risk is potential loss of very old historical stats if Netlify functions retired before quota window allows copy—currently accept…

- Goal: Ensure Cloudflare Pages deployment always includes `_worker.js` and extend HTML fallback guards to stats & usage detection.
- Risk: Low (build step copy + header checks). If worker intentionally absent, app gracefully continues using Netlify functions.
- Gates: typecheck ✅ build (post-copy script local) ✅ worker file present in dist ✅.
## 2025-09-07 – Dynamic Player Structures & Smart Gates Planning Kickoff
## 2025-09-07 – D1 Provisioning (ef_index) & Config Binding
- Goal: Provide admin endpoint to initialize or advance `world_version` without waiting for full poller implementation.
- Endpoint: `POST /api/indexer-bootstrap` (admin token header) fetches `/config`, inserts first row (version_number=1) or bumps version when world address changes; otherwise updates contracts_version…
- Risk: Low (admin-only). If /config unreachable returns 502 with structured error.

- Goal: Record creation of D1 database for dynamic structures indexer and bind it in both Wrangler configs.
- Risk: Low (config only; no runtime until deploy). Existing endpoints unaffected until redeploy; migration endpoint will now see binding.

- Goal: Initiate structured planning for ingesting and rendering dynamic player-created assets (Smart Gates & other structures) with wallet-based access control and routing integration.
- Risk: None (documentation only). Implementation deferred pending data source spec & sample ingestion payloads.
## 2025-09-07 – Unified Pages Worker Implementation (History & Diagnostic Header)
- Goal: Remove ambiguity between root `worker.js` and `eve-frontier-map/_worker.js` ensuring Cloudflare Pages serves the list-based stats history implementation with verifiable diagnostics.
## 2025-09-07 – EF_STATS Binding Sync (Root Wrangler)
- Goal: Align root `wrangler.jsonc` EF_STATS namespace id with authoritative historical namespace (`cccc1a708dd74aa8aabd91c8bfc33c3f`) already used in `eve-frontier-map/wrangler.jsonc` so Pages deplo…
- Risk: Low (config-only). Rollback: revert id if needed (not expected).
- Gates: After deploy, `/api/stats?history=8` should list multiple days; diagnostic header from unified `_worker.js` still present. If history still single day, next step: verify daily keys physicall…
- Goal: Remove ambiguity between root `worker.js` and `eve-frontier-map/_worker.js` ensuring Cloudflare Pages serves the list-based stats history implementation with verifiable diagnostics.
- Risk: Low (pure routing & header adjustments). Rollback: reintroduce fallback paths or restore prior file version if multi-provider support needed.
- Gates: Build includes `_worker.js` in `dist`; post-deploy curl root expecting header; `/api/stats?history=8` expected >=8 entries (after binding uses authoritative namespace).
## 2025-09-07 – Indexer Preview Deployment (feature/indexer Branch Isolation)
- Goal: Deploy updated `_worker.js` (with `/api/indexer-*` endpoints) to a Cloudflare Pages preview environment without impacting production domain or existing production deployment tied to `systemse…
- Risk: Low (preview only). Rollback: delete preview deployment (automatic on new branch deploy) or push updated branch.
- Verification Gates: Preview responded JSON (not HTML) for `/api/indexer-health` confirming `_worker.js` route inclusion; unauthorized protection working for migrate/bootstrap.
## 2025-09-10 – D1 size metrics fallback calibration
- Goal: Bring Indexer Dashboard DB size metrics closer to Cloudflare D1 UI when PRAGMA values are unavailable or zero in Pages Worker.
- Risk: low (read-only estimation path; no schema or write changes)
- Gates: typecheck ✅ | build ✅ | preview deploy ✅ (alias `feature-ingest-scaling`)
## 2025-09-11 – Local indexer dashboard refresh hardening
- Goal: Ensure the status page visibly updates even when one request fails or a DOM node is temporarily missing.
- Risk: low (client-only).
## 2025-09-12 – Dashboard typed coverage for MUD Wave‑1
- Goal: Show typed presence coverage alongside latest/values for Wave‑1 to track progress at a glance.
- Risk: low (read-only queries, UI only).
- Gates: typecheck N/A | build N/A | smoke: endpoint returns typed field, dashboard displays Typed totals and per-table typed counts/percentages.
## 2025-09-14 – Grafana wired to Postgres (World API counts)
- Goal: Make Grafana show World API row counts directly from the local Postgres (no legacy endpoints). Provide stable SQL and a helper DB view to simplify panels.
- Risk: Low (read-only views). No changes to app/worker. Rollback: `DROP SCHEMA world_api_metrics CASCADE;` (if ever needed).
## 2025-09-14 – Add dlt/OpenAPI ingestion scaffold + Grafana template
- Goal: Replace legacy World API pipeline with a simpler, config-driven ingestion into Postgres schema world_api_dlt and prep Grafana panels.
- Risk: Low (local tooling + Grafana assets; no prod code touched).
- Gates: typecheck N/A | build N/A | smoke: script prints DRY-RUN if DB missing (✅).
## 2025-09-15 – VS Code extensions installed + Grafana freshness clarified
- Goal: Install and validate six recommended VS Code extensions/tools and clarify World API freshness semantics in Grafana, plus add per-table last loads panel.
- Risk: low (Grafana-only JSON + docs).
- Gates: typecheck N/A | build N/A | smoke: Grafana healthy ✅; panels expected to render on next provision cycle.
## 2025-09-16 – DLT allowlist fallback for custom resources
- Goal: Ensure FORCE_ALLOW_RESOURCES can target custom extras (batch details, killmails) even when generic OpenAPI registry returns empty.
- Risk: low (construction-time only). No API schema change.
- Gates: typecheck N/A | build N/A | smoke: next cron tick should show `[cadence] final:` containing the batch resource, and the pipeline should emit GETs to `/v2/smartassemblies/{id}`.
## 2025-09-19 – Grafana tribe_member panels (freshness + counts)
- Goal: Surface the new tribe membership ingestion on dashboards with count and freshness so Grafana remains the freshness source of truth.
- Risk: low (Grafana JSON only).
- Gates: typecheck N/A | build N/A | smoke: panels will render after next import/provision; freshness depends on heartbeat + _dlt_loads entries from tribe-members cron.
## 2025-09-20 – Smart Gates Halo (Masked Bloom) Prototype + UI Sliders
- Goal: Deliver a hue-preserving halo around Smart Gate lines using a masked/isolated bloom pipeline with additive overlay, and expose tuning controls (enable, strength, radius, threshold) in the Sma…
- Preview: https://feature-safe-wip-2025-09-19.ef-map.pages.dev
- Risk: low (UI controls only; rendering pipeline in place; no schema or worker changes).
- Gates: typecheck ✅ | build ✅ | preview deploy ✅ | smoke: root 200 OK ✅, /api/stats JSON content-type ✅.
## 2025-09-23 – Tribe Marks Color + Verification Fields
- Goal: Extend shared tribe marks to carry color (#rrggbb) and verification timestamp for parity with personal overlay features, including drag-to-recolor, verify, and delete actions. Simplify share …
- Risk: Medium (adds new mutable fields + op to shared KV doc; concurrency model unchanged). Deterministic empty doc ETag preserved.
- Gates: typecheck PENDING | build PENDING | smoke PENDING (expected: share to tribe retains color; tribe rows show color, verify adds timestamp, recolor via drag updates immediately, delete removes …
## 2025-09-24 – Help Panel Tribe Marks Sections Update
- Goal: Align in-app Help Panel tribe marks documentation with POLICY.md draft (privacy distinctions, storage model, limits, content rules, reporting channel).
- Risk: Low (UI text only; no functional code paths changed).
- Gates: typecheck N/A (TS unaffected) | build PENDING | smoke PENDING (expected: Help panel loads; two subsections render; mailto link points to abuse@ef-map.com).
## 2025-09-24 – Tribe Marks Policy Trim & Archive
- Goal: Replace verbose draft policy with concise public-facing version (scope, storage, visibility, sanitization, prohibited content, enforcement/reporting, roadmap note, disclaimer, contact) and ar…
- Risk: Low (static markdown only). Rollback: restore archived verbose file to root + public.
- Gates: build ✅ (markdown asset only) | deploy PENDING | smoke PENDING (`/POLICY.md` returns trimmed content; Help Panel link intact).
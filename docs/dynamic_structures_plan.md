# Dynamic Player Structures & Smart Gates – Planning Document (Draft)

Status: DRAFT (Initialization)  
Last Updated: 2025-09-07

Field Mapping Freeze: See `dynamic_structures_field_mapping.md` (v1) for canonical column→source definitions governing initial migration.
Migrations: Initial schema captured in `migrations/001_init.sql`; applied via `/api/indexer-migrate` (feature branch only, admin header required).

## 1. Scope & Goals
Introduce support for dynamic in‑game player-created structures (Smart Gates + other deployables) into the EF Map: ingest authoritative external data sources, persist, expose via API, render on map, and integrate into routing cost model with per-user access control based on wallet identity (EVE Vault / MetaMask). Maintain privacy (no leaking private structure coordinates to unauthorized users) and minimize incremental latency & cost.

High-Level Goals (Phase 0 Vision):
- Show smart gate links & endpoints visibly on map (authorized subset only for a given user; public subset for anonymous users if applicable).
- Incorporate authorized smart gates into pathfinding (reduced fuel / jump cost, conditional traversal).
- Allow authenticated user to view & filter their own structures (owner, alliance/corp, etc.).
- Provide incremental automatic updates (indexer) with eventual consistency <= X minutes (TBD) behind game world state.

Non-Goals (Initial Phases):
- Real‑time (<5s) push updates.
- Complex economic / ownership history timelines.
- Fine-grained per-structure ACL editing UI (read-only consumption first).

## 2. Definitions
- Smart Gate: Player-built gate creating a directed or bidirectional link between two solar systems, possibly with access restrictions (whitelist, org membership, wallet list, fee schedule (future)).
- Structure: Generic player deployable with location (system, coordinates optional), type, owner wallet, visibility policy.
- Indexer: Autonomous process that periodically fetches authoritative structure data, normalizes, and writes to persistent storage.
- Auth Provider: Browser extension (EVE Vault / MetaMask) exposing user wallet/address and signing capability.

## 3. Data Sources (Authoritative & Supplemental)
Primary sources confirmed so far:

### 3.1 World API (HTTP, Swagger v2) – Version v0.1.38
Base (current env): `https://world-api-stillness.live.tech.evefrontier.com/`

Key endpoints (relevant to dynamic structures):
- `GET /config` – chain/world metadata (contractsVersion, world address, RPC URLs): used for wipe detection & event subscription bootstrap.
- `GET /v2/smartassemblies` (paginated, filter by `type`): master enumeration of smart assemblies (SmartGate, SmartStorageUnit, SmartTurret, NetworkNode, Refinery, Manufacturing, SmartHangar, Unknown). Each item includes: id, type, state, owner (smartCharacter), solarSystem, typeDetails, and (if a gate) embedded `gate` (destinationId, linked, inRange[], isParentNodeOnline).
- `GET /v2/smartassemblies/{id}` – detailed assembly view (gate/storage/refinery specific sub‑objects).
- `GET /v2/smartcharacters` / `{address}` – owner identity & tribe linkage.
- `GET /v2/tribes` / `{id}` – organization attributes (memberCount, taxRate) potential for org-based gate access.
- `GET /v2/solarsystems` / `{id}` – dynamic system listing (validate stable IDs vs static map DB). Includes coordinates + assemblies array (can cross-check ingestion completeness).
- `GET /v2/types` – metadata for rendering (icons, category, mass, radius) enabling type-specific visual cues.
- `GET /v2/fuels` – efficiency & type metadata; informs potential gate operational status modeling (future path weighting if fuel scarcity considered).

Observed characteristics:
- Pagination: `limit` + `offset` (smartassemblies max limit 100; some others 1000). No `updatedSince` => must implement hashing/diff.
- States: `smartAssemblyStateEnum` (unanchored, anchored, online, offline, destroyed). We'll map to internal `status` & derive availability.
- Gate link activation implied by `gate.linked == true` AND parent node online conditions (need confirmation if both required for traversal).
- Embedded `inRange` suggests proximity/network relationship; may inform prospective gating edges or multi-hop energy network – further analysis required.

Ingestion plan (World API):
1. Full bootstrap scan (parallel page fetch within rate limits), compute row content hash (`sha1(id|type|state|gate.destinationId|gate.linked|solarSystem.id|owner.address)`).
2. Maintain hash table in D1; on subsequent scans only upsert rows whose hash changes; mark missing IDs as removed (soft delete or status=orphaned until confirmed absent twice to avoid transient pagination glitches).
3. Incremental cycle interval base 60s; adaptive down to 30s if change density high (e.g., >2% assemblies mutated last cycle) else up to 120s low-activity backoff.
4. Publish adjacency snapshot only if any gate row affecting (state/linked/system/destination) changed.

### 3.2 MUD Tables (On-Chain World State)
Explorer example provided shows table queries via encoded `tableId` and SQL-like query param. These tables likely store authoritative config (ratios, gate link relationships, ACL metadata) underpinning the API surface. Rationale to integrate:
- Achieve <60s freshness via event subscriptions rather than poll-only cycles.
- Access deeper linkage / permission constructs not exposed (or delayed) in World API.

Planned approach:
1. Obtain ABIs from `/abis/config` (ABI list + contract addresses).
2. Identify events for: gate creation, gate link/unlink, state transitions, ownership transfer, fuel deposit/withdraw (if relevant to availability), structure destruction.
3. Durable Object WebSocket client to chain RPC (`rpcUrls.default.webSocket`) subscribing to relevant logs, decoding event parameters into normalized delta operations.
4. Persist deltas to D1 immediately (idempotent upsert using event-derived primary key), mark `last_seen_at`.
5. Periodic reconciliation scan (every 5–10 min) across a minimal subset of tables to detect missed events (drift metric: missed_rows/total_rows).

Fallback mode: If WebSocket offline > N seconds (configurable, default 90s), temporarily accelerate World API polling interval until streaming resumes.

### 3.3 Manual Overrides / Administrative Corrections
Small D1 table (admin_overrides) enabling suppression, aliasing, or emergency removal of erroneous rows; versioned & auditable. Exposed only to privileged operator endpoint.

### 3.4 Wipe / World Reset Detection
Indicators:
- `/config` returns changed `contractsVersion` OR different `contracts.world.address`.
- Sudden empty `smartassemblies` (two consecutive full scans) when previously >0.
- Event stream emits genesis/reset (to confirm existence).

Procedure:
1. Begin new world_version record.
2. Archive prior records (set `archived_at`).
3. Invalidate adjacency snapshot (increment version key) & KV purge old snapshot keys.
4. Broadcast via `/api/indexer-health` new version + rebuild progress; optional client banner.
5. Re-seed baseline before re-enabling routing with dynamic edges.

### 3.5 Pending Information (Gaps to Fill)
- Verified rate limits for each endpoint (requests/minute/hour).
- Definitive mapping: Are World API solar system IDs stable across wipes? If not, need translation layer linking static DB system ids to ephemeral IDs.
- Event ABIs & parameter semantics (especially gating fields) for MUD/contract layer.
- Whether gate ACL / whitelist is accessible via World API or only chain tables.
- Maximum realistic counts (gates, assemblies) & growth trajectory post-wipe.

For each source we will document: format sample, freshness cadence, consistency guarantees, failure modes, pagination, max batch size, usage limits.

## 4. Entities & Draft Data Model
Planned Core Tables / Collections (first pass; refined with initial samples). See `d1_schema_draft.sql` for concrete DDL.
### smart_gates
| field | type | notes |
|-------|------|-------|
| id | string | Stable unique (source-provided or hash) |
| system_a_id | string | Source system ID |
| system_b_id | string | Destination system ID |
| bidirectional | boolean | True if two-way (base assumption; direction-level overrides stored separately) |
| owner_wallet | string | Wallet/address of creator/owner |
| access_mode | enum('public','whitelist','org','private') | Governs traversal visibility |
| whitelist_hash | string? | (Optional) hash or reference to ACL list |
| fee_type | enum/null | Future (flat, distance_based, none) |
| fee_amount | number? | Optional |
| status | enum('active','offline','destroyed') | Lifecycle state |
| last_seen_at | timestamp | Indexer observation time |
| updated_at | timestamp | Last source change time if available |

### structures (generic)
| field | type | notes |
|-------|------|-------|
| id | string | Unique id |
| system_id | string | Location system |
| type | enum | Structure classification (gate, refinery, hub, etc.) |
| subtype | string? | Optional detail |
| owner_wallet | string | Owner |
| visibility | enum('public','restricted','private') | Display policy |
| org_id | string? | Alliance/corp id if available |
| last_seen_at | timestamp | Indexer observation |
| updated_at | timestamp | Source change time |
| meta | json | Source raw fragment / extended attributes |

### wallet_acl (optional early deferral)
| wallet | string |
| gate_id | string |
| granted_by | string? |
| expires_at | timestamp? |

### Derived / Caches
- adjacency_cache: precomputed enriched edges (smart gate edges + base stargates) keyed by version & user access segment.
 - per_user_visibility (KV, optional): compressed bitset or Bloom filter of gates visible to a specific wallet (future optimization).

Directionality & Access Notes:
- Because a user may be allowed one direction but not the reverse (confirmed), we model direction rows (`smart_gate_direction` table) rather than a single bidirectional edge. Access check = gate online && linked && (direction ACL satisfied). If no directional ACL difference, both directions share identical rules.

Scale Estimates (current / projected):
- Assemblies now ~10k; could grow 20–30k.
- SmartGate subset currently small (metadata sample total=82) but expected to scale; design indices to handle O(10^4) assemblies without full table scans.
- Poll hash table memory footprint: ~ (id + 32B hash) * assemblies (~40B * 30k ≈ 1.2MB) acceptable in Worker memory if needed; prefer D1 persistence plus selective in-memory LRU.

## 5. Storage Options Evaluation
Candidate backends:
1. Cloudflare D1 (SQLite) – relational, SQL, moderate scale, supports complex queries & indices. (Good fit for structured relationships, joins for gating + ownership.)
2. Cloudflare KV – simple key/value; good for snapshot JSON, poor for multi-field querying (would need full-scan or maintained secondary indexes). Likely for derived adjacency snapshots or simple caches, not primary canonical store.
3. R2 / External DB (Postgres managed) – more operational overhead; defer unless D1 limits (size, performance) become blocker.

Tentative Choice: D1 primary (normalized tables) + KV for fast per-user adjacency snapshots (serialized binary/JSON). Decision pending estimated data scale & query patterns.

Open Metrics to Collect Before Final Decision: expected # gates, update frequency, % ACL restricted, peak query QPS, size of ACL lists.

## 6. Indexer Architecture (Draft)
Phases:
1. Fetch phase: Pull raw pages from source(s) with ETag / If-Modified-Since caching.
2. Normalize: Map to internal schema, detect changes (hash rows) to avoid redundant writes.
3. Persist: UPSERT into D1 (batched transaction groups) + update last_seen_at.
4. Derive: Recompute affected adjacency edges & publish to KV (version bump) – incremental.
5. Metrics / Health: Write indexer run summary (duration, changed rows, errors) to KV log and expose via `/api/indexer-health`.

Execution Model Options:
- Scheduled Worker (Cron triggers) every N minutes.
- Durable Object (stream updates & maintain change cursor) (later optimization).
- External script (CI / GitHub Action) invoking wrangler to run index logic (fallback if quotas tighten).

Initial Approach: Hybrid – Scheduled Worker baseline polling + Durable Object event stream for sub-minute freshness.

Freshness Target: < 60s (user requirement). Pure 60s cron worst-case = 60s delay; event layer reduces median latency to near real-time while polling ensures eventual consistency.

Event Pipeline:
Event → Normalize → D1 Upsert → Edge Impact Analysis → Partial Adjacency Rebuild (only affected systems) → KV snapshot publish (version++). Coalesce multiple rapid events inside a 2–5s debounce window to reduce KV churn.

Metrics (Indexer Expansion):
- `index_events_received_total` (labels: type)
- `index_events_coalesced_total`
- `index_snapshot_publish_total` (with bytes & gate_count)
- `index_ws_disconnects_total`, `index_ws_reconnects_total`
- `index_reconciliation_runs_total` & `index_reconciliation_drift_ratio`

Failure Handling:
- Partial failure rollback: Use temp table or staging prefix then swap on success (for adjacency snapshots).
- Retry policy exponential backoff with jitter; persistent 4xx escalate alert.
 - Directional ACL changes (once source identified) trigger only affected direction row updates; adjacency rebuild limited to impacted origin/destination systems.

## 7. Authentication & Wallet Integration
Providers: EVE Vault extension (primary), MetaMask (secondary / optional). Both supply wallet address & signature capability.

Flow (High-Level):
1. Frontend requests a nonce from `/api/auth/nonce` (random, stored in D1 or temporary KV with TTL).
2. User signs nonce via provider; returns signature + provider id.
3. Backend verifies signature; issues session token (JWT or signed opaque) containing wallet address + expiry.
4. Client stores token (memory + sessionStorage) and sends Authorization header on structure/gate queries.
5. Authorization layer filters gate edges & structures by `(visibility == public) OR (owner_wallet == user) OR (access_mode == whitelist & wallet in ACL) OR (org match if supported)`.

Security Considerations:
- Replay prevention (single-use nonce).
- Token expiry + refresh endpoint.
- Hash/store only necessary ACL membership (avoid full PII, limit to wallet IDs & minimal org metadata).

## 8. Access Control & Permissions
Initial Policy Matrix:
| Resource | Anonymous | Authenticated (non-owner) | Owner | Whitelisted | Org Member |
|----------|-----------|---------------------------|-------|------------|-----------|
| Public Gate Edge | Read | Read | Read | Read | Read |
| Restricted Gate Edge | Hidden | Conditional (if whitelisted/org) | Read | Read | Read |
| Private Gate Edge | Hidden | Hidden | Read | Hidden | Hidden |
| Structure (non-gate) Public | Read | Read | Read | Read | Read |
| Structure Restricted | Hidden | Conditional | Read | Conditional | Conditional |
| Structure Private | Hidden | Hidden | Read | Hidden | Hidden |

### 8.1 Clarifications (2025-09-07 User Input)
User-provided updates:
- Gate access logic is ultimately programmable via attached smart contract logic (custom systemId). The typical/simple pattern will be allow/deny based on Tribe membership (org concept surfaced in World API `/v2/tribes`). Thus "access lists" should encompass: direct wallet owner, tribe membership, future extended predicates (e.g., reputation, fee paid) exposed by contract code.
- Tribe-based gating: Expect most gates to rely on tribe (org) allow rather than large explicit wallet whitelists. This reduces anticipated ACL cardinality and informs caching (focus on (tribe_id -> visible_gates) materialization vs per-wallet exhaustive lists initially).
- Wallet connection: User connects via EVE Vault or MetaMask providing a wallet address; that wallet deterministically maps to an in‑game characterId through the smart character tables (World API `smartcharacters` and chain tables). We will implement a server-side lookup to enrich session context with (wallet, characterId, tribeId(s)).
- Fuel level is irrelevant for routing inclusion beyond the binary ONLINE/OFFLINE state (we treat ONLINE = traversable, other states = non-traversable). No partial performance weighting by fuel in early phases.
- Provided world address (current active): `0x7085f3e652987f656fb8dee5aa6592197bb75de8` (captured for world_version bootstrap; verify on each `/config` fetch).
- Event Source Terminology: Earlier reference to "store event endpoint / RPC URL" maps to the chain RPC WebSocket URL available via `/config` (`rpcUrls.default.webSocket`). We'll subscribe there for MUD Store table change events (Set/Delete) to achieve sub-60s freshness.
 - Tribe membership model: Exactly one tribe per character (no multi-membership) simplifying access evaluation—union logic unnecessary; a simple equality check suffices.
 - Time-based / dynamic contract gating factors: None expected presently (user confirmation); snapshot-based evaluation remains valid within freshness SLA.

Implications:
- Update schema notes: emphasize tribe/org-based access—`gate_acl` table may be sparse or deferred; introduce potential `tribe_gate_access` materialization later if contract-level logic cannot be deterministically evaluated off-chain without contract calls.
- Access evaluation pipeline: (1) Direction state & link check (2) Gate ONLINE (3) Contract/Config gating predicate -> approximated initially by (is owner) OR (tribeId in allowed tribe set) OR (public). We'll store an optimistic public/tribe classification until deeper contract introspection available.
- Snapshot segmentation: Instead of per-wallet snapshots early, we can ship three categories: public, tribe-specific (if tribe gating common), and owner-only (fetched dynamically). This reduces KV churn.

Open Follow-ups (added to Section 14):
- Determine how contract-attached custom logic (via `configureGate`) exposes tribe allowlist semantics (table vs on-chain computed). If purely dynamic, may need an asynchronous evaluation cache keyed by (gate_id, tribe_id).
- Confirm if multiple tribes per character (alliances) exist concurrently; if hierarchical, define resolution order for access (ANY match vs ALL).

## 9. Planned API Surface (Initial)
`GET /api/gates?since=timestamp` – paginated smart gate list (filtered by auth).
`GET /api/gates/adjacency?version=hash` – returns adjacency snapshot (ETag, versioned).
`GET /api/structures?type=...&since=...` – filtered structures.
`GET /api/auth/nonce` – auth challenge.
`POST /api/auth/verify` – body { provider, wallet, signature, nonce } -> token.
`GET /api/me/structures` – user-owned structures summary.
`GET /api/indexer-health` – last run metadata.

Future:
`POST /api/preview/route` (with gating) – maybe unify with existing routing worker once adjacency snapshot version pinned.

## 10. Map Integration Plan
Rendering Layers:
- Gate Overlay: Distinct color/style for smart gate edges (dashed or glowing) with access state (locked icon if unauthorized?).
- Structure Icons: Minimal icon set per structure type; cluster/pixel-limit for performance.

Interaction:
- Hover reveals gate latency / fuel benefit & access status.
- Click opens structure detail panel (owner, status, last seen).

Performance Strategy:
- Use versioned adjacency snapshot (binary compressed) loaded once; minimal per-frame cost.
- Lazy load full structure list when overlay toggled on.

## 11. Routing Integration Adjustments
Pathfinding Worker Changes:
1. Accept dynamic adjacency overlay (smart gates) separate from static DB.
2. Merge edges at runtime, preferring gate cost rules (likely zero or reduced cost) if authorized.
3. Recompute caches when snapshot version changes or auth context changes.
4. Add instrumentation: routes_with_smart_gates, smart_gate_hops, smart_gate_savings_ms.

Edge Cases:
- Snapshot stale vs newly revoked access – tolerate until next refresh cycle (document max staleness SLA).
- Partial overlap systems with no static gate but dynamic gate (ensure DB lookups allow those destinations).
 - One-way permitted traversal: if reverse direction disallowed, pathfinding graph will only include allowed direction edge; UI must visually indicate asymmetric link.
 - Locked but visible gate: optional user preference to display as “locked” (excluded from routing) vs hidden entirely (graph omission) (exposed as toggle).

## 12. Phased Roadmap (Draft)
| Phase | Title | Key Deliverables | Exit Criteria |
|-------|-------|------------------|---------------|
| P0 | Requirements & Samples | Sample data captured, finalized model & storage decision | Approved data model & storage choice logged |
| P1 | Storage & Auth Scaffold | D1 schema migration, auth nonce+verify endpoints (mock) | Token issuance + basic gate CRUD via script |
| P2 | Indexer MVP (Polling) | Scheduled fetch + delta persist + health endpoint | Gates populate & visible via API (manual curl) |
| P3 | Event Delta Layer | Durable Object WebSocket + reconciliation | <60s freshness proven |
| P4 | Map Visualization | Frontend overlay + basic styling | Gates render; toggle & hover stable FPS |
| P5 | Routing Integration | Worker uses smart gate edges; metrics added | Routes show reduced cost vs control baseline |
| P6 | Access Control Hardening | Whitelist/org filtering enforced | Unauthorized user cannot see restricted gates |
| P7 | Optimization & Caching | Adjacency snapshot versioning + KV cache | Snapshot refresh < X ms; memory stable |
| P8 | Additional Structures | Non-gate structure ingestion & UI | Structures panel feature-complete |

## 13. Risks & Mitigations (Initial)
| Risk | Impact | Mitigation | Status |
|------|--------|-----------|--------|
| Data Source Rate Limits | Indexer gaps / stale data | Backoff + incremental cursors; cache ETag | Open |
| Auth Spoof / Replay | Unauthorized access | Signed nonce, short TTL, strict signature verification | Open |
| D1 Scale Limits | Performance degrade | Early size monitoring; partition KV snapshots | Open |
| ACL Explosion | Large whitelist slows filtering | Precompile per-user bitset / hashed membership cache | Open |
| Routing Cache Staleness | Incorrect path suggestions | Snapshot version check + forced worker cache invalidation | Open |
| WebSocket Instability | Freshness regression | Auto reconnect + reconciliation fallback | Open |
| Wipe Detection Delay | Serving stale edges post-reset | Monitor `/config` version; multi-signal confirmation; immediate rebootstrap | Open |

## 14. Open Questions
1. Exact authoritative API endpoints & authentication method? (Need docs.)
2. Expected update frequency of smart gate changes? (Minutes / hours?)
3. Typical number of gates & average whitelist size? (Scale planning.)
4. Do gates have directional asymmetry (cost, access) or always bidirectional with single rule set?
5. Are there fees / tolls now or only planned? (Cost model integration.)
6. Org hierarchy (alliance vs corp) – which levels apply for access? Both?
7. Structure coordinate precision needed (3D pos vs just system)? Affects rendering.
8. Latency / performance SLA requirements for authenticated gating queries?
9. Expected World API rate limits & recommended backoff pattern?
10. Stable mapping between World API solar system IDs and static map DB IDs? (If not stable, translation strategy.)
11. Source of truth if World API & chain event disagree momentarily?
12. Event ABIs for gate link/unlink, state change, ownership transfer – uniform or per type?
13. Max anticipated gate count & growth rate (post-wipe) for capacity planning?
14. Whitelist retrieval mechanism (explicit list vs tribe/org inference)?
15. Need for historical uptime timeline vs current snapshot only? (affects table design)
16. Are traversal permissions evaluated dynamically per jump or is <=60s snapshot acceptable?
17. Fuel impact on routing (cost modification) required phase 1 or defer?
18. Exact mechanism to extract tribe-based gate predicates from configured system contracts (table data vs call simulation)?
19. (Resolved 2025-09-07) Tribe membership: single tribe per character.
20. (Resolved 2025-09-07) No expected time-based dynamic gating factors.

### 14.1 World Reset / Wipe Handling (Detailed)
Detection Triggers: new contractsVersion, changed world address, double empty scan, or explicit chain reset event.
Purge Steps: version++ (world_version), archive old rows, invalidate KV snapshots, broadcast rebuild status, bootstrap full scan, publish new adjacency when ready.
Client UX: optional banner "Dynamic structures rebuilding after world reset" with progress counters (assemblies processed / total).

## 15. Required External Documentation / Inputs
- Source API spec (gates + structures).
- Auth provider (EVE Vault) integration guide + signing format.
- MetaMask signing format reference (if included).
- Sample payloads (min 3–5 variations: new gate, updated gate, deleted/offline gate, restricted gate with whitelist, destroyed structure).
- Ownership / org reference data (if separate endpoint).

## 16. Metrics & Instrumentation (Planned)
- ingestion_run (counter + duration sum)
- ingestion_changes (gates_added, gates_updated, gates_removed)
- smart_gate_edges_visible (per session)
- routes_with_smart_gates (% share)
- smart_gate_savings_ms (sum/count)
- auth_logins (by provider)
- auth_failures (invalid signature / expired nonce)
- acl_miss_cache vs acl_hit_cache (if membership caching implemented)
 - gate_direction_asymmetric (counter) – number of directionally asymmetric gates encountered during routing computations.
 - gate_visibility_mode (per session) – whether user chose hide-locked or show-locked.
 - gate_state_transitions (sum) – number of state changes processed (if uptime history enabled).

## 17. Glossary
Will populate once domain terms confirmed.

---
Next Step: Provide sample payloads (World API smartassembly gate, restricted gate, destroyed gate) + chain event ABI fragments to finalize Sections 3 & 4 and lock storage decision.
Addendum: Initial sample payloads retrieved (SmartGate online / unanchored examples). Need additional samples for: destroyed gate (state=destroyed), restricted access indicators (if available in chain layer), and event ABI fragments for link/unlink & permission changes.

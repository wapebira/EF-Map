# Smart Gates – Phased Implementation Plan (2025-09-20)

Purpose: Turn Smart Gates into a fully integrated feature across UI, routing, and metrics, with safe, privacy-preserving gating and preview-first deployments.

## Summary
- End goal: Everyone can view ALL Smart Gates (intelligence view). Signed-in users (SIWE) can optionally filter to ONLY gates they can traverse. Routing can optionally use those gates. Visuals remain clear across themes; metrics captured later.
- Change agreed: Do authentication first, then routing. We will land Sign-In with Ethereum (MetaMask/EVE Vault) and an authorized-gates endpoint on a Pages preview before any routing integration.
- Constraints: Cloudflare Pages + Worker + KV only (no Netlify). Pages Worker has no DB; the root Worker’s D1 bindings are disabled in production Pages. Avoid PII in KV. Preview-only until we validate.

## Scope (initial)
- Overlay polish + options (visibility, color mode); no per-user controls for opacity/thickness; no direction arrows in UI
- Snapshot schema with directionality and basic ACL classes
- Client-side auth (wallet connect with chooser – MetaMask first; EVE Vault investigation in parallel)
- Client-side filtering using public ACL classes (public / tribe / org)
- Routing integration (opt-in; respects auth-filtered gates)
- Metrics for overlays, auth, and routing with Smart Gates (deferred until later phases)
- Export automation for snapshots to EF_SNAPSHOTS

Out-of-scope (phase-1):
- Per-wallet individualized ACL checks server-side (requires durable DB access in Worker or a separate service)
- Full EVE Vault auth until we confirm browser APIs and scopes (tracked as investigation)

## Phases (auth-first)

### Phase 0 – Baseline polish (UI only)
- Overlay panel: add toggles for Show/Hide and Color mode (by owner/tribe/static). No user controls for opacity or thickness. No direction arrows in UI.
- Viewing modes: add selector – "All gates" (default, available to everyone) and "Traversable only" (requires auth; disabled until Phase 3). The UI text explains the difference.
- Fix current color issues and theme consistency (dark/orange). Ensure route line legibility when drawn over Smart Gate lines (z-order/blending). Acceptance: visually correct in both themes; no z-fighting or aliasing artifacts; route lines appear unchanged.
- Metrics: deferred; keep existing generic panel open metrics only (no new event types in this phase).

### Phase 1 – Snapshot schema and delivery
- Ensure smart_gate_links_v2 contains directed edges + flags and applied system:
  - { gate_id, fromSystemId, toSystemId, linked:boolean, online:boolean, traversalCost:number, appliedSystemId:string, isPublic:boolean, owner?:string, tribeId?:string }
  - isPublic is derived as appliedSystemId == 0x0000000000000000000000000000000000000000 (zero address implies unrestricted access)
- Defer complex aggregated ACLs until validation (custom systems may have arbitrary logic). Replace prior gate_access aggregate with a minimal snapshot for now:
  - gate_access_snapshot_v1 (minimal): { updatedAt, rules:[{ gate_id, fromSystemId, toSystemId, appliedSystemId, isPublic }] }
- Identity mapping snapshot (optional): identities_snapshot_v1 providing { walletAddress|characterId -> { name, tribeId?, orgId? } } sourced from index/Postgres (daily). Useful for UI badges; not used for authoritative checks yet.
- Continue serving via `/api/smart-gate-links` (v1 for now) and add `/api/gate-access` for the minimal ACL snapshot (KV-backed, ETag, Cache-Control, diagnostic header X-Gates-ACL-Source).
- Exporter: update Node snapshot exporter to produce both snapshots and push to EF_SNAPSHOTS.
- Acceptance: endpoints 200 with caching headers; payload sizes reasonable; UI can load both.

### Phase 2 – SIWE Auth (server + client) – BEFORE routing
- Protocol: Sign-In with Ethereum (SIWE). User connects a wallet (MetaMask primary; EVE Vault as optional) and signs a message. Server verifies and issues an HttpOnly session cookie.
- Server endpoints (Pages Worker):
  - GET `/api/auth/nonce` → { nonce, issuedAt, expiresInSec, sig } where `sig = HMAC(nonce|issuedAt|expiry)` using AUTH_HMAC_SECRET (stateless replay guard).
  - POST `/api/auth/verify` → verify SIWE message (domain, uri, version "1", chainId allowlist, nonce HMAC, expiry window) and signature (recover address). On success, set `ef_ses` HttpOnly cookie (addr, iat, exp, nonce) signed with AUTH_HMAC_SECRET.
  - GET `/api/auth/session` → { authenticated: true, address, expiresAt } or `{ authenticated:false }` by verifying `ef_ses`.
  - POST `/api/auth/logout` → clear cookie.
- Client flow:
  1) User clicks Connect → detect EIP-1193 provider (MetaMask/Evolt).
  2) GET `/api/auth/nonce` and build SIWE message: { domain: host, statement: "Sign in to EF-Map", uri: origin, version:"1", chainId, nonce, issuedAt, expirationTime }.
  3) wallet.signMessage(message) → POST `/api/auth/verify` with { message, signature }.
  4) On 200, store authenticated UI state (cookie is HttpOnly; JS never stores token).
- Security & privacy: No PII stored; cookie is HttpOnly Secure SameSite=Lax; short nonce window (~5 min) and session TTL (1–6h). Domain+URI binding enforced.
- Acceptance (preview): Endpoints work; session persists; UI shows “Signed in as 0x…”. No console errors.

### Phase 3 – Authorized gates API + overlay filtering
- Server: GET `/api/authorized-gates` (requires `ef_ses`) returns { updatedAt, snapshotEtag, edges:[{ from, to, gateId }] }.
  - Implementation v1: public-only fallback (uses `isPublic`); v2: per-user derivation via RPC against chain (PYROPE_RPC), optionally cached in KV under `auth_edges_v1/{address}/{snapshotEtag}`.
  - Caching: ETag combining {address, snapshotEtag}; Cache-Control short TTL; headers `X-Auth-Addr`, `X-Auth-Edges` for diagnostics.
- Client: Smart Gates panel gets “Authorized only” (enabled when signed in). Fetch authorized edges and filter overlay immediately; fall back to public-only if unauthenticated.
- Acceptance: Gate counts drop appropriately; toggling modes updates lines without reload; preview headers show ETag and diagnostics.
- Viewing modes enforced: "All gates" and "Traversable only".
- MVP Traversable behavior: Public-only first (uses isPublic=true; does not require auth). This gives an immediate useful filter without on-chain calls.
- Future Traversable behavior: If authenticated, optionally evaluate non-public gates on-demand via on-chain view calls (see Validation plan); otherwise leave them hidden in traversable mode.
- Unauthenticated users: no warning required for viewing "All gates" (since it's allowed). Optional info banner can suggest connecting to enable "Traversable only".
- Metrics: counters for smart_gates_connect_click, smart_gates_connected, smart_gates_traversable_mode (sessions), and mode switches. (Added in this phase.)
- Acceptance: Gate counts change as expected when switching modes; no console errors; perf remains smooth.

### Phase 4 – Routing integration (after auth)
- Add “Use Smart Gates” option in Routing panel (checkbox + tooltip). Default off.
- Modify `routing_worker.ts` to include directed smart-gate edges when enabled; respect auth-filtered edges.
- Cost model: allow traversalCost (0 for free); no additional cooldown/cost semantics. Ensure caches invalidate when gate toggle changes. Directionality is enforced strictly in neighbor generation.
- Authorization checks in routing (future): For MVP, include only public gates in routing when "Use Smart Gates" is on. After validation, consider batched/thresholded on-chain checks for candidate gates (see Validation plan) with strict throttling.
- Edge cases: no available authorized gate -> fallback path without gates; progress messages throttled; identical results when toggle off.
- Metrics: p2p_route with gate usage flags (p2p_mode_smartgates_on/off), smart_gates_paths_used, smart_gates_saved_hops.
- Acceptance: Same paths when off; valid paths with gates when on; time to first route unchanged within +/- 10% on medium routes.

### Phase 5 – Visual integration for routes
- Keep existing route styling unchanged. Ensure route lines render identically whether over stargate (light gray) or smart gate (colored) lines by adjusting z-order/blending if needed.
- Acceptance: Route visuals match current appearance in both themes (baseline screenshots). No special segment styling for smart gates in this phase.

### Phase 6 – Automation & ops
- Exporter cron (local or CI) to publish snapshots to EF_SNAPSHOTS.
- Pages Worker endpoint `/api/gate-access` added with ETag + caching.
- Preview-only deploys to validate payload & UI before production.
- Acceptance: Manual “seed & verify” checklist passes; Pages endpoints show correct diagnostic headers.

## Data contracts (draft)
- smart_gate_links_v2.json
  - { updatedAt, worldVersion, links:[{ gate_id, fromSystemId, toSystemId, linked, online, traversalCost, appliedSystemId, isPublic, owner?, tribeId? }] }
- gate_access_snapshot_v1.json (minimal)
  - { updatedAt, rules:[{ gate_id, fromSystemId, toSystemId, appliedSystemId, isPublic }] }

Authorized gates response (server-derived per user):
- authorized_gates_v1 (API response only)
  - { updatedAt, snapshotEtag, addr, edges:[{ fromSystemId:number, toSystemId:number, gate_id:string }] }

Both delivered via EF_SNAPSHOTS KV, read by Worker, with ETag + short max-age.

## Metrics (add to usage.ts and Worker EVENT_MAP)
- Phase sequencing: New metrics are introduced starting in Phase 3 (auth/mode switches) and Phase 4 (routing). No new metrics in Phase 0.
- Overlay/view: smart_gates_view (optional), smart_gates_mode_switch, smart_gates_traversable_mode
- Auth: smart_gates_connect_click, smart_gates_connected, smart_gates_auth_fail
- Routing: smart_gates_paths_used, smart_gates_saved_hops (sum saved ly)

## Risks & mitigations
- Per-wallet ACL requires server-side lookup: defer; use tribe/org public ACL snapshots first.
- Large snapshots → latency: compress schema; keep only fields needed for client filtering.
- Auth UX friction: keep optional; provide public-only mode with clear messaging.
- Theming issues: add visual baselines; test both themes; adjust shader/material blending.

## Open questions
- Resolved: Canonical source for tribe/org membership mapping – our Postgres index data (via identity snapshot published alongside other snapshots). No live lookups required; daily refresh.
- Resolved: No additional costs/cooldowns beyond directionality. Only enforce directed traversal.
- Pending: EVE Vault capabilities and identifier stability in browser contexts (investigation in Phase 2 spike).
- Pending: Exact on-chain view interface for non-public traversal checks (method name/signature/ABI) on the applied system contract per gate. Confirm whether a single standard interface exists or it varies by system.

## Validation plan (new)
Goal: Validate access semantics before implementing non-public traversable filtering and routing with auth-aware gates.

1) Source of truth for applied system per gate
  - From indexer/Postgres: confirm we have columns mapping gate_id → appliedSystemId. If absent, identify the table/event to derive it and extend the exporter accordingly.

2) Public vs non-public gates
  - Confirm invariant: appliedSystemId == zero address (0x000…000) implies unrestricted traversal for everyone (no cost/ACL). Validate with two real gates in-game/client and chain data.

3) On-chain authorization check (non-public)
  - Identify the view method to test traversal permission for a specific user. Likely on the applied system contract (Access/Configure/SmartGate System): e.g., `canTraverse(gateId, fromSystemId, toSystemId, account)` (or equivalent). Confirm exact ABI.
  - Produce an ABI snippet and a minimal harness (viem `publicClient.call`) against PYROPE_RPC for (appliedSystemId, context, user) returning boolean.

4) Performance strategy for UI/routing
  - MVP: Traversable = Public-only (snapshot flag). No RPC calls.
  - Next: For map filtering, allow on-demand checks for gates in current viewport (debounced, capped). For routing, only consider public gates initially; later, batch-check a small frontier of candidate gates when beneficial, under strict timeouts.

5) Acceptance for validation
  - We can prove with at least 1 public and 1 non-public gate that the view returns expected results for two addresses (one allowed, one not), and the appliedSystemId matches indexer data.

## Acceptance criteria (roll-up)
- Users can connect/disconnect; overlay updates to their access profile; routing respects it when enabled.
- Endpoints stable; metrics visible in Stats; visuals correct in both themes.

## Work breakdown (initial tickets)
1) UI: Overlay options (show/hide, color mode), viewing mode selector (All vs Traversable), color fixes, route legibility guardrails
2) Snapshot v2 (add appliedSystemId, isPublic) and minimal gate_access snapshot + Worker endpoint
3) SIWE auth (server: nonce/verify/session/logout; client: Connect/Sign with MetaMask/EVE Vault) + UI badge
4) Authorized gates API + overlay filtering (v1 public-only fallback; v2 per-user RPC derivation + KV caching)
5) Routing integration toggle + worker changes + perf guardrails (auth-aware edges)
6) Route visual legibility validation (no style changes)
7) Metrics wiring (usage.ts + Worker EVENT_MAP + Stats UI) – starting Phase 3/4
8) Exporter automation + seed & verify checklist

---
Owner: EF-Map
Links: See decision-log top quick reference for endpoints and bindings.

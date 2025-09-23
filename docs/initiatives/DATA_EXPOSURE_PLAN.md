# EF-Map – Data Exposure Plan (Snapshots → Auth → Prequeries → Dynamic)

Purpose
- Make locally indexed data queryable by the Cloudflare-hosted site without overloading Cloudflare storage/reads.
- Start with low-risk, cached snapshots; add auth-gated personalized data; later unlock dynamic queries via a hosted Postgres mirror.

Scope (non-goals)
- Do not modify production site directly. All changes validate via Cloudflare Pages Preview deployments first.
- No Netlify reintroduction. Cloudflare Pages + Worker + KV remain the platform.

Guiding principles
- Minimize Cloudflare runtime reads with CDN-cached snapshots and compact precomputed maps.
- Keep endpoints read-only and cacheable (ETag + Cache-Control). Add small KV shards for personalized overlays.
- Prefer simple, observable pipelines with clear SLAs and fallbacks.

Phases (incremental)
1) Snapshots (Now)
   - Export compact JSON from local Postgres on a short cadence.
   - Initial artifacts:
     - smart_gate_links_v1.json
       { edges: [{ aSystemId, bSystemId, srcGateId, dstGateId, srcState, dstState, lastBlock, generatedAt }] }
     - system_overlays_v1.json
       { [systemId: string]: { tribeId?: string, dominantOwner?: string, structureFlags?: { hasRefinery?: boolean, hasGate?: boolean, hasMarket?: boolean }, updatedAt: string } }
   - Storage: KV for small (links), R2 or Pages static asset for larger overlays.
   - Worker endpoints:
     - GET /api/smart-gate-links → KV read + 30–60s cache
     - GET /api/system-overlays?v=tribe|owner|structures → serve filtered vector from R2/asset with 1–5 min cache

2) Auth-gated personal overlays (Soon)
   - Sign-in with MetaMask or EVE Vault: nonce → signature → verify → JWT (15–60 min).
   - Per-user KV shard: addr:<0x…> → { allowedGateIds: string[], myStructures: { systemId: string, type: string }[] }.
   - Endpoint: GET /api/my/overlays → merge(global overlays, user shard) and return view-limited data.
   - Rate limits: per-IP unauth, per-JWT auth; Cache API for 30–60s when safe.

3) Prequeries (Short list of curated queries)
   - Publish precomputed result sets users can choose from (e.g., “All smart nodes by tribe”, “All structures by type”).
   - Store as versioned JSON (R2/asset) with 1–5 min cache.
   - Frontend offers dropdowns tied to these named datasets (no arbitrary SQL).

4) Dynamic (Optional)
   - Hosted Postgres (Oracle Cloud) mirrors local data; Cloudflare Worker reads via Hyperdrive with strict caching and param validation.
   - Use for ad hoc queries that don’t justify precomputation.

Data freshness targets
- Smart gate links: ≤ 60–120s from source change to served snapshot.
- Overlays & prequeries: ≤ 5 minutes typical.
- Dynamic queries: cache 30–120s by params.

Security & abuse controls
- JWT sessions (HttpOnly cookies) after signature login.
- Rate limits by IP and by JWT; payload caps; param whitelists.
- No PII; only public game/chain data and user-owned items post-auth.

Redundancy & fallback
- Two publishers can write snapshots: primary (hosted/Oracle) and secondary (local).
- Worker prefers the freshest snapshot; falls back to the last-good version on errors.

Preview deploy protocol
- All Worker/API changes go to Cloudflare Pages Preview deployments. Production remains untouched until approved.
- Preview URLs: https://<branch>.<project>.pages.dev; secrets set per-branch.

Acceptance criteria per phase
- P1 Snapshots: /api/smart-gate-links returns JSON with ETag; overlay renders within <400ms typical; freshness ≤2m.
- P2 Auth overlays: login works; /api/my/overlays returns filtered edges; rate limits observed in logs.
- P3 Prequeries: named datasets visible in UI; switch and recolor within seconds.
- P4 Dynamic: one read endpoint via Hyperdrive returns within ~1–3s and is cached by params.

Implementation breadcrumbs
- Exporter location: tools/ (Node or Python). Include DRY_RUN and concise logs.
- Storage bindings: reuse existing KV; add R2 bucket if overlays exceed KV friendliness.
- Worker: extend _worker.js with /api/* routes, using Cache API and ETag support.
- Frontend: add overlay toggle panel; reuse sql.js for local joins when needed.

References
- docs/decision-log.md (see entries 2025-09-15 and 2025-09-19)
- .github/copilot-instructions.md (Cloudflare-first, CLI mandate, preview deploy protocol)
- AGENTS.md (quick facts and rules)

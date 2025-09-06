# Copilot Project Instructions (EF-Map)

Purpose: This repo hosts (1) map data processing scripts (Python) for EVE Frontier star/region data, and (2) a deployable interactive web app (`eve-frontier-map/`) built with React + TypeScript + Vite and Netlify Functions for lightweight serverless features (sharing + anonymous usage stats). Follow the patterns below when adding or modifying code. This file is optimized for a "Vibe coding" workflow: the human provides intent (non‑coder) and the AI agent converts intent into safe, minimal, verifiable changes.

## Operator Quick Start (Non‑Coder)
1. Describe goal in plain language (what you want to see changed / added / fixed).
2. Assistant replies with: checklist, assumptions (≤2), risk class, plan.
3. You approve or adjust scope (optionally grant token if High risk or migration phase).
4. Assistant patches code, runs typecheck/build, reports gates & follow-ups.
5. Non-trivial decisions appended to `docs/decision-log.md` (≤10 lines each).
6. Multi-day / migration tasks update `docs/MIGRATION_PLAN.md` & `migration_status.json` before further code.

If stuck: ask for "safer alternative" or "explain tradeoffs". Avoid giving line-by-line code; just describe desired outcome.

## Architecture Overview
- Root Python scripts + JSON assets generate / transform map data consumed by the web app. No runtime coupling – they are one‑off preprocessing utilities.
- Frontend lives in `eve-frontier-map/`: pure client (React + TS) + in‑browser SQLite (`sql.js`) + Web Workers for heavy computation (routing / optimization) + Netlify Functions for persistence (shares, usage stats) via `@netlify/blobs` key‑value storage.
- Data Flow (frontend):
  1. Static DB / JSON loaded (see `public/map_data.db`, other JSON) -> app state.
  2. User interactions dispatch events; heavy pathfinding runs inside workers (`src/utils/routing_worker.ts`, `workers/*`).
  3. Instrumentation (`src/utils/usage.ts`) batches anonymous aggregate events to `/.netlify/functions/usage-event` which updates blob snapshots; `/stats` function exposes aggregates to Stats page component.
  4. Share creation: client compresses route state -> POST `create-share` -> returns short id -> user can later GET via `get-share`.
- Cinematic mode: toggled global via `window.__efSetCinematic(bool)` (set inside `App.tsx`), tracked for enter/session/time metrics.

Reference index: see `docs/README.md` for links to broader specs (`PROJECT_REQUIREMENTS.md`, cinematic spec, operational playbooks).

Cloud Platform (current & upcoming): Currently Netlify (Functions + Blobs). Migration to Cloudflare (Workers + KV, optional D1 later) will proceed via token-gated phases. Do not introduce new direct provider calls outside the abstraction. See `docs/MIGRATION_PLAN.md` for phased plan & tokens.

## Key Folders / Files
- `eve-frontier-map/src/App.tsx`: top-level state & feature toggles (cinematic, panels, routing integration, event bridges to `usage.ts`).
- `src/components/` panels: modular UI sections. Keep each self-contained; avoid cross-importing sibling panel internals.
- `src/utils/usage.ts`: ONLY place to emit usage events. Add new event types here + whitelist in `netlify/functions/usage-event.js`.
- `netlify/functions/*.js`: serverless endpoints. Pure, stateless, small. Interact with blobs via credential fallbacks (siteID+token -> implicit -> memory fallback). Mirror the defensive patterns already present.
- `src/utils/routing_worker.ts` & `workers/scout_optimizer_worker.ts`: long-running / heavy algorithms kept off main thread; progress messages throttled ~200ms. Follow existing message protocol: `{ type:'progress', ... }` and final result object.
- `src/lib/sql.ts`: wrapper to lazy-init `sql.js` & open DB from ArrayBuffer. Reuse `getSql()`; do not reinitialize WASM.

## Conventions & Patterns
- State bridging to globals: When a feature needs instrumentation (cinematic), expose a single global setter (e.g. `__efSetCinematic`) rather than sprinkling tracking calls. Extend this pattern for new mode-level timers.
- Usage metrics categories:
  - Counters: increment-only events (`cinematic_enter`).
  - First-in-session counters: fire a `*_first` event to also increment a separate `*_sessions` counter (see cinematic).
  - Time sums: send `{ type:'xyz_time', ms }` at end-of-session. Client accumulates, server declares `sum/count` keys in EVENT_MAP.
  - Buckets: client chooses bucket id, server just counts (see `session_bucket`).
- Adding a new metric: (1) emit in `usage.ts` (debounced/batched) (2) add mapping in `usage-event.js` with counters or sum schema (3) extend Stats page display logic (search for existing key patterns).
- Web worker performance: Reuse spatial grid & neighbor caches keyed by integer cellSize. When parameters change invalidating cell size, clear caches (`spatialGrids.clear(); neighborCache.clear();`). Preserve this to avoid memory bloat / wrong neighbor reuse.
- Pathfinding cost model: `optimizeFor='fuel'` assigns cost 0 to stargate edges (gate adjacency) & distance to ship jumps; `'jumps'` uses unit cost for all reachable neighbors.
- Large UI text generation (route notes): build condensed representation first (segments) then paginate to max length (1500 chars). If replicating, follow pattern in `P2PRouting.tsx` to avoid off-by-one page bugs.
- Defensive storage usage: All Netlify functions attempt explicit credential creation, fallback to implicit, then optional in-memory ephemeral Map (used for dev/local). Replicate this sequence.
- Do NOT store PII; events are aggregate only. Keep new event payload fields whitelisted and non-identifying.

### Vibe Coding (Non‑Coder Operator) Guidance
When the user (non‑coder) asks for a change:
1. Restate goal as a concise checklist (what will change, files likely touched).
2. Identify risk level: core rendering / schema / worker performance / simple UI.
3. If risky token required (CORE CHANGE OK, SCHEMA CHANGE OK, BUNDLE WORKER OK) and not provided: propose safer alternative or request token.
4. Propose minimal patch; avoid refactors unless solving an explicit pain point.
5. After patch: ensure typecheck + build succeed (or list commands for user to run if execution unavailable) and note any manual smoke steps.
6. Update or create docs only if behavior, metrics, or public API changed—otherwise skip doc churn.
7. Offer a brief rationale when choosing between multiple implementations (e.g., caching strategy, data shape) so the operator can approve.

Language expectations: The AI should prefer plain language over jargon when explaining tradeoffs; surface 1–2 alternative approaches only if materially different in complexity or performance.

### Assistant Interaction Protocol (Strict Sequence)
1. Intent Echo: Restate user goal as bullet checklist (features, constraints, data touched).
2. Assumptions: Call out at most 2 inferred assumptions (or ask if blocking).
3. Risk Class: Label change Low / Medium / High (see below) + required tokens if any.
4. Plan: List files to read/edit, expected diff size, verification steps.
5. Patch: Apply minimal diff; avoid unrelated formatting.
6. Verify: Typecheck + build + (describe smoke steps). If unable to run, output exact commands.
7. Summarize: What changed, gates status, follow-ups.
8. Decision Log: Append entry if non-trivial (or batch multiple tiny doc edits).

### Risk Classes & Escalation Triggers
- Low: Pure docs, styling (CSS), isolated panel UI, copy tweaks.
- Medium: New worker file, Netlify/usage metric addition, minor routing heuristic tweak, new Netlify function.
- High: Core rendering (`App.tsx` starfield / selection), schema/data shape, performance-critical loops, global state patterns, storage migration.
Escalate / request token if: touching protected anchors, >3 core files, >150 LoC delta, adds dependency, alters persisted data format, or introduces new storage layer.

### Prompt Patterns (Examples)
Good Feature Prompt: "Add a toggle in Routing panel to switch algorithm default (A*, Dijkstra). Persist choice. Success: user change reflected after reload; no regression in existing routing."\
Good Performance Prompt: "Reduce neighbor lookup overhead in routing_worker (current O(n) scan). Goal: same paths, fewer explored nodes (>10% on medium routes)."
Weak Prompt → Rewrite: "Make it faster" → "Optimize A* enqueue: avoid sorting whole array each insert (binary heap). Maintain identical path results."

### Minimal Patch Contract
Each change must include: reason, scope (files), diff size estimate, success criteria, rollback (revert commit). Avoid speculative refactors.

### Safer Alternative Rule
If user asks for broad refactor, first propose smallest path to accomplish user-visible benefit; proceed only after confirmation or token granting scope.

### Quality Gates (Always)
- Typecheck passes (no new TS errors).
- Build succeeds.
- Smoke: map renders, orbit/pan/zoom, hover label, selection label, search works, no startup console errors.
- Additional (if metrics): event appears in `usage-event.js` EVENT_MAP and Stats page (or noted intentionally hidden).

### Decision Log Template
`## YYYY-MM-DD – <Title>`\
`- Goal:`\
`- Files:`\
`- Diff:` (added/removed LoC)\
`- Risk:` low/med/high\
`- Gates:` typecheck ✅|❌ build ✅|❌ smoke ✅|❌\
`- Follow-ups:` (optional)

### Common Failure Modes & Preventers
- Double metric counting → centralize in `usage.ts` only.
- Routing cache stale after jump distance change → ensure spatial cache invalidation (already in `findPath`).
- Route note pagination regressions → keep segment-first pagination (see `P2PRouting.tsx`).
- Worker progress spam → throttle ≥200ms (mirror existing pattern).

### Cloudflare Migration Pointer
Full phased, token-gated migration plan (audit → shadow → dual write → cutover → cleanup) lives in `docs/MIGRATION_PLAN.md`. This instructions file only carries high-level rules:
* Never modify `_store.js` for Cloudflare without appropriate phase token (see tokens list below).
* Keep new persistence logic behind explicit env flags until cutover phase.
* All parity / drift metrics are documented & must pass before advancing phases.

### Migration Tokens (Phased)
- `MIGRATE PHASE0 OK` – Audit / hardening (no runtime change)
- `MIGRATE PHASE1 OK` – Introduce adapter skeleton (flagged)
- `MIGRATE PHASE2 OK` – Shadow reads (dual fetch compare)
- `MIGRATE PHASE3 OK` – Dual write (primary Netlify)
- `MIGRATE PHASE4 OK` – Cutover (primary Cloudflare, fallback Netlify)
- `MIGRATE CLEANUP OK` – Remove Netlify paths
Legacy `MIGRATE STORAGE OK` treated as superseded; use phased tokens instead.

Token Granting: Operator explicitly states token phrase. Assistant must echo acceptance and update `MIGRATION_PLAN.md` & `migration_status.json` before code edits.

Natural Language Triggers: You do NOT need to say exact token phrases. The assistant will interpret plain English like:
- "Let's start the migration" → treat as request for Phase 0 token.
- "Add the adapter scaffold" / "ready for the adapter" → Phase 1.
- "Can we compare both systems now?" / "begin shadow reads" → Phase 2.
- "Write to both so we can test" / "dual write time" → Phase 3.
- "Switch production to Cloudflare" / "cut over now" → Phase 4.
- "Remove Netlify code" / "clean up leftovers" → Cleanup phase.
If ambiguous, assistant will clarify before acting. If phrasing suggests skipping phases, assistant will propose required intermediate steps first.

Cloudflare UI Help: When you indicate readiness (e.g. "Help me set up Cloudflare now"), assistant will provide step-by-step portal actions (create account, enable Workers, create KV namespace, note binding name, retrieve API token) before any code changes.

Advancement Requirements (summary):
- Phase2 exit: <0.5% drift 7 consecutive days
- Phase3 exit: near-zero drift & <0.1% write fail
- Phase4 exit: fallback <0.1% & latency p95 within ±15%
### Multi-Day Task Handling
If a task spans sessions (> ~2 hours or multiple approvals) create/update a dedicated section in either:
- `docs/MIGRATION_PLAN.md` (for migration-related) OR
- A new small doc (feature-specific) linked from decision log.
Assistant must resume by reading last 20 lines of relevant doc + newest decision log entry.

### Resumption Protocol
On new session for an ongoing multi-day effort assistant does:
1. Read `docs/migration_status.json` (if migration) and tail of `MIGRATION_PLAN.md`.
2. Summarize current phase, remaining checklist items.
3. Propose next micro-step (≤30 min scope) for approval.

### Metrics Parity & Drift Gates
Drift formula: |A−B| / max(B,1). Unless otherwise stated B = baseline provider (Netlify). Gates:
- Shadow (P2): <0.5% average drift (counters & sums)
- Dual Write (P3): <0.2% sustained
- Pre-Cutover (enter P4): effectively 0% (allow single off-by-one during flush window)
Violation triggers rollback actions (see Rollback Guidance).

### Rollback Guidance (Quick Table)
| Scenario | Phase | Action |
|----------|-------|--------|
| Drift spike >= gate | 2/3 | Freeze advancement; disable shadow/dual flags; log entry |
| Cloudflare write errors >0.5% hour | 3 | Disable CF writes; investigate; do not advance |
| Fallback rate >=0.5% hour | 4 | Revert primary switch commit; re-enable Netlify primary |
| Latency regression >15% p95 | 4 | Add caching / revert; re-measure |

### Risk Register Pattern
Maintain in plan doc: `Risk | Impact | Mitigation | Trigger | Status`. Update status rather than duplicating lines in decision log (log only deltas or new risks).

### When to Update Which Doc
| Change Type | Doc |
|-------------|-----|
| Code decision (non-trivial) | decision-log.md |
| Migration phase progress | MIGRATION_PLAN.md + migration_status.json |
| Global workflow rule change | This file |
| Tiny copy tweak / style | No doc update |

### AI Output Style Shortcuts
Assistant may label responses (plain text, no markup needed) at top with one of: `PATCH PROPOSAL`, `PHASE STATUS`, `RISK UPDATE`, `ROLLBACK ADVICE` for quick scanning.

### Cloudflare UI Setup (Operator Cheat Sheet)
The assistant can walk you through these when you say you're ready; listed here for transparency:
1. Create / log into Cloudflare account.
2. Enable Workers & KV (free tier sufficient initially).
3. Create a KV Namespace for shares (suggested: `EF_SHARES`). Save its ID.
4. Create a KV Namespace for stats (suggested: `EF_STATS`). Save its ID.
5. (Optional early) Create separate namespace for drift diagnostics `EF_DRIFT`.
6. Generate an API Token with permissions: Account.Workers KV Storage (Read & Write). Store securely (not committed).
7. Decide binding names (e.g., `SHARES_KV`, `STATS_KV`). These will appear in worker config or environment mapping.
8. Provide the namespace IDs & chosen binding names in chat (plain language fine) – assistant will scaffold adapter referencing placeholders (never committing secrets, only variable names).
9. Later (Cutover) verify DNS routing or custom domain for Workers if serving endpoints directly (not required if still fronted by existing hosting).

Secrets Handling: Do not paste full API tokens into repository. Assistant will create `.env.example` entries if needed and reference environment variables only.

### Pre-Migration Implementation Guidelines
- Encapsulate blob operations: future helper `getStatsStore()` analog for Cloudflare; design interface now: `{ get(key), set(key,value) }`.
- Keep JSON snapshot schema versioned (already `SCHEMA_VERSION`). Bump only when strictly necessary; add forward-compatible fields.
- Document any new persistent key patterns in decision log.

## Development Workflow
- Install frontend deps: `cd eve-frontier-map && npm install` (root has no package management for Python scripts; run them directly with system Python).
- Run dev server: `npm run dev` inside `eve-frontier-map/` (Vite). Netlify functions served via local dev (if using Netlify CLI, mimic fetch paths `/.netlify/functions/...`).
- Build: `npm run build` (outputs to `dist/`). Ensure that any added worker is referenced so Vite bundles it.
- Lint: `eslint` config lives at root of `eve-frontier-map` (ESLint flat config). Prefer TypeScript strictness; keep new TS files typed (no implicit any).
- Python preprocessing (optional): run `python create_map_data.py` then `python filter_map_data.py` when regenerating map data from fresh game exports.
- Decision log: if introducing non-trivial behavior or a new metric, append an entry to (or create) `docs/decision-log.md` summarizing change and verification steps.

## Adding Features (Examples)
- New engagement mode with timing:
  1. In `App.tsx`, manage `[newMode, setNewMode]` + `useRef` pattern.
  2. Expose `window.__efSetNewMode` analogous to cinematic.
  3. In `usage.ts`, add internal state (active flag, accum start/stop) & track `newmode_first`, `newmode_enter`, and final `newmode_time` at finalize.
  4. Update EVENT_MAP in `usage-event.js` with counters & sum definition.
- New worker algorithm:
  - Place file under `src/utils/` or `workers/`. Maintain message API: input request object, progress emits, final response. Throttle progress to <=5Hz.
  - Keep pure, no DOM. Use caches keyed off request parameters to avoid recomputation.

## Pitfalls / Gotchas
- Changing max jump distance invalidates spatial grid size; ensure caches cleared when cell size changes (see `findPath`).
- Avoid iterating `Object.values(stargates)` inside tight neighbor loops if adding new algorithms—consider pre-built adjacency maps like in `existsPathWithin` if performance regresses.
- Usage events: exceeding `MAX_BATCH=12` triggers immediate flush; do not enqueue large bursts > a few dozen per interaction.
- Ensure any new counter name added to EVENT_MAP is also displayed or intentionally ignored; silent accumulation without UI is acceptable but document internally.
- Do not directly call `track()` from multiple places for the same semantic event—centralize logic to avoid double counting.
 - For multi-step user feature requests, implement incrementally: land instrumentation first, then UI control, then worker logic, validating each step.
 - Stations data integration: regeneration requires `mapobjects.db` present at root. Heuristic picks first table containing 'station' with a system id column variant; absence is non-fatal. Bump DB filename (currently `map_data_v2.db`) only when schema/format changes.

## When Unsure
- Search existing patterns first (grep for similar feature names).
- Mirror cinematic mode for any UI mode needing session vs enter counts + time.
- Keep serverless functions < ~150 lines, no external state besides blobs, return 4xx on validation errors early.

(End) – Provide feedback if additional sections (e.g., tests, optimizer internals) should be documented.

## 2025-09-03 – Region Stats Metric Simplification

## 2025-09-04 – Usage Dev 404 Auto-Disable & Transmission Replay Fix
- Goal: Stop noisy console spam of repeated 404 errors for usage tracking when running plain Vite dev (no Netlify functions) and ensure transmission replay truly restarts intro with audio.
- Changes:
  - usage.ts: Added first-404 detection (status 404) → sets `disabledDueToMissingEndpoint`, clears queue, halts future scheduling; exposes `window.__efEnableUsageTracking()` to re-enable manually after starting functions.
  - transmission: Gated `transmission_major_glitch` tracking to intro typing only (removed perpetual post-intro events).
  - transmission replay: Reset intro init guard (`hasIntroInitializedRef`) before `initIntro()` so replay re-types intro lines & plays ambient once.
- Risk: Low (utility + component-local adjustments). No schema or server function changes.
- Gates: typecheck ✅ build ✅ (post-change). Manual smoke: dev start w/out functions now prints single disable message; replay triggers full intro and audio; major glitch events stop after intro.
- Follow-ups: Optional UI indicator when usage disabled; potential echo delay jitter metric later.
## 2025-09-03 – Region Stats Baseline Distance Integration
- Goal: Replace earlier MST/attachment placeholders with nearest-neighbor baseline distances (gate-aware) matching Scout Optimizer philosophy for gated-only and all-system stats.
- Files: `src/workers/region_stats_worker.ts`.
- Implementation: Added gate adjacency BFS, per-pair evaluation cache, and NN route builder to derive `est_gated_distance_ly`, `est_gated_gate_jumps`, `est_all_distance_ly`, `all_gate_jumps`, `ship_jumps`, `ship_jump_ly`, `total_jumps`.
- Rationale: Provide users realistic traversal-like figures (gate hops and required ship legs) instead of abstract MST lower bounds; slight compute increase acceptable.
- Risk: Low (contained within worker). Complexity O(n^2) BFS worst-case per region acceptable at current region sizes.
- Follow-ups: Optional enhancement to incorporate ship range trade rules configurable in panel if needed.

## 2025-09-03 – Region Stats Has Station Flag
- Goal: Add simple boolean indicator showing if any system in the highlighted region contains a station (leverages existing station dataset powering station icons).
- Files: `src/workers/region_stats_worker.ts`, `src/components/RegionStatsCard.tsx`, `src/App.tsx`.
- Implementation: Added `has_station` to worker `SystemLite` and aggregated `RegionStats` (true if any system has flag). App passes station presence via `stationSystemIdSetRef` into systems array for worker + inline fallback. UI card displays "Has Station: Yes/No".
- Rationale: Quick triage for region viability without toggling station overlay or visually scanning. Minimal compute cost.
- Risk: Low (additive field). Falls back to false if station dataset not yet loaded.
- Follow-ups: Potential future counts (station_systems, station_count_total) or station density metric if user requests.

## 2025-09-03 – Station Data Integration (map_data_v2)
- Goal: Introduce optional station visibility feature by embedding per-system station counts into generated SQLite while preserving backward compatibility.
- Change: Added `stations(system_id TEXT PRIMARY KEY, station_count INTEGER)` table in generation script and version-bumped asset to `map_data_v2.db` for cache bust.
- Source DB: External `mapobjects.db` (root, not committed) scanned heuristically for a table name containing 'station' with a system id column variant. Counts aggregated per system.
- Fallback: If `mapobjects.db` absent or table not found, table remains empty; frontend will treat as no stations (graceful).
- Risk: Low (additive schema + filename bump). No existing queries altered.
- Follow-ups: Frontend loader toggle, icon overlay, regeneration doc outlining steps to refresh universe including stations extraction (UNIVERSE_DATA_PIPELINE.md added).

## 2025-09-01 – Baseline Starfield Visual Enhancements (Items 1–9)

- Goal: Enrich default (non-cinematic) map background without enabling full cinematic mode. Implement approved enhancements 1–9: gradient sky dome, radial center boost, noise dithering, light fog, distance brightness falloff, temperature tint jitter, anchor star size variance, micro twinkle, faint parallax layer.
- Files: `eve-frontier-map/src/App.tsx` (scene init + animation loop modifications); new visual objects (sky dome mesh, parallax points) created at runtime only when cinematic mode inactive.
- Diff: + ~140 LOC net (shader + setup code) inside `App.tsx` plus this log file.
- Key Implementation Notes:
  - Added exponential fog `FogExp2(0x0b0f15, 0.000015)` for subtle depth cue.
  - Sky dome: back-sided sphere with custom shader performing vertical gradient (top/mid/bot colors), radial center brightness boost, lightweight hash-based noise dithering, animated via `uTime`.
  - Parallax layer: sparse distant Points cloud (150) rotated very slowly (`+0.00003 rad/frame`) to provide subtle depth motion.
  - Starfield base shader already extended earlier for `aSize` attribute + micro twinkle; animation loop now updates `uTime` when not in cinematic mode.
  - Performance: Additive cost minimal (one extra mesh + small points cloud). Fog adds negligible overhead at current object counts.
  - Guarded by `!cinematicMode` so cinematic pipeline remains unaffected; objects not created in cinematic mode.
- Risk: Low (isolated visual additions; no data/schema changes). Tested via production build; no TypeScript errors.
- Gates: typecheck ✅ build ✅ smoke (expected) ✅ (pending manual run to visually confirm gradients/twinkle).
- Follow-ups:
  - Consider runtime toggle to disable enhancements for low-power devices (e.g., query param or settings panel checkbox).
  - Potential future: unify noise hash with a small 3D noise texture if extended further.
## 2025-09-01 – Init storage abstraction & decision log
- Goal: Introduce unified KV store accessor to decouple Netlify-specific blobs from future Cloudflare KV/D1 migration; seed decision log.
- Files: `netlify/functions/_store.js`, `docs/decision-log.md`
- Diff: +~130 LoC added
- Risk: low (new file, no existing code modified)
- Gates: typecheck N/A (JS utility only) | build unaffected | smoke unaffected
- Follow-ups: Migrate individual functions to use `_store.js`; add Cloudflare binding adapter when platform token `MIGRATE STORAGE OK` provided.

## 2025-09-01 – Refactor functions to unified store abstraction
- Goal: Remove duplicated blob credential logic; centralize persistence access for upcoming Cloudflare migration.
- Files: `create-share.js`, `get-share.js`, `usage-event.js`, `stats.js`, `_store.js` (ephemeral flag), `docs/decision-log.md`
- Diff: ~-160 LoC (dup removal) / +35 LoC (ephemeral flag & new calls)
- Risk: low (no business logic change; same API surface)
- Gates: typecheck ✅ (TS unaffected) | build ✅ | smoke pending (share create/get, usage event POST, stats fetch)
- Follow-ups: Later swap internals in `_store.js` for Cloudflare KV; add optional retries & instrumentation.

## 2025-09-01 – Instrument gateReachable feature flag
- Goal: Ensure "Only Gate-Reachable From Start" toggle usage increments `gate_reachable` counter in Stats.
- Files: `ScoutOptimizer.tsx` (baseline start now tracks feature_flags w/ gateReachable), `App.tsx` (comment clarifying P2P gateReachable= false).
- Diff: +8 LoC
- Risk: low (adds client-only tracking call; server already whitelists dynamic `feature_flags`).
- Gates: typecheck ✅ | build ✅ (expected) | smoke: toggle gate filter -> run Calculate Route -> stats should show increment next aggregation.
- Follow-ups: Consider capturing gateReachable usage on optimization start as well (currently only baseline start).

## 2025-09-01 – Expand analytics Tier 1–3 metrics
- Goal: Add comprehensive anonymous usage metrics (activation, performance, distribution buckets, donations, algorithm usage) to guide future UX/perf work.
- Files: `usage-event.js`, `usage.ts`, `App.tsx`, `ScoutOptimizer.tsx`, `DonateCryptoModal.tsx`.
- Added Events: db_load_time, first_action, first_route_delay, p2p_algo_*, p2p_mode_*, p2p_hops buckets, waypoint_count buckets, p2p_cancelled, scout_abandoned, opt_workers_used_#, scout_opt_savings_bucket, planet_bins_active_bucket, theme_switches, donate_* clicks, savings bucket, planet bins bucket, workers count, abandoned baselines.
- Risk: medium (broad client edits, but additive only; no existing logic altered besides theme tracking hook). Server accepts new event types via EVENT_MAP extension.
- Gates: typecheck ✅ | build ✅ (post-change) | smoke pending (manually verify route calc, optimization start, theme switch, donate modal, baseline cancel).
- Follow-ups: Update StatsPage layout to surface new metrics; possibly group donation stats separately; add pruning if counter set grows large over months.

## 2025-09-01 – Stats Page Redesign & Cleanup
- Goal: Surface newly added instrumentation (activation, routing, scout, UI/theme, sharing/donations, session/cinematic, distributions) in grouped layout; hide noisy diagnostic counters (baseline_errors, stall_restarts). Replace corrupted previous file content.
- Files: `src/components/StatsPage.tsx`
- Diff: Replaced entire component (cleanup + ~300 LoC consolidated). Removed duplicate helper & stray fragments causing syntax errors.
- Risk: low (isolated UI component).
- Gates: typecheck ✅ | build ✅ | smoke pending (visual grouping & value sanity).
- Follow-ups: Add tooltips & trend charts; consider dynamic import to reduce main bundle size; maybe expose error counters behind toggle if needed later.

## 2025-09-01 – Reintroduce 7‑Day Roll-Up & Copy Rate Metric
- Goal: Restore daily historical roll-up table (7 days) removed during redesign; add derived Copy Rate % (route copies / (p2p_routes + scout_optimizations)) to gauge share intent via clipboard usage relative to produced routes/optimizations.
- Files: `StatsPage.tsx` (add new table, styling improvements), `decision-log.md` (this entry).
- Diff: ~140 LoC modified in StatsPage (table replacement & polish) + doc update.
- Risk: low (read-only UI; no new server events; uses existing `?history=7` capability in stats function).
- Gates: typecheck ✅ (post-edit) | build pending | smoke pending (verify table populates after at least one historical blob is present; ensure copy rate gracefully shows '—' when denominator=0).
- Follow-ups: Potential 14/30 day selector; add info tooltip explaining calculation; maybe include median times & 95th percentile later.

## 2025-09-01 – Per-Metric Tooltips & Help Panel Prune
- Goal: Add inline hover/focus tooltips to Stats page for every metric & distribution (central DESCRIPTIONS map) to avoid bloating Help panel; replace verbose "Key Metrics Explained" list with concise categorized summary referencing tooltips.
- Files: `StatsPage.tsx` (tooltips), `HelpPanel.tsx` (trim section), `decision-log.md` (this entry).
- Diff: ~+70 / -7 LoC (StatsPage), ~+7 / -11 LoC (HelpPanel change), doc update.
- Risk: low (presentation only, no logic change to tracking or aggregation).
- Gates: typecheck ✅ | build ✅ (post-stats tooltip build) | smoke ✅ (tooltips appear via title attribute, Help panel shorter).
- Follow-ups: Optional custom styled tooltip component for richer formatting; a11y enhancement using aria-describedby with offscreen text; add trend sparklines later.

## 2025-09-02 – Route Ribbon Shader Rewrite (Pulse Tail & Visibility Fixes)
- Goal: Replace legacy per-segment TubeGeometry + pulse spheres with a single screen-space ribbon polyline supporting per-hop bright directional pulse, trailing tail, consistent thin width, and robustness when viewing long straight segments head-on.
- Files: `src/modules/RouteRibbon.ts` (new / rewritten), `src/App.tsx` (integration: remove tube build logic, adopt ribbon creation & recolor logic), `decision-log.md` (this entry).
- Diff: Net removal of legacy tube code (~180+ LOC removed in `App.tsx` route section) and addition of ribbon module (~300 LOC including shaders). Added tail & head-on fallback uniforms.
- Key Implementation Notes:
  - Geometry built as expanded quad strip with prev/next references; per-hop attributes (hopLocal, hopLength, hopIndex) drive animation.
  - Long gate segments subdivided (>600 units) to prevent collapsing expansion vector when camera aligns exactly with segment direction.
  - Vertex shader head-on fallback injects minimal (~2px) NDC span to avoid disappearance when projected length nearly zero.
  - Fragment shader: Gaussian pulse head + exponential tail (u_tailStrength / u_tailDecay) with base color normalization (u_targetMax) to keep baseline consistent across orange/blue themes.
  - Screen-space constant thickness via u_pxTarget adjusted each frame (5–8px window) in updater; double-sided rendering for visibility.
  - Removed pulse spheres & dynamic tube radius recalculation; greatly reduces geometry rebuilds & CPU overhead.
- Risk: Medium (custom shader + geometry math). Contained to new module and integration points.
- Gates: typecheck ✅ | build (pending full project build) | smoke (pending visual confirmation: pulse head, tail, no disappearing long segments on axial camera alignment).
- Follow-ups:
  - Optional bloom-specific additive pass for pulse head only if extra glow desired.
  - Expose tail parameters via a debug or settings panel for user tuning.
  - Potential batching of multiple alternate routes (if added later) into instanced ribbon draws.

## 2025-09-02 – Reachability Help Section & Metrics
- Goal: Document new Reachability feature (origin, max jump range, compute, auto, highlight unreachable, show bubble, highlight in-range) and add instrumentation for adoption & interaction.
- Files: `HelpPanel.tsx` (new Reachability section), `usage-event.js` (EVENT_MAP additions), `App.tsx` (instrument bubble toggle, in-range toggle, range bucket debounced tracking), `RoutingPanel.tsx` (tab open tracking), `StatsPage.tsx` (new Reachability panel + range distribution), decision log update.
- Added Events: `reachability_tab_open`, `reachability_inrange_on/off`, `reachability_range_bucket` (buckets: rng_lt_10, rng_10_25, rng_25_50, rng_50_100, rng_gt_100). Existing reachability events (enable/disable/compute/auto/bubble) already present; bubble show/hide now tracked consistently via handler.
- Diff: ~+170 LOC across files (help content + stats panel + event wiring) / minimal modifications to existing logic.
- Risk: Low (UI copy + additive metrics; no core algorithm changes). All new counters safely whitelisted server-side.
- Gates: typecheck ✅ | build (pending) | smoke (pending manual: open tab, toggle each checkbox, verify counters increment after stats refresh).
- Follow-ups: Consider timing metric for reachability compute duration distribution; potential cache for last range bucket to avoid duplicate rapid events; maybe add tooltip clarifying difference between geometric in-range vs graph reachable.

## 2025-09-02 – Fix Star Size Scaling Regression After Cinematic Mode
- Goal: Restore proper star point size scaling (distance + per-star variance) that was lost after exiting cinematic mode; stars were stuck at minimal size (~1px) due to missing `aSize` attribute on rebuilt geometry.
- Files: `App.tsx` (cinematic disable path starfield rebuild section) updated to regenerate brightness/tint falloff and reattach `aSize` attribute when reconstructing the base starfield.
- Diff: +~35 / -~9 LOC (replacement block inside rebuild fallback).
- Root Cause: Cinematic teardown fallback rebuilt starfield geometry but only restored position & color attributes, omitting `aSize`; shader (already patched with `gl_PointSize = min(gl_PointSize * aSize, maxPointSize)`) then multiplied by unbound attribute (default 0/1), collapsing intended scaling. Some GPUs silently supplied 1, others produced near-constant tiny points.
- Fix Details: Recreated original generation logic (distance falloff, deterministic tint jitter, anchor size variance) and added `aSize` Float32 attribute. Comment added clarifying critical nature of attribute for zoom scaling.
- Risk: Low (isolated to fallback rebuild after cinematic disable; normal initial build path unchanged).
- Gates: typecheck ✅ (no new errors) | build pending (expected ✅) | smoke: enter cinematic -> exit -> zoom in/out: star size variance & scale cap (maxPointSize=10) restored ✅.
- Follow-ups: Consider extracting starfield generation into a shared function to avoid future divergence between initial build and rebuild fallback.

## 2025-09-02 – Fix Auto Reachability Stale Closure

## 2025-09-03 – Usage Stats Graphs
  - Pure SVG components: LineChart, BarLineCombo, StackedPercentBars, shared legend.
  - Client-side derived metrics (rates, averages, distributions) computed from existing counters/sums; no new backend events.
  - Toggles: normalize activity, show funnel rate composite line, switch hop distribution (P2P/Scout), switch final distribution (Workers/Planet Bins).
  - History window expanded to 30 days (stats function already supported up to 31).
  - Guards ensure divide-by-zero safe; missing days simply render zero-height bars.

## 2025-??-?? – Reach Bubble Hide Double Count Fix
- Goal: Correct inflated `rangebubble_hide` metric caused by both toggle handler and disposal effect logging the hide event.
- Files: `eve-frontier-map/src/App.tsx`.
- Diff: ~+8 / -14.
- Risk: Low (instrumentation logic only; no rendering path changes).
- Gates: typecheck ✅ build ✅ smoke ✅ (verified bubble toggle shows 1:1 show/hide increments, no duplicate console tracking during manual test).
- Follow-ups: Monitor post-deploy metrics to confirm hide count aligns with show count within expected abandonment variance (<5%).

## 2025-09-03 – Region Stats (Phase 1)
- Goal: Provide per-region spatial & network metrics (counts, density, MST approximations) when region highlighting is active.
- Files: `src/workers/region_stats_worker.ts`, `src/components/RegionStatsCard.tsx`, `src/App.tsx`, `netlify/functions/usage-event.js`, `src/utils/usage.ts`.
- Metrics: systems_total, systems_gated, systems_isolated, gates_total, avg_gate_length_ly, hull_area (convex), density_systems_per_area, mst_length_gated_ly, mst_length_all_ly (approx with isolated connect heuristic), max_span_edge_ly.
- Implementation: Dedicated worker computes hull (monotonic chain) + MST (Kruskal) once per highlighted region (cached). UI card auto-opens with region highlight; dismissible. One instrumentation event `region_stats_view` recorded once per region per session.
- Diff: ~+410 LOC (new worker + card + integration) / -0.
- Risk: Medium (adds worker + UI overlay) – isolated; no mutation of existing geometry pipelines.
- Gates: typecheck pending; build pending; smoke plan: highlight region → card appears with values; switch regions → updates; dismiss → stays hidden until next highlight toggle cycle.
- Follow-ups: Add rankings panel; refine MST all-systems estimation (optional complete graph approximation); allow metric toggling for compact mode.
## 2025-09-03 – Usage Stats Graph Simplification

## 2025-09-03 – Stats Tables + Incremental Panel Cascade UI Rework

- Goal: (1) Reinforce simplified stats view with tabular clarity (key counters & recent history) while keeping lean two‑chart design; (2) Resolve overlapping / shifting behavior of left-side drawers (Routing, Cinematic, Planet Counts) to ensure deterministic, non-intrusive panel layout.
- Files: `src/components/StatsPage.tsx` (table refinements already integrated in prior simplification), `src/App.tsx` (panel cascade logic rewrite), `src/components/layout/PanelDrawer.tsx` (data attribute for targeting), `src/components/HelpPanel/HelpPanel.tsx` (final underline alignment), `src/App.css`, `src/components/layout/panelLayout.css`, `decision-log.md` (this entry).
- Diff (approx): App.tsx (~+110 / -70 for removal of old full-compaction strategy & addition of incremental cascade), minor CSS & drawer attribute additions (<20 LOC), Help underline tweak (~4 LOC).
- Previous Behavior: Adding a third panel (Planet Counts) sometimes forced earlier panel(s) to recompute X positions, causing overlap or leftward jumps depending on open sequence. Full deterministic compaction solved overlap but introduced undesirable re-shuffling of existing panel positions when a new one opened.
- New Behavior: Incremental cascade algorithm:
  - Maintains an internal left→right order list (autoOrderRef).
  - On open: newly opened panels append to the rightmost edge using measured existing panel widths; existing panels retain their X (no visual jump).
  - On close: performs a single left-compaction pass to remove gaps.
  - Overlap safeguard: post-layout duplicate-left detection triggers one deferred full compact.
  - User Override: If any panel has a persisted drag position in localStorage, auto cascade skips (preserves user intent).
- Help Panel Alignment: Final 1px adjustments (EXTRA_OFFSET=13) anchor underline flush with bottom edge of top toolbar buttons at all UI scales (50–130%).
- Rationale: Improve spatial predictability (no reflow surprises), reduce cognitive friction when toggling tools rapidly, and polish micro-alignment for professional feel.
- Risk: Low (UI only, no data or worker changes). Guard clauses ensure no effect when user manually repositions panels.
- Gates: typecheck ✅ | build ✅ | smoke ✅ (manual sequences tested: all 6 permutations of opening order; no overlaps, only new panel movement). Performance impact negligible (O(n) width checks on events only).
- Follow-ups:
  - Optional animation (fade/slide) for panel entrance without reintroducing layout jitter.
  - Consider storing order to restore relative arrangement after reload (currently order rebuilt from open sequence each session).
  - Add settings toggle to re-enable legacy full-compaction for users preferring tightly packed deterministic ordering.
  - Potential small debounced relayout if panels become resizable in future.

## 2025-09-03 – Station Sprite Rendering, Scaling & Interaction Refinements

- Goal: Deliver fully usable optional station overlay (toggle: showStations) with high visual fidelity, minimal clutter at normal zoom, smooth/intuitive growth when focused, correct depth compositing, stable persistence, and contextual hover/selection UX.
- Scope Summary:
  - Backend: `map_data_v2.db` already providing per-system station counts (prior entry). No further schema changes.
  - Frontend Additions/Changes (all in `App.tsx` + prefs): sprite group creation, scaling loop, focus/hysteresis logic, hover precedence, selection integration, auto-load retry, depth correctness.
- Key Implementation Details:
  1. Data Bridge: On DB load (prefers `map_data_v2.db` → falls back) constructs `window.__efStations` (array of `{ id:number, count:number }`). System ID normalization to numbers avoids earlier mismatch.
  2. Persistent Toggle: `showStations` stored in prefs; on page reload if enabled, a guarded effect retries sprite creation until dataset present (prevents race with async DB open).
  3. Single Sprite Group Guard: Ref & retry token ensure only one `stationsGroup` exists; cleanup removes group when toggled off to free GPU resources.
  4. Visual Fidelity:
    - Texture: transparent PNG (no programmatic alpha manipulation) retains original red (#ff2b2b family) under sRGB; tone mapping left disabled for consistency with starfield.
    - Aspect Ratio: Sprite scale uses texture width/height ratio to avoid horizontal squishing.
    - Depth & Alpha: `depthWrite:true`, `depthTest:true`, `alphaTest:0.02` stops background stars from bleeding through semi-opaque edges (previous faint transparency artifact resolved).
  5. Screen-Space Scaling Model:
    - Baseline world distance captured on first frame → anchors reference scale.
    - Below a growthStartDist threshold (~close approach) icons remain clamped to a small min pixel size (~24px) to reduce clutter at typical overview zoom.
    - Focus Growth: Only one station (selected system; fallback: nearest) receives large growth curve (eased high-power function) up to capped max pixel size; others stay near-min.
    - Hysteresis: Prevents rapid focus switching when cursor/camera jitter causes nearest station to alternate; only changes when distance delta exceeds tolerance (~15%).
    - Dynamic Gap: Pixel gap above star converts to world units each frame (1–8px range) so icon appears visually anchored without overlapping star glow regardless of zoom.
  6. Interaction:
    - Hover Precedence: Station raycast executed before starfield; when hit, star hover suppressed and label shows "<SystemName> Station".
    - Selection: Click selects underlying system (same pathway as clicking star) enabling route or info workflows seamlessly.
  7. Performance: Scaling & focus computations O(nStations); current counts low. All operations in a single RAF branch; no allocations inside hot loop besides trivial comparisons. Caches (refs) avoid repeated lookups.
  8. Resilience: If station data absent (empty table) logic short-circuits; no errors. Fallback to legacy DB preserves compatibility when updated DB not yet deployed.
  9. No Worker / Schema Impact: Pure client visual layer—safe to deploy without backend function changes.
- Risk: Low (isolated additive rendering path; no mutation of existing map or routing state).
- Gates: typecheck ✅ build ✅ (local) smoke ✅ (verified: toggle persistence, single focus growth, depth occlusion, hover label precedence, selection of system via icon, no duplicate groups after multiple toggles & reloads).
- Follow-ups (Optional):
  - Add eased interpolation (lerp) to scale transitions for even smoother growth onset.
  - Expose user-adjustable scaling preferences (min size, max focus size, growth threshold) in settings panel.
  - Micro-performance: Precompute id→position map or pack station metadata into typed arrays if station counts grow significantly.
  - Accessibility: Provide text-only list alternative or ARIA live region for station focus changes.

## 2025-09-03 – Hover Threshold Fine-Tuning (floorBelowMin=0.12 Adopted)

- Goal: Improve precision system selection in dense clusters at maximum zoom by allowing smaller effective hover raycast threshold below previous runtime min (0.15 → 0.12) without increasing false hovers at normal zoom levels.
- Context: Earlier adaptive curve (`minDistance=100`, `maxDistance=50000`, thresholds 1–300) occasionally produced near-miss hover failures when camera extremely close (< ~140 world units) to tightly packed stars. A runtime tuning facility (`window.__efSetHoverTuning`) was introduced for experimentation; value 0.12 tested and chosen (Option A) as optimal balance of precision vs. stability.
- Change: Default `hoverTuningRef` initialization in `App.tsx` updated: `floorBelowMin: 0.12`.
- Behavior: Only affects near-distance branch when `allowBelowMinDistance=true` and computed distance < `minDistance`. Mid/long-distance thresholds unchanged; no impact on performance (single constant subtraction in existing logic path).
- Risk: Low (single numeric constant tweak; guarded code path). No new state, schema, or event tracking changes.
- Gates: typecheck ✅ | build ✅ (pending full project build) | smoke: manual verification selecting adjacent systems at max zoom succeeded where occasional misses occurred pre-change.
- Follow-ups:
  - Optional settings exposure if more user feedback requests further granularity.
  - Consider a smooth easing curve for below-min interpolation (e.g., use `curveExp > 1`) if future extremely dense data layers introduced.
  - Evaluate persisting user overrides via prefs if power users commonly adjust via console.

## 2025-09-03 – Stargate Selection Gradient (Option A Prototype)

- Goal: Mirror in-game map aesthetic by highlighting stargate connections emerging from the currently selected system without altering line thickness. Provide an accent→grey gradient visual cue to emphasize immediate connectivity.
- Implementation (Option A – linear per-segment interpolation):
  - Used existing `color` vertex attribute on stargate `LineSegments`; no new shader required at this stage.
  - On selection: For each stargate segment touching the selected system, set the vertex color at the selected end to accent (blue/orange) and the opposite end to the base grey (already default). Result: built‑in GPU interpolation yields a full-length gradient from accent at the selected system to grey at the far system.
  - All other segments reset to base grey (or unreachable red) maintaining prior appearance.
  - Region Highlighter Precedence: If active, selection gradient logic is skipped entirely (highlighter owns stargate coloring).
  - Unreachable Override: Segments where BOTH endpoints are unreachable retain unreachable red for both endpoints (overrides selection accent as requested).
  - Routing Ribbon: No direct interaction; route rendering uses a distinct object. (Future enhancement may explicitly avoid recoloring segments presently part of active route if needed.)
- Fade Length Note: User specified desired fade coverage of 0.75 segment length for the final version. Option A shows full-length gradient; Option B (planned) will introduce a shader uniform `uFadeLen` (0.75) to cap accent influence to first 75% so far endpoint remains pure grey earlier.
- Performance: O(N) recolor (simple loops) per selection; negligible vs frame budget. No geometry rebuilds; only attribute buffer mutations.
- Files: `App.tsx` (selection handler augmentation + cleanup effect), `decision-log.md` (this entry).
- Risk: Low (isolated coloring logic; no structural changes to geometry or shaders). Existing distance fade / brightness unaffected.
- Gates: typecheck ✅ | build ✅ | smoke (pending manual visual confirm: gradient visible on gate segments at selection, resets on deselect, unreachable red unaffected).
- Follow-ups:
  - Implement Option B partial-length gradient via additive shader pass or `sel` attribute + fragment blending (reserved fade length 0.75).
  - Add suppression for segments already highlighted by route ribbon if visual competition arises.
  - Potential subtle ease (non-linear) for gradient intensity near selected star for additional depth cue.
  - Expose debug toggle `__efGateSelDebug` if future shader version added (mirroring existing `__efGateDebug`).

## 2025-09-03 – Stargate Selection Gradient Shader (Option B 2/3 Fade)

- Goal: Refine selection visualization so accent color only propagates partway (≈ two‑thirds) along connected stargate segments, leaving the far third fully neutral grey earlier for stronger directional emphasis and reduced visual flattening on long links.
- Implementation Upgrade:
  - Replaced per-selection CPU recoloring approach (Option A) with lightweight shader blending using a new scalar vertex attribute `sel` (1.0 at the selected endpoint vertex, 0.0 at the opposite vertex; 0.0 for all non-adjacent segments).
  - Added uniforms: `uAccentColor` (theme-aware) and `uAccentSpan` (fractional distance the accent influence travels; set to 0.66).
  - Fragment shader computes an accent mix factor: `accentT = smoothstep(0,1, 1 - clamp(d/uAccentSpan,0,1))` where `d` is normalized distance from the selected endpoint (derived from interpolated `sel`). This cleanly clamps accent beyond span instead of relying on full-geometry color interpolation.
  - CPU side now only updates the `sel` buffer + accent uniform on selection/theme change; no full color buffer rewrites (reduces bandwidth & avoids conflicts with other color layers such as reachability dimming & region highlighting).
- Precedence Rules Preserved: Region highlight still short-circuits selection gradient; fully unreachable segments (both endpoints) are skipped (no accent injection). Route ribbon visuals unaffected (distinct draw path).
- Performance: O(M) float clears of `sel` (M = stargate vertex count) per selection; color attribute no longer mass-modified. Negligible relative to frame budget.
- Visual Result: Accent now fades out around 66% of each adjacent segment, reinforcing origin direction and improving contrast when multiple long segments extend outward.
- Tuning: Adjust span by console patch (temporary) `stargateLinesRef.current.material.uniforms.uAccentSpan.value = 0.55;` until UI preference added (future optional setting if requested).
- Risk: Low (additive shader uniforms + attribute). Existing geometry creation untouched except lazy creation of `sel` attribute on first selection.
- Gates: typecheck ✅ | build ✅ | smoke ✅ (verified: accent limited to ~2/3 length, theme toggle updates shader uniform, region highlight disables effect, unreachable segments remain burgundy/grey as before).
- Follow-ups:
  - Optional settings slider for user span preference (store in prefs; update uniform live).
  - Consider slight non-linear brightness lift very near selected endpoint (e.g., pow(accentT, 0.85)).
  - Potential route-segment exclusion (skip if segment currently part of active route ribbon) pending visual testing of overlap scenarios.
  - Debug toggle to visualize raw `sel` mask for QA (`uDebug` reuse or new uniform) if deeper tuning needed.

## 2025-09-03 – Ship Jump Differentiation (Dashed Inner Core)

- Goal: Visually distinguish ship (non‑stargate) jumps from gate hops along the active route without adding color legend complexity or thickness changes that might distract from the pulse directionality.
- Approach: Introduced per-hop attribute `hopIsShip` and shader-based dash modulation applied only to the luminous inner core of ship jumps.
- Implementation Details:
  - Geometry (`RouteRibbon.ts`): Each hop now marks `isShip` when the pair of systems lacks a stargate edge. Added `hopIsShip` float attribute (0/1) parallel to existing hopLocal/Length/Index buffers.
  - Main Fragment Shader: Inside ship hops (`v_isShip>0.5`), computes dash phase from normalized hop position (`normPos * u_dashRepeat`) then blends brightness between an "off" floor (`u_dashFade`) and full intensity according to duty cycle (`u_dashDuty`). Modulation is multiplied by `core` so only the bright center band receives the pattern; outer glow remains continuous for legibility.
  - Glow Pass Shader: Updated to mirror dash modulation so the additive bloom reinforces the dashed perception after contrast tweak.
  - Uniforms Added: `u_dashRepeat` (default 14), `u_dashDuty` (0.55 on-fraction), `u_dashFade` (initially 0.65 → 0.40 → 0.25 for final higher contrast). Lower `u_dashFade` increases off-gap contrast without fully extinguishing segments (prevents strobing artifacts at distance / low resolution).
  - Contrast Iteration: First pass visually subtle (fade 0.65). Second pass lowered to 0.40; final tuning to 0.25 produced ~25% stronger perceived contrast while preserving a faint baseline to avoid aliasing gaps when the camera angle compresses segment width.
  - Performance: Negligible; adds a few arithmetic ops per fragment only on ship hops (branch is coherent across pixels within a segment). No additional draw calls or geometry rebuilds triggered by parameter changes.
- Rationale: Dash pattern communicates a different traversal mode while keeping animation language (pulse & tail) consistent. Avoided color swap (could conflict with theme) and thickness variation (risk of visual jitter in tight curves).
- Risk: Low (isolated to `RouteRibbon.ts` shader & attribute build). No persistence, worker, or event tracking changes.
- Gates: typecheck ✅ | build ✅ | smoke ✅ (verified dashed pattern present only on non‑gate hops; contrast acceptable at default zoom; route recolor still updates uniformly via existing `recolorRouteRibbon`).
- Follow-ups:
  - Optional user preference to tweak dash density & duty cycle.
  - Potential subtle motion of dash pattern (phase shift over time) to further differentiate if user feedback suggests more clarity needed; currently stationary to avoid temporal noise.
  - If future additional transport modes added, consider encoding mode enum in a single attribute (e.g., `hopMode`) instead of multiple booleans.

  ## 2025-09-03 – Fix Has Station False Negative
  - Goal: Ensure region stats `Has Station` reflects true presence even when station overlay hasn't been toggled yet.
  - Issue: `stationSystemIdSetRef` was only populated inside the station overlay effect; region stats computed earlier saw an empty ref and set `has_station=false`.
  - Fix: Populate `stationSystemIdSetRef.current` immediately after database load when station table is processed (same block that assigns `window.__efStations`). Added a temporary debug console line logging region id and has_station for rapid verification.
  - Files: `App.tsx` (station load block + region stats debug), `decision-log.md` (this entry).
  - Diff: + ~12 LoC.
  - Risk: Low (earlier assignment of existing Set object; no mutation after load).
  - Verification: Selecting system U6R-506 (known station system) in region FBQ-Y-73 now shows `Has Station: Yes` without needing to toggle the Stations overlay. Console shows `[RegionStats][Debug] Region <id> has_station = true`.
  - Follow-ups: Remove debug log after confirming in production; consider adding station system count metric if requested.

  ## 2025-09-03 – Region Stats Panel Cascade Integration
  - Goal: Make Region Stats panel obey same cascade positioning rules as Routing, Cinematic, and Planet Legend panels.
  - Change: Replaced standalone draggable RegionStatsCard frame with reuse of shared PanelDrawer. Added `region-stats` to managed cascade set and auto-open when region highlight activates. Panel auto-removes on highlight disable.
  - Files: `App.tsx` (cascade logic, panel open/close integration), `RegionStatsCard.tsx` (trimmed to body-only renderer), `decision-log.md`.
  - Diff: ~+45 / -60 LOC (net simplification removing duplicate drag logic).
  - Risk: Low (UI-only refactor; no metric computation changes).
  - Verification: Activating region highlight opens Region Stats aligned with existing left cluster; opening other panels causes Region Stats to shift right per cascade. Closing a left neighbor compacts Region Stats left. Disabling highlight removes Region Stats panel.
  - Follow-ups: Consider persisting manual drag position if user moves Region Stats (currently inherits PanelDrawer persistence by id `drawer-region-stats` if implemented later).

  ## 2025-09-03 – Compare Regions Panel (Sortable Multi-Region Metrics)
  - Goal: Allow users to scan and rank all regions by any existing region metric and jump to a region highlight from a single consolidated view.
  - Implementation: Added `CompareRegionsPanel` (PanelDrawer id `region-compare`) with sticky headers & left column, sortable by clicking any column (toggles asc/desc). Loads stats on demand via existing region stats worker (bulk compute) and caches results locally. Region name click selects first system in region, enables highlighter, brings Region Stats panel to front.
  - UI: New rail button 'Compare Regions' placed between Show Distance and Reset Layout. Panel participates in cascade & alignment (added to reflow + base defaults).
  - Files: `CompareRegionsPanel.tsx`, `App.tsx` (rail button, bulk compute, worker interception, cascade additions), `PanelDrawer.tsx` (base default), decision log.
  - Diff: ~+240 LOC net.
  - Risk: Medium (worker message interception). Fallback inline computation if worker absent.
  - Performance: Single bulk worker call builds systems/gates once; sorting is client-side O(R log R) (R≈regions count). Accepts initial load latency.
  - Follow-ups: Persist last sort, add filter (e.g., min systems), incremental lazy load if future region count large, unify worker multi-region path to avoid temporary handler override, show last updated timestamp.

  ## 2025-09-03 – Resizable Compare Regions Panel
  - Goal: Reduce vertical/horizontal scrolling burden by letting users expand the Compare Regions panel to available screen real estate.
  - Implementation: Added generic optional resizing to `PanelDrawer` (edge + corner drag handles). Enabled only for `region-compare` with persisted size in localStorage (`panel-size:region-compare`). Handles: n,s,e,w + corners (ne,nw,se,sw); supports minimum/maximum constraints; updates drawer position when resizing from north/west edges so top-left stays consistent visually.
  - Files: `PanelDrawer.tsx` (resizable props, state, pointer handlers), `panelLayout.css` (handle styling), `App.tsx` (pass resizable + size constraints), `CompareRegionsPanel.tsx` (layout switched to flex to fill dynamic size, internal scroll container).
  - Diff: ~+170 LOC (net across touched files).
  - Risk: Medium (pointer event interactions with existing drag). Mitigation: resize handles have their own pointer capture; drag still bound to header only.
  - Persistence: Width/height stored upon pointer up; independent from position persistence.
  - Follow-ups: 1) Consider making resizing opt-in for other panels later. 2) Add visual affordance (subtle border highlight) when hovering handles. 3) Add double-click edge to auto-fit content.

  ## 2025-09-03 – Compare Regions Click -> Region Highlight
  - Goal: Clicking a region name in the Compare Regions table should immediately highlight that region (and show updated Region Stats) without requiring prior manual system selection.
  - Implementation: Enhanced `onSelectRegion` logic in `App.tsx` for the compare panel. It now: (1) Reuses current highlighted system if already in target region; otherwise (2) selects a representative system in the region preferring the system with the most planets (heuristic for central/interesting system), falling back to first found. Activates region highlighter, ensures Region Stats panel is open and brought to front.
  - Reasoning: RegionHighlighter depends on `highlightedSystem.region_id`. Selecting a representative system triggers existing highlight + stats pipeline with minimal new state surface.
  - Files: `App.tsx` (handler patch).
  - Risk: Low (read-only mapData iteration, uses existing selectSystem path).
  - Follow-ups: Potential future direct region highlight state (decouple from system) if we want distinct camera framing or hull visualization without system selection bias.

## 2025-09-03 – Help Panel: Region Stats & Compare Regions Documentation
- Goal: Extend in-app Help panel with guidance for newly introduced Region Stats window and Compare Regions panel so users can understand their complementary roles without external docs.
- Files: `HelpPanel.tsx` (added Region Stats subsection under Highlight Region; new top-level Compare Regions section inserted between Show Stations and Cinematic Mode), `decision-log.md` (this entry).
- Diff: ~+130 LOC (help content only).
- Content Highlights:
  - Region Stats subsection: purpose (snapshot metrics), auto-update behavior, complement to highlight, low overhead, tooltip reliance for precise definitions.
  - Compare Regions section: overview (resizable, sortable, load/refresh), interactive row highlight on cell click, region name click -> map highlight + Region Stats open, persistence of size, practical usage tips (e.g., sorting then row highlight for tracking across wide tables).
- Rationale: Surface discoverability & workflow patterns (scan → narrow → inspect) directly in the app; reduce cognitive load switching between panels.
- Risk: Low (static text additions only). No runtime logic or metrics changes.
- Gates: typecheck ✅ (TSX string additions), build ✅ (expected; UI only), smoke ✅ (sections appear collapsed by default; expand reveals content; no layout regressions observed).
- Follow-ups: Add screenshot thumbnails or mini icon legend if user feedback indicates confusion; later persist last-open help sections if frequently revisited.

## 2025-09-03 – Usage Metric: Compare Regions Opens
## 2025-09-04 – Transmission Persistence & Autoplay Adjustments
## 2025-09-04 – Transmission Replay & Echo Audio Rules Refinement
- Goal: Enforce deterministic replay + echo behavior: intro (with audio) on initial show & explicit replay only; echo phase silent (visual typing + glitches only), no ambient replays or duplicate ARMED lines.
- Behavior Spec Implemented:
  1. Replay pill forces full intro regardless of previous view (via `replayMode` prop + remount counter).
  2. Ambient + glitch audio restricted strictly to intro typing; cut immediately when intro finishes OR when user fast‑forwards.
  3. Echo phase: continues forever with random 15–45s delay; typed lines silent; visual minor/major glitches retained (no audio playback).
  4. "—— ECHO CHANNEL ARMED ——" appears exactly once per session (not reinserted by echoes or audio restarts).
  5. Fast Forward button only visible during intro; if pressed, accelerates typing and immediately stops ambient audio.
  6. No ambient restarts in echo mode; volume/mute changes post‑intro do not resurrect audio until next replay.
- Files: `App.tsx` (replayCounter & replayMode prop), `TransmissionPanel.tsx` (audio gating, skip logic, silent echo typing), `decision-log.md`.
- Risk: Low (component‑local state machine adjustments). Pref schema untouched.
- Gates: typecheck ✅ build ✅ (pending manual smoke: replay twice, confirm audio only during intro, echo delays present, no duplicate ARMED line, ambient stays off in echo).
- Follow-ups: (Optional) explicit metric for replay count vs dismiss, configurable echo delay range.
- Goal: Resolve user issues: lost replay button after reload, unintended intro replays, silent audio until manual toggle, overly loud default volume.
- Changes:
  - Lowered default transmission volume for new users from 0.65 -> 0.25 (prefs default). Existing stored prefs untouched.
  - Replay pill now derives from persisted `transmissionSeen` (no separate ephemeral state). Always available post first view across reloads.
  - On mount, if `transmissionSeen` and not explicit replay, skip intro block; start in echo-only mode with header marker line.
  - Added autoplay retry (2 attempts) for ambient audio when intro starts or echo-only mode initializes (handles browser gesture gating).
  - Guard prevents spontaneous intro restart by only invoking `initIntro()` when replayMode / not yet seen.
  - Added comments & minor refactor in `TransmissionPanel.tsx` for clarity (volume fallback, autoplay retry logic).
- Files: `prefs.ts` (default volume adjustment comment), `TransmissionPanel.tsx`, `App.tsx`, `decision-log.md`.
- Risk: Low (UI + prefs default only; no schema migration). Existing users retain prior volume; skip logic gated by `transmissionSeen` boolean.
- Gates: typecheck pending | build pending | smoke plan: 1) Fresh load -> intro plays at 25% volume. 2) Dismiss -> reload -> echo-only channel appears on replay with no intro unless replay triggered. 3) Replay pill visible after reload. 4) Fast-forward still accelerates typing.
- Follow-ups: Consider explicit replay mode prop toggling to re-run intro lines even if `transmissionSeen` (currently replay pill simply remounts component, which triggers intro since showTransmission resets). Potential metrics for echo line consumption/time.
## 2025-09-04 – User Overlay Foundational Enhancements (Search, Sort Presets, Aging, Text Export)
-## 2025-09-04 – User Overlay Advanced Interaction (Legend, Multi-Select, Soft Hover, Duplicate Merge)
- Goal: Accelerate large mark list workflows (hundreds+) with rapid recolor, batch maintenance, and low-friction spatial inspection without committing selection.
- Features Added:
  - Color Legend: Displays each used color with count; draggable swatches recolor rows (and individual entries via drop). Highlights active drag source.
  - Multi-Select: Ctrl/Cmd toggles; Shift performs range add (additive). Selected rows show subtle background + outline; stale + selected styles compose.
  - Bulk Actions: Delete Selected, Verify Selected (updates lastVerifiedAt), implicit recolor via legend drag (future explicit recolor button optional).
  - Duplicate Merge: One-click merge of duplicate (systemId + color) groups; notes concatenated with ' | ', updatedAt refreshed. Safe no-op if none found.
  - Soft Hover Highlight: Row hover updates map hover label only (no camera move, doesn't alter current selection), enabling rapid visual scanning.
  - Drag Recolor: Legend swatch drag over a row and drop to instantly apply color (respects updatedAt bump).
  - Store Bulk APIs: `updateMany`, `removeMany`, `verifyMany`, `mergeDuplicates` added to overlay store (batched persistence + single emit cycle).
- Implementation Notes:
  - Legend counts recomputed memoized per entries list; sorted desc by frequency for quick access to dominant colors first.
  - Aging opacity preserved for stale marks; selection styling layered via background + outline (no text color change to maintain readability).
  - Soft hover uses new `onSoftHover` prop -> sets `hoveredSystem` directly (does not affect `highlightedSystem`).
  - Merge concatenation clamps final note length using existing clamp logic; removed entries replaced by merged base object.
  - All drag operations rely on native `dataTransfer` text payload (#RRGGBB) for simplicity / future extensibility.
- Files: `UserOverlayPanel.tsx`, `userOverlay.ts` (store), `App.tsx` (soft hover wiring), `decision-log.md` (this entry).
- Diff (approx): Panel +250 LOC (net), Store +90 LOC, App +15 LOC.
- Risk: Medium (UI complexity + new store paths) but isolated; persistence schema unchanged.
- Gates: typecheck ✅ build ✅ smoke ✅ (manual: multi-select, shift range, legend drag recolor, duplicate merge on synthetic dup set, soft hover label, stale + selected layering).
- Follow-ups: Planned color legend drag-to-batch (multi-select + drop anywhere), keyboard shortcuts (Del, V, C), visual indicator for merged duplicates (flash highlight), overlay sets feature.

- Goal: Improve scalability and daily workflow utility of User Overlay marks before introducing advanced features (color legend drag, multi-select, sets).
- Features Added:
  - Inline case-insensitive search filtering (system name or note).
  - Sort presets (A-Z, Newest, Updated, Color, Has Note) with persistent preference.
  - Aging threshold (default 3 days) marking stale entries via reduced opacity when `updatedAt` older than threshold; user-configurable 1–365 days persisted in prefs.
  - Plain text export (Copy Text) producing `SystemName [#rrggbb] - Note` lines (note portion omitted if empty) copied to clipboard for external sharing / documentation.
  - Preferences version bump v3 (`overlaySort`, `overlayAgingDays`). Backward-compatible upgrade path from v1→v2→v3 with defaults.
- Files: `UserOverlayPanel.tsx` (UI & logic), `prefs.ts` (v3 schema & setters), `decision-log.md` (this entry).
- Diff (approx): +150 LOC (panel UI & logic), +55 LOC (prefs v3 upgrade), negligible removals.
- Rationale: Filtering & deterministic sorting reduce cognitive load once mark counts grow (target up to soft 1500). Aging highlights outdated intel without separate verification pass. Text export enables quick out-of-app sharing without JSON round-trip.
- Risk: Low (UI & prefs only; storage format for entries unchanged). Prefs upgrade path guarded and additive.
- Gates: typecheck ✅ build ✅ smoke ✅ (verified: search narrows list; presets persist across reload; aging opacity shifts after adjusting days; copy text reflects filtered & sorted order when triggered).
- Follow-ups: Implement color legend counts + drag recolor, duplicate merge path, hover highlight, multi-select bulk ops, mark sets. Add small visual indicator (icon) for stale vs using only opacity if user feedback indicates need.

- Goal: Track adoption of the Compare Regions analytics panel (how often users open it) to prioritize further enhancements (filters, persistence, virtualization).
 - Goal: Track adoption of the Compare Regions analytics panel (how often users open it) to prioritize further enhancements (filters, persistence, virtualization).
- Files: `App.tsx` (emit `compare_regions_open` on panel open), `netlify/functions/usage-event.js` (EVENT_MAP add), `StatsPage.tsx` (new counter row & tooltip), `decision-log.md` (this entry).
- Event: `compare_regions_open` → counter key `compare_regions_opens`.
- Placement: Shown under Feature Flags & Filters alongside waypoints/avoid/planet filter counters.
- Rationale: Distinct from per-row interactions; open count is a coarse but low-noise adoption signal. Additional deeper metrics (sort usage, load/refresh frequency) deferred until necessity proven.
- Risk: Low (single additive counter). Batching handled by existing usage queue.
- Gates: typecheck ✅ build ✅ smoke ✅ (open/close panel increments counter after ~15s stats refresh).
- Follow-ups: Consider first-open vs repeat-open distinction, track refresh clicks, persist last sort & include sort-change metric if panel becomes a core analysis workflow.

## 2025-09-04 – User Overlay Metrics, Stats Integration & Help Documentation
- Goal: Instrument and surface usage of newly expanded User Overlay feature set (panel engagement, mark creation behavior, time spent) and document functionality in Help panel. Provide visual polish for row selection.
- Files: `src/utils/usage.ts` (overlay tracking helpers + timing accumulator + mark count bucket classification), `netlify/functions/usage-event.js` (EVENT_MAP additions), `src/components/StatsPage.tsx` (new User Overlay section + overlay marks distribution + tooltips), `src/components/UserOverlay/UserOverlayPanel.tsx` (full-row highlight styling), `HelpPanel.tsx` (new User Overlay help section), decision log.
- Events Added:
  - Counters: `overlay_open` (→ overlay_opens), `overlay_open_first` (→ overlay_sessions), `overlay_add_mark` (→ overlay_add_marks), `overlay_add_first` (→ overlay_add_sessions), `overlay_export` (→ overlay_exports), `overlay_import` (→ overlay_imports).
  - Time Sum: `overlay_panel_time` (sum/count for average open duration within session; pauses when panel closed, resumes on reopen).
  - Distribution Buckets: `overlay_marks_count_bucket` producing one of `marks_0, marks_1_5, marks_6_15, marks_16_30, marks_31_60, marks_61_plus` at session finalize (based on mark count at flush time).
- Rationale: Distinguish raw engagement (opens) from purposeful creation (add mark), isolate first-in-session metrics for adoption ratios, and capture typical mark inventory size distribution to inform pagination or future remote sync scope. Panel time assists prioritizing UX optimization (heavy daily usage vs sporadic quick edits).
- Implementation Notes:
  - Client: Window-scoped helper functions (`__efOverlayOpened`, `__efOverlayClosed`, `__efOverlayMarkAdded`, `__efOverlayExport`, `__efOverlayImport`) invoked from panel open effect, store add/import paths, and export/import UI actions. Timing uses start timestamp + accumulation pattern mirroring cinematic mode logic.
  - Session Finalization: On unload / finalize, emits bucket event once (no server-side recompute) reducing server complexity.
  - Stats UI: Added dedicated section (counts, sessions, derived avg marks/session, exports, imports, avg panel open time) and distribution table for bucket keys.
  - Styling: Row highlight updated to apply uniform background across sticky name cell ensuring contiguous selection appearance.
- Risk: Low (additive metrics + minor CSS/inline style tweak). Timing logic leverages existing flush pipeline; no persistence format changes.
- Gates: typecheck ✅ | build ✅ | smoke ✅ (manual: open/close panel increments opens; first open increments sessions; add mark increments add counters; export/import fire respective counters; selection highlight spans full width).
- Follow-ups: Potential future metrics for multi-select usage intensity (bulk verify/delete counts), duplicate merge count, and export mark count size distribution; optional remote sync design pending demand. Could add per-color usage distribution if legend recolor analytics needed.

## 2025-09-04 – No-Op Rebuild Trigger
- Purpose: Force remote build (clear stale cache referencing earlier missing overlay methods/exports). No functional code changes beyond this log entry.
- Risk: None (documentation only).
- Gates: Not applicable; serves solely as a rebuild catalyst.

## 2025-09-04 – Transmission Intro Guard & Diagnostics Hardening
- Goal: Eliminate sporadic unintended replays of the full intro ("BEGIN BURST") during echo phase and provide diagnostic visibility if future regressions occur. Maintain silent echo behavior (visual glitches only) while ensuring audio never returns post-intro except via explicit replay.
- Changes:
  - Added immutable `introModeRef` set on mount (true only if intro should run: first view or explicit replay). All audio + glitch sound effects now gated by `introModeRef` && !doneIntro.
  - Inserted structured debug logger `window.__efTxLog` (bounded to last 400 events) capturing lifecycle events: mount (with flags), intro_init, intro_complete, echo_scheduled(delay), echo_append(line), skip_fastforward, replay_trigger, unmount.
  - Strengthened ambient + glitch audio gating (minor & major glitches) to suppress any sound after intro completion; prior logic only checked typing state.
  - Added replay remount key (`key={replayCounter}`) on `TransmissionPanel` usage in `App.tsx` ensuring clean remount state each replay.
  - Replay handler now explicitly re-enables intro mode (`introModeRef.current = true`) before reinitializing text.
- Files: `TransmissionPanel.tsx`, `App.tsx`, `decision-log.md`.
- Risk: Low (component-local guards + prop key). No preference schema changes, no impact on other panels.
- Verification: Build succeeds; manual smoke (intro plays once, fast forward cuts audio, echo lines append silently w/ visual glitches, replay triggers fresh intro w/ audio, no unsolicited intro restart after multiple echo cycles). `window.__efTxLog` shows expected ordered events.
- Follow-ups: If spontaneous intro re-init ever logs without a user replay_trigger, capture stack trace hook (deferred until needed). Potential metric (transmission_replay_count) if operator wants adoption analytics for replay feature.

## 2025-09-05 – Display Settings v11 (Route Thickness) & Compare Regions Sort Persistence
- Goal: Introduce adjustable route ribbon thickness and persist Compare Regions panel sort order within a browser session.
- Files: `prefs.ts`, `DisplaySettingsPanel.tsx`, `RouteRibbon.ts`, `App.tsx`, `CompareRegionsPanel.tsx`, `HelpPanel.tsx`, `decision-log.md`.
- Changes:
  - Prefs v11 schema adds `routeThickness` (0.5–2.0, default 1.0) with migration path; setter clamps range.
  - Display Settings panel: new slider (Route Thickness) + included in Reset; dispatch event extended with `routeThickness`.
  - App listener writes `__efRouteThickness` (clamped) on event & initializes from stored prefs at startup.
  - RouteRibbon updater multiplies dynamic base pixel width by global `__efRouteThickness` (screen‑space constant thickness preserved).
  - Help panel (Display Settings Overview + Tips) documents feature and interplay with star size & pulse brightness.
  - CompareRegionsPanel: sessionStorage-based persistence of `sortKey` & `sortDir` (restores on reload within same tab session).
- Rationale: Improve visual customization for readability across varied display densities and route contexts; reduce friction when reloading while analyzing region rankings.
- Risk: Low (UI + shader uniform scale only; no new worker or backend interactions). Migration additive & idempotent.
- Gates: typecheck ✅ build (pending) smoke ✅ (manual: slider updates width live; persistence restored after reload; sort order retained in same tab; help entries render without JSX issues).
- Follow-ups: Potential future exposure of dash pattern params & route glow intensity; optional persistence of region compare sort across sessions via localStorage if requested.

## 2025-09-05 – Station Scaling Bounce Stabilization
- Goal: Remove perceptible size "bounce" when zooming extremely close to a focused station (sprite hitting max size then oscillating as camera continues inward / outward).
- Cause: Scale derived from current sprite position after vertical gap offset; as camera moved closer, gap adjustment subtly changed distance used in next frame, nudging computed pixel size above/below cap, creating a visible jitter (lock–release loop right at the max boundary). Reverse zoom produced similar oscillation near re‑entering growth zone.
- Fix: Distance now measured from immutable `basePos` (original system position) eliminating feedback from per-frame gap offset. Added lock mechanism: once target size reaches max (>=99.5% of cap), sprite stays at max until camera distance increases beyond recorded lock distance * 1.35. Prevents oscillation while still allowing shrink when user meaningfully zooms back out. Non-focused sprites unchanged (remain near min). Hysteresis avoids rapid re-lock/unlock.
- Files: `App.tsx` (station scaling loop modifications), `decision-log.md`.
- Risk: Low (math adjustment + small state object). No new prefs, no rendering path changes outside sprite scaling.
- Gates: typecheck ✅ build ✅ smoke (expected visual: smooth growth then stable constant max size even with further inward zoom; unlock after zooming out sufficiently) ✅.
- Follow-ups: Optional smoothing (lerp) for first frame after lock release; expose focus growth curve power as hidden tuning var if additional feedback.

## 2025-09-05 – Explore Routing Mode Scaffold
- Goal: Introduce third optimization mode placeholder ('explore') for upcoming enriched path algorithm (add intermediate systems under fuel overhead cap) without altering existing routing logic yet.
- Changes:
  - Added 'explore' to optimizeFor unions across prefs (`prefs.ts`), App state, P2PRouting UI, RoutingPanel props, routing worker request typing, neighbor expansion (currently treated identical to 'fuel'), and share encode/decode (`share.ts`).
  - UI: Added dropdown option label "Explore (≤30% extra fuel)"; currently returns baseline fuel-optimized route.
  - Share Links: New mode encoded/decoded preserving 'explore' so early shares remain compatible when enrichment logic lands.
  - Decision Log: This entry documents scaffold stage (no enrichment yet) for traceability.
- Rationale: Ship UI + serialization support first to minimize later diff surface; allows early feedback / analytics gating before algorithm complexity.
- Risk: Low (additive enum extension; internal handling defers to fuel path). No worker performance impact.
- Gates: typecheck pending build (post-commit) – expected ✅; baseline routing unaffected for existing modes.
- Follow-ups: Implement enrichment phase (corridor + segment substitution, 30% fuel overhead cap, monotonic progress constraint) in worker; add result metadata (extraSystems, fuelOverheadPct); optional usage metrics & adjustable overhead slider.

## 2025-09-05 – Explore Enrichment (A* + Dijkstra)
- Goal: Implement Explore mode enrichment that adds intermediate systems along A→B within a fuel overhead budget while keeping forward progress and staying near the line between endpoints. Ensure parity under both algorithms (A* basic and Dijkstra advanced).
- Files: `src/utils/routing_worker.ts` (restore clean A* implementation, add `enrichPath`, apply enrichment on goal for both A* and Dijkstra, add `overheadPct` in request and `meta` in response), `src/utils/prefs.ts` (optimize union includes 'explore').
- Behavior: Baseline path computed first; enrichment greedily inserts corridor candidates with segment-internal projection (t∈(0.12,0.88)), budgeted by `baselineCost*(1+overheadPct/100)` (gates=0 cost, ship hops=distance). Progress emits during enrichment. Returns `meta={baselineCost,finalCost,baselineNodes,finalNodes}`.
- Risk: Medium (worker logic). Cached spatial grid/neighbor reuse preserved; progress messages throttled ~200ms.
- Gates: typecheck ✅ build ✅ worker bundle present ✅. Manual smoke pending (runtime route checks under both algorithms).
- Follow-ups: Tune corridor width/thresholds; consider candidate pre-sorting; guard excessive attempts for very long routes.

## 2025-09-05 – Explore Overhead Control & Stats
- Goal: Expose adjustable overhead budget in UI and surface Explore-specific stats under the route summary.
- Files: `src/components/P2PRouting/P2PRouting.tsx` (add Explore option, overhead slider+number, pass `overheadPct` to calculate; render Explore meta: overhead % vs baseline and extra systems), `src/components/Routing/RoutingPanel.tsx` (prop typing to include `meta`), `src/App.tsx` (routeResult accepts `meta`; `calculateRoute` passes `overheadPct` to worker; persisted optimize now includes 'explore').
- Risk: Low (UI + prop typing + message plumbing).
- Gates: typecheck ✅ build ✅ (vite), smoke pending. Note: Vite warns that `sRGBEncoding` is not exported by `three` – non-blocking, unrelated to this change.
- Follow-ups: Optional: update Explore label text to reflect adjustable overhead; optionally persist/display overhead in share links.

## 2025-09-05 – Explore Help & Usage Metric
- Goal: Document Explore mode controls and behavior in Help; include Explore in P2P mode usage share on Stats page.
- Files: `src/components/HelpPanel/HelpPanel.tsx` (new Explore subsection under P2P), `netlify/functions/usage-event.js` (allow `p2p_mode_explore` counter), `src/components/StatsPage.tsx` (display Fuel/Jumps/Explore %).
- Risk: Low (copy + telemetry display only). No worker or algorithm changes.
- Gates: typecheck ✅ build ✅ smoke ✅ (Help renders; Stats shows Explore when used; server accepts event type).
- Follow-ups: Consider dedicated Explore adoption chart and exposing average overhead selected by users.

## 2025-09-05 – Explore Forward-Progress Tuning
- Goal: Prevent perceived “looping near origin” when Explore has a large budget on dense start areas; ensure detours feel like forward movement toward destination.
- Files: `src/utils/routing_worker.ts` (enrichPath)
- Changes:
  - Global forward-progress guard: compute candidate’s global projection t along A→B; require each accepted insert to advance a running minimum t by at least a small step (1%).
  - Progress-weighted scoring: multiply balance/addedCost by a 0.5..1.0 factor increasing with t, gently favoring farther-along candidates.
  - Rotating segment scan start per sweep: distributes inserts across segments rather than always starting at segment 0.
- Effect: With the same overhead, early clustering drops; added systems are more evenly distributed along the path and the route progresses visually.
- Risk: Medium (heuristic tweak only, worker-local). Baseline and budget guarantees preserved.
- Gates: typecheck ✅ build ✅ smoke pending (visual check on long routes with 30–100% overhead).




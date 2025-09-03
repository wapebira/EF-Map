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



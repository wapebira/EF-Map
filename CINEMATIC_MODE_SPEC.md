Fresh Cinematic Mode Rework
=================================

Goal: Purely visual, toggleable rendering layer that leaves all geometry, buffers, data structures, and world coordinates untouched while providing an atmospheric "cinematic" look (indigo → magenta glow + dust + subtle gradient backdrop) matching the reference image mood.

Hard Requirements
-----------------
1. No geometry / position changes. Star buffers, indices, counts remain identical.
2. Toggle on/off instantly with one boolean state. No page reload, no data refetch.
3. No memory leaks – materials / passes / buffers created for cinematic mode are disposed when toggled off.
4. Routes always visible in both modes (slightly emissive in cinematic). Stargate lines hidden only in cinematic mode.
5. Labels, UI overlays, interaction (picking, routes, region highlight) remain aligned and functional.
6. Resize-safe: postprocessing composer and any background meshes update on window resize.
7. Performance: Accept moderate cost (bloom + optional grain). Keep pass count minimal.

Visual Techniques (Chosen Minimal Set)
--------------------------------------
Stars: Reuse existing THREE.Points geometry. Provide two materials:
- Normal: existing PointsMaterial.
- Cinematic variant: additive, depthWrite false, slightly larger size, emissive look.

Glow: Use UnrealBloomPass (or lightweight custom bright-pass + separable blur fallback if dependency concerns) activated only in cinematic mode. Strength slider 0.0 – 1.2.

Dust / Nebula: Single low-density particle cloud (few thousand points) with large soft particles, gently rotating. Color palette: indigo/magenta tinted HSL spread. Overall opacity very low. Amount slider scales opacity (0–1) and optional count threshold.

Background: Inverted large sphere (or full-screen gradient quad) with a vertical radial / 2-color gradient (deep indigo to subtle magenta). Hidden when cinematic off.

Tone / Exposure: Use renderer.toneMapping = ACESFilmicToneMapping (if available) and adjustable exposure (0.6–1.6) only while cinematic active (restore previous mapping and exposure when off).

Optional Twinkle: Mild time-based brightness modulation applied in shader uniform (sin noise) capped so isolated stars do not over-bloom.

Controls (visible only in cinematic mode UI group):
 - Bloom Strength (0 – 1.2)
 - Dust Amount (0 – 100%)
 - Exposure (0.6 – 1.6)

Implementation Plan
-------------------
1. State: Add cinematicMode + bloomStrength + dustAmount + exposure.
2. On toggle ON:
   - Swap star material (store original reference).
   - Hide stargate line object.
   - Create dust particle Points (store refs for disposal).
   - Add background sphere mesh.
   - Initialize EffectComposer with RenderPass + BloomPass (+ optional Grain Pass simple shader) and hook resize.
   - Set toneMapping & exposure.
3. Render loop: If cinematicMode true, composer.render(); else renderer.render().
4. On toggle OFF: Revert star material, show stargate lines, remove & dispose dust + background + composer passes, restore toneMapping/exposure, ensure no lingering references.
5. UI panel: Conditionally render controls near existing panel stack.
6. Twinkle: Implement via modifying fragment color multiplier with small sinusoidal factor (uniform time + per-vertex hash) only in cinematic shader; or CPU color modulation if simpler (but ensure not permanently mutating base color buffer when leaving mode).
7. Memory safety audit: ensure all temporary geometries, materials, and GPU resources disposed on OFF.

Edge Cases / Validation
-----------------------
 - Rapid toggling: resources create/dispose cleanly (no growth in Performance monitor).
 - Resize while cinematic ON then OFF then ON again: composer size correct.
 - Route recalculation during cinematic mode: remains visible & bloom applied.
 - Region highlighting & planet count color bins: underlying color data preserved; additive star material still uses vertex colors.

Follow Ups (Optional Later)
---------------------------
 - Switch particle cloud to volumetric billboard noise shader for richer nebula.
 - Color grading LUT pass.
 - Adjustable star size slider.

This spec guides the clean reimplementation; previous attempts are intentionally ignored.

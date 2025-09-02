import * as THREE from 'three';

/**
 * RouteRibbon – builds a screen-space constant-thickness ribbon polyline with
 * additive glow + directional pulse band to indicate travel direction.
 *
 * Design constraints:
 * - Max ~250 path systems (warning elsewhere) – geometry kept lightweight.
 * - Curved (non-stargate) jumps rendered as quadratic bezier sampled adaptively.
 * - Pixel thickness target (u_pxTarget) clamped between min/max (2–6 px default).
 * - Single RawShaderMaterial (additive) with internal alpha falloff for glow.
 * - Direction pulse: brighter band travels from first to last system.
 */

export interface SystemLite { id: number; name: string; position: { x: number; y: number; z: number }; }
export interface MapDataLite { stargates: Record<string, { source_system_id: number; destination_system_id: number }>; }

interface RouteRibbonOptions {
  pathSystems: SystemLite[];
  mapData: MapDataLite;
  accentHex: number;
  getTransformedPosition: (p: { x: number; y: number; z: number }) => { x: number; y: number; z: number };
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  animUpdatersRef: React.MutableRefObject<Array<() => void>>;
}

export function createRouteRibbon(opts: RouteRibbonOptions): THREE.Group | null {
  const { pathSystems, mapData, accentHex, getTransformedPosition, cameraRef, rendererRef, animUpdatersRef } = opts;
  if (!pathSystems || pathSystems.length < 2) return null;

  // Build fast stargate lookup
  const gatePairs = new Set<string>();
  Object.values(mapData.stargates).forEach(g => {
    gatePairs.add(`${g.source_system_id}_${g.destination_system_id}`);
    gatePairs.add(`${g.destination_system_id}_${g.source_system_id}`);
  });
  const isGate = (a: SystemLite, b: SystemLite) => gatePairs.has(`${a.id}_${b.id}`);

  interface Hop { pts: THREE.Vector3[]; length: number; }
  const hops: Hop[] = [];
  for (let i = 0; i < pathSystems.length - 1; i++) {
    const a = pathSystems[i];
    const b = pathSystems[i + 1];
    const ap = getTransformedPosition(a.position);
    const bp = getTransformedPosition(b.position);
    const A = new THREE.Vector3(ap.x, ap.y, ap.z);
    const B = new THREE.Vector3(bp.x, bp.y, bp.z);
    if (isGate(a, b)) {
      const dist = A.distanceTo(B);
      // Subdivide very long straight gate hops so screen-space expansion remains stable when viewed head-on
      if (dist > 600) {
        const subdivisions = Math.min(12, Math.max(2, Math.round(dist / 400)));
        const pts: THREE.Vector3[] = [];
        for (let s = 0; s <= subdivisions; s++) {
          const t = s / subdivisions;
            pts.push(new THREE.Vector3().lerpVectors(A, B, t));
        }
        hops.push({ pts, length: dist });
      } else {
        hops.push({ pts: [A, B], length: dist });
      }
    } else {
      const dist = A.distanceTo(B);
      const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
      const control = mid.clone().add(new THREE.Vector3(0, dist * 0.30, 0));
      const curve = new THREE.QuadraticBezierCurve3(A, control, B);
      const segs = Math.min(64, Math.max(16, Math.round(dist / 10) + 10));
      const pts: THREE.Vector3[] = [];
      for (let t = 0; t <= 1.00001; t += 1 / segs) pts.push(curve.getPoint(t));
      const filtered: THREE.Vector3[] = [];
      for (const p of pts) if (!filtered.length || !filtered[filtered.length - 1].equals(p)) filtered.push(p);
      hops.push({ pts: filtered, length: dist });
    }
  }
  if (!hops.length) return null;

  // Bounds center for distance-scaling thickness
  const allPts: THREE.Vector3[] = [];
  hops.forEach(h => allPts.push(...h.pts));
  const routeCenter = new THREE.Box3().setFromPoints(allPts).getCenter(new THREE.Vector3());

  // Geometry buffers
  const segmentCount = hops.reduce((acc, h) => acc + (h.pts.length - 1), 0);
  const vertCount = segmentCount * 4;
  const position = new Float32Array(vertCount * 3);
  const prev = new Float32Array(vertCount * 3);
  const next = new Float32Array(vertCount * 3);
  const side = new Float32Array(vertCount);
  const hopLocal = new Float32Array(vertCount); // distance along current hop
  const hopLengthAttr = new Float32Array(vertCount); // hop length
  const hopIndexAttr = new Float32Array(vertCount); // hop index

  const setV3 = (arr: Float32Array, i: number, v: THREE.Vector3) => { arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; };
  let vPtr = 0; let hopIdx = 0;
  hops.forEach(hop => {
    const localD: number[] = [0];
    for (let i = 0; i < hop.pts.length - 1; i++) localD.push(localD[localD.length - 1] + hop.pts[i].distanceTo(hop.pts[i + 1]));
    for (let i = 0; i < hop.pts.length - 1; i++) {
      const p0 = hop.pts[i];
      const p1 = hop.pts[i + 1];
      const pPrev = (i === 0) ? p0.clone().add(p0.clone().sub(p1)) : hop.pts[i - 1];
      const pNext = (i === hop.pts.length - 2) ? p1.clone().add(p1.clone().sub(p0)) : hop.pts[i + 2];
      const verts = [p0, p0, p1, p1];
      const sides = [-1, 1, -1, 1];
      const locals = [localD[i], localD[i], localD[i + 1], localD[i + 1]];
      for (let k = 0; k < 4; k++) {
        setV3(position, vPtr, verts[k]);
        setV3(prev, vPtr, pPrev);
        setV3(next, vPtr, pNext);
        side[vPtr] = sides[k];
        hopLocal[vPtr] = locals[k];
        hopLengthAttr[vPtr] = hop.length;
        hopIndexAttr[vPtr] = hopIdx;
        vPtr++;
      }
    }
    hopIdx++;
  });

  const indices: number[] = [];
  for (let i = 0; i < segmentCount; i++) { const vi = i * 4; indices.push(vi, vi + 2, vi + 1, vi + 2, vi + 3, vi + 1); }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geom.setAttribute('prev', new THREE.BufferAttribute(prev, 3));
  geom.setAttribute('next', new THREE.BufferAttribute(next, 3));
  geom.setAttribute('side', new THREE.BufferAttribute(side, 1));
  geom.setAttribute('hopLocal', new THREE.BufferAttribute(hopLocal, 1));
  geom.setAttribute('hopLength', new THREE.BufferAttribute(hopLengthAttr, 1));
  geom.setAttribute('hopIndex', new THREE.BufferAttribute(hopIndexAttr, 1));
  geom.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      u_color: { value: new THREE.Color(accentHex) },
      u_time: { value: 0 },
      u_pxTarget: { value: 5.5 },
      u_viewport: { value: new THREE.Vector2(800, 600) },
      u_pulseWidth: { value: 0.012 }, // narrower pulse core for crisper head
  u_pulseStrength: { value: 2.3 }, // brighter head
      u_hopTravelTime: { value: 2.5 },
  u_targetMax: { value: 1.0 }, // allow full accent brightness
      u_tailStrength: { value: 0.6 }, // brightness contribution of trailing tail
  u_tailDecay: { value: 0.25 }, // fraction of hop length for tail exponential decay
  u_baseBoost: { value: 1.35 } // brighten baseline so route matches accent theme
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    vertexShader: `precision highp float;\n      attribute vec3 prev;\n      attribute vec3 next;\n      attribute float side;\n      attribute float hopLocal;\n      attribute float hopLength;\n      attribute float hopIndex;\n      uniform float u_pxTarget;\n      uniform vec2 u_viewport;\n      varying float v_side;\n      varying float v_hopLocal;\n      varying float v_hopLength;\n      varying float v_hopIndex;\n      void main(){\n        vec4 prevClip = projectionMatrix * modelViewMatrix * vec4(prev,1.0);\n        vec4 nextClip = projectionMatrix * modelViewMatrix * vec4(next,1.0);\n        vec4 currClip = projectionMatrix * modelViewMatrix * vec4(position,1.0);\n        vec2 prevN = prevClip.xy / prevClip.w;\n        vec2 nextN = nextClip.xy / nextClip.w;\n        vec2 rawDir = nextN - prevN;\n        float rawLen = length(rawDir);\n        vec2 dir;\n        if(rawLen < 0.00025){\n          // Head-on fallback: inject minimal span to avoid collapse (prevents disappearing segments)\n          dir = vec2(1.0,0.0);\n          float t = hopLength > 0.0 ? hopLocal / hopLength : 0.0;\n          float minSpan = 2.0 / min(u_viewport.x, u_viewport.y); // ~2px span in NDC\n          currClip.xy += (t - 0.5) * minSpan * currClip.w * dir;\n        } else {\n          dir = rawDir / rawLen;\n        }\n        if(any(isnan(dir))) dir = vec2(1.0,0.0);\n        vec2 perp = vec2(-dir.y, dir.x);\n        vec2 offsetNdc = perp * side * u_pxTarget * 2.0 / u_viewport;\n        currClip.xy += offsetNdc * currClip.w;\n        v_side = side;\n        v_hopLocal = hopLocal;\n        v_hopLength = hopLength;\n        v_hopIndex = hopIndex;\n        gl_Position = currClip;\n      }\n    `,
    fragmentShader: `precision highp float;\n      uniform vec3 u_color;\n      uniform float u_time;\n      uniform float u_pulseWidth;\n      uniform float u_pulseStrength;\n      uniform float u_hopTravelTime;\n      uniform float u_targetMax;\n      uniform float u_tailStrength;\n      uniform float u_tailDecay;\n      uniform float u_baseBoost;\n      varying float v_side;\n      varying float v_hopLocal;\n      varying float v_hopLength;\n      varying float v_hopIndex;\n      void main(){\n        float edge = abs(v_side);\n        float core = smoothstep(0.82, 0.0, edge);\n        float glow = smoothstep(1.25, 0.0, edge);\n        float maxC = max(max(u_color.r, u_color.g), u_color.b);\n        float scale = maxC > u_targetMax ? (u_targetMax / maxC) : 1.0;\n        vec3 baseCol = u_color * scale * u_baseBoost;\n        float phase = fract((u_time / u_hopTravelTime) + v_hopIndex * 0.173);\n        float pulsePos = phase * v_hopLength;\n        float d = abs(v_hopLocal - pulsePos);\n        float sigma = u_pulseWidth * v_hopLength + 1e-5;\n        float pulse = exp(-pow(d / sigma, 2.0));\n        float rel = (v_hopLocal - pulsePos) / max(v_hopLength, 1e-5);\n        float tail = 0.0; if(rel < 0.0){ tail = exp(rel / max(u_tailDecay, 1e-4)); }\n        float brightness = 1.0 + pulse * u_pulseStrength + tail * u_tailStrength;\n        vec3 col = baseCol * brightness;\n        float alpha = (core * 0.92 + glow * 0.45) * clamp(0.55 + pulse * 0.45 + tail * 0.30, 0.0, 1.0);\n        if(alpha < 0.02) discard;\n        gl_FragColor = vec4(col, alpha);\n      }\n    `
  });

  // Additive glow mesh for bloom emphasis (focuses on bright pulse & tail)
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: material.uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: material.vertexShader as string,
    fragmentShader: `precision highp float;\n      uniform vec3 u_color;\n      uniform float u_time;\n      uniform float u_pulseWidth;\n      uniform float u_pulseStrength;\n      uniform float u_hopTravelTime;\n      uniform float u_tailStrength;\n      uniform float u_tailDecay;\n      uniform float u_baseBoost;\n      varying float v_side;\n      varying float v_hopLocal;\n      varying float v_hopLength;\n      varying float v_hopIndex;\n      void main(){\n        float edge = abs(v_side);\n        float core = smoothstep(0.95, 0.0, edge);\n        float phase = fract((u_time / u_hopTravelTime) + v_hopIndex * 0.173);\n        float pulsePos = phase * v_hopLength;\n        float d = abs(v_hopLocal - pulsePos);\n        float sigma = u_pulseWidth * v_hopLength + 1e-5;\n        float pulse = exp(-pow(d / sigma, 2.0));\n        float rel = (v_hopLocal - pulsePos) / max(v_hopLength, 1e-5);\n        float tail = rel < 0.0 ? exp(rel / max(u_tailDecay, 1e-4)) : 0.0;\n        float brightness = pulse * (u_pulseStrength*1.15) + tail * (u_tailStrength*0.8);\n        vec3 col = u_color * u_baseBoost * brightness;\n        float alpha = core * clamp(brightness, 0.0, 1.0);\n        if(alpha < 0.015) discard;\n        gl_FragColor = vec4(col, alpha);\n      }\n    `
  });

  const mesh = new THREE.Mesh(geom, material);
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);
  const glowMesh = new THREE.Mesh(geom, glowMaterial); glowMesh.frustumCulled = false; group.add(glowMesh);
  (group as any).userData.routeMaterial = material;
  (group as any).userData.routeGlowMaterial = glowMaterial;
  (group as any).userData.routeGeometry = geom;

  const updater = () => {
    const renderer = rendererRef.current; const cam = cameraRef.current; if (!renderer || !cam) return;
    const u = material.uniforms as any;
    u.u_viewport.value.set(
      renderer.domElement.clientWidth || window.innerWidth,
      renderer.domElement.clientHeight || window.innerHeight
    );
    const dist = cam.position.distanceTo(routeCenter);
    const nearD = 300.0, farD = 3500.0; let t = (dist - nearD) / (farD - nearD); if (t < 0.) t = 0.; else if (t > 1.) t = 1.;
    const maxPx = 8.0, minPx = 5.0; // thicker window
    u.u_pxTarget.value = maxPx - (maxPx - minPx) * t;
    u.u_time.value = performance.now() / 1000.0;
  };
  animUpdatersRef.current.push(updater);

  (group as any).disposeRoute = () => {
    const arr = animUpdatersRef.current; if (Array.isArray(arr)) { const idx = arr.indexOf(updater); if (idx >= 0) arr.splice(idx, 1); }
  geom.dispose(); material.dispose(); glowMaterial.dispose();
  };

  return group;
}

export function recolorRouteRibbon(routeGroup: THREE.Group | null, accentHex: number) {
  if (!routeGroup) return;
  const mat = (routeGroup as any).userData?.routeMaterial as THREE.RawShaderMaterial | undefined;
  const glow = (routeGroup as any).userData?.routeGlowMaterial as THREE.RawShaderMaterial | undefined;
  if (mat && mat.uniforms.u_color) {
    (mat.uniforms.u_color.value as THREE.Color).setHex(accentHex);
  }
  if (glow && glow.uniforms.u_color) {
    (glow.uniforms.u_color.value as THREE.Color).setHex(accentHex);
  }
}

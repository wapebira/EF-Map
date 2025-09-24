import * as THREE from 'three';

export interface SmartAssemblyHaloDatum {
  systemId: number;
  total: number;
  color: THREE.Color;
}

interface InternalAttributes {
  positions: Float32Array;
  colors: Float32Array;
  strengths: Float32Array;
  pulses: Float32Array;
  systemIds: Int32Array;
  starFactors: Float32Array;
}

const STAR_BASE_SIZE = 2; // Matches PointsMaterial size for stars
const STAR_MAX_SIZE_PX = 10; // See star shader max
const HALO_GAP_DIAMETER_PX = 2; // 1px gap around the star on each side
const HALO_MIN_THICKNESS_PX = 2;
const HALO_MAX_THICKNESS_PX = 10;
const HALO_OUTER_MAX_PX = 48;
const ANTIALIAS_PX = 1.25;
const DEFAULT_INNER_RATIO = 0.78; // Safe fallback if sizing fails

const WHITE = new THREE.Color(0xffffff);

/**
 * Screen-space halo renderer for Smart Assembly overlays with dynamic sizing tied to star pixels.
 */
export class SmartAssemblyHalos {
  private scene: THREE.Scene;
  private ringTexture: THREE.Texture;
  private getPosition: (systemId: number, target: THREE.Vector3) => THREE.Vector3 | null;
  private group = new THREE.Group();
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.PointsMaterial | null = null;
  private points: THREE.Points | null = null;
  private shader: { uniforms: Record<string, { value: number }> } | null = null;
  private disposed = false;
  private visible = true;
  private tempVec = new THREE.Vector3();
  private viewport = new THREE.Vector2();
  private viewMatrix = new THREE.Matrix4();
  private lastCamera: THREE.PerspectiveCamera | null = null;
  private lastRenderer: THREE.WebGLRenderer | null = null;
  private lastCount = 0;

  private data: (InternalAttributes & {
    sizes: Float32Array;
    innerRatios: Float32Array;
    featherInner: Float32Array;
    featherOuter: Float32Array;
  }) | null = null;

  private sizeAttribute: THREE.BufferAttribute | null = null;
  private innerAttribute: THREE.BufferAttribute | null = null;
  private featherInnerAttribute: THREE.BufferAttribute | null = null;
  private featherOuterAttribute: THREE.BufferAttribute | null = null;

  constructor(
    scene: THREE.Scene,
    ringTexture: THREE.Texture,
    getPosition: (systemId: number, target: THREE.Vector3) => THREE.Vector3 | null,
  ) {
    this.scene = scene;
    this.ringTexture = ringTexture;
    this.getPosition = getPosition;
    this.group.name = 'SmartAssemblyHalos';
    this.group.visible = false;
    this.scene.add(this.group);
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (this.group) this.group.visible = v && this.lastCount > 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.points = null;
    }
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    this.scene.remove(this.group);
    this.data = null;
    this.sizeAttribute = null;
    this.innerAttribute = null;
    this.featherInnerAttribute = null;
    this.featherOuterAttribute = null;
  }

  clear() {
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.points = null;
    }
    this.data = null;
    this.sizeAttribute = null;
    this.innerAttribute = null;
    this.featherInnerAttribute = null;
    this.featherOuterAttribute = null;
    this.lastCount = 0;
    this.group.visible = false;
  }

  update(timeMs: number, camera?: THREE.Camera | null, renderer?: THREE.WebGLRenderer | null) {
    if (camera && (camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      this.lastCamera = camera as THREE.PerspectiveCamera;
    }
    if (renderer) {
      this.lastRenderer = renderer;
    }

    if (!this.visible || !this.points || !this.shader) return;

    if (this.lastCamera && this.lastRenderer) {
      this.refreshSizing(this.lastCamera, this.lastRenderer);
    }

    this.shader.uniforms.uTime.value = timeMs / 1000;
  }

  setData(entries: SmartAssemblyHaloDatum[], maxTotal: number) {
    if (this.disposed) return;

    if (!entries.length || maxTotal <= 0) {
      this.clear();
      return;
    }

    const attributes = this.buildAttributes(entries, maxTotal);
    if (!attributes) {
      this.clear();
      return;
    }

    this.ensureMaterial();
    this.ensureGeometry();

    if (!this.geometry || !this.material || !this.points) {
      return;
    }

    const count = attributes.positions.length / 3;

    this.data = {
      ...attributes,
      sizes: new Float32Array(count),
      innerRatios: new Float32Array(count),
      featherInner: new Float32Array(count),
      featherOuter: new Float32Array(count),
    };

    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.data.positions, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.data.colors, 3));
    this.geometry.setAttribute('aStrength', new THREE.Float32BufferAttribute(this.data.strengths, 1));
    this.geometry.setAttribute('aPulse', new THREE.Float32BufferAttribute(this.data.pulses, 1));

    this.sizeAttribute = new THREE.BufferAttribute(this.data.sizes, 1);
    this.sizeAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aSize', this.sizeAttribute);

    this.innerAttribute = new THREE.BufferAttribute(this.data.innerRatios, 1);
    this.innerAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aInner', this.innerAttribute);

    this.featherInnerAttribute = new THREE.BufferAttribute(this.data.featherInner, 1);
    this.featherInnerAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aFeatherInner', this.featherInnerAttribute);

    this.featherOuterAttribute = new THREE.BufferAttribute(this.data.featherOuter, 1);
    this.featherOuterAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aFeatherOuter', this.featherOuterAttribute);

    this.geometry.computeBoundingSphere();

    this.lastCount = count;
    this.group.visible = this.visible && this.lastCount > 0;

    if (this.lastCamera && this.lastRenderer) {
      this.refreshSizing(this.lastCamera, this.lastRenderer);
    } else {
      this.seedFallbackSizing();
    }
  }

  private ensureGeometry() {
    if (this.geometry && this.points) return;

    this.geometry = new THREE.BufferGeometry();
    this.material = this.material ?? this.createMaterial();
    this.points = new THREE.Points(this.geometry, this.material!);
    this.points.renderOrder = 4500;
    this.points.frustumCulled = false;
    (this.points.material as THREE.PointsMaterial).depthWrite = false;
    this.group.add(this.points);
  }

  private ensureMaterial() {
    if (!this.material) {
      this.material = this.createMaterial();
    }
  }

  private createMaterial(): THREE.PointsMaterial {
    const material = new THREE.PointsMaterial({
      size: 1,
      sizeAttenuation: false,
      map: this.ringTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.2,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uMaxSize = { value: HALO_OUTER_MAX_PX + 4 };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nattribute float aSize;\nattribute float aStrength;\nattribute float aPulse;\nattribute float aInner;\nattribute float aFeatherInner;\nattribute float aFeatherOuter;\nvarying float vStrength;\nvarying float vPulse;\nvarying float vInner;\nvarying float vFeatherInner;\nvarying float vFeatherOuter;\nuniform float uMaxSize;\n`,
        )
        .replace('gl_PointSize = size;', 'gl_PointSize = min(aSize, uMaxSize);')
        .replace('gl_PointSize = size * ( scale / - mvPosition.z );', 'gl_PointSize = min(aSize, uMaxSize);')
        .replace(
          'void main() {',
          `void main() {\n  vStrength = aStrength;\n  vPulse = aPulse;\n  vInner = aInner;\n  vFeatherInner = aFeatherInner;\n  vFeatherOuter = aFeatherOuter;\n`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying float vStrength;\nvarying float vPulse;\nvarying float vInner;\nvarying float vFeatherInner;\nvarying float vFeatherOuter;\nuniform float uTime;\n`,
        )
        .replace(
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
          `vec2 uv = gl_PointCoord * 2.0 - 1.0;\nfloat r = length(uv);\nif(r > 1.0){ discard; }\nfloat inner = clamp(vInner, 0.0, 0.995);\nfloat ringEdgeIn = smoothstep(inner, inner + vFeatherInner, r);\nfloat ringEdgeOut = 1.0 - smoothstep(1.0 - vFeatherOuter, 1.0, r);\nfloat ringMask = clamp(ringEdgeIn * ringEdgeOut, 0.0, 1.0);\nfloat pulseAmp = 0.18 + 0.25 * vStrength;\nfloat pulse = 1.0 + pulseAmp * sin(uTime * 0.6 + vPulse);\nvec3 base = diffuseColor.rgb * (0.65 + 0.4 * vStrength);\nvec3 col = clamp(base * pulse, 0.0, 1.0);\nfloat alpha = diffuseColor.a * ringMask;\ngl_FragColor = vec4(col, alpha);\n`,
        );

      this.shader = shader as unknown as { uniforms: Record<string, { value: number }> };
    };

    return material;
  }

  private refreshSizing(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    if (!this.data || !this.sizeAttribute || !this.innerAttribute || !this.featherInnerAttribute || !this.featherOuterAttribute) {
      return;
    }

    camera.updateMatrixWorld();
    this.viewMatrix.copy(camera.matrixWorld).invert();

    renderer.getSize(this.viewport);
    const pixelRatio = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : (window.devicePixelRatio || 1);
    const scale = this.viewport.y * 0.5 * pixelRatio;

    const { positions, starFactors, sizes, innerRatios, featherInner, featherOuter } = this.data;
    const count = starFactors.length;

    for (let i = 0; i < count; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];

      this.tempVec.set(px, py, pz).applyMatrix4(this.viewMatrix);
      const depth = -this.tempVec.z;

      if (depth <= 0.0001) {
        sizes[i] = HALO_MIN_THICKNESS_PX * 2 + HALO_GAP_DIAMETER_PX;
        innerRatios[i] = DEFAULT_INNER_RATIO;
        featherInner[i] = featherOuter[i] = 0.02;
        continue;
      }

      let starPx = STAR_BASE_SIZE * starFactors[i] * (scale / depth);
      starPx = THREE.MathUtils.clamp(starPx, 1, STAR_MAX_SIZE_PX);

      const innerDiameter = starPx + HALO_GAP_DIAMETER_PX;
      const t = THREE.MathUtils.clamp(starPx / STAR_MAX_SIZE_PX, 0, 1);
      const thickness = THREE.MathUtils.clamp(
        HALO_MIN_THICKNESS_PX + (HALO_MAX_THICKNESS_PX - HALO_MIN_THICKNESS_PX) * t,
        HALO_MIN_THICKNESS_PX,
        HALO_MAX_THICKNESS_PX,
      );
      const outerDiameter = THREE.MathUtils.clamp(innerDiameter + thickness * 2, innerDiameter + 2, HALO_OUTER_MAX_PX);

      sizes[i] = outerDiameter;

      const safeInnerDiameter = Math.min(innerDiameter, outerDiameter * 0.98);
      const innerRatio = safeInnerDiameter / outerDiameter;
      innerRatios[i] = THREE.MathUtils.clamp(innerRatio, 0.0, 0.985);

      const outerRadiusPx = outerDiameter * 0.5;
      const featherInnerPx = Math.min(ANTIALIAS_PX, thickness);
      const featherOuterPx = Math.min(ANTIALIAS_PX, thickness);
      featherInner[i] = THREE.MathUtils.clamp(featherInnerPx / outerRadiusPx, 0.002, 0.25);
      featherOuter[i] = THREE.MathUtils.clamp(featherOuterPx / outerRadiusPx, 0.002, 0.25);
    }

    this.sizeAttribute.needsUpdate = true;
    this.innerAttribute.needsUpdate = true;
    this.featherInnerAttribute.needsUpdate = true;
    this.featherOuterAttribute.needsUpdate = true;
  }

  private seedFallbackSizing() {
    if (!this.data || !this.sizeAttribute || !this.innerAttribute || !this.featherInnerAttribute || !this.featherOuterAttribute) {
      return;
    }

    const { sizes, innerRatios, featherInner, featherOuter } = this.data;
    sizes.fill(HALO_MIN_THICKNESS_PX * 2 + HALO_GAP_DIAMETER_PX + 2);
    innerRatios.fill(DEFAULT_INNER_RATIO);
    featherInner.fill(0.05);
    featherOuter.fill(0.05);

    this.sizeAttribute.needsUpdate = true;
    this.innerAttribute.needsUpdate = true;
    this.featherInnerAttribute.needsUpdate = true;
    this.featherOuterAttribute.needsUpdate = true;
  }

  private buildAttributes(entries: SmartAssemblyHaloDatum[], maxTotal: number): InternalAttributes | null {
    const posArray: number[] = [];
    const colorArray: number[] = [];
    const strengthArray: number[] = [];
    const pulseArray: number[] = [];
    const systemIds: number[] = [];
    const starFactors: number[] = [];

    const denom = Math.log10(maxTotal + 1);
    if (!Number.isFinite(denom) || denom <= 0) return null;

    for (const entry of entries) {
      if (!entry || entry.total <= 0) continue;
      const pos = this.getPosition(entry.systemId, this.tempVec.set(0, 0, 0));
      if (!pos) continue;

      const normalized = Math.log10(entry.total + 1) / denom;
      const strength = THREE.MathUtils.clamp(normalized, 0, 1);

      posArray.push(pos.x, pos.y, pos.z);

      const color = entry.color || WHITE;
      colorArray.push(color.r, color.g, color.b);
      strengthArray.push(strength);

      const pulseSeed = Math.sin(entry.systemId * 12.9898) * 43758.5453;
      const pulsePhase = (pulseSeed - Math.floor(pulseSeed)) * Math.PI * 2;
      pulseArray.push(pulsePhase);

      systemIds.push(entry.systemId | 0);
      starFactors.push(this.computeStarSizeFactor(entry.systemId));
    }

    if (!posArray.length) return null;

    return {
      positions: new Float32Array(posArray),
      colors: new Float32Array(colorArray),
      strengths: new Float32Array(strengthArray),
      pulses: new Float32Array(pulseArray),
      systemIds: new Int32Array(systemIds),
      starFactors: new Float32Array(starFactors),
    };
  }

  private computeStarSizeFactor(systemId: number): number {
    const seed = Math.sin(systemId * 12.9898) * 43758.5453;
    const mod = ((seed % 37) + 37) % 37;
    return mod < 1 ? 1.6 : 1.0;
  }
}

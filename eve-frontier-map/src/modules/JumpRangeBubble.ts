import * as THREE from 'three';

// Jump range bubble: translucent spherical shell with subtle rim (soap bubble effect).
// Usage: const bubble = createJumpRangeBubble(radius, accentIsBlue); scene.add(bubble.group);
// Update each frame or when moved: bubble.update(pos, radius, accentIsBlue, camera)

export interface JumpRangeBubbleHandle {
  group: THREE.Group;
  update: (pos:THREE.Vector3, radius:number, accentIsBlue:boolean, camera:THREE.Camera)=>void;
  tick: (elapsed:number)=>void; // animate iridescence
  dispose: ()=>void;
}

export function createJumpRangeBubble(radius:number, accentIsBlue:boolean): JumpRangeBubbleHandle {
  const group = new THREE.Group(); group.visible = false;

  const baseColor = new THREE.Color(accentIsBlue? 0x00aaff : 0xff4c26);
  // Inner faint fill
  const innerGeom = new THREE.SphereGeometry(1, 48, 32);
  // Revert inner fill to earlier subtle value (very low opacity to avoid dark disk) – can tweak later
  const innerMat = new THREE.MeshBasicMaterial({ color: baseColor.clone().multiplyScalar(0.4), transparent:true, opacity:0.02, depthWrite:false, side:THREE.FrontSide });
  const inner = new THREE.Mesh(innerGeom, innerMat); inner.renderOrder = 1; group.add(inner);
  // Shell rim (Fresnel-style glow)
    const shellGeom = new THREE.SphereGeometry(1, 64, 40);
      const shellMat = new THREE.ShaderMaterial({
        transparent:true,
        depthWrite:false,
        uniforms:{ uColor:{ value: baseColor.clone() }, uAlpha:{ value:0.55 }, uTime:{ value:0 }, uSpeed:{ value:0.6 }, uBaseHue:{ value: accentIsBlue? 0.56 : 0.033 }, uHueScale:{ value: accentIsBlue? 1.0 : 0.28 } },
        vertexShader:`varying float vF; varying vec3 vN; void main(){ vec3 n = normalize(normalMatrix * normal); vN = n; vec3 viewDir = normalize(- (modelViewMatrix * vec4(position,1.0)).xyz); float nd = dot(viewDir, n); vF = pow(1.0 - nd, 2.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader:`uniform vec3 uColor; uniform float uAlpha; uniform float uTime; uniform float uSpeed; uniform float uBaseHue; uniform float uHueScale; varying float vF; varying vec3 vN;\nfloat hue2rgb(float f1,float f2,float h){ if(h<0.0) h+=1.0; if(h>1.0) h-=1.0; float res; if(6.0*h<1.0) res=f1+(f2-f1)*6.0*h; else if(2.0*h<1.0) res=f2; else if(3.0*h<2.0) res=f1+(f2-f1)*((2.0/3.0)-h)*6.0; else res=f1; return res; }\nvec3 hsl2rgb(float h,float s,float l){ float m2 = l<=0.5? l*(1.0+s): l + s - l*s; float m1 = 2.0*l - m2; return vec3(hue2rgb(m1,m2,h+1.0/3.0), hue2rgb(m1,m2,h), hue2rgb(m1,m2,h-1.0/3.0)); }\nvoid main(){ float rim = vF; if(rim < 0.012) discard; float t = uTime * uSpeed; float lon = atan(vN.z, vN.x); float lat = asin(clamp(vN.y,-1.0,1.0)); float p1 = sin(lon*2.4 + lat*1.7 + t*0.35); float p2 = sin(lon*5.2 - lat*3.1 - t*0.55); float swirl = sin((lon+lat)*3.0 + t*0.22); float fine = sin(lon*11.0 + lat*9.0 + t*0.9); float thickness = 0.55 + 0.30*p1 + 0.22*p2 + 0.12*swirl + 0.06*fine; thickness += 0.08*sin(t*0.18 + lon*1.3) + 0.05*sin(t*0.21 - lat*1.9); float hueOffset = (thickness*0.42 + t*0.045 - 0.5); float hue = fract(uBaseHue + hueOffset * uHueScale); float satBase = 0.25 + 0.45*pow(rim,0.55); float satFlow = 0.15*sin(t*0.30 + lon*1.5 - lat*1.2) + 0.10*sin(t*0.55 - lon*2.2 + lat*2.8); float sat = clamp(satBase + satFlow, 0.15, 0.95); float light = 0.50 + 0.10*sin(t*0.28 + lon*2.0) + 0.06*sin(t*0.41 - lat*2.5); vec3 irid = hsl2rgb(hue, sat, light); float mixAmt = 0.30 + 0.55*pow(rim,1.4); vec3 col = mix(uColor, irid, mixAmt); col += pow(rim,4.5) * 0.25 * vec3(1.2,1.15,1.25); col *= 0.50 + 0.85*rim; float breathe = 0.94 + 0.06*sin(t*0.50); float alpha = uAlpha * rim * breathe; gl_FragColor = vec4(col, alpha); }`,
        side:THREE.FrontSide,
        blending:THREE.AdditiveBlending
      });
  const shell = new THREE.Mesh(shellGeom, shellMat); shell.renderOrder = 2; group.add(shell);

  // Interior iridescent patches layer (independent additive pass)
  const patchGeom = new THREE.SphereGeometry(1, 56, 36);
  const patchMat = new THREE.ShaderMaterial({
    transparent:true,
    depthWrite:false,
    side:THREE.FrontSide,
    blending:THREE.AdditiveBlending,
    uniforms:{ uColor:{ value: baseColor.clone() }, uTime:{ value:0 }, uSpeed:{ value:0.7 }, uIntensity:{ value:0.22 }, uBaseHue:{ value: accentIsBlue? 0.56 : 0.033 }, uHueScale:{ value: accentIsBlue? 1.0 : 0.30 }, uPatchScale:{ value:1.0 } },
    vertexShader:`varying vec3 vN; varying float vFace; void main(){ vec3 n = normalize(normalMatrix * normal); vN = n; vec3 vd = normalize(- (modelViewMatrix * vec4(position,1.0)).xyz); vFace = dot(vd,n); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader:`uniform vec3 uColor; uniform float uTime; uniform float uSpeed; uniform float uIntensity; uniform float uBaseHue; uniform float uHueScale; uniform float uPatchScale; varying vec3 vN; varying float vFace;\nfloat h2rgb(float p,float q,float t){ if(t<0.0) t+=1.0; if(t>1.0) t-=1.0; if(t<1.0/6.0) return p+(q-p)*6.0*t; if(t<1.0/2.0) return q; if(t<2.0/3.0) return p+(q-p)*(2.0/3.0 - t)*6.0; return p; }\nvec3 hsl(float h,float s,float l){ float q = l < 0.5 ? l*(1.0+s) : l + s - l*s; float p = 2.0*l - q; return vec3(h2rgb(p,q,h+1.0/3.0), h2rgb(p,q,h), h2rgb(p,q,h-1.0/3.0)); }\nvoid main(){ float t = uTime * uSpeed * 2.0; float lon = atan(vN.z, vN.x); float lat = asin(clamp(vN.y,-1.0,1.0)); float scale = uPatchScale; float f1 = sin((lon*2.0 + lat*1.7)*scale + t*0.60) + sin((lat*2.2 - lon*1.1)*scale - t*0.55); float f2 = sin((lon+lat)*2.2*scale - t*0.75); float f3 = sin((lon*3.1 - lat*2.4)*scale + t*0.95); float field = (f1*0.50 + f2*0.30 + f3*0.20); field = clamp(field,-2.0,2.0)/2.0; float gate = smoothstep(0.32, 0.62, field + 0.30*sin(t*0.50)); float faceBias = 0.55 + 0.45*abs(sin(t*0.14) + vFace*0.9); float mask = gate * faceBias; float rimProxy = pow(1.0 - clamp(vFace,-1.0,1.0), 2.0); mask *= (1.0 - smoothstep(0.68, 0.90, rimProxy)); mask = pow(mask,1.55); if(mask < 0.05) discard; float hue = fract(uBaseHue + (field*0.09 + t*0.020) * uHueScale); float sat = 0.55 + 0.28*field; float light = 0.50 + 0.07*sin(t*0.75 + lon*2.4) + 0.04*field; vec3 irid = hsl(hue, sat, light); vec3 col = mix(uColor, irid, 0.60); float alpha = uIntensity * mask * (0.55 + 0.45*sin(t*1.05 + lon*3.0 + lat*1.8)); gl_FragColor = vec4(col, alpha); }`
  });
  const patches = new THREE.Mesh(patchGeom, patchMat); patches.renderOrder = 1.5; group.add(patches);

  if(radius>0){ group.scale.set(radius, radius, radius); }

  function update(pos:THREE.Vector3, r:number, isBlue:boolean){
    group.visible = true; group.position.copy(pos); group.scale.set(r,r,r);
    const c = isBlue? 0x00aaff : 0xff4c26;
  (innerMat.color as THREE.Color).setHex(c).multiplyScalar(0.45);
  (shellMat.uniforms.uColor.value as THREE.Color).setHex(c);
  (patchMat.uniforms.uColor.value as THREE.Color).setHex(c);
  // Update hue centers & scales when accent changes
  shellMat.uniforms.uBaseHue.value = isBlue? 0.56 : 0.033;
  patchMat.uniforms.uBaseHue.value = isBlue? 0.56 : 0.033;
  shellMat.uniforms.uHueScale.value = isBlue? 1.0 : 0.28; // narrower hue band for orange
  patchMat.uniforms.uHueScale.value = isBlue? 1.0 : 0.30;
  }

  // Track a local start time so animation uses a small, smoothly increasing relative time
  let startTime: number | null = null;
  function tick(elapsed:number){
    // elapsed is expected from performance.now(); convert to relative seconds
    if(startTime === null) startTime = elapsed;
    const rel = (elapsed - startTime) * 0.001; // seconds since first tick
  shellMat.uniforms.uTime.value = rel;
  patchMat.uniforms.uTime.value = rel;
    try { const w:any = window; if(w){ if(w.__efBubblePatchSpeed) patchMat.uniforms.uSpeed.value = w.__efBubblePatchSpeed; if(w.__efBubblePatchIntensity) patchMat.uniforms.uIntensity.value = w.__efBubblePatchIntensity; if(w.__efBubblePatchScale) patchMat.uniforms.uPatchScale.value = w.__efBubblePatchScale; } } catch {}
  try { const w:any = window; if(w && w.__efBubbleSpeed) shellMat.uniforms.uSpeed.value = w.__efBubbleSpeed; } catch {}
  const sp = shellMat.uniforms.uSpeed.value as number;
  group.rotation.y = rel * 0.25 * sp;
  group.rotation.x = rel * 0.10 * sp;
  }

  function dispose(){
  innerGeom.dispose(); shellGeom.dispose(); patchGeom.dispose(); (innerMat as THREE.Material).dispose(); (shellMat as THREE.Material).dispose(); (patchMat as THREE.Material).dispose();
  }

  return { group, update, tick, dispose };
}

import * as THREE from 'three';

export interface GalaxyBackgroundOptions {
  radius?: number;
  coreWarm?: number;       // warm yellowish core
  coreHot?: number;        // hotter inner core tint
  armInner?: number;       // inner arm color (blue)
  armOuter?: number;       // outer arm color (purple/pink)
  dustColor?: number;      // faint diffuse dust tint
  starDensity?: number;    // faint embedded stars on shell
  clusterCount?: number;   // bright additive clusters inside
  angleTwist?: number;     // spiral twist
  noiseScale?: number;     // base noise scale
  intensity?: number;      // overall brightness multiplier
}

export function createGalaxyBackground(opts: GalaxyBackgroundOptions = {}) {
  const {
    radius = 200000,
    coreWarm = 0xf7d6b6,
    coreHot = 0xfff4d2,
    armInner = 0x6fa8ff,
    armOuter = 0xb27bff,
    dustColor = 0x3b1d52,
    starDensity = 9000,
    clusterCount = 450,
    angleTwist = 6.0,
  noiseScale = 0.00002,
  intensity = 1.0,
  } = opts;

  // Inverted sphere for skybox-like backdrop
  const geom = new THREE.SphereGeometry(radius, 64, 64);
  geom.scale(-1, 1, 1);

  const uniforms = {
    uCoreWarm: { value: new THREE.Color(coreWarm) },
    uCoreHot: { value: new THREE.Color(coreHot) },
    uArmInner: { value: new THREE.Color(armInner) },
    uArmOuter: { value: new THREE.Color(armOuter) },
    uDust: { value: new THREE.Color(dustColor) },
    uTime: { value: 0 },
    uNoiseScale: { value: noiseScale },
    uTwist: { value: angleTwist },
  uIntensity: { value: intensity },
  };

  const vertexShader = /* glsl */`varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
  const fragmentShader = /* glsl */`
    varying vec3 vPos; uniform vec3 uCoreWarm, uCoreHot, uArmInner, uArmOuter, uDust; uniform float uTime, uNoiseScale, uTwist, uIntensity; 
    float hash(float n){ return fract(sin(n)*43758.5453123); }
    float noise(vec3 x){ vec3 p=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f); float n=p.x+p.y*57.0+113.0*p.z; return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z); }
    float fbm(vec3 p){ float a=0.5,f=0.; for(int i=0;i<5;i++){ f+=a*noise(p); p*=2.13; a*=0.55;} return f; }
    void main(){ vec3 dir=normalize(vPos); float equ=1.0-abs(dir.y); float angle=atan(dir.z,dir.x); float r=length(dir.xz);
      float arms=sin(angle*4.0 + r*uTwist*0.3); float armMask=smoothstep(-0.6,0.8,arms);
      float baseNoise=fbm(dir*(500.0*uNoiseScale)+uTime*0.02); float detail=fbm(dir*(1200.0*uNoiseScale)-uTime*0.01); float density=mix(baseNoise,detail,0.5); density=pow(density,1.4);
      density*=equ*1.2; density*=mix(0.35,1.4,armMask); float core=pow(equ,6.0);
      vec3 coreCol=mix(uCoreWarm,uCoreHot,clamp(density*2.0,0.0,1.0)); vec3 armCol=mix(uArmInner,uArmOuter,clamp(density*1.3,0.0,1.0)); vec3 dust=uDust*pow(equ,2.0)*0.4;
      vec3 col=dust + coreCol*core*2.0 + armCol*density*1.8; float sparkle=step(0.995,noise(dir*800.0+uTime*0.5)); col+=vec3(1.2,1.0,1.4)*sparkle; col*=smoothstep(0.0,0.9,equ);
      col = pow(col, vec3(0.8)) * uIntensity; // slight gamma lift + intensity boost
      gl_FragColor=vec4(col,1.0); }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    transparent: false,
  });
  const sphere = new THREE.Mesh(geom, mat);

  // Shell stars (additive)
  const shellGeo = new THREE.BufferGeometry();
  const shellCount = starDensity;
  const shellPos = new Float32Array(shellCount * 3);
  const shellCol = new Float32Array(shellCount * 3);
  for (let i=0;i<shellCount;i++){
    const u = Math.random();
    const v = Math.random();
    const theta = 2*Math.PI*u;
    const phi = Math.acos(2*v-1);
    const rr = radius * 0.998;
    const sx = rr * Math.sin(phi)*Math.cos(theta);
    const sy = rr * Math.cos(phi);
    const sz = rr * Math.sin(phi)*Math.sin(theta);
    shellPos[i*3] = sx; shellPos[i*3+1]=sy; shellPos[i*3+2]=sz;
    const choice = Math.random();
    const c = choice < 0.33 ? new THREE.Color(0x84b9ff) : choice < 0.66 ? new THREE.Color(0xc79bff) : new THREE.Color(0xffffff);
    c.toArray(shellCol, i*3);
  }
  shellGeo.setAttribute('position', new THREE.BufferAttribute(shellPos,3));
  shellGeo.setAttribute('color', new THREE.BufferAttribute(shellCol,3));
  const shellMat = new THREE.PointsMaterial({ size: 1.6, vertexColors:true, transparent:true, opacity:0.55, depthWrite:false, blending:THREE.AdditiveBlending });
  const shellStars = new THREE.Points(shellGeo, shellMat);

  // Bright inner clusters (custom shader for soft discs) - WebGL1 friendly
  const clusterGeo = new THREE.BufferGeometry();
  const clusterPos = new Float32Array(clusterCount * 3);
  const clusterCol = new Float32Array(clusterCount * 3);
  const clusterSize = new Float32Array(clusterCount);
  const clusterPhase = new Float32Array(clusterCount);
  for (let i=0;i<clusterCount;i++){
    const rNorm = Math.random();
    const ang = rNorm * angleTwist * 1.5 + Math.random()*0.5;
    const rad = rNorm * radius * 0.25;
    const x = Math.cos(ang)*rad;
    const z = Math.sin(ang)*rad;
    const y = (Math.random()-0.5) * radius * 0.02;
    clusterPos[i*3]=x; clusterPos[i*3+1]=y; clusterPos[i*3+2]=z;
    clusterSize[i] = 8 + Math.random()*20;
    clusterPhase[i] = Math.random()*Math.PI*2;
    new THREE.Color().setHSL(0.65 + Math.random()*0.1, 0.55 + Math.random()*0.35, 0.55 + Math.random()*0.3).toArray(clusterCol, i*3);
  }
  clusterGeo.setAttribute('position', new THREE.BufferAttribute(clusterPos,3));
  clusterGeo.setAttribute('color', new THREE.BufferAttribute(clusterCol,3));
  clusterGeo.setAttribute('aSize', new THREE.BufferAttribute(clusterSize,1));
  clusterGeo.setAttribute('aPhase', new THREE.BufferAttribute(clusterPhase,1));
  const clusterMat = new THREE.ShaderMaterial({
    transparent:true,
    depthWrite:false,
    blending:THREE.AdditiveBlending,
    vertexColors:true,
    uniforms:{ uTime:{ value:0 } },
    vertexShader:`uniform float uTime; attribute float aSize; attribute float aPhase; varying vec3 vColor; void main(){ vColor = color; float puls = 1.0 + 0.18*sin(uTime*0.6 + aPhase); gl_PointSize = aSize * puls; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader:`varying vec3 vColor; void main(){ float d = length(gl_PointCoord - 0.5); if(d>0.5) discard; float fall = smoothstep(0.5,0.0,d); vec3 col = vColor * fall * 2.4; gl_FragColor = vec4(col, fall); }`
  });
  const clusterPoints = new THREE.Points(clusterGeo, clusterMat);

  const group = new THREE.Group();
  group.add(sphere, shellStars, clusterPoints);

  return {
    group,
    update:(time:number)=>{
      (uniforms.uTime as any).value = time;
      (clusterMat.uniforms.uTime as any).value = time;
      group.rotation.y = time * 0.00005;
    },
    dispose:()=>{
      group.remove(sphere); group.remove(shellStars); group.remove(clusterPoints);
      geom.dispose(); mat.dispose(); shellGeo.dispose(); shellMat.dispose(); clusterGeo.dispose(); clusterMat.dispose();
    }
  };
}

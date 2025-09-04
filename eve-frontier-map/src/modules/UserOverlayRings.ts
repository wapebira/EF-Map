import * as THREE from 'three';
import { userOverlayStore, getOverlayFilterColor, subscribeOverlayFilter } from '../utils/userOverlay';
import type { UserOverlayEntry } from '../utils/userOverlay';

export class UserOverlayRings {
  private group = new THREE.Group();
  private unsubscribe: (()=>void)|null = null;
  private unsubscribeFilter: (()=>void)|null = null;
  private disposed = false;
  private scene: THREE.Scene;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.PointsMaterial | null = null;
  private points: THREE.Points | null = null;
  private systemIds: number[] = [];
  private cyclePrevIdx: number[] = [];
  private lastBucket = -1;
  private mapData: any = null;
  private ringTexture: THREE.Texture;
  private baseSize: number;
  private suppressedSystemId: number | null = null;
  constructor(scene:THREE.Scene, ringTexture:THREE.Texture, size:number=20){
    this.scene = scene; this.ringTexture = ringTexture; this.baseSize = size;
    this.group.name='UserOverlayRings';
    this.scene.add(this.group);
    this.unsubscribe = userOverlayStore.subscribe(()=> this.rebuild());
    this.unsubscribeFilter = subscribeOverlayFilter(()=> this.rebuild());
    this.rebuild();
  }
  setMapData(mapData:any){ this.mapData = mapData; this.rebuild(); }
  setVisible(v:boolean){ this.group.visible = v; }
  setSuppressedSystem(systemId: number | null){
    if(this.suppressedSystemId === systemId) return;
    this.suppressedSystemId = systemId;
    this.rebuild();
  }
  private rebuild(){
    if(this.disposed) return;
    const entries = userOverlayStore.getEntries();
    const filter = getOverlayFilterColor();
    // bucket by system
    const bySystem = new Map<number, UserOverlayEntry[]>();
    for(const e of entries){
      if(filter && e.color!==filter) continue;
      if(this.suppressedSystemId != null && e.systemId === this.suppressedSystemId) continue; // skip suppressed system entirely
      if(!bySystem.has(e.systemId)) bySystem.set(e.systemId, []);
      bySystem.get(e.systemId)!.push(e);
    }
    this.systemIds = Array.from(bySystem.keys());
    // Sort marks in each system stable by updatedAt asc to stabilize cycle ordering
    const colorsPerSystem: string[][] = [];
    const systemPositions: number[] = [];
    for(const sysId of this.systemIds){
      const list = bySystem.get(sysId)!;
      list.sort((a,b)=> a.updatedAt - b.updatedAt);
      colorsPerSystem.push(list.map(m=> m.color));
      if(this.mapData){
        const sys:any = (this.mapData.solar_systems || {})[String(sysId)];
        if(sys){
          // Apply same axis transform as main star field (x, z, -y)
          const px = sys.position.x; const py = sys.position.z; const pz = sys.position.y * -1;
          systemPositions.push(px, py, pz);
        } else { systemPositions.push(0,0,0); }
      } else { systemPositions.push(0,0,0); }
    }
    // Create / update geometry
    if(this.points){ this.group.remove(this.points); this.points.geometry.dispose(); this.material?.dispose(); this.points = null; }
    if(!this.systemIds.length){ return; }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(systemPositions), 3));
    const colorArrayF = new Float32Array(this.systemIds.length * 3);
    // Init with first color (normalized floats 0..1)
    for(let i=0;i<this.systemIds.length;i++){
      const col = colorsPerSystem[i][0] || '#ffffff';
      const rgb = hexToRgb(col);
      colorArrayF[i*3]=rgb[0]/255; colorArrayF[i*3+1]=rgb[1]/255; colorArrayF[i*3+2]=rgb[2]/255;
    }
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorArrayF, 3));
  this.material = new THREE.PointsMaterial({ size:this.baseSize, sizeAttenuation:false, map:this.ringTexture, transparent:true, alphaTest:0.5, vertexColors:true });
    this.points = new THREE.Points(this.geometry, this.material);
    this.group.add(this.points);
    // Prepare cycle tracking
    this.cyclePrevIdx = new Array(this.systemIds.length).fill(-1);
    ;(this.points as any).userData.colorsPerSystem = colorsPerSystem;
  }
  update(nowMs:number){
  if(this.disposed || !this.points || !this.group.visible) return;
  // Constant pixel size (mirrors hover halo behavior)
    const geom = this.points.geometry as THREE.BufferGeometry;
    const colorsPerSystem: string[][] = (this.points as any).userData.colorsPerSystem || [];
    const bucket = Math.floor(nowMs / 200); // 200ms quantization to avoid per-frame churn
    if(bucket === this.lastBucket) return;
    this.lastBucket = bucket;
    const cyclePeriod = 2000; // ms
    const colorAttr:any = geom.getAttribute('color');
    let changed=false;
    for(let i=0;i<this.systemIds.length;i++){
      const list = colorsPerSystem[i];
      if(!list || list.length===0) continue;
      const idx = list.length===1? 0 : Math.floor((nowMs / cyclePeriod) % list.length);
      if(idx === this.cyclePrevIdx[i]) continue;
      this.cyclePrevIdx[i] = idx;
      const col = list[idx];
      const rgb = hexToRgb(col);
      // Float32 (0..1)
      colorAttr.setX(i, rgb[0]/255);
      colorAttr.setY(i, rgb[1]/255);
      colorAttr.setZ(i, rgb[2]/255);
      changed=true;
    }
    if(changed){ colorAttr.needsUpdate = true; }
  }
  dispose(){ if(this.disposed) return; this.disposed=true; if(this.unsubscribe) this.unsubscribe(); if(this.unsubscribeFilter) this.unsubscribeFilter(); this.scene.remove(this.group); if(this.points){ this.points.geometry.dispose(); this.material?.dispose(); } }
  // Debug helper: logs current per-system color lists and active attribute values
  debugLog(){
    try {
      if(!this.points) { console.log('[overlay] no points'); return; }
      const geom = this.points.geometry as THREE.BufferGeometry;
      const attr:any = geom.getAttribute('color');
      const per = (this.points as any).userData.colorsPerSystem;
      console.log('[overlay-debug] systems=', this.systemIds, 'colorsPerSystem=', per, 'attributeSample=', Array.from({length: Math.min(5, attr.count)}, (_,i)=> [attr.getX(i), attr.getY(i), attr.getZ(i)]));
    } catch(e){ console.warn('[overlay-debug] failed', e); }
  }
}

function hexToRgb(hex:string): [number,number,number]{
  if(!hex) return [255,255,255];
  if(hex[0]==='#') hex = hex.slice(1);
  // Support 3-digit shorthand (#rgb)
  if(hex.length===3){
    hex = hex.split('').map(ch=> ch+ch).join('');
  }
  // If still not 6, fallback
  if(hex.length!==6){ return [255,255,255]; }
  const num = Number.parseInt(hex,16);
  if(Number.isNaN(num)) return [255,255,255];
  return [(num>>16)&255, (num>>8)&255, num&255];
}


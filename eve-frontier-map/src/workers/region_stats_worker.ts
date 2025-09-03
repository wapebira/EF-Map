// Region Stats Worker (Phase 2)
// Computes per‑region network + spatial + resource summary metrics off main thread.
// Message Protocol:
//   Incoming: { type: 'compute', systems: SystemLite[], gates: GateLite[] }
//   Outgoing: { type:'result', regions: Record<regionId, RegionStats> }
// SystemLite minimal shape now includes planets for planet aggregation.
// Metric Naming (human‑friendly intent):
//   gate_links: internal stargate edges (previously gates_total)
//   avg_gate_distance_ly: average gate edge length
//   footprint_area_ly2: convex hull area (x,z projection)
//   system_density_per_100_ly2: systems per 100 square light‑years (scaled for readability)
//   connectivity_pct: (gated / total)*100 (0 if total=0)
//   (Simplified set exposed to UI now)
//   est_gated_distance_ly: MST lower bound distance through gated systems
//   est_gated_gate_jumps: gate hops across gated systems (n_gated - 1)
//   est_all_distance_ly: gated distance + isolated attachments distance
//   all_gate_jumps: gate hops portion within all systems (lower bound)
//   ship_jumps: count of ship jumps (isolated attachments) lower bound
//   ship_jump_ly: sum of isolated attachment distances
//   total_jumps: gate + ship (lower bound)
//   total_planets: sum(planets)
//   avg_planets_per_system: total_planets / systems_total
//   avg_gate_degree: (2*gate_links)/systems_gated (0 if systems_gated=0)

export interface SystemLite {
  id: number;
  region_id: number;
  x: number; y: number; z: number;
  deg: number; // gate degree (can be 0)
  planets?: number; // optional planet count
  has_station?: boolean; // optional station presence flag
}
export interface GateLite {
  a: number; b: number; len: number; // len already in LY units
}

interface RegionStats {
  systems_total: number;
  systems_gated: number;
  systems_isolated: number;
  connectivity_pct: number;
  gate_links: number;
  avg_gate_distance_ly: number;
  avg_gate_degree: number;
  footprint_area_ly2: number;
  system_density_per_100_ly2: number;
  // Simplified coverage metrics (approximate – baseline style placeholders)
  est_gated_distance_ly: number;   // Approx gated traversal distance (MST lower bound for now)
  est_gated_gate_jumps: number;    // Gate hops across gated systems (n_gated - 1 as lower bound)
  est_all_distance_ly: number;     // Gated distance + attachments for isolated systems
  all_gate_jumps: number;          // Gate jumps portion within all systems (>= est_gated_gate_jumps)
  ship_jumps: number;              // Ship jump count (attachments treated as single ship jumps)
  ship_jump_ly: number;            // Sum of ship jump distances (attachments sum)
  total_jumps: number;             // all_gate_jumps + ship_jumps (lower bound)
  min_jump_range_ly: number;       // Minimum ship jump range required to connect components
  total_planets: number;
  avg_planets_per_system: number;
  has_station: boolean; // any station present in region
}

type Incoming = { type:'compute'; systems: SystemLite[]; gates: GateLite[] };
type Outgoing = { type:'result'; regions: Record<number, RegionStats> };

// --- Geometry Helpers ---
function convexHullArea(points: [number, number][]): number {
  // Monotonic chain; returns area of hull polygon. Degenerate -> area 0.
  if (points.length < 3) return 0;
  const pts = points.slice().sort((a,b)=> a[0]===b[0]? a[1]-b[1] : a[0]-b[0]);
  const cross = (o:[number,number], a:[number,number], b:[number,number]) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const lower: [number,number][] = [];
  for (const p of pts) {
    while (lower.length>=2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number,number][] = [];
  for (let i=pts.length-1;i>=0;i--) {
    const p = pts[i];
    while (upper.length>=2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  const hull = lower.concat(upper);
  if (hull.length < 3) return 0;
  let area = 0;
  for (let i=0;i<hull.length;i++) {
    const [x1,y1] = hull[i];
    const [x2,y2] = hull[(i+1)%hull.length];
    area += x1*y2 - x2*y1;
  }
  return Math.abs(area)/2;
}


// Group systems by region.
function computeRegionStats(systems:SystemLite[], gates:GateLite[]): Record<number, RegionStats> {
  const byRegion = new Map<number, SystemLite[]>();
  for (const s of systems) {
    if (!byRegion.has(s.region_id)) byRegion.set(s.region_id, []);
    byRegion.get(s.region_id)!.push(s);
  }
  // Build adjacency for MST over gated systems; we rely on gates list for lengths.
  const gatesByRegion = new Map<number, GateLite[]>();
  // Build quick map id->region for gate region filtering
  const systemRegion = new Map<number, number>();
  for (const [rid, list] of byRegion) {
    for (const s of list) systemRegion.set(s.id, rid);
  }
  for (const g of gates) {
    const ra = systemRegion.get(g.a); const rb = systemRegion.get(g.b);
    if (ra!==undefined && rb!==undefined && ra===rb) {
      if (!gatesByRegion.has(ra)) gatesByRegion.set(ra, []);
      gatesByRegion.get(ra)!.push(g);
    }
  }

  const result: Record<number, RegionStats> = {};
  for (const [rid, list] of byRegion) {
    const systems_total = list.length;
    const gatedIds: number[] = []; const idSet = new Set<number>();
    let total_planets = 0;
    for (const s of list) { idSet.add(s.id); if (s.deg>0) gatedIds.push(s.id); if (s.planets) total_planets += s.planets; }
    const systems_gated = gatedIds.length;
    const systems_isolated = systems_total - systems_gated;
    const regionGates = gatesByRegion.get(rid) || [];
    const gate_links = regionGates.length;
    const avg_gate_distance_ly = gate_links ? regionGates.reduce((a,g)=>a+g.len,0)/gate_links : 0;
    // Area & density scaling (per 100 ly^2)
    const points: [number,number][] = list.map(s=> [s.x, s.z]);
    const footprint_area_ly2 = convexHullArea(points);
    const system_density_per_100_ly2 = footprint_area_ly2>0 ? (systems_total / footprint_area_ly2)*100 : 0;
    const connectivity_pct = systems_total>0 ? (systems_gated / systems_total)*100 : 0;
    const avg_gate_degree = systems_gated>0 ? (2*gate_links)/systems_gated : 0;

    // --- Baseline style distance & jump metrics (nearest-neighbor heuristic) ---
    // Build gate adjacency for BFS path discovery
    const gateAdj = new Map<number, number[]>();
    for (const g of regionGates){
      if(!gateAdj.has(g.a)) gateAdj.set(g.a, []); gateAdj.get(g.a)!.push(g.b);
      if(!gateAdj.has(g.b)) gateAdj.set(g.b, []); gateAdj.get(g.b)!.push(g.a);
    }
    interface EdgeEval { gateDistance:number|null; gateHops:number|null; shipDistance:number; chooseShip:boolean }
    const dist3d = (a:SystemLite,b:SystemLite)=>{ const dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z; return Math.sqrt(dx*dx+dy*dy+dz*dz); };
    // BFS gate path; returns distance & hops or null if disconnected
    const bfsGate = (a:SystemLite,b:SystemLite): {d:number;h:number}|null => {
      if(a.id===b.id) return {d:0,h:0};
      const q:number[][]=[[a.id]]; const seen=new Set<number>([a.id]);
      while(q.length){ const path=q.shift()!; const last=path[path.length-1]; if(last===b.id){
        let total=0; for(let i=0;i<path.length-1;i++){ const n1=path[i], n2=path[i+1]; const s1=list.find(x=>x.id===n1)!; const s2=list.find(x=>x.id===n2)!; total+=dist3d(s1,s2); }
        return { d: total, h: path.length-1 };
      }
        for(const nxt of gateAdj.get(last)||[]){ if(!seen.has(nxt)){ seen.add(nxt); q.push([...path,nxt]); } }
      }
      return null;
    };
    const edgeCache = new Map<string, EdgeEval>();
    const evalEdge = (a:SystemLite,b:SystemLite): EdgeEval => {
      const key = a.id<b.id? a.id+"|"+b.id : b.id+"|"+a.id;
      const cached = edgeCache.get(key); if(cached) return cached;
      const gateInfo = bfsGate(a,b);
      if(gateInfo){ const ev={ gateDistance: gateInfo.d, gateHops: gateInfo.h, shipDistance: dist3d(a,b), chooseShip:false }; edgeCache.set(key,ev); return ev; }
      // No gate path – treat as ship jump
      const shipD = dist3d(a,b);
      const ev={ gateDistance:null, gateHops:null, shipDistance: shipD, chooseShip:true };
      edgeCache.set(key, ev); return ev;
    };
    interface PathStats { distance:number; gateJumps:number; shipJumps:number; shipDistance:number }
    const nearestNeighborRoute = (systemsList:SystemLite[]): PathStats => {
      if(systemsList.length<=1) return { distance:0, gateJumps:0, shipJumps:0, shipDistance:0 };
      // pick start = highest gate degree else first
      let start = systemsList[0];
      for(const s of systemsList){ if(s.deg > start.deg) start = s; }
      const remaining = new Set(systemsList.filter(s=> s.id!==start.id).map(s=> s.id));
      let cur = start; let distance=0, gateJumps=0, shipJumps=0, shipDistance=0;
      while(remaining.size){
        let best: { sys:SystemLite; ev:EdgeEval } | null = null;
        for(const id of remaining){ const candidate = systemsList.find(s=> s.id===id)!; const ev = evalEdge(cur, candidate); if(!best){ best={sys:candidate, ev}; continue; }
          const b=best.ev;
          // Priority: prefer gate over ship, then lower total distance
          const better = (!ev.chooseShip && b.chooseShip) ||
            (ev.chooseShip===b.chooseShip && ((ev.chooseShip? ev.shipDistance : ev.gateDistance!) < (b.chooseShip? b.shipDistance : b.gateDistance!)));
          if(better) best={sys:candidate, ev};
        }
        if(!best){ break; }
        // apply edge
        if(best.ev.chooseShip){ distance += best.ev.shipDistance; shipDistance += best.ev.shipDistance; shipJumps += 1; }
        else { distance += best.ev.gateDistance!; gateJumps += best.ev.gateHops!; }
        remaining.delete(best.sys.id); cur = best.sys;
      }
      return { distance, gateJumps, shipJumps, shipDistance };
    };
    // Gated subset baseline
    let est_gated_distance_ly = 0; let est_gated_gate_jumps = 0;
    if(systems_gated>0){
      const gatedSystems = list.filter(s=> s.deg>0);
      const gatedStats = nearestNeighborRoute(gatedSystems);
      est_gated_distance_ly = gatedStats.distance;
      est_gated_gate_jumps = gatedStats.gateJumps; // gate hops across route
    }
    // All systems baseline (includes isolated ship jumps)
    let est_all_distance_final = 0; let all_gate_jumps = 0; let ship_jumps = 0; let ship_jump_ly = 0;
    if(systems_total>0){
      const allStats = nearestNeighborRoute(list);
      est_all_distance_final = allStats.distance;
      all_gate_jumps = allStats.gateJumps;
      ship_jumps = allStats.shipJumps;
      ship_jump_ly = allStats.shipDistance;
    }
    const total_jumps = all_gate_jumps + ship_jumps;

    // Min jump range: union gate components then add shortest ship edges to connect components
  let min_jump_range_ly = 0;
    if (systems_total>1){
      // Union-Find initial via gates (build adjacency from regionGates)
      const parent = new Map<number, number>(); const rank = new Map<number, number>();
      for (const s of list){ parent.set(s.id, s.id); rank.set(s.id,0);} const find=(x:number):number=>{ const p=parent.get(x)!; if(p!==x){ const r=find(p); parent.set(x,r); return r;} return p; }; const union=(a:number,b:number)=>{ let ra=find(a), rb=find(b); if(ra===rb) return false; let rka=rank.get(ra)!, rkb=rank.get(rb)!; if(rka<rkb) parent.set(ra,rb); else if(rkb<rka) parent.set(rb,ra); else { parent.set(rb,ra); rank.set(ra,rka+1);} return true; };
      for (const gEdge of regionGates){ union(gEdge.a, gEdge.b); }
      // Count components
      const compSet = new Set(list.map(s=> find(s.id)));
      if (compSet.size>1){
        // Generate all candidate ship edges across different components
        const candidates: {a:number;b:number;len:number}[] = [];
        for (let i=0;i<list.length;i++){
          for (let j=i+1;j<list.length;j++){
            const si=list[i], sj=list[j]; if(find(si.id)===find(sj.id)) continue;
            const dx=si.x - sj.x, dy=si.y - sj.y, dz=si.z - sj.z; const d=Math.sqrt(dx*dx+dy*dy+dz*dz);
            candidates.push({a:si.id,b:sj.id,len:d});
          }
        }
        candidates.sort((a,b)=> a.len - b.len);
        for (const c of candidates){ if(union(c.a,c.b)){ min_jump_range_ly = c.len; if (compSet.size===1) break; } }
      } else {
        min_jump_range_ly = 0; // already fully reachable via gates
      }
    }

    const avg_planets_per_system = systems_total>0 ? total_planets / systems_total : 0;
  let has_station = false; for(const s of list){ if(s.has_station){ has_station = true; break; } }

    result[rid] = {
      systems_total,
      systems_gated,
      systems_isolated,
      connectivity_pct,
      gate_links,
      avg_gate_distance_ly,
      avg_gate_degree,
      footprint_area_ly2,
      system_density_per_100_ly2,
      est_gated_distance_ly,
      est_gated_gate_jumps,
      est_all_distance_ly: est_all_distance_final,
      all_gate_jumps,
      ship_jumps,
      ship_jump_ly,
      total_jumps,
      min_jump_range_ly,
      total_planets,
  avg_planets_per_system,
  has_station
    } as RegionStats;
  }
  return result;
}

// Worker listener
self.onmessage = function(e: MessageEvent<Incoming>) {
  const msg = e.data;
  if (msg.type === 'compute') {
    try {
      const regions = computeRegionStats(msg.systems, msg.gates);
      const out: Outgoing = { type:'result', regions };
      // @ts-ignore
      self.postMessage(out);
    } catch (err:any) {
      // Fail silently with empty result to avoid blocking UI.
      const out: Outgoing = { type:'result', regions:{} };
      // @ts-ignore
      self.postMessage(out);
    }
  }
};

export {}; // treat as module

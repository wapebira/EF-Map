// Region Stats Worker
// Computes per-region spatial + network metrics off main thread.
// Message Protocol:
// Incoming: { type: 'compute', systems: Array<SystemLite>, gates: Array<GateLite> }
// SystemLite: { id:number, region_id:number, x:number, y:number, z:number, deg:number }
// GateLite: { a:number, b:number, len:number, region_id:number } (region_id only if both endpoints share one)
// Outgoing: { type:'result', regions: { [regionId:number]: RegionStats } }
// RegionStats fields (Phase 1):
// systems_total, systems_gated, systems_isolated, gates_total, avg_gate_length_ly,
// hull_area, density_systems_per_area, mst_length_gated_ly, mst_length_all_ly, max_span_edge_ly

export interface SystemLite {
  id: number;
  region_id: number;
  x: number; y: number; z: number;
  deg: number; // gate degree (can be 0)
}
export interface GateLite {
  a: number; b: number; len: number; // len already in LY units
}

interface RegionStats {
  systems_total: number;
  systems_gated: number;
  systems_isolated: number;
  gates_total: number;
  avg_gate_length_ly: number;
  hull_area: number; // planar area using projection (x,z)
  density_systems_per_area: number;
  mst_length_gated_ly: number;
  mst_length_all_ly: number;
  max_span_edge_ly: number;
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

// --- MST (Kruskal) ---
function mstTotalLength(nodes: number[], edges: {a:number,b:number,len:number}[]): { total:number, maxEdge:number } {
  if (nodes.length === 0) return { total:0, maxEdge:0 };
  // Union Find
  const parent = new Map<number, number>();
  const rank = new Map<number, number>();
  for (const n of nodes) { parent.set(n,n); rank.set(n,0); }
  const find = (x:number):number => {
    const p = parent.get(x)!; if (p!==x){ const r=find(p); parent.set(x,r); return r;} return p;
  };
  const union = (a:number,b:number):boolean => {
    let ra=find(a), rb=find(b); if(ra===rb) return false; let rka=rank.get(ra)!, rkb=rank.get(rb)!;
    if (rka<rkb) parent.set(ra,rb); else if (rkb<rka) parent.set(rb,ra); else { parent.set(rb,ra); rank.set(ra,rka+1);} return true;
  };
  const sorted = edges.slice().sort((e1,e2)=> e1.len - e2.len);
  let total=0; let added=0; let maxEdge=0; const need = nodes.length-1;
  for (const e of sorted) {
    if (union(e.a,e.b)) { total += e.len; added++; if (e.len>maxEdge) maxEdge=e.len; if (added===need) break; }
  }
  return { total, maxEdge };
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
    const gatedIds: number[] = []; const allIds: number[] = []; const idSet = new Set<number>();
    for (const s of list) { allIds.push(s.id); idSet.add(s.id); if (s.deg>0) gatedIds.push(s.id); }
    const systems_gated = gatedIds.length;
    const systems_isolated = systems_total - systems_gated;
    const regionGates = gatesByRegion.get(rid) || [];
    const gates_total = regionGates.length;
    const avg_gate_length_ly = gates_total ? regionGates.reduce((a,g)=>a+g.len,0)/gates_total : 0;
    // Hull area (project x,z)
    const points: [number,number][] = list.map(s=> [s.x, s.z]);
    const hull_area = convexHullArea(points);
    const density_systems_per_area = hull_area>0 ? systems_total / hull_area : 0;
    // MST over gated systems: build edges subset
    let mst_length_gated_ly = 0; let max_gate_span=0;
    if (gatedIds.length>1) {
      const edges = regionGates.filter(g=> idSet.has(g.a) && idSet.has(g.b));
      const { total, maxEdge } = mstTotalLength(gatedIds, edges);
      mst_length_gated_ly = total; max_gate_span = maxEdge;
    }
    // MST over all systems: approximate connectivity by adding synthetic edges? We'll reuse regionGates only; isolated systems (deg=0) treated as singletons (no edges). For a better bound we could compute complete graph MST (O(n^2)); we skip for performance.
    let mst_length_all_ly = mst_length_gated_ly; let max_span_edge_ly = max_gate_span;
    // Optional enhancement: if many isolated nodes, estimate additional ship jump edges to connect them by nearest neighbor:
    if (systems_isolated>0 && systems_total>1) {
      // Connect isolated systems to nearest gated or isolated; greedy add.
      const isolated = list.filter(s=> s.deg===0);
      const active: SystemLite[] = list.filter(s=> s.deg>0);
      if (active.length===0 && isolated.length>0) { active.push(isolated[0]); }
      for (const iso of isolated) {
        let bestDist = Infinity;
        for (const a of active) {
          const dx = iso.x - a.x, dz = iso.z - a.z, dy = iso.y - a.y;
            const d = Math.sqrt(dx*dx+dy*dy+dz*dz);
            if (d<bestDist) { bestDist=d; }
        }
        mst_length_all_ly += bestDist;
        if (bestDist>max_span_edge_ly) max_span_edge_ly = bestDist;
        active.push(iso);
      }
    }
    result[rid] = {
      systems_total,
      systems_gated,
      systems_isolated,
      gates_total,
      avg_gate_length_ly,
      hull_area,
      density_systems_per_area,
      mst_length_gated_ly,
      mst_length_all_ly,
      max_span_edge_ly
    };
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

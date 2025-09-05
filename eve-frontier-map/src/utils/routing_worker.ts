// Single clean routing worker with A* and Dijkstra

interface Position { x: number; y: number; z: number }
interface SolarSystem { id: number; name: string; position: Position }
interface Stargate { source_system_id: number; destination_system_id: number }

interface RoutingRequest {
  systems: { [key: string]: SolarSystem };
  stargates: { [key: string]: Stargate };
  fromSystemName: string;
  toSystemName: string;
  maxJumpDistance: number;
  optimizeFor: 'fuel' | 'jumps' | 'explore';
  algorithm?: 'astar' | 'dijkstra';
  avoidSystemNames?: string[]; // optional list of systems to exclude
  overheadPct?: number; // only for explore: allowed overhead percent (e.g., 30 = 30%)
  // Explore tuning (optional)
  exploreCorridorPct?: number; // width as % of AB length (default 18)
  exploreProgressBiasPct?: number; // 0..100, higher prefers later detours (default 50)
}

interface ExploreMeta {
  baselineCost: number;
  finalCost: number;
  baselineNodes: number;
  finalNodes: number;
}

interface RoutingResponse { path: string[] | null; error?: string; minRequiredShipRange?: number; meta?: ExploreMeta }

// Simple PQ for A*
class PriorityQueue<T> {
  private elements: { item: T; priority: number }[] = [];

  enqueue(item: T, priority: number) {
    this.elements.push({ item, priority });
    this.elements.sort((a, b) => a.priority - b.priority);
  }

  dequeue(): T | undefined {
    return this.elements.shift()?.item;
  }

  isEmpty(): boolean {
    return this.elements.length === 0;
  }
  size(): number {
    return this.elements.length;
  }
}

// Helpers
const heuristic = (a: SolarSystem, b: SolarSystem): number => {
  return Math.sqrt(
    Math.pow(a.position.x - b.position.x, 2) +
    Math.pow(a.position.y - b.position.y, 2) +
    Math.pow(a.position.z - b.position.z, 2)
  );
};

const reconstructPath = (cameFrom: { [key: number]: number }, current: SolarSystem, systemsById: { [id: number]: SolarSystem }): string[] => {
  const totalPath = [current.name];
  let curr = current.id;
  while (cameFrom[curr] !== undefined) {
    curr = cameFrom[curr];
    totalPath.unshift(systemsById[curr].name);
  }
  return totalPath;
};
// Spatial grid and neighbor cache to speed up neighbor queries.
const spatialGrids: Map<number, Map<string, SolarSystem[]>> = new Map();
const neighborCache: Map<string, { system: SolarSystem; cost: number }[]> = new Map();

const buildGrid = (cellSize: number, allSystems: SolarSystem[]) => {
  const grid = new Map<string, SolarSystem[]>();
  for (const s of allSystems) {
    const ix = Math.floor(s.position.x / cellSize);
    const iy = Math.floor(s.position.y / cellSize);
    const iz = Math.floor(s.position.z / cellSize);
    const key = `${ix},${iy},${iz}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(s);
  }
  return grid;
};

const getCandidatesFromGrid = (system: SolarSystem, grid: Map<string, SolarSystem[]>, cellSize: number, maxJumpDist: number) => {
  const candidates: SolarSystem[] = [];
  const r = Math.ceil(maxJumpDist / cellSize);
  const ix = Math.floor(system.position.x / cellSize);
  const iy = Math.floor(system.position.y / cellSize);
  const iz = Math.floor(system.position.z / cellSize);
  const seen = new Set<number>();
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const key = `${ix + dx},${iy + dy},${iz + dz}`;
        const bucket = grid.get(key);
        if (!bucket) continue;
        for (const s of bucket) {
          if (s.id === system.id) continue;
          if (!seen.has(s.id)) {
            seen.add(s.id);
            const d = heuristic(system, s);
            if (d <= maxJumpDist) candidates.push(s);
          }
        }
      }
    }
  }
  return candidates;
};

const getNeighbors = (
  system: SolarSystem,
  allSystems: SolarSystem[],
  stargates: { [key: string]: Stargate },
  maxJumpDist: number,
  optimizeFor: 'fuel' | 'jumps' | 'explore',
  systemsById: { [id: number]: SolarSystem }
): { system: SolarSystem; cost: number }[] => {
  const cacheKey = `${system.id}:${Math.max(1, Math.floor(maxJumpDist))}:${optimizeFor}`;
  if (neighborCache.has(cacheKey)) return neighborCache.get(cacheKey)!;

  const neighbors: { system: SolarSystem; cost: number }[] = [];

  // Choose a reasonable cell size. Use the requested maxJumpDist to keep neighbor buckets small.
  const cellSize = Math.max(1, Math.floor(maxJumpDist));

  // Build or reuse a grid for this cellSize
  let grid = spatialGrids.get(cellSize);
  if (!grid) {
    grid = buildGrid(cellSize, allSystems);
    spatialGrids.set(cellSize, grid);
  }

  if (optimizeFor === 'jumps') {
    const candidates = getCandidatesFromGrid(system, grid, cellSize, maxJumpDist);
    for (const otherSystem of candidates) {
      neighbors.push({ system: otherSystem, cost: 1 });
    }
    neighborCache.set(cacheKey, neighbors);
    return neighbors;
  }

  if (optimizeFor === 'fuel' || optimizeFor === 'explore') {
    // Add stargate connections (these are typically sparse)
    for (const gate of Object.values(stargates)) {
      if (gate.source_system_id === system.id) {
        const destSystem = systemsById[gate.destination_system_id];
        if (destSystem) {
          neighbors.push({ system: destSystem, cost: 1 });
        }
      }
    }

    // Add nearby ship jumps using the spatial grid
    const candidates = getCandidatesFromGrid(system, grid, cellSize, maxJumpDist);
    for (const otherSystem of candidates) {
      neighbors.push({ system: otherSystem, cost: 100 });
    }
  }

  neighborCache.set(cacheKey, neighbors);
  return neighbors;
};

// --- Explore enrichment helper ---
const enrichPath = (
  basePath: string[],
  systems: { [k:string]: SolarSystem },
  stargates: { [k:string]: Stargate },
  systemsByName: { [name:string]: SolarSystem },
  startNode: SolarSystem,
  endNode: SolarSystem,
  overheadPct: number,
    avoidSet: Set<string>,
    opts?: { corridorFactor?: number; progressBias?: number }
): { path: string[]; meta: ExploreMeta } => {
  const gateEdge = (a:SolarSystem,b:SolarSystem)=> Object.values(stargates).some(g => (g.source_system_id===a.id && g.destination_system_id===b.id) || (g.source_system_id===b.id && g.destination_system_id===a.id));
  let baselineCost = 0;
  for(let i=0;i<basePath.length-1;i++){ const A = systemsByName[basePath[i].toLowerCase()]; const B = systemsByName[basePath[i+1].toLowerCase()]; if(!A||!B) continue; baselineCost += gateEdge(A,B)?0:heuristic(A,B); }
  const budget = baselineCost * (1 + Math.max(0, overheadPct)/100);
  let currentCost = baselineCost;
  let enrichedPath = [...basePath];
  // Precompute vector start->end for corridor
  const startPos = startNode.position; const endPos = endNode.position;
  const ab = { x:endPos.x-startPos.x, y:endPos.y-startPos.y, z:endPos.z-startPos.z };
  const abLen = Math.sqrt(ab.x*ab.x + ab.y*ab.y + ab.z*ab.z) || 1;
  const abLen2 = abLen*abLen;
    const corridorFactor = Math.max(0.02, Math.min(0.6, opts?.corridorFactor ?? 0.18));
    const lateralThreshold = abLen * corridorFactor; // tunable width factor
  const lateralThreshold2 = lateralThreshold*lateralThreshold;
  const systemsList = Object.values(systems);
  const used = new Set(enrichedPath.map(n=> n.toLowerCase()));
  // distance^2 to AB line segment
  const dist2ToLine = (p:Position) => {
    const apx = p.x - startPos.x, apy = p.y - startPos.y, apz = p.z - startPos.z;
    const t = Math.max(0, Math.min(1, (apx*ab.x + apy*ab.y + apz*ab.z)/abLen2));
    const projx = startPos.x + ab.x*t, projy = startPos.y + ab.y*t, projz = startPos.z + ab.z*t;
    const dx = p.x - projx, dy = p.y - projy, dz = p.z - projz; return dx*dx+dy*dy+dz*dz;
  };
  // Pre-filter corridor candidates not in avoid list and not already used
  const candidateSystems = systemsList.filter(s => !used.has(s.name.toLowerCase()) && !avoidSet.has(s.name.toLowerCase()) && dist2ToLine(s.position) <= lateralThreshold2);
  const sysLower = (n:string)=> systemsByName[n.toLowerCase()];
  // Global forward-progress guard along AB: require each insert to advance a running minimum t
  // Start near 0 (2% along the route) and increase after each accepted insert to prevent early clustering
  let minGlobalT = 0.02;
  const progressBias = Math.max(0, Math.min(1, opts?.progressBias ?? 0.5));
  const minStepT = 0.005 + 0.025 * progressBias; // 0.5%..3.0% per accepted insert
  // Rotating segment scan start to distribute inserts across the path
  let sweep = 0;
  let attempts = 0; const MAX_ATTEMPTS = 800; let improved = true;
  while(improved && attempts < MAX_ATTEMPTS){
    improved = false; attempts++;
    const segCount = Math.max(0, enrichedPath.length-1);
    const startIdx = segCount>0 ? (sweep % segCount) : 0;
    for(let s=0;s<segCount && attempts<MAX_ATTEMPTS;s++){
      const i = (startIdx + s) % segCount;
      const AName = enrichedPath[i]; const BName = enrichedPath[i+1];
      const A = sysLower(AName); const B = sysLower(BName); if(!A||!B) continue;
      const baseSegCost = gateEdge(A,B)?0:heuristic(A,B);
      const segVec = { x:B.position.x-A.position.x, y:B.position.y-A.position.y, z:B.position.z-A.position.z };
      const segLen2 = segVec.x*segVec.x + segVec.y*segVec.y + segVec.z*segVec.z || 1;
      interface InsertCandidate { name:string; addedCost:number; score:number; tGlobal:number }
      let bestInsert: InsertCandidate | null = null;
      for(const cand of candidateSystems){
        if(used.has(cand.name.toLowerCase())) continue;
        const acx = cand.position.x - A.position.x, acy=cand.position.y - A.position.y, acz=cand.position.z - A.position.z;
        const tSeg = (acx*segVec.x + acy*segVec.y + acz*segVec.z)/segLen2;
        if(tSeg <= 0.12 || tSeg >= 0.88) continue;
        // Global projection t along AB for forward progress enforcement
        const apx = cand.position.x - startPos.x, apy = cand.position.y - startPos.y, apz = cand.position.z - startPos.z;
        const tGlobal = Math.max(0, Math.min(1, (apx*ab.x + apy*ab.y + apz*ab.z)/abLen2));
        if(tGlobal + 1e-6 < minGlobalT + minStepT) continue; // does not advance global progress sufficiently
        const costAC = gateEdge(A,cand)?0:heuristic(A,cand);
        const costCB = gateEdge(cand,B)?0:heuristic(cand,B);
        const newSegCost = costAC + costCB;
        const added = newSegCost - baseSegCost;
        if(added <= 0) continue;
        const newTotal = currentCost + added;
        if(newTotal > budget) continue;
        const balance = 1 - Math.abs(tSeg - 0.5)*2;
        // Progress-weighted scoring prefers candidates further along AB without ignoring balance/cost
  const progressWeight = 0.3 + 0.7 * progressBias; // 0.3..1.0
  const progressBoost = Math.min(1.5, 0.5 + progressWeight * tGlobal); // ~0.5..1.5 multiplier
        const score = (balance * progressBoost) / (added + 1e-6);
        if(!bestInsert || score > bestInsert.score){ bestInsert = { name:cand.name, addedCost: added, score, tGlobal }; }
      }
      if(bestInsert){
        enrichedPath.splice(i+1,0,bestInsert.name);
        used.add(bestInsert.name.toLowerCase());
        currentCost += bestInsert.addedCost;
        // Raise the global min t to the accepted candidate's t (minus a small margin)
        minGlobalT = Math.max(minGlobalT, Math.min(1, bestInsert.tGlobal));
        improved = true; attempts++;
        try { (self as any).postMessage({ type:'progress', explored: attempts, frontier: enrichedPath.length, elapsedMs: Date.now(), message:`Enriched +1 (${enrichedPath.length} systems, ${Math.floor((currentCost/baselineCost-1)*100)}% overhead)` }); } catch {}
      }
      if(currentCost > budget*0.995) break;
    }
    sweep++;
  }
  return { path: enrichedPath, meta: { baselineCost, finalCost: currentCost, baselineNodes: basePath.length, finalNodes: enrichedPath.length } };
};

// --- A* (basic) ---
// Fast existence probe using spatial grid + BFS (gates + ship jumps up to threshold).
const existsPathWithin = (
  systems: { [k:string]: SolarSystem },
  stargates: { [k:string]: Stargate },
  from: SolarSystem,
  to: SolarSystem,
  maxJump: number,
  systemsById: { [id:number]: SolarSystem }
): boolean => {
  if(from.id === to.id) return true;
  const allSystems = Object.values(systems);
  const cellSize = Math.max(1, Math.floor(maxJump));
  let grid = spatialGrids.get(cellSize);
  if(!grid){
    grid = buildGrid(cellSize, allSystems);
    spatialGrids.set(cellSize, grid);
  }
  const visited = new Set<number>();
  const q:number[] = [from.id];
  visited.add(from.id);
  const gateAdjLocal = new Map<number, number[]>();
  for(const g of Object.values(stargates)){
    if(!gateAdjLocal.has(g.source_system_id)) gateAdjLocal.set(g.source_system_id, []);
    if(!gateAdjLocal.has(g.destination_system_id)) gateAdjLocal.set(g.destination_system_id, []);
    gateAdjLocal.get(g.source_system_id)!.push(g.destination_system_id);
    gateAdjLocal.get(g.destination_system_id)!.push(g.source_system_id);
  }
  while(q.length){
    const curId = q.shift()!;
    if(curId === to.id) return true;
    for(const ng of gateAdjLocal.get(curId)||[]){
      if(!visited.has(ng)){ visited.add(ng); q.push(ng); if(ng===to.id) return true; }
    }
    const cur = systemsById[curId]; if(!cur) continue;
    const ix = Math.floor(cur.position.x / cellSize);
    const iy = Math.floor(cur.position.y / cellSize);
    const iz = Math.floor(cur.position.z / cellSize);
    const r = Math.ceil(maxJump / cellSize);
    for(let dx=-r; dx<=r; dx++){
      for(let dy=-r; dy<=r; dy++){
        for(let dz=-r; dz<=r; dz++){
          const bucket = grid!.get(`${ix+dx},${iy+dy},${iz+dz}`);
          if(!bucket) continue;
          for(const cand of bucket){
            if(cand.id === curId || visited.has(cand.id)) continue;
            const d = heuristic(cur, cand);
            if(d <= maxJump){ visited.add(cand.id); q.push(cand.id); if(cand.id===to.id) return true; }
          }
        }
      }
    }
  }
  return false;
};

// --- A* (basic) ---
const findPathAstar = (request: RoutingRequest): RoutingResponse => {
  const { systems, stargates, fromSystemName, toSystemName, maxJumpDistance, optimizeFor, avoidSystemNames } = request;

  const systemsByName: { [name: string]: SolarSystem } = {};
  const systemsById: { [id: number]: SolarSystem } = {};
  for (const sys of Object.values(systems)) {
    systemsByName[sys.name.toLowerCase()] = sys;
    systemsById[sys.id] = sys;
  }

  const startNode = systemsByName[fromSystemName.toLowerCase()];
  const endNode = systemsByName[toSystemName.toLowerCase()];

  if (!startNode) return { path: null, error: `Start system "${fromSystemName}" not found.` };
  if (!endNode) return { path: null, error: `End system "${toSystemName}" not found.` };

  const openSet = new PriorityQueue<SolarSystem>();
  openSet.enqueue(startNode, 0);

  const cameFrom: { [key: number]: number } = {};
  const gScore: { [key: number]: number } = {};
  gScore[startNode.id] = 0;

  const fScore: { [key: number]: number } = {};
  fScore[startNode.id] = heuristic(startNode, endNode);

  const allSystemsList = Object.values(systems);
  const avoidSet = new Set<string>((avoidSystemNames||[]).map(n=> n.toLowerCase()).filter(n=> n!==fromSystemName.toLowerCase() && n!==toSystemName.toLowerCase()));

  const startTime = Date.now();
  let lastEmit = 0;
  let exploredCount = 0;

  while (!openSet.isEmpty()) {
    const current = openSet.dequeue()!;
    exploredCount++;

    if (current.id === endNode.id) {
      const basePath = reconstructPath(cameFrom, current, systemsById);
      if(optimizeFor !== 'explore') return { path: basePath };
      try { (self as any).postMessage({ type:'progress', explored: basePath.length, frontier: 0, elapsedMs: Date.now(), message:'Baseline path found – enriching (Explore mode)' }); } catch {}
      try {
        const overhead = typeof request.overheadPct === 'number' ? request.overheadPct : 30;
        const avoidSet2 = new Set<string>((avoidSystemNames||[]).map(n=> n.toLowerCase()));
        const opts = {
          corridorFactor: ((request.exploreCorridorPct ?? 18) / 100),
          progressBias: ((request.exploreProgressBiasPct ?? 50) / 100),
        };
        const { path, meta } = enrichPath(basePath, systems, stargates, systemsByName, startNode, endNode, overhead, avoidSet2, opts);
        return { path, meta };
      } catch {
        // Fallback: still provide baseline meta so UI can show 0% overhead and 0 extra systems
        let baselineCost = 0;
        for(let i=0;i<basePath.length-1;i++){
          const A = systemsByName[basePath[i].toLowerCase()];
          const B = systemsByName[basePath[i+1].toLowerCase()];
          if(!A||!B) continue;
          const isGate = Object.values(stargates).some(g => (g.source_system_id===A.id && g.destination_system_id===B.id) || (g.source_system_id===B.id && g.destination_system_id===A.id));
          baselineCost += isGate ? 0 : heuristic(A,B);
        }
        const meta = { baselineCost, finalCost: baselineCost, baselineNodes: basePath.length, finalNodes: basePath.length };
        return { path: basePath, meta };
      }
    }

    const neighbors = getNeighbors(current, allSystemsList, stargates, maxJumpDistance, optimizeFor, systemsById)
      .filter(n => !avoidSet.has(n.system.name.toLowerCase()));

    for (const neighbor of neighbors) {
      const tentativeGScore = gScore[current.id] + neighbor.cost;
      if (tentativeGScore < (gScore[neighbor.system.id] ?? Infinity)) {
        cameFrom[neighbor.system.id] = current.id;
        gScore[neighbor.system.id] = tentativeGScore;
        fScore[neighbor.system.id] = tentativeGScore + heuristic(neighbor.system, endNode);
        openSet.enqueue(neighbor.system, fScore[neighbor.system.id]);
      }
    }

    const now = Date.now();
    if(now - lastEmit >= 200){
      lastEmit = now;
      try { (self as any).postMessage({ type:'progress', explored: exploredCount, frontier: openSet.size(), elapsedMs: now - startTime, message: `Explored ${exploredCount} nodes` }); } catch {}
    }
  }

  let minRequired: number | undefined = undefined;
  try {
    const direct = heuristic(startNode, endNode);
    if(direct <= request.maxJumpDistance + 1e-6){
      minRequired = direct;
    } else {
      let low = request.maxJumpDistance;
      let high = Math.min(direct, Math.max(low*2, low + 1));
      const systemsByIdMap: { [id:number]: SolarSystem } = {}; Object.values(systems).forEach(s=> systemsByIdMap[s.id]=s);
      while(high < direct + 1e-6 && !existsPathWithin(systems, stargates, startNode, endNode, high, systemsByIdMap)){
        low = high; high = Math.min(direct, high * 2); if(high >= direct - 1e-6) break;
      }
      let pathExistsAtHigh = existsPathWithin(systems, stargates, startNode, endNode, high, systemsByIdMap);
      if(!pathExistsAtHigh){
        minRequired = direct;
      } else {
        for(let i=0;i<7;i++){
          const mid = (low + high) / 2;
          if(existsPathWithin(systems, stargates, startNode, endNode, mid, systemsByIdMap)) high = mid; else low = mid;
        }
        minRequired = high;
      }
    }
  } catch {}
  return { path: null, error: 'No path found.', minRequiredShipRange: minRequired };
};

// --- Dijkstra (advanced/fuel-optimal) ---
class MinHeap<T> {
  private heap: { key: number; val: T }[] = [];

  private swap(i: number, j: number) {
    const t = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = t;
  }

  push(key: number, val: T) {
    this.heap.push({ key, val });
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.heap[p].key <= this.heap[i].key) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): { key: number; val: T } | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < this.heap.length && this.heap[l].key < this.heap[smallest].key) smallest = l;
        if (r < this.heap.length && this.heap[r].key < this.heap[smallest].key) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  isEmpty() {
    return this.heap.length === 0;
  }
  size() {
    return this.heap.length;
  }
}

const findPathDijkstra = (request: RoutingRequest): RoutingResponse => {
  const { systems, stargates, fromSystemName, toSystemName, maxJumpDistance, optimizeFor, avoidSystemNames } = request;

  const systemsByName: { [name: string]: SolarSystem } = {};
  const systemsById: { [id: number]: SolarSystem } = {};
  for (const sys of Object.values(systems)) {
    systemsByName[sys.name.toLowerCase()] = sys;
    systemsById[sys.id] = sys;
  }

  const startNode = systemsByName[fromSystemName.toLowerCase()];
  const endNode = systemsByName[toSystemName.toLowerCase()];

  if (!startNode) return { path: null, error: `Start system "${fromSystemName}" not found.` };
  if (!endNode) return { path: null, error: `End system "${toSystemName}" not found.` };

  const distMap: { [id: number]: number } = {};
  const prev: { [id: number]: number } = {};
  const visited: { [id: number]: boolean } = {};

  const heap = new MinHeap<SolarSystem>();
  distMap[startNode.id] = 0;
  heap.push(0, startNode);

  const allSystemsList = Object.values(systems);

  const startTime = Date.now();
  let lastEmit = 0;
  const avoidSet = new Set<string>((avoidSystemNames||[]).map(n=> n.toLowerCase()).filter(n=> n!==fromSystemName.toLowerCase() && n!==toSystemName.toLowerCase()));

  while (!heap.isEmpty()) {
    const top = heap.pop()!;
    const current = top.val;
    if (visited[current.id]) continue;
    visited[current.id] = true;

    if (current.id === endNode.id) {
      const basePath = reconstructPath(prev, current, systemsById);
      if(optimizeFor !== 'explore') return { path: basePath };
      try { (self as any).postMessage({ type:'progress', explored: basePath.length, frontier: 0, elapsedMs: Date.now(), message:'Baseline path found – enriching (Explore mode)' }); } catch {}
      try {
        const overhead = typeof request.overheadPct === 'number' ? request.overheadPct : 30;
        const avoidSet = new Set<string>((avoidSystemNames||[]).map(n=> n.toLowerCase()));
        const opts = {
          corridorFactor: ((request.exploreCorridorPct ?? 18) / 100),
          progressBias: ((request.exploreProgressBiasPct ?? 50) / 100),
        };
        const { path, meta } = enrichPath(basePath, systems, stargates, systemsByName, startNode, endNode, overhead, avoidSet, opts);
        return { path, meta };
      } catch {
        let baselineCost = 0;
        for(let i=0;i<basePath.length-1;i++){
          const A = systemsByName[basePath[i].toLowerCase()];
          const B = systemsByName[basePath[i+1].toLowerCase()];
          if(!A||!B) continue;
          const isGate = Object.values(stargates).some(g => (g.source_system_id===A.id && g.destination_system_id===B.id) || (g.source_system_id===B.id && g.destination_system_id===A.id));
          baselineCost += isGate ? 0 : heuristic(A,B);
        }
        const meta = { baselineCost, finalCost: baselineCost, baselineNodes: basePath.length, finalNodes: basePath.length };
        return { path: basePath, meta };
      }
    }

  const neighbors = getNeighbors(current, allSystemsList, stargates, maxJumpDistance, optimizeFor, systemsById)
    .filter(n => !avoidSet.has(n.system.name.toLowerCase()));
    for (const neighbor of neighbors) {
      const cost = (() => {
        if (optimizeFor === 'jumps') return neighbor.cost; // 1 per jump
        const isGateEdge = Object.values(stargates).some(g =>
          (g.source_system_id === current.id && g.destination_system_id === neighbor.system.id) ||
          (g.source_system_id === neighbor.system.id && g.destination_system_id === current.id)
        );
        if (isGateEdge) return 0;
        return heuristic(current, neighbor.system);
      })();

      const alt = (distMap[current.id] ?? Infinity) + cost;
      if (alt < (distMap[neighbor.system.id] ?? Infinity)) {
        distMap[neighbor.system.id] = alt;
        prev[neighbor.system.id] = current.id;
        heap.push(alt, neighbor.system);
      }
        // Throttled progress update
        const now = Date.now();
        if (now - lastEmit >= 200) {
          lastEmit = now;
          try {
            // post a lightweight progress object
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            self.postMessage({ type: 'progress', explored: Object.keys(visited).length, frontier: heap.size(), elapsedMs: now - startTime, message: `Explored ${Object.keys(visited).length} nodes` });
          } catch (e) {
            // ignore postMessage errors
          }
        }
    }
  }

  // Path not found (Dijkstra): reuse A* style probing for minimal required range
  let minRequired: number | undefined = undefined;
  try {
    const direct = heuristic(startNode, endNode);
    if(direct <= request.maxJumpDistance + 1e-6){
      minRequired = direct;
    } else {
      const systemsById: { [id:number]: SolarSystem } = {}; Object.values(systems).forEach(s=> systemsById[s.id]=s);
      let low = request.maxJumpDistance; let high = Math.min(direct, Math.max(low*2, low+1));
      while(high < direct + 1e-6 && !existsPathWithin(systems, stargates, startNode, endNode, high, systemsById)){
        low = high; high = Math.min(direct, high*2); if(high >= direct - 1e-6) break; }
      if(!existsPathWithin(systems, stargates, startNode, endNode, high, systemsById)){
        minRequired = direct;
      } else {
        for(let i=0;i<7;i++){
          const mid = (low + high)/2;
          if(existsPathWithin(systems, stargates, startNode, endNode, mid, systemsById)) high = mid; else low = mid;
        }
        minRequired = high;
      }
    }
  } catch { /* ignore */ }
  return { path: null, error: 'No path found.', minRequiredShipRange: minRequired };
};

// Dispatcher
const findPath = (request: RoutingRequest): RoutingResponse => {
  // Invalidate spatial caches if the requested maxJumpDistance would lead to different grid buckets
  const cellSize = Math.max(1, Math.floor(request.maxJumpDistance));
  if (!spatialGrids.has(cellSize)) {
    spatialGrids.clear();
    neighborCache.clear();
  }

  const algo = request.algorithm ?? 'astar';
  if (algo === 'dijkstra') return findPathDijkstra(request);
  return findPathAstar(request);
};

// Worker handler
self.onmessage = (e: MessageEvent<RoutingRequest>) => {
  try {
    const result = findPath(e.data);
    self.postMessage(result);
  } catch (error) {
    self.postMessage({ path: null, error: error instanceof Error ? error.message : 'An unknown error occurred in the worker.' });
  }
};

export {};
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
  optimizeFor: 'fuel' | 'jumps';
  algorithm?: 'astar' | 'dijkstra';
  avoidSystemNames?: string[]; // optional list of systems to exclude
}

interface RoutingResponse { path: string[] | null; error?: string; minRequiredShipRange?: number }

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
  optimizeFor: 'fuel' | 'jumps',
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

  if (optimizeFor === 'fuel') {
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
  // Build or reuse grid (reuse spatialGrids)
  let grid = spatialGrids.get(cellSize);
  if(!grid){
    grid = buildGrid(cellSize, allSystems);
    spatialGrids.set(cellSize, grid);
  }
  const visited = new Set<number>();
  const q:number[] = [from.id];
  visited.add(from.id);
  // Pre-build gate adjacency for fast gate expansion for this scan
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
    // Gate neighbors
    for(const ng of gateAdjLocal.get(curId)||[]){
      if(!visited.has(ng)){ visited.add(ng); q.push(ng); if(ng===to.id) return true; }
    }
    // Ship neighbors (spatial grid query)
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
            if(d <= maxJump){
              visited.add(cand.id); q.push(cand.id); if(cand.id===to.id) return true;
            }
          }
        }
      }
    }
  }
  return false;
};

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

  // Progress instrumentation
  const startTime = Date.now();
  let lastEmit = 0;
  let exploredCount = 0;

  while (!openSet.isEmpty()) {
    const current = openSet.dequeue()!;
    exploredCount++;

    if (current.id === endNode.id) return { path: reconstructPath(cameFrom, current, systemsById) };

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

    // Throttled progress emission every ~200ms
    const now = Date.now();
    if(now - lastEmit >= 200){
      lastEmit = now;
      try {
        // @ts-ignore worker context
        self.postMessage({ type:'progress', explored: exploredCount, frontier: openSet.size(), elapsedMs: now - startTime, message: `Explored ${exploredCount} nodes` });
      } catch { /* ignore */ }
    }
  }

  // Path not found: approximate minimal required ship range by probing existence with increasing jump distance
  let minRequired: number | undefined = undefined;
  try {
    const direct = heuristic(startNode, endNode);
    if(direct <= request.maxJumpDistance + 1e-6){
      minRequired = direct; // should have succeeded, fallback to direct
    } else {
      let low = request.maxJumpDistance;
      let high = Math.min(direct, Math.max(low*2, low + 1));
      const systemsById: { [id:number]: SolarSystem } = {}; Object.values(systems).forEach(s=> systemsById[s.id]=s);
      // Exponential expansion
      while(high < direct + 1e-6 && !existsPathWithin(systems, stargates, startNode, endNode, high, systemsById)){
        low = high;
        high = Math.min(direct, high * 2);
        if(high >= direct - 1e-6) break;
      }
      let pathExistsAtHigh = existsPathWithin(systems, stargates, startNode, endNode, high, systemsById);
      if(!pathExistsAtHigh){
        minRequired = direct; // could not find path even at direct distance threshold
      } else {
        // Binary refine
        for(let i=0;i<7;i++){
          const mid = (low + high) / 2;
            if(existsPathWithin(systems, stargates, startNode, endNode, mid, systemsById)){
              high = mid;
            } else {
              low = mid;
            }
        }
        minRequired = high;
      }
    }
  } catch { /* ignore */ }
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

    if (current.id === endNode.id) return { path: reconstructPath(prev, current, systemsById) };

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
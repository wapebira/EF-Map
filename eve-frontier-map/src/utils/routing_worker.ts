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
}

interface RoutingResponse { path: string[] | null; error?: string }

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

const getNeighbors = (
  system: SolarSystem,
  allSystems: SolarSystem[],
  stargates: { [key: string]: Stargate },
  maxJumpDist: number,
  optimizeFor: 'fuel' | 'jumps',
  systemsById: { [id: number]: SolarSystem }
): { system: SolarSystem; cost: number }[] => {
  const neighbors: { system: SolarSystem; cost: number }[] = [];

  if (optimizeFor === 'jumps') {
    for (const otherSystem of allSystems) {
      if (system.id === otherSystem.id) continue;
      const dist = heuristic(system, otherSystem);
      if (dist <= maxJumpDist) {
        neighbors.push({ system: otherSystem, cost: 1 });
      }
    }
    return neighbors;
  }

  if (optimizeFor === 'fuel') {
    // Add stargate connections
    for (const gate of Object.values(stargates)) {
      if (gate.source_system_id === system.id) {
        const destSystem = systemsById[gate.destination_system_id];
        if (destSystem) {
          neighbors.push({ system: destSystem, cost: 1 });
        }
      }
    }

    // Add direct ship jumps
    for (const otherSystem of allSystems) {
      if (system.id === otherSystem.id) continue;
      const dist = heuristic(system, otherSystem);
      if (dist <= maxJumpDist) {
        neighbors.push({ system: otherSystem, cost: 100 });
      }
    }
  }

  return neighbors;
};

// --- A* (basic) ---
const findPathAstar = (request: RoutingRequest): RoutingResponse => {
  const { systems, stargates, fromSystemName, toSystemName, maxJumpDistance, optimizeFor } = request;

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

  while (!openSet.isEmpty()) {
    const current = openSet.dequeue()!;

    if (current.id === endNode.id) return { path: reconstructPath(cameFrom, current, systemsById) };

    const neighbors = getNeighbors(current, allSystemsList, stargates, maxJumpDistance, optimizeFor, systemsById);

    for (const neighbor of neighbors) {
      const tentativeGScore = gScore[current.id] + neighbor.cost;
      if (tentativeGScore < (gScore[neighbor.system.id] ?? Infinity)) {
        cameFrom[neighbor.system.id] = current.id;
        gScore[neighbor.system.id] = tentativeGScore;
        fScore[neighbor.system.id] = tentativeGScore + heuristic(neighbor.system, endNode);
        openSet.enqueue(neighbor.system, fScore[neighbor.system.id]);
      }
    }
  }

  return { path: null, error: 'No path found.' };
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
}

const findPathDijkstra = (request: RoutingRequest): RoutingResponse => {
  const { systems, stargates, fromSystemName, toSystemName, maxJumpDistance, optimizeFor } = request;

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

  while (!heap.isEmpty()) {
    const top = heap.pop()!;
    const current = top.val;
    if (visited[current.id]) continue;
    visited[current.id] = true;

    if (current.id === endNode.id) return { path: reconstructPath(prev, current, systemsById) };

    const neighbors = getNeighbors(current, allSystemsList, stargates, maxJumpDistance, optimizeFor, systemsById);
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
    }
  }

  return { path: null, error: 'No path found.' };
};

// Dispatcher
const findPath = (request: RoutingRequest): RoutingResponse => {
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
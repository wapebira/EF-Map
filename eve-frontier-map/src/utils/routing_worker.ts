// src/utils/routing_worker.ts

// --- DATA STRUCTURES AND TYPES ---

interface Position {
  x: number;
  y: number;
  z: number;
}

interface SolarSystem {
  id: number;
  name: string;
  position: Position;
}

interface Stargate {
  source_system_id: number;
  destination_system_id: number;
}

interface RoutingRequest {
  systems: { [key: string]: SolarSystem };
  stargates: { [key: string]: Stargate };
  fromSystemName: string;
  toSystemName: string;
  maxJumpDistance: number;
  optimizeFor: 'fuel' | 'jumps';
}

interface RoutingResponse {
  path: string[] | null;
  error?: string;
}

/**
 * A simple Priority Queue implementation for the A* algorithm.
 */
class PriorityQueue<T> {
  private elements: { item: T; priority: number }[] = [];

  enqueue(item: T, priority: number) {
    this.elements.push({ item, priority });
    this.elements.sort((a, b) => a.priority - b.priority); // Simple sort, effective for our scale
  }

  dequeue(): T | undefined {
    return this.elements.shift()?.item;
  }

  isEmpty(): boolean {
    return this.elements.length === 0;
  }
}

// --- A* ALGORITHM IMPLEMENTATION ---

const findPath = (request: RoutingRequest): RoutingResponse => {
  const { systems, stargates, fromSystemName, toSystemName, maxJumpDistance, optimizeFor } = request;

  const systemsByName: { [name: string]: SolarSystem } = {};
  const systemsById: { [id: number]: SolarSystem } = {};
  for (const sys of Object.values(systems)) {
    systemsByName[sys.name.toLowerCase()] = sys;
    systemsById[sys.id] = sys;
  }

  const startNode = systemsByName[fromSystemName.toLowerCase()];
  const endNode = systemsByName[toSystemName.toLowerCase()];

  if (!startNode) {
    return { path: null, error: `Start system "${fromSystemName}" not found.` };
  }
  if (!endNode) {
    return { path: null, error: `End system "${toSystemName}" not found.` };
  }

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

    if (current.id === endNode.id) {
      return { path: reconstructPath(cameFrom, current, systemsById) };
    }

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

  return { path: null, error: 'No path found.' }; // No path found
};

/**
 * Calculates the Euclidean distance between two systems.
 */
const heuristic = (a: SolarSystem, b: SolarSystem): number => {
  return Math.sqrt(
    Math.pow(a.position.x - b.position.x, 2) +
    Math.pow(a.position.y - b.position.y, 2) +
    Math.pow(a.position.z - b.position.z, 2)
  );
};

/**
 * Reconstructs the path from the cameFrom map.
 */
const reconstructPath = (cameFrom: { [key: number]: number }, currentId: SolarSystem, systemsById: { [id: number]: SolarSystem }): string[] => {
  const totalPath = [currentId.name];
  let current = currentId.id;
  while (cameFrom[current]) {
    current = cameFrom[current];
    totalPath.unshift(systemsById[current].name);
  }
  return totalPath;
};

/**
 * Gets the neighbors of a system based on the optimization mode.
 */
const getNeighbors = (
  system: SolarSystem,
  allSystems: SolarSystem[],
  stargates: { [key: string]: Stargate },
  maxJumpDist: number,
  optimizeFor: 'fuel' | 'jumps',
  systemsById: { [id: number]: SolarSystem }
): { system: SolarSystem; cost: number }[] => {
  const neighbors: { system: SolarSystem; cost: number }[] = [];

  // --- Jumps Optimization: Only consider direct jumps ---
  if (optimizeFor === 'jumps') {
    for (const otherSystem of allSystems) {
      if (system.id === otherSystem.id) continue;
      const dist = heuristic(system, otherSystem);
      if (dist <= maxJumpDist) {
        neighbors.push({ system: otherSystem, cost: 1 }); // Cost is 1 per jump
      }
    }
    return neighbors;
  }

  // --- Fuel Optimization: Prefer stargates ---
  if (optimizeFor === 'fuel') {
    // Add stargate connections (low cost)
    for (const gate of Object.values(stargates)) {
      if (gate.source_system_id === system.id) {
        const destSystem = systemsById[gate.destination_system_id];
        if (destSystem) {
          neighbors.push({ system: destSystem, cost: 1 });
        }
      }
    }

    // Add direct jump connections (high cost)
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

// --- Worker Message Handler ---

self.onmessage = (e: MessageEvent<RoutingRequest>) => {
  try {
    const result = findPath(e.data);
    self.postMessage(result);
  } catch (error) {
    self.postMessage({ path: null, error: error instanceof Error ? error.message : 'An unknown error occurred in the worker.' });
  }
};

export {};
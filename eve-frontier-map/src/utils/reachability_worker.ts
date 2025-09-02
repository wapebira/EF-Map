// Reachability worker: computes reachable systems within per-jump range using spatial hashing.
// Message in: { systems, originName, maxJumpDistance }
// Output: { type:'result', reachableIds:number[], elapsedMs:number }
// Systems shape mirrors mapData.solar_systems.

interface SystemRec { id:number; name:string; position:{x:number;y:number;z:number}; hidden?:boolean }

interface StargateRec { source_system_id:number; destination_system_id:number }
interface InMsg { systems: Record<string,SystemRec>; stargates?: Record<string,StargateRec>; originName:string; maxJumpDistance:number; token:number }

// Spatial hash helpers
interface Cell { ids:number[] }

function buildGrid(systems:SystemRec[], cellSize:number){
  const grid = new Map<string, Cell>();
  const toCellKey = (x:number,y:number,z:number)=> `${x}|${y}|${z}`;
  for(const s of systems){
    const cx = Math.floor(s.position.x / cellSize);
    const cy = Math.floor(s.position.y / cellSize);
    const cz = Math.floor(s.position.z / cellSize);
    const k = toCellKey(cx,cy,cz);
    let cell = grid.get(k); if(!cell){ cell = { ids:[] }; grid.set(k, cell); }
    cell.ids.push(s.id);
  }
  return { grid, toCellKey };
}

let lastCellSize = 0;
let cachedGrid: ReturnType<typeof buildGrid>|null = null;
let cachedSystems: SystemRec[] = [];
let idToSystem = new Map<number,SystemRec>();
let nameToSystem = new Map<string,SystemRec>();
let stargateAdj: Map<number, number[]> | null = null;
let lastStargateCount = 0;

function ensureCache(systemsRec:Record<string,SystemRec>, cellSize:number){
  const systems = Object.values(systemsRec).filter(s=> !s.hidden);
  if(!cachedGrid || cellSize !== lastCellSize || systems.length !== cachedSystems.length){
    cachedSystems = systems;
    idToSystem = new Map(systems.map(s=> [s.id, s]));
    nameToSystem = new Map(systems.map(s=> [s.name.toLowerCase(), s]));
    cachedGrid = buildGrid(systems, cellSize);
    lastCellSize = cellSize;
  }
}

self.onmessage = (e:MessageEvent<InMsg>)=>{
  const { systems, stargates, originName, maxJumpDistance, token } = e.data;
  const startTs = performance.now();
  if(!systems || !originName || !isFinite(maxJumpDistance) || maxJumpDistance <= 0){
  (self as any).postMessage({ type:'result', reachableIds:[], elapsedMs:0, token });
    return;
  }
  const cellSize = maxJumpDistance; // spatial hash cell equal to jump distance
  ensureCache(systems, cellSize);
  if(!cachedGrid){ (self as any).postMessage({ type:'result', reachableIds:[], elapsedMs:0, token }); return; }
  const origin = nameToSystem.get(originName.toLowerCase());
  if(!origin){ (self as any).postMessage({ type:'result', reachableIds:[], elapsedMs:0, token }); return; }

  const visited = new Set<number>();
  const q:number[] = [origin.id];
  visited.add(origin.id);

  // Build / refresh stargate adjacency if provided and changed
  if(stargates){
    const stargateValues = Object.values(stargates);
    if(!stargateAdj || stargateValues.length !== lastStargateCount){
      stargateAdj = new Map();
      for(const g of stargateValues){
        const a = g.source_system_id; const b = g.destination_system_id;
        if(!idToSystem.has(a) || !idToSystem.has(b)) continue;
        if(!stargateAdj.has(a)) stargateAdj.set(a, []);
        if(!stargateAdj.has(b)) stargateAdj.set(b, []);
        stargateAdj.get(a)!.push(b);
        stargateAdj.get(b)!.push(a);
      }
      lastStargateCount = stargateValues.length;
    }
  } else {
    stargateAdj = null; lastStargateCount = 0;
  }

  const { grid, toCellKey } = cachedGrid;
  const range2 = maxJumpDistance * maxJumpDistance;
  const originPosCache = new Map<number,{x:number;y:number;z:number}>();

  while(q.length){
    const sid = q.shift()!;
    const s = idToSystem.get(sid)!;
    // 1. Ship-range neighbors via spatial hash
    const cx = Math.floor(s.position.x / cellSize);
    const cy = Math.floor(s.position.y / cellSize);
    const cz = Math.floor(s.position.z / cellSize);
    for(let dx=-1; dx<=1; dx++){
      for(let dy=-1; dy<=1; dy++){
        for(let dz=-1; dz<=1; dz++){
          const key = toCellKey(cx+dx, cy+dy, cz+dz);
          const cell = grid.get(key); if(!cell) continue;
          for(const nid of cell.ids){
            if(visited.has(nid)) continue;
            const n = idToSystem.get(nid)!;
            let op = originPosCache.get(nid);
            if(!op){ op = n.position; originPosCache.set(nid, op); }
            const dxp = n.position.x - s.position.x;
            const dyp = n.position.y - s.position.y;
            const dzp = n.position.z - s.position.z;
            const d2 = dxp*dxp + dyp*dyp + dzp*dzp;
            if(d2 <= range2){
              visited.add(nid); q.push(nid);
            }
          }
        }
      }
    }
    // 2. Stargate edges (no distance constraint)
    if(stargateAdj){
      const gNbrs = stargateAdj.get(sid);
      if(gNbrs){
        for(const nid of gNbrs){
          if(!visited.has(nid)){
            visited.add(nid); q.push(nid);
          }
        }
      }
    }
  }

  const elapsedMs = performance.now() - startTs;
  (self as any).postMessage({ type:'result', reachableIds: Array.from(visited), elapsedMs, token });
};

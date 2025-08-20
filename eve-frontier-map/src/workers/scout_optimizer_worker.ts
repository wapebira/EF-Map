// Scout Optimizer Worker: baseline + iterative optimization (simplified placeholder)
// NOTE: This is an initial scaffold. Real optimization logic (NN + 2-opt + SA multi-pass) to be filled in.

interface Position { x:number; y:number; z:number }
interface System { id:number; name:string; position:Position }
interface Gate { source_system_id:number; destination_system_id:number }
interface InitMessage { type:'init'; systems: { [name:string]: System }; stargates: { [id:string]: Gate }; }
interface BaselineMessage { type:'baseline'; start:string; systems:string[]; returnToStart:boolean }
interface OptimizeMessage { type:'optimize'; path:string[]; passes:number; timePerPassSec:number; returnToStart:boolean }
interface StopMessage { type:'stop' }

type InMsg = InitMessage | BaselineMessage | OptimizeMessage | StopMessage;

// Source systems keyed by ID string passed from main thread; we'll build name & id maps
let systemsDataRaw: { [key:string]: System } = {};
let systemsByName: { [name:string]: System } = {};
let stargates: Gate[] = [];
let stopping = false;

const dist = (a:System,b:System) => {
  const dx=a.position.x-b.position.x, dy=a.position.y-b.position.y, dz=a.position.z-b.position.z;
  return Math.sqrt(dx*dx+dy*dy+dz*dz);
};

// Always try gates first: simple breadth-first to find gate path; fallback to direct distance.
const gateAdj = new Map<number, number[]>();
const buildGateAdj = () => {
  gateAdj.clear();
  for (const g of stargates) {
    if(!gateAdj.has(g.source_system_id)) gateAdj.set(g.source_system_id, []);
    if(!gateAdj.has(g.destination_system_id)) gateAdj.set(g.destination_system_id, []);
    gateAdj.get(g.source_system_id)!.push(g.destination_system_id);
    gateAdj.get(g.destination_system_id)!.push(g.source_system_id);
  }
};

const gateDistanceOrDirect = (a:System,b:System): number => {
  // BFS gate hops then sum euclidean along hops; else ship jump direct
  const start=a.id, goal=b.id;
  const q:number[][] = [[start]]; const seen=new Set<number>([start]);
  while(q.length){
    const path=q.shift()!; const last=path[path.length-1];
    if(last===goal){
      // sum distances along gate path
      let total=0; for(let i=0;i<path.length-1;i++){ const s1=systemsById.get(path[i])!, s2=systemsById.get(path[i+1])!; total+=dist(s1,s2); }
      return total; }
    for(const nxt of gateAdj.get(last)||[]){ if(!seen.has(nxt)){ seen.add(nxt); q.push([...path,nxt]); } }
  }
  return dist(a,b); // direct ship jump
};

const systemsById = new Map<number,System>();

// Nearest Neighbor baseline
const nearestNeighbor = (start:string, candidates:string[], returnToStart:boolean): string[] => {
  const remaining = new Set(candidates.filter(c=>c!==start));
  const route=[start];
  while(remaining.size){
    const current = systemsByName[route[route.length-1]];
    if(!current) break;
    let best: string | null = null; let bestD=Infinity;
    for(const name of remaining){
      const target = systemsByName[name];
      if(!target) continue;
      const d = gateDistanceOrDirect(current, target);
      if(d<bestD){ bestD=d; best=name; }
    }
    if(!best) break;
    route.push(best); remaining.delete(best);
  }
  if(returnToStart) route.push(start);
  return route;
};

// Simple 2-opt
const twoOpt = (path:string[], returnToStart:boolean, timeMs:number): string[] => {
  const startTime=Date.now();
  let best=path.slice();
  const effectiveLen = returnToStart ? best.length-1 : best.length;
  const cost = (p:string[])=>{ let c=0; for(let i=0;i<effectiveLen-1;i++){ const a=systemsByName[p[i]], b=systemsByName[p[i+1]]; if(!a||!b) return Infinity; c+=gateDistanceOrDirect(a,b); } return c; };
  let bestCost = cost(best);
  while(Date.now()-startTime<timeMs){
    let improved=false;
    for(let i=1;i<effectiveLen-2;i++){
      for(let k=i+1;k<effectiveLen-1;k++){
        const newPath = best.slice(0,i).concat(best.slice(i,k+1).reverse(), best.slice(k+1));
        const newCost = cost(newPath);
        if(newCost < bestCost){ best=newPath; bestCost=newCost; improved=true; break; }
      }
      if(improved) break;
    }
    if(!improved) break;
  }
  return best;
};

// Iterative improvement (placeholder: repeated 2-opt shuffles)
const iterativeImprove = (base:string[], passes:number, timePerPassSec:number, returnToStart:boolean, progressCb:(msg:string)=>void): string[] => {
  let champion = base.slice();
  for(let p=0;p<passes && !stopping;p++){
  const budget=timePerPassSec*1000;
    // Randomly shuffle a segment then 2-opt
    const working=champion.slice();
    if(working.length>5){
      const a=1+Math.floor(Math.random()*(working.length-3));
      const b=a+1+Math.floor(Math.random()*(working.length-a-2));
      working.splice(a,b-a, ...working.slice(a,b).reverse());
    }
    const improved=twoOpt(working, returnToStart, budget);
  const cost=(path:string[])=>{ let c=0; for(let i=0;i<path.length-1;i++){ const a=systemsByName[path[i]], b=systemsByName[path[i+1]]; if(!a||!b) return Infinity; c+=gateDistanceOrDirect(a,b); } return c; };
    if(cost(improved) < cost(champion)) champion=improved;
    progressCb(`Pass ${p+1}/${passes}`);
  }
  return champion;
};

const post = (data:unknown)=>{ // @ts-ignore
  self.postMessage(data); };

self.onmessage = (e:MessageEvent<InMsg>) => {
  const msg=e.data;
  if(msg.type==='init'){
    systemsDataRaw = msg.systems; systemsByName = {}; stargates=Object.values(msg.stargates); systemsById.clear();
    for (const sys of Object.values(systemsDataRaw)) { systemsById.set(sys.id, sys); systemsByName[sys.name] = sys; }
    buildGateAdj(); stopping=false; post({ type:'ready' });
  } else if(msg.type==='baseline'){
    stopping=false;
    if(!systemsByName[msg.start]) { post({ type:'baselineResult', path:[msg.start] }); return; }
    const route = nearestNeighbor(msg.start, msg.systems, msg.returnToStart);
    const refined = twoOpt(route, msg.returnToStart, 250);
    post({ type:'baselineResult', path: refined });
  } else if(msg.type==='optimize'){
    stopping=false;
    const champion = iterativeImprove(msg.path, msg.passes, msg.timePerPassSec, msg.returnToStart, (m)=>post({ type:'progress', message:m }));
    post({ type:'optimizeResult', path: champion });
  } else if(msg.type==='stop'){
    stopping=true; post({ type:'stopped' });
  }
};

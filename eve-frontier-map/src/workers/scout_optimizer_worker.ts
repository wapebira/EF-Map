// Scout Optimizer Worker: baseline + iterative optimization (simplified placeholder)
// NOTE: This is an initial scaffold. Real optimization logic (NN + 2-opt + SA multi-pass) to be filled in.

interface Position { x:number; y:number; z:number }
interface System { id:number; name:string; position:Position }
interface Gate { source_system_id:number; destination_system_id:number }
interface InitMessage { type:'init'; systems: { [name:string]: System }; stargates: { [id:string]: Gate }; }
interface BaselineMessage { type:'baseline'; start:string; systems:string[]; returnToStart:boolean; generation?:number; maxShipRange:number; shipTradeDistance:number; minGateHopsSaved:number }
interface OptimizeMessage { type:'optimize'; path:string[]; passes:number; timePerPassSec:number; returnToStart:boolean; generation?:number; maxShipRange:number; shipTradeDistance:number; minGateHopsSaved:number }
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

// Parameters influencing cost selection (updated per message)
let maxShipRange = 60; // LY capability
let shipTradeDistance = 0; // LY acceptable ship jump to replace many gates
let minGateHopsSaved = 999999; // default effectively disable until set

interface EdgeEval { gateDistance:number|null; gateHops:number|null; shipDistance:number; chooseShip:boolean; }

const evaluateEdge = (a:System,b:System): EdgeEval => {
  // BFS for gate path capturing distance & hops
  let gateDistance: number | null = null; let gateHops: number | null = null;
  const start=a.id, goal=b.id;
  const q:number[][] = [[start]]; const seen=new Set<number>([start]);
  while(q.length){
    const path=q.shift()!; const last=path[path.length-1];
    if(last===goal){
      gateHops = path.length-1;
      let total=0; for(let i=0;i<gateHops;i++){ const s1=systemsById.get(path[i])!, s2=systemsById.get(path[i+1])!; total+=dist(s1,s2); }
      gateDistance = total; break;
    }
    for(const nxt of gateAdj.get(last)||[]){ if(!seen.has(nxt)){ seen.add(nxt); q.push([...path,nxt]); } }
  }
  const shipDistance = dist(a,b);
  let chooseShip=false;
  if(gateDistance===null){
    // No gate path; only allow ship if within range
    if(shipDistance <= maxShipRange) chooseShip=true; else return { gateDistance:null, gateHops:null, shipDistance:Infinity, chooseShip:false };
  } else {
    // Gate path exists; consider trade rule
    const gateHopsVal = gateHops!;
  const gateTradeAllowed = shipDistance <= shipTradeDistance && shipDistance <= maxShipRange && gateHopsVal >= minGateHopsSaved;
  // Always prefer gate unless trade rule triggers AND within ship capability
  if(gateTradeAllowed) chooseShip=true;
  }
  return { gateDistance, gateHops, shipDistance, chooseShip };
};

interface PathCost { shipDistance:number; shipJumps:number; totalDistance:number; }

const computePathCost = (path:string[], returnToStart:boolean): PathCost => {
  let shipDistance=0, shipJumps=0, totalDistance=0;
  const effLen = returnToStart? path.length : path.length; // path already includes return if requested
  for(let i=0;i<effLen-1;i++){
    const a=systemsByName[path[i]], b=systemsByName[path[i+1]]; if(!a||!b) continue;
    const ev = evaluateEdge(a,b);
    if(ev.chooseShip){
      if(ev.shipDistance>maxShipRange+1e-6){ return { shipDistance:Infinity, shipJumps:Infinity, totalDistance:Infinity }; }
      shipDistance += ev.shipDistance; shipJumps += 1; totalDistance += ev.shipDistance;
    }
    else if(ev.gateDistance!==null){ totalDistance += ev.gateDistance; }
    else { // unreachable (no gate path and ship out of range)
      return { shipDistance:Infinity, shipJumps:Infinity, totalDistance:Infinity };
    }
  }
  return { shipDistance, shipJumps, totalDistance };
};

const systemsById = new Map<number,System>();

// Nearest Neighbor baseline
const nearestNeighbor = (start:string, candidates:string[], returnToStart:boolean): { path:string[]; unreachable:boolean } => {
  const remaining = new Set(candidates.filter(c=>c!==start));
  const route=[start];
  let unreachable=false;
  while(remaining.size){
    let bestChoice: { name:string; cost:PathCost } | null = null;
    for(const name of remaining){
      const trial = route.concat(name);
      const cost = computePathCost(trial, false);
      if(!isFinite(cost.shipDistance)) continue; // skip unreachable extension
      if(bestChoice===null){ bestChoice={name, cost}; continue; }
      const bc = bestChoice.cost;
      // Lexicographic compare: shipDistance, shipJumps, totalDistance
      if( cost.shipDistance < bc.shipDistance ||
          (cost.shipDistance===bc.shipDistance && cost.shipJumps < bc.shipJumps) ||
          (cost.shipDistance===bc.shipDistance && cost.shipJumps===bc.shipJumps && cost.totalDistance < bc.totalDistance) ){
        bestChoice={name, cost};
      }
    }
    if(!bestChoice){ unreachable=true; break; }
    route.push(bestChoice.name); remaining.delete(bestChoice.name);
  }
  if(returnToStart) route.push(start);
  return { path:route, unreachable: unreachable || route.length < (candidates.length + (returnToStart?1:0)) };
};

// Simple 2-opt
const twoOpt = (path:string[], returnToStart:boolean, timeMs:number): string[] => {
  const startTime=Date.now();
  let best=path.slice();
  const effectiveLen = returnToStart ? best.length-1 : best.length;
  const cost = (p:string[])=> computePathCost(p, returnToStart);
  let bestCost = cost(best);
  while(Date.now()-startTime<timeMs){
    let improved=false;
    for(let i=1;i<effectiveLen-2;i++){
      for(let k=i+1;k<effectiveLen-1;k++){
        const newPath = best.slice(0,i).concat(best.slice(i,k+1).reverse(), best.slice(k+1));
        const nc = cost(newPath);
        const better = (nc.shipDistance < bestCost.shipDistance) ||
          (nc.shipDistance===bestCost.shipDistance && nc.shipJumps < bestCost.shipJumps) ||
          (nc.shipDistance===bestCost.shipDistance && nc.shipJumps===bestCost.shipJumps && nc.totalDistance < bestCost.totalDistance);
        if(better){ best=newPath; bestCost=nc; improved=true; break; }
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
  let championCost = computePathCost(champion, returnToStart);
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
    const improvedCost = computePathCost(improved, returnToStart);
    const better = (improvedCost.shipDistance < championCost.shipDistance) ||
      (improvedCost.shipDistance===championCost.shipDistance && improvedCost.shipJumps < championCost.shipJumps) ||
      (improvedCost.shipDistance===championCost.shipDistance && improvedCost.shipJumps===championCost.shipJumps && improvedCost.totalDistance < championCost.totalDistance);
    if(better){ champion=improved; championCost=improvedCost; }
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
    maxShipRange = msg.maxShipRange; shipTradeDistance = msg.shipTradeDistance; minGateHopsSaved = msg.minGateHopsSaved;
    if(!systemsByName[msg.start]) { post({ type:'baselineResult', path:[msg.start] }); return; }
    const { path:nnPath, unreachable } = nearestNeighbor(msg.start, msg.systems, msg.returnToStart);
    if(unreachable){ post({ type:'baselineError', reason:'Unreachable systems with current ship range / gate network', generation: msg.generation }); return; }
    const refinedPre = twoOpt(nnPath, msg.returnToStart, 250);
    const refinedCost = computePathCost(refinedPre, msg.returnToStart);
    if(!isFinite(refinedCost.shipDistance)) { post({ type:'baselineError', reason:'Route optimization produced unreachable segment', generation: msg.generation }); return; }
    const refined = refinedPre;
    // Validation: ensure no ship jumps exceed maxShipRange; if found, try to mark path invalid (will show in UI distance Infinity)
    let invalid=false; let worstOver=0;
    for(let i=0;i<refined.length-1;i++){
      const a=systemsByName[refined[i]], b=systemsByName[refined[i+1]]; if(!a||!b) continue;
      const ev=evaluateEdge(a,b);
      if(ev.chooseShip && ev.shipDistance > maxShipRange+1e-6){ invalid=true; if(ev.shipDistance>worstOver) worstOver=ev.shipDistance; }
    }
    if(invalid){
      post({ type:'progress', message:`Baseline contains ship jump over range (${worstOver.toFixed(2)} > ${maxShipRange}). Params may require adjustment.` });
    }
    post({ type:'baselineResult', path: refined, generation: msg.generation });
  } else if(msg.type==='optimize'){
    stopping=false;
    maxShipRange = msg.maxShipRange; shipTradeDistance = msg.shipTradeDistance; minGateHopsSaved = msg.minGateHopsSaved;
    const champion = iterativeImprove(msg.path, msg.passes, msg.timePerPassSec, msg.returnToStart, (m)=>post({ type:'progress', message:m }));
    post({ type:'optimizeResult', path: champion, generation: msg.generation });
  } else if(msg.type==='stop'){
    stopping=true; post({ type:'stopped' });
  }
};

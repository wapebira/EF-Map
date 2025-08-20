// Scout Optimizer Worker: baseline + iterative optimization (simplified placeholder)
// NOTE: This is an initial scaffold. Real optimization logic (NN + 2-opt + SA multi-pass) to be filled in.

interface Position { x:number; y:number; z:number }
interface System { id:number; name:string; position:Position }
interface Gate { source_system_id:number; destination_system_id:number }
interface InitMessage { type:'init'; systems: { [name:string]: System }; stargates: { [id:string]: Gate }; }
interface BaselineMessage { type:'baseline'; start:string; systems:string[]; returnToStart:boolean; generation?:number; maxShipRange:number; shipTradeDistance:number; minGateHopsSaved:number; debug?:boolean }
interface OptimizeMessage { type:'optimize'; path:string[]; passes:number; timePerPassSec:number; returnToStart:boolean; generation?:number; maxShipRange:number; shipTradeDistance:number; minGateHopsSaved:number; debug?:boolean }
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
const nearestNeighbor = (start:string, candidates:string[], returnToStart:boolean, connectivityGuaranteed:boolean, debug:boolean): { path:string[]; unreachable:boolean } => {
  const remaining = new Set(candidates.filter(c=>c!==start));
  const route=[start];
  let unreachable=false;
  // Track incremental cost so we don't recompute whole path each trial
  let aggCost: PathCost = { shipDistance:0, shipJumps:0, totalDistance:0 };
  while(remaining.size){
    let bestChoice: { name:string; inc:{shipDist:number; shipJumps:number; total:number} } | null = null;
    const tailName = route[route.length-1];
    const tail = systemsByName[tailName];
    for(const name of remaining){
      const next = systemsByName[name]; if(!tail || !next) continue;
      const ev = evaluateEdge(tail, next);
      if(ev.chooseShip){ if(ev.shipDistance>maxShipRange+1e-6) continue; }
      else if(ev.gateDistance===null) continue; // unreachable extension
      const inc = ev.chooseShip ? { shipDist: ev.shipDistance, shipJumps:1, total: ev.shipDistance } : { shipDist:0, shipJumps:0, total: ev.gateDistance! };
      if(!bestChoice){ bestChoice={ name, inc }; continue; }
      const bc = bestChoice.inc;
      if( inc.shipDist < bc.shipDist ||
          (inc.shipDist===bc.shipDist && inc.shipJumps < bc.shipJumps) ||
          (inc.shipDist===bc.shipDist && inc.shipJumps===bc.shipJumps && inc.total < bc.total) ){
        bestChoice={ name, inc };
      }
    }
    if(!bestChoice){
      // Bridging phase: try tail direct first
      if(connectivityGuaranteed){
        let bridgeName: string | undefined; let bridgeDist=Infinity;
        for(const name of remaining){
          const sysB = systemsByName[name]; if(!sysB || !tail) continue;
          const d = dist(tail, sysB);
          if(d <= maxShipRange+1e-6){ bridgeName=name; bridgeDist=d; break; }
        }
        if(bridgeName){
          if(debug) post({ type:'progress', message:`[DEBUG] Bridging components via ship jump ${bridgeDist.toFixed(2)} LY to ${bridgeName}` });
          route.push(bridgeName); remaining.delete(bridgeName); continue;
        }
        // Revisit bridging: find earlier anchor that can reach a remaining system, then revisit anchor and append system
        let revisitPlan: { anchor:string; target:string; d:number } | null = null;
        if(tail){
          for(const name of remaining){
            const sysTarget = systemsByName[name]; if(!sysTarget) continue;
            // Find anchor reachable from tail and that can ship-jump to target
            for(let i=0;i<route.length;i++){
              const anchor = route[i]; if(anchor===tailName) continue; // skip tail
              const sysAnchor = systemsByName[anchor]; if(!sysAnchor) continue;
              // tail -> anchor must be feasible
              const evTA = evaluateEdge(tail, sysAnchor);
              if(evTA.gateDistance===null && (!evTA.chooseShip || evTA.shipDistance>maxShipRange+1e-6)) continue;
              const dAT = dist(sysAnchor, sysTarget);
              if(dAT <= maxShipRange+1e-6){ revisitPlan={ anchor, target:name, d:dAT }; break; }
            }
            if(revisitPlan) break;
          }
        }
        if(revisitPlan){
          if(debug) post({ type:'progress', message:`[DEBUG] Revisit bridge via ${revisitPlan.anchor} -> ship ${revisitPlan.target} (${revisitPlan.d.toFixed(2)} LY)` });
          // Revisit anchor (duplicate) then add target
          route.push(revisitPlan.anchor);
          route.push(revisitPlan.target);
          remaining.delete(revisitPlan.target);
          continue;
        } else if(debug){
          // Diagnostic ordering block (no plan found)
          let altCandidate: {name:string; via:string; d:number} | null = null;
          for(const name of remaining){
            const sysB = systemsByName[name]; if(!sysB) continue;
            for(let i=0;i<route.length;i++){
              const sysA = systemsByName[route[i]]; if(!sysA) continue;
              const d = dist(sysA, sysB);
              if(d <= maxShipRange+1e-6){ altCandidate={name, via:route[i], d}; break; }
            }
            if(altCandidate) break;
          }
          if(altCandidate){
            post({ type:'progress', message:`[DEBUG] Ordering block: ${altCandidate.name} reachable from earlier ${altCandidate.via} at ${altCandidate.d.toFixed(2)} LY but not from tail ${route[route.length-1]}` });
          }
        }
      }
      // Attempt single reposition to start to change tail context before declaring unreachable
      if(route[route.length-1] !== start){ route.push(start); continue; }
      unreachable=true; break;
    } else if(debug){
      post({ type:'progress', message:`[DEBUG] NN append ${bestChoice.name} inc(shipDist=${bestChoice.inc.shipDist.toFixed(2)}, shipJumps=${bestChoice.inc.shipJumps}, total=${bestChoice.inc.total.toFixed(2)})` });
    }
    // Apply incremental cost update
    if(bestChoice){
      aggCost.shipDistance += bestChoice.inc.shipDist;
      aggCost.shipJumps += bestChoice.inc.shipJumps;
      aggCost.totalDistance += bestChoice.inc.total;
      route.push(bestChoice.name); remaining.delete(bestChoice.name);
    }
  }
  if(returnToStart) route.push(start);
  return { path:route, unreachable: unreachable || route.filter(n=>n!==start).length < candidates.filter(c=>c!==start).length };
};

// Simple 2-opt with feasibility guard (will not accept unreachable candidate)
const twoOpt = (path:string[], returnToStart:boolean, timeMs:number, debug:boolean): string[] => {
  const startTime=Date.now();
  let best=path.slice();
  const effectiveLen = returnToStart ? best.length-1 : best.length;
  const cost = (p:string[])=> computePathCost(p, returnToStart);
  let bestCost = cost(best);
  // If baseline already unreachable, return early
  if(!isFinite(bestCost.shipDistance)) return path;
  while(Date.now()-startTime<timeMs){
    let improved=false;
    for(let i=1;i<effectiveLen-2;i++){
      for(let k=i+1;k<effectiveLen-1;k++){
        // build candidate
        const newPath = best.slice(0,i).concat(best.slice(i,k+1).reverse(), best.slice(k+1));
        // Quick feasibility check: only edges affected (i-1,i) .. (k,k+1)
        let feasible=true;
        const checkEdges: [number,number][] = [];
        if(i>0) checkEdges.push([i-1,i]);
        checkEdges.push([i,k]);
        if(k+1 < best.length) checkEdges.push([k,k+1]);
        for(const [aIdx,bIdx] of checkEdges){
          const aName=newPath[aIdx], bName=newPath[bIdx];
          const a=systemsByName[aName], b=systemsByName[bName];
          if(!a||!b){ feasible=false; break; }
          const ev=evaluateEdge(a,b);
            if(ev.chooseShip){ if(ev.shipDistance>maxShipRange+1e-6){ feasible=false; break; } }
            else if(ev.gateDistance===null){ feasible=false; break; }
        }
  if(!feasible){ if(debug) post({ type:'progress', message:`[DEBUG] 2-opt reject segment (${i},${k}) infeasible` }); continue; }
        const nc = cost(newPath);
        if(!isFinite(nc.shipDistance)) continue; // safeguard
        const better = (nc.shipDistance < bestCost.shipDistance) ||
          (nc.shipDistance===bestCost.shipDistance && nc.shipJumps < bestCost.shipJumps) ||
          (nc.shipDistance===bestCost.shipDistance && nc.shipJumps===bestCost.shipJumps && nc.totalDistance < bestCost.totalDistance);
  if(better){ best=newPath; bestCost=nc; improved=true; if(debug) post({ type:'progress', message:`[DEBUG] 2-opt improve (${i},${k}) shipDist=${bestCost.shipDistance.toFixed(2)} shipJumps=${bestCost.shipJumps} total=${bestCost.totalDistance.toFixed(2)}` }); break; }
      }
      if(improved) break;
    }
    if(!improved) break;
  }
  return best;
};

// Iterative improvement (placeholder: repeated 2-opt shuffles)
const iterativeImprove = (base:string[], passes:number, timePerPassSec:number, returnToStart:boolean, progressCb:(msg:string)=>void, debug:boolean): string[] => {
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
  const improved=twoOpt(working, returnToStart, budget, debug);
    const improvedCost = computePathCost(improved, returnToStart);
    const better = (improvedCost.shipDistance < championCost.shipDistance) ||
      (improvedCost.shipDistance===championCost.shipDistance && improvedCost.shipJumps < championCost.shipJumps) ||
      (improvedCost.shipDistance===championCost.shipDistance && improvedCost.shipJumps===championCost.shipJumps && improvedCost.totalDistance < championCost.totalDistance);
    if(better){ champion=improved; championCost=improvedCost; if(debug) progressCb(`[DEBUG] Pass ${p+1} improvement shipDist=${championCost.shipDistance.toFixed(2)} shipJumps=${championCost.shipJumps} total=${championCost.totalDistance.toFixed(2)}`); }
    progressCb(`Pass ${p+1}/${passes}`);
  }
  return champion;
};

const post = (data:unknown)=>{ // @ts-ignore
  self.postMessage(data); };

// Connectivity & minimum required ship range computation.
// We treat each gate-connected component as a node; ship edges connect systems across components.
// Minimum required ship range = maximum edge length in MST over component graph (edges weighted by minimal inter-component system distance).
interface MinRangeResult { reachable:boolean; minRequired:number; }
const computeMinRequiredShipRange = (selectedNames:string[], _startName:string, maxRange:number): MinRangeResult => {
  const selectedSystems: System[] = [];
  for(const nm of selectedNames){ const s=systemsByName[nm]; if(s) selectedSystems.push(s); }
  const byId = new Map<number,System>(); selectedSystems.forEach(s=> byId.set(s.id,s));
  // Gather gate components restricted to selected systems
  const compId = new Map<number, number>(); let compCounter=0;
  for(const sys of selectedSystems){ if(compId.has(sys.id)) continue; // BFS in gate graph
    const q=[sys.id]; compId.set(sys.id, compCounter);
    while(q.length){ const cur=q.shift()!; for(const nxt of gateAdj.get(cur)||[]){ if(byId.has(nxt) && !compId.has(nxt)){ compId.set(nxt, compCounter); q.push(nxt); } } }
    compCounter++; }
  const components: number[][] = Array.from({length:compCounter}, ()=>[]);
  for(const sys of selectedSystems){ components[compId.get(sys.id)!].push(sys.id); }
  if(components.length<=1) return { reachable:true, minRequired:0 };
  // Precompute minimal distances between components
  const compDist: {a:number;b:number;d:number}[] = [];
  for(let i=0;i<components.length;i++){
    for(let j=i+1;j<components.length;j++){
      let best=Infinity;
      for(const idA of components[i]){
        const A=systemsById.get(idA)!;
        for(const idB of components[j]){
          const B=systemsById.get(idB)!; const d=dist(A,B); if(d<best) best=d;
        }
      }
      compDist.push({a:i,b:j,d:best});
    }
  }
  // Check connectivity under current maxRange
  const parent = Array.from({length:components.length}, (_,i)=>i);
  const find=(x:number):number=> parent[x]===x?x:(parent[x]=find(parent[x]));
  const unite=(a:number,b:number)=>{ a=find(a); b=find(b); if(a!==b) parent[b]=a; };
  for(const e of compDist){ if(e.d <= maxRange+1e-9) unite(e.a,e.b); }
  let root=find(0); let connected=true; for(let i=1;i<components.length;i++){ if(find(i)!==root){ connected=false; break; } }
  // Compute MST maximum edge (Kruskal) for min required ship range
  compDist.sort((x,y)=> x.d - y.d);
  for(let i=0;i<components.length;i++) parent[i]=i; let used=0; let maxEdge=0;
  for(const e of compDist){ if(used===components.length-1) break; if(find(e.a)!==find(e.b)){ unite(e.a,e.b); used++; if(e.d>maxEdge) maxEdge=e.d; } }
  return { reachable: connected, minRequired: maxEdge };
};

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
    // Connectivity pre-check
    const sel = [msg.start, ...msg.systems.filter(s=>s!==msg.start)];
    const connectivity = computeMinRequiredShipRange(sel, msg.start, maxShipRange);
    if(!connectivity.reachable){
      post({ type:'baselineError', reason:`Unreachable systems with current ship range (${maxShipRange} LY). Minimum required ~${connectivity.minRequired.toFixed(2)} LY`, minRequiredShipRange: connectivity.minRequired, generation: msg.generation });
      return;
    }
    let { path:nnPath, unreachable } = nearestNeighbor(msg.start, msg.systems, msg.returnToStart, connectivity.reachable, !!msg.debug);
    if(unreachable){ post({ type:'baselineError', reason:'Unreachable systems with current ship range / gate network', generation: msg.generation }); return; }
    // Closure salvage: if returnToStart requested and last->start edge is infeasible, try to duplicate an earlier anchor that can close.
    if(msg.returnToStart && nnPath.length>=2){
  const startName = nnPath[0];
      const lastName = nnPath[nnPath.length-1];
      if(lastName === startName && nnPath.length>2){
        // Already closed; ensure feasibility of closing edge (second-to-last -> start)
        const penultName = nnPath[nnPath.length-2];
        const a=systemsByName[penultName], b=systemsByName[startName];
        if(a && b){
          const ev=evaluateEdge(a,b);
          if(!( (ev.chooseShip && ev.shipDistance<=maxShipRange+1e-6) || (!ev.chooseShip && ev.gateDistance!==null) )){
            // Find alternative anchor able to close
            let alt:string|undefined;
            for(let i=nnPath.length-2;i>0;i--){ const cand=nnPath[i]; if(cand===startName) continue; const sA=systemsByName[cand]; const sB=systemsByName[startName]; if(!sA||!sB) continue; const ev2=evaluateEdge(sA,sB); if(ev2.gateDistance!==null || (ev2.chooseShip && ev2.shipDistance<=maxShipRange+1e-6)){ alt=cand; break; } }
            if(alt){
              // Remove existing closing start and append alt then start
              nnPath.pop(); // remove start
              nnPath.push(alt); nnPath.push(startName);
              if(msg.debug) post({ type:'progress', message:`[DEBUG] Closure salvage: switched closing anchor to ${alt}` });
            } else {
              if(msg.debug) post({ type:'progress', message:`[DEBUG] Closure failure: cannot find feasible anchor to return to start` });
            }
          }
        }
      }
    }
  const refinedPre = twoOpt(nnPath, msg.returnToStart, 250, !!msg.debug);
    let refined = refinedPre;
    let refinedCost = computePathCost(refined, msg.returnToStart);
    if(!isFinite(refinedCost.shipDistance)) {
      // fallback to original nearest neighbor path if feasible
      const nnCost = computePathCost(nnPath, msg.returnToStart);
      if(isFinite(nnCost.shipDistance)) { refined = nnPath; refinedCost = nnCost; }
      else {
        // Diagnose unreachable edge
        let diagMsg='';
        for(let i=0;i<nnPath.length-1;i++){
          const aName=nnPath[i], bName=nnPath[i+1];
          const a=systemsByName[aName], b=systemsByName[bName]; if(!a||!b) continue;
          const ev=evaluateEdge(a,b);
          if(ev.gateDistance===null && (!ev.chooseShip || ev.shipDistance>maxShipRange+1e-6)){
            const d = dist(a,b).toFixed(2);
            diagMsg = ` Unreachable edge ${aName} -> ${bName} direct=${d}LY (max ${maxShipRange}).`;
            break;
          }
        }
        post({ type:'progress', message:`[DEBUG] Baseline unreachable diagnostics:${diagMsg||' (no edge found??)'}` });
        post({ type:'baselineError', reason:'Route optimization produced unreachable segment', generation: msg.generation });
        return;
      }
    }
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
  const champion = iterativeImprove(msg.path, msg.passes, msg.timePerPassSec, msg.returnToStart, (m)=>post({ type:'progress', message:m }), !!msg.debug);
    post({ type:'optimizeResult', path: champion, generation: msg.generation });
  } else if(msg.type==='stop'){
    stopping=true; post({ type:'stopped' });
  }
};

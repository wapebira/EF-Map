// Simple test harness for Scout Optimizer cost logic
// Mirrors evaluateEdge and computePathCost from worker after refactor.

function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z; return Math.sqrt(dx*dx+dy*dy+dz*dz); }

function buildGateAdj(gates){ const adj=new Map(); for(const g of gates){ if(!adj.has(g[0])) adj.set(g[0],[]); if(!adj.has(g[1])) adj.set(g[1],[]); adj.get(g[0]).push(g[1]); adj.get(g[1]).push(g[0]); } return adj; }

function evaluateEdge(a,b,adj,systems,{maxShipRange, shipTradeDistance, minGateHopsSaved}){
  // BFS gate path
  let gateDistance=null, gateHops=null; const start=a.id, goal=b.id;
  const q=[[start]]; const seen=new Set([start]);
  while(q.length){ const path=q.shift(); const last=path[path.length-1]; if(last===goal){ gateHops=path.length-1; let total=0; for(let i=0;i<path.length-1;i++){ total+=dist(systems[path[i]], systems[path[i+1]]);} gateDistance=total; break; } for(const nxt of (adj.get(last)||[])){ if(!seen.has(nxt)){ seen.add(nxt); q.push([...path,nxt]); } } }
  const shipDistance = dist(a,b);
  let chooseShip=false;
  if(gateDistance===null){ if(shipDistance <= maxShipRange) chooseShip=true; else return { gateDistance:null, gateHops:null, shipDistance:Infinity, chooseShip:false}; }
  else { const gateTradeAllowed = shipDistance <= shipTradeDistance && gateHops >= minGateHopsSaved; if(gateTradeAllowed) chooseShip=true; }
  return { gateDistance, gateHops, shipDistance, chooseShip };
}

function computePathCost(path, systems, adj, params){
  let shipDistance=0, shipJumps=0, totalDistance=0; for(let i=0;i<path.length-1;i++){ const a=systems[path[i]], b=systems[path[i+1]]; const ev=evaluateEdge(a,b,adj,systems,params); if(ev.chooseShip){ shipDistance+=ev.shipDistance; shipJumps++; totalDistance+=ev.shipDistance; } else if(ev.gateDistance!==null){ totalDistance+=ev.gateDistance; } else { return {shipDistance:Infinity, shipJumps:Infinity, totalDistance:Infinity}; } } return { shipDistance, shipJumps, totalDistance }; }

// Scenario definitions
const systems = {
  1:{id:1,x:0,y:0,z:0}, // A
  2:{id:2,x:1,y:0,z:0}, // B
  3:{id:3,x:2,y:0,z:0}, // C
  4:{id:4,x:10,y:0,z:0} // D
};
// Gates A-B, B-C (A<->B<->C). No gate to D.
const adj = buildGateAdj([[1,2],[2,3]]);

function testAlwaysPreferGate(){
  const params={ maxShipRange:60, shipTradeDistance:0, minGateHopsSaved:999};
  const cost = computePathCost([1,3], systems, adj, params); // Should use gates (A-B-C)
  console.log('Test 1 (prefer gate path A->C):', cost);
}

function testTradeRuleAllowsShortShip(){
  const params={ maxShipRange:60, shipTradeDistance:2.5, minGateHopsSaved:2 }; // ship distance A->C =2; gate hops 2
  const cost = computePathCost([1,3], systems, adj, params); // Should choose ship (shipDistance 2)
  console.log('Test 2 (trade rule chooses ship A->C):', cost);
}

function testUnreachableNeedsShipWithinRange(){
  const params={ maxShipRange:15, shipTradeDistance:0, minGateHopsSaved:999};
  const cost = computePathCost([3,4], systems, adj, params); // No gates C->D, ship allowed
  console.log('Test 3 (unreachable gate, ship within range C->D):', cost);
}

function testUnreachableTooFar(){
  const params={ maxShipRange:5, shipTradeDistance:0, minGateHopsSaved:999};
  const cost = computePathCost([3,4], systems, adj, params); // Ship too far -> Infinity
  console.log('Test 4 (unreachable & beyond range C->D):', cost);
}

testAlwaysPreferGate();
testTradeRuleAllowsShortShip();
testUnreachableNeedsShipWithinRange();
testUnreachableTooFar();

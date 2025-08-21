import { useCallback, useRef, useState, useEffect } from 'react';
import '../P2PRouting/P2PRouting.css';
import './ScoutOptimizer.css';
import AutoCompleteInput from '../AutoCompleteInput/AutoCompleteInput';

interface SolarSystem { id:number; name:string; position:{x:number;y:number;z:number}; region_id:number; constellation_id:number; planets:number }
interface Stargate { source_system_id:number; destination_system_id:number }
interface MapData { solar_systems:{[k:string]:SolarSystem}; stargates:{[k:string]:Stargate} }

interface ScoutOptimizerProps {
	open: boolean;
	onToggle:(open:boolean)=>void;
	mapData: MapData | null;
	systemNames: string[];
	returnToStart: boolean;
	onReturnToStartChange:(v:boolean)=>void;
	onBaselineRoute?:(path:string[])=>void;
	onOptimizedRoute?:(path:string[])=>void;
	onClearRoute?:()=>void;
	invalidateToken?: number; // external invalidation (e.g. P2P route started)
	importedRoutePath?: string[] | null; // path supplied from shared URL (expanded display path)
}

const MAX_SYSTEMS_WARNING = 300;

const ScoutOptimizer = ({ open, onToggle, mapData, systemNames, returnToStart, onReturnToStartChange, onBaselineRoute, onOptimizedRoute, onClearRoute, invalidateToken, importedRoutePath }: ScoutOptimizerProps) => {
	const [startSystem, setStartSystem] = useState('');
	const [radius, setRadius] = useState('50');
	const [useRegion, setUseRegion] = useState(false);
	const [gateReachableOnly, setGateReachableOnly] = useState(false);
	// Continuous optimization controls
	const [maxOptimizeTime, setMaxOptimizeTime] = useState('60');
	const [stallTimeout, setStallTimeout] = useState('10');
	// Debug mode removed for production build (was used for verbose worker diagnostics)
	// Minimum required ship range (computed when baseline error received)
	const [minRequiredShipRange, setMinRequiredShipRange] = useState<number|null>(null);
	// Ship vs Gate preference inputs
	const [shipMaxRange, setShipMaxRange] = useState('60');
	const [shipTradeDistance, setShipTradeDistance] = useState('0');
	const [minGateHopsSaved, setMinGateHopsSaved] = useState('999');
	const [workerCount, setWorkerCount] = useState(()=> Math.max(1,(navigator.hardwareConcurrency||4)-2).toString());
	const [statusLog, setStatusLog] = useState<string[]>([]);
	const [isCalculating, setIsCalculating] = useState(false);
	// User toggles
	const [compactPref, setCompactPref] = useState(false);
	const [hideInputsPref, setHideInputsPref] = useState(false); // persists after optimization
	const [smallViewport, setSmallViewport] = useState(false);
	const effectiveCompact = compactPref || smallViewport; // no longer forced by optimization
	const effectiveHideInputs = hideInputsPref; // inputs hidden only if user (or auto-set at start) chose so
	// Macro path = optimization path (visited target systems order)
	const [championPath, setChampionPath] = useState<string[]|null>(null);
	// Display path = macro path expanded into individual gate hops (BFS) so gate segments are shown instead of ship jumps when possible
	const [championDisplayPath, setChampionDisplayPath] = useState<string[]|null>(null);
	const [championDistance, setChampionDistance] = useState<number|null>(null);
	// Ship jump metrics for current champion (lexicographic primary criteria)
	const [championShipJumps, setChampionShipJumps] = useState<number|null>(null);
	const [championShipDistance, setChampionShipDistance] = useState<number|null>(null);
	// Track baseline distance separately for improvement % display
	const baselineDistanceRef = useRef<number|null>(null);
	const [datasetChanged, setDatasetChanged] = useState(false);
	const championPathRef = useRef<string[]|null>(null); // macro path ref
	const championDisplayPathRef = useRef<string[]|null>(null);
	// Track last baseline return-to-start setting to know when to recompute
	const lastReturnToStartRef = useRef(returnToStart);
	// Track last system selection signature
	const systemSignatureRef = useRef<string>('');
	// Track previous selection parameter values for reason logging
	const prevParamsRef = useRef({ startSystem:'', radius:'', useRegion:false, gateReachableOnly:false });
	const [copyButtonText, setCopyButtonText] = useState('Copy');
	// Note export (paged like P2P)
	const [notePages, setNotePages] = useState<string[]>([]);
	const [activeNotePage, setActiveNotePage] = useState(0);
	const workersRef = useRef<Worker[]>([]);
	const workerStatusRef = useRef<{ state:'idle'|'baseline'|'running'|'restarting'|'done'; lastImprovement:number }[]>([]);
	const lastGlobalImprovementRef = useRef<number>(0);
	const optimizationStartTimeRef = useRef<number>(0);
	const globalMonitorRef = useRef<number|undefined>(undefined);
	const totalMaxTimeSecRef = useRef<number>(0);
	const systemsForRunRef = useRef<string[]>([]);
	const baselineDoneRef = useRef(false);
	// Legacy pass tracking removed (continuous mode)
	const readyCountRef = useRef(0);
	const pendingBaselineRef = useRef<{ start:string; systems:string[]; returnToStart:boolean }|null>(null);
	// Generation token to ignore late worker messages after invalidation or new run
	const generationRef = useRef(0);

	const stargatesArray = mapData ? Object.values(mapData.stargates) : [];
	const gatesBySource: {[id:number]: number[]} = {}; stargatesArray.forEach(g=>{ if(!gatesBySource[g.source_system_id]) gatesBySource[g.source_system_id]=[]; gatesBySource[g.source_system_id].push(g.destination_system_id); if(!gatesBySource[g.destination_system_id]) gatesBySource[g.destination_system_id]=[]; gatesBySource[g.destination_system_id].push(g.source_system_id); });

	const log = useCallback((line:string)=> setStatusLog(l=> [...l.slice(-400), line]),[]);

	const collectSystems = useCallback(()=>{
		if(!mapData) return [] as string[];
		const start = Object.values(mapData.solar_systems).find(s=> s.name.toLowerCase()===startSystem.toLowerCase());
		if(!start) return [];
		let candidates: SolarSystem[] = [];
		if(useRegion){
			candidates = Object.values(mapData.solar_systems).filter(s=> s.region_id === start.region_id);
		} else {
			const r = parseFloat(radius); if(!isFinite(r) || r<=0) return [];
			candidates = Object.values(mapData.solar_systems).filter(s=> {
				const dx=s.position.x-start.position.x, dy=s.position.y-start.position.y, dz=s.position.z-start.position.z; const d=Math.sqrt(dx*dx+dy*dy+dz*dz); return d <= r; });
		}
		if(gateReachableOnly){
			const reachable = new Set<number>();
			const q=[start.id]; reachable.add(start.id);
			while(q.length){ const cur=q.shift()!; for(const nxt of gatesBySource[cur]||[]){ if(!reachable.has(nxt)){ reachable.add(nxt); q.push(nxt);} } }
			candidates = candidates.filter(c=> reachable.has(c.id));
		}
		return candidates.map(c=>c.name);
	},[mapData, startSystem, radius, useRegion, gateReachableOnly, gatesBySource]);

	const systemsWarning = open ? (collectSystems().length > MAX_SYSTEMS_WARNING) : false;

	// Stats helper: counts before/after gateReachable filter (for testing region mode correctness)
	const collectSystemsStats = useCallback(()=>{
		if(!mapData) return { all:0, filtered:0 };
		const start = Object.values(mapData.solar_systems).find(s=> s.name.toLowerCase()===startSystem.toLowerCase());
		if(!start) return { all:0, filtered:0 };
		let candidates = Object.values(mapData.solar_systems).filter(s=> useRegion ? (s.region_id===start.region_id) : (()=>{ const r=parseFloat(radius); if(!isFinite(r)||r<=0) return false; const dx=s.position.x-start.position.x, dy=s.position.y-start.position.y, dz=s.position.z-start.position.z; return Math.sqrt(dx*dx+dy*dy+dz*dz)<=r; })());
		const all = candidates.length;
		if(gateReachableOnly){
			const reachable = new Set<number>(); const q=[start.id]; reachable.add(start.id);
			while(q.length){ const cur=q.shift()!; for(const nxt of gatesBySource[cur]||[]){ if(!reachable.has(nxt)){ reachable.add(nxt); q.push(nxt);} } }
			candidates = candidates.filter(c=> reachable.has(c.id));
		}
		return { all, filtered: candidates.length };
	},[mapData, startSystem, radius, useRegion, gateReachableOnly, gatesBySource]);

	const systemStats = open ? collectSystemsStats() : { all:0, filtered:0 };

	const ensureWorkers = useCallback(()=>{
		const desired = parseInt(workerCount,10); if(workersRef.current.length===desired) return;
		workersRef.current.forEach(w=> w.terminate()); workersRef.current=[];
		workerStatusRef.current=[]; lastGlobalImprovementRef.current=0;
		if(globalMonitorRef.current!==undefined){ clearInterval(globalMonitorRef.current); globalMonitorRef.current=undefined; }
		readyCountRef.current = 0;
		for(let i=0;i<desired;i++){
			const w = new Worker(new URL('../../workers/scout_optimizer_worker.ts', import.meta.url), { type:'module' });
			w.onmessage = (e)=>{
				const data = e.data;
				if(data.type==='ready') { 
					readyCountRef.current += 1;
					log(`Worker ${i+1} ready`);
					if(pendingBaselineRef.current && readyCountRef.current === parseInt(workerCount,10)) {
						const pb = pendingBaselineRef.current; pendingBaselineRef.current=null;
						const baselineParams = { maxShipRange: parseFloat(shipMaxRange)||0, shipTradeDistance: parseFloat(shipTradeDistance)||0, minGateHopsSaved: parseInt(minGateHopsSaved,10)||0 };
						workersRef.current.forEach(w2=> w2.postMessage({ type:'baseline', ...pb, ...baselineParams, generation: generationRef.current }));
						workerStatusRef.current.forEach(s=>{ s.state='baseline'; s.lastImprovement=Date.now(); });
					}
				}
				else if(data.type==='baselineResult') { if(data.generation===undefined || data.generation===generationRef.current) handleBaselineResult(data.path, data.shipJumps, data.shipDistance); }
				else if(data.type==='baselineError') { if(data.generation===undefined || data.generation===generationRef.current){
					log(`Baseline error: ${data.reason}`);
					setIsCalculating(false);
					if(data.minRequiredShipRange!==undefined){ setMinRequiredShipRange(data.minRequiredShipRange); }
				} }
				else if(data.type==='optimizeResult') { if(data.generation===undefined || data.generation===generationRef.current) handleOptimizeResult(data.path, data.shipJumps, data.shipDistance, i); }
				else if(data.type==='optimizeDone') { if(data.generation===undefined || data.generation===generationRef.current){ /* per-worker done handled in future enhancement */ } }
				else if(data.type==='progress') { log(`Worker ${i+1}: ${data.message}`); }
				else if(data.type==='stopped') { log(`Worker ${i+1} stopped.`); }
			};
			workersRef.current.push(w);
			workerStatusRef.current.push({ state:'idle', lastImprovement: Date.now() });
		}
	},[workerCount, log, shipMaxRange, shipTradeDistance, minGateHopsSaved]);

	const broadcast = (msg:unknown) => { workersRef.current.forEach(w=> w.postMessage(msg as any)); };

	// External invalidation: clear any existing route & terminate workers so stale messages don't redraw
	useEffect(()=>{
		// ONLY act when the invalidate token itself changes; do not depend on other states
		if(invalidateToken === undefined) return;
		if(championPathRef.current || isCalculating){
			log('Scout route cleared due to external routing action.');
			generationRef.current += 1; // bump generation to invalidate in-flight worker results
			setChampionPath(null);
			championPathRef.current = null;
			setChampionDistance(null);
			baselineDoneRef.current = false;
			pendingBaselineRef.current = null;
			setIsCalculating(false);
			workersRef.current.forEach(w=>{ try{ w.terminate(); }catch(e){} });
			workersRef.current = [];
			try { onClearRoute && onClearRoute(); } catch(e){/* ignore */}
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [invalidateToken]);

	const startCalculation = () => {
		if(!mapData) return;
		const collected = collectSystems();
		if(!collected.length){ alert('No systems collected (check start system / radius / region).'); return; }
		setMinRequiredShipRange(null); // reset previous requirement banner
		systemsForRunRef.current = collected;
		const signature = collected.slice().sort().join('|');
		systemSignatureRef.current = signature;
		setDatasetChanged(false);
		generationRef.current += 1; // new generation for this run
		ensureWorkers();
		setIsCalculating(true);
		baselineDoneRef.current=false;
		log(`Collected ${collected.length} systems. Gate pref: ship≤${shipTradeDistance}LY replaces ≥${minGateHopsSaved} gate hops (max ship range ${shipMaxRange}LY).`);
		broadcast({ type:'init', systems: mapData.solar_systems, stargates: mapData.stargates });
		pendingBaselineRef.current = { start: startSystem, systems: collected, returnToStart };
		// If workers already ready (zero restart scenario) fire immediately
		if(readyCountRef.current === workersRef.current.length && workersRef.current.length>0) {
			const pb = pendingBaselineRef.current; pendingBaselineRef.current=null;
			workersRef.current.forEach(w=> w.postMessage({ type:'baseline', ...pb!, generation: generationRef.current, maxShipRange: parseFloat(shipMaxRange)||0, shipTradeDistance: parseFloat(shipTradeDistance)||0, minGateHopsSaved: parseInt(minGateHopsSaved,10)||0 }));
		}
	};

	// Expand macro path into gate-level sequence using BFS; inserts intermediate gate systems so renderer/export treat them as gate hops
	const expandPathToGateSequence = useCallback((path:string[]):string[]=>{
		if(!mapData) return path;
		const nameToSystem: {[n:string]:SolarSystem} = Object.values(mapData.solar_systems).reduce((acc,s)=>{ acc[s.name.toLowerCase()]=s; return acc; },{} as {[n:string]:SolarSystem});
		const bfs = (a:SolarSystem,b:SolarSystem):SolarSystem[]|null => {
			if(a.id===b.id) return [a];
			const q:number[][]=[[a.id]]; const seen=new Set<number>([a.id]);
			while(q.length){
				const cur=q.shift()!; const last=cur[cur.length-1];
				if(last===b.id){ return cur.map(id=> mapData.solar_systems[id.toString()]).filter(Boolean); }
				for(const nxt of gatesBySource[last]||[]){ if(!seen.has(nxt)){ seen.add(nxt); q.push([...cur,nxt]); } }
			}
			return null;
		};
		const expanded:string[] = [];
		for(let i=0;i<path.length-1;i++){
			const a = nameToSystem[path[i].toLowerCase()];
			const b = nameToSystem[path[i+1].toLowerCase()];
			if(!a||!b){ if(expanded.length===0) expanded.push(path[i]); expanded.push(path[i+1]); continue; }
			const chain = bfs(a,b);
			if(chain && chain.length>1){
				// append chain, avoid duplicating first if already last of expanded
				for(let cIdx=0;cIdx<chain.length;cIdx++){
					const name = chain[cIdx].name;
					if(cIdx===0 && expanded.length && expanded[expanded.length-1]===name) continue;
					expanded.push(name);
				}
			}else{
				// fallback direct (ship jump)
				if(expanded.length===0) expanded.push(a.name);
				expanded.push(b.name);
			}
		}
		if(expanded.length===0 && path.length){ return path.slice(); }
		return expanded;
	},[mapData,gatesBySource]);

	const handleBaselineResult = (path:string[], workerShipJumps?:number, workerShipDistance?:number) => {
		if(baselineDoneRef.current) return;
		baselineDoneRef.current=true;
		setChampionPath(path);
		championPathRef.current = path;
		const expanded = expandPathToGateSequence(path);
		setChampionDisplayPath(expanded);
		championDisplayPathRef.current = expanded;
		const distVal = computeRouteDistance(path);
		setChampionDistance(distVal);
		// prefer worker metrics if provided (authoritative from optimization logic)
		if(workerShipJumps!==undefined && workerShipDistance!==undefined){
			setChampionShipJumps(workerShipJumps);
			setChampionShipDistance(workerShipDistance);
		} else {
			const shipMetrics = computeShipMetrics(path);
			setChampionShipJumps(shipMetrics.shipJumps);
			setChampionShipDistance(shipMetrics.shipDistance);
		}
		baselineDistanceRef.current = distVal; // store baseline distance for improvement stats
		log(`Baseline distance: ${distVal.toFixed(2)} LY over ${path.length} systems`);
		try { onBaselineRoute && onBaselineRoute(expanded); } catch(e) { /* ignore */ }
		// End baseline phase so user can immediately continue or copy
		setIsCalculating(false);
		log('Baseline complete. You can Start Optimization to refine the route.');
	};

	const handleOptimizeResult = (path:string[], workerShipJumps?:number, workerShipDistance?:number, workerIndex?:number) => {
		if(workerIndex!==undefined){
			const st = workerStatusRef.current[workerIndex];
			if(st){ st.lastImprovement = Date.now(); if(st.state!=='running') st.state='running'; }
		}
		setChampionPath(prev=>{
			const candDist = computeRouteDistance(path);
			if(!prev){
				if(workerIndex!==undefined) log(`Worker ${workerIndex+1} produced initial candidate.`);
				setChampionDistance(candDist);
				if(workerShipJumps!==undefined && workerShipDistance!==undefined){
					setChampionShipJumps(workerShipJumps); setChampionShipDistance(workerShipDistance);
				} else {
					const m = computeShipMetrics(path); setChampionShipJumps(m.shipJumps); setChampionShipDistance(m.shipDistance);
				}
				log(`Initial optimization candidate distance: ${candDist.toFixed(2)} LY (${path.length} systems)`);
				championPathRef.current = path;
				const expanded = expandPathToGateSequence(path); setChampionDisplayPath(expanded); championDisplayPathRef.current = expanded;
				lastGlobalImprovementRef.current = Date.now();
				return path;
			}
			const currentDist = championDistance ?? computeRouteDistance(prev);
			if(candDist + 1e-6 < currentDist){
				setChampionDistance(candDist);
				if(workerShipJumps!==undefined && workerShipDistance!==undefined){
					setChampionShipJumps(workerShipJumps); setChampionShipDistance(workerShipDistance);
				} else {
					const m = computeShipMetrics(path); setChampionShipJumps(m.shipJumps); setChampionShipDistance(m.shipDistance);
				}
				log(`Improved champion${workerIndex!==undefined?` (worker ${workerIndex+1})`:''}: ${currentDist.toFixed(2)} -> ${candDist.toFixed(2)} LY`);
				championPathRef.current = path;
				const expanded = expandPathToGateSequence(path); setChampionDisplayPath(expanded); championDisplayPathRef.current = expanded;
				lastGlobalImprovementRef.current = Date.now();
				return path;
			} else {
				log(`No improvement (candidate ${candDist.toFixed(2)} LY, champion ${currentDist.toFixed(2)} LY)`);
				return prev;
			}
		});
		// Notify parent of latest champion (immediate feedback)
		if(onOptimizedRoute && championDisplayPathRef.current){ try { onOptimizedRoute(championDisplayPathRef.current); } catch(e){/* ignore */} }
	};

// removed runOptimizationPasses (replaced by continuous optimization)

	const stop = () => {
		// Invalidate any in-flight worker work by bumping generation
		generationRef.current += 1;
		// Ask workers to stop and then terminate them to guarantee halt
		workersRef.current.forEach(w=> { try { w.postMessage({ type:'stop' }); } catch(e){} });
		setTimeout(() => { workersRef.current.forEach(w=> { try { w.terminate(); } catch(e){} }); workersRef.current=[]; }, 50);
		workerStatusRef.current.forEach(ws=> ws.state='done');
		setIsCalculating(false);
		if(globalMonitorRef.current!==undefined){ clearInterval(globalMonitorRef.current); globalMonitorRef.current=undefined; }
		log('Stopped.');
	};

	const startContinuousOptimization = () => {
		if(!championPath){ alert('Baseline not finished yet.'); return; }
		const total = parseFloat(maxOptimizeTime)||0; const stall = parseFloat(stallTimeout)||0;
		setIsCalculating(true);
		setHideInputsPref(true); // auto-hide inputs (but allow user to re-show if they uncheck)
		log(`Starting optimization: max ${total||'∞'}s, global stall ${stall||'∞'}s on ${workersRef.current.length||1} workers.`);
		optimizationStartTimeRef.current = Date.now();
		lastGlobalImprovementRef.current = Date.now();
		totalMaxTimeSecRef.current = total;
		// Reset worker statuses
		workerStatusRef.current.forEach(ws=>{ ws.state='running'; ws.lastImprovement=Date.now(); });
		// Send optimize with stallTimeoutSec=0 so workers never self-terminate; UI orchestrates stalls
		broadcast({ type:'optimizeContinuous', path: championPath, maxTimeSec: total, stallTimeoutSec: 0, returnToStart, generation: generationRef.current, maxShipRange: parseFloat(shipMaxRange)||0, shipTradeDistance: parseFloat(shipTradeDistance)||0, minGateHopsSaved: parseInt(minGateHopsSaved,10)||0 });
		// Start global monitor interval
		if(globalMonitorRef.current!==undefined){ clearInterval(globalMonitorRef.current); }
		globalMonitorRef.current = window.setInterval(()=>{
			const now = Date.now();
			// Time budget reached?
			if(total>0 && (now - optimizationStartTimeRef.current) / 1000 >= total){
				log('Max optimization time reached. Stopping workers.');
				stop();
				if(globalMonitorRef.current!==undefined){ clearInterval(globalMonitorRef.current); globalMonitorRef.current=undefined; }
				return;
			}
			// Per-worker stall restart
			if(stall>0){
				workerStatusRef.current.forEach((ws,idx)=>{
					if(ws.state==='running' && (now - ws.lastImprovement)/1000 >= stall){
						// Diversify: take current champion and apply a random segment reversal locally before restart
						if(championPathRef.current){
							const diversified = diversifyPath(championPathRef.current);
							ws.state='restarting';
							log(`Worker ${idx+1} stalled. Diversifying & restarting.`);
							workersRef.current[idx].postMessage({ type:'stop' }); // ensure old loop halts if any
							// Relaunch after short timeout to allow stop to process
							setTimeout(()=>{
								if(!isCalculating) return;
								ws.state='running'; ws.lastImprovement=Date.now();
								workersRef.current[idx].postMessage({ type:'optimizeContinuous', path: diversified, maxTimeSec: total - ((Date.now()-optimizationStartTimeRef.current)/1000), stallTimeoutSec: 0, returnToStart, generation: generationRef.current, maxShipRange: parseFloat(shipMaxRange)||0, shipTradeDistance: parseFloat(shipTradeDistance)||0, minGateHopsSaved: parseInt(minGateHopsSaved,10)||0 });
							}, 50);
						}
					}
				});
				// Global stall detection
				if((now - lastGlobalImprovementRef.current)/1000 >= stall){
					if(championPathRef.current){
						log('Global stall detected. Diversifying all workers.');
						const diversifiedGlobal = diversifyPath(championPathRef.current);
						workerStatusRef.current.forEach(ws=>{ ws.state='restarting'; ws.lastImprovement=Date.now(); });
						workersRef.current.forEach((w,idx)=>{
							w.postMessage({ type:'stop' });
							setTimeout(()=>{
								if(!isCalculating) return;
								workerStatusRef.current[idx].state='running'; workerStatusRef.current[idx].lastImprovement=Date.now();
								w.postMessage({ type:'optimizeContinuous', path: diversifyPath(diversifiedGlobal), maxTimeSec: total - ((Date.now()-optimizationStartTimeRef.current)/1000), stallTimeoutSec: 0, returnToStart, generation: generationRef.current, maxShipRange: parseFloat(shipMaxRange)||0, shipTradeDistance: parseFloat(shipTradeDistance)||0, minGateHopsSaved: parseInt(minGateHopsSaved,10)||0 });
							}, 50);
						});
						lastGlobalImprovementRef.current = Date.now(); // reset to give new attempts time
					}
				}
			}
		}, 1000);
	};

	// Diversification helper: random segment reversal clone
	const diversifyPath = (path:string[]):string[] => {
		const p = path.slice();
		if(p.length>6){
			const a=1+Math.floor(Math.random()*(p.length-4));
			const b=a+2+Math.floor(Math.random()*(p.length-a-3));
			const seg=p.slice(a,b).reverse();
			p.splice(a,b-a,...seg);
		}
		return p;
	};

	// Recalculate baseline automatically when Return to Start toggled after baseline computed
	useEffect(()=>{
		if(!baselineDoneRef.current) { lastReturnToStartRef.current = returnToStart; return; }
		if(lastReturnToStartRef.current !== returnToStart && championPath && !isCalculating){
			log(`Return to Start toggled ${returnToStart ? 'ON' : 'OFF'}; recalculating baseline.`);
			baselineDoneRef.current = false;
			setIsCalculating(true);
			pendingBaselineRef.current = { start: startSystem, systems: systemsForRunRef.current, returnToStart };
			generationRef.current += 1; // invalidate previous generation
			// If all workers already ready, dispatch immediately
			if(readyCountRef.current === workersRef.current.length && workersRef.current.length>0){
				const pb = pendingBaselineRef.current; pendingBaselineRef.current=null;
				const baselineParams = { maxShipRange: parseFloat(shipMaxRange)||0, shipTradeDistance: parseFloat(shipTradeDistance)||0, minGateHopsSaved: parseInt(minGateHopsSaved,10)||0 };
				workersRef.current.forEach(w=> w.postMessage({ type:'baseline', ...pb!, ...baselineParams, generation: generationRef.current }));
			}
		}
		lastReturnToStartRef.current = returnToStart;
	}, [returnToStart, championPath, isCalculating, startSystem, log, shipMaxRange, shipTradeDistance, minGateHopsSaved]);

	// Log when region vs radius or gateReachableOnly toggles to aid testing
	useEffect(()=>{
		if(!open) return;
		const { all, filtered } = systemStats;
		if(useRegion){
			log(`Region selection: ${filtered}${gateReachableOnly?` (gate-filtered from ${all})`:''}`);
		}else{
			log(`Radius selection: ${filtered}${gateReachableOnly?` (gate-filtered from ${all})`:''}`);
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [useRegion, gateReachableOnly, startSystem, radius, open]);

	// Detect dataset changes after a baseline/optimization has been produced
	useEffect(()=>{
		if(!championPath || isCalculating) return; // nothing to invalidate or currently recalculating
		const newList = collectSystems();
		const newSig = newList.slice().sort().join('|');
		if(!newSig) return; // incomplete input
		if(systemSignatureRef.current && newSig !== systemSignatureRef.current){
			// Determine reason(s)
			const prev = prevParamsRef.current;
			const reasons:string[] = [];
			if(prev.startSystem !== startSystem) reasons.push('start system');
			if(prev.radius !== radius) reasons.push('radius');
			if(prev.useRegion !== useRegion) reasons.push('region/radius mode');
			if(prev.gateReachableOnly !== gateReachableOnly) reasons.push('gate-reachable filter');
			log(`System set changed (${reasons.join(', ')||'parameters changed'}). Previous route invalidated.`);
			setChampionPath(null);
			championPathRef.current = null;
			setChampionDisplayPath(null);
			championDisplayPathRef.current = null;
			setChampionDistance(null);
			baselineDoneRef.current=false;
			setDatasetChanged(true);
			try { onClearRoute && onClearRoute(); } catch(e){/* ignore */}
		}
		prevParamsRef.current = { startSystem, radius, useRegion, gateReachableOnly };
	}, [startSystem, radius, useRegion, gateReachableOnly, collectSystems, championPath, isCalculating, log]);

	// ---- Distance utilities (gate-aware) ----
	const systemCacheByName = useRef<{[n:string]:SolarSystem}>({});
	useEffect(()=>{
		if(mapData){ systemCacheByName.current = Object.values(mapData.solar_systems).reduce((acc,s)=>{ acc[s.name]=s; return acc; },{} as {[n:string]:SolarSystem}); }
	},[mapData]);

	// Memoized pair distance (nameA|nameB sorted key)
	const pairDistanceCache = useRef<Map<string, number>>(new Map());
	const computeSystemDistance = useCallback((aName:string,bName:string):number=>{
		if(aName===bName) return 0;
		const key = aName < bName ? aName+'|'+bName : bName+'|'+aName;
		const cached = pairDistanceCache.current.get(key); if(cached!==undefined) return cached;
		const a = systemCacheByName.current[aName]; const b = systemCacheByName.current[bName];
		if(!a||!b){ pairDistanceCache.current.set(key, Infinity); return Infinity; }
		// BFS for gate path
		const start=a.id, goal=b.id;
		const q:number[][]=[[start]]; const seen=new Set<number>([start]); let best:number|undefined;
		while(q.length && best===undefined){
			const path=q.shift()!; const last=path[path.length-1];
			if(last===goal){
				let total=0; for(let i=0;i<path.length-1;i++){ const s1=mapData!.solar_systems[path[i].toString()], s2=mapData!.solar_systems[path[i+1].toString()]; if(!s1||!s2){ total=Infinity; break;} const dx=s1.position.x-s2.position.x, dy=s1.position.y-s2.position.y, dz=s1.position.z-s2.position.z; total+=Math.sqrt(dx*dx+dy*dy+dz*dz); }
				best=total; break;
			}
			for(const nxt of gatesBySource[last]||[]){ if(!seen.has(nxt)){ seen.add(nxt); q.push([...path,nxt]); } }
		}
		if(best===undefined){ // direct ship jump
			const dx=a.position.x-b.position.x, dy=a.position.y-b.position.y, dz=a.position.z-b.position.z; best=Math.sqrt(dx*dx+dy*dy+dz*dz);
		}
		pairDistanceCache.current.set(key, best!);
		return best!;
	},[mapData, gatesBySource]);

	const computeRouteDistance = useCallback((path:string[]):number=>{
		let total=0; for(let i=0;i<path.length-1;i++){ total+=computeSystemDistance(path[i], path[i+1]); }
		return total;
	},[computeSystemDistance]);

	// Ship metrics (ship jump count & total ship jump distance) using current ship/gate trade parameters
	const computeShipMetrics = useCallback((path:string[]):{ shipJumps:number; shipDistance:number }=>{
		if(!mapData) return { shipJumps:0, shipDistance:0 };
		const maxRange = parseFloat(shipMaxRange)||0;
		const tradeDist = parseFloat(shipTradeDistance)||0;
		const minHops = parseInt(minGateHopsSaved,10)||0;
		const nameToSystem: {[n:string]:SolarSystem} = Object.values(mapData.solar_systems).reduce((acc,s)=>{ acc[s.name.toLowerCase()]=s; return acc; },{} as {[n:string]:SolarSystem});
		let shipJumps=0, shipDistance=0;
		for(let i=0;i<path.length-1;i++){
			const a = nameToSystem[path[i].toLowerCase()];
			const b = nameToSystem[path[i+1].toLowerCase()];
			if(!a||!b) continue;
			// BFS gate path to find hops
			let gateFound = false; let gateHops = 0;
			const q:number[][]=[[a.id]]; const seen=new Set<number>([a.id]);
			while(q.length && !gateFound){
				const chain=q.shift()!; const last=chain[chain.length-1];
				if(last===b.id){ gateFound=true; gateHops=chain.length-1; break; }
				for(const nxt of gatesBySource[last]||[]){ if(!seen.has(nxt)){ seen.add(nxt); q.push([...chain,nxt]); } }
			}
			const dx=a.position.x-b.position.x, dy=a.position.y-b.position.y, dz=a.position.z-b.position.z; const shipD=Math.sqrt(dx*dx+dy*dy+dz*dz);
			let chooseShip=false;
			if(!gateFound){ if(shipD <= maxRange) chooseShip=true; }
			else { if(shipD <= tradeDist && gateHops >= minHops) chooseShip=true; }
			if(chooseShip){ shipJumps+=1; shipDistance+=shipD; }
		}
		return { shipJumps, shipDistance };
	},[mapData, shipMaxRange, shipTradeDistance, minGateHopsSaved, gatesBySource]);

	// --- Scout Note Formatting (mirrors P2P with loop-back segmentation) ---
	const MAX_NOTE_LENGTH = 1500;
	const formatRouteToNotes = useCallback((path: string[], data: MapData): string[] => {
		if(path.length < 2) return [];
		const systemsByName: Map<string, SolarSystem> = new Map(Object.values(data.solar_systems).map(s => [s.name.toLowerCase(), s]));
		const pathSystems = path.map(n => systemsByName.get(n.toLowerCase())).filter(Boolean) as SolarSystem[];
		if(pathSystems.length < 2) return [];

		// Precompute gate adjacency lookup for faster gate checks
		const gates = Object.values(data.stargates);
		const gatePairs = new Set<string>();
		for(const g of gates){ gatePairs.add(g.source_system_id+":"+g.destination_system_id); gatePairs.add(g.destination_system_id+":"+g.source_system_id); }
		const isGate = (a:SolarSystem,b:SolarSystem)=> gatePairs.has(a.id+":"+b.id);

		const gateSystemIds = new Set<number>(); gates.forEach(g=>{ gateSystemIds.add(g.source_system_id); gateSystemIds.add(g.destination_system_id); });
		const getSystemLink = (system: SolarSystem): string => {
			const hasGates = gateSystemIds.has(system.id);
			const isHighlighted = system.planets === 1 && !hasGates;
			return `<a href="showinfo:5//${system.id}">${system.name}${isHighlighted ? '*' : ''}</a>`;
		};

		// Build condensed segments with backtracking / loop splitting.
		type Segment = { type:'GATE'; count:number; from:SolarSystem; to:SolarSystem } | { type:'JUMP'; distance:number; from:SolarSystem; to:SolarSystem };
		const segments: Segment[] = [];
		let segStartIdx = 0; // start index in pathSystems for current gate run
		let inGateRun = isGate(pathSystems[0], pathSystems[1]);
		// Track seen system ids in current run to split when a prior system is revisited (loop) or immediate reversal occurs
		let seenInRun = new Map<number, number>();
		if(inGateRun){ seenInRun.set(pathSystems[0].id, 0); }
		for(let i=0;i<pathSystems.length-1;i++){
			const a = pathSystems[i];
			const b = pathSystems[i+1];
			const gate = isGate(a,b);
			if(!gate){
				// finalize any gate run up to i
				if(inGateRun){
					const from = pathSystems[segStartIdx];
					const to = pathSystems[i];
					const count = i - segStartIdx;
					if(count>0) segments.push({ type:'GATE', count, from, to });
				}
				inGateRun=false; seenInRun.clear();
				// ship jump as own segment
				const distance = Math.sqrt(
					Math.pow(a.position.x - b.position.x,2)+
					Math.pow(a.position.y - b.position.y,2)+
					Math.pow(a.position.z - b.position.z,2)
				);
				segments.push({ type:'JUMP', distance, from:a, to:b });
				// next iteration will handle new gate run if any
				continue;
			}
			// gate edge
			if(!inGateRun){
				inGateRun=true; segStartIdx=i; seenInRun.clear(); seenInRun.set(a.id, i);
			}
			// Detect immediate reversal (a == path[i-1] && b == path[i-1]) => Actually reversal when b.id === pathSystems[i-1]?.id
			if(i>0 && b.id === pathSystems[i-1].id){
				// Close previous forward leg: segStartIdx -> a
				if(i - segStartIdx > 0){
					segments.push({ type:'GATE', count: i - segStartIdx, from: pathSystems[segStartIdx], to: a });
				}
				// Start new run at a (pivot) for back leg
				segStartIdx = i; seenInRun.clear(); seenInRun.set(a.id, i);
				continue;
			}
			// Detect loop: visiting a system already seen earlier in current run (not current start)
			if(seenInRun.has(b.id)){
				// Close run up to a
				if(i - segStartIdx > 0){
					segments.push({ type:'GATE', count: i - segStartIdx, from: pathSystems[segStartIdx], to: a });
				}
				// Start new run at a
				segStartIdx = i; seenInRun.clear(); seenInRun.set(a.id, i);
				continue;
			}
			seenInRun.set(b.id, i+1);
			// end handled after loop
		}
		// finalize tail gate run
		if(inGateRun){
			const lastIdx = pathSystems.length-1;
			if(lastIdx - segStartIdx > 0){
				segments.push({ type:'GATE', count: lastIdx - segStartIdx, from: pathSystems[segStartIdx], to: pathSystems[lastIdx] });
			}
		}

		const from = pathSystems[0];
		const to = pathSystems[pathSystems.length-1];
		const legend = `Gate: (x)→ SmartGate: []→ Jump: ly→ | * = 1 Planet, No Gates\n`;

		const pages: string[] = [];
		let pageNum = 1;
		let currentBody = getSystemLink(from);
		for(const seg of segments){
			const separator = seg.type==='GATE' ? ` (${seg.count})→ ` : ` ${seg.distance.toFixed(2)}→ `;
			const nextLink = getSystemLink(seg.to);
			const nextPiece = separator + nextLink;
			const headerBase = `${from.name} → ${to.name}`;
			const pageHeader = `${headerBase} (Page ${pageNum})\n` + legend;
			if(pageHeader.length + currentBody.length + nextPiece.length > MAX_NOTE_LENGTH){
				const finalHeader = `${headerBase}${pages.length>0?` (Page ${pageNum})`:''}\n` + legend;
				pages.push(finalHeader + currentBody);
				pageNum++;
				currentBody = getSystemLink(seg.from) + nextPiece; // restart with segment start
			}else{
				currentBody += nextPiece;
			}
		}
		const finalHeader = `${from.name} → ${to.name}${pages.length>0?` (Page ${pageNum})`:''}\n` + legend;
		pages.push(finalHeader + currentBody);
		if(pages.length===1){ pages[0]=pages[0].replace(' (Page 1)',''); }
		return pages;
	},[]);

	useEffect(()=>{
		if(championDisplayPath && mapData){
			setNotePages(formatRouteToNotes(championDisplayPath, mapData));
			setActiveNotePage(0);
		}else{
			setNotePages([]);
		}
	},[championDisplayPath, mapData, formatRouteToNotes]);

	// When a route is imported (share link), seed internal state so note pages & copy buttons appear
	useEffect(()=>{
		if(importedRoutePath && importedRoutePath.length>1 && mapData){
			// If no champion yet, treat imported path as champion display path
			if(!championDisplayPathRef.current){
				setChampionDisplayPath(importedRoutePath);
				championDisplayPathRef.current = importedRoutePath;
				// Use imported route also as macro path (approx) so ship metrics / future optimization possible
				setChampionPath(importedRoutePath);
				championPathRef.current = importedRoutePath;
				const distVal = computeRouteDistance(importedRoutePath);
				setChampionDistance(distVal);
				baselineDistanceRef.current = distVal; // treat as baseline for improvement calc if user optimizes further
				const shipMetrics = computeShipMetrics(importedRoutePath);
				setChampionShipJumps(shipMetrics.shipJumps);
				setChampionShipDistance(shipMetrics.shipDistance);
				setNotePages(formatRouteToNotes(importedRoutePath, mapData));
				setActiveNotePage(0);
			}
		}
	},[importedRoutePath, mapData, computeRouteDistance, computeShipMetrics, formatRouteToNotes]);

	const handleCopyPage = (idx:number) => {
		if(!notePages[idx]) return;
		navigator.clipboard.writeText(notePages[idx]).then(()=> { setCopyButtonText('Copied!'); setTimeout(()=> setCopyButtonText('Copy'),1500); });
	};

	const improvementPct = baselineDistanceRef.current && championDistance !== null ? ((baselineDistanceRef.current - championDistance)/baselineDistanceRef.current)*100 : 0;

	// If ship/gate preference parameters change after a route is computed, recompute ship metrics for display
	useEffect(()=>{
		if(championPath){
			const m = computeShipMetrics(championPath);
			setChampionShipJumps(m.shipJumps);
			setChampionShipDistance(m.shipDistance);
			log(`Ship/gate preference changed. Recomputed ship metrics: ${m.shipJumps} jumps, ${m.shipDistance.toFixed(2)} LY.`);
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [shipMaxRange, shipTradeDistance, minGateHopsSaved]);

	// Cleanup on unmount
	useEffect(()=>{
		return ()=>{ if(globalMonitorRef.current!==undefined){ clearInterval(globalMonitorRef.current); globalMonitorRef.current=undefined; } };
	},[]);

	// Detect small viewport height to auto-force compact
	useEffect(()=>{
		const check = () => { setSmallViewport(window.innerHeight < 820); };
		check();
		window.addEventListener('resize', check);
		return ()=> window.removeEventListener('resize', check);
	},[]);

	return (
		<div className="scout-optimizer-container">
			<label className="module-toggle-label">
				<input type="checkbox" checked={open} onChange={(e)=> onToggle(e.target.checked)} /> Scout Optimizer
			</label>
			{open && (
				<div className={`scout-optimizer-panel ${effectiveCompact? 'compact':''} ${effectiveHideInputs? 'hide-inputs':''}`}>
					<div style={{display:'flex', gap:'10px', flexWrap:'wrap', alignItems:'center'}}>
						<label style={{fontSize:'0.7rem', display:'flex', gap:4, alignItems:'center'}}>
							<input type="checkbox" checked={compactPref || smallViewport} onChange={(e)=> setCompactPref(e.target.checked)} /> Compact{smallViewport && !compactPref ? ' (auto)' : ''}
						</label>
						<label style={{fontSize:'0.7rem', display:'flex', gap:4, alignItems:'center'}}>
							<input type="checkbox" checked={effectiveHideInputs} onChange={(e)=> setHideInputsPref(e.target.checked)} /> Hide Inputs
						</label>
						{smallViewport && <span style={{fontSize:'0.6rem', opacity:0.7}}>Small viewport auto-compact</span>}
					</div>
					{(!effectiveHideInputs) && <div className="scout-input-row">
						<label>Start System</label>
						<AutoCompleteInput value={startSystem} onChange={setStartSystem} onSelect={setStartSystem} dataSource={systemNames} placeholder="Enter start system" />
						</div>}
					{(!effectiveHideInputs) && <div className="scout-input-row">
						<label><input type="checkbox" checked={useRegion} onChange={e=> setUseRegion(e.target.checked)} /> Use Region Instead of Radius</label>
						{!useRegion && (
							<input type="number" className="p2p-input" value={radius} onChange={e=> setRadius(e.target.value)} placeholder="Max Radius (LY)" />
						)}
					</div>}
					{(!effectiveHideInputs) && <div className="scout-input-row">
							<label><input type="checkbox" checked={gateReachableOnly} onChange={e=> setGateReachableOnly(e.target.checked)} /> Only Gate-Reachable From Start</label>
						</div>}
					{(!effectiveHideInputs) && <div className="scout-input-row">
						<label>Optimize Time / Stall Timeout (s)</label>
						<div style={{ display:'flex', gap:'6px' }}>
							<input type="number" className="p2p-input" value={maxOptimizeTime} onChange={e=> setMaxOptimizeTime(e.target.value)} />
							<input type="number" className="p2p-input" value={stallTimeout} onChange={e=> setStallTimeout(e.target.value)} />
						</div>
						</div>}
					{(!effectiveHideInputs) && <div className="scout-input-row">
						<label>Worker Threads</label>
						<input type="number" className="p2p-input" value={workerCount} disabled={isCalculating} title={isCalculating? 'Worker count locked during run' : 'Set number of optimizer workers'} onChange={e=> setWorkerCount(e.target.value)} />
					</div>}
					{(!effectiveHideInputs) && <div className="scout-input-row">
						<label>Ship Max Jump Range (LY)</label>
						<input type="number" className="p2p-input" value={shipMaxRange} onChange={e=> setShipMaxRange(e.target.value)} />
					</div>}
					{(!effectiveHideInputs) && <div className="scout-input-row">
						<label>Gate Trade Rule (Ship LY / Min Gate Hops)</label>
						<div style={{ display:'flex', gap:'6px' }}>
							<input type="number" className="p2p-input" value={shipTradeDistance} onChange={e=> setShipTradeDistance(e.target.value)} placeholder="Max Ship LY" />
							<input type="number" className="p2p-input" value={minGateHopsSaved} onChange={e=> setMinGateHopsSaved(e.target.value)} placeholder="Min Gate Hops" />
						</div>
						</div>}
					{(!effectiveHideInputs) && <div className="scout-input-row">
						<label><input type="checkbox" checked={returnToStart} onChange={e=> onReturnToStartChange(e.target.checked)} /> Return to Start</label>
						</div>}
					{systemsWarning && <div className="scout-warning">Warning: Large system set may impact performance ({collectSystems().length}).</div>}
					<div className="scout-systems-count">Systems collected: {systemStats.filtered}{gateReachableOnly && systemStats.filtered!==systemStats.all ? ` (filtered from ${systemStats.all})` : ''}</div>
					{minRequiredShipRange!==null && (
						<div className="scout-warning">Minimum ship range required to connect all systems: {minRequiredShipRange.toFixed(2)} LY</div>
					)}
					{/* Debug Mode control removed for production */}
					{datasetChanged && !championPath && !isCalculating && <div className="scout-warning">System selection changed. Please Calculate Route again.</div>}
					<div className="scout-actions">
						{!championPath && <button className="scout-button" disabled={isCalculating} onClick={startCalculation}>Calculate Route</button>}
						{championPath && <button className="scout-button" disabled={isCalculating} onClick={startContinuousOptimization}>Start Optimization</button>}
						{isCalculating && <button className="scout-button" onClick={stop}>Stop</button>}
						{/* Copy buttons now rendered below with pagination */}
					</div>
					{notePages.length>0 && (
						<div className="p2p-results">
							<h4>Route Note{notePages.length>1?` (Page ${activeNotePage+1}/${notePages.length})`:''}</h4>
							<div className="scout-grid-buttons">
								{notePages.map((_,idx)=>(
									<button key={idx} onClick={()=>{ setActiveNotePage(idx); handleCopyPage(idx); }} className={`p2p-copy-button ${activeNotePage===idx?'active':''}`}>
										{copyButtonText} {notePages.length>1?`${idx+1}/${notePages.length}`:''}
									</button>
								))}
							</div>
						</div>
					)}
					{championPath && (
						<div className="scout-metrics">
							<div><strong>Baseline Distance:</strong> {baselineDistanceRef.current?.toFixed(2)} LY</div>
							<div><strong>Current Champion:</strong> {championDistance?.toFixed(2)} LY {baselineDistanceRef.current && championDistance!==null && championDistance < baselineDistanceRef.current ? `(-${improvementPct.toFixed(2)}%)` : ''}</div>
							<div><strong>Systems:</strong> {championPath.length}{returnToStart ? ' (includes return)' : ''}</div>
							{championShipJumps!==null && championShipDistance!==null && (
								<div><strong>Ship Jumps:</strong> {championShipJumps} ({championShipDistance.toFixed(2)} LY)</div>
							)}
							{championDisplayPath && championDisplayPath.length !== championPath.length && (
								<div><strong>Gate Hops (expanded):</strong> {championDisplayPath.length}</div>
							)}
							{isCalculating && workerStatusRef.current.length>0 && (
								<div style={{marginTop:'6px', width:'100%'}}>
									<strong>Workers:</strong>
									<div className="scout-worker-grid">
										{workerStatusRef.current.map((ws,i)=>{
											const since = ((Date.now()-ws.lastImprovement)/1000).toFixed(0);
											return (
												<div key={i} className={`scout-worker-cell ${ws.state}`} title={`Worker ${i+1} ${ws.state} (${since}s since improvement)`}>
													<span>#{i+1}</span>
													<span>{ws.state}</span>
													<span className="scout-worker-time">{since}s</span>
												</div>
											);
										})}
									</div>
								</div>
							)}
						</div>
					)}
					<div className="scout-status" aria-live="polite">{statusLog.join('\n')}</div>
				</div>
			)}
		</div>
	);
};

export default ScoutOptimizer;

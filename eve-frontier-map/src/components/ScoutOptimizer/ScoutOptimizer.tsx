import { useCallback, useRef, useState, useEffect } from 'react';
import { track } from '../../utils/usage';
// Persistence of ship max range removed per request (always starts at default)
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
	resetToken?: number; // external reset for clearing all inputs
	selectedSystemName?: string; // externally selected system (map click / global search)
	embedded?: boolean; // omit toggle wrapper and always show content
	// Planet count legend filtering inputs
	planetBinsActive?: boolean[]; // length 5, all true by default in parent
	minPlanets?: number; // global min planet count (for bin calc)
	maxPlanets?: number; // global max planet count
}

const MAX_SYSTEMS_WARNING = 300;

const ScoutOptimizer = ({ open, onToggle, mapData, systemNames, returnToStart, onReturnToStartChange, onBaselineRoute, onOptimizedRoute, onClearRoute, invalidateToken, importedRoutePath, resetToken, selectedSystemName, embedded = false, planetBinsActive, minPlanets, maxPlanets }: ScoutOptimizerProps) => {
	const [startSystem, setStartSystem] = useState('');
	const [radius, setRadius] = useState('50');
	const [useRegion, setUseRegion] = useState(false);
	const [gateReachableOnly, setGateReachableOnly] = useState(false);
	// Apply planet count legend filter (user toggle). When active, collected systems restricted to active legend bins.
	const [usePlanetCount, setUsePlanetCount] = useState(false);
	// Continuous optimization controls
	const [maxOptimizeTime, setMaxOptimizeTime] = useState('60');
	const [stallTimeout, setStallTimeout] = useState('10');
	// Debug mode removed for production build (was used for verbose worker diagnostics)
	// Minimum required ship range (computed when baseline error received)
	const [minRequiredShipRange, setMinRequiredShipRange] = useState<number|null>(null);
	// Ship vs Gate preference inputs
	// Ship max jump range (no persistence)
	const [shipMaxRange, setShipMaxRange] = useState('60');
	const [shipTradeDistance, setShipTradeDistance] = useState('0');
	const [minGateHopsSaved, setMinGateHopsSaved] = useState('999');
	const [workerCount, setWorkerCount] = useState(()=> Math.max(1,(navigator.hardwareConcurrency||4)-2).toString());
	// Logs split: activity (high-level events) & worker (per-thread progress)
	const [activityLog, setActivityLog] = useState<string[]>([]);
	const [workerLog, setWorkerLog] = useState<string[]>([]);
	const appendActivity = useCallback((line:string)=> setActivityLog(l=> [...l.slice(-400), line]),[]);
	const appendWorker = useCallback((line:string)=> setWorkerLog(l=> [...l.slice(-600), line]),[]);
	// Active log tab (UI)
	const [activeLogTab, setActiveLogTab] = useState<'activity'|'workers'>('activity');
	// Alias used by existing calls (maps to activity log)
	const log = useCallback((line:string)=> appendActivity(line),[appendActivity]);
	const [isCalculating, setIsCalculating] = useState(false);
	// User toggles
	const [hideInputsPref, setHideInputsPref] = useState(false); // persists after optimization
	const [smallViewport, setSmallViewport] = useState(false);
	const effectiveHideInputs = hideInputsPref; // inputs hidden only if user chose so
	// Macro path = optimization path (visited target systems order)
	const [championPath, setChampionPath] = useState<string[]|null>(null);
	// Display path = macro path expanded into individual gate hops (BFS) so gate segments are shown instead of ship jumps when possible
	const [championDisplayPath, setChampionDisplayPath] = useState<string[]|null>(null);
	const [championDistance, setChampionDistance] = useState<number|null>(null);
	// Ship jump metrics for current champion (lexicographic primary criteria)
	const [championShipJumps, setChampionShipJumps] = useState<number|null>(null);
	const [championShipDistance, setChampionShipDistance] = useState<number|null>(null);
	// Gate jump count (edges that are gates only)
	const [championGateJumps, setChampionGateJumps] = useState<number|null>(null);
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
	const prevParamsRef = useRef({ startSystem:'', radius:'', useRegion:false, gateReachableOnly:false, usePlanetCount:false, binsSig:'' });
	const [copyButtonText, setCopyButtonText] = useState('Copy');
	// Note export (paged like P2P)
	const [notePages, setNotePages] = useState<string[]>([]);
	const [activeNotePage, setActiveNotePage] = useState(0);
	const [includeLegend, setIncludeLegend] = useState(true);
	const [includeStats, setIncludeStats] = useState(false);
	const workersRef = useRef<Worker[]>([]);
	const workerStatusRef = useRef<{ state:'idle'|'baseline'|'running'|'restarting'|'done'; lastImprovement:number }[]>([]);
	const lastGlobalImprovementRef = useRef<number>(0);
	const optimizationStartTimeRef = useRef<number>(0);
	const baselineStartTimeRef = useRef<number>(0);
	// Track whether we've already recorded savings for the current baseline (avoid double counting if user stops multiple times)
	const savingsRecordedRef = useRef<boolean>(false);
	// Helper to record optimization savings + session time once (used on Stop, unmount, visibility hidden, or time budget)
	const recordOptimizationMetrics = useCallback(()=>{
		try {
			// Savings (only if we actually improved beyond baseline and not yet recorded)
			if(!savingsRecordedRef.current && baselineDistanceRef.current!==null && championDistance!==null){
				const saved = baselineDistanceRef.current - championDistance;
				if(saved > 0){ track({ type:'scout_opt_savings', saved: parseFloat(saved.toFixed(4)) }); savingsRecordedRef.current = true; }
			}
			// Session time (optimization phase) partial or full
			if(optimizationStartTimeRef.current){
				const ms = Date.now() - optimizationStartTimeRef.current;
				if(ms>0) track({ type:'scout_opt_session_time', ms });
				// Zero out so we don't double count if called again without restart
				optimizationStartTimeRef.current = 0;
			}
		} catch {}
	}, [championDistance]);
	const globalMonitorRef = useRef<number|undefined>(undefined);
	const totalMaxTimeSecRef = useRef<number>(0);
	const systemsForRunRef = useRef<string[]>([]);
	const baselineDoneRef = useRef(false);
	// Legacy pass tracking removed (continuous mode)
	const readyCountRef = useRef(0);
	const pendingBaselineRef = useRef<{ start:string; systems:string[]; returnToStart:boolean }|null>(null);
	// Generation token to ignore late worker messages after invalidation or new run
	const generationRef = useRef(0);

	// External reset: restore initial defaults
	useEffect(()=>{
		if(resetToken === undefined) return;
		setStartSystem('');
		setRadius('50');
		setUseRegion(false);
		setGateReachableOnly(false);
		setUsePlanetCount(false);
		setMaxOptimizeTime('60');
		setStallTimeout('10');
		setMinRequiredShipRange(null);
		setShipMaxRange('60');
		setShipTradeDistance('0');
		setMinGateHopsSaved('999');
		setWorkerCount(Math.max(1,(navigator.hardwareConcurrency||4)-2).toString());
		setActivityLog([]); setWorkerLog([]); setActiveLogTab('activity');
		setIsCalculating(false);
		setHideInputsPref(false);
		setChampionPath(null); championPathRef.current=null;
		setChampionDisplayPath(null); championDisplayPathRef.current=null;
		setChampionDistance(null);
		setChampionShipJumps(null); setChampionShipDistance(null);
		baselineDistanceRef.current=null;
		setDatasetChanged(false);
		setNotePages([]); setActiveNotePage(0); setCopyButtonText('Copy');
		workersRef.current.forEach(w=>{ try{ w.terminate(); }catch(e){} }); workersRef.current=[];
		workerStatusRef.current=[];
		pendingBaselineRef.current=null; baselineDoneRef.current=false;
		if(globalMonitorRef.current!==undefined){ clearInterval(globalMonitorRef.current); globalMonitorRef.current=undefined; }
		generationRef.current += 1; // invalidate any stray worker messages
	}, [resetToken]);

	// Update start system when external system selection occurs
	useEffect(()=>{
		if(selectedSystemName){
			setStartSystem(prev=> prev || selectedSystemName); // do not overwrite if user already entered one
		}
	}, [selectedSystemName]);

	// (persistence now handled inline in input onChange, mirroring P2P debounce pattern)

	const stargatesArray = mapData ? Object.values(mapData.stargates) : [];
	const gatesBySource: {[id:number]: number[]} = {}; stargatesArray.forEach(g=>{ if(!gatesBySource[g.source_system_id]) gatesBySource[g.source_system_id]=[]; gatesBySource[g.source_system_id].push(g.destination_system_id); if(!gatesBySource[g.destination_system_id]) gatesBySource[g.destination_system_id]=[]; gatesBySource[g.destination_system_id].push(g.source_system_id); });

// (legacy alias replaced above)

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
		// Planet count bin filtering (if enabled and bins provided)
		if(usePlanetCount && planetBinsActive && planetBinsActive.length===5 && minPlanets!==undefined && maxPlanets!==undefined && maxPlanets>=minPlanets){
			const range = maxPlanets - minPlanets;
			const steps = 5;
			candidates = candidates.filter(c=>{
				if(range===0){ return planetBinsActive[0]; }
				const ratio = (c.planets - minPlanets)/ (range||1);
				let bin = Math.floor(ratio*steps); if(bin>=steps) bin=steps-1; if(bin<0) bin=0;
				return !!planetBinsActive[bin];
			});
		}
		return candidates.map(c=>c.name);
	},[mapData, startSystem, radius, useRegion, gateReachableOnly, gatesBySource, usePlanetCount, planetBinsActive, minPlanets, maxPlanets]);

	const effectiveOpen = open || embedded;
	const systemsWarning = effectiveOpen ? (collectSystems().length > MAX_SYSTEMS_WARNING) : false;

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
		if(usePlanetCount && planetBinsActive && planetBinsActive.length===5 && minPlanets!==undefined && maxPlanets!==undefined && maxPlanets>=minPlanets){
			const range = maxPlanets - minPlanets; const steps=5;
			candidates = candidates.filter(c=>{
				if(range===0) return planetBinsActive[0];
				const ratio=(c.planets-minPlanets)/(range||1); let bin=Math.floor(ratio*steps); if(bin>=steps) bin=steps-1; if(bin<0) bin=0; return !!planetBinsActive[bin];
			});
		}
		return { all, filtered: candidates.length };
	},[mapData, startSystem, radius, useRegion, gateReachableOnly, gatesBySource, usePlanetCount, planetBinsActive, minPlanets, maxPlanets]);

	const systemStats = effectiveOpen ? collectSystemsStats() : { all:0, filtered:0 };

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
					appendActivity(`Worker ${i+1} ready`); appendWorker(`Worker ${i+1} ready`);
					if(pendingBaselineRef.current && readyCountRef.current === parseInt(workerCount,10)) {
						const pb = pendingBaselineRef.current; pendingBaselineRef.current=null;
						const baselineParams = { maxShipRange: parseFloat(shipMaxRange)||0, shipTradeDistance: parseFloat(shipTradeDistance)||0, minGateHopsSaved: parseInt(minGateHopsSaved,10)||0 };
						workersRef.current.forEach(w2=> w2.postMessage({ type:'baseline', ...pb, ...baselineParams, generation: generationRef.current }));
						workerStatusRef.current.forEach(s=>{ s.state='baseline'; s.lastImprovement=Date.now(); });
					}
				}
				else if(data.type==='baselineResult') { if(data.generation===undefined || data.generation===generationRef.current) handleBaselineResult(data.path, data.shipJumps, data.shipDistance); }
				else if(data.type==='baselineError') { if(data.generation===undefined || data.generation===generationRef.current){
					appendActivity(`Baseline error: ${data.reason}`);
					try { track({ type:'baseline_error' }); } catch {}
					setIsCalculating(false);
					if(data.minRequiredShipRange!==undefined){ setMinRequiredShipRange(data.minRequiredShipRange); }
				} }
				else if(data.type==='optimizeResult') { if(data.generation===undefined || data.generation===generationRef.current) handleOptimizeResult(data.path, data.shipJumps, data.shipDistance, i); }
				else if(data.type==='optimizeDone') { if(data.generation===undefined || data.generation===generationRef.current){ /* per-worker done handled in future enhancement */ } }
				else if(data.type==='progress') { appendWorker(`Worker ${i+1}: ${data.message}`); }
				else if(data.type==='stopped') { appendWorker(`Worker ${i+1} stopped.`); }
			};
			workersRef.current.push(w);
			workerStatusRef.current.push({ state:'idle', lastImprovement: Date.now() });
		}
	},[workerCount, appendActivity, appendWorker, shipMaxRange, shipTradeDistance, minGateHopsSaved]);

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
		try { track({ type:'scout_baseline', collectedSystems: collected.length, planetFilterOn: usePlanetCount }); } catch {}
		baselineStartTimeRef.current = Date.now();
		systemsForRunRef.current = collected;
		const signature = collected.slice().sort().join('|');
		systemSignatureRef.current = signature;
		setDatasetChanged(false);
		generationRef.current += 1; // new generation for this run
		ensureWorkers();
		setIsCalculating(true);
		baselineDoneRef.current=false;
		appendActivity(`Collected ${collected.length} systems. Gate pref: ship≤${shipTradeDistance}LY replaces ≥${minGateHopsSaved} gate hops (max ship range ${shipMaxRange}LY).`);
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
		savingsRecordedRef.current = false; // reset savings recorded flag for new baseline
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
		appendActivity(`Baseline distance: ${distVal.toFixed(2)} LY over ${path.length} systems`);
		try { onBaselineRoute && onBaselineRoute(expanded); } catch(e) { /* ignore */ }
		// End baseline phase so user can immediately continue or copy
		setIsCalculating(false);
		appendActivity('Baseline complete. You can Start Optimization to refine the route.');
		try { track({ type:'scout_baseline_time', ms: Date.now() - baselineStartTimeRef.current }); } catch {}
	};

	const handleOptimizeResult = (path:string[], workerShipJumps?:number, workerShipDistance?:number, workerIndex?:number) => {
		if(workerIndex!==undefined){
			const st = workerStatusRef.current[workerIndex];
			if(st){ st.lastImprovement = Date.now(); if(st.state!=='running') st.state='running'; }
		}
		setChampionPath(prev=>{
			const candDist = computeRouteDistance(path);
			if(!prev){
				if(workerIndex!==undefined){ appendActivity(`Worker ${workerIndex+1} produced initial candidate.`); appendWorker(`Worker ${workerIndex+1} produced initial candidate.`); }
				setChampionDistance(candDist);
				if(workerShipJumps!==undefined && workerShipDistance!==undefined){
					setChampionShipJumps(workerShipJumps); setChampionShipDistance(workerShipDistance);
				} else {
					const m = computeShipMetrics(path); setChampionShipJumps(m.shipJumps); setChampionShipDistance(m.shipDistance);
				}
				appendActivity(`Initial optimization candidate distance: ${candDist.toFixed(2)} LY (${path.length} systems)`);
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
				appendActivity(`Improved champion${workerIndex!==undefined?` (worker ${workerIndex+1})`:''}: ${currentDist.toFixed(2)} -> ${candDist.toFixed(2)} LY`); if(workerIndex!==undefined) appendWorker(`Worker ${workerIndex+1} improved: ${currentDist.toFixed(2)} -> ${candDist.toFixed(2)} LY`);
				championPathRef.current = path;
				const expanded = expandPathToGateSequence(path); setChampionDisplayPath(expanded); championDisplayPathRef.current = expanded;
				lastGlobalImprovementRef.current = Date.now();
				return path;
			} else {
				appendWorker(`No improvement (candidate ${candDist.toFixed(2)} LY, champion ${currentDist.toFixed(2)} LY)`);
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
		// Before terminating, if we have a baseline and a current champion different from baseline, record savings + opt session time
		recordOptimizationMetrics();
		// Ask workers to stop and then terminate them to guarantee halt
		workersRef.current.forEach(w=> { try { w.postMessage({ type:'stop' }); } catch(e){} });
		setTimeout(() => { workersRef.current.forEach(w=> { try { w.terminate(); } catch(e){} }); workersRef.current=[]; }, 50);
		workerStatusRef.current.forEach(ws=> ws.state='done');
		setIsCalculating(false);
		if(globalMonitorRef.current!==undefined){ clearInterval(globalMonitorRef.current); globalMonitorRef.current=undefined; }
		appendActivity('Stopped.');
	};

	const startContinuousOptimization = () => {
		if(!championPath){ alert('Baseline not finished yet.'); return; }
		const total = parseFloat(maxOptimizeTime)||0; const stall = parseFloat(stallTimeout)||0;
		setIsCalculating(true);
		setHideInputsPref(true); // auto-hide inputs (but allow user to re-show if they uncheck)
		appendActivity(`Starting optimization: max ${total||'∞'}s, global stall ${stall||'∞'}s on ${workersRef.current.length||1} workers.`);
		try { track({ type:'scout_opt_start' }); } catch {}
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
							appendWorker(`Worker ${idx+1} stalled. Diversifying & restarting.`); appendActivity(`Worker ${idx+1} stalled (restart).`); try { track({ type:'stall_restart' }); } catch {}
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
						appendActivity('Global stall detected. Diversifying all workers.'); try { track({ type:'stall_restart' }); } catch {}
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
			appendActivity(`Return to Start toggled ${returnToStart ? 'ON' : 'OFF'}; recalculating baseline.`);
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
		if(!effectiveOpen) return;
		const { all, filtered } = systemStats;
		if(useRegion){
			appendActivity(`Region selection: ${filtered}${gateReachableOnly?` (gate-filtered from ${all})`:''}`);
		}else{
			appendActivity(`Radius selection: ${filtered}${gateReachableOnly?` (gate-filtered from ${all})`:''}`);
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [useRegion, gateReachableOnly, startSystem, radius, effectiveOpen, usePlanetCount, planetBinsActive]);

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
			if(prev.usePlanetCount !== usePlanetCount) reasons.push('planet filter toggle');
			const newBinsSig = planetBinsActive ? planetBinsActive.map(b=>b?1:0).join('') : '';
			if(prev.binsSig && prev.binsSig !== newBinsSig) reasons.push('planet bins');
			appendActivity(`System set changed (${reasons.join(', ')||'parameters changed'}). Previous route invalidated.`);
			setChampionPath(null);
			championPathRef.current = null;
			setChampionDisplayPath(null);
			championDisplayPathRef.current = null;
			setChampionDistance(null);
			baselineDoneRef.current=false;
			setDatasetChanged(true);
			try { onClearRoute && onClearRoute(); } catch(e){/* ignore */}
			}
			prevParamsRef.current = { startSystem, radius, useRegion, gateReachableOnly, usePlanetCount, binsSig: planetBinsActive ? planetBinsActive.map(b=>b?1:0).join('') : '' };
		}, [startSystem, radius, useRegion, gateReachableOnly, collectSystems, championPath, isCalculating, log, usePlanetCount, planetBinsActive]);

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
	const formatRouteToNotes = useCallback((path: string[], data: MapData, opts?: { includeLegend?: boolean; includeStats?: boolean; stats?: { gateJumps:number; shipJumps:number; totalDist:number; shipDist:number } }): string[] => {
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
		let seenInRun = new Map<number, number>();
		if(inGateRun){ seenInRun.set(pathSystems[0].id, 0); }
		for(let i=0;i<pathSystems.length-1;i++){
			const a = pathSystems[i];
			const b = pathSystems[i+1];
			const gate = isGate(a,b);
			if(!gate){
				if(inGateRun){
					const from = pathSystems[segStartIdx];
					const to = pathSystems[i];
					const count = i - segStartIdx;
					if(count>0) segments.push({ type:'GATE', count, from, to });
				}
				inGateRun=false; seenInRun.clear();
				const distance = Math.sqrt(
					Math.pow(a.position.x - b.position.x,2)+
					Math.pow(a.position.y - b.position.y,2)+
					Math.pow(a.position.z - b.position.z,2)
				);
				segments.push({ type:'JUMP', distance, from:a, to:b });
				continue;
			}
			if(!inGateRun){
				inGateRun=true; segStartIdx=i; seenInRun.clear(); seenInRun.set(a.id, i);
			}
			if(i>0 && b.id === pathSystems[i-1].id){
				if(i - segStartIdx > 0){
					segments.push({ type:'GATE', count: i - segStartIdx, from: pathSystems[segStartIdx], to: a });
				}
				segStartIdx = i; seenInRun.clear(); seenInRun.set(a.id, i);
				continue;
			}
			if(seenInRun.has(b.id)){
				if(i - segStartIdx > 0){
					segments.push({ type:'GATE', count: i - segStartIdx, from: pathSystems[segStartIdx], to: a });
				}
				segStartIdx = i; seenInRun.clear(); seenInRun.set(a.id, i);
				continue;
			}
			seenInRun.set(b.id, i+1);
		}
		if(inGateRun){
			const lastIdx = pathSystems.length-1;
			if(lastIdx - segStartIdx > 0){
				segments.push({ type:'GATE', count: lastIdx - segStartIdx, from: pathSystems[segStartIdx], to: pathSystems[lastIdx] });
			}
		}
		const from = pathSystems[0];
		const to = pathSystems[pathSystems.length-1];
		const legend = `Gate: (x)→ SmartGate: []→ Jump: <distance>→ | * = single-planet system with no stargates\n`;
		const legendBlock = opts?.includeLegend!==false ? legend : '';
		const statsBlock = (opts?.includeStats && opts.stats) ? `Stats: Gates ${opts.stats.gateJumps} | Ship ${opts.stats.shipJumps} | Dist ${opts.stats.totalDist.toFixed(2)} LY | ShipDist ${opts.stats.shipDist.toFixed(2)} LY\n` : '';
		const pages: string[] = [];
		let pageNum = 1;
		let currentBody = getSystemLink(from);
		for(const seg of segments){
			const separator = seg.type==='GATE' ? ` (${seg.count})→ ` : ` ${seg.distance.toFixed(2)}→ `;
			const nextLink = getSystemLink(seg.to);
			const nextPiece = separator + nextLink;
			const headerBase = `${from.name} → ${to.name}`;
			const pageHeader = `${headerBase} (Page ${pageNum})\n` + (pages.length===0 ? statsBlock : '') + legendBlock;
			if(pageHeader.length + currentBody.length + nextPiece.length > MAX_NOTE_LENGTH){
				const finalHeader = `${headerBase}${pages.length>0?` (Page ${pageNum})`:''}\n` + (pages.length===0 ? statsBlock : '') + legendBlock;
				pages.push(finalHeader + currentBody);
				pageNum++;
				currentBody = getSystemLink(seg.from) + nextPiece;
			}else{
				currentBody += nextPiece;
			}
		}
		const finalHeader = `${from.name} → ${to.name}${pages.length>0?` (Page ${pageNum})`:''}\n` + (pages.length===0 ? statsBlock : '') + legendBlock;
		pages.push(finalHeader + currentBody);
		if(pages.length===1){ pages[0]=pages[0].replace(' (Page 1)',''); }
		return pages;
	},[]);

	useEffect(()=>{
		if(championDisplayPath && mapData){
			setNotePages(formatRouteToNotes(championDisplayPath, mapData, { includeLegend, includeStats, stats: championShipJumps!==null && championShipDistance!==null && championDistance!==null ? { gateJumps: (championDisplayPath.length-1) - championShipJumps, shipJumps: championShipJumps, totalDist: championDistance, shipDist: championShipDistance } : undefined }));
			setActiveNotePage(0);
		}else{
			setNotePages([]);
		}
	},[championDisplayPath, mapData, formatRouteToNotes, includeLegend, includeStats, championShipJumps, championShipDistance, championDistance]);

	// Compute gate jump count for display metrics
	useEffect(()=>{
		if(championDisplayPath && championDisplayPath.length>1){
			let gates=0;
			for(let i=0;i<championDisplayPath.length-1;i++){
				const aName = championDisplayPath[i];
				const bName = championDisplayPath[i+1];
				// Use gatesBySource (names need conversion to ids) - build name to id map once
				// systemCacheByName.current holds SolarSystem by exact name
				const a = systemCacheByName.current[aName];
				const b = systemCacheByName.current[bName];
				if(a && b){
					const neighbors = gatesBySource[a.id] || [];
					if(neighbors.includes(b.id)) gates++;
				}
			}
			setChampionGateJumps(gates);
		}else{
			setChampionGateJumps(null);
		}
	},[championDisplayPath, gatesBySource]);

	// When a route is imported (share link), seed internal state so note pages & copy buttons appear
	useEffect(()=>{
		if(importedRoutePath && importedRoutePath.length>1 && mapData){
			if(!championDisplayPathRef.current){
				setChampionDisplayPath(importedRoutePath);
				championDisplayPathRef.current = importedRoutePath;
				setChampionPath(importedRoutePath);
				championPathRef.current = importedRoutePath;
				const distVal = computeRouteDistance(importedRoutePath);
				setChampionDistance(distVal);
				baselineDistanceRef.current = distVal;
				const shipMetrics = computeShipMetrics(importedRoutePath);
				setChampionShipJumps(shipMetrics.shipJumps);
				setChampionShipDistance(shipMetrics.shipDistance);
				setNotePages(formatRouteToNotes(importedRoutePath, mapData, { includeLegend, includeStats, stats: { gateJumps: (importedRoutePath.length-1) - shipMetrics.shipJumps, shipJumps: shipMetrics.shipJumps, totalDist: distVal, shipDist: shipMetrics.shipDistance } }));
				setActiveNotePage(0);
			}
		}
	},[importedRoutePath, mapData, computeRouteDistance, computeShipMetrics, formatRouteToNotes, includeLegend, includeStats]);

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
			appendActivity(`Ship/gate preference changed. Recomputed ship metrics: ${m.shipJumps} jumps, ${m.shipDistance.toFixed(2)} LY.`);
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [shipMaxRange, shipTradeDistance, minGateHopsSaved]);

	// Cleanup on unmount (record any outstanding metrics if user navigates away mid-optimization)
	useEffect(()=>{
		return ()=>{ 
			if(globalMonitorRef.current!==undefined){ clearInterval(globalMonitorRef.current); globalMonitorRef.current=undefined; }
			// If optimization was running, capture partial savings/session
			if(isCalculating || optimizationStartTimeRef.current){ recordOptimizationMetrics(); }
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	},[]);

	// Page/tab hide handler (best-effort capture without requiring explicit Stop)
	useEffect(()=>{
		const visHandler = ()=>{
			if(document.visibilityState === 'hidden'){
				if(isCalculating || optimizationStartTimeRef.current){ recordOptimizationMetrics(); }
			}
		};
		document.addEventListener('visibilitychange', visHandler);
		return ()=> document.removeEventListener('visibilitychange', visHandler);
	}, [isCalculating, recordOptimizationMetrics]);

	// Detect small viewport height (might influence future layout adjustments)
	useEffect(()=>{
		const check = () => { setSmallViewport(window.innerHeight < 820); };
		check();
		window.addEventListener('resize', check);
		return ()=> window.removeEventListener('resize', check);
	},[]);

	// Dual log auto-scroll with user pause detection
	const activityRef = useRef<HTMLDivElement|null>(null);
	const workersRefDiv = useRef<HTMLDivElement|null>(null);
	const [autoScrollActivity, setAutoScrollActivity] = useState(true);
	const [autoScrollWorkers, setAutoScrollWorkers] = useState(true);
	useEffect(()=>{
		const el = activityRef.current; if(!el) return; const onScroll=()=>{ const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 20; setAutoScrollActivity(atBottom); }; el.addEventListener('scroll',onScroll); return ()=> el.removeEventListener('scroll',onScroll);
	},[]);
	useEffect(()=>{
		const el = workersRefDiv.current; if(!el) return; const onScroll=()=>{ const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 20; setAutoScrollWorkers(atBottom); }; el.addEventListener('scroll',onScroll); return ()=> el.removeEventListener('scroll',onScroll);
	},[]);
	useEffect(()=>{ if(autoScrollActivity && activityRef.current){ activityRef.current.scrollTop = activityRef.current.scrollHeight; } },[activityLog, autoScrollActivity]);
	useEffect(()=>{ if(autoScrollWorkers && workersRefDiv.current){ workersRefDiv.current.scrollTop = workersRefDiv.current.scrollHeight; } },[workerLog, autoScrollWorkers]);

	// Log planet filter specifics when bins or toggle change (after initial mount)
	const lastPlanetSigRef = useRef<string>('');
	useEffect(()=>{
		if(!planetBinsActive) return;
		const sig = (usePlanetCount? '1':'0') + planetBinsActive.map(b=>b?1:0).join('');
		if(sig === lastPlanetSigRef.current) return;
		lastPlanetSigRef.current = sig;
		const collected = collectSystems();
		if(usePlanetCount){ appendActivity(`Planet filter updated: ${collected.length} systems (active bins: ${planetBinsActive.map((b,i)=> b?i+1:'' ).filter(Boolean).join(',')||'none'})`); }
		else { appendActivity(`Planet filter off: ${collected.length} systems available.`); }
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [usePlanetCount, planetBinsActive]);

	const panel = (
		<div className={`scout-optimizer-panel ${effectiveHideInputs? 'hide-inputs':''}`}>
					<div style={{display:'flex', gap:'10px', flexWrap:'wrap', alignItems:'center'}}>
						<label style={{fontSize:'0.7rem', display:'flex', gap:4, alignItems:'center'}}>
							<input type="checkbox" checked={effectiveHideInputs} onChange={(e)=> setHideInputsPref(e.target.checked)} /> Hide Inputs
						</label>
						{smallViewport && <span style={{fontSize:'0.6rem', opacity:0.7}}>Small viewport</span>}
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
									<label><input type="checkbox" checked={usePlanetCount} onChange={e=> setUsePlanetCount(e.target.checked)} /> Apply Planet Count Filter</label>
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
					<div className="scout-systems-count">Systems collected: {systemStats.filtered}{(gateReachableOnly || usePlanetCount) && systemStats.filtered!==systemStats.all ? ` (filtered from ${systemStats.all})` : ''}</div>
					{minRequiredShipRange!==null && (
						<div className="scout-warning">Minimum ship range required to connect all systems: {minRequiredShipRange.toFixed(2)} LY</div>
					)}
					{/* Debug Mode control removed for production */}
					{datasetChanged && !championPath && !isCalculating && <div className="scout-warning">System selection changed. Please Calculate Route again.</div>}
					<div className="scout-actions">
						{!championPath && (
							<button className={`scout-button ${isCalculating?'calculating':''}`} disabled={isCalculating} onClick={startCalculation}>
								{isCalculating ? <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}><span className="p2p-spinner" /> Calculating...</span> : 'Calculate Route'}
							</button>
						)}
						{championPath && (
							<button className={`scout-button ${isCalculating?'calculating':''}`} disabled={isCalculating} onClick={startContinuousOptimization}>
								{isCalculating ? <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}><span className="p2p-spinner" /> Optimizing...</span> : 'Start Optimization'}
							</button>
						)}
						{isCalculating && <button className="scout-button" onClick={stop}>Stop</button>}
						{/* Copy buttons now rendered below with pagination */}
					</div>
					{notePages.length>0 && (
						<div className="p2p-results">
							<h4>Route Note{notePages.length>1?` (Page ${activeNotePage+1}/${notePages.length})`:''}</h4>
							<div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:6 }}>
								<label className="route-note-option-label"><input type="checkbox" checked={includeLegend} onChange={e=> setIncludeLegend(e.target.checked)} /> Include Legend</label>
								<label className="route-note-option-label"><input type="checkbox" checked={includeStats} onChange={e=> setIncludeStats(e.target.checked)} /> Include Route Statistics</label>
							</div>
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
									<div><strong>Total Hops:</strong> {championDisplayPath ? (championDisplayPath.length - 1) : (championPath.length - 1)}{returnToStart ? ' (includes return)' : ''}</div>
									{championGateJumps!==null && (
										<div><strong>Gate Jumps:</strong> {championGateJumps}</div>
									)}
									{championShipJumps!==null && championShipDistance!==null && (
										<div><strong>Ship Jumps:</strong> {championShipJumps} ({championShipDistance.toFixed(2)} LY)</div>
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
					{/* Logs Section with Tabs */}
					<div style={{display:'flex', flexDirection:'column', gap:4}}>
						<div style={{display:'flex', gap:6}}>
							<button type="button" onClick={()=> setActiveLogTab('activity')} className={`scout-button ${activeLogTab==='activity'?'':'calculating'}`} style={{padding:'4px 8px', fontSize:'0.6rem'}} disabled={activeLogTab==='activity'}>Activity</button>
							<button type="button" onClick={()=> setActiveLogTab('workers')} className={`scout-button ${activeLogTab==='workers'?'':'calculating'}`} style={{padding:'4px 8px', fontSize:'0.6rem'}} disabled={activeLogTab==='workers'}>Workers</button>
						</div>
						<div ref={activeLogTab==='activity'?activityRef:workersRefDiv} className="scout-status" aria-live={activeLogTab==='activity'? 'polite': undefined}>
							{(activeLogTab==='activity'? activityLog : workerLog).join('\n')}
						</div>
						<div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
							<small style={{opacity:0.6, fontSize:'0.55rem'}}>{activeLogTab==='activity'? (autoScrollActivity?'Auto-scroll':'Paused (scroll up)') : (autoScrollWorkers?'Auto-scroll':'Paused (scroll up)')}</small>
							<button type="button" onClick={()=> { if(activeLogTab==='activity'){ setActivityLog([]); } else { setWorkerLog([]);} }} style={{background:'rgba(0,0,0,0.3)', border:'1px solid #444', color:'#ccc', fontSize:'0.55rem', padding:'2px 6px', cursor:'pointer'}}>Clear</button>
						</div>
					</div>
		</div>
	);

	if (embedded) {
		return panel;
	}

	return (
		<div className="scout-optimizer-container">
			<label className="module-toggle-label">
				<input type="checkbox" checked={open} onChange={(e)=> onToggle(e.target.checked)} /> Scout Optimizer
			</label>
			{open && panel}
		</div>
	);
};

export default ScoutOptimizer;

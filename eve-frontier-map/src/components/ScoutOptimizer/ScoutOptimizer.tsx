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
}

const MAX_SYSTEMS_WARNING = 300;

const ScoutOptimizer = ({ open, onToggle, mapData, systemNames, returnToStart, onReturnToStartChange, onBaselineRoute, onOptimizedRoute, onClearRoute, invalidateToken }: ScoutOptimizerProps) => {
	const [startSystem, setStartSystem] = useState('');
	const [radius, setRadius] = useState('50');
	const [useRegion, setUseRegion] = useState(false);
	const [gateReachableOnly, setGateReachableOnly] = useState(false);
	const [passes, setPasses] = useState('3');
	const [timePerPass, setTimePerPass] = useState('5');
	const [workerCount, setWorkerCount] = useState(()=> Math.max(1,(navigator.hardwareConcurrency||4)-2).toString());
	const [statusLog, setStatusLog] = useState<string[]>([]);
	const [isCalculating, setIsCalculating] = useState(false);
	const [championPath, setChampionPath] = useState<string[]|null>(null);
	const [championDistance, setChampionDistance] = useState<number|null>(null);
	const [datasetChanged, setDatasetChanged] = useState(false);
	const championPathRef = useRef<string[]|null>(null);
	// Track last baseline return-to-start setting to know when to recompute
	const lastReturnToStartRef = useRef(returnToStart);
	// Track last system selection signature
	const systemSignatureRef = useRef<string>('');
	// Track previous selection parameter values for reason logging
	const prevParamsRef = useRef({ startSystem:'', radius:'', useRegion:false, gateReachableOnly:false });
	const [copyButtonText, setCopyButtonText] = useState('Copy');
	const workersRef = useRef<Worker[]>([]);
	const systemsForRunRef = useRef<string[]>([]);
	const baselineDoneRef = useRef(false);
	const optimizeExpectedRef = useRef(0);
	const optimizeReceivedRef = useRef(0);
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
						workersRef.current.forEach(w2=> w2.postMessage({ type:'baseline', ...pb, generation: generationRef.current }));
					}
				}
				else if(data.type==='baselineResult') { if(data.generation===undefined || data.generation===generationRef.current) handleBaselineResult(data.path); }
				else if(data.type==='optimizeResult') { if(data.generation===undefined || data.generation===generationRef.current) handleOptimizeResult(data.path); }
				else if(data.type==='progress') { log(`Worker ${i+1}: ${data.message}`); }
				else if(data.type==='stopped') { log(`Worker ${i+1} stopped.`); }
			};
			workersRef.current.push(w);
		}
	},[workerCount, log]);

	const broadcast = (msg:unknown) => { workersRef.current.forEach(w=> w.postMessage(msg as any)); };

	// External invalidation: clear any existing route & terminate workers so stale messages don't redraw
	useEffect(()=>{
		if(invalidateToken === undefined) return;
		if(championPath || isCalculating){
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
	}, [invalidateToken, championPath, isCalculating, log, onClearRoute]);

	const startCalculation = () => {
		if(!mapData) return;
		const collected = collectSystems();
		if(!collected.length){ alert('No systems collected (check start system / radius / region).'); return; }
		systemsForRunRef.current = collected;
		const signature = collected.slice().sort().join('|');
		systemSignatureRef.current = signature;
		setDatasetChanged(false);
		generationRef.current += 1; // new generation for this run
		ensureWorkers();
		setIsCalculating(true);
		baselineDoneRef.current=false;
		log(`Collected ${collected.length} systems.`);
		broadcast({ type:'init', systems: mapData.solar_systems, stargates: mapData.stargates });
		pendingBaselineRef.current = { start: startSystem, systems: collected, returnToStart };
		// If workers already ready (zero restart scenario) fire immediately
		if(readyCountRef.current === workersRef.current.length && workersRef.current.length>0) {
			const pb = pendingBaselineRef.current; pendingBaselineRef.current=null;
			workersRef.current.forEach(w=> w.postMessage({ type:'baseline', ...pb!, generation: generationRef.current }));
		}
	};

	const handleBaselineResult = (path:string[]) => {
		if(baselineDoneRef.current) return;
		baselineDoneRef.current=true;
		setChampionPath(path);
		championPathRef.current = path;
		const distVal = computeRouteDistance(path);
		setChampionDistance(distVal);
		log(`Baseline distance: ${distVal.toFixed(2)} LY over ${path.length} systems`);
		try { onBaselineRoute && onBaselineRoute(path); } catch(e) { /* ignore */ }
		// End baseline phase so user can immediately continue or copy
		setIsCalculating(false);
		log('Baseline complete. You can Continue Optimization to refine the route.');
	};

	const handleOptimizeResult = (path:string[]) => {
		setChampionPath(prev=>{
			const candDist = computeRouteDistance(path);
			if(!prev){
				setChampionDistance(candDist);
				log(`Initial optimization candidate distance: ${candDist.toFixed(2)} LY (${path.length} systems)`);
				championPathRef.current = path;
				return path;
			}
			const currentDist = championDistance ?? computeRouteDistance(prev);
			if(candDist + 1e-6 < currentDist){
				setChampionDistance(candDist);
				log(`Improved champion distance: ${currentDist.toFixed(2)} -> ${candDist.toFixed(2)} LY`);
				championPathRef.current = path;
				return path;
			} else {
				log(`No improvement (candidate ${candDist.toFixed(2)} LY, champion ${currentDist.toFixed(2)} LY)`);
				return prev;
			}
		});
		optimizeReceivedRef.current += 1;
		if(optimizeReceivedRef.current >= optimizeExpectedRef.current) {
			setIsCalculating(false);
			log('Optimization pass complete. You may run additional passes.');
			// Emit final optimized route after async state settles
			setTimeout(()=>{ if(onOptimizedRoute && championPathRef.current) { try { onOptimizedRoute(championPathRef.current); } catch(e){/* ignore */} } },0);
		}
	};

	const runOptimizationPasses = () => {
		if(!championPath){ alert('Baseline not finished yet.'); return; }
		const p = parseInt(passes,10); const t = parseInt(timePerPass,10);
		optimizeExpectedRef.current = workersRef.current.length || 1;
		optimizeReceivedRef.current = 0;
		setIsCalculating(true);
		log(`Starting optimization passes: ${p} passes x ${t}s on ${optimizeExpectedRef.current} workers.`);
		broadcast({ type:'optimize', path: championPath, passes: p, timePerPassSec: t, returnToStart, generation: generationRef.current });
	};

	const stop = () => { broadcast({ type:'stop' }); setIsCalculating(false); log('Stop requested.'); };

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
				workersRef.current.forEach(w=> w.postMessage({ type:'baseline', ...pb!, generation: generationRef.current }));
			}
		}
		lastReturnToStartRef.current = returnToStart;
	}, [returnToStart, championPath, isCalculating, startSystem, log]);

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

	const copyRoute = () => {
		if(!championPath) return;
		const text = championPath.join('\n');
		navigator.clipboard.writeText(text).then(()=> { setCopyButtonText('Copied!'); setTimeout(()=> setCopyButtonText('Copy'),1500); });
	};

	return (
		<div className="scout-optimizer-container">
			<label>
				<input type="checkbox" checked={open} onChange={(e)=> onToggle(e.target.checked)} /> Scout Optimizer
			</label>
			{open && (
				<div className="scout-optimizer-panel">
					<div className="scout-input-row">
						<label>Start System</label>
						<AutoCompleteInput value={startSystem} onChange={setStartSystem} onSelect={setStartSystem} dataSource={systemNames} placeholder="Enter start system" />
					</div>
					<div className="scout-input-row">
						<label><input type="checkbox" checked={useRegion} onChange={e=> setUseRegion(e.target.checked)} /> Use Region Instead of Radius</label>
						{!useRegion && (
							<input type="number" className="p2p-input" value={radius} onChange={e=> setRadius(e.target.value)} placeholder="Max Radius (LY)" />
						)}
					</div>
						<div className="scout-input-row">
							<label><input type="checkbox" checked={gateReachableOnly} onChange={e=> setGateReachableOnly(e.target.checked)} /> Only Gate-Reachable From Start</label>
						</div>
					<div className="scout-input-row">
						<label>Passes / Time per Pass (s)</label>
						<div style={{ display:'flex', gap:'6px' }}>
							<input type="number" className="p2p-input" value={passes} onChange={e=> setPasses(e.target.value)} />
							<input type="number" className="p2p-input" value={timePerPass} onChange={e=> setTimePerPass(e.target.value)} />
						</div>
					</div>
					<div className="scout-input-row">
						<label>Worker Threads</label>
						<input type="number" className="p2p-input" value={workerCount} onChange={e=> setWorkerCount(e.target.value)} />
					</div>
					<div className="scout-input-row">
						<label><input type="checkbox" checked={returnToStart} onChange={e=> onReturnToStartChange(e.target.checked)} /> Return to Start</label>
					</div>
					{systemsWarning && <div className="scout-warning">Warning: Large system set may impact performance ({collectSystems().length}).</div>}
					<div className="scout-systems-count">Systems collected: {systemStats.filtered}{gateReachableOnly && systemStats.filtered!==systemStats.all ? ` (filtered from ${systemStats.all})` : ''}</div>
					{datasetChanged && !championPath && !isCalculating && <div className="scout-warning">System selection changed. Please Calculate Route again.</div>}
					<div className="scout-actions">
						{!championPath && <button className="scout-button" disabled={isCalculating} onClick={startCalculation}>Calculate Route</button>}
						{championPath && <button className="scout-button" disabled={isCalculating} onClick={runOptimizationPasses}>Continue Optimization</button>}
						{isCalculating && <button className="scout-button" onClick={stop}>Stop</button>}
						{championPath && <button className="scout-button" onClick={copyRoute}>{copyButtonText}</button>}
					</div>
					<div className="scout-status" aria-live="polite">{statusLog.join('\n')}</div>
				</div>
			)}
		</div>
	);
};

export default ScoutOptimizer;

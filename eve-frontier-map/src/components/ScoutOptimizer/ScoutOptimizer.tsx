import { useCallback, useRef, useState } from 'react';
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
}

const MAX_SYSTEMS_WARNING = 300;

const ScoutOptimizer = ({ open, onToggle, mapData, systemNames, returnToStart, onReturnToStartChange }: ScoutOptimizerProps) => {
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
	const [copyButtonText, setCopyButtonText] = useState('Copy');
	const workersRef = useRef<Worker[]>([]);
	const systemsForRunRef = useRef<string[]>([]);
	const baselineDoneRef = useRef(false);

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

	const ensureWorkers = useCallback(()=>{
		const desired = parseInt(workerCount,10); if(workersRef.current.length===desired) return;
		workersRef.current.forEach(w=> w.terminate()); workersRef.current=[];
		for(let i=0;i<desired;i++){
			const w = new Worker(new URL('../../workers/scout_optimizer_worker.ts', import.meta.url), { type:'module' });
			w.onmessage = (e)=>{
				const data = e.data;
				if(data.type==='ready') { log(`Worker ${i+1} ready`); }
				else if(data.type==='baselineResult') { handleBaselineResult(data.path); }
				else if(data.type==='optimizeResult') { handleOptimizeResult(data.path); }
				else if(data.type==='progress') { log(`Worker ${i+1}: ${data.message}`); }
				else if(data.type==='stopped') { log(`Worker ${i+1} stopped.`); }
			};
			workersRef.current.push(w);
		}
	},[workerCount, log]);

	const broadcast = (msg:unknown) => { workersRef.current.forEach(w=> w.postMessage(msg as any)); };

	const startCalculation = () => {
		if(!mapData) return;
		const collected = collectSystems();
		if(!collected.length){ alert('No systems collected (check start system / radius / region).'); return; }
		systemsForRunRef.current = collected;
		ensureWorkers();
		setIsCalculating(true);
		baselineDoneRef.current=false;
		log(`Collected ${collected.length} systems.`);
		broadcast({ type:'init', systems: mapData.solar_systems, stargates: mapData.stargates });
		setTimeout(()=> broadcast({ type:'baseline', start: startSystem, systems: collected, returnToStart }), 50);
	};

	const handleBaselineResult = (path:string[]) => {
		if(baselineDoneRef.current) return;
		baselineDoneRef.current=true;
		setChampionPath(path);
		log(`Baseline route length: ${path.length}`);
	};

	const handleOptimizeResult = (path:string[]) => {
		setChampionPath(prev=>{
			if(!prev) return path;
			return path.length <= prev.length ? path : prev; // placeholder comparison
		});
	};

	const runOptimizationPasses = () => {
		if(!championPath){ alert('Baseline not finished yet.'); return; }
		const p = parseInt(passes,10); const t = parseInt(timePerPass,10);
		broadcast({ type:'optimize', path: championPath, passes: p, timePerPassSec: t, returnToStart });
	};

	const stop = () => { broadcast({ type:'stop' }); setIsCalculating(false); };

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

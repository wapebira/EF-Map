import { useState, useEffect, useRef, useCallback } from 'react';
import './P2PRouting.css';
import AutoCompleteInput from '../AutoCompleteInput/AutoCompleteInput';

// --- Note Formatter Logic (inlined to fix module resolution issue) ---

interface SolarSystem {
  id: number;
  name: string;
  position: { x: number; y: number; z: number };
  planets: number;
}

interface Stargate {
  source_system_id: number;
  destination_system_id: number;
}

interface MapData {
  solar_systems: { [key: string]: SolarSystem };
  stargates: { [key: string]: Stargate };
}

interface RouteSummary {
  stargateJumps: number;
  shipJumps: number;
  totalDistance: number;
  shipJumpDistance: number;
}

const MAX_NOTE_LENGTH = 1500;

const getDistance = (a: SolarSystem, b: SolarSystem): number => {
  return Math.sqrt(
    Math.pow(a.position.x - b.position.x, 2) +
    Math.pow(a.position.y - b.position.y, 2) +
    Math.pow(a.position.z - b.position.z, 2)
  );
};

const calculateRouteSummary = (path: string[], mapData: MapData): RouteSummary => {
  const summary: RouteSummary = {
    stargateJumps: 0,
    shipJumps: 0,
    totalDistance: 0,
    shipJumpDistance: 0,
  };

  const systemsByName: Map<string, SolarSystem> = new Map(Object.values(mapData.solar_systems).map(s => [s.name.toLowerCase(), s]));
  const pathSystems = path.map(name => systemsByName.get(name.toLowerCase())).filter(Boolean) as SolarSystem[];

  if (pathSystems.length < 2) return summary;

  for (let i = 0; i < pathSystems.length - 1; i++) {
    const startSystem = pathSystems[i];
    const endSystem = pathSystems[i + 1];

    const distance = getDistance(startSystem, endSystem);
    summary.totalDistance += distance;

    const isStargate = Object.values(mapData.stargates).some(g => 
        (g.source_system_id === startSystem.id && g.destination_system_id === endSystem.id) ||
        (g.source_system_id === endSystem.id && g.destination_system_id === startSystem.id)
    );

    if (isStargate) {
      summary.stargateJumps++;
    } else {
      summary.shipJumps++;
      summary.shipJumpDistance += distance;
    }
  }

  return summary;
};

interface NoteFormatOptions {
  includeLegend: boolean;
  includeStats: boolean;
  summary?: RouteSummary | null;
}

const formatRouteToNotes = (path: string[], mapData: MapData, options?: NoteFormatOptions): string[] => {
  if (path.length < 2) return [];

  const systemsByName: Map<string, SolarSystem> = new Map(Object.values(mapData.solar_systems).map(s => [s.name.toLowerCase(), s]));
  const pathSystems = path.map(name => systemsByName.get(name.toLowerCase())).filter(Boolean) as SolarSystem[];

  if (pathSystems.length < 2) return [];

  const gateSystemIds = new Set<number>();
  Object.values(mapData.stargates).forEach(gate => {
    gateSystemIds.add(gate.source_system_id);
    gateSystemIds.add(gate.destination_system_id);
  });

  const from = pathSystems[0];
  const to = pathSystems[pathSystems.length - 1];
  const legend = `Gate: (x)→ SmartGate: []→ Jump: <distance>→ | * = single-planet system with no stargates\n`;
  const legendBlock = options?.includeLegend !== false ? legend : '';
  const statsBlock = (options?.includeStats && options?.summary) ?
    `Stats: Gates ${options.summary.stargateJumps} | Ship ${options.summary.shipJumps} | Dist ${options.summary.totalDistance.toFixed(2)} LY | ShipDist ${options.summary.shipJumpDistance.toFixed(2)} LY\n` : '';

  const getSystemLink = (system: SolarSystem): string => {
    const hasGates = gateSystemIds.has(system.id);
    const isHighlighted = system.planets === 1 && !hasGates;
    return `<a href="showinfo:5//${system.id}">${system.name}${isHighlighted ? '*' : ''}</a>`;
  };

  // --- Corrected Pagination Logic v5: Page-by-page construction ---
  const pages: string[] = [];
  let pageNum = 1;
  let currentBody = getSystemLink(from);

  // This logic now correctly handles the condensed path for efficiency
  // First, create the condensed path representation
  type RouteSegment = 
    | { type: 'GATE'; count: number; from: SolarSystem; to: SolarSystem }
    | { type: 'JUMP'; distance: number; from: SolarSystem; to: SolarSystem };
  const condensedPath: RouteSegment[] = [];
  let i = 0;
  while (i < pathSystems.length - 1) {
    const startSystem = pathSystems[i];
    let endSystem = pathSystems[i + 1];

    const isStargate = Object.values(mapData.stargates).some(g => 
        (g.source_system_id === startSystem.id && g.destination_system_id === endSystem.id) ||
        (g.source_system_id === endSystem.id && g.destination_system_id === startSystem.id)
    );

    if (isStargate) {
      let gateCount = 0;
      let currentIdx = i;
      while (currentIdx < pathSystems.length - 1) {
        const s1 = pathSystems[currentIdx];
        const s2 = pathSystems[currentIdx + 1];
        const isNextStargate = Object.values(mapData.stargates).some(g => 
            (g.source_system_id === s1.id && g.destination_system_id === s2.id) ||
            (g.source_system_id === s2.id && g.destination_system_id === s1.id)
        );
        if (isNextStargate) {
          gateCount++;
          currentIdx++;
        } else {
          break;
        }
      }
      endSystem = pathSystems[currentIdx];
      condensedPath.push({ type: 'GATE', count: gateCount, from: startSystem, to: endSystem });
      i = currentIdx;
    } else {
      const distance = getDistance(startSystem, endSystem);
      condensedPath.push({ type: 'JUMP', distance, from: startSystem, to: endSystem });
      i++;
    }
  }

  // Now build pages from the condensed path
  for (const segment of condensedPath) {
    const separator = segment.type === 'GATE' 
      ? ` (${segment.count})→ ` 
      : ` ${segment.distance.toFixed(2)}→ `;
    const nextLink = getSystemLink(segment.to);
    const nextPiece = separator + nextLink;

  const pageHeader = `${from.name} → ${to.name} (Page ${pageNum})\n` + (pages.length===0 ? statsBlock : '') + legendBlock;
    
    if (pageHeader.length + currentBody.length + nextPiece.length > MAX_NOTE_LENGTH) {
  const finalHeader = `${from.name} → ${to.name}${pages.length > 0 ? ` (Page ${pageNum})` : ''}\n` + (pages.length===0 ? statsBlock : '') + legendBlock;
      pages.push(finalHeader + currentBody);
      
      pageNum++;
      currentBody = getSystemLink(segment.from) + nextPiece;
    } else {
      currentBody += nextPiece;
    }
  }

  // Add the final page
  const finalPageHeader = `${from.name} → ${to.name}${pages.length > 0 ? ` (Page ${pageNum})` : ''}\n` + (pages.length===0 ? statsBlock : '') + legendBlock;
  pages.push(finalPageHeader + currentBody);

  // If there's only one page, remove the page number from the header
  if (pages.length === 1) {
    pages[0] = pages[0].replace(` (Page 1)`, '');
  }

  return pages;
};


// --- Component Logic ---

interface P2PRoutingProps {
  onCalculateRoute: (from: string, to: string, jumpDist: number, optimize: 'fuel' | 'jumps', algorithm: 'astar' | 'dijkstra') => void;
  onStopCalculation?: () => void;
  isCalculating: boolean;
  routeResult: { path: string[] | null; error?: string; minRequiredShipRange?: number } | null;
  mapData: MapData | null;
  systemNames: string[];
  progress?: { explored: number; frontier: number; elapsedMs: number; message: string } | null;
  routeCalcTimeMs?: number | null;
  open: boolean;
  onToggle: (open: boolean) => void;
  resetToken?: number; // increments when parent requests a reset
  selectedSystemName?: string; // externally selected system (map click / global search)
  selectedDestinationSystemName?: string; // externally chosen destination system (right-click context)
  waypoints?: string[];
  avoidSystems?: string[];
  onRemoveWaypoint?: (name: string)=>void;
  onRemoveAvoidSystem?: (name: string)=>void;
  waypointOptimize?: boolean; // false = visit in added order, true = optimize order (future)
  onWaypointOptimizeChange?: (v: boolean)=>void;
  embedded?: boolean; // if true, omit outer toggle wrapper and always show panel
}

// Minimal neutral custom select (no accent colors) for consistent option highlight across platforms
interface NeutralOption<T extends string> { value: T; label: string }
interface NeutralSelectProps<T extends string> {
  value: T; onChange: (v: T)=>void; options: NeutralOption<T>[]; ariaLabel: string; id: string;
}
const NeutralSelect = <T extends string>({ value, onChange, options, ariaLabel, id }: NeutralSelectProps<T>) => {
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number>(-1);
  const wrapRef = useRef<HTMLDivElement|null>(null);

  const currentIdx = options.findIndex(o=>o.value===value);

  const close = useCallback(()=>{ setOpen(false); setHoverIdx(-1); },[]);
  const openList = useCallback(()=>{ setOpen(true); setHoverIdx(currentIdx>=0?currentIdx:0); },[currentIdx]);

  useEffect(()=>{
    if(!open) return; const handler=(e:MouseEvent)=>{ if(wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(); };
    window.addEventListener('mousedown', handler); return ()=>window.removeEventListener('mousedown', handler);
  },[open, close]);

  const onKey = (e: React.KeyboardEvent) => {
    if(e.key==='ArrowDown'){ e.preventDefault(); if(!open) openList(); else setHoverIdx(i=> Math.min(options.length-1, (i<0?0:i)+1)); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); if(!open) openList(); else setHoverIdx(i=> Math.max(0, (i<0?0:i)-1)); }
    else if(e.key==='Enter' || e.key===' '){ e.preventDefault(); if(!open) openList(); else { if(hoverIdx>=0){ onChange(options[hoverIdx].value); close(); } } }
    else if(e.key==='Escape'){ if(open){ e.preventDefault(); close(); } }
  };

  return (
    <div className="neutral-select-wrapper" ref={wrapRef}>
      <button id={id} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        className="neutral-select-trigger" onClick={()=> open?close():openList()} onKeyDown={onKey}>
        <span>{options.find(o=>o.value===value)?.label || ''}</span>
        <span className="neutral-select-caret" />
      </button>
      {open && (
        <div role="listbox" className="neutral-select-dropdown" aria-activedescendant={hoverIdx>=0?`${id}-opt-${hoverIdx}`:undefined}>
          {options.map((o,i)=>(
            <div key={o.value} id={`${id}-opt-${i}`} role="option" aria-selected={o.value===value}
              className={`neutral-select-option${i===hoverIdx?' hover':''}${o.value===value?' selected':''}`}
              onMouseEnter={()=>setHoverIdx(i)}
              onMouseDown={(e)=>{ e.preventDefault(); onChange(o.value); close(); }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const P2PRouting = ({ onCalculateRoute, onStopCalculation, isCalculating, routeResult, mapData, systemNames, progress, routeCalcTimeMs, open, onToggle, resetToken, selectedSystemName, selectedDestinationSystemName, waypoints = [], avoidSystems = [], onRemoveWaypoint, onRemoveAvoidSystem, waypointOptimize = false, onWaypointOptimizeChange, embedded = false }: P2PRoutingProps) => {
  const [fromSystem, setFromSystem] = useState('');
  const [toSystem, setToSystem] = useState('');
  const [jumpDistance, setJumpDistance] = useState('60');
  const [optimizeFor, setOptimizeFor] = useState<'fuel' | 'jumps'>('fuel');
  const [algorithm, setAlgorithm] = useState<'astar' | 'dijkstra'>('astar');

  const [notePages, setNotePages] = useState<string[]>([]);
  const [includeLegend, setIncludeLegend] = useState(true);
  const [includeStats, setIncludeStats] = useState(false);
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const [activeNotePage, setActiveNotePage] = useState(0);
  const [copyButtonText, setCopyButtonText] = useState('Copy');

  useEffect(() => {
    if (routeResult?.path && mapData) {
      const routeSummary = calculateRouteSummary(routeResult.path, mapData);
      const notes = formatRouteToNotes(routeResult.path, mapData, { includeLegend, includeStats, summary: routeSummary });
      setNotePages(notes);
      setSummary(routeSummary);
      setActiveNotePage(0);
    } else {
      setNotePages([]);
      setSummary(null);
    }
  }, [routeResult, mapData, includeLegend, includeStats]);

  const handleCalculate = () => {
    const distance = parseFloat(jumpDistance);
    if (isNaN(distance) || distance <= 0) {
      alert('Please enter a valid jump distance.');
      return;
    }
  onCalculateRoute(fromSystem, toSystem, distance, optimizeFor, algorithm);
  };

  const handleCopy = (pageIndex: number) => {
    if (notePages[pageIndex]) {
      navigator.clipboard.writeText(notePages[pageIndex]).then(() => {
        setCopyButtonText('Copied!');
        setTimeout(() => setCopyButtonText('Copy'), 2000);
      }, (err) => {
        console.error('Could not copy text: ', err);
        alert('Failed to copy route to clipboard.');
      });
    }
  };

  // Respond to external reset requests
  useEffect(() => {
    if(resetToken === undefined) return;
    // Reset all local input states to initial defaults
    setFromSystem('');
    setToSystem('');
    setJumpDistance('60');
    setOptimizeFor('fuel');
    setAlgorithm('astar');
    setNotePages([]);
    setSummary(null);
    setActiveNotePage(0);
  setCopyButtonText('Copy');
  setIncludeLegend(true);
  setIncludeStats(false);
  }, [resetToken]);

  // Update From system when an external system selection occurs
  useEffect(()=>{
    if(selectedSystemName){
      setFromSystem(selectedSystemName);
    }
  }, [selectedSystemName]);

  // Update To system when external destination selection occurs
  useEffect(()=>{
    if(selectedDestinationSystemName){
      setToSystem(selectedDestinationSystemName);
    }
  }, [selectedDestinationSystemName]);

  // Build waypoint & avoided system UI blocks (only if non-empty)
  const waypointBlock = waypoints.length > 0 && (
    <div className="p2p-input-group">
      <label style={{ display:'flex', alignItems:'center', gap:8 }}>
        Waypoints
        <span style={{ fontSize:11, opacity:.65 }}>({waypoints.length})</span>
      </label>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {waypoints.map(w => (
          <div key={w} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'#111', border:'1px solid #333', padding:'4px 8px', borderRadius:4, fontSize:12 }}>
            <span style={{ fontWeight:600 }}>{w}</span>
            {onRemoveWaypoint && (<button style={{ background:'transparent', color:'#ccc', border:'none', cursor:'pointer', fontSize:12 }} onClick={()=> onRemoveWaypoint(w)} aria-label={`Remove waypoint ${w}`}>✕</button>)}
          </div>
        ))}
      </div>
      <label style={{ display:'flex', gap:6, alignItems:'center', marginTop:6, fontSize:11, background:'#0c0c0c', padding:'4px 6px', borderRadius:4, border:'1px solid #222' }}>
        <input type="checkbox" checked={waypointOptimize} onChange={e=> onWaypointOptimizeChange && onWaypointOptimizeChange(e.target.checked)} /> Optimize waypoint order (experimental)
      </label>
    </div>
  );

  const avoidBlock = avoidSystems.length > 0 && (
    <div className="p2p-input-group">
      <label style={{ display:'flex', alignItems:'center', gap:8 }}>
        Avoid Systems
        <span style={{ fontSize:11, opacity:.65 }}>({avoidSystems.length})</span>
      </label>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {avoidSystems.map(a => (
          <div key={a} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'#180000', border:'1px solid #552222', padding:'4px 8px', borderRadius:4, fontSize:12 }}>
            <span style={{ fontWeight:600 }}>{a}</span>
            {onRemoveAvoidSystem && (<button style={{ background:'transparent', color:'#ccc', border:'none', cursor:'pointer', fontSize:12 }} onClick={()=> onRemoveAvoidSystem(a)} aria-label={`Remove avoided system ${a}`}>✕</button>)}
          </div>
        ))}
      </div>
    </div>
  );

  const panel = (
    <div className="p2p-routing-panel">
          <div className="p2p-input-group">
            <label htmlFor="from-system">From</label>
            <AutoCompleteInput
              value={fromSystem}
              onChange={setFromSystem}
              onSelect={setFromSystem}
              dataSource={systemNames}
              placeholder="Enter start system"
            />
          </div>
          {waypointBlock}
          {avoidBlock}

          <div className="p2p-input-group">
            <label htmlFor="to-system">To</label>
            <AutoCompleteInput
              value={toSystem}
              onChange={setToSystem}
              onSelect={setToSystem}
              dataSource={systemNames}
              placeholder="Enter destination system"
            />
          </div>

          <div className="p2p-input-group">
            <label htmlFor="jump-distance">Max Jump Distance (LY)</label>
            <input
              id="jump-distance"
              type="number"
              value={jumpDistance}
              onChange={(e) => setJumpDistance(e.target.value)}
                className="p2p-input"
            />
          </div>

          <div className="p2p-input-group">
            <label htmlFor="optimize-for">Optimize For</label>
            <NeutralSelect
              id="optimize-for"
              ariaLabel="Optimize For"
              value={optimizeFor}
              onChange={(v)=> setOptimizeFor(v as 'fuel'|'jumps')}
              options={[
                { value: 'fuel', label: 'Fuel (Prefer Gates)' },
                { value: 'jumps', label: 'Jumps' },
              ]}
            />
          </div>

          <div className="p2p-input-group">
            <label htmlFor="algorithm-select">Algorithm</label>
            <NeutralSelect
              id="algorithm-select"
              ariaLabel="Algorithm"
              value={algorithm}
              onChange={(v)=> setAlgorithm(v as 'astar'|'dijkstra')}
              options={[
                { value: 'astar', label: 'A* (basic)' },
                { value: 'dijkstra', label: 'Dijkstra (advanced)' },
              ]}
            />
          </div>

          <button className="p2p-calculate-button" onClick={handleCalculate} disabled={isCalculating}>
            {isCalculating ? 'Calculating...' : 'Calculate Route'}
          </button>
          {isCalculating && (
            <button className="p2p-stop-button" onClick={() => { onStopCalculation && onStopCalculation(); }}>
              Stop
            </button>
          )}

          {isCalculating && progress && (
            <div className="p2p-progress">
              <div className="p2p-progress-bar" style={{ width: '100%', background: '#222', height: '8px', borderRadius: '4px', overflow: 'hidden', marginTop: '8px' }}>
                <div style={{ width: `${Math.min(100, (progress.explored / (progress.explored + progress.frontier + 1)) * 100).toFixed(0)}%`, background: '#4caf50', height: '100%' }} />
              </div>
              <div style={{ marginTop: '6px', fontSize: '12px', color: '#ddd' }}>{progress.message} • frontier: {progress.frontier} • elapsed: {(progress.elapsedMs/1000).toFixed(1)}s</div>
            </div>
          )}

          {routeResult && routeResult.error && (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <p className="error" style={{ margin:0 }}>Error: {routeResult.error}</p>
              {routeResult.minRequiredShipRange !== undefined && isFinite(routeResult.minRequiredShipRange) && (
                <div className="p2p-warning">Minimum ship range required to connect start and destination: {routeResult.minRequiredShipRange.toFixed(2)} LY</div>
              )}
            </div>
          )}

          {summary && (
            <div className="p2p-results">
               <div className="route-summary">
                <p>Total Stargate Jumps: <span>{summary.stargateJumps}</span></p>
                <p>Total Ship Jumps: <span>{summary.shipJumps}</span></p>
                <p>Total Distance: <span>{summary.totalDistance.toFixed(2)} LY</span></p>
                <p>Ship Jump Distance: <span>{summary.shipJumpDistance.toFixed(2)} LY</span></p>
                {routeCalcTimeMs !== null && routeCalcTimeMs !== undefined && (
                  <p>Calculation Time: <span>{(routeCalcTimeMs/1000).toFixed(2)} s</span></p>
                )}
              </div>
            </div>
          )}

          {notePages.length > 0 && (
            <div className="p2p-results">
              <h4>Route Note{notePages.length > 1 ? ` (Page ${activeNotePage + 1}/${notePages.length})` : ''}</h4>
              <div style={{ display:'flex', flexDirection:'column', gap:'4px', marginBottom:'6px' }}>
                <label className="route-note-option-label">
                  <input type="checkbox" checked={includeLegend} onChange={e=> setIncludeLegend(e.target.checked)} /> Include Legend
                </label>
                <label className="route-note-option-label">
                  <input type="checkbox" checked={includeStats} onChange={e=> setIncludeStats(e.target.checked)} /> Include Route Statistics
                </label>
              </div>
              <div className="p2p-copy-buttons">
                {notePages.map((_, index) => (
                  <button 
                    key={index} 
                    onClick={() => { setActiveNotePage(index); handleCopy(index); }}
                    className={`p2p-copy-button ${activeNotePage === index ? 'active' : ''}`}
                  >
                    {copyButtonText} {notePages.length > 1 ? `${index + 1}/${notePages.length}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
    </div>
  );

  if (embedded) {
    return <div className="p2p-routing-embedded">{panel}</div>;
  }
  return (
    <div className="p2p-routing-container">
      <label className="module-toggle-label">
        <input
          type="checkbox"
          checked={open}
          onChange={(e) => onToggle(e.target.checked)}
        />
        Point-to-Point Routing
      </label>
      {open && panel}
    </div>
  );
};

export default P2PRouting;
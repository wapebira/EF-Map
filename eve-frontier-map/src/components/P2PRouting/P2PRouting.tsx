import { useState, useEffect } from 'react';
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

const formatRouteToNotes = (path: string[], mapData: MapData): string[] => {
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
  const legend = `Gate: (x)→ SmartGate: []→ Jump: ly→ | * = 1 Planet, No Gates\n`;

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

    const pageHeader = `${from.name} → ${to.name} (Page ${pageNum})\n` + legend;
    
    if (pageHeader.length + currentBody.length + nextPiece.length > MAX_NOTE_LENGTH) {
      const finalHeader = `${from.name} → ${to.name}${pages.length > 0 ? ` (Page ${pageNum})` : ''}\n` + legend;
      pages.push(finalHeader + currentBody);
      
      pageNum++;
      currentBody = getSystemLink(segment.from) + nextPiece;
    } else {
      currentBody += nextPiece;
    }
  }

  // Add the final page
  const finalPageHeader = `${from.name} → ${to.name}${pages.length > 0 ? ` (Page ${pageNum})` : ''}\n` + legend;
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
  isCalculating: boolean;
  routeResult: { path: string[] | null; error?: string } | null;
  mapData: MapData | null;
  systemNames: string[];
}

const P2PRouting = ({ onCalculateRoute, isCalculating, routeResult, mapData, systemNames }: P2PRoutingProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [fromSystem, setFromSystem] = useState('');
  const [toSystem, setToSystem] = useState('');
  const [jumpDistance, setJumpDistance] = useState('60');
  const [optimizeFor, setOptimizeFor] = useState<'fuel' | 'jumps'>('fuel');
  const [algorithm, setAlgorithm] = useState<'astar' | 'dijkstra'>('astar');

  const [notePages, setNotePages] = useState<string[]>([]);
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const [activeNotePage, setActiveNotePage] = useState(0);
  const [copyButtonText, setCopyButtonText] = useState('Copy');

  useEffect(() => {
    if (routeResult?.path && mapData) {
      const notes = formatRouteToNotes(routeResult.path, mapData);
      const routeSummary = calculateRouteSummary(routeResult.path, mapData);
      setNotePages(notes);
      setSummary(routeSummary);
      setActiveNotePage(0);
    } else {
      setNotePages([]);
      setSummary(null);
    }
  }, [routeResult, mapData]);

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

  return (
    <div className="p2p-routing-container">
      <label>
        <input
          type="checkbox"
          checked={isOpen}
          onChange={(e) => setIsOpen(e.target.checked)}
        />
        Point-to-Point Routing
      </label>

      {isOpen && (
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
            />
          </div>

          <div className="p2p-input-group">
            <label htmlFor="optimize-for">Optimize For</label>
            <select
              id="optimize-for"
              value={optimizeFor}
              onChange={(e) => setOptimizeFor(e.target.value as 'fuel' | 'jumps')}
            >
              <option value="fuel">Fuel (Prefer Gates)</option>
              <option value="jumps">Jumps</option>
            </select>
          </div>

          <div className="p2p-input-group">
            <label htmlFor="algorithm-select">Algorithm</label>
            <select
              id="algorithm-select"
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as 'astar' | 'dijkstra')}
            >
              <option value="astar">A* (basic)</option>
              <option value="dijkstra">Dijkstra (advanced)</option>
            </select>
          </div>

          <button className="p2p-calculate-button" onClick={handleCalculate} disabled={isCalculating}>
            {isCalculating ? 'Calculating...' : 'Calculate Route'}
          </button>

          {routeResult && routeResult.error && <p className="error">Error: {routeResult.error}</p>}

          {summary && (
            <div className="p2p-results">
               <div className="route-summary">
                <p>Total Stargate Jumps: <span>{summary.stargateJumps}</span></p>
                <p>Total Ship Jumps: <span>{summary.shipJumps}</span></p>
                <p>Total Distance: <span>{summary.totalDistance.toFixed(2)} LY</span></p>
                <p>Ship Jump Distance: <span>{summary.shipJumpDistance.toFixed(2)} LY</span></p>
              </div>
            </div>
          )}

          {notePages.length > 0 && (
            <div className="p2p-results">
              <h4>Route Note{notePages.length > 1 ? ` (Page ${activeNotePage + 1}/${notePages.length})` : ''}</h4>
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
      )}
    </div>
  );
};

export default P2PRouting;
import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createRouteRibbon } from './modules/RouteRibbon';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import './App.css';
import RegionHighlighterModule, { setRegionHighlightColors } from './modules/RegionHighlighter';
import RegionStatsCard, { type RegionStats } from './components/RegionStatsCard';
import CompareRegionsPanel from './components/CompareRegionsPanel';
import UserOverlayPanel from './components/UserOverlay/UserOverlayPanel';
import { userOverlayStore } from './utils/userOverlay';
import { OVERLAY_FEATURE_FLAG } from './utils/userOverlay.ts';
import { UserOverlayRings } from './modules/UserOverlayRings';
import AddOverlayMarkModal from './components/UserOverlay/AddOverlayMarkModal';
import logo from './assets/logo/logo.png';
import { openDbFromArrayBuffer } from "./lib/sql";
import type { SystemRow, StargateRow, RegionRow, ConstellationRow } from "./types/db";
import { createJumpRangeBubble } from './modules/JumpRangeBubble';
import LoadingScreen from './components/LoadingScreen';
// Legacy panel components kept for reference removed in favor of unified RoutingPanel
import PanelRail from './components/layout/PanelRail';
import PanelDrawer, { type PanelDrawerHandle } from './components/layout/PanelDrawer';
import RoutingPanel from './components/Routing/RoutingPanel';
import CinematicPanel from './components/Cinematic/CinematicPanel';
import PlanetLegendPanel from './components/Planets/PlanetLegendPanel';
import './components/layout/panelLayout.css';
import AutoCompleteInput from './components/AutoCompleteInput/AutoCompleteInput';
import HelpPanel from './components/HelpPanel/HelpPanel';
import { loadPrefs, setAccent, setOpenPanels as persistOpenPanels, setRoutingPrefs, fullReset, getPrefs, softReset, setUiScale as persistUiScale, setShowStations as persistShowStations } from './utils/prefs';
import { track } from './utils/usage';
import { encodeShare, decodeShare } from './utils/share';
import { createShortShare, fetchShortShare } from './utils/shortShare';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import DonateCryptoModal from './components/DonateCryptoModal';
import StatsPage from './components/StatsPage';
// Station icon (ensure file added at assets/icons/station.png)
// Will be lazy loaded via TextureLoader when toggle active
import stationIconUrl from './assets/icons/station.png';

// Small referral badge component with copy-to-clipboard
const ReferralBadge: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const code = 'n7GEWunG';
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(()=>{
      setCopied(true);
      try { track({ type:'referral_click' }); } catch {}
      setTimeout(()=> setCopied(false), 1600);
    }).catch(()=>{/* ignore */});
  };
  return (
    <div className="ef-referral" aria-label="Referral code">
      <span>Referral code:</span>
      <a
        href={`https://evefrontier.com/en?ref=${code}`}
        target="_blank"
        rel="noopener noreferrer"
        className="ef-referral-code"
        style={{ textDecoration:'underline', cursor:'pointer' }}
        aria-label="Open referral link in new tab"
        onClick={()=>{ try { track({ type:'referral_click' }); } catch {} }}
      >
        {code}
      </a>
      <button className={`ef-referral-copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy} aria-label="Copy referral code">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
};

// Helper function to create a circular texture
const createCircleTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (context) {
    context.beginPath();
    context.arc(16, 16, 16, 0, 2 * Math.PI);
    context.fillStyle = 'white';
    context.fill();
  }
  return new THREE.CanvasTexture(canvas);
};

const createRingTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.beginPath();
    context.arc(32, 32, 28, 0, 2 * Math.PI);
    context.lineWidth = 8;
    context.strokeStyle = 'white';
    context.stroke();
  }
  return new THREE.CanvasTexture(canvas);
};

// Radial gradient texture (white core -> transparent edge) for supernova / lens sprites
const createRadialGradientTexture = (size = 256, innerAlpha = 1, midAlpha = 0.55) => {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if(ctx){
    const g = ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
    g.addColorStop(0,`rgba(255,255,255,${innerAlpha})`);
    g.addColorStop(0.55,`rgba(255,255,255,${midAlpha})`);
    g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
};

interface SolarSystem {
  id: number;
  name: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
  region_id: number;
  constellation_id: number;
  planets: number;
  hidden?: boolean;
}

interface Stargate {
  id: number;
  name: string;
  source_system_id: number;
  destination_system_id: number;
}

interface MapData {
  solar_systems: { [key: string]: SolarSystem };
  stargates: { [key: string]: Stargate };
  regions: { [key: string]: RegionRow };
  constellations: { [key: string]: ConstellationRow };
}

type SqlValue = number | string | Uint8Array | null;

// Define colors for selection and base
const DEFAULT_STAR_COLOR = new THREE.Color(0xffffff);
let SELECTED_STAR_COLOR = new THREE.Color(0xff4c26); // Will track accent (orange default)
const REGION_OUTLINE_COLOR = new THREE.Color(0x00aaff); // Shared blue for region outlines

function App() {
  // Lightweight standalone stats page rendering (no full router). If path is /stats, render stats component only.
  if (typeof window !== 'undefined' && window.location.pathname === '/stats') {
    return <StatsPage />;
  }
  // Synchronous initial prefs load for reliable first render
  const initialPrefsRef = useRef(getPrefs());
  // Accent color (persisted)
  const [accentIsBlue, setAccentIsBlue] = useState(initialPrefsRef.current.accent === 'blue');
  // Theme usage tracking
  useEffect(()=>{ try { (window as any).__efSetThemeAccent && (window as any).__efSetThemeAccent(accentIsBlue ? 'blue':'orange'); } catch { /* ignore */ } }, [accentIsBlue]);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  // Hover tuning (runtime adjustable via window.__efSetHoverTuning for local testing)
  const hoverTuningRef = useRef({
    minDistance: 100,
    maxDistance: 50000,
    minThreshold: 1,
    maxThreshold: 300,
    allowBelowMinDistance: true,
  floorBelowMin: 0.12,
    curveExp: 1,
  });
  useEffect(()=>{ (window as any).__efSetHoverTuning = (opts: Partial<typeof hoverTuningRef.current>) => { Object.assign(hoverTuningRef.current, opts); console.log('[EF] Updated hover tuning', hoverTuningRef.current); }; }, []);
  const [isLoaded, setIsLoaded] = useState(false);

  const mountRef = useRef<HTMLDivElement>(null);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [resetToken, setResetToken] = useState(0); // input/forms reset
  const [layoutResetToken, setLayoutResetToken] = useState(0); // layout-only reset for panel positions
  // UI visibility + scaling
  const [hideUI, setHideUI] = useState(false);
  const uiScaleTrackedRef = useRef(false); // ensure only first ui_scale per session
  const uiScaleStops = [0.5,0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3];
  const initialScale = (():number=>{ const p=getPrefs(); return (p as any).uiScale && typeof (p as any).uiScale==='number'? (p as any).uiScale : 1; })();
  const [uiScale, setUiScale] = useState(initialScale); // active scale (applies only to main panels + toolbar)
  const [highlightedSystem, setHighlightedSystem] = useState<SolarSystem | null>(null);
  const [lastSelectedSystemName, setLastSelectedSystemName] = useState<string>(''); // propagate to modules
  const [lastDestinationSystemName, setLastDestinationSystemName] = useState<string>(''); // right-click destination propagation
  const [waypoints, setWaypoints] = useState<string[]>([]); // ordered list (max 10)
  const [avoidSystems, setAvoidSystems] = useState<string[]>([]);
  const [waypointOptimize, setWaypointOptimize] = useState<boolean>(false); // false = visit in order added
  const destinationLockedRef = useRef<boolean>(false); // becomes true once user explicitly sets destination via context menu
  const [hoveredSystem, setHoveredSystem] = useState<SolarSystem | null>(null);
  const hoveredSystemRef = useRef<SolarSystem | null>(null);
  useEffect(()=> { hoveredSystemRef.current = hoveredSystem; }, [hoveredSystem]);
  const [isRegionHighlighterActive, setIsRegionHighlighterActive] = useState(false);
  const regionSystemsIndexRef = useRef<Map<number, any[]>|null>(null);
  const [regionStatsVisible, setRegionStatsVisible] = useState(true); // show by default when region highlight active
  const [regionCompareLoading, setRegionCompareLoading] = useState(false);
  const [regionCompareStats, setRegionCompareStats] = useState<Record<number, RegionStats|null>>({});
  const regionStatsCacheRef = useRef<Map<number, RegionStats>>(new Map());
  const regionStatsWorkerRef = useRef<Worker | null>(null);
  const [regionStatsLoading, setRegionStatsLoading] = useState(false);
  const [activeRegionStats, setActiveRegionStats] = useState<RegionStats | null>(null);
  const [activeRegionName, setActiveRegionName] = useState<string>('');
  const regionStatsRequestedRef = useRef<number|null>(null);
  const [isPlanetCountActive, setIsPlanetCountActive] = useState(false);
  // Five legend bins (dynamic ranges) active flags; default all true when DPC enabled
  const [planetBinsActive, setPlanetBinsActive] = useState<boolean[]>([true, true, true, true, true]);
  // Stations visibility (persisted preference)
  const [showStations, setShowStations] = useState<boolean>(()=>{ try { return !!(getPrefs() as any).showStations; } catch { return false; } });
  const [stationsRetryToken, setStationsRetryToken] = useState(0); // forces re-run until station global available
  const stationsRetryTimeoutRef = useRef<number|undefined>(undefined);
  const stationSpriteGroupRef = useRef<THREE.Group|null>(null);
  const stationIconTexRef = useRef<THREE.Texture|null>(null);
  const stationSystemIdSetRef = useRef<Set<number>|null>(null);
  const stationShowRef = useRef<boolean>(false); // mirror showStations for animate loop
  const stationBaselineDistRef = useRef<number|null>(null); // baseline distance for sizing
  const stationFocusIdRef = useRef<number|null>(null); // current focus station system id
  const stationFocusDistRef = useRef<number>(Infinity); // distance of current focus
  const systemNameToIdRef = useRef<Map<string, number>|null>(null);
  useEffect(()=>{ // build name->id map once map data loaded
    if(mapData){
      const m = new Map<string, number>();
      for(const s of Object.values(mapData.solar_systems)) m.set(s.name, s.id);
      systemNameToIdRef.current = m;
    }
  }, [mapData]);

  // Build region->systems index once mapData available
  useEffect(()=>{
    if(!mapData) return;
    if(regionSystemsIndexRef.current) return;
    const idx = new Map<number, any[]>();
    for(const key in mapData.solar_systems){
      const s = (mapData.solar_systems as any)[key];
      if(!s) continue;
      const rid = typeof s.region_id==='string'? Number(s.region_id): s.region_id;
      if(!idx.has(rid)) idx.set(rid, []);
      idx.get(rid)!.push(s);
    }
  regionSystemsIndexRef.current = idx;
  const sampleKeys:number[] = [];
  for(const k of idx.keys()){ sampleKeys.push(k); if(sampleKeys.length>=5) break; }
  // Compare Regions: region->systems index built
  }, [mapData]);
  useEffect(()=>{ stationShowRef.current = showStations; }, [showStations]);
  const [showDistance, setShowDistance] = useState(false);
  // Track theme selections (already counted once per change)
  useEffect(()=>{ try { (window as any).__efSetThemeAccent && (window as any).__efSetThemeAccent(accentIsBlue ? 'blue':'orange'); } catch {} }, [accentIsBlue]);
  // First UI scale per session (captures default or first user change only) & persist changes
  useEffect(()=>{
    // Lazy init region stats worker
    if(!regionStatsWorkerRef.current){
      try {
        regionStatsWorkerRef.current = new Worker(new URL('./workers/region_stats_worker.ts', import.meta.url), { type:'module' });
        console.debug('[RegionStats] Worker created');
        regionStatsWorkerRef.current.onmessage = (e: MessageEvent)=>{
          const data = e.data;
            if(data && data.type==='result'){
              console.debug('[RegionStats] Worker result received', data);
              const regions: Record<number, RegionStats> = data.regions || {};
              Object.entries(regions).forEach(([rid, stats])=>{
                regionStatsCacheRef.current.set(Number(rid), stats as RegionStats);
              });
              // Prefer explicit requested region id (works even if no highlighted system)
              if(regionStatsRequestedRef.current!=null){
                const stats = regionStatsCacheRef.current.get(regionStatsRequestedRef.current) || null;
                if(stats){ setActiveRegionStats(stats); }
              } else if(highlightedSystem){
                const rid = highlightedSystem.region_id; const stats = regionStatsCacheRef.current.get(rid) || null; if(stats){ setActiveRegionStats(stats); }
              } else {
                // Fallback: if only one region in payload, use it
                const keys = Object.keys(regions); if(keys.length===1){ const only = Number(keys[0]); const stats = regionStatsCacheRef.current.get(only) || null; if(stats){ setActiveRegionStats(stats); regionStatsRequestedRef.current = only; } }
              }
              setRegionStatsLoading(false);
            }
        };
        regionStatsWorkerRef.current.onerror = (err)=>{
          console.warn('[RegionStats] Worker error', err);
          setRegionStatsLoading(false);
        };
      } catch {}
    }
    return ()=>{
      regionStatsWorkerRef.current?.terminate();
      regionStatsWorkerRef.current = null;
    };
  }, []);

  // Inline fallback (single region) if worker unavailable
  const computeRegionStatsInline = useCallback((systems: {id:number; region_id:number; x:number; y:number; z:number; deg:number; planets?:number}[], gates:{a:number;b:number;len:number}[])=>{
    const hullArea = (pts:[number,number][])=>{ if(pts.length<3) return 0; const p=pts.slice().sort((a,b)=> a[0]===b[0]? a[1]-b[1]: a[0]-b[0]); const cross=(o:[number,number],a:[number,number],b:[number,number])=> (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]); const lower:[number,number][]=[]; for(const pt of p){ while(lower.length>=2 && cross(lower[lower.length-2], lower[lower.length-1], pt)<=0) lower.pop(); lower.push(pt);} const upper:[number,number][]=[]; for(let i=p.length-1;i>=0;i--){ const pt=p[i]; while(upper.length>=2 && cross(upper[upper.length-2], upper[upper.length-1], pt)<=0) upper.pop(); upper.push(pt);} upper.pop(); lower.pop(); const hull=lower.concat(upper); if(hull.length<3) return 0; let area=0; for(let i=0;i<hull.length;i++){ const [x1,y1]=hull[i]; const [x2,y2]=hull[(i+1)%hull.length]; area += x1*y2 - x2*y1; } return Math.abs(area)/2; };
    const systems_total = systems.length; let total_planets=0; const gatedIds:number[]=[]; for(const s of systems){ if(s.deg>0) gatedIds.push(s.id); if(s.planets) total_planets+=s.planets; }
    const systems_gated=gatedIds.length; const systems_isolated=systems_total - systems_gated;
    const gate_links=gates.length; const avg_gate_distance_ly = gate_links? gates.reduce((a,g)=>a+g.len,0)/gate_links:0;
    const footprint_area_ly2=hullArea(systems.map(s=> [s.x,s.z] as [number,number]));
    const system_density_per_100_ly2 = footprint_area_ly2>0? (systems_total/footprint_area_ly2)*100:0;
    const connectivity_pct = systems_total? (systems_gated/systems_total)*100:0;
    const avg_gate_degree = systems_gated? (2*gate_links)/systems_gated:0;
  // Simplified estimates matching worker schema (lower bounds / placeholders)
  const est_gated_distance_ly = 0; // no MST inline fallback
  const est_gated_gate_jumps = systems_gated>0? systems_gated-1:0;
  const est_all_distance_ly = est_gated_distance_ly; // no isolated attachment math inline
  const all_gate_jumps = est_gated_gate_jumps;
  const ship_jumps = systems_isolated; // treat each isolated as one ship jump (placeholder)
  const ship_jump_ly = 0; // not computed inline
  const total_jumps = all_gate_jumps + ship_jumps;
  const min_jump_range_ly = 0;
    const avg_planets_per_system = systems_total? total_planets/systems_total:0;
  const has_station = systems.some(s=> (s as any).has_station);
  return { systems_total, systems_gated, systems_isolated, connectivity_pct, gate_links, avg_gate_distance_ly, avg_gate_degree, footprint_area_ly2, system_density_per_100_ly2, est_gated_distance_ly, est_gated_gate_jumps, est_all_distance_ly, all_gate_jumps, ship_jumps, ship_jump_ly, total_jumps, min_jump_range_ly, total_planets, avg_planets_per_system, has_station } as RegionStats;
  }, []);

  // Trigger computation when region highlight toggled ON or highlighted system changes
  useEffect(()=>{
    if(isRegionHighlighterActive && highlightedSystem && mapData){
  // Ensure region stats panel considered open for cascade if not already
  setOpenPanels(prev=> { if(prev.has('region-stats')) return prev; const n=new Set(prev); n.add('region-stats'); return n; });
  setOpenPanelOrder(o=> o.includes('region-stats')? o : [...o, 'region-stats']);
      const rid = highlightedSystem.region_id;
      setActiveRegionName(mapData.regions[String(rid)]?.name || `Region ${rid}`);
      setRegionStatsVisible(true);
      const existing = regionStatsCacheRef.current.get(rid) || null;
      setActiveRegionStats(existing);
  if(!existing){
        regionStatsRequestedRef.current = rid;
        // Prepare system + gate arrays
        const systems: any[] = []; const gates: any[] = [];
        // Gather systems in region
        const regionSystems: any[] = [];
        for (const key in mapData.solar_systems){
          const s = (mapData.solar_systems as any)[key];
          if(s.region_id === rid){ regionSystems.push(s); }
        }
        // Build degree map
        const deg = new Map<number, number>();
        for (const gKey in mapData.stargates){
          const g = (mapData.stargates as any)[gKey];
          const a = g.source_system_id; const b = g.destination_system_id;
          if(a==null||b==null) continue;
          deg.set(a,(deg.get(a)||0)+1); deg.set(b,(deg.get(b)||0)+1);
        }
        const stationSet = stationSystemIdSetRef.current;
        for (const s of regionSystems){
          systems.push({ id:s.id, region_id: s.region_id, x:s.position.x, y:s.position.y, z:s.position.z, deg: deg.get(s.id)||0, planets: s.planets, has_station: stationSet? stationSet.has(s.id) : false });
        }
        for (const gKey in mapData.stargates){
          const g = (mapData.stargates as any)[gKey];
          const a = g.source_system_id; const b = g.destination_system_id;
          if(!a||!b) continue;
          // Only collect length if both endpoints in this region
          const sa = (mapData.solar_systems as any)[String(a)];
          const sb = (mapData.solar_systems as any)[String(b)];
          if(sa && sb && sa.region_id===rid && sb.region_id===rid){
            const dx = sa.position.x - sb.position.x;
            const dy = sa.position.y - sb.position.y;
            const dz = sa.position.z - sb.position.z;
            const len = Math.sqrt(dx*dx+dy*dy+dz*dz);
            gates.push({ a: sa.id, b: sb.id, len });
          }
        }
        setRegionStatsLoading(true);
        if(regionStatsWorkerRef.current){
          console.debug('[RegionStats] Posting compute request', {rid, systems: systems.length, gates: gates.length});
          try { regionStatsWorkerRef.current.postMessage({ type:'compute', systems, gates }); } catch (e){ console.warn('[RegionStats] postMessage failed', e); setRegionStatsLoading(false); }
        } else {
          // Inline fallback
          console.debug('[RegionStats] Worker missing – computing inline');
          try {
            const stats = computeRegionStatsInline(systems, gates);
            regionStatsCacheRef.current.set(rid, stats);
            setActiveRegionStats(stats);
          } catch(e){ console.warn('[RegionStats] Inline compute failed', e); }
          setRegionStatsLoading(false);
        }
      }
    } else {
  setActiveRegionStats(null);
  // When highlighter deactivates, remove panel unless user reopens later
  setOpenPanels(prev=> { if(!prev.has('region-stats')) return prev; const n=new Set(prev); n.delete('region-stats'); return n; });
    }
  }, [isRegionHighlighterActive, highlightedSystem, mapData, computeRegionStatsInline]);

  // If loading exceeds 2 seconds without stats, attempt inline compute fallback again
  useEffect(()=>{
    if(regionStatsLoading && regionStatsRequestedRef.current!=null){
      const rid = regionStatsRequestedRef.current;
      if(activeRegionStats) return; // already have
      const t = setTimeout(()=>{
        if(!activeRegionStats && regionStatsLoading){
          try {
            console.debug('[RegionStats] Timeout fallback inline compute for region', rid);
            if(mapData){
              // Rebuild systems/gates for that region
              const systems:any[]=[]; const gates:any[]=[];
              const deg = new Map<number, number>();
              for (const gKey in mapData.stargates){ const g = (mapData.stargates as any)[gKey]; const a=g.source_system_id, b=g.destination_system_id; if(a==null||b==null) continue; deg.set(a,(deg.get(a)||0)+1); deg.set(b,(deg.get(b)||0)+1); }
              const stationSet = stationSystemIdSetRef.current;
              for (const key in mapData.solar_systems){ const s=(mapData.solar_systems as any)[key]; if(s.region_id===rid){ systems.push({ id:s.id, region_id:s.region_id, x:s.position.x, y:s.position.y, z:s.position.z, deg:deg.get(s.id)||0, planets: s.planets, has_station: stationSet? stationSet.has(s.id):false }); }}
              for (const gKey in mapData.stargates){ const g=(mapData.stargates as any)[gKey]; const a=g.source_system_id, b=g.destination_system_id; const sa=(mapData.solar_systems as any)[String(a)]; const sb=(mapData.solar_systems as any)[String(b)]; if(sa&&sb&&sa.region_id===rid&&sb.region_id===rid){ const dx=sa.position.x-sb.position.x; const dy=sa.position.y-sb.position.y; const dz=sa.position.z-sb.position.z; const len=Math.sqrt(dx*dx+dy*dy+dz*dz); gates.push({ a:sa.id,b:sb.id,len }); }}
              const stats = computeRegionStatsInline(systems,gates); regionStatsCacheRef.current.set(rid, stats); setActiveRegionStats(stats); setRegionStatsLoading(false);
            }
          } catch(e){ console.warn('[RegionStats] Timeout inline compute failed', e); setRegionStatsLoading(false); }
        }
      }, 2000);
      return ()=> clearTimeout(t);
    }
  }, [regionStatsLoading, activeRegionStats, mapData, computeRegionStatsInline]);

  // Track region stats view when stats first become available for a region
  useEffect(()=>{
    if(activeRegionStats && highlightedSystem){
      const rid = highlightedSystem.region_id;
      const key = 'rst:'+rid;
      if(!(window as any).__efRSV){ (window as any).__efRSV = new Set<string>(); }
      const s:Set<string> = (window as any).__efRSV;
      if(!s.has(key)){
        s.add(key);
        try { (window as any).__efTrackRegionStatsView && (window as any).__efTrackRegionStatsView(); } catch {}
      }
  try { console.debug('[RegionStats] Active stats set', activeRegionStats); } catch {}
      // Debug: surface station presence discrepancy quickly (can be removed later)
      try {
        if((window as any).console){
          const hasStation = (activeRegionStats as any).has_station;
          console.debug('[RegionStats][Debug] Region', rid, 'has_station =', hasStation, 'highlighted system id', highlightedSystem.id);
        }
      } catch {/* ignore */}
    }
  }, [activeRegionStats, highlightedSystem]);

  // Persist + broadcast UI scale changes
  useEffect(()=>{
    persistUiScale(uiScale);
    if(!uiScaleTrackedRef.current){ uiScaleTrackedRef.current = true; try { track({ type:'ui_scale', scale: Math.round(uiScale*100) }); } catch {} }
    try {
      document.documentElement.style.setProperty('--ui-scale', String(uiScale));
      window.dispatchEvent(new CustomEvent('ui-scale-change', { detail:{ scale: uiScale } }));
    } catch {/* ignore */}
  }, [uiScale]);
  // Hide UI toggle – count only when enabling
  useEffect(()=>{ if(hideUI){ try { track({ type:'ui_hide' }); } catch {} } }, [hideUI]);
  // Show Distance – count only when user turns it on
  useEffect(()=>{ if(showDistance){ try { track({ type:'show_distance' }); } catch {} } }, [showDistance]);
  const [minPlanets, setMinPlanets] = useState(0);
  const [maxPlanets, setMaxPlanets] = useState(0);
  // Cinematic mode active flag (enables scene post-processing & behavior changes)
  const [cinematicMode, setCinematicMode] = useState(false);
  // Reachability feature state
  const [reachRange, setReachRange] = useState<number>(120);
  const [reachAuto, setReachAuto] = useState(false);
  const [reachDim, setReachDim] = useState(true); // default highlight unreachable ON
  const [reachBubble, setReachBubble] = useState(false);
  const [reachInRangeHighlight, setReachInRangeHighlight] = useState(false); // highlight stars within raw distance <= reachRange when bubble shown
  const [reachStats, setReachStats] = useState<{ reachable:number; total:number; ms:number }|null>(null);
  const [reachComputing, setReachComputing] = useState(false);
  const reachabilityWorkerRef = useRef<Worker|null>(null);
  const reachInFlightRef = useRef<number>(0);
  const starBaseColorsRef = useRef<Float32Array|null>(null);
  const reachableSetRef = useRef<Set<number>|null>(null);
  const rangeBubbleRef = useRef<import('./modules/JumpRangeBubble').JumpRangeBubbleHandle|null>(null);
  const inRangeSetRef = useRef<Set<number>|null>(null);
  // External trigger for expanding Support section in Help
  const [supportExpandRequestId, setSupportExpandRequestId] = useState(0);
  const [cryptoModalOpen, setCryptoModalOpen] = useState(false);
  // (Legacy QR prefetch logic removed; handled inside DonateCryptoModal now)
  // Static support content (user supplied exact text)
  const supportContent = (
    <div className="support-project-content" style={{ display:'flex', flexDirection:'column', gap:'14px', fontSize:'14px', lineHeight:1.45 }}>
      <p style={{ margin:0 }}>Thanks for even opening this section - seriously.</p>
      <p style={{ margin:0 }}>The app is free to use, and my time on it is free too. I build this because I enjoy it.</p>
      <p style={{ margin:0 }}>That said, there are ongoing costs to keep things online and improving. I’ll always be transparent about them:</p>
      <div style={{ display:'flex', flexDirection:'column', gap:'6px', padding:'6px 10px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:6 }}>
        <div>Hosting: £19/month (may rise with traffic)</div>
        <div>Development tools: £40/month (GitHub Copilot)</div>
      </div>
      <p style={{ margin:0 }}>There’s no obligation to contribute. If you’d like to chip in, that support is very, very, very much appreciated—and it helps me cover the basics while keeping the app free for everyone.</p>
      <p style={{ margin:0 }}>
        <button type="button" onClick={()=> setCryptoModalOpen(true)} style={{ cursor:'pointer', display:'inline-block', background:'var(--accent)', color:'#fff', padding:'10px 18px', border:'none', borderRadius:6, fontWeight:700, textDecoration:'none', boxShadow:'0 2px 6px rgba(0,0,0,0.45)', letterSpacing:'.5px' }}>Donate via Crypto</button>
      </p>
      <p style={{ margin:'0 0 2px 0' }}>
  <a href="https://donate.stripe.com/8x200j3krbO9aVtdLS4gg00" onClick={()=>{ try { (window as any).__efTrackDonateClick && (window as any).__efTrackDonateClick('stripe'); } catch {} }} target="_blank" rel="noopener noreferrer" style={{ display:'inline-block', background:'var(--accent)', color:'#fff', padding:'10px 18px', borderRadius:6, fontWeight:700, textDecoration:'none', boxShadow:'0 2px 6px rgba(0,0,0,0.45)', letterSpacing:'.5px' }}>Donate via Stripe</a>
      </p>
      <p style={{ margin:0, fontSize:'12px', opacity:.65 }}>Stripe opens in a new secure tab.</p>
    </div>
  );
  // Bloom strength (committed) and draft for deferred apply (performance)
  const [bloomStrength, setBloomStrength] = useState(0.6); // committed default
  const [bloomStrengthDraft, setBloomStrengthDraft] = useState(0.6); // draft default
  const bloomStrengthRef = useRef(0.6);
  const dustAmount = 0.6; // 0..1
  const cinExposure = 1.0;
  const [bgIntensity, setBgIntensity] = useState(0); // default 0 per request
  const [auroraIntensity, setAuroraIntensity] = useState(0.55);
  const [showAurora, setShowAurora] = useState(true);
  const starColorStrength = 0.85; // rollback to earlier value
  const vignette = 1.0; // raised to remove center/edge contrast
  const grain = 0.35;
  const aberration = 0.002;
  const radialGlow = 0.0; // disabled to remove central bright spot
  const bloomPulseEnabled = true;
  const bloomPulseAmp = 0.05;
  const cameraDriftEnabled = true;
  const shootingStarsEnabled = true;
  const hueDriftEnabled = true; // rollback
  const secondDustEnabled = true;
  // Pause automated camera drift (user control)
  const [autoCamPaused, setAutoCamPaused] = useState(false);
  const autoCamPausedRef = useRef(false);
  useEffect(()=>{ autoCamPausedRef.current = autoCamPaused; }, [autoCamPaused]);
  // Ambient effects master toggle
  const ambientEffectsEnabled = true;
  // Effect scheduling refs
  const nextSupernovaAtRef = useRef<number>(0);
  const nextLensBlinkAtRef = useRef<number>(0);
  const nextCometAtRef = useRef<number>(0);
  const nextRippleAtRef = useRef<number>(0);
  // Cached textures for radial sprites
  const supernovaTexRef = useRef<THREE.Texture|null>(null);
  const lensFlareTexRef = useRef<THREE.Texture|null>(null);
  // Groups / pools
  const supernovaGroupRef = useRef<THREE.Group|null>(null);
  const lensFlareGroupRef = useRef<THREE.Group|null>(null);
  const rippleGroupRef = useRef<THREE.Group|null>(null);
  const cometGroupRef = useRef<THREE.Group|null>(null);
  const parallaxStarsRef = useRef<THREE.Points|null>(null);
  // Baseline (non-cinematic) ambient enhancements
  // Background sky & parallax removed: refs omitted
  // Simple object pools for reuse
  const supernovaPoolRef = useRef<(THREE.Sprite|THREE.Mesh)[]>([]);
  const lensPoolRef = useRef<(THREE.Sprite|THREE.Mesh)[]>([]);
  const ripplePoolRef = useRef<THREE.Mesh[]>([]);
  const cometPoolRef = useRef<THREE.Line[]>([]);
  // Experimental aurora veil refs
  const auroraMeshRef = useRef<THREE.Mesh|null>(null);
  const auroraMatRef = useRef<THREE.ShaderMaterial|null>(null);
  // Cinematic user-exposed controls (handled in drawer panel)
  const [starColorMode, setStarColorMode] = useState<'purple'|'white'|'blue'|'red'|'yellow'|'random'>('blue');
  // Haze: separate draft states to avoid perf spikes on continuous drag
  const [hazeColor, setHazeColor] = useState('#ff5555'); // default red from picker
  const [hazeIntensity, setHazeIntensity] = useState(0.05); // default lowered per request
  const [hazeRadius, setHazeRadius] = useState(250); // committed spread factor default
  const [hazeRadiusDraft, setHazeRadiusDraft] = useState(250);
  const [aberrationAmt, setAberrationAmt] = useState(0.002);
  // Optional display of labels while in cinematic mode
  const [cinematicLabels, setCinematicLabels] = useState(false); // Toggle to optionally show hover & selection labels during cinematic mode
  const cinematicLabelsRef = useRef(false);
  useEffect(()=>{ cinematicLabelsRef.current = cinematicLabels; }, [cinematicLabels]);
  // Autonomous cluster tour (camera glides to random dense cluster centroids)
  const [autoClusterTour, setAutoClusterTour] = useState(false);
  const autoClusterTourRef = useRef(false); useEffect(()=>{ autoClusterTourRef.current = autoClusterTour; }, [autoClusterTour]);
  const clusterTargetRef = useRef<THREE.Vector3|null>(null);
  const clusterApproachDirRef = useRef<THREE.Vector3|null>(null); // approach direction when moving to star
  const clusterAnimRef = useRef<{phase:'travelStar'|'panCenter'; start:number; travelDur:number; panDur:number; starPos:THREE.Vector3; camStart:THREE.Vector3; camEnd:THREE.Vector3; starTargetStart?:THREE.Vector3; panStart?:number; camPanStart?:THREE.Vector3; camPanEnd?:THREE.Vector3; orientDone?:boolean; travelStart?:number; initialAngle?:number; }|null>(null);
  const nextClusterAtRef = useRef<number>(Date.now()+30000); // schedule first after 30s idle
  const lastFrameTimeRef = useRef<number>(performance.now());

  // State for P2P Routing
  const routingWorkerRef = useRef<Worker | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [routeResult, setRouteResult] = useState<{ path: string[] | null; error?: string; minRequiredShipRange?: number } | null>(null);
  const [scoutRouteResult, setScoutRouteResult] = useState<{ path: string[] | null } | null>(null);
  const [scoutInvalidateToken, setScoutInvalidateToken] = useState(0);
  const [routeProgress, setRouteProgress] = useState<{ explored: number; frontier: number; elapsedMs: number; message: string } | null>(null);
  const [shareFeedback, setShareFeedback] = useState('');
  const lastP2PParamsRef = useRef<{ jump:number; optimize:'fuel'|'jumps'; algo:'astar'|'dijkstra'; from?:string; to?:string }>({ jump:60, optimize:'fuel', algo:'astar' });

  // New state for labels
  const hoverLabelObj = useRef<CSS2DObject | null>(null);
  const selectedLabelObj = useRef<CSS2DObject | null>(null);
  // Context menu (right-click) persistent label
  const contextMenuObjRef = useRef<CSS2DObject | null>(null);
  const contextMenuSystemRef = useRef<SolarSystem | null>(null);
  const labelRendererRef = useRef<CSS2DRenderer | null>(null); // store CSS2DRenderer for pointerEvents toggling
  // Waypoint / avoid helpers
  const addWaypoint = useCallback((name: string) => {
    setWaypoints(prev => prev.includes(name) ? prev : (prev.length < 10 ? [...prev, name] : prev));
  }, []);
  const removeWaypoint = useCallback((name: string) => { setWaypoints(prev => prev.filter(w => w !== name)); }, []);
  const removeAvoidSystem = useCallback((name: string) => { setAvoidSystems(prev => prev.filter(a => a !== name)); }, []);
  const addAvoidSystem = useCallback((name: string) => {
    setAvoidSystems(prev => prev.includes(name) ? prev : [...prev, name]);
  }, []);

  // Refs for three.js objects
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const starFieldRef = useRef<THREE.Points | null>(null);
  const overlayRingsRef = useRef<UserOverlayRings | null>(null); // persistent user overlay halos

  // When mapData loads (or changes), inject into overlay rings so positions rebuild with correct coordinates
  useEffect(()=>{
    if(mapData && overlayRingsRef.current){ try { overlayRingsRef.current.setMapData(mapData); } catch(e){ console.warn('[overlay] setMapData failed', e); } }
  }, [mapData]);
  const hoverPointRef = useRef<THREE.Points | null>(null);
  const stargateLinesRef = useRef<THREE.LineSegments | null>(null);
  // Glow pass removed; no secondary line material
  const routeLinesRef = useRef<THREE.Group | null>(null); // New ref for route lines
  const cinematicModeRef = useRef(false);
  useEffect(()=>{ cinematicModeRef.current = cinematicMode; }, [cinematicMode]);
  // Instrument cinematic mode enter/exit (bridge to usage.ts instrumentation)
  useEffect(()=>{
    if(typeof window !== 'undefined' && (window as any).__efSetCinematic){
      try { (window as any).__efSetCinematic(cinematicMode); } catch {}
    }
  }, [cinematicMode]);
  // Track which module produced the currently drawn route ('scout' or 'p2p')
  const routeSourceRef = useRef<'scout'|'p2p'|null>(null);
  const clearCurrentRoute = useCallback(() => {
    try {
      if (routeLinesRef.current && sceneRef.current) {
        routeLinesRef.current.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        sceneRef.current.remove(routeLinesRef.current);
        routeLinesRef.current = null;
      }
      routeAnimUpdatersRef.current = [];
      routeSourceRef.current = null;
    } catch (e) { /* ignore */ }
  }, []);
  const visibleSystemsRef = useRef<SolarSystem[]>([]);
  const animationRef = useRef({
    isAnimating: false,
    startTime: 0,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    duration: 500, // ms
  });
  // Bubble transition state (so bubble slides smoothly between old/new system centers instead of teleport)
  const bubbleAnimRef = useRef<{
    active:boolean; start:THREE.Vector3; end:THREE.Vector3; startTime:number; duration:number;
  }>({ active:false, start:new THREE.Vector3(), end:new THREE.Vector3(), startTime:0, duration:600 });

  // Updaters that run each frame (used for route pulse animations)
  const routeAnimUpdatersRef = useRef<Array<() => void>>([]);
  // Dynamic route thickness scaling refs (for pulse sphere sync with pixel cap)
  // (Legacy tube radius refs removed; ribbon handles pixel sizing in shader.)

  // New refs for managing overlays
  const selectedStarHaloRef = useRef<THREE.Points | null>(null);
  const regionOutlineGroupRef = useRef<THREE.Group | null>(null);
  // Cinematic refs
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const originalToneMappingRef = useRef<number | null>(null);
  const originalExposureRef = useRef<number | null>(null);
  const originalStarMaterialRef = useRef<THREE.PointsMaterial | null>(null);
  const cinematicStarMaterialRef = useRef<THREE.PointsMaterial | null>(null);
  const dustPointsRef = useRef<THREE.Points | null>(null);
  const backgroundMeshRef = useRef<THREE.Mesh | null>(null);
  const advancedPassRef = useRef<any>(null);
  const secondDustRef = useRef<THREE.Points|null>(null);
  const meteorsGroupRef = useRef<THREE.Group|null>(null);
  const lastMeteorSpawnRef = useRef<number>(0);
  const lastInteractionRef = useRef<number>(Date.now());

  const isDraggingRef = useRef(false);
  const mouseDownPosRef = useRef(new THREE.Vector2());
  const mouseDownTimeRef = useRef(0);
  const firstMoveRef = useRef(false); // suppress initial phantom hover until user moves

  const circleTexture = useMemo(() => createCircleTexture(), []);
  const ringTexture = useMemo(() => createRingTexture(), []);

  const pointsMaterial = useMemo(() => {
    // Static star sprites (no temporal pulsing) with soft halo falloff
    const material = new THREE.PointsMaterial({
      size: 2,
      sizeAttenuation: true,
      map: circleTexture,
      transparent: true,
      alphaTest: 0.5,
      vertexColors: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.maxPointSize = { value: 10.0 };
      shader.vertexShader = `uniform float maxPointSize;\nattribute float aSize;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <logdepthbuf_vertex>',
        `gl_PointSize = min(gl_PointSize * aSize, maxPointSize);\n#include <logdepthbuf_vertex>`
      );
      const finalToken = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
      if(shader.fragmentShader.includes(finalToken)){
        shader.fragmentShader = shader.fragmentShader.replace(finalToken,
          // Radial intensity: brighter core (core^2.2), wider halo (power 0.65). Smooth alpha edge.
          `vec2 uv = gl_PointCoord * 2.0 - 1.0;\nfloat r2 = dot(uv,uv);\nif(r2>1.0){ discard; }\nfloat core = pow(1.0 - r2, 2.2);\nfloat halo = pow(1.0 - r2, 0.65);\nvec3 col = outgoingLight * (0.55*core + 0.45*halo);\nfloat alpha = diffuseColor.a * (1.0 - smoothstep(0.85,1.0,sqrt(r2)));\ncol = clamp(col,0.0,1.0);\ngl_FragColor = vec4(col, alpha);`);
      }
      (material as any).userData.shader = shader;
    };
    return material;
  }, [circleTexture]);

  const stargateMaterial = useMemo(() => {
  const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uNear: { value: 0 },
  uFar: { value: 120000 }, // initial; will be dynamically scaled
  uMinBright: { value: 1.80 }, // doubled far baseline visibility
  uMaxBright: { value: 2.40 }, // doubled near lift (glow adds punch)
        uBoost: { value: 1.0 },
  uOpacityNear: { value: 0.60 }, // almost constant opacity
  uOpacityFar: { value: 0.60 },
  uGamma: { value: 1.35 },
  uDebug: { value: 0.0 },
  uAccentColor: { value: new THREE.Color(0x00aaff) },
  uAccentSpan: { value: 0.66 } // fraction of segment length to show gradient
  },
  // Midpoint distance based fade (attribute 'mid') so each segment handled consistently.
  vertexShader: `attribute vec3 mid; attribute float sel; uniform vec3 uCamPos; varying float vDist; varying vec3 vColor; varying float vSel; void main(){ vColor = color; vSel = sel; vec3 worldMid = (modelMatrix * vec4(mid,1.0)).xyz; vDist = distance(uCamPos, worldMid); vec3 worldPos = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(worldPos,1.0); }`,
  fragmentShader: `uniform float uNear; uniform float uFar; uniform float uMinBright; uniform float uMaxBright; uniform float uBoost; uniform float uOpacityNear; uniform float uOpacityFar; uniform float uGamma; uniform float uDebug; uniform vec3 uAccentColor; uniform float uAccentSpan; varying float vDist; varying vec3 vColor; varying float vSel;\nvoid main(){\n  float t = clamp((vDist - uNear)/(uFar - uNear), 0.0, 1.0);\n  float tg = pow(t, uGamma);\n  if(uDebug > 0.5){ vec3 c1=vec3(0.2,1.0,1.0); vec3 c2=vec3(1.0,1.0,0.2); vec3 c3=vec3(1.0,0.2,1.0); vec3 colDbg = mix(mix(c1,c2,tg), c3, smoothstep(0.5,1.0,tg)); float opDbg = mix(uOpacityNear,uOpacityFar,tg); gl_FragColor = vec4(colDbg, opDbg); return; }\n  float bright = mix(uMaxBright, uMinBright, tg);\n  float op = mix(uOpacityNear, uOpacityFar, tg);\n  vec3 baseCol = clamp(vColor * bright * uBoost, 0.0, 2.0);\n  float dFromSelected = 1.0 - vSel;\n  float accentT = 1.0 - clamp(dFromSelected / uAccentSpan, 0.0, 1.0);\n  accentT = smoothstep(0.0, 1.0, accentT);\n  vec3 accentCol = clamp(uAccentColor * bright * uBoost, 0.0, 2.0);\n  vec3 finalCol = mix(baseCol, accentCol, accentT);\n  gl_FragColor = vec4(finalCol, op);\n}`
    });
    return mat;
  }, []);


  const getTransformedPosition = useCallback((position: { x: number; y: number; z: number }) => {
    return {
      x: position.x,
      y: position.z,
      z: position.y * -1,
    };
  }, []);

  // Helper to create label elements
  const createSystemLabelElement = useCallback((name: string, isPersistent = false, planets?: number): HTMLDivElement => {
    const wrapper = document.createElement('div');          // This becomes CSS2DObject.element
    wrapper.className = 'system-label-wrapper';
    wrapper.style.pointerEvents = 'none';

    const inner = document.createElement('div');            // Visible box
    inner.className = isPersistent ? 'system-label system-label--selected' : 'system-label';
    inner.textContent = name;

    // Add planet count if available and DPC is active
    if (planets !== undefined && isPlanetCountActive) {
      const planetCountSpan = document.createElement('span');
      planetCountSpan.className = 'planet-count';
      planetCountSpan.textContent = ` (${planets} planets)`;
      inner.appendChild(planetCountSpan);
    }

    wrapper.appendChild(inner);

    return wrapper;
  }, [isPlanetCountActive]);

  // Theme toggle effect: update CSS variable and three.js color constants
  useEffect(() => {
    const root = document.documentElement;
  root.style.setProperty('--accent', accentIsBlue ? 'var(--selection-blue)' : 'var(--selection-orange)');
  root.style.setProperty('--accent-rgb', accentIsBlue ? '0,170,255' : '255,76,38');
    // Tag root for CSS theme-specific rules
    root.setAttribute('data-accent', accentIsBlue ? 'blue' : 'orange');
  root.classList.add('cinematic-active');
    if (!accentIsBlue) {
  root.classList.remove('cinematic-active');
      // Pastel versions for orange mode only
      root.style.setProperty('--accent-pastel', '#ffb9ab'); // lightened orange
      root.style.setProperty('--accent-pastel-border', '#ff8665');
    } else {
      // Clear / reset so blue mode keeps normal look (browser default focus or existing styling)
      root.style.setProperty('--accent-pastel', '');
      root.style.setProperty('--accent-pastel-border', '');
    }
    // Update runtime three.js colors used by the app
  const accentHex = accentIsBlue ? 0x00aaff : 0xff4c26;
  // Keep module-scoped selected color in sync so selection effect uses correct accent
  SELECTED_STAR_COLOR = new THREE.Color(accentHex);
    // Update hover material if exists
    if (hoverPointRef.current) {
      (hoverPointRef.current.material as THREE.PointsMaterial).color.set(accentHex);
    }
  // Update region highlighter runtime colors
  try { setRegionHighlightColors(accentHex); } catch (e) { /* ignore */ }
    // Update selected star color and region outline color constants
    // ... App-level constants are module-scoped; update star colors directly when rendering/updating scenes
    // Reapply region highlight and stargate colors if active
    try {
      if (isRegionHighlighterActive && highlightedSystem && mapData && stargateLinesRef.current && starFieldRef.current) {
        // Re-run init to recolor buffers
        RegionHighlighterModule.init(
          sceneRef.current!,
          mapData,
          starFieldRef.current,
          stargateLinesRef.current,
          highlightedSystem,
          visibleSystemsRef.current,
          isPlanetCountActive
        );
      } else if (starFieldRef.current) {
        // If no region highlight, ensure selected star keeps the accent color
        const starColorsAttr = (starFieldRef.current.geometry as THREE.BufferGeometry).attributes.color as THREE.BufferAttribute;
        if (highlightedSystem && !isPlanetCountActive) {
          const highlightedIndex = visibleSystemsRef.current.findIndex(s => s.id === highlightedSystem.id);
          if (highlightedIndex !== -1) {
            const c = new THREE.Color(accentHex);
            c.toArray(starColorsAttr.array as Float32Array, highlightedIndex * 3);
            starColorsAttr.needsUpdate = true;
          }
        }
        // Update stargate colors if present
        if (stargateLinesRef.current) {
          const stargateColors = (stargateLinesRef.current.geometry as THREE.BufferGeometry).attributes.color as THREE.BufferAttribute;
          if (stargateColors && stargateColors.array) {
            // When no region is highlighted, reset to original grey for all gates
            const defaultGate = new THREE.Color(0x444444);
            for (let i = 0; i < stargateColors.array.length; i += 3) {
              defaultGate.toArray(stargateColors.array as Float32Array, i);
            }
            stargateColors.needsUpdate = true;
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }, [accentIsBlue]);

  // Helper to set label text
  const setLabelText = useCallback((obj: CSS2DObject, name: string, planets?: number) => {
    const inner = (obj.element as HTMLElement).querySelector('.system-label') as HTMLElement | null;
    if (inner) {
      inner.textContent = name;
      if (planets !== undefined && isPlanetCountActive) {
        const planetCountSpan = document.createElement('span');
        planetCountSpan.className = 'planet-count';
        planetCountSpan.textContent = ` (${planets} planets)`;
        inner.appendChild(planetCountSpan);
      }
    }
  }, [isPlanetCountActive]);

  const selectSystem = useCallback((system: SolarSystem) => {
  // Set the highlighted system for camera animation and the main rendering effect.
    setHighlightedSystem(system);
  // Store name for external consumers (P2P / Scout)
  try { setLastSelectedSystemName(system.name); } catch {/* ignore */}
    // Clear any open context menu when a new system is selected via left-click
    if(contextMenuObjRef.current){
      try {
        if(contextMenuObjRef.current.parent){
          contextMenuObjRef.current.parent.remove(contextMenuObjRef.current);
          if(sceneRef.current && contextMenuObjRef.current.parent instanceof THREE.Object3D){
            sceneRef.current.remove(contextMenuObjRef.current.parent);
          }
        }
      } catch {/* ignore */}
      contextMenuObjRef.current = null; contextMenuSystemRef.current = null;
    }

    // Skip label creation while in cinematic mode unless labels enabled
    if(cinematicModeRef.current && !cinematicLabelsRef.current){
      return;
    }
          

    // Clear previous persistent label
    if (selectedLabelObj.current && selectedLabelObj.current.parent) {
      selectedLabelObj.current.parent.remove(selectedLabelObj.current);
      if (sceneRef.current && selectedLabelObj.current.parent instanceof THREE.Object3D) {
        sceneRef.current.remove(selectedLabelObj.current.parent);
      }
    }

    // Create a new object to parent the label to (at the system's position)
    const newSelectedLabelParent = new THREE.Object3D();
    const transformedPos = getTransformedPosition(system.position);
    newSelectedLabelParent.position.set(transformedPos.x, transformedPos.y, transformedPos.z);
    sceneRef.current?.add(newSelectedLabelParent);

    // Create or update the label
    if (selectedLabelObj.current === null) {
      const el = createSystemLabelElement(system.name, true);
      selectedLabelObj.current = new CSS2DObject(el);
      selectedLabelObj.current.position.set(0, 0, 0);
      newSelectedLabelParent.add(selectedLabelObj.current);
    }
    else {
      setLabelText(selectedLabelObj.current, system.name);
      selectedLabelObj.current.position.set(0, 0, 0);
      newSelectedLabelParent.add(selectedLabelObj.current);
    }
    selectedLabelObj.current.visible = true;
    // Trigger auto reachability recompute when origin changes and auto enabled
    if(reachAuto){ computeReachability(system.name, reachRange); }
    // Initiate bubble center interpolation if bubble active & we have an existing bubble position
    if(reachBubble && rangeBubbleRef.current){
      try {
        const currentPos = rangeBubbleRef.current.group.position.clone();
        const newPosRaw = getTransformedPosition(system.position);
        const newPos = new THREE.Vector3(newPosRaw.x,newPosRaw.y,newPosRaw.z);
        bubbleAnimRef.current.active = true;
        bubbleAnimRef.current.start.copy(currentPos);
        bubbleAnimRef.current.end.copy(newPos);
        bubbleAnimRef.current.startTime = performance.now();
        // Match animation duration to camera animation if one is about to run (will be set shortly below). Fallback 600ms.
        bubbleAnimRef.current.duration = animationRef.current.isAnimating ? animationRef.current.duration : 600;
      } catch {/* ignore bubble anim setup */}
    }

    // Removed selection halo (persistent orange ring) per request; rely solely on small hover ring for targeting feedback.
    if(selectedStarHaloRef.current){
      // Hide any legacy halo that might still exist from earlier sessions.
      selectedStarHaloRef.current.visible = false;
    }

    // Fast local recolor so user sees feedback before layout effect re-runs.
    try {
      if (!isPlanetCountActive && !isRegionHighlighterActive && starFieldRef.current) {
        const starColorsAttr = (starFieldRef.current.geometry as THREE.BufferGeometry).attributes.color as THREE.BufferAttribute;
        const idx = visibleSystemsRef.current.findIndex(s => s.id === system.id);
        if (idx !== -1) {
          const accentHex = accentIsBlue ? 0x00aaff : 0xff4c26;
          new THREE.Color(accentHex).toArray(starColorsAttr.array as Float32Array, idx * 3);
          starColorsAttr.needsUpdate = true;
        }
      }
    } catch { /* ignore */ }

  }, [createSystemLabelElement, setLabelText, getTransformedPosition, isPlanetCountActive, isRegionHighlighterActive, accentIsBlue, reachAuto, reachRange]);

  // Reachability: init worker lazily
  const ensureReachWorker = () => {
    if(!reachabilityWorkerRef.current){
      reachabilityWorkerRef.current = new Worker(new URL('./utils/reachability_worker.ts', import.meta.url), { type:'module' });
      reachabilityWorkerRef.current.onmessage = (e)=>{
        const data = e.data;
        if(!data || data.type!=='result') return;
        const token = data.token; if(token !== reachInFlightRef.current) return; // stale
  setReachComputing(false);
  const reachableIds:number[] = data.reachableIds || [];
        const elapsedMs:number = data.elapsedMs || 0;
        const setReachable = new Set(reachableIds);
        reachableSetRef.current = setReachable;
        const total = visibleSystemsRef.current.length;
        setReachStats({ reachable: setReachable.size, total, ms: elapsedMs });
        try { track({ type:'reachability_compute' }); } catch {}
        if(reachDim){ applyReachabilityDimming(); }
      };
    }
  };

  const computeReachability = (originName:string, range:number) => {
    if(!mapData || !originName || !isFinite(range) || range<=0) return;
    ensureReachWorker();
    if(!reachabilityWorkerRef.current) return;
    reachInFlightRef.current = Date.now();
  setReachComputing(true);
  reachabilityWorkerRef.current.postMessage({ systems: mapData.solar_systems, stargates: mapData.stargates, originName, maxJumpDistance: range, token: reachInFlightRef.current });
  };

  // Apply / clear dimming
  const applyReachabilityDimming = () => {
    if(!reachDim){ clearReachabilityDimming(); return; }
    if(isRegionHighlighterActive || isPlanetCountActive) return; // avoid conflicts
    if(!starFieldRef.current || !reachableSetRef.current) return;
  const BASE_GATE_COLOR = new THREE.Color(0x444444); // normal map gate color
    const geom = starFieldRef.current.geometry as THREE.BufferGeometry;
    const colAttr = geom.getAttribute('color') as THREE.BufferAttribute;
    if(!colAttr) return;
    if(!starBaseColorsRef.current){
      starBaseColorsRef.current = new Float32Array(colAttr.array as ArrayLike<number>);
    } else {
      (colAttr.array as Float32Array).set(starBaseColorsRef.current);
    }
  // Unreachable star color (bright for point visibility)
  const rCol = new THREE.Color(0xff2c2c);
    for(let i=0;i<colAttr.count;i++){
      const sys = visibleSystemsRef.current[i]; if(!sys) continue;
      if(!reachableSetRef.current.has(sys.id)){
        const idx = i*3; const arr = colAttr.array as Float32Array;
        arr[idx] = rCol.r; arr[idx+1] = rCol.g; arr[idx+2] = rCol.b;
      }
    }
    colAttr.needsUpdate = true;
    // Recolor stargate lines unreachable (both endpoints unreachable or one unreachable?) choose both endpoints unreachable
    if(stargateLinesRef.current){
      const g2 = stargateLinesRef.current.geometry as THREE.BufferGeometry;
      const col2 = g2.getAttribute('color') as THREE.BufferAttribute;
      const stargateData = g2.userData?.stargateData as { source_system_id:number; destination_system_id:number }[]|undefined;
      if(col2 && stargateData){
        // restore to base grey for reachable segments; we recolor unreachable after
        for(let i=0;i<stargateData.length;i++){
          const a = stargateData[i];
          const unreachable = !reachableSetRef.current.has(a.source_system_id) && !reachableSetRef.current.has(a.destination_system_id);
          const baseIdx = i*2*3; // two vertices per segment, 3 components each
          const setSegment = (c:THREE.Color)=>{
            const arr = col2.array as Float32Array;
            arr[baseIdx] = c.r; arr[baseIdx+1]=c.g; arr[baseIdx+2]=c.b;
            arr[baseIdx+3] = c.r; arr[baseIdx+4]=c.g; arr[baseIdx+5]=c.b;
          };
          if(unreachable){
            // Gate lines: deeper burgundy to reduce perceived brightness under additive blending
            const dimGate = new THREE.Color(0x4f0d0d); // ~20% deeper burgundy for lower luminance
            setSegment(dimGate);
          } else setSegment(BASE_GATE_COLOR);
        }
        col2.needsUpdate = true;
      }
    }
  // Reapply selection gradient now that base gate colors updated
  try { if(highlightedSystem) { applySelectionGradient(); } } catch {/* ignore */}
  };
  const clearReachabilityDimming = () => {
    if(starBaseColorsRef.current && starFieldRef.current){
      const geom = starFieldRef.current.geometry as THREE.BufferGeometry;
      const colAttr = geom.getAttribute('color') as THREE.BufferAttribute;
      (colAttr.array as Float32Array).set(starBaseColorsRef.current);
      colAttr.needsUpdate = true;
    }
    // Also restore stargate line colors to normal base grey
    if(stargateLinesRef.current){
      try {
        const g2 = stargateLinesRef.current.geometry as THREE.BufferGeometry;
        const col2 = g2.getAttribute('color') as THREE.BufferAttribute;
        if(col2){
          const base = new THREE.Color(0x444444);
          for(let i=0;i<col2.array.length; i+=3){ base.toArray(col2.array as Float32Array, i); }
          col2.needsUpdate = true;
        }
      } catch { /* ignore */ }
    }
  // Reapply selection gradient if a system is highlighted
  try { if(highlightedSystem) { applySelectionGradient(); } } catch {/* ignore */}
  };

  // ---------- Selection Gradient (Option A) ----------
  const applySelectionGradient = useCallback(()=>{
    if(!stargateLinesRef.current) return;
    const geo = stargateLinesRef.current.geometry as THREE.BufferGeometry;
    let selAttr = geo.getAttribute('sel') as THREE.BufferAttribute | undefined;
    const data = geo.userData?.stargateData as { source_system_id:number; destination_system_id:number }[] | undefined;
    if(!selAttr && geo.getAttribute('position')){
      const vertCount = (geo.getAttribute('position') as THREE.BufferAttribute).count;
      const arr = new Float32Array(vertCount); // zeros
      geo.setAttribute('sel', new THREE.BufferAttribute(arr, 1));
      selAttr = geo.getAttribute('sel') as THREE.BufferAttribute;
    }
    if(!selAttr || !data) return;
    // Reset all
    const selArray = selAttr.array as Float32Array; selArray.fill(0);
    if(!highlightedSystem || isRegionHighlighterActive) { selAttr.needsUpdate = true; return; }
    const reachableSet = reachableSetRef.current;
    for(let i=0;i<data.length;i++){
      const seg = data[i];
      const bothUnreach = reachDim && reachableSet && !reachableSet.has(seg.source_system_id) && !reachableSet.has(seg.destination_system_id);
      if(bothUnreach) continue; // don't accent fully unreachable
      if(seg.source_system_id === highlightedSystem.id){
        selArray[i*2] = 1.0; // first vertex of segment
      } else if(seg.destination_system_id === highlightedSystem.id){
        selArray[i*2 + 1] = 1.0; // second vertex
      }
    }
    selAttr.needsUpdate = true;
    // Update accent color uniform to match current theme
    try { (stargateMaterial.uniforms as any).uAccentColor.value.setHex(accentIsBlue ? 0x00aaff : 0xff4c26); } catch {/* ignore */}
  }, [highlightedSystem, isRegionHighlighterActive, reachDim, accentIsBlue, stargateMaterial]);

  useEffect(()=>{ applySelectionGradient(); }, [applySelectionGradient]);

  // Deferred reapply one frame later to survive any later color reset effects triggered by selection
  useEffect(()=>{
    if(!highlightedSystem) return;
    const frame = requestAnimationFrame(()=>{ try { applySelectionGradient(); } catch {/* ignore */} });
    return ()=> cancelAnimationFrame(frame);
  }, [highlightedSystem, applySelectionGradient]);

  // Reapply gradient if reachability dimming changes underlying colors (clear highlight when deselected)
  useEffect(()=>{ if(!highlightedSystem) return; }, [reachDim]);

  useEffect(()=>{ if(!reachDim) { clearReachabilityDimming(); try { track({ type:'reachability_disable' }); } catch {} } else { if(reachableSetRef.current) { applyReachabilityDimming(); try { track({ type:'reachability_enable' }); } catch {} } } }, [reachDim]);
  // Stations sprite management
  useEffect(()=>{
    // Cleanup helper
    const clearRetry = () => { if(stationsRetryTimeoutRef.current){ clearTimeout(stationsRetryTimeoutRef.current); stationsRetryTimeoutRef.current = undefined; } };
    if(!showStations){
      clearRetry();
      if(stationSpriteGroupRef.current && sceneRef.current){ sceneRef.current.remove(stationSpriteGroupRef.current); }
      stationSpriteGroupRef.current = null; return;
    }
    // Already created -> nothing else to do
    if(stationSpriteGroupRef.current){ return; }
    // Populate set from global (loaded at DB init)
    if(!stationSystemIdSetRef.current){
      try { const g = (window as any).__efStations; if(g && g.ids) stationSystemIdSetRef.current = g.ids as Set<number>; } catch {/* ignore */}
    }
    // If still not ready, schedule retry (single outstanding)
    if(!stationSystemIdSetRef.current || !mapData || !sceneRef.current){
      if(showStations && !stationsRetryTimeoutRef.current){
        stationsRetryTimeoutRef.current = window.setTimeout(()=> setStationsRetryToken(t=> t+1), 160);
      }
      return;
    }
    clearRetry();
    // Ensure texture
    if(!stationIconTexRef.current){
      try {
        const loader = new THREE.TextureLoader();
        stationIconTexRef.current = loader.load(stationIconUrl + '?v=3', (tex)=>{
          try { const srgb = (THREE as any).SRGBColorSpace || (THREE as any).sRGBEncoding; (tex as any).colorSpace = srgb; tex.needsUpdate = true; } catch {/* ignore */}
        });
      } catch {/* ignore */}
    }
    // Build group once
    const group = new THREE.Group();
    const systems = Object.values(mapData.solar_systems);
    const set = stationSystemIdSetRef.current;
    let added = 0;
    for(const sys of systems){
      if(!set.has(sys.id)) continue;
      const mat = new THREE.SpriteMaterial({
        map: stationIconTexRef.current || undefined,
        color: 0xffffff,
        transparent: true,
        depthWrite: true, // write depth so stars behind do NOT show through solid parts
        depthTest: true,
        alphaTest: 0.02, // keep only fully transparent background pixels transparent
        toneMapped: false
      });
      const sprite = new THREE.Sprite(mat);
      const pos = getTransformedPosition(sys.position);
      sprite.center.set(0.5, 0);
      sprite.position.set(pos.x, pos.y, pos.z);
      sprite.scale.set(1,1,1);
      (sprite as any).userData = { systemId: sys.id, aspect: (()=>{ try { const img:any = stationIconTexRef.current?.image; if(img && img.width && img.height){ return img.width / img.height; } } catch{} return 1; })(), basePos: new THREE.Vector3(pos.x, pos.y, pos.z) };
      group.add(sprite); added++;
    }
    stationSpriteGroupRef.current = group;
    sceneRef.current.add(group);
    try { if((window as any).console){ console.debug('[Stations] Sprites created. Systems with stations:', set.size, 'Sprites added:', added); } } catch {/* ignore */}
    return () => { clearRetry(); };
  }, [showStations, mapData, getTransformedPosition, stationsRetryToken]);
  // Station scaling: 24px min at baseline/far, only nearest station to camera grows significantly; others remain near min.
  useEffect(()=>{
    let raf:number|undefined;
    const minPx = 24; // requested baseline / minimum
    const maxPx = 340; // maximum when extremely close (nearest only)
    const nonFocusMaxPx = 30; // slight growth allowance for non-focused stations
    const gapMinPx = 1;  // minimal gap when far
    const gapMaxPx = 8;  // gap when very close (focused)
    const tick = () => {
      if(stationShowRef.current && stationSpriteGroupRef.current && cameraRef.current){
        const cam = cameraRef.current; const hPx = window.innerHeight||1; const fov = cam.fov*Math.PI/180; const tanHalf=Math.tan(fov/2);
        // Initialize baseline distance once (average distance to first N sprites)
        if(stationBaselineDistRef.current == null){
          let sum=0,count=0; for(const child of stationSpriteGroupRef.current.children){ sum += cam.position.distanceTo(child.position); count++; if(count>250) break; }
          stationBaselineDistRef.current = count? (sum/count) : 15000;
        }
        const baseline = stationBaselineDistRef.current || 15000;
  const nearDist = baseline * 0.015; // extremely close for max size (~1.5% baseline)
  const growthStartDist = baseline * 0.10; // no growth until within 10% of baseline distance
        // Determine selected station focus override (if selected system has a station)
        let selectedFocusId: number | null = null;
        if(lastSelectedSystemName && systemNameToIdRef.current && stationSystemIdSetRef.current){
          const selId = systemNameToIdRef.current.get(lastSelectedSystemName) ?? null;
          if(selId != null && stationSystemIdSetRef.current.has(selId)) selectedFocusId = selId;
        }
        // Fallback nearest (only if no selected focus)
  let nearestId: number | null = null; let nearestDist = Infinity;
        if(selectedFocusId == null){
          for(const child of stationSpriteGroupRef.current.children){
            const d = cam.position.distanceTo(child.position);
            const sysId = (child as any).userData?.systemId;
            if(d < nearestDist){ nearestDist = d; nearestId = sysId; }
          }
        }
        // Hysteresis: only switch nearest focus if substantially closer (15%) to avoid flicker
        if(selectedFocusId == null){
          if(stationFocusIdRef.current != null && nearestId != null && stationFocusIdRef.current !== nearestId){
            // find distance to current focus (recompute)
            let currentFocusDist = stationFocusDistRef.current;
            if(!isFinite(currentFocusDist)){
              // recompute by scanning once
              for(const child of stationSpriteGroupRef.current.children){
                const sysId = (child as any).userData?.systemId;
                if(sysId === stationFocusIdRef.current){ currentFocusDist = cam.position.distanceTo(child.position); break; }
              }
            }
            if(!(nearestDist < currentFocusDist * 0.85)){
              // keep old focus
              nearestId = stationFocusIdRef.current;
              nearestDist = currentFocusDist;
            }
          }
        }
        // Decide final focus id
        let focusId: number | null = selectedFocusId != null ? selectedFocusId : nearestId;
        if(focusId !== stationFocusIdRef.current){
          stationFocusIdRef.current = focusId;
          stationFocusDistRef.current = (focusId === (selectedFocusId ?? nearestId)) ? (selectedFocusId != null ? nearestDist : nearestDist) : nearestDist;
        }
        for(const child of stationSpriteGroupRef.current.children){
          const dist = cam.position.distanceTo(child.position);
          const sysId = (child as any).userData?.systemId;
          const isFocus = (sysId != null && sysId === stationFocusIdRef.current);
          let targetPx:number;
          if(isFocus){
            // Growth only starts once inside growthStartDist
            if(dist > growthStartDist){
              targetPx = minPx;
            } else {
              let raw = (growthStartDist - dist) / (growthStartDist - nearDist);
              if(raw < 0) raw = 0; if(raw > 1) raw = 1;
              // Strong suppression until very close (power 4.5)
              const eased = Math.pow(raw, 4.5);
              targetPx = minPx + (maxPx - minPx) * eased;
            }
          } else {
            // Non-focused: minimal growth only very close; otherwise locked at min
            if(dist > growthStartDist){
              targetPx = minPx;
            } else {
              let raw = (growthStartDist - dist) / (growthStartDist - nearDist);
              if(raw < 0) raw = 0; if(raw > 1) raw = 1;
              const eased = Math.pow(raw, 3.5);
              targetPx = minPx + (nonFocusMaxPx - minPx) * eased;
            }
          }
          const worldPerPixel = 2 * dist * tanHalf / hPx;
          const worldH = worldPerPixel * targetPx;
          // Aspect ratio update (once texture loaded)
          let aspect = (child as any).userData?.aspect || 1;
          if(stationIconTexRef.current?.image){ const img:any = stationIconTexRef.current.image; if(img.width && img.height){ aspect = img.width/img.height; (child as any).userData.aspect = aspect; } }
          const sy = worldH; const sx = worldH * aspect;
          if(Math.abs(child.scale.x - sx) > 0.01 || Math.abs(child.scale.y - sy) > 0.01){ child.scale.set(sx, sy, Math.max(sx,sy)); }
          // Gap scaling: for focus, grow up to gapMaxPx; others stay near gapMinPx with slight easing
          let gapPx:number;
          if(isFocus){
            let gapRaw = (baseline - dist) / (baseline - nearDist);
            if(gapRaw < 0) gapRaw = 0; if(gapRaw > 1) gapRaw = 1;
            const gapEased = Math.pow(gapRaw, 0.5); // sqrt easing
            gapPx = gapMinPx + (gapMaxPx - gapMinPx) * gapEased;
          } else {
            gapPx = gapMinPx; // keep very close to star for non-focused
          }
          const basePos = (child as any).userData?.basePos; if(basePos){
            const gapWorld = worldPerPixel * gapPx;
            child.position.set(basePos.x, basePos.y + gapWorld, basePos.z);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return ()=>{ if(raf) cancelAnimationFrame(raf); };
  }, [showStations, cinematicMode]);

  // When exiting cinematic mode, scheduling station scaling re-baseline so sprites can grow again if baseline changed during cinematic.
  useEffect(()=>{
    if(!cinematicMode && showStations){
      // Invalidate baseline & focus so next scaling tick recomputes with current camera distance
      stationBaselineDistRef.current = null;
      stationFocusIdRef.current = null;
      stationFocusDistRef.current = Infinity;
    }
  }, [cinematicMode, showStations]);

  // Prioritize station sprite click selection: if user clicks on icon, select its system before star raycast fallback
  useEffect(()=>{
    if(!rendererRef.current) return;
    const dom = rendererRef.current.domElement;
    const handleClick = (e: MouseEvent) => {
      if(!showStations || !stationSpriteGroupRef.current || !cameraRef.current) return;
  const mouse = new THREE.Vector2();
      const rect = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
      mouse.y = -((e.clientY - rect.top)/rect.height)*2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cameraRef.current as THREE.Camera);
      const hits = raycaster.intersectObjects(stationSpriteGroupRef.current.children, false);
      if(hits.length && mapData){
        const hit = hits[0].object as THREE.Sprite & { userData?: any };
        const id = hit.userData?.systemId;
        if(id!=null){
          const sys = Object.values(mapData.solar_systems).find(s=> s.id === id);
          if(sys){ selectSystem(sys); setHoveredSystem(sys); }
        }
      }
    };
    dom.addEventListener('click', handleClick, true); // capture early
    return ()=>{ dom.removeEventListener('click', handleClick, true); };
  }, [showStations, mapData, selectSystem]);
  useEffect(()=>{ // if region/planet mode toggled while dim active, reapply or clear
    if(reachDim){ applyReachabilityDimming(); }
  }, [isRegionHighlighterActive, isPlanetCountActive]);

  // Bubble overlay lifecycle
  useEffect(()=>{
    if(!reachBubble){
      // Only record hide if an actual bubble existed (prevents double counting with prior toggle)
      if(rangeBubbleRef.current && sceneRef.current){
        sceneRef.current.remove(rangeBubbleRef.current.group);
        rangeBubbleRef.current.dispose();
        rangeBubbleRef.current = null;
        try { track({ type:'rangebubble_hide' }); } catch {}
      }
      return; // nothing to do when disabled and no bubble present
    }
    if(!sceneRef.current || !cameraRef.current) return;
    let created = false;
  if(!rangeBubbleRef.current){
      try {
    const handle = createJumpRangeBubble(reachRange, accentIsBlue);
        rangeBubbleRef.current = handle;
        sceneRef.current.add(handle.group);
        created = true;
        if(highlightedSystem){
          const pos = getTransformedPosition(highlightedSystem.position);
          handle.update(new THREE.Vector3(pos.x,pos.y,pos.z), reachRange, accentIsBlue, cameraRef.current);
        }
      } catch {/* ignore create errors */}
    }
    if(created){
      try { track({ type:'rangebubble_show' }); } catch {}
      // Auto-frame bubble on first creation
      if(highlightedSystem && controlsRef.current && cameraRef.current){
        try {
          const cam = cameraRef.current; const controls = controlsRef.current; const pos = getTransformedPosition(highlightedSystem.position);
          const center = new THREE.Vector3(pos.x,pos.y,pos.z);
          const radius = reachRange; if(radius>0){
            const fov = cam.fov * Math.PI/180; const aspect = cam.aspect; const hFov = 2*Math.atan(Math.tan(fov/2)*aspect);
            const desiredFill = 0.55; const effectiveR = radius/desiredFill; const distV = effectiveR/Math.tan(fov/2); const distH = effectiveR/Math.tan(hFov/2); const neededDist = Math.max(distV, distH);
            const currentDir = cam.position.clone().sub(controls.target).normalize();
            const newPos = center.clone().add(currentDir.multiplyScalar(neededDist));
            const anim = animationRef.current; anim.isAnimating = true; anim.startTime = Date.now(); anim.duration = 700;
            anim.startPos.copy(cam.position); anim.startTarget.copy(controls.target); anim.endTarget.copy(center); anim.endPos.copy(newPos);
          }
        } catch {/* ignore bubble zoom errors */}
      }
    }
  }, [reachBubble]);
  // Update bubble when inputs change
  useEffect(()=>{
    if(rangeBubbleRef.current && reachBubble && highlightedSystem && cameraRef.current){
  const { getTransformedPosition } = { getTransformedPosition: (p:any)=>({ x:p.x, y:p.z, z:p.y*-1 }) }; // replicate local helper minimally
      const posT = getTransformedPosition(highlightedSystem.position);
      const targetPos = new THREE.Vector3(posT.x, posT.y, posT.z);
      // Start or restart tween if new system selected
      const lastId = (bubbleAnimRef as any).current.lastSystemId as number|undefined;
      if(lastId === undefined || lastId !== highlightedSystem.id){
        const startPos = rangeBubbleRef.current.group.position.clone();
        bubbleAnimRef.current.active = true;
        bubbleAnimRef.current.start.copy(startPos);
        bubbleAnimRef.current.end.copy(targetPos);
        bubbleAnimRef.current.startTime = performance.now();
        bubbleAnimRef.current.duration = animationRef.current.isAnimating ? animationRef.current.duration : 600;
        (bubbleAnimRef as any).current.lastSystemId = highlightedSystem.id;
      }
      const currentPos = rangeBubbleRef.current.group.position.clone();
      const applyPos = bubbleAnimRef.current.active ? currentPos : targetPos;
      rangeBubbleRef.current.update(applyPos, reachRange, accentIsBlue, cameraRef.current);
      // Re-frame camera if range changed significantly (>5% delta) relative to current distance
  try {
        if(cameraRef.current && controlsRef.current){
          const cam = cameraRef.current; const controls = controlsRef.current; const center = new THREE.Vector3(posT.x,posT.y,posT.z);
          const desiredFill = 0.55; const fov = cam.fov*Math.PI/180; const aspect = cam.aspect; const hFov = 2*Math.atan(Math.tan(fov/2)*aspect);
          const effectiveR = reachRange/desiredFill; const distV = effectiveR/Math.tan(fov/2); const distH = effectiveR/Math.tan(hFov/2); const neededDist = Math.max(distV, distH);
          const currentDist = cam.position.clone().sub(center).length();
          if(Math.abs(currentDist - neededDist) / neededDist > 0.05){
            const dir = cam.position.clone().sub(controls.target).normalize();
            const newPos = center.clone().add(dir.multiplyScalar(neededDist));
            const anim = animationRef.current; anim.isAnimating = true; anim.startTime = Date.now(); anim.duration = 600;
            anim.startPos.copy(cam.position); anim.startTarget.copy(controls.target); anim.endTarget.copy(center); anim.endPos.copy(newPos);
          }
        }
      } catch {/* ignore */}
    }
  }, [reachRange, highlightedSystem, reachBubble, accentIsBlue]);

  // Public handlers passed to routing panel reachability tab via props (added later)
  const handleReachCompute = useCallback((origin:string, range:number)=>{ computeReachability(origin, range); // center if not already selected
    if(mapData){
      const systems = Object.values(mapData.solar_systems);
      const sys = systems.find(s=> s.name.toLowerCase()===origin.toLowerCase());
      if(sys){ selectSystem(sys as any); }
    }
  }, [mapData, selectSystem]);

  // Reachability origin manual change (from tab input)
  const handleReachOriginChange = (origin:string)=>{
    if(reachAuto && origin){ computeReachability(origin, reachRange); }
  };
  const handleReachRangeChange = (r:number)=>{
    setReachRange(r);
    if(reachAuto && highlightedSystem){ computeReachability(highlightedSystem.name, r); }
  };
  // Track range bucket on stable changes (debounced)
  useEffect(()=>{
    if(!reachRange) return;
    const id = setTimeout(()=>{
      const r = reachRange;
      let bucket:string;
      if(r < 10) bucket='rng_lt_10';
      else if(r < 25) bucket='rng_10_25';
      else if(r < 50) bucket='rng_25_50';
      else if(r < 100) bucket='rng_50_100';
      else bucket='rng_gt_100';
      try { track({ type:'reachability_range_bucket', bucket }); } catch {}
    }, 600); // wait for user to pause editing
    return ()=> clearTimeout(id);
  }, [reachRange]);
  const handleReachAutoChange = (v:boolean)=>{ setReachAuto(v); try { track({ type: v? 'reachability_auto_on':'reachability_auto_off' }); } catch {}; if(v && highlightedSystem){ computeReachability(highlightedSystem.name, reachRange); } };
  const handleReachDimChange = (v:boolean)=>{ setReachDim(v); /* effect will apply */ };
  const handleReachBubbleChange = (v:boolean)=>{
    // Tracking moved exclusively into lifecycle effect (creation/removal) to avoid double counts
    setReachBubble(v);
  };
  const handleReachInRangeChange = (v:boolean)=>{
    setReachInRangeHighlight(v);
    try { track({ type: v? 'reachability_inrange_on':'reachability_inrange_off' }); } catch {}
    if(!v){
      // restore baseline or dim if active
      if(starBaseColorsRef.current && starFieldRef.current){
        const geom = starFieldRef.current.geometry as THREE.BufferGeometry; const colAttr = geom.getAttribute('color') as THREE.BufferAttribute; (colAttr.array as Float32Array).set(starBaseColorsRef.current); colAttr.needsUpdate = true; }
      if(reachDim && reachableSetRef.current){ applyReachabilityDimming(); }
    } else {
      applyInRangeHighlight();
    }
  };

  const applyInRangeHighlight = () => {
    if(!reachInRangeHighlight || !reachBubble) return;
    if(isRegionHighlighterActive || isPlanetCountActive) return; // precedence rules
    if(!highlightedSystem || !starFieldRef.current) return;
    const geom = starFieldRef.current.geometry as THREE.BufferGeometry; const colAttr = geom.getAttribute('color') as THREE.BufferAttribute; if(!colAttr) return;
    if(!starBaseColorsRef.current){ starBaseColorsRef.current = new Float32Array(colAttr.array as ArrayLike<number>); } else { (colAttr.array as Float32Array).set(starBaseColorsRef.current); }
    const origin = highlightedSystem.position; const r2 = reachRange*reachRange; const arr = colAttr.array as Float32Array; inRangeSetRef.current = new Set();
    const accentHex = accentIsBlue ? 0x00aaff : 0xff4c26; const accentColor = new THREE.Color(accentHex); const unreachableColor = new THREE.Color(0xff2c2c);
    for(let i=0;i<colAttr.count;i++){
      const sys = visibleSystemsRef.current[i]; if(!sys) continue;
      const dx = sys.position.x-origin.x, dy = sys.position.y-origin.y, dz = sys.position.z-origin.z; const d2 = dx*dx+dy*dy+dz*dz;
      if(d2 <= r2){
        inRangeSetRef.current.add(sys.id);
        accentColor.toArray(arr, i*3);
      }
    }
    if(reachDim && reachableSetRef.current){
      const rSet = reachableSetRef.current; for(let i=0;i<colAttr.count;i++){ const sys = visibleSystemsRef.current[i]; if(!sys) continue; if(!rSet.has(sys.id) && !inRangeSetRef.current.has(sys.id)){ unreachableColor.toArray(arr, i*3); } }
    }
    colAttr.needsUpdate = true;
  };
  // Reapply when dependencies change
  useEffect(()=>{ if(reachInRangeHighlight && reachBubble){ applyInRangeHighlight(); } }, [reachInRangeHighlight, reachBubble, reachRange, highlightedSystem, accentIsBlue, reachDim]);
  // Open Add Overlay modal with Shift+RightClick on a hovered or highlighted system
  useEffect(()=>{
    if(!OVERLAY_FEATURE_FLAG) return;
    const handler = (e:MouseEvent) => {
      if(e.button===2 && e.shiftKey){
        const sys = hoveredSystemRef.current || highlightedSystem;
        if(sys){
          e.preventDefault();
            setAddOverlaySystem({ id: sys.id, name: sys.name });
            setAddOverlayOpen(true);
            setOpenPanels(p=> { const n=new Set(p); n.add('user-overlay'); return n; });
        }
      }
    };
    window.addEventListener('mousedown', handler, { capture:true });
    return ()=> window.removeEventListener('mousedown', handler, { capture:true } as any);
  }, [highlightedSystem]);


  // Initialize and manage the routing worker
  useEffect(() => {
    // Helper to create a worker and wire its message handler. We recreate when mapData or selectSystem changes.
    const createWorker = () => {
      const worker = new Worker(new URL('./utils/routing_worker.ts', import.meta.url), { type: 'module' });
      routingWorkerRef.current = worker;

      worker.onmessage = (e) => {
        const data = e.data;
        if (data && data.type === 'progress') {
          setRouteProgress({ explored: data.explored ?? 0, frontier: data.frontier ?? 0, elapsedMs: data.elapsedMs ?? 0, message: data.message ?? '' });
          return;
        }
  const { path, error, minRequiredShipRange } = data;
        setIsCalculatingRoute(false);
        // compute and store elapsed time if we started one
        if (routeCalcStartRef.current) {
          const elapsed = Date.now() - routeCalcStartRef.current;
          setRouteCalcTimeMs(elapsed);
          routeCalcStartRef.current = null;
        }
        setRouteProgress(null);
        if (error) {
          // If minRequiredShipRange present, include in alert detail
          if(minRequiredShipRange !== undefined){
            alert(`Routing Error: ${error}${minRequiredShipRange?`\nMinimum ship range required: ${minRequiredShipRange.toFixed(2)} LY`:''}`);
          } else {
            alert(`Routing Error: ${error}`);
          }
          setRouteResult({ path: null, error, minRequiredShipRange });
          return;
        }
        setRouteResult({ path, error: undefined });
        try {
          const hops = path ? Math.max(0, path.length-1) : 0;
          const algoUsed = (lastP2PParamsRef.current?.algo) || 'astar';
          const optMode = (lastP2PParamsRef.current?.optimize) || 'fuel';
          (window as any).__efTrackP2PRouteMeta && (window as any).__efTrackP2PRouteMeta(algoUsed, optMode, hops, waypoints.length);
          (window as any).__efMarkFirstAction && (window as any).__efMarkFirstAction('p2p');
        } catch {}
  // Clear any existing share hash now that user has generated a fresh route locally
  if(window.location.hash){ try { history.replaceState(null,'', window.location.pathname + window.location.search); } catch { /* ignore */ } }

        // On successful route, center the view on the starting system
        if (path && path.length > 0 && mapData) {
          const systemsByName = Object.fromEntries(Object.values(mapData.solar_systems).map(s => [s.name.toLowerCase(), s]));
          const startSystem = systemsByName[path[0].toLowerCase()];
          if (startSystem) {
            selectSystem(startSystem);
          }
        }
      };

      return worker;
    };

    const worker = createWorker();

    // Terminate the worker on cleanup
    return () => {
      worker.terminate();
      routingWorkerRef.current = null;
    };
  }, [mapData, selectSystem]);

  // Track route calculation start time and elapsed time
  const routeCalcStartRef = useRef<number | null>(null);
  const [routeCalcTimeMs, setRouteCalcTimeMs] = useState<number | null>(null);

  // Multi-panel open state (allow several drawers at once) - persisted
  const [openPanels, setOpenPanels] = useState<Set<string>>(new Set());
  // User Overlay Rings visibility & rebuild (consolidated)
  // Ensures halos reliably reappear after exiting cinematic mode while panel remains open (fix for step 4 failing)
  const prevOverlayShowRef = useRef<boolean>(false);
  useEffect(()=>{
    if(!overlayRingsRef.current) return;
    const shouldShow = openPanels.has('user-overlay') && !cinematicMode;
    // Always set visibility when dependency changes (even if same) to recover from any external visibility side-effects
    try { overlayRingsRef.current.setVisible(shouldShow); } catch {/* ignore */}
    // Rebuild when transitioning hidden -> visible or after cinematic exit
    const becameVisible = shouldShow && !prevOverlayShowRef.current;
    if(becameVisible){
      try { (overlayRingsRef.current as any).rebuild?.(); } catch {/* ignore */}
      try { requestAnimationFrame(()=>{ if(overlayRingsRef.current){ overlayRingsRef.current.setVisible(true); }}); } catch {/* ignore */}
    }
    // If panel just opened (regardless of cinematic state) and we have geometry, force rebuild to refresh positions/colors
    if(openPanels.has('user-overlay') && !prevOverlayShowRef.current && overlayRingsRef.current){
      try { (overlayRingsRef.current as any).rebuild?.(); } catch {/* ignore */}
    }
    prevOverlayShowRef.current = shouldShow;
  }, [openPanels, cinematicMode]);
  // Explicit cinematic exit recovery (belt & suspenders) – if panel open after cinematic ends but rings still hidden/missing
  const prevCinematicRef = useRef<boolean>(false);
  useEffect(()=>{
    if(!overlayRingsRef.current) { prevCinematicRef.current = cinematicMode; return; }
    if(prevCinematicRef.current && !cinematicMode && openPanels.has('user-overlay')){
      try {
        (overlayRingsRef.current as any).rebuild?.();
        overlayRingsRef.current.setVisible(true);
        requestAnimationFrame(()=>{ try { overlayRingsRef.current && overlayRingsRef.current.setVisible(true); } catch {/* ignore */} });
      } catch {/* ignore */}
    }
    prevCinematicRef.current = cinematicMode;
  }, [cinematicMode, openPanels]);
  // Debug state helper
  // (Removed debug overlay state helper in production)
  // Rescue / re-init: if overlay rings ref lost (e.g. hot reload or disposal) while panel open, recreate
  useEffect(()=>{
    if(!OVERLAY_FEATURE_FLAG) return;
    if(overlayRingsRef.current) return; // nothing to do
    if(!openPanels.has('user-overlay')) return;
    if(!sceneRef.current || !ringTexture) return;
    if(cinematicMode) return; // wait until cinematic off
    try {
  // silent rescue init
      overlayRingsRef.current = new UserOverlayRings(sceneRef.current, ringTexture, 15);
      if(mapData) overlayRingsRef.current.setMapData(mapData);
      overlayRingsRef.current.setVisible(true);
    } catch(e){ console.warn('[overlay] rescue init failed', e); }
  }, [openPanels, cinematicMode, mapData]);
  // Debug helper: window.__efOverlayForce(true|false) to manually toggle & rebuild
  useEffect(()=>{
    (window as any).__efOverlayForce = (v:boolean)=>{
      try {
        if(!overlayRingsRef.current) return;
        overlayRingsRef.current.setVisible(v);
        if(v){ (overlayRingsRef.current as any).rebuild?.(); }
      } catch {/* ignore */}
    };
  }, []);
  const [addOverlayOpen, setAddOverlayOpen] = useState(false);
  const [addOverlaySystem, setAddOverlaySystem] = useState<{ id:number; name:string }|null>(null);
  // Z-index management for draggable panels
  const [panelZ, setPanelZ] = useState<Record<string, number>>({});
  const topZRef = useRef(1500);
  const bringToFront = (id:string) => {
    setPanelZ(prev=> { const next={...prev}; topZRef.current +=1; next[id]= topZRef.current; return next; });
  };
  const [returnToStart, setReturnToStart] = useState(false);
  // One-time hash import ref
  const initialHashAppliedRef = useRef(false);

  // Track open order so cascade preserves open sequence (affects horizontal ordering)
  const [openPanelOrder, setOpenPanelOrder] = useState<string[]>([]);
  const togglePanel = (id:string) => setOpenPanels(prev => {
    const next = new Set(prev);
    if(next.has(id)) {
      next.delete(id);
      setOpenPanelOrder(o=> o.filter(p=> p!==id));
    } else {
      next.add(id);
      setOpenPanelOrder(o=> o.includes(id)? o : [...o, id]);
      if(id==='region-compare') { try { track({ type:'compare_regions_open' }); } catch {} }
    }
    return next;
  });
  const ensurePanel = (id:string) => setOpenPanels(prev => {
    if(prev.has(id)) return prev;
    const next = new Set(prev); next.add(id);
    setOpenPanelOrder(o=> o.includes(id)? o : [...o, id]);
    return next;
  });

  // Load persisted prefs once
  useEffect(()=>{
    // Effect still syncs open panels from prefs (order is reconstructed in same sequence)
    const prefs = loadPrefs();
    if(prefs.openPanels?.length){
      const set = new Set(prefs.openPanels);
      setOpenPanels(set);
      setOpenPanelOrder(prefs.openPanels);
    }
  if(prefs.lastJumpDistance){ lastP2PParamsRef.current.jump = prefs.lastJumpDistance; setPersistedJump(prefs.lastJumpDistance); }
  // (Scout ship max range persistence removed; ignore any existing value)
    if(prefs.optimizeFor){ lastP2PParamsRef.current.optimize = prefs.optimizeFor; setPersistedOptimize(prefs.optimizeFor); }
    if(prefs.algorithm){ lastP2PParamsRef.current.algo = prefs.algorithm; setPersistedAlgo(prefs.algorithm); }
  },[]);

  // Persist accent & open panels
  useEffect(()=>{ setAccent(accentIsBlue ? 'blue' : 'orange'); }, [accentIsBlue]);
  useEffect(()=>{ persistOpenPanels(Array.from(openPanels)); }, [openPanels]);

  // Refs to panel drawers for programmatic (non-persisting) positioning
  const routingDrawerRef = useRef<PanelDrawerHandle|null>(null);
  const cinematicDrawerRef = useRef<PanelDrawerHandle|null>(null);
  const regionStatsDrawerRef = useRef<PanelDrawerHandle|null>(null);
  const regionCompareDrawerRef = useRef<PanelDrawerHandle|null>(null);
  const userOverlayDrawerRef = useRef<PanelDrawerHandle|null>(null);
  // Maintain legend in open order when toggled
  useEffect(()=>{
    setOpenPanelOrder(prev=>{
      const has = prev.includes('planet-legend');
      if(isPlanetCountActive && !has) return [...prev, 'planet-legend'];
      if(!isPlanetCountActive && has) return prev.filter(p=> p!=='planet-legend');
      return prev;
    });
  }, [isPlanetCountActive]);

  // Overlay open/close metric hook
  useEffect(()=>{
    try {
      const visible = openPanels.has('user-overlay') && !cinematicMode;
      if(visible) (window as any).__efOverlayOpened?.((window as any).userOverlayCount || userOverlayStore.getEntries().length);
      else (window as any).__efOverlayClosed?.();
    } catch {/* ignore */}
  }, [openPanels, cinematicMode]);

  // Incremental cascade (append on open, compact on close) preserving existing positions.
  const autoOrderRef = useRef<string[]>([]); // current left-to-right order of auto-managed panels
  useLayoutEffect(()=>{
    const BASE_X = 140, BASE_Y = 70, GAP_X = 24;
  const managed = (id:string)=> id==='routing' || id==='cinematic' || id==='planet-legend' || id==='region-stats' || id==='region-compare' || id==='user-overlay';
    const active = openPanelOrder.filter(id=> managed(id) && (id==='planet-legend'? isPlanetCountActive : openPanels.has(id)));
    const prevOrder = autoOrderRef.current;
    // Remove any that are no longer active
    const closed = prevOrder.filter(id=> !active.includes(id));
    const still = prevOrder.filter(id=> active.includes(id));
    const newlyOpened = active.filter(id=> !prevOrder.includes(id));
    if(!active.length){ autoOrderRef.current = []; return; }
    // Abort if any user-moved panel
    if(active.some(id=> !!localStorage.getItem(id==='planet-legend'? 'panel-pos:planet-legend':'panel-pos:drawer-'+id))) return;
    const widthOf = (id:string):number => {
      const sel = id==='planet-legend'? '.ef-secondary-panel' : `.ef-drawer[data-panel-id="${id}"]`;
      const el = document.querySelector(sel) as HTMLElement | null; return el? el.offsetWidth : 0;
    };
    const place = (id:string, x:number) => {
      const target = { x, y: BASE_Y };
  if(id==='routing' && routingDrawerRef.current) routingDrawerRef.current.autoPosition(target);
  else if(id==='cinematic' && cinematicDrawerRef.current) cinematicDrawerRef.current.autoPosition(target);
  else if(id==='region-stats' && regionStatsDrawerRef.current) regionStatsDrawerRef.current.autoPosition(target);
  else if(id==='region-compare' && regionCompareDrawerRef.current) regionCompareDrawerRef.current.autoPosition(target);
  else if(id==='user-overlay' && userOverlayDrawerRef.current) userOverlayDrawerRef.current.autoPosition(target);
  else if(id==='planet-legend') { try { window.dispatchEvent(new CustomEvent('ef:auto-pos', { detail:{ id, target, cascade:true } })); } catch {/* ignore */} }
    };
    const compactAll = () => {
      let x = BASE_X;
      autoOrderRef.current.forEach(id=>{ place(id,x); x += widthOf(id) + GAP_X; });
    };
    const run = () => {
      // First update order reference
      autoOrderRef.current = [...still, ...newlyOpened];
      if(closed.length){
        // Compact everything left
        compactAll();
        return;
      }
      if(newlyOpened.length){
        // Determine rightmost edge among existing (still) panels
        let rightEdge = BASE_X - GAP_X; // so first existing sets proper edge
        if(still.length){
          still.forEach(id=>{
            const sel = id==='planet-legend'? '.ef-secondary-panel' : `.ef-drawer[data-panel-id="${id}"]`;
            const el = document.querySelector(sel) as HTMLElement | null;
            if(el){ const r = el.getBoundingClientRect(); const e = r.left + r.width; if(e>rightEdge) rightEdge = e; }
          });
        }
        newlyOpened.forEach((id, idx)=>{
          if(still.length===0 && idx===0){ // very first panel
            place(id, BASE_X);
            rightEdge = BASE_X + widthOf(id);
          } else {
            const x = (still.length===0 && idx===0)? BASE_X : rightEdge + GAP_X;
            place(id, x);
            rightEdge = x + widthOf(id);
          }
        });
      }
      // Overlap safeguard: if any overlap remains (left duplicates), force one full compact pass next frame (rare)
      requestAnimationFrame(()=>{
        const lefts:number[]=[]; let overlap=false;
        autoOrderRef.current.forEach(id=>{
          const sel = id==='planet-legend'? '.ef-secondary-panel' : `.ef-drawer[data-panel-id="${id}"]`;
          const el = document.querySelector(sel) as HTMLElement | null;
          if(el){ const l=parseFloat(el.style.left||'0'); if(lefts.some(v=> Math.abs(v-l)<2)) overlap=true; lefts.push(l); }
        });
        if(overlap){ requestAnimationFrame(compactAll); }
      });
    };
    // Two-frame defer to let new panel DOM mount & width settle
    requestAnimationFrame(()=> requestAnimationFrame(run));
  }, [openPanels, openPanelOrder, isPlanetCountActive, uiScale]);

  // Specific nudge: if user-overlay is the ONLY managed panel opened first, re-run cascade after content paint to ensure same offset adjustments.
  useEffect(()=>{
    const managedIds = ['routing','cinematic','planet-legend','region-stats','region-compare','user-overlay'];
    const activeManaged = Array.from(openPanels).filter(id=> managedIds.includes(id) || (id==='planet-legend' && isPlanetCountActive));
    if(activeManaged.length===1 && activeManaged[0]==='user-overlay'){
      // skip if user has a stored position already
      if(localStorage.getItem('panel-pos:drawer-user-overlay')) return;
      // Trigger a tiny deferred alignment (will be no-op if already aligned)
      requestAnimationFrame(()=>{
        try {
          if(userOverlayDrawerRef.current){
            userOverlayDrawerRef.current.autoPosition({ x:140, y:70 });
          }
        } catch {/* ignore */}
      });
    }
  }, [openPanels, isPlanetCountActive]);
  // Optional debug toggle (open console and set window.DEBUG_PREFS=true)
  ;(window as any).DEBUG_PREFS = (window as any).DEBUG_PREFS || false;

  // Reinforce jump persistence after route completion (extra safety)
  useEffect(()=>{
    if(routeResult && lastP2PParamsRef.current.jump !== persistedJump){
      setRoutingPrefs(lastP2PParamsRef.current.jump, lastP2PParamsRef.current.optimize, lastP2PParamsRef.current.algo);
      setPersistedJump(lastP2PParamsRef.current.jump);
    }
  },[routeResult]);

  // Routing persisted param state for initial props
  const [persistedJump, setPersistedJump] = useState<number>(initialPrefsRef.current.lastJumpDistance ?? lastP2PParamsRef.current.jump);
  const [persistedOptimize, setPersistedOptimize] = useState<'fuel'|'jumps'>(initialPrefsRef.current.optimizeFor ?? lastP2PParamsRef.current.optimize);
  const [persistedAlgo, setPersistedAlgo] = useState<'astar'|'dijkstra'>(initialPrefsRef.current.algorithm ?? lastP2PParamsRef.current.algo);
  // Scout ship range persists inside ScoutOptimizer component; no App-level state needed

  // Apply shared route from URL hash (supports short form #s=ID) once map data is loaded
  useEffect(()=>{
    if(!isLoaded || !mapData) return;
    if(initialHashAppliedRef.current) return;
    initialHashAppliedRef.current = true;
    const hash = window.location.hash;
    if(!hash) return;
    const systemsByLower = new Map<string, SolarSystem>(Object.values(mapData.solar_systems).map(s=> [s.name.toLowerCase(), s]));
    const apply = (share:any)=>{
      if(!share) return;
      const allExist = share.path.every((p:string)=> systemsByLower.has(p.toLowerCase()));
      if(!allExist || share.path.length < 2) return;
      if(share.type==='p'){
        lastP2PParamsRef.current = { jump: share.jump, optimize: share.optimize, algo: share.algo, from: share.from, to: share.to };
  setRouteResult({ path: share.path });
  // (legacy setActivePanel call removed)
  ensurePanel('routing');
      } else if(share.type==='s') {
  setReturnToStart(share.returnToStart);
  setReturnToStart(share.returnToStart);
  setScoutRouteResult({ path: share.path });
  ensurePanel('routing');
          if(lastSelectedSystemName){ ensurePanel('routing'); }
          if(lastSelectedSystemName){ ensurePanel('routing'); }
          if(lastSelectedSystemName){ ensurePanel('routing'); }
      }
      const startSys = systemsByLower.get(share.path[0].toLowerCase()); if(startSys) selectSystem(startSys);
    };
    if(hash.startsWith('#s=')){
      const id = hash.slice(3);
      if(id){
        fetchShortShare(id).then(full=>{
          if(!full) return;
          const share = decodeShare('#'+full);
          apply(share);
        }).catch(()=>{/* ignore */});
      }
    } else {
  apply(decodeShare(hash));
  try { track({ type:'share_resolved' }); } catch {}
    }
  }, [isLoaded, mapData, selectSystem]);

  // Stop / cancel the current calculation: terminate worker and recreate a fresh one
  const stopCalculation = useCallback(() => {
    // Signal multi-segment cancellation if active
    try {
      const ref = (calculateRoute as any)._cancelRef;
      if (ref) ref.value = true;
    } catch { /* ignore */ }
    // If a calculation was actively running (routeCalcStartRef set and isCalculatingRoute true), record cancellation metric
    try {
      if(routeCalcStartRef.current !== null || isCalculatingRoute){
        (window as any).__efTrackP2PCancelled && (window as any).__efTrackP2PCancelled();
      }
    } catch { /* ignore */ }
    if (routingWorkerRef.current) {
      try {
        routingWorkerRef.current.terminate();
      } catch (e) {
        // ignore
      }
      routingWorkerRef.current = null;
    }
    setIsCalculatingRoute(false);
    setRouteProgress(p => p ? { ...p, message: 'Cancelled' } : null);
    routeCalcStartRef.current = null;
    setRouteCalcTimeMs(null);

    // Recreate worker so the UI can run new calculations later
    const worker = new Worker(new URL('./utils/routing_worker.ts', import.meta.url), { type: 'module' });
    routingWorkerRef.current = worker;
    // wire the same handler as above
    worker.onmessage = (e) => {
      const data = e.data;
      if (data && data.type === 'progress') {
        setRouteProgress({ explored: data.explored ?? 0, frontier: data.frontier ?? 0, elapsedMs: data.elapsedMs ?? 0, message: data.message ?? '' });
        return;
      }
  const { path, error, minRequiredShipRange } = data;
      setIsCalculatingRoute(false);
      if (routeCalcStartRef.current) {
        const elapsed = Date.now() - routeCalcStartRef.current;
        setRouteCalcTimeMs(elapsed);
        routeCalcStartRef.current = null;
      }
      setRouteProgress(null);
      if (error) {
        if(minRequiredShipRange !== undefined){
          alert(`Routing Error: ${error}${minRequiredShipRange?`\nMinimum ship range required: ${minRequiredShipRange.toFixed(2)} LY`:''}`);
        } else {
          alert(`Routing Error: ${error}`);
        }
        setRouteResult({ path: null, error, minRequiredShipRange });
        return;
      }
        setRouteResult({ path, error: undefined });
        try {
          const hops = path ? Math.max(0, path.length-1) : 0;
          const algoUsed = (lastP2PParamsRef.current?.algo) || 'astar';
          const optMode = (lastP2PParamsRef.current?.optimize) || 'fuel';
          (window as any).__efTrackP2PRouteMeta && (window as any).__efTrackP2PRouteMeta(algoUsed, optMode, hops, waypoints.length);
          (window as any).__efMarkFirstAction && (window as any).__efMarkFirstAction('p2p');
        } catch {}
  if(window.location.hash){ try { history.replaceState(null,'', window.location.pathname + window.location.search); } catch { /* ignore */ } }

      if (path && path.length > 0 && mapData) {
        const systemsByName = Object.fromEntries(Object.values(mapData.solar_systems).map(s => [s.name.toLowerCase(), s]));
        const startSystem = systemsByName[path[0].toLowerCase()];
        if (startSystem) {
          selectSystem(startSystem);
        }
      }
    };
  }, [mapData, selectSystem]);

  const calculateRoute = useCallback((fromSystemName: string, toSystemName: string, maxJumpDistance: number, optimizeFor: 'fuel' | 'jumps', algorithm: 'astar' | 'dijkstra') => {
  try { (window as any).__efMarkFirstRouteStarted && (window as any).__efMarkFirstRouteStarted(); } catch {}
    try { (lastP2PParamsRef as any).current = { jump:maxJumpDistance, optimize:optimizeFor, algo:algorithm, from:fromSystemName, to:toSystemName }; } catch(e) { /* ignore */ }
    if (!mapData) { alert('Map data is not loaded yet.'); return; }
    if(!fromSystemName || !toSystemName){ alert('Both From and To are required.'); return; }

    // Sync destination into shared state so subsequent waypoint additions don't incorrectly promote
    // the newly added waypoint to destination (observed bug when user manually typed destination
    // then added a waypoint: lastDestinationSystemName stayed empty, causing auto-promotion logic).
    // Only set if different to avoid unnecessary re-renders; do NOT lock so user can still override
    // via context menu 'Set Destination'.
    if(toSystemName && toSystemName !== lastDestinationSystemName){
      setLastDestinationSystemName(toSystemName);
    }

    if (scoutRouteResult) { setScoutRouteResult(null); setScoutInvalidateToken(t=> t+1); }
    clearCurrentRoute();

    // Build ordered segments respecting waypointOptimize (currently just order-added; optimization TBD)
    let orderedWaypoints = waypoints;
    if(waypointOptimize && waypoints.length > 1){
      // Placeholder: naive nearest-neighbor starting from From (could be improved later)
      const systemsByLower = new Map(Object.values(mapData.solar_systems).map(s=> [s.name.toLowerCase(), s]));
      const startSys = systemsByLower.get(fromSystemName.toLowerCase());
      if(startSys){
        const remaining = waypoints.slice();
        const ordered: string[] = [];
        let current = startSys;
        while(remaining.length){
          let bestIdx = 0; let bestDist = Infinity;
          for(let i=0;i<remaining.length;i++){
            const cand = systemsByLower.get(remaining[i].toLowerCase());
            if(!cand) continue;
            const d = Math.hypot(cand.position.x-current.position.x, cand.position.y-current.position.y, cand.position.z-current.position.z);
            if(d < bestDist){ bestDist = d; bestIdx = i; }
          }
            ordered.push(remaining[bestIdx]);
            const chosen = systemsByLower.get(remaining[bestIdx].toLowerCase());
            if(chosen) current = chosen;
            remaining.splice(bestIdx,1);
        }
        orderedWaypoints = ordered;
      }
    }
    const segments: Array<[string,string]> = [];
    const chain = [fromSystemName, ...orderedWaypoints.filter(w=> w && w!==fromSystemName && w!==toSystemName), toSystemName];
    for(let i=0;i<chain.length-1;i++){ segments.push([chain[i], chain[i+1]]); }
    if(segments.length === 0){ alert('Nothing to route.'); return; }

    setIsCalculatingRoute(true); setRouteResult(null); setRouteCalcTimeMs(null); routeCalcStartRef.current = Date.now();
  const cancelRef = { value:false }; (calculateRoute as any)._cancelRef = cancelRef;
    const fullPath: string[] = []; let segIndex = 0;
    const runNext = () => {
      if(cancelRef.value){ setIsCalculatingRoute(false); setRouteProgress(null); return; }
      if(segIndex >= segments.length){
        setIsCalculatingRoute(false);
        setRouteProgress(null);
        setRouteResult({ path: fullPath });
        try {
          const elapsed = routeCalcStartRef.current ? Date.now() - routeCalcStartRef.current : undefined;
          track({ type:'p2p_route' });
          if(elapsed!==undefined) track({ type:'p2p_route_time', ms: elapsed });
          // Feature flags snapshot (matches server dynamic keys logic)
          track({ type:'feature_flags', waypoints: waypoints.length>0, avoid: avoidSystems.length>0, waypointOpt: waypointOptimize, returnToStart, gateReachable: false });
          // Ensure algo/mode + hops + waypoint buckets recorded (segmented path fallback)
          try {
            const hops = fullPath ? Math.max(0, fullPath.length-1) : 0;
            const algoUsed = (lastP2PParamsRef.current?.algo) || 'astar';
            const optMode = (lastP2PParamsRef.current?.optimize) || 'fuel';
            (window as any).__efTrackP2PRouteMeta && (window as any).__efTrackP2PRouteMeta(algoUsed, optMode, hops, waypoints.length);
            (window as any).__efMarkFirstAction && (window as any).__efMarkFirstAction('p2p');
          } catch {}
        } catch {}
        if(fullPath.length && mapData){
          const sysMap = Object.fromEntries(Object.values(mapData.solar_systems).map(s=> [s.name.toLowerCase(), s]));
          const startSystem = sysMap[fullPath[0].toLowerCase()]; if(startSystem) selectSystem(startSystem);
        }
        return;
      }
      const [segFrom, segTo] = segments[segIndex];
      setRouteProgress({ explored:0, frontier:0, elapsedMs:0, message:`Segment ${segIndex+1}/${segments.length}: ${segFrom} → ${segTo}` });
      // Fresh worker per segment for simplicity (reuse existing ref)
      try { routingWorkerRef.current?.terminate(); } catch { /* ignore */ }
      routingWorkerRef.current = new Worker(new URL('./utils/routing_worker.ts', import.meta.url), { type:'module' });
      routingWorkerRef.current.onmessage = (e) => {
        const data = e.data;
        if(data && data.type==='progress') { setRouteProgress(p=> ({ ...(p||{}), ...data })); return; }
  const { path, error, minRequiredShipRange } = data;
        if(error || !path){
          setIsCalculatingRoute(false); setRouteProgress(null); setRouteResult({ path:null, error: error || `No path for segment ${segFrom} → ${segTo}` , minRequiredShipRange }); return;
        }
        if(fullPath.length){ // avoid duplicating junction node
          fullPath.push(...path.slice(1));
        } else {
          fullPath.push(...path);
        }
  segIndex++; runNext();
      };
      routingWorkerRef.current.postMessage({
        systems: mapData.solar_systems,
        stargates: mapData.stargates,
        fromSystemName: segFrom,
        toSystemName: segTo,
        maxJumpDistance,
        optimizeFor,
        algorithm,
        avoidSystemNames: avoidSystems.filter(a=> a!==segFrom && a!==segTo && !orderedWaypoints.includes(a)),
      });
    };
  runNext();
  }, [mapData, scoutRouteResult, clearCurrentRoute, waypoints, avoidSystems, waypointOptimize, selectSystem]);

  // Helper to get planet count color
  const getPlanetCountColor = useCallback((planets: number, minPlanets: number, maxPlanets: number): THREE.Color => {
    if (maxPlanets === minPlanets) {
      // If all planet counts are the same (e.g., all 0), or initial state
      // return DEFAULT_STAR_COLOR instead of a specific HSL color.
      return DEFAULT_STAR_COLOR;
    }
    const normalized = (planets - minPlanets) / (maxPlanets - minPlanets);
    return new THREE.Color().setHSL(normalized * 0.33, 1.0, 0.5); // Red to Green
  }, []);

  const generatePlanetCountLegend = useCallback(() => {
    if (!isPlanetCountActive || maxPlanets === 0) return null; // Don't show if DPC is off or no planets

    const legendItems = [];
    const numSteps = 5; // Number of steps in the legend
    const stepSize = (maxPlanets - minPlanets) / numSteps;

    for (let i = 0; i < numSteps; i++) {
      const lowerBound = Math.round(minPlanets + i * stepSize);
      const upperRaw = minPlanets + (i + 1) * stepSize;
      const upperBound = Math.round(upperRaw);
      const midPoint = Math.round((lowerBound + upperBound) / 2);
      const color = getPlanetCountColor(midPoint, minPlanets, maxPlanets);
      const checked = planetBinsActive[i];

      legendItems.push(
        <label key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', cursor: 'pointer', gap: '8px' }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              setPlanetBinsActive(prev => {
                const next = [...prev];
                next[i] = e.target.checked;
                return next;
              });
            }}
            style={{ margin: 0 }}
          />
          <div style={{ width: '18px', height: '18px', backgroundColor: `#${color.getHexString()}`, borderRadius: '3px', border: checked ? 'none' : '1px solid #777', opacity: checked ? 1 : 0.25 }} />
          <span style={{ fontSize: '12px' }}>{`${lowerBound} - ${upperBound} planets`}</span>
        </label>
      );
    }
    return (
      <div style={{ marginTop: '10px', padding: '10px', border: '1px solid #ccc', borderRadius: '5px', background: 'rgba(0,0,0,0.35)' }}>
        <strong style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>Planet Count Legend:</strong>
        {legendItems}
        <div style={{ fontSize: '11px', opacity: 0.75, marginTop: '4px' }}>Uncheck ranges to de-emphasize them (stars revert to white).</div>
      </div>
    );
  }, [isPlanetCountActive, minPlanets, maxPlanets, getPlanetCountColor, planetBinsActive]);

  // Reset bins to all active when enabling Display Planet Counts
  useEffect(() => {
    if (isPlanetCountActive) {
      setPlanetBinsActive([true, true, true, true, true]);
    }
  }, [isPlanetCountActive]);

  // Fetch and process data from SQLite
  useEffect(() => {
    const loadDatabase = async () => {
      try {
        setLoadingStatus('Downloading map data...');
        // Attempt new v2 DB (stations); fallback to legacy name if not found
        let response = await fetch('/map_data_v2.db').catch(()=> null as any);
        if(!response || !response.ok){
          try { response = await fetch('/map_data.db'); } catch {/* ignore */}
        }
        if (!response.body) {
          throw new Error("Failed to get readable stream from response");
        }
        const contentLength = response.headers.get('content-length');
        const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
        let loadedSize = 0;

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          chunks.push(value);
          loadedSize += value.length;
          if (totalSize > 0) {
            const progress = (loadedSize / totalSize) * 100;
            setLoadingProgress(progress);
          }
        }

        const dbBytes = new Uint8Array(loadedSize);
        let offset = 0;
        for (const chunk of chunks) {
          dbBytes.set(chunk, offset);
          offset += chunk.length;
        }
        
        setLoadingStatus('Initializing database...');
        setLoadingProgress(100); // Show 100% for download
        
        const db = await openDbFromArrayBuffer(dbBytes.buffer);

        setLoadingStatus('Processing systems...');
        // Query the database
  const systemsRes = db.exec("SELECT * FROM systems WHERE hidden = 0");
  const stargatesRes = db.exec("SELECT * FROM stargates");
        const regionsRes = db.exec("SELECT * FROM regions");
        // Stations (optional table)
        let stationSet: Set<number> = new Set();
        let stationCountMap: Record<number, number> = {};
        try {
          const stationsRes = db.exec("SELECT system_id, station_count FROM stations");
          if(stationsRes.length>0){
            stationsRes[0].values.forEach((row:any[])=>{
              // row[0] may be stored as text; coerce to number safely
              const sidRaw = row[0];
              const sid = typeof sidRaw === 'number' ? sidRaw : Number(String(sidRaw).trim());
              const cnt = Number(row[1]);
              if(!Number.isNaN(sid) && !Number.isNaN(cnt)){
                stationSet.add(sid);
                stationCountMap[sid] = cnt;
              }
            });
          }
        } catch {/* table absent in legacy DB */}
        const constellationsRes = db.exec("SELECT * FROM constellations");

        const solar_systems: { [key: string]: SolarSystem } = {};
    if (systemsRes.length > 0) {
      systemsRes[0].values.forEach((row: SqlValue[]) => {
        const sysIdRaw = row[0];
        const sysId = typeof sysIdRaw === 'number' ? sysIdRaw : Number(String(sysIdRaw));
        const system: SystemRow = {
          id: sysId as number,
          name: row[1] as string,
          constellation_id: Number(row[2] as any),
          region_id: Number(row[3] as any),
                    x: row[7] as number,
                    y: row[8] as number,
                    z: row[9] as number,
                    hidden: !!row[13],
                    planet_count: row[14] as number
                };
                solar_systems[system.id] = {
          id: Number(system.id),
                    name: system.name,
                    position: { x: system.x, y: system.y, z: system.z },
          region_id: Number(system.region_id),
          constellation_id: Number(system.constellation_id),
                    planets: system.planet_count,
                    hidden: system.hidden
                };
            });
        }

        setLoadingStatus('Processing stargates...');
        const stargates: { [key: string]: Stargate } = {};
    if (stargatesRes.length > 0) {
      stargatesRes[0].values.forEach((row: SqlValue[]) => {
        const sgIdRaw = row[0];
        const sgId = typeof sgIdRaw === 'number' ? sgIdRaw : Number(String(sgIdRaw));
        const srcRaw = row[2];
        const dstRaw = row[3];
        const stargate: StargateRow = {
          id: sgId as number,
          name: row[1] as string,
          source_system_id: typeof srcRaw === 'number'? srcRaw : Number(String(srcRaw)),
          destination_system_id: typeof dstRaw === 'number'? dstRaw : Number(String(dstRaw))
        };
                stargates[stargate.id] = {
          id: Number(stargate.id),
                    name: stargate.name,
          source_system_id: Number(stargate.source_system_id),
          destination_system_id: Number(stargate.destination_system_id)
                };
            });
        }
        
        setLoadingStatus('Processing regions...');
        const regions: { [key: string]: RegionRow } = {};
        if (regionsRes.length > 0) {
            regionsRes[0].values.forEach((row: SqlValue[]) => {
                const region: RegionRow = {
                    id: row[0] as number,
                    name: row[1] as string
                };
                regions[region.id] = {
                    id: region.id,
                    name: region.name,
                    // ... other region properties
                };
            });
        }

        setLoadingStatus('Processing constellations...');
        const constellations: { [key: string]: ConstellationRow } = {};
        if (constellationsRes.length > 0) {
            constellationsRes[0].values.forEach((row: SqlValue[]) => {
                const constellation: ConstellationRow = {
                    id: row[0] as number,
                    name: row[1] as string
                };
                constellations[constellation.id] = {
                    id: constellation.id,
                    name: constellation.name,
                    // ... other constellation properties
                };
            });
        }

        setLoadingStatus('Finalizing...');
  // NOTE: stationSet / stationCountMap stored on window temporarily until toggle feature implemented
  // Expose stations globally AND cache in ref immediately so region stats can use without requiring overlay toggle
  try {
    (window as any).__efStations = { ids: stationSet, counts: stationCountMap };
    // Ensure internal ref populated early (previously only set when overlay mounted -> caused false negatives in region stats)
    stationSystemIdSetRef.current = stationSet;
    if(stationSet.size && (window as any).console){
      console.debug('[Stations] Loaded', stationSet.size, 'systems with stations. Example ID:', stationSet.values().next().value);
    }
  } catch {/* ignore */}
  setMapData({ solar_systems, stargates, regions, constellations });

        // Calculate min/max planets once data is loaded
        const planetCounts = Object.values(solar_systems).map(s => s.planets);
        const initialMinPlanets = planetCounts.length > 0 ? Math.min(...planetCounts) : 0;
        const initialMaxPlanets = planetCounts.length > 0 ? Math.max(...planetCounts) : 0;
        setMinPlanets(initialMinPlanets);
        setMaxPlanets(initialMaxPlanets);
        
  setIsLoaded(true);
  try { (window as any).__efMarkDbLoaded && (window as any).__efMarkDbLoaded(); } catch {}

      } catch (error) {
        console.error('Error loading map data:', error);
        setLoadingStatus('Error loading map data. Please check the console.');
      }
    };

    loadDatabase();
  }, []);

  // Initialize Scene
  useEffect(() => {
    if (!isLoaded) return; // Don't initialize scene until loaded
    const currentMount = mountRef.current;
    if (!currentMount) return;

  sceneRef.current = new THREE.Scene(); // Flat black background (fog removed)
    cameraRef.current = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000000);
  rendererRef.current = new THREE.WebGLRenderer({ antialias: true });
  // Cap DPR for performance while keeping crisp rendering
  try { rendererRef.current.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); } catch {}
  rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    currentMount.appendChild(rendererRef.current.domElement);

    // New: CSS2DRenderer setup
  const labelRenderer = new CSS2DRenderer();
  labelRendererRef.current = labelRenderer;
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none'; // Crucial for not blocking mouse events
    currentMount.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(cameraRef.current, rendererRef.current.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 10; // Add this line
    controlsRef.current = controls;
    
    cameraRef.current.position.z = 5000;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    sceneRef.current.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 1, 0);
    sceneRef.current.add(directionalLight);
  // Background sky & parallax removed: flat black

    // Hover Point
    const hoverGeometry = new THREE.BufferGeometry();
    hoverGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const hoverMaterial = new THREE.PointsMaterial({
      size: 20, // Default/min size
      sizeAttenuation: false, // Use screen-space sizing
      map: ringTexture,
      color: accentIsBlue ? 0x00aaff : 0xff4c26,
      transparent: true,
      alphaTest: 0.5,
    });
  hoverPointRef.current = new THREE.Points(hoverGeometry, hoverMaterial);
      hoverPointRef.current.visible = false;
        sceneRef.current.add(hoverPointRef.current);

  // (Legacy prompt-based overlay add removed; custom context menu + modal now handles Add Mark.)

        // User Overlay Rings (halos) - instantiate once & retain via ref so mapData can be injected later
        try {
          if(OVERLAY_FEATURE_FLAG && ringTexture && !overlayRingsRef.current) {
            // Size chosen to sit just outside capped star size (~10px). Adjust if visual gap too large.
            overlayRingsRef.current = new UserOverlayRings(sceneRef.current, ringTexture, 15);
            // Start hidden by default; immediately show if panel already open & not cinematic
            try {
              const shouldStartVisible = openPanels.has('user-overlay') && !cinematicMode;
              overlayRingsRef.current.setVisible(shouldStartVisible);
            } catch {/* ignore */}
            (window as any).__efOverlayRebuild = () => { try { overlayRingsRef.current && (overlayRingsRef.current as any).rebuild && (overlayRingsRef.current as any).rebuild(); } catch {} };
            if(mapData) { try { overlayRingsRef.current.setMapData(mapData); } catch {} }
          }
        } catch(e){ console.warn('[overlay] rings init failed', e); }

  let running = true; let rafId = 0;
  // Removed pulseState (selection halo pulsing disabled)
    const animate = () => {
      if(!running) return;
      rafId = requestAnimationFrame(animate);
       const anim = animationRef.current;
       if (anim.isAnimating) {
         const now = Date.now();
         const progress = Math.min((now - anim.startTime) / anim.duration, 1);
         cameraRef.current?.position.lerpVectors(anim.startPos, anim.endPos, progress);
         controlsRef.current?.target.lerpVectors(anim.startTarget, anim.endTarget, progress);
         if (progress >= 1) {
           anim.isAnimating = false;
         }
       }
       // Run route animation updaters
       try {
         const updaters = routeAnimUpdatersRef.current;
         for (let i = 0; i < updaters.length; i++) updaters[i]();
       } catch (e) { /* ignore */ }
  // (Selection halo pulse removed – only hover ring retained)
       // Baseline micro‑twinkle and parallax rotation (non-cinematic)
  if(!cinematicModeRef.current){
         const tNow = performance.now()/1000;
         // Star field now static: guard in case legacy uniform lingers
         if(starFieldRef.current){ const mat:any = starFieldRef.current.material; const sh = mat.userData?.shader; if(sh && sh.uniforms.uTime){ sh.uniforms.uTime.value = tNow; } }
         if(stargateLinesRef.current && cameraRef.current){ const m:any = stargateLinesRef.current.material; if(m.uniforms?.uCamPos){ m.uniforms.uCamPos.value.copy(cameraRef.current.position); } }
          // Removed glow material camera uniform update (glow pass removed)
          // Removed dynamic distance-based brightness adaptation; static brightness now
          try {
            const geo:THREE.BufferGeometry|undefined = stargateLinesRef.current?.geometry;
            if(geo && cameraRef.current){
              const midAttr:any = geo.getAttribute('mid');
              if(midAttr){ // no-op sampling retained only to avoid future rework; can be removed entirely later
                const cam = cameraRef.current.position;
                let maxD = 0; const count = midAttr.count; // each vertex duplicated; sampling stride
                const stride = Math.max(1, Math.floor(count/500));
                for(let i=0;i<count;i+=stride){
                  const x = midAttr.getX(i), y = midAttr.getY(i), z = midAttr.getZ(i);
                  const dx = x-cam.x, dy=y-cam.y, dz=z-cam.z; const d = Math.sqrt(dx*dx+dy*dy+dz*dz);
                  if(d>maxD) maxD = d;
                }
                // Distance sampled but not used (static brightness)
              }
            }
          } catch {}
        // Allow enabling debug gradient in console: window.__efGateDebug = true
  try { if((window as any).__efGateDebug !== undefined && stargateLinesRef.current){ const m:any = stargateLinesRef.current.material; if(m.uniforms?.uDebug){ m.uniforms.uDebug.value = (window as any).__efGateDebug ? 1.0 : 0.0; } } } catch {}
       }
  // Update user overlay color cycling
  try { if(overlayRingsRef.current){ overlayRingsRef.current.update(performance.now()); } } catch {/* ignore */}
  // Jump range bubble: animate iridescence & interpolate position if active
       if(rangeBubbleRef.current){
         try {
           // Position interpolation (bubbleAnimRef managed on selection)
           if(bubbleAnimRef.current.active){
             const tNow = performance.now();
             const t = (tNow - bubbleAnimRef.current.startTime) / bubbleAnimRef.current.duration;
             if(t >= 1){
               rangeBubbleRef.current!.group.position.copy(bubbleAnimRef.current.end);
               bubbleAnimRef.current.active = false;
             } else {
               const tt = t*t*(3-2*t); // smoothstep ease
               rangeBubbleRef.current!.group.position.lerpVectors(bubbleAnimRef.current.start, bubbleAnimRef.current.end, tt);
             }
           }
           const tNowMs = performance.now();
           rangeBubbleRef.current!.tick(tNowMs);
           if((window as any).__efBubbleDebug){
             const child = rangeBubbleRef.current!.group.children?.[1];
             const mat:any = (child && (child as any).material) ? (child as any).material : undefined;
             if(mat && mat.uniforms && mat.uniforms.uTime){
               if(!(window as any).__efBubbleLastLog || tNowMs - (window as any).__efBubbleLastLog > 1000){
                 (window as any).__efBubbleLastLog = tNowMs;
                 console.log('[bubble]', 'uTime', mat.uniforms.uTime.value, 'rotationY', rangeBubbleRef.current!.group.rotation.y.toFixed(2));
               }
             }
           }
         } catch {/* ignore */}
       }
  controls.update();
  if (cinematicModeRef.current || cinematicMode) {
         if (cinematicStarMaterialRef.current && (cinematicStarMaterialRef.current as any).userData?.shader) {
           const sh = (cinematicStarMaterialRef.current as any).userData.shader;
           sh.uniforms.uTime.value = performance.now()/1000;
           if(sh.uniforms.uColorStrength) sh.uniforms.uColorStrength.value = starColorStrength;
           if(sh.uniforms.uHueShift) sh.uniforms.uHueShift.value = (hueDriftEnabled? (performance.now()/1000)*0.04 : 0);
         }
         // Bloom pulse
         if(bloomPassRef.current){ const base = bloomStrengthRef.current; bloomPassRef.current.strength = base * (1 + (bloomPulseEnabled? bloomPulseAmp:0)*Math.sin(performance.now()/1000*0.35)); }
         // Camera idle drift
         if(cameraDriftEnabled && !autoCamPausedRef.current && !(clusterAnimRef.current)){ const idleTime = (Date.now() - lastInteractionRef.current)/1000; if(idleTime > 6 && cameraRef.current){ const t = performance.now()/1000; cameraRef.current.position.x += Math.sin(t*0.07)*0.3; cameraRef.current.position.y += Math.cos(t*0.05)*0.25; cameraRef.current.position.z += Math.sin(t*0.04)*0.15; } }
         // Rotate dust layers
         if (dustPointsRef.current) dustPointsRef.current.rotation.y += 0.0004;
         if (secondDustEnabled && secondDustRef.current) secondDustRef.current.rotation.y -= 0.00025;
         // Update dust twinkle shader time
         const tSec = performance.now()/1000;
         if(dustPointsRef.current){ const mat:any = dustPointsRef.current.material; if(mat.userData?.shader){ mat.userData.shader.uniforms.uTime.value = tSec; } }
         if(secondDustRef.current){ const mat:any = secondDustRef.current.material; if(mat.userData?.shader){ mat.userData.shader.uniforms.uTime.value = tSec; } }
         const nowPerf = performance.now();
         lastFrameTimeRef.current = nowPerf;
         // Autonomous cluster tour logic (no user selection required)
         if(autoClusterTourRef.current && cinematicModeRef.current && mapData){
           const nowMs = Date.now();
           // Schedule next cluster centroid if none active or finished
           if(!clusterAnimRef.current && nowMs > nextClusterAtRef.current){
             // Pick a random star system
             const systems = visibleSystemsRef.current.length? visibleSystemsRef.current : Object.values(mapData.solar_systems);
             if(systems.length && cameraRef.current && controlsRef.current){
               const star = systems[Math.floor(Math.random()*systems.length)];
               const starPos = new THREE.Vector3(star.position.x, star.position.y, star.position.z);
               clusterTargetRef.current = starPos;
               const camStart = cameraRef.current.position.clone();
               const approachDir = camStart.clone().sub(starPos).normalize();
               if(approachDir.lengthSq() < 1e-6) approachDir.set(1,0,0);
               clusterApproachDirRef.current = approachDir.clone();
               const dist = camStart.distanceTo(starPos);
               const desiredDist = Math.min(Math.max(dist*0.6, 2000), 14000);
               const camEnd = starPos.clone().add(approachDir.multiplyScalar(desiredDist));
               clusterAnimRef.current = { phase:'travelStar', start: nowMs, travelDur: 8000, panDur: 5000, starPos, camStart, camEnd, orientDone:false };
             }
           }
           if(clusterAnimRef.current && clusterTargetRef.current && cameraRef.current && controlsRef.current){
             const anim = clusterAnimRef.current;
             if(anim.phase==='travelStar'){
               // Continuous blended turn + forward motion. We begin moving immediately but scale forward progress
               // by how aligned we are, so early motion is very slight and grows smoothly.
               const desiredTarget = anim.starPos.clone();
               const toDesired = desiredTarget.clone().sub(cameraRef.current.position);
               const currentTarget = controlsRef.current.target.clone();
               const toCurrent = currentTarget.clone().sub(cameraRef.current.position);
               let angle = toCurrent.angleTo(toDesired); // radians (0 = aligned)
               if(anim.initialAngle===undefined) anim.initialAngle = angle || 1e-6;
               // Dynamic max turn: faster when large angle, slower when nearly aligned
               const baseDeg = 0.3; // baseline deg per frame
               const accelFactor = THREE.MathUtils.clamp(angle / Math.PI, 0, 1); // 1 when 180°, 0 when aligned
               const maxAngle = (baseDeg + 0.25*accelFactor) * (Math.PI/180); // up to ~0.55° early, slows to 0.3°
               if(angle > 1e-4){
                 const step = Math.min(angle, maxAngle);
                 const axis = new THREE.Vector3().crossVectors(toCurrent, toDesired).normalize();
                 if(axis.lengthSq()>0){
                   const q = new THREE.Quaternion().setFromAxisAngle(axis, step);
                   toCurrent.applyQuaternion(q);
                   controlsRef.current.target.copy(cameraRef.current.position.clone().add(toCurrent));
                   // Recompute residual angle after partial turn for smoother progress metrics
                   angle = toCurrent.angleTo(toDesired);
                 }
               }
               // Orientation progress (0..1)
               const orientProgress = THREE.MathUtils.clamp(1 - (angle / anim.initialAngle), 0, 1);
               // Time-based raw progress (continues even while turning) – we start counting from anim.start
               const elapsed = nowMs - anim.start;
               const rawTime = THREE.MathUtils.clamp(elapsed / anim.travelDur, 0, 1);
               // Blend factor: allow only a small fraction of forward motion until orientationProgress grows.
               // Use orientProgress^2 for smoother early suppression.
               const orientFactor = orientProgress * orientProgress; // (quadratic)
               // Velocity shaping: quintic smoothstep for time, then multiply by orientation factor
               const timeEase = rawTime*rawTime*rawTime*(rawTime*(6*rawTime - 15) + 10);
               const blended = timeEase * orientFactor;
               // Apply a soft floor once within 90° cone so motion doesn't feel stalled.
               // 90° cone check:
               const withinCone = angle <= Math.PI/2;
               const coneBoost = withinCone ? 0.08 : 0; // small nudge so travel visibly begins
               let travelT = THREE.MathUtils.clamp(blended + coneBoost* (1 - orientFactor), 0, 1);
               // Prevent overshoot due to boost
               if(travelT > 1) travelT = 1;
               cameraRef.current.position.lerpVectors(anim.camStart, anim.camEnd, travelT);
               // Transition when complete
               if(travelT>=1){
                 // Setup pan to center (origin)
                 anim.phase = 'panCenter';
                 anim.panStart = nowMs;
                 anim.starTargetStart = anim.starPos.clone();
                 anim.camPanStart = cameraRef.current.position.clone();
                 const center = new THREE.Vector3(0,0,0);
                 const shift = center.clone().sub(anim.starPos).multiplyScalar(0.3); // keep existing pan distance
                 anim.camPanEnd = cameraRef.current.position.clone().add(shift);
               }
             } else if(anim.phase==='panCenter'){
               const panElapsed = nowMs - (anim.panStart||nowMs);
               const t = Math.min(1, panElapsed / anim.panDur);
               // Slow the pan/align motion further by easing with higher-order smoothing
               const et = t*t*t*(t*(6*t - 15) + 10); // quintic smoothstep for even gentler start/stop
               const center = new THREE.Vector3(0,0,0);
               if(anim.starTargetStart) controlsRef.current.target.lerpVectors(anim.starTargetStart, center, et);
               if(anim.camPanStart && anim.camPanEnd) cameraRef.current.position.lerpVectors(anim.camPanStart, anim.camPanEnd, et);
               if(t>=1){
                 clusterAnimRef.current = null;
                 nextClusterAtRef.current = Date.now() + 20000 + Math.random()*20000; // schedule next
               }
             }
           }
         } else if(!autoClusterTourRef.current){
           clusterAnimRef.current = null; // reset if disabled
         }
         // Meteors (shooting stars)
         const now = performance.now();
         if(shootingStarsEnabled && meteorsGroupRef.current){
           // spawn every 12-25 s random
           if(now - lastMeteorSpawnRef.current > 12000 + Math.random()*13000){
             lastMeteorSpawnRef.current = now;
             const geo = new THREE.BufferGeometry();
             const start = new THREE.Vector3((Math.random()-0.5)*20000, (Math.random()-0.5)*20000, -8000 - Math.random()*4000);
             const dir = new THREE.Vector3(Math.random()*4000+4000, Math.random()*2000-1000, Math.random()*2000-1000).multiplyScalar(0.8*(Math.random()<0.5?-1:1));
             const end = start.clone().add(dir);
             geo.setAttribute('position', new THREE.Float32BufferAttribute([start.x,start.y,start.z,end.x,end.y,end.z],3));
             const mat = new THREE.LineBasicMaterial({ color:0x99aaff, transparent:true, opacity:1, blending:THREE.AdditiveBlending});
             const line = new THREE.Line(geo,mat);
             (line as any).birth = now;
             meteorsGroupRef.current.add(line);
           }
           const children = [...meteorsGroupRef.current.children];
            for(const m of children){ const age = now - (m as any).birth; if(age>1200){ // fade then remove
              meteorsGroupRef.current.remove(m); (m as any).geometry.dispose(); (m as any).material.dispose(); continue; }
              const op = 1 - age/1200; (m as any).material.opacity = op; const posAttr = (m as any).geometry.attributes.position; // simple streak elongation
              if(age<400){ const arr = posAttr.array as Float32Array; // extend end point
                arr[3] += 12; arr[4]+=2; arr[5]+=2; posAttr.needsUpdate=true; }
            }
         }
         // Ambient effects
         if(ambientEffectsEnabled){
           // tSec removed (unused)
           // Parallax stars subtle rotation & counter drift for depth illusion
           if(parallaxStarsRef.current){ parallaxStarsRef.current.rotation.y += 0.00005; }
           // Supernova spawn (sprite with radial gradient)
           if(supernovaGroupRef.current && now > nextSupernovaAtRef.current){
             nextSupernovaAtRef.current = now + 45000 + Math.random()*45000;
             const base = new THREE.Vector3((Math.random()-0.5)*15000, (Math.random()-0.5)*15000, (Math.random()-0.5)*15000);
             if(!supernovaTexRef.current) supernovaTexRef.current = createRadialGradientTexture(256,1,0.5);
             const mat = new THREE.SpriteMaterial({ map: supernovaTexRef.current, color:0xffffff, transparent:true, opacity:1, blending:THREE.AdditiveBlending, depthWrite:false });
             const spr = supernovaPoolRef.current.pop() as THREE.Sprite || new THREE.Sprite(mat);
             if(!(spr.material instanceof THREE.SpriteMaterial)){ (spr.material as any).dispose?.(); spr.material = mat; }
             spr.position.copy(base);
             spr.scale.set(120,120,120);
             (spr as any).birth = now; (spr as any).ttl = 4000;
             supernovaGroupRef.current.add(spr);
           }
           // Lens flare blink spawn (sprite)
           if(lensFlareGroupRef.current && now > nextLensBlinkAtRef.current){
             nextLensBlinkAtRef.current = now + 8000 + Math.random()*7000;
             if(!lensFlareTexRef.current) lensFlareTexRef.current = createRadialGradientTexture(192,1,0.35);
             const mat = new THREE.SpriteMaterial({ map:lensFlareTexRef.current, color:0x88bbff, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false });
             const spr = lensPoolRef.current.pop() as THREE.Sprite || new THREE.Sprite(mat);
             if(!(spr.material instanceof THREE.SpriteMaterial)){ (spr.material as any).dispose?.(); spr.material = mat; }
             spr.position.set((Math.random()-0.5)*25000, (Math.random()-0.5)*25000, (Math.random()-0.5)*25000);
             spr.scale.set(250,250,250);
             (spr as any).birth = now; (spr as any).ttl = 1400;
             lensFlareGroupRef.current.add(spr);
           }
           // Comet trail (longer, slower than meteor, reused logic)
           if(cometGroupRef.current && now > nextCometAtRef.current){
             nextCometAtRef.current = now + 60000 + Math.random()*60000;
             const start = new THREE.Vector3((Math.random()-0.5)*30000, (Math.random()-0.5)*30000, -12000 - Math.random()*6000);
             const dir = new THREE.Vector3(Math.random()*6000+6000, Math.random()*4000-2000, Math.random()*4000-2000).multiplyScalar((Math.random()<0.5?-1:1));
             const end = start.clone().add(dir);
             const geom = new THREE.BufferGeometry();
             geom.setAttribute('position', new THREE.Float32BufferAttribute([start.x,start.y,start.z,end.x,end.y,end.z],3));
             const mat = new THREE.LineBasicMaterial({ color:0xbbe1ff, transparent:true, opacity:1, blending:THREE.AdditiveBlending });
             const line = cometPoolRef.current.pop() || new THREE.Line(geom, mat);
             if(!(line.geometry instanceof THREE.BufferGeometry)){ (line.geometry as any).dispose?.(); line.geometry = geom; }
             if(!(line.material instanceof THREE.LineBasicMaterial)){ (line.material as any).dispose?.(); line.material = mat; }
             (line as any).birth = now; (line as any).ttl = 8000; (line as any).phase='fly';
             cometGroupRef.current.add(line);
           }
           // Gravitational ripple spawn
           if(rippleGroupRef.current && now > nextRippleAtRef.current){
             nextRippleAtRef.current = now + 30000 + Math.random()*40000;
             const geom = new THREE.RingGeometry(50,52, 64);
             const mat = new THREE.MeshBasicMaterial({ color:0x7da8ff, transparent:true, opacity:0.7, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthWrite:false });
             const ring = ripplePoolRef.current.pop() || new THREE.Mesh(geom, mat);
             ring.position.set((Math.random()-0.5)*20000, (Math.random()-0.5)*20000, (Math.random()-0.5)*20000);
             ring.rotation.x = Math.random()*Math.PI; ring.rotation.y = Math.random()*Math.PI;
             (ring as any).birth = now; (ring as any).ttl=5000; (ring as any).baseScale=1;
             rippleGroupRef.current.add(ring);
           }
           // Update & recycle supernovae
           if(supernovaGroupRef.current){
             const snChildren = [...supernovaGroupRef.current.children];
             for(const s of snChildren){ const ttl = (s as any).ttl; const age = now - (s as any).birth; if(age>ttl){ supernovaGroupRef.current.remove(s); supernovaPoolRef.current.push(s as any); continue; } const tAge = age/ttl; const base=120; const scl = base + tAge* base * 8.5; s.scale.set(scl,scl,scl); const mat:any = (s as any).material; mat.opacity = 1.0 - tAge; }
           }
           if(lensFlareGroupRef.current){
             const lfChildren = [...lensFlareGroupRef.current.children];
             for(const l of lfChildren){ const ttl = (l as any).ttl; const age = now - (l as any).birth; if(age>ttl){ lensFlareGroupRef.current.remove(l); lensPoolRef.current.push(l as any); continue; } const half=ttl/2; const mat:any = (l as any).material; if(age<half){ mat.opacity = age/half * 0.65; } else { mat.opacity = (1-(age-half)/half)*0.65; } }
           }
           // Update comets
           if(cometGroupRef.current){
             const cmChildren = [...cometGroupRef.current.children];
             for(const c of cmChildren){ const ttl = (c as any).ttl; const age = now - (c as any).birth; if(age>ttl){ cometGroupRef.current.remove(c); cometPoolRef.current.push(c as any); continue; }
               const op = 1 - age/ttl; (c as any).material.opacity = op; const posAttr = (c as any).geometry.attributes.position; if(age<2000){ const arr = posAttr.array as Float32Array; arr[3]+=8; arr[4]+=2; arr[5]+=2; posAttr.needsUpdate=true; } }
           }
           // Update ripples
           if(rippleGroupRef.current){
             const rpChildren = [...rippleGroupRef.current.children];
             for(const rMesh of rpChildren){ const ttl=(rMesh as any).ttl; const age = now - (rMesh as any).birth; if(age>ttl){ rippleGroupRef.current.remove(rMesh); ripplePoolRef.current.push(rMesh as any); continue; } const t = age/ttl; const scl = 1 + t*60; rMesh.scale.set(scl,scl,scl); const mat:any = (rMesh as any).material; mat.opacity = (1-t)*0.7; }
           }
            // (bubble tick moved to always-on section above)
             // Aurora animate (time + re-tint if star palette changed)
             if(auroraMeshRef.current && auroraMatRef.current){
               auroraMatRef.current.uniforms.uTime.value = now/1000;
               // Keep positioned behind camera target
               if(cameraRef.current && controlsRef.current){
                 const cam = cameraRef.current; const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
                 const tgt = controlsRef.current.target.clone();
                 // Place aurora plane in front of camera (along view direction) so it's within frustum at all zoom levels
                 auroraMeshRef.current.position.copy(tgt.add(dir.multiplyScalar(25000)));
                 auroraMeshRef.current.quaternion.copy(cam.quaternion);
               }
                // Recenter background sphere to camera (acts as sky dome)
                if(backgroundMeshRef.current && cameraRef.current){
                  backgroundMeshRef.current.position.copy(cameraRef.current.position);
                }
             }
         }
         if(advancedPassRef.current){ advancedPassRef.current.uniforms.uTime.value = performance.now()/1000; }
         // (Station icon scaling moved to dedicated RAF effect below for reliability)
         composerRef.current ? composerRef.current.render() : rendererRef.current?.render(sceneRef.current!, cameraRef.current!);
       } else {
        rendererRef.current?.render(sceneRef.current!, cameraRef.current!);
       }
       labelRenderer.render(sceneRef.current!, cameraRef.current!); // Render CSS2DRenderer
     };
     animate();

    const handleResize = () => {
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
        labelRenderer.setSize(window.innerWidth, window.innerHeight); // New: Resize label renderer
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      running = false; if(rafId) cancelAnimationFrame(rafId);
       window.removeEventListener('resize', handleResize);
       controls.dispose();
       rendererRef.current?.dispose();
       if (rendererRef.current) {
         currentMount.removeChild(rendererRef.current!.domElement);
       }
       currentMount.removeChild(labelRenderer.domElement); // New: Clean up label renderer DOM
    };
  }, [isLoaded, ringTexture, cinematicMode]);

  // Create and update starfield and stargates
  useEffect(() => {
    if (!mapData || !sceneRef.current) return;

    if (starFieldRef.current) {
      sceneRef.current.remove(starFieldRef.current);
      starFieldRef.current.geometry.dispose();
    }

    visibleSystemsRef.current = Object.values(mapData.solar_systems).filter(s => s && s.position && !s.hidden);

    const vertices: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    for (const system of visibleSystemsRef.current) {
      const pos = getTransformedPosition(system.position);
      vertices.push(pos.x, pos.y, pos.z);
  // Distance brightness falloff (stronger depth cue)
  const dist = Math.sqrt(pos.x*pos.x + pos.y*pos.y + pos.z*pos.z);
  // Normalize distance relative to a soft horizon (scale tuned empirically)
  const norm = dist * 0.0000022; // smaller factor => farther stars dim sooner
  // Curve: near stars ~1.0, mid fade, far approach min
  const falloff = Math.max(0.38, 1.0 - Math.pow(norm, 1.12));
      // Deterministic jitter for tiny temperature-like tint
      const seed = (Math.sin(system.id * 12.9898) * 43758.5453);
      const hSel = seed - Math.floor(seed);
      const tint = new THREE.Color();
      if(hSel < 0.33) tint.setHSL(0.58, 0.08, 0.90); // cool
      else if(hSel < 0.66) tint.setHSL(0.10, 0.08, 0.92); // warm
      else tint.setHSL(0.0, 0.00, 0.92); // neutral
      tint.r *= falloff; tint.g *= falloff; tint.b *= falloff;
      colors.push(tint.r, tint.g, tint.b);
      // Anchor star size variance (~3%)
      sizes.push((seed % 37) < 1 ? 1.6 : 1.0);
    }

    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  pointsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  pointsGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));

    starFieldRef.current = new THREE.Points(pointsGeometry, pointsMaterial);
    sceneRef.current.add(starFieldRef.current);

    if (stargateLinesRef.current) {
      sceneRef.current.remove(stargateLinesRef.current);
      stargateLinesRef.current.geometry.dispose();
    }
  // Glow lines removal not needed (already removed)

  const stargateVertices: number[] = [];
  const stargateMidpoints: number[] = [];
    const stargateColors: number[] = [];
  const defaultStargateColor = new THREE.Color(0xffffff); // white base; shader controls brightness span
    const stargateData: { source_system_id: number, destination_system_id: number }[] = [];

    if (mapData.stargates) {
      Object.values(mapData.stargates).forEach((stargate) => {
        const sourceSystem = mapData.solar_systems[stargate.source_system_id];
        const destinationSystem = mapData.solar_systems[stargate.destination_system_id];
        if (sourceSystem && destinationSystem && sourceSystem.position && destinationSystem.position && !sourceSystem.hidden && !destinationSystem.hidden) {
          const sourcePos = getTransformedPosition(sourceSystem.position);
          const destPos = getTransformedPosition(destinationSystem.position);
          stargateVertices.push(sourcePos.x, sourcePos.y, sourcePos.z);
          stargateVertices.push(destPos.x, destPos.y, destPos.z);
          const midx = (sourcePos.x + destPos.x)/2;
          const midy = (sourcePos.y + destPos.y)/2;
          const midz = (sourcePos.z + destPos.z)/2;
          // duplicate midpoint for each vertex of the segment
          stargateMidpoints.push(midx, midy, midz);
          stargateMidpoints.push(midx, midy, midz);

          stargateColors.push(defaultStargateColor.r, defaultStargateColor.g, defaultStargateColor.b);
          stargateColors.push(defaultStargateColor.r, defaultStargateColor.g, defaultStargateColor.b);

          stargateData.push({ source_system_id: stargate.source_system_id, destination_system_id: stargate.destination_system_id });
        }
      });
      const stargateGeometry = new THREE.BufferGeometry();
      stargateGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stargateVertices, 3));
      stargateGeometry.setAttribute('color', new THREE.Float32BufferAttribute(stargateColors, 3));
      if(stargateMidpoints.length === stargateVertices.length){
        stargateGeometry.setAttribute('mid', new THREE.Float32BufferAttribute(stargateMidpoints, 3));
      }
      stargateGeometry.userData = { stargateData };

  const stargateLines = new THREE.LineSegments(stargateGeometry, stargateMaterial);
  stargateLines.visible = !cinematicMode; // hide when cinematic
  sceneRef.current?.add(stargateLines);
  stargateLinesRef.current = stargateLines;
  // Glow pass (same geometry, stronger near-only fade) layered above
  // Glow pass removed
    }
  }, [mapData, getTransformedPosition, pointsMaterial, stargateMaterial, cinematicMode]);

  // Cinematic enable/disable lifecycle
  useEffect(()=>{
    if(!rendererRef.current || !sceneRef.current || !cameraRef.current || !starFieldRef.current) return;
    const renderer = rendererRef.current;
    const camera = cameraRef.current; // camera used later in passes
    const enable = () => {
      if(originalToneMappingRef.current===null) originalToneMappingRef.current = renderer.toneMapping as number;
      if(originalExposureRef.current===null) originalExposureRef.current = (renderer as any).toneMappingExposure ?? 1;
      originalStarMaterialRef.current = starFieldRef.current!.material as THREE.PointsMaterial;
  const cineMat = new THREE.PointsMaterial({ size:2.6, sizeAttenuation:true, map:(originalStarMaterialRef.current as any).map, transparent:true, depthWrite:false, vertexColors:true, blending:THREE.AdditiveBlending });
      cineMat.onBeforeCompile = (shader)=>{ 
        shader.uniforms.uTime={value:0}; 
        shader.uniforms.uAmp={value:0.25};
        shader.fragmentShader = `uniform float uTime;\nuniform float uAmp;\n${shader.fragmentShader}`.replace(
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
          'float tw = sin(uTime*3.0 + gl_FragCoord.x*0.07 + gl_FragCoord.y*0.07);\n'+
          'float f = 1.0 + tw*0.35*uAmp;\n'+
          'vec3 col = outgoingLight * f;\n'+
          'gl_FragColor = vec4(col, diffuseColor.a);'
        );
        (cineMat as any).userData.shader = shader; 
      };
      cinematicStarMaterialRef.current = cineMat; starFieldRef.current!.material = cineMat;
  // Apply star palette immediately on enable (even if mode already set to default)
  try { applyStarPalette(starColorMode); requestAnimationFrame(()=>{ applyStarPalette(starColorMode); }); } catch(e){ /* ignore */ }
      if(stargateLinesRef.current) stargateLinesRef.current.visible = false;
      // Dust
      const count=1000; const pos=new Float32Array(count*3); const col=new Float32Array(count*3);
  for(let i=0;i<count;i++){ const r=22000*Math.cbrt(Math.random()); const th=Math.random()*Math.PI*2; const ph=Math.acos(2*Math.random()-1); pos[i*3]=r*Math.sin(ph)*Math.cos(th); pos[i*3+1]=r*Math.sin(ph)*Math.sin(th); pos[i*3+2]=r*Math.cos(ph); const tint=new THREE.Color().setHSL(0.76+Math.random()*0.1,0.45,0.55+Math.random()*0.15); col[i*3]=tint.r; col[i*3+1]=tint.g; col[i*3+2]=tint.b; }
      const g=new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos,3)); g.setAttribute('color', new THREE.BufferAttribute(col,3));
      const dMat=new THREE.PointsMaterial({ size:14, sizeAttenuation:true, transparent:true, opacity:0.28*dustAmount, depthWrite:false, vertexColors:true, blending:THREE.AdditiveBlending, map: circleTexture, alphaTest:0.5 });
      // Subtle twinkle shader for dust (lower amplitude than main stars)
      dMat.onBeforeCompile = (shader)=>{
        shader.uniforms.uTime={ value:0 };
        shader.uniforms.uAmp={ value:0.15 }; // smaller than star twinkle
        shader.fragmentShader = `uniform float uTime; uniform float uAmp;\n${shader.fragmentShader}`.replace(
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
          'float tw = sin(uTime*2.4 + gl_FragCoord.x*0.045 + gl_FragCoord.y*0.045);\nfloat f = 1.0 + tw*0.25*uAmp; vec3 col = outgoingLight * f; gl_FragColor = vec4(col, diffuseColor.a);'
        );
        (dMat as any).userData.shader = shader;
      };
  dustPointsRef.current=new THREE.Points(g,dMat); sceneRef.current!.add(dustPointsRef.current);
      // Second dust layer (larger, sparser)
      const count2=400; const pos2=new Float32Array(count2*3); const col2=new Float32Array(count2*3);
  for(let i=0;i<count2;i++){ const r=30000*Math.cbrt(Math.random()); const th=Math.random()*Math.PI*2; const ph=Math.acos(2*Math.random()-1); pos2[i*3]=r*Math.sin(ph)*Math.cos(th); pos2[i*3+1]=r*Math.sin(ph)*Math.sin(th); pos2[i*3+2]=r*Math.cos(ph); const tint=new THREE.Color().setHSL(0.70+Math.random()*0.15,0.35,0.35+Math.random()*0.15); col2[i*3]=tint.r; col2[i*3+1]=tint.g; col2[i*3+2]=tint.b; }
      const g2=new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos2,3)); g2.setAttribute('color', new THREE.BufferAttribute(col2,3));
      const dMat2=new THREE.PointsMaterial({ size:24, sizeAttenuation:true, transparent:true, opacity:0.12*dustAmount, depthWrite:false, vertexColors:true, blending:THREE.AdditiveBlending, map: circleTexture, alphaTest:0.5 });
      dMat2.onBeforeCompile = (shader)=>{
        shader.uniforms.uTime={ value:0 };
        shader.uniforms.uAmp={ value:0.12 }; // even softer
        shader.fragmentShader = `uniform float uTime; uniform float uAmp;\n${shader.fragmentShader}`.replace(
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
          'float tw = sin(uTime*2.0 + gl_FragCoord.x*0.035 + gl_FragCoord.y*0.035);\nfloat f = 1.0 + tw*0.22*uAmp; vec3 col = outgoingLight * f; gl_FragColor = vec4(col, diffuseColor.a);'
        );
        (dMat2 as any).userData.shader = shader;
      };
      secondDustRef.current=new THREE.Points(g2,dMat2); sceneRef.current!.add(secondDustRef.current);
      // Aurora veil (experimental) + faint gradient background to help visibility
      const auroraTintForMode = (mode:string)=>{ switch(mode){ case 'purple': return new THREE.Color(0x8b6dff); case 'white': return new THREE.Color(0xbccfff); case 'blue': return new THREE.Color(0x5d8fff); case 'red': return new THREE.Color(0xff6b4b); case 'yellow': return new THREE.Color(0xffdd66); case 'random': return new THREE.Color(0x6fbaff); default: return new THREE.Color(0x5d8fff);} };
      if(!backgroundMeshRef.current){
        const backgroundTintForMode = (mode:string)=>{ switch(mode){ case 'purple': return new THREE.Color(0x0c0820); case 'white': return new THREE.Color(0x0d1116); case 'blue': return new THREE.Color(0x06101c); case 'red': return new THREE.Color(0x190806); case 'yellow': return new THREE.Color(0x161307); case 'random': return new THREE.Color(0x0b101c); default: return new THREE.Color(0x06101c);} };
        const bgGeo = new THREE.SphereGeometry(120000, 48, 32);
  // Aggressive easing so low slider values are almost black
  const _norm0 = Math.min(Math.max(bgIntensity/1.5,0),1);
  const initialBgStrength = _norm0 < 0.025 ? 0 : 1.5 * Math.pow(_norm0, 2.8);
        const bgMat = new THREE.ShaderMaterial({
          uniforms:{ uTint:{ value: backgroundTintForMode(starColorMode)}, uStrength:{ value: initialBgStrength } },
          vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
          // Vertical gradient based on normal.y so we get variation even when camera is near center. Amplified brightness for visibility.
          fragmentShader: 'varying vec3 vPos; uniform vec3 uTint; uniform float uStrength; void main(){ if(uStrength<=0.0){ gl_FragColor=vec4(0.0); return; } vec3 n = normalize(vPos); float y = n.y * 0.5 + 0.5; float glow = smoothstep(0.0,1.0,y); vec3 col = uTint * (0.30 + 0.70*glow) * uStrength; gl_FragColor = vec4(col,1.0); }',
          side: THREE.BackSide,
          depthWrite:false,
          transparent:true
        });
  const bgMesh = new THREE.Mesh(bgGeo, bgMat); bgMesh.renderOrder = -1000; bgMesh.frustumCulled = false; backgroundMeshRef.current = bgMesh; sceneRef.current!.add(bgMesh);
      }
      const auroraGeo = new THREE.PlaneGeometry(100000, 70000, 1,1);
  const auroraUniforms = { uTime:{value:0}, uTint:{value: auroraTintForMode(starColorMode)}, uGlobalAlpha:{value:auroraIntensity} };
      const auroraMat = new THREE.ShaderMaterial({
        uniforms: auroraUniforms,
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uTint; uniform float uGlobalAlpha;\nfloat hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }\nfloat noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); float a=hash(i); float b=hash(i+vec2(1,0)); float c=hash(i+vec2(0,1)); float d=hash(i+vec2(1,1)); vec2 u=f*f*(3.0-2.0*f); return mix(a,b,u.x)+ (c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y; }\nfloat fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=0.52; } return v; }\nvoid main(){ vec2 uv=vUv*vec2(2.0,1.2); uv.x+=uTime*0.01; uv.y+=sin(uTime*0.05)*0.1; float n=fbm(uv); float band=smoothstep(0.25,0.85,n); float flick=0.5+0.5*sin(uTime*0.4); float alpha=band*(0.35+0.25*flick); alpha=pow(alpha,1.2); alpha*=uGlobalAlpha; alpha = max(alpha, 0.05); vec3 col = uTint*(0.25 + 0.75*(0.6+0.4*n)); gl_FragColor=vec4(col,alpha); }`,
        transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide
      });
      const auroraMesh = new THREE.Mesh(auroraGeo, auroraMat); auroraMesh.position.set(0,0,-30000); auroraMeshRef.current = auroraMesh; auroraMatRef.current = auroraMat; sceneRef.current!.add(auroraMesh);
      // Meteors group
      meteorsGroupRef.current = new THREE.Group(); sceneRef.current!.add(meteorsGroupRef.current);
      lastMeteorSpawnRef.current = performance.now();
      // Ambient effect groups
      supernovaGroupRef.current = new THREE.Group(); sceneRef.current!.add(supernovaGroupRef.current);
      lensFlareGroupRef.current = new THREE.Group(); sceneRef.current!.add(lensFlareGroupRef.current);
      rippleGroupRef.current = new THREE.Group(); sceneRef.current!.add(rippleGroupRef.current);
      cometGroupRef.current = new THREE.Group(); sceneRef.current!.add(cometGroupRef.current);
      // Parallax background stars (very distant sparse layer)
      const PARALLAX_COUNT = 320;
      const pPos = new Float32Array(PARALLAX_COUNT*3);
      const pCol = new Float32Array(PARALLAX_COUNT*3);
      for(let i=0;i<PARALLAX_COUNT;i++){
        const r = 90000 * Math.cbrt(Math.random());
        const th = Math.random()*Math.PI*2;
        const ph = Math.acos(2*Math.random()-1);
        pPos[i*3] = r*Math.sin(ph)*Math.cos(th);
        pPos[i*3+1] = r*Math.sin(ph)*Math.sin(th);
        pPos[i*3+2] = r*Math.cos(ph);
        const tint = new THREE.Color().setHSL(0.58+Math.random()*0.05, 0.25, 0.65+Math.random()*0.2);
        pCol[i*3] = tint.r; pCol[i*3+1] = tint.g; pCol[i*3+2] = tint.b;
      }
      const pGeom = new THREE.BufferGeometry();
      pGeom.setAttribute('position', new THREE.BufferAttribute(pPos,3));
      pGeom.setAttribute('color', new THREE.BufferAttribute(pCol,3));
      const pMat = new THREE.PointsMaterial({
        size:4.5,
        sizeAttenuation:true,
        transparent:true,
        opacity:0.35,
        depthWrite:false,
        vertexColors:true,
        blending:THREE.AdditiveBlending,
        map: circleTexture,
        alphaTest: 0.5
      });
      parallaxStarsRef.current = new THREE.Points(pGeom,pMat); sceneRef.current!.add(parallaxStarsRef.current);
      // Initialize schedules
      const nowT = performance.now();
      nextSupernovaAtRef.current = nowT + 45000 + Math.random()*45000; // 45-90s
      nextLensBlinkAtRef.current = nowT + 8000 + Math.random()*7000;   // 8-15s
      nextCometAtRef.current = nowT + 60000 + Math.random()*60000;     // 60-120s
      nextRippleAtRef.current = nowT + 30000 + Math.random()*40000;    // 30-70s
      // Post chain (recreate composer & bloom)
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(sceneRef.current!, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), bloomStrength, 0.4, 0.85); bloom.threshold = 0;
      composer.addPass(bloom);
      composerRef.current = composer; bloomPassRef.current = bloom;
      // Custom post-processing pass (vignette + grain + chromatic aberration + radial glow)
      // After composer and bloom have been created
  const customShader = { uniforms:{ tDiffuse:{value:null}, uTime:{value:0}, uGrain:{value:0.35}, uVignette:{value:0.85}, uAberration:{value:new THREE.Vector2(aberrationAmt,aberrationAmt)}, uRadialGlow:{value:0.15}, resolution:{value:new THREE.Vector2(window.innerWidth, window.innerHeight)}, uHazeColor:{value:new THREE.Color(hazeColor)}, uHazeIntensity:{value:hazeIntensity}, uHazeRadius:{value:hazeRadius}, uNebulaShimmerAmp:{value:0.18} }, vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`, fragmentShader:`uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVignette; uniform float uRadialGlow; uniform vec2 uAberration; uniform vec2 resolution; uniform vec3 uHazeColor; uniform float uHazeIntensity; uniform float uHazeRadius; uniform float uNebulaShimmerAmp; varying vec2 vUv; float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))+uTime*917.2)*43758.5453); } void main(){ vec2 centered = vUv - 0.5; float r = length(centered); vec2 offR = vUv + uAberration*vec2( 0.5 - vUv.y,  vUv.x-0.5); vec2 offB = vUv - uAberration*vec2( 0.5 - vUv.x,  vUv.y-0.5); vec3 col; col.r = texture2D(tDiffuse, offR).r; col.g = texture2D(tDiffuse, vUv).g; col.b = texture2D(tDiffuse, offB).b; float glow = smoothstep(0.7,0.0,r)*uRadialGlow; col += glow; float vig = smoothstep(0.8, uVignette, r); col *= (1.0 - 0.65*vig); float maxR = 0.70710678; float coverage = max(uHazeRadius/100.0, 0.0005); float rn = r / (maxR * coverage); float baseH = clamp(1.0 - rn, 0.0, 1.0); float shimmer = 1.0 + (sin(uTime*0.35 + centered.x*6.0 + centered.y*5.0) * 0.5 + 0.5 - 0.5) * uNebulaShimmerAmp * 0.35; shimmer += (hash(vUv*vec2(320.0,451.0)) - 0.5) * uNebulaShimmerAmp * 0.25; baseH *= shimmer; vec3 haze = uHazeColor * (uHazeIntensity * baseH); col += haze; float g = (hash(floor(gl_FragCoord.xy)) - 0.5)*uGrain; col += g/255.0; gl_FragColor = vec4(col,1.0); }`};
      const pass = new ShaderPass(customShader as any); composer.addPass(pass); advancedPassRef.current = pass;
      renderer.toneMapping = THREE.ACESFilmicToneMapping as any; (renderer as any).toneMappingExposure = cinExposure;
      const onResize=()=>{ composer.setSize(window.innerWidth, window.innerHeight); bloom.setSize(window.innerWidth, window.innerHeight); }; window.addEventListener('resize', onResize); (enable as any)._resize = onResize;
    };
    const disable = () => {
      if(starFieldRef.current && originalStarMaterialRef.current) starFieldRef.current.material = originalStarMaterialRef.current;
      if(stargateLinesRef.current) stargateLinesRef.current.visible = true;
    if(backgroundMeshRef.current){
      try {
        sceneRef.current?.remove(backgroundMeshRef.current);
        (backgroundMeshRef.current.geometry as any)?.dispose?.();
        (backgroundMeshRef.current.material as any)?.dispose?.();
      } catch(e){ /* ignore */ }
      backgroundMeshRef.current = null;
    }
      // Reset hover state so interactions resume cleanly after exiting cinematic mode
      try {
        setHoveredSystem(null);
        if(hoverLabelObj.current){
          hoverLabelObj.current.visible = false;
          if(hoverLabelObj.current.parent){
            hoverLabelObj.current.parent.remove(hoverLabelObj.current);
            if(sceneRef.current && hoverLabelObj.current.parent instanceof THREE.Object3D){
              sceneRef.current.remove(hoverLabelObj.current.parent);
            }
          }
        }
    firstMoveRef.current = false;
      } catch { /* ignore */ }
      // Force restore of base star material properties (in case palette / additive blending lingered)
      try {
      if (starFieldRef.current) {
          const mat = starFieldRef.current.material as THREE.PointsMaterial;
          mat.blending = THREE.NormalBlending;
          mat.depthWrite = true;
          mat.transparent = true;
          mat.opacity = 1.0;
      if(overlayRingsRef.current){ try { overlayRingsRef.current.dispose(); } catch {}; overlayRingsRef.current = null; }
          (mat as any).needsUpdate = true;
          // Reapply color buffer to plain white (actual pipeline effect will recolor next frame)
          const geom = starFieldRef.current.geometry as THREE.BufferGeometry;
          const colAttr = geom.getAttribute('color') as THREE.BufferAttribute;
          if(colAttr){
            for(let i=0;i<colAttr.count;i++){ colAttr.setXYZ(i,1,1,1); }
            colAttr.needsUpdate = true;
          }
          // Recompute bounding volumes to ensure raycaster picks up points correctly
          geom.computeBoundingSphere();
        }
      } catch { /* ignore */ }
      // Rebuild the base starfield entirely as a fallback to clear any lingering shader state
      try {
        if(sceneRef.current){
          if(starFieldRef.current){
            sceneRef.current.remove(starFieldRef.current);
            try { starFieldRef.current.geometry.dispose(); } catch {}
            // Do not dispose pointsMaterial (shared)
          }
          // NOTE: When rebuilding we must also restore the per-star size attribute (aSize)
          // otherwise the shader's aSize multiplication collapses point size scaling.
          const verts:number[] = []; const cols:number[] = []; const sizes:number[] = [];
          for(const sys of visibleSystemsRef.current){
            const pos = getTransformedPosition(sys.position);
            verts.push(pos.x,pos.y,pos.z);
            // Recreate deterministic slight tint & brightness falloff similar to initial build
            const dist = Math.sqrt(pos.x*pos.x + pos.y*pos.y + pos.z*pos.z);
            const norm = dist * 0.0000022;
            const falloff = Math.max(0.38, 1.0 - Math.pow(norm, 1.12));
            const seed = (Math.sin(sys.id * 12.9898) * 43758.5453);
            const hSel = seed - Math.floor(seed);
            const tint = new THREE.Color();
            if(hSel < 0.33) tint.setHSL(0.58, 0.08, 0.90);
            else if(hSel < 0.66) tint.setHSL(0.10, 0.08, 0.92);
            else tint.setHSL(0.0, 0.00, 0.92);
            tint.r *= falloff; tint.g *= falloff; tint.b *= falloff;
            cols.push(tint.r, tint.g, tint.b);
            sizes.push((seed % 37) < 1 ? 1.6 : 1.0);
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
          g.setAttribute('color', new THREE.Float32BufferAttribute(cols,3));
          g.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes,1)); // critical for zoom scaling
          const basePoints = new THREE.Points(g, pointsMaterial);
          starFieldRef.current = basePoints;
          sceneRef.current.add(basePoints);
        }
      } catch { /* ignore */ }
  if(dustPointsRef.current){ dustPointsRef.current.geometry.dispose(); (dustPointsRef.current.material as THREE.Material).dispose(); sceneRef.current!.remove(dustPointsRef.current); dustPointsRef.current=null; }
  if(secondDustRef.current){ secondDustRef.current.geometry.dispose(); (secondDustRef.current.material as THREE.Material).dispose(); sceneRef.current!.remove(secondDustRef.current); secondDustRef.current=null; }
  if(meteorsGroupRef.current){ meteorsGroupRef.current.children.forEach(c=>{ const m=c as any; if(m.geometry) m.geometry.dispose(); if(m.material) m.material.dispose(); }); sceneRef.current!.remove(meteorsGroupRef.current); meteorsGroupRef.current=null; }
  if(supernovaGroupRef.current){ supernovaGroupRef.current.children.forEach(c=>{ const m=c as any; m.geometry?.dispose?.(); m.material?.dispose?.();}); sceneRef.current!.remove(supernovaGroupRef.current); supernovaGroupRef.current=null; }
  if(lensFlareGroupRef.current){ lensFlareGroupRef.current.children.forEach(c=>{ const m=c as any; m.geometry?.dispose?.(); m.material?.dispose?.();}); sceneRef.current!.remove(lensFlareGroupRef.current); lensFlareGroupRef.current=null; }
  if(rippleGroupRef.current){ rippleGroupRef.current.children.forEach(c=>{ const m=c as any; m.geometry?.dispose?.(); m.material?.dispose?.();}); sceneRef.current!.remove(rippleGroupRef.current); rippleGroupRef.current=null; }
  if(cometGroupRef.current){ cometGroupRef.current.children.forEach(c=>{ const m=c as any; m.geometry?.dispose?.(); m.material?.dispose?.();}); sceneRef.current!.remove(cometGroupRef.current); cometGroupRef.current=null; }
  if(parallaxStarsRef.current){ parallaxStarsRef.current.geometry.dispose(); (parallaxStarsRef.current.material as THREE.Material).dispose(); sceneRef.current!.remove(parallaxStarsRef.current); parallaxStarsRef.current=null; }
  if(auroraMeshRef.current){ auroraMeshRef.current.geometry.dispose(); (auroraMeshRef.current.material as THREE.Material).dispose(); sceneRef.current!.remove(auroraMeshRef.current); auroraMeshRef.current=null; auroraMatRef.current=null; }
      if(composerRef.current){ composerRef.current.passes.forEach(p=> (p as any).dispose?.()); (composerRef.current as any).dispose?.(); composerRef.current=null; bloomPassRef.current=null; }
      if(originalToneMappingRef.current!==null) renderer.toneMapping = originalToneMappingRef.current as any;
      if(originalExposureRef.current!==null) (renderer as any).toneMappingExposure = originalExposureRef.current;
      if((enable as any)._resize) window.removeEventListener('resize', (enable as any)._resize);
    };
    if(cinematicMode) enable(); else disable();
    return ()=>{ if(cinematicMode) disable(); };
  // Cinematic enable/disable lifecycle (exclude bloomStrength so slider changes don't recreate composer)
  }, [cinematicMode, /* bloomStrength removed */ dustAmount, cinExposure]);

  // Star palette application via geometry colors (overrides any previous per-star coloring while in cinematic mode)
  const applyStarPalette = useCallback((mode: typeof starColorMode)=>{
    if(!cinematicMode) return; // only apply in cinematic
    if(!starFieldRef.current) return;
    const geom = starFieldRef.current.geometry as THREE.BufferGeometry;
    const attr = geom.getAttribute('color') as THREE.BufferAttribute;
    if(!attr) return;
    const count = attr.count;
    const palettes: Record<string, [number,number,number][]> = {
      purple: [[0.70,0.55,1.0],[0.55,0.50,0.95],[0.85,0.60,1.0]],
      white:  [[0.95,0.95,0.95],[1.0,1.0,1.0],[0.95,0.95,0.95]],
  // Make blue palette visibly distinct (deeper blues)
  // Lighter, colder blue palette (soft stellar blues)
  blue:   [[0.65,0.80,1.0],[0.55,0.75,1.0],[0.75,0.88,1.0]],
      red:    [[1.0,0.35,0.20],[1.0,0.50,0.28],[1.0,0.70,0.45]],
      yellow: [[1.0,0.82,0.05],[1.0,0.90,0.30],[1.0,0.97,0.60]],
      random: [[1.0,0.35,0.20],[0.55,0.65,1.0],[1.0,0.82,0.05]]
    };
    const sel = palettes[mode]; if(!sel) return;
    for(let i=0;i<count;i++){
      const h = (Math.sin(i*12.9898)*43758.5453) % 1; // deterministic pseudo-random
      let c: [number,number,number];
      if(h < 0.33) c = sel[0]; else if(h < 0.66) c = sel[1]; else c = sel[2];
      attr.setX(i,c[0]); attr.setY(i,c[1]); attr.setZ(i,c[2]);
    }
    attr.needsUpdate = true;
  }, [cinematicMode]);

  // Re-apply palette when mode changes or when cinematic toggles on
  useEffect(()=>{ applyStarPalette(starColorMode); }, [starColorMode, cinematicMode, applyStarPalette]);
  // Retint background & aurora when palette changes (if present)
  useEffect(()=>{
    if(!cinematicMode) return;
    if(backgroundMeshRef.current){
      const backgroundTintForMode = (mode:string)=>{ switch(mode){ case 'purple': return new THREE.Color(0x0c0820); case 'white': return new THREE.Color(0x0d1116); case 'blue': return new THREE.Color(0x06101c); case 'red': return new THREE.Color(0x190806); case 'yellow': return new THREE.Color(0x161307); case 'random': return new THREE.Color(0x0b101c); default: return new THREE.Color(0x06101c);} };
      const mat = backgroundMeshRef.current.material as THREE.ShaderMaterial;
      if(mat.uniforms.uTint) mat.uniforms.uTint.value = backgroundTintForMode(starColorMode);
    }
    if(auroraMatRef.current){
      const auroraTintForMode = (mode:string)=>{ switch(mode){ case 'purple': return new THREE.Color(0x8b6dff); case 'white': return new THREE.Color(0xbccfff); case 'blue': return new THREE.Color(0x5d8fff); case 'red': return new THREE.Color(0xff6b4b); case 'yellow': return new THREE.Color(0xffdd66); case 'random': return new THREE.Color(0x6fbaff); default: return new THREE.Color(0x5d8fff);} };
      if(auroraMatRef.current.uniforms.uTint) auroraMatRef.current.uniforms.uTint.value = auroraTintForMode(starColorMode);
    }
  }, [starColorMode, cinematicMode]);

  // Respond to user cinematic color control changes
  useEffect(()=>{
    if(!cinematicMode) return;
    if(advancedPassRef.current){ const u = advancedPassRef.current.uniforms; if(u.uHazeColor) u.uHazeColor.value.set(hazeColor); if(u.uHazeIntensity) u.uHazeIntensity.value = hazeIntensity; if(u.uHazeRadius) u.uHazeRadius.value = hazeRadius; if(u.uAberration) u.uAberration.value.set(aberrationAmt,aberrationAmt); }
  }, [cinematicMode, hazeColor, hazeIntensity, hazeRadius, aberrationAmt]);

  // Live slider updates
  // Update bloom strength when committed value changes
  useEffect(()=>{ if(!cinematicMode) return; bloomStrengthRef.current = bloomStrength; if(bloomPassRef.current) bloomPassRef.current.strength = bloomStrength; }, [bloomStrength, cinematicMode]);
  // Other live updates that are still fine to apply immediately
  useEffect(()=>{ if(!cinematicMode) return; if(rendererRef.current) (rendererRef.current as any).toneMappingExposure = cinExposure; if(dustPointsRef.current) (dustPointsRef.current.material as THREE.PointsMaterial).opacity = 0.28*dustAmount; if(secondDustRef.current) (secondDustRef.current.material as THREE.PointsMaterial).opacity = 0.12*dustAmount * (secondDustEnabled?1:0); if(backgroundMeshRef.current){ const mat = backgroundMeshRef.current.material as THREE.ShaderMaterial; if(mat.uniforms.uStrength){ const _n=Math.min(Math.max(bgIntensity/1.5,0),1); const mapped = _n < 0.025 ? 0 : 1.5 * Math.pow(_n, 2.8); mat.uniforms.uStrength.value = mapped; } } }, [dustAmount, cinExposure, bgIntensity, secondDustEnabled, cinematicMode]);

  useEffect(()=>{ if(!cinematicMode) return; const vis = showAurora; if(backgroundMeshRef.current) backgroundMeshRef.current.visible = vis; if(auroraMeshRef.current) auroraMeshRef.current.visible = vis; }, [showAurora, cinematicMode]);

  // Suppress labels & hover ring during cinematic mode unless cinematicLabels enabled; restore after
  useEffect(()=>{
    if(cinematicMode && !cinematicLabels){
      // Hide hover
      if(hoverPointRef.current) hoverPointRef.current.visible = false;
      if(hoverLabelObj.current){
        hoverLabelObj.current.visible = false;
        if(hoverLabelObj.current.parent){
          hoverLabelObj.current.parent.remove(hoverLabelObj.current);
          if(sceneRef.current && hoverLabelObj.current.parent instanceof THREE.Object3D){ sceneRef.current.remove(hoverLabelObj.current.parent); }
        }
      }
      if(selectedLabelObj.current){
        selectedLabelObj.current.visible = false;
        if(selectedLabelObj.current.parent){
          selectedLabelObj.current.parent.remove(selectedLabelObj.current);
          if(sceneRef.current && selectedLabelObj.current.parent instanceof THREE.Object3D){ sceneRef.current.remove(selectedLabelObj.current.parent); }
        }
      }
    } else if(!cinematicMode || (cinematicMode && cinematicLabels)) {
      // Recreate selection label if a system is highlighted and no label exists
      if(highlightedSystem && !selectedLabelObj.current){
        const newParent = new THREE.Object3D();
        const pos = getTransformedPosition(highlightedSystem.position);
        newParent.position.set(pos.x,pos.y,pos.z);
        sceneRef.current?.add(newParent);
        const el = createSystemLabelElement(highlightedSystem.name, true, highlightedSystem.planets);
        selectedLabelObj.current = new CSS2DObject(el);
        selectedLabelObj.current.position.set(0,0,0);
        newParent.add(selectedLabelObj.current);
        selectedLabelObj.current.visible = true;
      } else if(highlightedSystem && selectedLabelObj.current){
        // If we toggled labels on mid-session, ensure selected label is visible
        selectedLabelObj.current.visible = true;
      }
    }
  }, [cinematicMode, cinematicLabels, highlightedSystem, getTransformedPosition, createSystemLabelElement]);
  useEffect(()=>{ if(!cinematicMode) return; if(auroraMatRef.current){ auroraMatRef.current.uniforms.uGlobalAlpha.value = auroraIntensity; } }, [auroraIntensity, cinematicMode]);

  // Update custom pass uniforms when sliders change
  useEffect(()=>{ if(!cinematicMode) return; if(advancedPassRef.current){ const u=advancedPassRef.current.uniforms; u.uVignette.value = vignette; u.uGrain.value = grain; u.uAberration.value.set(aberration,aberration); u.uRadialGlow.value = radialGlow; } }, [vignette, grain, aberration, radialGlow, cinematicMode]);

  // Handle creating/destroying second dust on toggle while active
  useEffect(()=>{ if(!cinematicMode) return; if(!sceneRef.current) return; if(secondDustEnabled && !secondDustRef.current){ const count2=400; const pos2=new Float32Array(count2*3); const col2=new Float32Array(count2*3); for(let i=0;i<count2;i++){ const r=30000*Math.cbrt(Math.random()); const th=Math.random()*Math.PI*2; const ph=Math.acos(2*Math.random()-1); pos2[i*3]=r*Math.sin(ph)*Math.cos(th); pos2[i*3+1]=r*Math.sin(ph)*Math.sin(th); pos2[i*3+2]=r*Math.cos(ph); const tint=new THREE.Color().setHSL(0.70+Math.random()*0.15,0.35,0.35+Math.random()*0.15); col2[i*3]=tint.r; col2[i*3+1]=tint.g; col2[i*3+2]=tint.b; } const g2=new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos2,3)); g2.setAttribute('color', new THREE.BufferAttribute(col2,3)); const dMat2=new THREE.PointsMaterial({ size:24, sizeAttenuation:true, transparent:true, opacity:0.12*dustAmount, depthWrite:false, vertexColors:true, blending:THREE.AdditiveBlending }); secondDustRef.current=new THREE.Points(g2,dMat2); sceneRef.current.add(secondDustRef.current); } else if(!secondDustEnabled && secondDustRef.current){ secondDustRef.current.geometry.dispose(); (secondDustRef.current.material as THREE.Material).dispose(); sceneRef.current.remove(secondDustRef.current); secondDustRef.current=null; } }, [secondDustEnabled, cinematicMode, dustAmount]);

  // This useLayoutEffect handles all dynamic star and stargate line coloring based on the pipeline.
  useLayoutEffect(() => {
    if (!mapData || !starFieldRef.current || !sceneRef.current) return;
    // If cinematic mode active, skip planet/region color pipeline and rely on palette coloring
    if(cinematicMode){
      return; // palette applied elsewhere
    }

    const starColorsAttribute = starFieldRef.current.geometry.attributes.color as THREE.BufferAttribute;
    const currentStarColors = starColorsAttribute.array as Float32Array;

    // --- Cleanup previous state (Step 0) ---
    // This cleanup runs before any new rendering, ensuring a clean slate.
    // It also serves as the cleanup function for the effect.
    const cleanupVisuals = () => {
      // Cleanup RegionHighlighterModule effects
      RegionHighlighterModule.cleanup(
        starFieldRef.current!,
        stargateLinesRef.current,
        highlightedSystem, // Pass for consistency, though not used for star color reset
        visibleSystemsRef.current,
        isPlanetCountActive
      );

      // Remove selected star halo
      if (selectedStarHaloRef.current) {
        sceneRef.current?.remove(selectedStarHaloRef.current);
        selectedStarHaloRef.current.geometry.dispose();
        (selectedStarHaloRef.current.material as THREE.Material).dispose();
        selectedStarHaloRef.current = null;
      }

      // Remove region outlines (if DPC was on)
      if (regionOutlineGroupRef.current) {
        sceneRef.current?.remove(regionOutlineGroupRef.current);
        regionOutlineGroupRef.current.children.forEach(child => {
          if (child instanceof THREE.Sprite) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        regionOutlineGroupRef.current = null;
      }

      // Re-apply base colors to all stars to ensure no lingering highlights
      // This is crucial for order independence and correct toggling
      const tempColors = new Float32Array(currentStarColors.length);
      const planetCounts = visibleSystemsRef.current.map(s => s.planets);
      const minPlanets = Math.min(...planetCounts);
      const maxPlanets = Math.max(...planetCounts);

      const numSteps = 5;
      for (let i = 0; i < visibleSystemsRef.current.length; i++) {
        const system = visibleSystemsRef.current[i];
        let color: THREE.Color;
        if (isPlanetCountActive) {
          if (maxPlanets !== minPlanets) {
            const ratio = (system.planets - minPlanets) / (maxPlanets - minPlanets);
            let bin = Math.floor(ratio * numSteps);
            if (bin >= numSteps) bin = numSteps - 1;
            if (!planetBinsActive[bin]) {
              color = DEFAULT_STAR_COLOR;
            } else {
              color = getPlanetCountColor(system.planets, minPlanets, maxPlanets);
            }
          } else {
            // All same planet count; treat as single bin
            color = planetBinsActive[0] ? DEFAULT_STAR_COLOR : DEFAULT_STAR_COLOR; // stays default
          }
        } else {
          color = DEFAULT_STAR_COLOR;
        }
        color.toArray(tempColors, i * 3);
      }
      starColorsAttribute.array.set(tempColors);
      starColorsAttribute.needsUpdate = true;
    };

    // Call cleanup immediately to reset state before applying new visuals
    cleanupVisuals();

    // --- Step 1: Base Layer (Planet Count or White, with Region-specific DPC) ---
    

    let systemsInHighlightedRegion: Set<number> | null = null;
    if (isRegionHighlighterActive && highlightedSystem) {
      systemsInHighlightedRegion = new Set(
        visibleSystemsRef.current
          .filter(s => s.region_id === highlightedSystem.region_id)
          .map(s => s.id)
      );
    }

    const numSteps = 5;
    for (let i = 0; i < visibleSystemsRef.current.length; i++) {
      const system = visibleSystemsRef.current[i];
      let color: THREE.Color;
      if (isPlanetCountActive) {
        let activeForBin = true;
        if (maxPlanets !== minPlanets) {
          const ratio = (system.planets - minPlanets) / (maxPlanets - minPlanets);
            let bin = Math.floor(ratio * numSteps);
            if (bin >= numSteps) bin = numSteps - 1;
            activeForBin = planetBinsActive[bin];
        } else {
          activeForBin = planetBinsActive[0];
        }
        if (!activeForBin) {
          color = DEFAULT_STAR_COLOR; // Bin disabled
        } else if (systemsInHighlightedRegion && systemsInHighlightedRegion.has(system.id)) {
          color = getPlanetCountColor(system.planets, minPlanets, maxPlanets);
        } else if (systemsInHighlightedRegion && !systemsInHighlightedRegion.has(system.id)) {
          color = DEFAULT_STAR_COLOR;
        } else {
          color = getPlanetCountColor(system.planets, minPlanets, maxPlanets);
        }
      } else {
        color = DEFAULT_STAR_COLOR;
      }
      color.toArray(currentStarColors, i * 3);
    }
    starColorsAttribute.needsUpdate = true;

    // --- Step 2: Region Overlay (if HR && selectedStar) ---
    if (isRegionHighlighterActive && highlightedSystem) {
      RegionHighlighterModule.init(
        sceneRef.current!,
        mapData,
        starFieldRef.current,
        stargateLinesRef.current,
        highlightedSystem,
        visibleSystemsRef.current,
        isPlanetCountActive // Pass DPC state to RegionHighlighter
      );

      // If DPC is ON, add non-destructive region outlines
      if (isPlanetCountActive) {
        const targetRegionId = highlightedSystem.region_id;
        const systemsInRegion = visibleSystemsRef.current.filter(s => s.region_id === targetRegionId);

        if (!regionOutlineGroupRef.current) {
          regionOutlineGroupRef.current = new THREE.Group();
          sceneRef.current.add(regionOutlineGroupRef.current);
        }

        systemsInRegion.forEach(system => {
          const pos = getTransformedPosition(system.position);
          const spriteMaterial = new THREE.SpriteMaterial({
            map: ringTexture,
            color: REGION_OUTLINE_COLOR,
            transparent: true,
            alphaTest: 0.5,
            sizeAttenuation: false, // Keep size consistent regardless of distance
          });
          const sprite = new THREE.Sprite(spriteMaterial);
          sprite.position.set(pos.x, pos.y, pos.z);
          sprite.scale.set(25, 25, 1); // Adjust size as needed for visibility
          regionOutlineGroupRef.current!.add(sprite);
        });
      }
    }

    // --- Step 3: Selection Cue ---
    if (highlightedSystem) {
      const highlightedIndex = visibleSystemsRef.current.findIndex(s => s.id === highlightedSystem.id);
      if (highlightedIndex !== -1) {
        // Set selected star to brighter orange/red
        SELECTED_STAR_COLOR.toArray(currentStarColors, highlightedIndex * 3);
      }
    }
    starColorsAttribute.needsUpdate = true;

    return cleanupVisuals; // Return the cleanup function
  }, [
    isPlanetCountActive,
    isRegionHighlighterActive,
    highlightedSystem,
    mapData,
    getPlanetCountColor,
    getTransformedPosition,
    ringTexture,
    planetBinsActive,
  ]);

  // Ensure toggling the Highlight Region checkbox applies or removes highlights immediately
  useEffect(() => {
    if (!mapData || !starFieldRef.current || !sceneRef.current) return;

    // Apply highlight
    if (isRegionHighlighterActive && highlightedSystem) {
      try {
        RegionHighlighterModule.init(
          sceneRef.current!,
          mapData,
          starFieldRef.current,
          stargateLinesRef.current,
          highlightedSystem,
          visibleSystemsRef.current,
          isPlanetCountActive
        );

        // If DPC (planet counts) is on, create region outlines to match the other code path
        if (isPlanetCountActive) {
          const targetRegionId = highlightedSystem.region_id;
          const systemsInRegion = visibleSystemsRef.current.filter(s => s.region_id === targetRegionId);

          if (!regionOutlineGroupRef.current) {
            regionOutlineGroupRef.current = new THREE.Group();
            sceneRef.current.add(regionOutlineGroupRef.current);
          }

          systemsInRegion.forEach(system => {
            const pos = getTransformedPosition(system.position);
            const spriteMaterial = new THREE.SpriteMaterial({
              map: ringTexture,
              color: REGION_OUTLINE_COLOR,
              transparent: true,
              alphaTest: 0.5,
              sizeAttenuation: false,
            });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.position.set(pos.x, pos.y, pos.z);
            sprite.scale.set(25, 25, 1);
            regionOutlineGroupRef.current!.add(sprite);
          });
        }
      } catch (e) {
        // ignore errors from the highlighter
      }
      return;
    }

    // Remove highlight
    try {
      RegionHighlighterModule.cleanup(
        starFieldRef.current!,
        stargateLinesRef.current,
        highlightedSystem,
        visibleSystemsRef.current,
        isPlanetCountActive
      );
    } catch (e) {
      // ignore
    }

    // Remove any region outline sprites
    try {
      if (regionOutlineGroupRef.current && sceneRef.current) {
        sceneRef.current.remove(regionOutlineGroupRef.current);
        regionOutlineGroupRef.current.children.forEach(child => {
          if (child instanceof THREE.Sprite) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        regionOutlineGroupRef.current = null;
      }
    } catch (e) {
      // ignore
    }

    // Reset star colors to base (planet count or default)
    try {
      const starColorsAttribute = starFieldRef.current.geometry.attributes.color as THREE.BufferAttribute;
      const tempColors = new Float32Array(starColorsAttribute.array.length);
      const planetCounts = visibleSystemsRef.current.map(s => s.planets);
      const minPlanetsLocal = planetCounts.length > 0 ? Math.min(...planetCounts) : 0;
      const maxPlanetsLocal = planetCounts.length > 0 ? Math.max(...planetCounts) : 0;

      const numStepsLocal = 5;
      for (let i = 0; i < visibleSystemsRef.current.length; i++) {
        const system = visibleSystemsRef.current[i];
        let color: THREE.Color;
        if (isPlanetCountActive) {
          let binIdx = 0;
          if (maxPlanetsLocal !== minPlanetsLocal) {
            const ratio = (system.planets - minPlanetsLocal) / (maxPlanetsLocal - minPlanetsLocal);
            binIdx = Math.floor(ratio * numStepsLocal);
            if (binIdx >= numStepsLocal) binIdx = numStepsLocal - 1;
          }
          if (!planetBinsActive[binIdx]) {
            color = DEFAULT_STAR_COLOR;
          } else {
            color = getPlanetCountColor(system.planets, minPlanetsLocal, maxPlanetsLocal);
          }
        } else {
          color = DEFAULT_STAR_COLOR;
        }
        color.toArray(tempColors, i * 3);
      }
      starColorsAttribute.array.set(tempColors);
      starColorsAttribute.needsUpdate = true;
    } catch (e) {
      // ignore
    }

    // Remove selected halo if present
    try {
      if (selectedStarHaloRef.current && sceneRef.current) {
        sceneRef.current.remove(selectedStarHaloRef.current);
        selectedStarHaloRef.current.geometry.dispose();
        (selectedStarHaloRef.current.material as THREE.Material).dispose();
        selectedStarHaloRef.current = null;
      }
    } catch (e) {
      // ignore
    }

  }, [isRegionHighlighterActive, highlightedSystem, mapData, isPlanetCountActive, getPlanetCountColor, getTransformedPosition, ringTexture, planetBinsActive, cinematicMode]);

  // Draw Route Lines (supports P2P or Scout route; Scout takes precedence when present)
  useEffect(() => {
    if (!sceneRef.current || !mapData) return;

    if (routeLinesRef.current) {
      try {
        // Dispose previous ribbon resources if present
        const old = routeLinesRef.current as any;
        if (old.userData?.routeGeometry) (old.userData.routeGeometry as THREE.BufferGeometry).dispose();
        if (old.userData?.routeMaterial) (old.userData.routeMaterial as THREE.Material).dispose();
        sceneRef.current.remove(routeLinesRef.current);
      } catch {/* ignore */}
      routeLinesRef.current = null;
    }

    const activePath = scoutRouteResult?.path || routeResult?.path;
    if (!activePath || activePath.length < 2) {
      routeAnimUpdatersRef.current = [];
      routeSourceRef.current = null;
      return;
    }

    const systemsByName = Object.fromEntries(Object.values(mapData.solar_systems).map(s => [s.name.toLowerCase(), s]));
    const pathSystems = activePath.map(name => systemsByName[name.toLowerCase()]).filter(Boolean);
    if (pathSystems.length < 2) {
      routeAnimUpdatersRef.current = [];
      routeSourceRef.current = null;
      return;
    }

    // Build ribbon route instead of tube meshes
    routeSourceRef.current = scoutRouteResult?.path ? 'scout' : 'p2p';
    const accentHex = accentIsBlue ? 0x00aaff : 0xff4c26;
    const group = createRouteRibbon({
      pathSystems,
      mapData: mapData as any,
      accentHex,
      getTransformedPosition,
  cameraRef,
      rendererRef,
      animUpdatersRef: routeAnimUpdatersRef as any
    });
    if (group) {
      routeLinesRef.current = group;
      sceneRef.current.add(group);
    }

    // --- Auto zoom & animated transition to encompass route ---
    try {
      if (cameraRef.current && controlsRef.current) {
        const cam = cameraRef.current;
        const controls = controlsRef.current;
        const pts: THREE.Vector3[] = pathSystems.map(sys => {
          const p = getTransformedPosition(sys.position);
          return new THREE.Vector3(p.x, p.y, p.z);
        });
        if (pts.length >= 2) {
          const box = new THREE.Box3().setFromPoints(pts);
          const sphere = box.getBoundingSphere(new THREE.Sphere());
          const radius = sphere.radius;
          if (radius > 0) {
            const fov = cam.fov * Math.PI / 180;
            const aspect = cam.aspect;
            const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
            const desiredFill = 0.6; // portion of height the diameter should roughly occupy
            const effectiveRadius = radius / desiredFill;
            const distV = effectiveRadius / Math.tan(fov / 2);
            const distH = effectiveRadius / Math.tan(hFov / 2);
            const neededDistance = Math.max(distV, distH);

            // Preserve viewing direction
            const currentDir = cam.position.clone().sub(controls.target);
            const dirNorm = currentDir.clone().normalize();

            // Target of animation: move target to route center, position along preserved direction at needed distance
            const newTarget = sphere.center.clone();
            const newPos = newTarget.clone().add(dirNorm.multiplyScalar(neededDistance));

            // Only animate if movement or distance change is significant (prevents tiny jiggles)
            const distMove = controls.target.distanceTo(newTarget);
            const distChange = cam.position.distanceTo(newPos);
            const threshold = 5; // world units
            if (distMove > threshold || Math.abs(distChange) > threshold) {
              const anim = animationRef.current;
              anim.isAnimating = true;
              anim.startTime = Date.now();
              anim.duration = 800; // ms smooth transition
              anim.startPos.copy(cam.position);
              anim.startTarget.copy(controls.target);
              anim.endTarget.copy(newTarget);
              anim.endPos.copy(newPos);
            } else {
              // Apply immediately if negligible
              controls.target.copy(newTarget);
              cam.position.copy(newPos);
              cam.updateProjectionMatrix();
              controls.update();
            }
          }
        }
      }
    } catch (e) { /* ignore auto zoom errors */ }

  // Pulse spheres removed; ribbon shader handles directional pulse internally.

    return () => {
      if (routeLinesRef.current) {
        try {
          const old = routeLinesRef.current as any;
            if (old.userData?.routeGeometry) (old.userData.routeGeometry as THREE.BufferGeometry).dispose();
            if (old.userData?.routeMaterial) (old.userData.routeMaterial as THREE.Material).dispose();
          sceneRef.current?.remove(routeLinesRef.current);
        } catch {/* ignore */}
        routeLinesRef.current = null;
      }
      routeSourceRef.current = null;
    };
  }, [routeResult, scoutRouteResult, mapData, getTransformedPosition, accentIsBlue]);

  // Recolor route meshes when the accent changes
  useEffect(() => {
    if (!sceneRef.current || !routeLinesRef.current) return;
    const accentHex = accentIsBlue ? 0x00aaff : 0xff4c26;
    // Update ribbon shader uniform color
    try {
      const group: any = routeLinesRef.current;
      const mat = group?.userData?.routeMaterial;
      if (mat && mat.uniforms?.u_color) mat.uniforms.u_color.value.setHex(accentHex);
    } catch {/* ignore */}
  }, [accentIsBlue]);

  // Final pass to ensure selected star is colored with accent after all other color pipelines.
  useEffect(() => {
    if (!starFieldRef.current || !highlightedSystem) return;
    if (cinematicMode) return; // cinematic palette handles differently
    try {
      const attr = (starFieldRef.current.geometry as THREE.BufferGeometry).attributes.color as THREE.BufferAttribute;
      if (!attr) return;
      const idx = visibleSystemsRef.current.findIndex(s => s.id === highlightedSystem.id);
      if (idx === -1) return;
      const accentHex = accentIsBlue ? 0x00aaff : 0xff4c26;
      new THREE.Color(accentHex).toArray(attr.array as Float32Array, idx * 3);
      attr.needsUpdate = true;
    } catch {/* ignore */}
  }, [highlightedSystem, accentIsBlue, cinematicMode]);

  // Handle camera animation
  useEffect(() => {
    if (!highlightedSystem || !controlsRef.current || !cameraRef.current) return;

    const anim = animationRef.current;
    if (!anim.isAnimating) {
      anim.isAnimating = true;
      anim.startTime = Date.now();
      anim.startPos.copy(cameraRef.current.position);
      anim.startTarget.copy(controlsRef.current.target);

      const newTarget = new THREE.Vector3();
      const transformedPos = getTransformedPosition(highlightedSystem.position);
      newTarget.set(transformedPos.x, transformedPos.y, transformedPos.z);
      anim.endTarget.copy(newTarget);

      const offset = new THREE.Vector3().subVectors(anim.startPos, anim.startTarget);
      anim.endPos.copy(newTarget).add(offset);
    }
  }, [highlightedSystem, getTransformedPosition]);

  // Handle Hover Effect
  useEffect(() => {
    const hoverPoint = hoverPointRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;

    if (hoverPoint && camera && renderer) {
  if (hoveredSystem && !(cinematicModeRef.current && !cinematicLabelsRef.current)) {
        const pos = getTransformedPosition(hoveredSystem.position);
        hoverPoint.position.set(pos.x, pos.y, pos.z);

        // Adaptive sizing for hover ring, based on capped star size
        const MAX_STAR_PIXEL_SIZE = 10; // This is the capped size for stars
        const HOVER_RING_PADDING = 5; // Pixels of padding around the star
        const MIN_HOVER_RING_SIZE = 15; // Original minimum size for the ring

        // Calculate the new ring size, ensuring it's at least MIN_HOVER_RING_SIZE
        // and based on the capped star size plus padding.
        const newRingSize = Math.max(MIN_HOVER_RING_SIZE, MAX_STAR_PIXEL_SIZE + HOVER_RING_PADDING);
        
        (hoverPoint.material as THREE.PointsMaterial).size = newRingSize;
        // Force consistent hover color (orange accent) regardless of underlying overlay mark color
        try {
          const hoverMat = hoverPoint.material as THREE.PointsMaterial;
          // Use orange hex directly for clarity; could derive from accent palette if needed
          hoverMat.color.set('#ff8a2b');
        } catch {/* ignore */}

  hoverPoint.visible = true;
  // Suppress overlay ring for this system to avoid blended color variability
  try { overlayRingsRef.current?.setSuppressedSystem(hoveredSystem.id); } catch {/* ignore */}
    } else {
        hoverPoint.visible = false;
  // Restore overlay rings
  try { overlayRingsRef.current?.setSuppressedSystem(null); } catch {/* ignore */}
      }
    }
  }, [hoveredSystem, getTransformedPosition, pointsMaterial, cinematicLabels]);

  // Handle Pointer Events
  useEffect(() => {
    if (!isLoaded) return;
    const currentRenderer = rendererRef.current;
    if (!currentRenderer) return;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const DRAG_THRESHOLD = 5; // pixels
    const CLICK_TIME_THRESHOLD = 200; // milliseconds


  const onPointerMove = (event: PointerEvent) => {
      // Mark that user has moved mouse; before this we won't show hover
      if(!firstMoveRef.current){ firstMoveRef.current = true; }
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      const currentMousePos = new THREE.Vector2(event.clientX, event.clientY);
      const anyButtonDown = event.buttons !== 0; // any mouse button depressed
      // Detect drag for left, middle, or right buttons
      if (anyButtonDown) {
        if (currentMousePos.distanceTo(mouseDownPosRef.current) > DRAG_THRESHOLD) {
          isDraggingRef.current = true;
        }
      }

      if (!cameraRef.current || !starFieldRef.current || !controlsRef.current) {
        return;
      }

      // Only perform expensive raycast when no buttons are pressed (pure hover)
      // Suppress all hover work during cinematic mode for immersion
  if(cinematicModeRef.current && !cinematicLabelsRef.current){
        // Clear any existing hover state once
        if(hoverPointRef.current) hoverPointRef.current.visible = false;
        if(hoverLabelObj.current){
          hoverLabelObj.current.visible = false;
          if(hoverLabelObj.current.parent){
            hoverLabelObj.current.parent.remove(hoverLabelObj.current);
            if(sceneRef.current && hoverLabelObj.current.parent instanceof THREE.Object3D){ sceneRef.current.remove(hoverLabelObj.current.parent); }
          }
        }
        if(hoveredSystem) setHoveredSystem(null);
        return;
      }

      if (!isDraggingRef.current && !anyButtonDown && firstMoveRef.current) {
        raycaster.setFromCamera(mouse, cameraRef.current);
        // Station icon hover precedence: if hovering a station sprite, show station-specific label (system name + ' Station')
        if(showStations && stationSpriteGroupRef.current){
          const stationHits = raycaster.intersectObjects(stationSpriteGroupRef.current.children, false);
          if(stationHits.length){
            const hit = stationHits[0].object as THREE.Sprite & { userData?: any };
            const sysId = hit.userData?.systemId;
            if(sysId != null && mapData){
              const sys = Object.values(mapData.solar_systems).find(s=> s.id === sysId) || null;
              if(sys){
                // Avoid recreating label unnecessarily
                setHoveredSystem(sys);
                // Build/update label element
                const labelText = sys.name + ' Station';
                if(hoverLabelObj.current === null){
                  const el = createSystemLabelElement(labelText, false, undefined);
                  hoverLabelObj.current = new CSS2DObject(el);
                  hoverLabelObj.current.position.set(0,0,0);
                  hit.add(hoverLabelObj.current);
                } else {
                  if(hoverLabelObj.current.parent){
                    hoverLabelObj.current.parent.remove(hoverLabelObj.current);
                    if(sceneRef.current && hoverLabelObj.current.parent instanceof THREE.Object3D){ sceneRef.current.remove(hoverLabelObj.current.parent); }
                  }
                  // Reuse existing element; override text content directly (skip planets/distance logic)
                  const el = hoverLabelObj.current.element as HTMLElement;
                  const labelDiv = el.querySelector('.system-label');
                  if(labelDiv) labelDiv.textContent = labelText;
                  hit.add(hoverLabelObj.current);
                }
                if(hoverLabelObj.current) hoverLabelObj.current.visible = true;
                // Skip star hover logic when station matched
                return;
              }
            }
          }
        }
  // Dynamic threshold based on camera distance with runtime tuning & optional sub-min scaling
  const cfg = hoverTuningRef.current;
  const distance = cameraRef.current.position.distanceTo(controlsRef.current.target);
  if(cfg.allowBelowMinDistance && distance < cfg.minDistance){
    // Scale linearly (or with exponent) below minDistance down to floorBelowMin * minThreshold
    const factorRaw = distance / cfg.minDistance; // 0..1
    const factor = Math.pow(Math.max(0, Math.min(1, factorRaw)), cfg.curveExp);
    const floorFrac = Math.max(0.01, Math.min(1, cfg.floorBelowMin));
    const below = cfg.minThreshold * Math.max(factor, floorFrac);
    raycaster.params.Points.threshold = below;
  } else {
    const clamped = Math.max(cfg.minDistance, Math.min(cfg.maxDistance, distance));
    const normRaw = (clamped - cfg.minDistance) / (cfg.maxDistance - cfg.minDistance);
    const norm = Math.pow(normRaw, cfg.curveExp);
    const dynamic = cfg.minThreshold + (cfg.maxThreshold - cfg.minThreshold) * norm;
    raycaster.params.Points.threshold = dynamic;
  }
  const intersects = raycaster.intersectObject(starFieldRef.current);

        let newHoveredSystem: SolarSystem | null = null;
        let hitStarObject: THREE.Object3D | null = null;

  if (intersects.length > 0 && intersects[0].index !== undefined) {
          newHoveredSystem = visibleSystemsRef.current[intersects[0].index];
          
          const intersectedPointPosition = new THREE.Vector3();
          const positionAttribute = starFieldRef.current.geometry.attributes.position;
          intersectedPointPosition.fromBufferAttribute(positionAttribute, intersects[0].index);
          hitStarObject = new THREE.Object3D(); // Create a dummy object to parent to
          hitStarObject.position.copy(intersectedPointPosition);
          sceneRef.current?.add(hitStarObject);

          setHoveredSystem(newHoveredSystem);

          const suppressForMenu = contextMenuObjRef.current && contextMenuSystemRef.current && contextMenuSystemRef.current.name === newHoveredSystem.name;
          if (!suppressForMenu) {
            if (hoverLabelObj.current === null) {
              const el = createSystemLabelElement(newHoveredSystem.name, false, newHoveredSystem.planets);
              hoverLabelObj.current = new CSS2DObject(el);
              hoverLabelObj.current.position.set(0, 0, 0); // Position at star's center, offset via CSS transform
              hitStarObject.add(hoverLabelObj.current);
            } else {
              if (hoverLabelObj.current.parent) {
                hoverLabelObj.current.parent.remove(hoverLabelObj.current);
                if (sceneRef.current && hoverLabelObj.current.parent instanceof THREE.Object3D) {
                  sceneRef.current.remove(hoverLabelObj.current.parent);
                }
              }
              hitStarObject.add(hoverLabelObj.current);
              setLabelText(hoverLabelObj.current, newHoveredSystem.name, newHoveredSystem.planets);
              hoverLabelObj.current.position.set(0, 0, 0); // Reset offset
            }
          } else {
            // Hide any existing hover label for this system while menu shown
            if (hoverLabelObj.current) {
              try {
                if (hoverLabelObj.current.parent) {
                  hoverLabelObj.current.parent.remove(hoverLabelObj.current);
                  if (sceneRef.current && hoverLabelObj.current.parent instanceof THREE.Object3D) {
                    sceneRef.current.remove(hoverLabelObj.current.parent);
                  }
                }
                hoverLabelObj.current.visible = false;
              } catch { /* ignore */ }
            }
          }
          
          const labelElement = hoverLabelObj.current ? (hoverLabelObj.current.element as HTMLElement).querySelector('.system-label') : null;
          if (labelElement && hoverLabelObj.current && hoverLabelObj.current.visible) {
            let labelText = newHoveredSystem.name;
            if (isPlanetCountActive) {
              labelText += ` (${newHoveredSystem.planets} planets)`;
            }
        
            if (showDistance && highlightedSystem) {
              const p1 = newHoveredSystem.position;
              const p2 = highlightedSystem.position;
              const distance = Math.sqrt(
                Math.pow(p2.x - p1.x, 2) +
                Math.pow(p2.y - p1.y, 2) +
                Math.pow(p2.z - p1.z, 2)
              );
              labelText += ` | ${distance.toFixed(2)} LY`;
            }
            labelElement.textContent = labelText;
          }

          if(hoverLabelObj.current) hoverLabelObj.current.visible = ! (contextMenuObjRef.current && contextMenuSystemRef.current && contextMenuSystemRef.current.name === newHoveredSystem?.name);

        } else {
          setHoveredSystem(null);
          if (hoverLabelObj.current) {
            hoverLabelObj.current.visible = false;
            if (hoverLabelObj.current.parent) {
              hoverLabelObj.current.parent.remove(hoverLabelObj.current);
              if (sceneRef.current && hoverLabelObj.current.parent instanceof THREE.Object3D) {
                sceneRef.current.remove(hoverLabelObj.current.parent);
              }
            }
          }
        }
      }
      else if (isDraggingRef.current) {
        setHoveredSystem(null); // Clear hover when dragging
        if (hoverLabelObj.current) {
          hoverLabelObj.current.visible = false;
          if (hoverLabelObj.current.parent) {
            hoverLabelObj.current.parent.remove(hoverLabelObj.current);
            if (sceneRef.current && hoverLabelObj.current.parent instanceof THREE.Object3D) {
              sceneRef.current.remove(hoverLabelObj.current.parent);
            }
          }
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      // Track initial position/time for any button to better detect drags (panning/right, middle)
      isDraggingRef.current = false;
      mouseDownPosRef.current.set(event.clientX, event.clientY);
      mouseDownTimeRef.current = Date.now();
    };

  const onPointerUp = (event: PointerEvent) => {
      const timeElapsed = Date.now() - mouseDownTimeRef.current;
      // Handle left click selection only for left button, but ALWAYS reset drag state
      if (event.button === 0) {
        if (!isDraggingRef.current && timeElapsed < CLICK_TIME_THRESHOLD) {
          if (hoveredSystem) {
            selectSystem(hoveredSystem);
          }
        }
      }
      // Reset drag state for any button so hover resumes after right/middle drags
      isDraggingRef.current = false;
    };

    const onPointerLeave = () => {
      // Safety: ensure drag state cleared when pointer leaves canvas (prevents stuck state)
      isDraggingRef.current = false;
    };

    currentRenderer.domElement.addEventListener('pointermove', onPointerMove);
    currentRenderer.domElement.addEventListener('pointerdown', onPointerDown);
  currentRenderer.domElement.addEventListener('pointerup', onPointerUp);
  currentRenderer.domElement.addEventListener('pointerleave', onPointerLeave);
    // Right-click context menu for setting destination
  const onContextMenu = (event: MouseEvent) => {
      if(!hoveredSystem) return; // only active when a star is hovered
      // If a menu for this same system already open, treat second right-click as close
      if(contextMenuObjRef.current && contextMenuSystemRef.current && contextMenuSystemRef.current.name === hoveredSystem.name){
        try {
          if(contextMenuObjRef.current.parent){
            contextMenuObjRef.current.parent.remove(contextMenuObjRef.current);
            if(sceneRef.current && contextMenuObjRef.current.parent instanceof THREE.Object3D){
              sceneRef.current.remove(contextMenuObjRef.current.parent);
            }
          }
        } catch {/* ignore */}
        contextMenuObjRef.current = null; contextMenuSystemRef.current = null;
        event.preventDefault();
        return;
      }
      // If a different system already has an open menu, close it before opening a new one
      if(contextMenuObjRef.current){
        try {
          if(contextMenuObjRef.current.parent){
            contextMenuObjRef.current.parent.remove(contextMenuObjRef.current);
            if(sceneRef.current && contextMenuObjRef.current.parent instanceof THREE.Object3D){
              sceneRef.current.remove(contextMenuObjRef.current.parent);
            }
          }
        } catch {/* ignore */}
        contextMenuObjRef.current = null; contextMenuSystemRef.current = null;
      }
      event.preventDefault();
      // Immediately suppress existing hover label for this system so it doesn't overlap menu
      if(hoverLabelObj.current){
        try {
          if(hoverLabelObj.current.parent){
            hoverLabelObj.current.parent.remove(hoverLabelObj.current);
            if(sceneRef.current && hoverLabelObj.current.parent instanceof THREE.Object3D){
              sceneRef.current.remove(hoverLabelObj.current.parent);
            }
          }
          hoverLabelObj.current.visible = false;
        } catch { /* ignore */ }
      }
      // Remove existing context menu label
      // Additional: raycast station icons first for higher priority
      if (showStations && stationSpriteGroupRef.current && cameraRef.current) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, cameraRef.current as THREE.Camera);
        const hits = raycaster.intersectObjects(stationSpriteGroupRef.current.children, false);
        if (hits.length && mapData) {
          const hit = hits[0].object as THREE.Sprite & { userData?: any };
          const id = hit.userData?.systemId;
          if(id!=null){
            const systems = Object.values(mapData.solar_systems);
            const found = systems.find(s=> s.id === id);
            if(found) setHoveredSystem(found);
          }
        }
      }
      // Build DOM elements (previous patch lost declarations)
      const el = document.createElement('div');
      el.className = 'system-label-wrapper';
      const inner = document.createElement('div');
      inner.className = 'system-label system-label--selected';
      contextMenuSystemRef.current = hoveredSystem;
      // Compose text like hover label
      let labelText = hoveredSystem.name;
      if(isPlanetCountActive){ labelText += ` (${hoveredSystem.planets} planets)`; }
      if(showDistance && highlightedSystem){
        const p1 = hoveredSystem.position; const p2 = highlightedSystem.position;
        const dist = Math.sqrt((p2.x-p1.x)**2 + (p2.y-p1.y)**2 + (p2.z-p1.z)**2);
        labelText += ` | ${dist.toFixed(2)} LY`;
      }
      // First line (label text)
      const titleSpan = document.createElement('div');
      titleSpan.textContent = labelText;
      titleSpan.style.fontWeight = '700';
      inner.appendChild(titleSpan);
      // Options container
      const optionsWrap = document.createElement('div');
      optionsWrap.className = 'context-menu-options';

      // Helper to close menu
      const closeMenu = () => {
        try {
          if(contextMenuObjRef.current && contextMenuObjRef.current.parent){
            contextMenuObjRef.current.parent.remove(contextMenuObjRef.current);
            if(sceneRef.current && contextMenuObjRef.current.parent instanceof THREE.Object3D){
              sceneRef.current.remove(contextMenuObjRef.current.parent);
            }
          }
        } catch {/* ignore */}
        contextMenuObjRef.current = null; contextMenuSystemRef.current = null;
      };

      // Set Destination item
      const destItem = document.createElement('div');
      destItem.className = 'context-menu-item';
      destItem.textContent = 'Set Destination';
      destItem.addEventListener('mousedown', e=> { e.stopPropagation(); e.preventDefault(); });
      destItem.addEventListener('click', e => {
        e.stopPropagation();
        if(contextMenuSystemRef.current){
          // Explicit user action: always override destination with chosen system.
          setLastDestinationSystemName(contextMenuSystemRef.current.name);
          destinationLockedRef.current = true; // lock so future waypoint adds won't shift destination
          // Auto-open routing panel if a start system exists but routing panel is not yet open.
          if(lastSelectedSystemName && !openPanels.has('routing')){
            try { ensurePanel('routing'); } catch { /* ignore */ }
          }
        }
        closeMenu();
      });
      optionsWrap.appendChild(destItem);

      // Add Waypoint item
      const wpItem = document.createElement('div');
      wpItem.className = 'context-menu-item';
      wpItem.textContent = 'Add Waypoint';
      wpItem.addEventListener('mousedown', e=> { e.stopPropagation(); e.preventDefault(); });
      wpItem.addEventListener('click', e => {
        e.stopPropagation();
        if(contextMenuSystemRef.current){
          const name = contextMenuSystemRef.current.name;
          // If system already destination -> ignore
          if(name === lastDestinationSystemName) { closeMenu(); return; }
          // If system already in avoid list -> ignore
            if(avoidSystems.includes(name)) { closeMenu(); return; }
          // Conflict rule (b): adding waypoint removes from avoid if present (handled above) OR if it was destination? we treat destination separately
          addWaypoint(name);
          // Auto-open panel
          // legacy activePanel call removed (multi-panel)
          // If destination not locked and no explicit destination set yet and no destination chosen -> first waypoint becomes destination
          if(!destinationLockedRef.current && !lastDestinationSystemName){
            setLastDestinationSystemName(name);
          }
        }
        closeMenu();
      });
      optionsWrap.appendChild(wpItem);

      // Avoid System item
      const avoidItem = document.createElement('div');
      avoidItem.className = 'context-menu-item';
      avoidItem.textContent = 'Avoid System';
      avoidItem.addEventListener('mousedown', e=> { e.stopPropagation(); e.preventDefault(); });
      avoidItem.addEventListener('click', e => {
        e.stopPropagation();
        if(contextMenuSystemRef.current){
          const name = contextMenuSystemRef.current.name;
          // Cannot avoid current destination or from system or waypoints (we remove from waypoints then add to avoid per rule b)
          if(name === lastSelectedSystemName || name === lastDestinationSystemName){ closeMenu(); return; }
          // If waypoint currently, remove it then add to avoid (rule b)
          if(waypoints.includes(name)){ setWaypoints(prev => prev.filter(w => w !== name)); }
          if(!avoidSystems.includes(name)) addAvoidSystem(name);
          // legacy activePanel call removed (multi-panel)
        }
        closeMenu();
      });
      optionsWrap.appendChild(avoidItem);

      // Add Mark item (User Overlay)
      if(OVERLAY_FEATURE_FLAG){
        const markItem = document.createElement('div');
        markItem.className = 'context-menu-item';
        markItem.textContent = 'Add Mark';
        markItem.addEventListener('mousedown', e=> { e.stopPropagation(); e.preventDefault(); });
        markItem.addEventListener('click', e => {
          e.stopPropagation();
          if(contextMenuSystemRef.current){
            const sys = contextMenuSystemRef.current;
            setAddOverlaySystem({ id: sys.id, name: sys.name });
            setAddOverlayOpen(true);
            setOpenPanels(p=> { const n=new Set(p); n.add('user-overlay'); return n; });
          }
          closeMenu();
        });
        optionsWrap.appendChild(markItem);
      }

      inner.appendChild(optionsWrap);
      el.appendChild(inner);
      const menuObj = new CSS2DObject(el);
      // Hide the selected label while context menu is open to prevent overlap
  if(selectedLabelObj.current) selectedLabelObj.current.visible = false;
  // attach restore handler after element creation below
      contextMenuObjRef.current = menuObj;
      // Anchor the menu to the system's 3D position so it appears adjacent to the star.
      // (Previous regression added the label directly to the scene at (0,0,0) causing it to appear far away.)
      if(sceneRef.current){
        const anchor = new THREE.Object3D();
        const tPos = getTransformedPosition(hoveredSystem.position as any);
        anchor.position.set(tPos.x, tPos.y, tPos.z);
        anchor.add(menuObj);
        sceneRef.current.add(anchor);
        // Screen-space offset (right of star). Compute in world units using camera distance & FOV.
        try {
          const cam = cameraRef.current as THREE.PerspectiveCamera | null;
          const rend = rendererRef.current as THREE.WebGLRenderer | null;
          if(cam && rend){
            const viewportH = rend.domElement.clientHeight || window.innerHeight || 1;
            const dist = cam.position.distanceTo(anchor.position);
            const vFov = THREE.MathUtils.degToRad(cam.fov);
            const worldPerPixelY = (2 * Math.tan(vFov/2) * dist) / viewportH;
            const worldPerPixelX = worldPerPixelY * cam.aspect;
            const pxRight = 8; // tuned gap
            const forward = new THREE.Vector3(); cam.getWorldDirection(forward);
            const upDir = cam.up.clone().normalize();
            const rightDir = new THREE.Vector3().crossVectors(forward, upDir).normalize();
            menuObj.position.addScaledVector(rightDir, worldPerPixelX * pxRight);
          }
        } catch {/* ignore offset errors */}
      }
    };
    currentRenderer.domElement.addEventListener('contextmenu', onContextMenu);
    // Close context menu on left click anywhere outside menu
    const closeOnLeftClick = (ev: MouseEvent) => {
      if(ev.button !== 0) return;
  if(!contextMenuObjRef.current) return;
      const el = contextMenuObjRef.current.element as HTMLElement;
      if(el && !(el as any).__restoreSelectedLabelAttached){
        (el as any).__restoreSelectedLabelAttached = true;
        (el as any).__restoreSelectedLabel = () => {
          // restore selection label visibility when menu closes
          if(selectedLabelObj.current && selectedLabelObj.current.visible === false){
            selectedLabelObj.current.visible = true;
          }
        };
      }
      if(el && ev.target instanceof Node && el.contains(ev.target)) return; // click inside menu
      try {
  if((el as any).__restoreSelectedLabel){ try { (el as any).__restoreSelectedLabel(); } catch {/* ignore */} }
  if(contextMenuObjRef.current.parent){
          contextMenuObjRef.current.parent.remove(contextMenuObjRef.current);
          if(sceneRef.current && contextMenuObjRef.current.parent instanceof THREE.Object3D){
            sceneRef.current.remove(contextMenuObjRef.current.parent);
          }
        }
      } catch {/* ignore */}
  if(el && (el as any).__restoreSelectedLabel){ try { (el as any).__restoreSelectedLabel(); } catch {/* ignore */} }
  contextMenuObjRef.current = null; contextMenuSystemRef.current = null;
    };
    window.addEventListener('mousedown', closeOnLeftClick);
    // Close on Escape for accessibility / stuck states
    const escHandler = (ev: KeyboardEvent) => {
      if(ev.key === 'Escape' && contextMenuObjRef.current){
        try {
          if(contextMenuObjRef.current.parent){
            contextMenuObjRef.current.parent.remove(contextMenuObjRef.current);
            if(sceneRef.current && contextMenuObjRef.current.parent instanceof THREE.Object3D){
              sceneRef.current.remove(contextMenuObjRef.current.parent);
            }
          }
        } catch {/* ignore */}
        contextMenuObjRef.current = null; contextMenuSystemRef.current = null;
      }
    };
    window.addEventListener('keydown', escHandler);

    return () => {
      currentRenderer.domElement.removeEventListener('pointermove', onPointerMove);
      currentRenderer.domElement.removeEventListener('pointerdown', onPointerDown);
  currentRenderer.domElement.removeEventListener('pointerup', onPointerUp);
  currentRenderer.domElement.removeEventListener('pointerleave', onPointerLeave);
  currentRenderer.domElement.removeEventListener('contextmenu', onContextMenu);
  window.removeEventListener('mousedown', closeOnLeftClick);
  window.removeEventListener('keydown', escHandler);
    };
  }, [isLoaded, hoveredSystem, isDraggingRef, mouseDownPosRef, mouseDownTimeRef, createSystemLabelElement, selectSystem, isPlanetCountActive, showDistance, highlightedSystem, cinematicMode, cinematicLabels, openPanels, ensurePanel, lastSelectedSystemName]);

  const handleSearch = (event: React.KeyboardEvent<HTMLInputElement>, systemNameFromSelection?: string) => {
    if (event.key === 'Enter' && mapData) {
      const query = (systemNameFromSelection || searchQuery).toLowerCase().trim();
        const foundSystem = Object.values(mapData.solar_systems).find(
          (system) => system.name.toLowerCase().trim() === query
        );
      if (foundSystem) {
        selectSystem(foundSystem);
  // ensure external selection propagation even if already highlighted
  setLastSelectedSystemName(foundSystem.name);
      } else {
        setHighlightedSystem(null);
        alert('System not found');
      }
    }
  };

  // Unified layout effect: position rail relative to search panel (constant gap) then place drawers/legend beside rail
  useLayoutEffect(()=>{
    if(!isLoaded) return;
    const reflow = () => {
      try {
        const searchPanel = document.querySelector('.ef-search-panel') as HTMLElement | null;
        const railWrapper = document.querySelector('.ef-rail-wrapper') as HTMLElement | null;
        if(!searchPanel || !railWrapper) return;
        const GAP = 10; // constant vertical gap
        const spRect = searchPanel.getBoundingClientRect();
        railWrapper.style.top = (spRect.bottom + GAP) + 'px';
        // Defer drawer alignment to next two animation frames so layout settles after top change
        requestAnimationFrame(()=>{
          requestAnimationFrame(()=>{
            const rail = railWrapper.querySelector('.ef-rail') as HTMLElement | null;
            if(!rail) return;
            const railRect = rail.getBoundingClientRect();
            // Desired left is rail right edge + small gap; fallback to base 140 if rail is very narrow (safety)
            const desiredDrawerLeft = Math.round(railRect.left + railRect.width + 6);
            const drawerTop = Math.round(railRect.top); // align to rail top (should already match base 70 after scaling)
            const drawerIds = ['routing','cinematic','region-stats','region-compare'];
            drawerIds.forEach(id=>{
              const storageKey = 'panel-pos:drawer-'+id;
              if(localStorage.getItem(storageKey)) return; // user customized
              const el = document.querySelector(`.ef-drawer[data-panel-id="${id}"]`) as HTMLElement | null;
              if(el){
                el.style.left = desiredDrawerLeft + 'px';
                const elRect = el.getBoundingClientRect();
                if(Math.abs(elRect.top - drawerTop) > 1){ el.style.top = drawerTop + 'px'; }
              }
            });
            const legendKey = 'panel-pos:planet-legend';
            if(!localStorage.getItem(legendKey)){
              const legend = document.querySelector('.ef-secondary-panel') as HTMLElement | null;
              if(legend){ legend.style.left = desiredDrawerLeft + 'px'; legend.style.top = drawerTop + 'px'; }
            }
          });
        });
      } catch {/* ignore */}
    };
    reflow();
    window.addEventListener('resize', reflow);
    window.addEventListener('ui-scale-change', reflow as any);
    return ()=> { window.removeEventListener('resize', reflow); window.removeEventListener('ui-scale-change', reflow as any); };
  }, [uiScale, openPanels, isPlanetCountActive, isLoaded]);

  if (!isLoaded) {
    return <LoadingScreen progress={loadingProgress} status={loadingStatus} />;
  }

  // Hybrid scaling now driven by CSS var --ui-scale applied to grouped containers.
  // Left cluster: search box + rail + drawers (PanelDrawer/Secondary panels) wrapped in ef-left-cluster.
  // Toolbar: scale applied directly to .ef-top-toolbar root (not inner content) for consistent background sizing.


  return (
    <>
      {/* Region Stats PanelDrawer (managed cascade) */}
      {isRegionHighlighterActive && regionStatsVisible && openPanels.has('region-stats') && (
        <PanelDrawer
          ref={regionStatsDrawerRef}
          id="region-stats"
          title={activeRegionName + (regionStatsLoading && !activeRegionStats ? ' (loading)' : '') + ' Stats'}
          scale={uiScale}
          zIndex={panelZ['region-stats']||1450}
          onActivate={bringToFront}
          onClose={(id)=> { setOpenPanels(p=> { const n=new Set(p); n.delete(id); return n; }); setRegionStatsVisible(false); }}
          resetToken={layoutResetToken}
        >
          <RegionStatsCard regionName={activeRegionName} stats={regionStatsLoading && !activeRegionStats ? null : activeRegionStats} />
        </PanelDrawer>
      )}
  {openPanels.has('region-compare') && (
        <PanelDrawer
          ref={regionCompareDrawerRef}
          id="region-compare"
          title={'Compare Regions'}
          scale={uiScale}
          zIndex={panelZ['region-compare']||1450}
          onActivate={bringToFront}
          onClose={(id)=> { setOpenPanels(p=> { const n=new Set(p); n.delete(id); return n; }); }}
          resetToken={layoutResetToken}
          resizable
          initialSize={{ width: 900, height: 520 }}
          minSize={{ width: 640, height: 320 }}
        >
          <CompareRegionsPanel
            regions={Object.values(mapData?.regions||{}).map(r=> ({ id:r.id, name:r.name, stats: regionCompareStats[r.id]||null }))}
            loading={regionCompareLoading}
            onRequestStats={()=>{
              if(!mapData) return; setRegionCompareLoading(true);
              // Build systems + gates lists across all regions and call worker once (leveraging existing region stats worker multiple times not yet batched)
              try {
                const systems:any[]=[]; const gates:any[]=[];
                // Build degree map once
                const deg = new Map<number, number>();
                for (const gKey in mapData.stargates){ const g=(mapData.stargates as any)[gKey]; const a=g.source_system_id, b=g.destination_system_id; if(a==null||b==null) continue; deg.set(a,(deg.get(a)||0)+1); deg.set(b,(deg.get(b)||0)+1); }
                const stationSet = stationSystemIdSetRef.current;
                for (const key in mapData.solar_systems){ const s=(mapData.solar_systems as any)[key]; systems.push({ id:s.id, region_id:s.region_id, x:s.position.x, y:s.position.y, z:s.position.z, deg:deg.get(s.id)||0, planets:s.planets, has_station: stationSet? stationSet.has(s.id):false }); }
                for (const gKey in mapData.stargates){ const g=(mapData.stargates as any)[gKey]; const a=g.source_system_id, b=g.destination_system_id; const sa=(mapData.solar_systems as any)[String(a)]; const sb=(mapData.solar_systems as any)[String(b)]; if(sa&&sb){ const dx=sa.position.x-sb.position.x; const dy=sa.position.y-sb.position.y; const dz=sa.position.z-sb.position.z; const len=Math.sqrt(dx*dx+dy*dy+dz*dz); gates.push({ a:sa.id,b:sb.id,len }); }
                }
                if(regionStatsWorkerRef.current){
                  regionStatsWorkerRef.current.postMessage({ type:'compute', systems, gates });
                  // Temporarily intercept worker result to split into compare cache then restore region stats flow
                  const origHandler = regionStatsWorkerRef.current.onmessage;
                  regionStatsWorkerRef.current.onmessage = (e:any)=>{
                    try {
                      const data = e.data; if(data?.type==='result'){ const regions:Record<number,RegionStats> = data.regions||{}; const agg:Record<number,RegionStats|null>={}; Object.entries(regions).forEach(([rid,st])=> agg[Number(rid)]=st as RegionStats); setRegionCompareStats(agg); }
                    } finally {
                      setRegionCompareLoading(false);
                      // Forward to original handler to not break single-region logic
                      if(origHandler) { try { (origHandler as any)(e); } catch {/* swallow */} }
                      // Restore original
                      regionStatsWorkerRef.current && (regionStatsWorkerRef.current.onmessage = origHandler);
                    }
                  };
                } else {
                  // inline fallback using existing helper per region (inefficient)
                  const byRegion:Record<number,RegionStats|null>={};
                  // Map region id -> systems
                  const regionSystemsMap = new Map<number, any[]>();
                  systems.forEach(s=> { if(!regionSystemsMap.has(s.region_id)) regionSystemsMap.set(s.region_id, []); regionSystemsMap.get(s.region_id)!.push(s); });
                  regionSystemsMap.forEach((sysList, rid)=>{
                    const localGates = gates.filter(g=> sysList.some((s:any)=> s.id===g.a) && sysList.some((s:any)=> s.id===g.b));
                    try { const stats = (computeRegionStatsInline as any)(sysList, localGates); byRegion[rid]=stats; } catch { byRegion[rid]=null; }
                  });
                  setRegionCompareStats(byRegion); setRegionCompareLoading(false);
                }
              } catch { setRegionCompareLoading(false); }
            }}
            onSelectRegion={(rid)=>{
              // Select a representative system in the chosen region and activate region highlight.
              if(!mapData) return;
              const ridNum = Number(rid);
              // Try to keep currently highlighted system if already in target region (just re-run highlighter)
              if(highlightedSystem && Number(highlightedSystem.region_id) === ridNum){
                if(!isRegionHighlighterActive) setIsRegionHighlighterActive(true);
                ensurePanel('region-stats');
                bringToFront('region-stats');
                return;
              }
              // Use prebuilt region->systems index for fast selection
              let candidate:any = null;
              if(regionSystemsIndexRef.current){
                const list = regionSystemsIndexRef.current.get(ridNum);
                if(list && list.length){
                  // Pick system with max planets else first.
                  candidate = list.reduce((best:any, cur:any)=>{
                    const bp = best? (best.planets||0):-1; const cp = cur.planets||0; return cp>bp? cur: best;
                  }, null as any) || list[0];
                }
              }
              if(candidate){
                // selecting system for region
                selectSystem(candidate as any);
                if(!isRegionHighlighterActive) setIsRegionHighlighterActive(true);
                setOpenPanelOrder(o=> o.includes('region-stats')? o : [...o, 'region-stats']);
                ensurePanel('region-stats');
                bringToFront('region-stats');
              } else {
                // failed to find system for region (index miss)
              }
            }}
          />
        </PanelDrawer>
      )}
      {OVERLAY_FEATURE_FLAG && openPanels.has('user-overlay') && (
        <PanelDrawer
          ref={userOverlayDrawerRef}
          id="user-overlay"
          title={'User Overlay (Marks)'}
          scale={uiScale}
          zIndex={panelZ['user-overlay']||1450}
          onActivate={bringToFront}
          onClose={(id)=> { setOpenPanels(p=> { const n=new Set(p); n.delete(id); return n; }); }}
          resetToken={layoutResetToken}
          resizable
          initialSize={{ width: 780, height: 480 }}
          minSize={{ width: 520, height: 320 }}
        >
          <UserOverlayPanel
            selectedSystem={highlightedSystem ? { id: highlightedSystem.id, name: highlightedSystem.name } : null}
            onAddMark={(systemName, systemId) => {
              setAddOverlaySystem({ id: systemId, name: systemName });
              setAddOverlayOpen(true);
            }}
            onSoftHover={(name)=>{
              if(!mapData){ return; }
              if(!name){ setHoveredSystem(null); return; }
              // Do not change highlighted selection; only adjust hover label
              const sys = Object.values(mapData.solar_systems).find(s=> s.name===name);
              if(sys){ setHoveredSystem(sys as any); }
            }}
            onSetDestination={(name)=>{
              // Reuse existing destination logic (similar to context menu action)
              setLastDestinationSystemName(name);
              destinationLockedRef.current = true;
              // Auto-open routing panel if start system already chosen
              if(lastSelectedSystemName && !openPanels.has('routing')){ try { ensurePanel('routing'); bringToFront('routing'); } catch {/* ignore */} }
              try { track({ type:'route_set_destination_panel' }); } catch {}
            }}
            onAddWaypoint={(name)=>{
              setWaypoints(prev=> prev.includes(name)? prev : (prev.length<10 ? [...prev, name]: prev));
              try { track({ type:'route_add_waypoint_panel' }); } catch {}
            }}
            onAvoidSystem={(name)=>{
              setAvoidSystems(prev=> prev.includes(name)? prev : [...prev, name]);
              try { track({ type:'route_add_avoid_panel' }); } catch {}
            }}
            onSelectSystem={(name)=>{
              if(!mapData) return;
              const sys = Object.values(mapData.solar_systems).find(s=> s.name === name);
              if(!sys) return;
              selectSystem(sys as any);
              setLastSelectedSystemName(sys.name);
              // If a destination is already set and routing panel closed, open it to hint at route capability
              if(lastDestinationSystemName && !openPanels.has('routing')){ try { ensurePanel('routing'); bringToFront('routing'); } catch {/* ignore */} }
            }}
          />
          <div style={{marginTop:8, display:'flex', gap:8}}>
            {/* Legacy inline Add Mark button and quick add hint removed; Shift+RightClick still functions without UI hint. */}
          </div>
        </PanelDrawer>
      )}
      {addOverlayOpen && addOverlaySystem && (
        <AddOverlayMarkModal
          open={addOverlayOpen}
          systemId={addOverlaySystem.id}
          systemName={addOverlaySystem.name}
          onClose={()=> { setAddOverlayOpen(false); setAddOverlaySystem(null); }}
        />
      )}
  <DonateCryptoModal open={cryptoModalOpen} onClose={()=> setCryptoModalOpen(false)} address="0xC1204805b018ec2Ad06e6119965134AfFa212C10" ensName="lacal.eth" />
  {/* Referral code copy state */}
  {/* ...existing code... */}
  <div className="ef-top-toolbar" style={hideUI?{display:'none'}:{}}>
    <div className="ef-top-toolbar-inner" style={{display:'flex', alignItems:'stretch', gap:8}}>
      <div className="ef-toolbar-shifting" style={{display:'flex', alignItems:'stretch', gap:8}}>
        {/* Support button placed at start so it shifts left (along with Share + Referral) when Help panel opens. */}
        <button
          className="ef-support-btn"
          onClick={()=> setSupportExpandRequestId(id=> id+1)}
          aria-label="Support this project (opens Help panel to Support section)"
        >Support this project</button>
        <button
          className="share-route-btn"
          onClick={async () => {
          if(shareFeedback==='Saving...') return;
          const path = scoutRouteResult?.path || routeResult?.path;
          if(!path || path.length < 2){ setShareFeedback('No route'); setTimeout(()=>setShareFeedback(''),1500); return; }
          let encoded: string | null = null;
          if(scoutRouteResult?.path){
            try {
              encoded = encodeShare({ type:'s', start:path[0], returnToStart, path });
            } catch { /* ignore */ }
          } else if(routeResult?.path){
            try {
              const p=(lastP2PParamsRef as any).current||{jump:60,optimize:'fuel',algo:'astar'};
              encoded = encodeShare({ type:'p', from:path[0], to:path[path.length-1], jump:p.jump, optimize:p.optimize, algo:p.algo, path });
            } catch { /* ignore */ }
          }
          if(!encoded){ setShareFeedback('Error'); setTimeout(()=>setShareFeedback(''),1500); return; }
          try {
            setShareFeedback('Saving...');
            const id = await createShortShare(encoded);
            try { track({ type:'share_created' }); } catch {}
            const shortUrl = window.location.origin + window.location.pathname + window.location.search + '#s=' + id;
            await navigator.clipboard.writeText(shortUrl);
            setShareFeedback('Copied');
          } catch {
            try {
              const full = window.location.origin + window.location.pathname + window.location.search + '#' + encoded;
              await navigator.clipboard.writeText(full);
              setShareFeedback('Copied full');
            } catch {
              setShareFeedback('Copy failed');
            }
          }
          setTimeout(()=> setShareFeedback(''),2000);
        }}
        disabled={!(routeResult?.path || scoutRouteResult?.path)}
        aria-label="Share current route"
      >
        Share Route
        {shareFeedback && <span className="share-feedback">{shareFeedback}</span>}
        </button>
        <ReferralBadge />
      </div>
      {/* HelpPanel (toggle + sliding panel) kept outside shifting group so only three buttons move left */}
      <HelpPanel accentIsBlue={accentIsBlue} supportExpandRequestId={supportExpandRequestId} supportContent={supportContent} />
    </div>
  </div>
  {/* Search panel (separate bounding box) */}
  <div className="ef-left-cluster ef-search-panel" style={hideUI?{display:'none'}:{ position: 'absolute', top: 10, left: 10, zIndex: 1405, color: 'white', padding: '10px 12px 12px', borderRadius: '14px', border:'1px solid rgba(255,255,255,0.22)', background: 'linear-gradient(180deg, rgba(30,30,32,0.78) 0%, rgba(18,18,20,0.78) 55%, rgba(12,12,14,0.78) 100%)', backdropFilter:'blur(9px) saturate(140%)', boxShadow:'0 6px 24px -6px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05) inset' }}>
        <div style={{ display:'flex', alignItems:'stretch', gap:'6px', minWidth:340 }}>
          <div style={{ flex:1 }}>
            <AutoCompleteInput
              placeholder="Search for a system..."
              value={searchQuery}
              onChange={setSearchQuery}
              onSelect={(selected) => {
                setSearchQuery(selected);
                handleSearch({ key: 'Enter' } as React.KeyboardEvent<HTMLInputElement>, selected);
              }}
              dataSource={mapData ? Object.values(mapData.solar_systems).map(s => s.name) : []}
            />
          </div>
          <button
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              padding: '6px 12px',
              fontSize: '13px',
              lineHeight: '1.3',
              fontWeight: 600,
              cursor: 'pointer',
              borderRadius: '6px',
              alignSelf:'stretch',
              display:'flex',
              alignItems:'center',
              boxShadow:'0 2px 6px rgba(0,0,0,0.45)'
            }}
            onClick={()=>{
              // Soft reset: clear inputs & routes but KEEP panel positions
              softReset(); // resets prefs (jump distance etc.) but not panel-pos:* keys
              setRouteResult(null);
              setScoutRouteResult(null);
              setScoutInvalidateToken(t=> t+1);
              if(window.location.hash){ try { history.replaceState(null,'', window.location.pathname + window.location.search); } catch {/* ignore */} }
              setSearchQuery('');
              setWaypoints([]);
              setAvoidSystems([]);
              setWaypointOptimize(false);
              setResetToken(t=> t+1); // signal input-bearing panels to clear their internal state
            }}
            aria-label="Reset all inputs"
          >Reset</button>
        </div>
        {/* Rail now separate panel below (not inside this search panel) */}
  {/* ...existing controls... (accent toggle removed from here) */}
  {/* Planet legend relocated to floating overlay to avoid being obscured by rail */}
      </div>
      {/* Feature rail bounding box */}
      {!hideUI && (
        <div className="ef-rail-wrapper" style={{ position:'absolute', top: 82, left:10, zIndex:1405, transform:`scale(${uiScale})`, transformOrigin:'top left' }}>
          <PanelRail
            items={[
              { id:'routing', type:'panel', label:'Routing', display:(<>{'Routing'}</>), icon:null, active:openPanels.has('routing'), onSelect:()=> togglePanel('routing') },
              { id:'cinematic', type:'panel', label:'Cinematic Mode', display:(<>Cinematic<br/>Mode</>), icon:null, active:openPanels.has('cinematic'), onSelect:()=> { if(openPanels.has('cinematic')) { setCinematicMode(false); } else { setCinematicMode(true); } togglePanel('cinematic'); } },
              { id:'region', type:'toggle', label:'Highlight Region', display:(<>Highlight<br/>Region</>), icon:null, active:isRegionHighlighterActive, onToggle:()=> setIsRegionHighlighterActive(v=> !v) },
              { id:'planets', type:'toggle', label:'Display Planet Counts', display:(<>Planet<br/>Counts</>), icon:null, active:isPlanetCountActive, onToggle:()=> setIsPlanetCountActive(v=> !v) },
              { id:'stations', type:'toggle', label:'Show Stations', display:(<>Show<br/>Stations</>), icon:null, active:showStations, onToggle:()=> setShowStations(v=> { const next=!v; try { persistShowStations(next); } catch {}; try { if(next) track({ type:'show_stations' }); } catch {}; return next; }) },
              { id:'distance', type:'toggle', label:'Show Distance', display:(<>Show<br/>Distance</>), icon:null, active:showDistance, onToggle:()=> setShowDistance(v=> !v) },
              { id:'region-compare', type:'panel', label:'Compare Regions', display:(<>Compare<br/>Regions</>), icon:null, active:openPanels.has('region-compare'), onSelect:()=> togglePanel('region-compare') },
              { id:'user-overlay', type:'panel', label:'User Overlay', display:(<>User<br/>Overlay</>), icon:null, active:openPanels.has('user-overlay'), onSelect:()=> togglePanel('user-overlay') },
              // onSelect emits compare_regions_open event in togglePanel extension below
              { id:'reset-layout', type:'panel', label:'Reset Layout', display:(<>Reset<br/>Layout</>), icon:null, active:false, onSelect:()=> { if(window.confirm('Reset panel positions and layout?')) { fullReset(); setOpenPanels(new Set()); setAccentIsBlue(false); setResetToken(t=> t+1); setLayoutResetToken(t=> t+1); } } },
            ] as any}
          />
        </div>
      )}
      {!hideUI && (
        <>
          {openPanels.has('routing') && (
            <PanelDrawer ref={routingDrawerRef} id="routing" title="Routing" scale={uiScale} zIndex={panelZ['routing']||1450} onActivate={bringToFront} onClose={(id)=> setOpenPanels(p=> { const n=new Set(p); n.delete(id); return n; })} resetToken={layoutResetToken}>
              <RoutingPanel
                onCalculateRoute={calculateRoute}
                onStopCalculation={stopCalculation}
                isCalculating={isCalculatingRoute}
                routeResult={routeResult}
                mapData={mapData}
                systemNames={mapData ? Object.values(mapData.solar_systems).map(s => s.name) : []}
                progress={routeProgress}
                routeCalcTimeMs={routeCalcTimeMs}
                resetToken={resetToken}
                selectedSystemName={lastSelectedSystemName}
                selectedDestinationSystemName={lastDestinationSystemName}
                waypoints={waypoints}
                avoidSystems={avoidSystems}
                onRemoveWaypoint={removeWaypoint}
                onRemoveAvoidSystem={removeAvoidSystem}
                waypointOptimize={waypointOptimize}
                onWaypointOptimizeChange={setWaypointOptimize}
                returnToStart={returnToStart}
                onReturnToStartChange={setReturnToStart}
                scoutInvalidateToken={scoutInvalidateToken}
                importedScoutPath={scoutRouteResult?.path || null}
                scoutResetToken={resetToken}
                onBaselineRoute={(path)=>{ 
                  setScoutRouteResult({ path }); 
                  if(window.location.hash){ try { history.replaceState(null,'', window.location.pathname + window.location.search); } catch { /* ignore */ } }
                  if(mapData && path.length){
                    const first = Object.values(mapData.solar_systems).find(s=> s.name.toLowerCase()===path[0].toLowerCase());
                    if(first){ selectSystem(first); }
                  }
                }}
                onOptimizedRoute={(path)=>{ 
                  setScoutRouteResult({ path }); 
                  if(window.location.hash){ try { history.replaceState(null,'', window.location.pathname + window.location.search); } catch { /* ignore */ } }
                  if(mapData && path.length){
                    const first = Object.values(mapData.solar_systems).find(s=> s.name.toLowerCase()===path[0].toLowerCase());
                    if(first){ selectSystem(first); }
                  }
                }}
                onScoutClearRoute={()=> setScoutRouteResult(null)}
        initialJumpDistance={persistedJump}
        initialOptimizeFor={persistedOptimize}
        initialAlgorithm={persistedAlgo}
        onRoutingParamChange={(jump,opt,algo)=> { setRoutingPrefs(jump,opt,algo); lastP2PParamsRef.current.jump=jump; lastP2PParamsRef.current.optimize=opt; lastP2PParamsRef.current.algo=algo; setPersistedJump(jump); setPersistedOptimize(opt); setPersistedAlgo(algo); }}
        planetBinsActive={planetBinsActive}
        minPlanets={minPlanets}
        maxPlanets={maxPlanets}
        reachabilityProps={{
          originSystemName: highlightedSystem?.name || lastSelectedSystemName,
          range: reachRange,
          auto: reachAuto,
          dim: reachDim,
          bubble: reachBubble,
          inRange: reachInRangeHighlight,
          stats: reachStats,
          disabled: (isRegionHighlighterActive || isPlanetCountActive) && !(reachInRangeHighlight && reachBubble) ? 'Color mode active' : null,
          computing: reachComputing,
          onCompute: handleReachCompute,
          onRangeChange: handleReachRangeChange,
          onOriginChange: handleReachOriginChange,
          onAutoChange: handleReachAutoChange,
          onDimChange: handleReachDimChange,
          onBubbleChange: handleReachBubbleChange,
          onInRangeChange: handleReachInRangeChange
        }}
              />
            </PanelDrawer>
          )}
          {openPanels.has('cinematic') && (
            <PanelDrawer ref={cinematicDrawerRef} id="cinematic" title="Cinematic Mode" scale={uiScale} zIndex={panelZ['cinematic']||1450} onActivate={bringToFront} onClose={(id)=> { setOpenPanels(p=> { const n=new Set(p); n.delete(id); return n; }); setCinematicMode(false); }} resetToken={layoutResetToken}>
              <CinematicPanel
                starColorMode={starColorMode}
                setStarColorMode={setStarColorMode as any}
                bloomStrength={bloomStrength}
                bloomStrengthDraft={bloomStrengthDraft}
                setBloomStrengthDraft={setBloomStrengthDraft}
                setBloomStrength={setBloomStrength}
                aberrationAmt={aberrationAmt}
                setAberrationAmt={setAberrationAmt}
                hazeColor={hazeColor}
                setHazeColor={setHazeColor}
                hazeIntensity={hazeIntensity}
                setHazeIntensity={setHazeIntensity}
                hazeRadius={hazeRadius}
                hazeRadiusDraft={hazeRadiusDraft}
                setHazeRadiusDraft={setHazeRadiusDraft}
                setHazeRadius={setHazeRadius}
                showAurora={showAurora}
                setShowAurora={setShowAurora}
                bgIntensity={bgIntensity}
                setBgIntensity={setBgIntensity}
                auroraIntensity={auroraIntensity}
                setAuroraIntensity={setAuroraIntensity}
                autoCamPaused={autoCamPaused}
                setAutoCamPaused={setAutoCamPaused}
                cinematicLabels={cinematicLabels}
                setCinematicLabels={setCinematicLabels}
                autoClusterTour={autoClusterTour}
                setAutoClusterTour={setAutoClusterTour}
              />
            </PanelDrawer>
          )}
          {/* Floating planet legend (appears when planet coloring active). Separate from drawer so toggle works independently. */}
          {isPlanetCountActive && (
            <PlanetLegendPanel
              scale={uiScale}
              anchoredBelowDrawer={openPanels.size>0}
              zIndex={panelZ['planetLegend']||1425}
              onActivate={()=> bringToFront('planetLegend')}
              onClose={()=> setIsPlanetCountActive(false)}
              resetToken={layoutResetToken}
            >
              {generatePlanetCountLegend()}
            </PlanetLegendPanel>
          )}
          {/* StationsPanel removed: feature rail toggle directly controls icon sprites without extra popup */}
        </>
      )}
      {/* Persistent quick controls (never hidden so user can un-hide UI; not scaled for pointer stability) */}
      <div style={{ position: 'fixed', left: 10, bottom: 10, zIndex: 2000 }}>
        <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap' }}>
          <label style={{ color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', padding: '6px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked={accentIsBlue} onChange={(e) => setAccentIsBlue(e.target.checked)} />
            <span style={{ fontSize: '12px' }}>Use blue accent</span>
          </label>
          <label style={{ color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', padding: '6px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked={hideUI} onChange={(e)=> setHideUI(e.target.checked)} />
            <span style={{ fontSize: '12px' }}>Hide UI</span>
          </label>
          <div style={{ color:'white', backgroundColor:'rgba(0,0,0,0.5)', padding:'6px 10px', borderRadius:'6px', display:'flex', alignItems:'center', gap:'6px' }}>
            <span style={{ fontSize:'12px' }}>UI Scale</span>
            <input
              type="range"
              min={0}
              max={uiScaleStops.length-1}
              step={1}
              value={uiScaleStops.indexOf(uiScale)}
              onChange={(e)=>{ const idx=parseInt(e.target.value); setUiScale(uiScaleStops[idx]||1); }}
              style={{ cursor:'pointer', width:'110px' }}
              aria-label="Adjust UI scale (50/75/100/125%)"
            />
            <span style={{ fontSize:'12px', minWidth:'46px', textAlign:'right' }}>{Math.round(uiScale*100)}%</span>
          </div>
        </div>
      </div>
  <div ref={mountRef} style={{ width: '100vw', height: '100vh' }} />
  <div className="ef-vignette" />
  {/* Small persistent logo and referral code */}
  {/* Persistent logo (always visible even when UI hidden) */}
  <img src={logo} alt="EF Map" className="ef-small-logo" />
    </>
  );
}

export default App;

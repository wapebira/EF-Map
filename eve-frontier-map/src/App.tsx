import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import './App.css';
import RegionHighlighterModule, { setRegionHighlightColors } from './modules/RegionHighlighter';
import logo from './assets/logo/logo.png';
import { openDbFromArrayBuffer } from "./lib/sql";
import type { SystemRow, StargateRow, RegionRow, ConstellationRow } from "./types/db";
import LoadingScreen from './components/LoadingScreen';
import P2PRouting from './components/P2PRouting/P2PRouting';
import ScoutOptimizer from './components/ScoutOptimizer/ScoutOptimizer';
import AutoCompleteInput from './components/AutoCompleteInput/AutoCompleteInput';
import HelpPanel from './components/HelpPanel/HelpPanel';
import { encodeShare, decodeShare } from './utils/share';
import { createShortShare, fetchShortShare } from './utils/shortShare';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Small referral badge component with copy-to-clipboard
const ReferralBadge: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const code = 'n7GEWunG';
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(()=>{
      setCopied(true);
      setTimeout(()=> setCopied(false), 1600);
    }).catch(()=>{/* ignore */});
  };
  return (
    <div className="ef-referral" aria-label="Referral code">
      <span>Referral code:</span>
      <span className="ef-referral-code">{code}</span>
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
const SELECTED_STAR_COLOR = new THREE.Color(0x00aaff); // Blue for selected star when DPC is off
const REGION_OUTLINE_COLOR = new THREE.Color(0x00aaff); // Shared blue for region outlines

function App() {
  // Default to orange accent; the toggle will flip to blue
  const [accentIsBlue, setAccentIsBlue] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  const [isLoaded, setIsLoaded] = useState(false);

  const mountRef = useRef<HTMLDivElement>(null);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [resetToken, setResetToken] = useState(0); // increments to signal UI reset
  const [highlightedSystem, setHighlightedSystem] = useState<SolarSystem | null>(null);
  const [hoveredSystem, setHoveredSystem] = useState<SolarSystem | null>(null);
  const [isRegionHighlighterActive, setIsRegionHighlighterActive] = useState(false);
  const [isPlanetCountActive, setIsPlanetCountActive] = useState(false);
  // Five legend bins (dynamic ranges) active flags; default all true when DPC enabled
  const [planetBinsActive, setPlanetBinsActive] = useState<boolean[]>([true, true, true, true, true]);
  const [showDistance, setShowDistance] = useState(false);
  const [minPlanets, setMinPlanets] = useState(0);
  const [maxPlanets, setMaxPlanets] = useState(0);
  // Cinematic mode + locked parameters (UI removed)
  const [cinematicMode, setCinematicMode] = useState(false);
  const bloomStrength = 0.8;
  const dustAmount = 0.6; // 0..1
  const cinExposure = 1.0;
  const bgIntensity = 0.3;
  const starColorStrength = 0.85; // rollback to earlier value
  const vignette = 0.85;
  const grain = 0.35;
  const aberration = 0.002;
  const radialGlow = 0.15;
  const bloomPulseEnabled = true;
  const bloomPulseAmp = 0.05;
  const cameraDriftEnabled = true;
  const shootingStarsEnabled = true;
  const hueDriftEnabled = true; // rollback
  const secondDustEnabled = true;

  // State for P2P Routing
  const routingWorkerRef = useRef<Worker | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [routeResult, setRouteResult] = useState<{ path: string[] | null; error?: string } | null>(null);
  const [scoutRouteResult, setScoutRouteResult] = useState<{ path: string[] | null } | null>(null);
  const [scoutInvalidateToken, setScoutInvalidateToken] = useState(0);
  const [routeProgress, setRouteProgress] = useState<{ explored: number; frontier: number; elapsedMs: number; message: string } | null>(null);
  const [shareFeedback, setShareFeedback] = useState('');
  const lastP2PParamsRef = useRef<{ jump:number; optimize:'fuel'|'jumps'; algo:'astar'|'dijkstra'; from?:string; to?:string }>({ jump:60, optimize:'fuel', algo:'astar' });

  // New state for labels
  const hoverLabelObj = useRef<CSS2DObject | null>(null);
  const selectedLabelObj = useRef<CSS2DObject | null>(null);

  // Refs for three.js objects
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const starFieldRef = useRef<THREE.Points | null>(null);
  const hoverPointRef = useRef<THREE.Points | null>(null);
  const stargateLinesRef = useRef<THREE.LineSegments | null>(null);
  const routeLinesRef = useRef<THREE.Group | null>(null); // New ref for route lines
  const cinematicModeRef = useRef(false);
  useEffect(()=>{ cinematicModeRef.current = cinematicMode; }, [cinematicMode]);
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

  // Updaters that run each frame (used for route pulse animations)
  const routeAnimUpdatersRef = useRef<Array<() => void>>([]);
  // Dynamic route thickness scaling refs (for pulse sphere sync with pixel cap)
  const routeBaseRadiusRef = useRef<number>(0.375); // default base tube radius
  const routeCurrentRadiusRef = useRef<number>(0.375);
  const routeRadiusScaleRef = useRef<number>(1); // currentRadius / baseRadius

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

  const circleTexture = useMemo(() => createCircleTexture(), []);
  const ringTexture = useMemo(() => createRingTexture(), []);

  const pointsMaterial = useMemo(() => {
    const material = new THREE.PointsMaterial({
      size: 2,
      sizeAttenuation: true,
      map: circleTexture,
      transparent: true,
      alphaTest: 0.5,
      vertexColors: true,
    });

    material.onBeforeCompile = (shader) => {
      // Add a uniform for the maximum point size in pixels
      shader.uniforms.maxPointSize = { value: 10.0 };

      // Inject the uniform declaration into the shader
      shader.vertexShader = `
            uniform float maxPointSize;
            ${shader.vertexShader}
        `;

      // Replace the line where gl_PointSize is set to cap it
      shader.vertexShader = shader.vertexShader.replace(
        '#include <logdepthbuf_vertex>',
        `
            gl_PointSize = min(gl_PointSize, maxPointSize); // Cap to max pixel size
            #include <logdepthbuf_vertex>
            `
      );
    };
    return material;
  }, [circleTexture]);

  const stargateMaterial = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false }), []);

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
    // Tag root for CSS theme-specific rules
    root.setAttribute('data-accent', accentIsBlue ? 'blue' : 'orange');
    if (!accentIsBlue) {
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
    // Set the highlighted system for camera animation and the main rendering effect
    setHighlightedSystem(system);

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

  }, [createSystemLabelElement, setLabelText, getTransformedPosition]);

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
        const { path, error } = data;
        setIsCalculatingRoute(false);
        // compute and store elapsed time if we started one
        if (routeCalcStartRef.current) {
          const elapsed = Date.now() - routeCalcStartRef.current;
          setRouteCalcTimeMs(elapsed);
          routeCalcStartRef.current = null;
        }
        setRouteProgress(null);
        if (error) {
          alert(`Routing Error: ${error}`);
          setRouteResult({ path: null, error });
          return;
        }
  setRouteResult({ path, error: undefined });
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

  // Panel open states (mutually exclusive upcoming with Scout Optimizer)
  const [p2pOpen, setP2POpen] = useState(false);
  const [_scoutOpen, _setScoutOpen] = useState(false); // placeholder for future Scout panel
  const [scoutOpen, setScoutOpenReal] = useState(false);
  const [returnToStart, setReturnToStart] = useState(false);
  // One-time hash import ref
  const initialHashAppliedRef = useRef(false);

  const toggleP2P = (open: boolean) => {
    setP2POpen(open);
    if (open) { setScoutOpenReal(false); }
  };
  const toggleScout = (open: boolean) => {
    setScoutOpenReal(open);
    if (open) { setP2POpen(false); }
  };

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
        setP2POpen(true); setScoutOpenReal(false);
      } else if(share.type==='s') {
        setReturnToStart(share.returnToStart);
        setScoutRouteResult({ path: share.path });
        setScoutOpenReal(true); setP2POpen(false);
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
    }
  }, [isLoaded, mapData, selectSystem]);

  // Stop / cancel the current calculation: terminate worker and recreate a fresh one
  const stopCalculation = useCallback(() => {
    if (routingWorkerRef.current) {
      try {
        routingWorkerRef.current.terminate();
      } catch (e) {
        // ignore
      }
      routingWorkerRef.current = null;
    }
    setIsCalculatingRoute(false);
    setRouteProgress(null);
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
      const { path, error } = data;
      setIsCalculatingRoute(false);
      if (routeCalcStartRef.current) {
        const elapsed = Date.now() - routeCalcStartRef.current;
        setRouteCalcTimeMs(elapsed);
        routeCalcStartRef.current = null;
      }
      setRouteProgress(null);
      if (error) {
        alert(`Routing Error: ${error}`);
        setRouteResult({ path: null, error });
        return;
      }
  setRouteResult({ path, error: undefined });
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
    // Track last P2P params for share link updates
    try { (lastP2PParamsRef as any).current = { jump:maxJumpDistance, optimize:optimizeFor, algo:algorithm, from:fromSystemName, to:toSystemName }; } catch(e) { /* ignore */ }
    if (!mapData) {
      alert('Map data is not loaded yet.');
      return;
    }

    // If a scout route was displayed, clear it so P2P route takes visual precedence
    if (scoutRouteResult) {
      setScoutRouteResult(null);
      setScoutInvalidateToken(t=> t+1); // force scout component to clear internal workers/state
    }
    // Always clear any currently drawn route lines before drawing new P2P route
    clearCurrentRoute();

    setIsCalculatingRoute(true);
    setRouteResult(null);
  setRouteCalcTimeMs(null);
  routeCalcStartRef.current = Date.now();

  routingWorkerRef.current?.postMessage({
      systems: mapData.solar_systems,
      stargates: mapData.stargates,
      fromSystemName,
      toSystemName,
      maxJumpDistance,
      optimizeFor,
      algorithm,
    });
  }, [mapData, scoutRouteResult, clearCurrentRoute]);

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
        const response = await fetch('/map_data.db');
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
        const constellationsRes = db.exec("SELECT * FROM constellations");

        const solar_systems: { [key: string]: SolarSystem } = {};
        if (systemsRes.length > 0) {
            systemsRes[0].values.forEach((row: SqlValue[]) => {
                const system: SystemRow = {
                    id: row[0] as number,
                    name: row[1] as string,
                    constellation_id: row[2] as number,
                    region_id: row[3] as number,
                    x: row[7] as number,
                    y: row[8] as number,
                    z: row[9] as number,
                    hidden: !!row[13],
                    planet_count: row[14] as number
                };
                solar_systems[system.id] = {
                    id: system.id,
                    name: system.name,
                    position: { x: system.x, y: system.y, z: system.z },
                    region_id: system.region_id,
                    constellation_id: system.constellation_id,
                    planets: system.planet_count,
                    hidden: system.hidden
                };
            });
        }

        setLoadingStatus('Processing stargates...');
        const stargates: { [key: string]: Stargate } = {};
        if (stargatesRes.length > 0) {
            stargatesRes[0].values.forEach((row: SqlValue[]) => {
                const stargate: StargateRow = {
                    id: row[0] as number,
                    name: row[1] as string,
                    source_system_id: row[2] as number,
                    destination_system_id: row[3] as number
                };
                stargates[stargate.id] = {
                    id: stargate.id,
                    name: stargate.name,
                    source_system_id: stargate.source_system_id,
                    destination_system_id: stargate.destination_system_id
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
        setMapData({ solar_systems, stargates, regions, constellations });

        // Calculate min/max planets once data is loaded
        const planetCounts = Object.values(solar_systems).map(s => s.planets);
        const initialMinPlanets = planetCounts.length > 0 ? Math.min(...planetCounts) : 0;
        const initialMaxPlanets = planetCounts.length > 0 ? Math.max(...planetCounts) : 0;
        setMinPlanets(initialMinPlanets);
        setMaxPlanets(initialMaxPlanets);
        
        setIsLoaded(true);

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

    sceneRef.current = new THREE.Scene();
    cameraRef.current = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000000);
    rendererRef.current = new THREE.WebGLRenderer({ antialias: true });
    rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    currentMount.appendChild(rendererRef.current.domElement);

    // New: CSS2DRenderer setup
    const labelRenderer = new CSS2DRenderer();
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

    let running = true; let rafId = 0;
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
       } catch (e) {
         // ignore
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
         if(bloomPassRef.current){ const base = bloomStrength; bloomPassRef.current.strength = base * (1 + (bloomPulseEnabled? bloomPulseAmp:0)*Math.sin(performance.now()/1000*0.35)); }
         // Camera idle drift
         if(cameraDriftEnabled){ const idleTime = (Date.now() - lastInteractionRef.current)/1000; if(idleTime > 6 && cameraRef.current){ const t = performance.now()/1000; cameraRef.current.position.x += Math.sin(t*0.07)*0.3; cameraRef.current.position.y += Math.cos(t*0.05)*0.25; cameraRef.current.position.z += Math.sin(t*0.04)*0.15; } }
         // Rotate dust layers
         if (dustPointsRef.current) dustPointsRef.current.rotation.y += 0.0004;
         if (secondDustEnabled && secondDustRef.current) secondDustRef.current.rotation.y -= 0.00025;
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
         if(advancedPassRef.current){ advancedPassRef.current.uniforms.uTime.value = performance.now()/1000; }
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

    const vertices = [];
    const colors = [];
    const white = new THREE.Color(0xffffff);

    for (const system of visibleSystemsRef.current) {
      const pos = getTransformedPosition(system.position);
      vertices.push(pos.x, pos.y, pos.z);
      colors.push(white.r, white.g, white.b);
    }

    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    pointsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    starFieldRef.current = new THREE.Points(pointsGeometry, pointsMaterial);
    sceneRef.current.add(starFieldRef.current);

    if (stargateLinesRef.current) {
      sceneRef.current.remove(stargateLinesRef.current);
      stargateLinesRef.current.geometry.dispose();
    }

    const stargateVertices: number[] = [];
    const stargateColors: number[] = [];
    const defaultStargateColor = new THREE.Color(0x444444);
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

          stargateColors.push(defaultStargateColor.r, defaultStargateColor.g, defaultStargateColor.b);
          stargateColors.push(defaultStargateColor.r, defaultStargateColor.g, defaultStargateColor.b);

          stargateData.push({ source_system_id: stargate.source_system_id, destination_system_id: stargate.destination_system_id });
        }
      });
      const stargateGeometry = new THREE.BufferGeometry();
      stargateGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stargateVertices, 3));
      stargateGeometry.setAttribute('color', new THREE.Float32BufferAttribute(stargateColors, 3));
      stargateGeometry.userData = { stargateData };

      const stargateLines = new THREE.LineSegments(stargateGeometry, stargateMaterial);
      stargateLines.visible = !cinematicMode; // hide when cinematic
      sceneRef.current?.add(stargateLines);
      stargateLinesRef.current = stargateLines;
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
        shader.uniforms.uAmp={value:0.22};
        shader.uniforms.uColorStrength={value:starColorStrength};
        shader.uniforms.uHueShift={value:0};
        shader.fragmentShader = `uniform float uTime;\nuniform float uAmp;\nuniform float uColorStrength;\nuniform float uHueShift;\n${shader.fragmentShader}`.replace(
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      'float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453);\n'+
      'float h2 = fract(h*5.0);\n'+
          // Cool purple/blue shift (mild) palette
          'vec3 c1 = vec3(0.55,0.50,0.95);\n'+ // soft lavender
          'vec3 c2 = vec3(0.50,0.65,1.00);\n'+ // blue accent
          'vec3 c3 = vec3(0.85,0.60,1.00);\n'+ // magenta-lilac highlight
      'vec3 base;\n'+
      'if(h < 0.33) base = mix(c1,c2,h/0.33); else if(h < 0.66) base = mix(c2,c3,(h-0.33)/0.33); else base = mix(c3,c1,(h-0.66)/0.34);\n'+
      'base = mix(base, mix(c1,c3,step(0.5,h2)), 0.22*abs(sin(h2*6.283)));\n'+
      '// Apply global hue shift (approximate)\n'+
          'float hs = uHueShift;\n'+
          'mat3 rot = mat3(\n'+
          '  0.299+0.701*cos(hs)+0.168*sin(hs), 0.587-0.587*cos(hs)+0.330*sin(hs), 0.114-0.114*cos(hs)-0.497*sin(hs),\n'+
          '  0.299-0.299*cos(hs)-0.328*sin(hs), 0.587+0.413*cos(hs)+0.035*sin(hs), 0.114-0.114*cos(hs)+0.292*sin(hs),\n'+
          '  0.299-0.300*cos(hs)+1.250*sin(hs), 0.587-0.588*cos(hs)-1.050*sin(hs), 0.114+0.886*cos(hs)-0.203*sin(hs) );\n'+
          'base = clamp(rot * base, 0.0, 1.0);\n'+
          'float tw = sin(uTime*2.6 + gl_FragCoord.x*0.05 + gl_FragCoord.y*0.05);\n'+
          'float f = 1.0 + (tw*0.5)*uAmp;\n'+
          'float luma = dot(base, vec3(0.299,0.587,0.114));\n'+
          'vec3 tint = mix(vec3(luma), base, uColorStrength);\n'+
          'tint = pow(tint, vec3(0.90));\n'+
          'vec3 col = outgoingLight * tint * f;\n'+
          // Subtle purple / blue shift (reduce green, lift blue & red slightly)
          'col.g *= 0.90;\n'+
          'col.b = mix(col.b, col.b*1.05 + col.r*0.02, 0.6);\n'+
          'col.r = mix(col.r, col.r*1.02 + col.b*0.03, 0.4);\n'+
          'col = col / (1.0 + max(0.0, max(col.r,max(col.g,col.b)))*0.18);\n'+
          'gl_FragColor = vec4(col, diffuseColor.a);'
        );
        (cineMat as any).userData.shader = shader; 
      };
      cinematicStarMaterialRef.current = cineMat; starFieldRef.current!.material = cineMat;
      if(stargateLinesRef.current) stargateLinesRef.current.visible = false;
      // Dust
      const count=1000; const pos=new Float32Array(count*3); const col=new Float32Array(count*3);
  for(let i=0;i<count;i++){ const r=22000*Math.cbrt(Math.random()); const th=Math.random()*Math.PI*2; const ph=Math.acos(2*Math.random()-1); pos[i*3]=r*Math.sin(ph)*Math.cos(th); pos[i*3+1]=r*Math.sin(ph)*Math.sin(th); pos[i*3+2]=r*Math.cos(ph); const tint=new THREE.Color().setHSL(0.76+Math.random()*0.1,0.45,0.55+Math.random()*0.15); col[i*3]=tint.r; col[i*3+1]=tint.g; col[i*3+2]=tint.b; }
      const g=new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos,3)); g.setAttribute('color', new THREE.BufferAttribute(col,3));
      const dMat=new THREE.PointsMaterial({ size:14, sizeAttenuation:true, transparent:true, opacity:0.28*dustAmount, depthWrite:false, vertexColors:true, blending:THREE.AdditiveBlending });
  dustPointsRef.current=new THREE.Points(g,dMat); sceneRef.current!.add(dustPointsRef.current);
      // Second dust layer (larger, sparser)
      const count2=400; const pos2=new Float32Array(count2*3); const col2=new Float32Array(count2*3);
  for(let i=0;i<count2;i++){ const r=30000*Math.cbrt(Math.random()); const th=Math.random()*Math.PI*2; const ph=Math.acos(2*Math.random()-1); pos2[i*3]=r*Math.sin(ph)*Math.cos(th); pos2[i*3+1]=r*Math.sin(ph)*Math.sin(th); pos2[i*3+2]=r*Math.cos(ph); const tint=new THREE.Color().setHSL(0.70+Math.random()*0.15,0.35,0.35+Math.random()*0.15); col2[i*3]=tint.r; col2[i*3+1]=tint.g; col2[i*3+2]=tint.b; }
      const g2=new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos2,3)); g2.setAttribute('color', new THREE.BufferAttribute(col2,3));
      const dMat2=new THREE.PointsMaterial({ size:24, sizeAttenuation:true, transparent:true, opacity:0.12*dustAmount, depthWrite:false, vertexColors:true, blending:THREE.AdditiveBlending });
      secondDustRef.current=new THREE.Points(g2,dMat2); sceneRef.current!.add(secondDustRef.current);
      // Meteors group
      meteorsGroupRef.current = new THREE.Group(); sceneRef.current!.add(meteorsGroupRef.current);
      lastMeteorSpawnRef.current = performance.now();
      // Post chain (recreate composer & bloom)
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(sceneRef.current!, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), bloomStrength, 0.4, 0.85); bloom.threshold = 0;
      composer.addPass(bloom);
      composerRef.current = composer; bloomPassRef.current = bloom;
      // Custom post-processing pass (vignette + grain + chromatic aberration + radial glow)
      // After composer and bloom have been created
  const customShader = { uniforms:{ tDiffuse:{value:null}, uTime:{value:0}, uGrain:{value:0.35}, uVignette:{value:0.85}, uAberration:{value:new THREE.Vector2(0.002,0.002)}, uRadialGlow:{value:0.15}, resolution:{value:new THREE.Vector2(window.innerWidth, window.innerHeight)} }, vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`, fragmentShader:`uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVignette; uniform float uRadialGlow; uniform vec2 uAberration; uniform vec2 resolution; varying vec2 vUv; float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))+uTime*917.2)*43758.5453); } void main(){ vec2 centered = vUv - 0.5; float r = length(centered); vec2 offR = vUv + uAberration*vec2( 0.5 - vUv.y,  vUv.x-0.5); vec2 offB = vUv - uAberration*vec2( 0.5 - vUv.x,  vUv.y-0.5); vec3 col; col.r = texture2D(tDiffuse, offR).r; col.g = texture2D(tDiffuse, vUv).g; col.b = texture2D(tDiffuse, offB).b; float glow = smoothstep(0.7,0.0,r)*uRadialGlow; col += glow; float vig = smoothstep(0.8, uVignette, r); col *= (1.0 - 0.65*vig); float g = (hash(floor(gl_FragCoord.xy)) - 0.5)*uGrain; col += g/255.0; gl_FragColor = vec4(col,1.0); }`};
      const pass = new ShaderPass(customShader as any); composer.addPass(pass); advancedPassRef.current = pass;
      renderer.toneMapping = THREE.ACESFilmicToneMapping as any; (renderer as any).toneMappingExposure = cinExposure;
      const onResize=()=>{ composer.setSize(window.innerWidth, window.innerHeight); bloom.setSize(window.innerWidth, window.innerHeight); }; window.addEventListener('resize', onResize); (enable as any)._resize = onResize;
    };
    const disable = () => {
      if(starFieldRef.current && originalStarMaterialRef.current) starFieldRef.current.material = originalStarMaterialRef.current;
      if(stargateLinesRef.current) stargateLinesRef.current.visible = true;
  if(dustPointsRef.current){ dustPointsRef.current.geometry.dispose(); (dustPointsRef.current.material as THREE.Material).dispose(); sceneRef.current!.remove(dustPointsRef.current); dustPointsRef.current=null; }
  if(secondDustRef.current){ secondDustRef.current.geometry.dispose(); (secondDustRef.current.material as THREE.Material).dispose(); sceneRef.current!.remove(secondDustRef.current); secondDustRef.current=null; }
  if(meteorsGroupRef.current){ meteorsGroupRef.current.children.forEach(c=>{ const m=c as any; if(m.geometry) m.geometry.dispose(); if(m.material) m.material.dispose(); }); sceneRef.current!.remove(meteorsGroupRef.current); meteorsGroupRef.current=null; }
      if(composerRef.current){ composerRef.current.passes.forEach(p=> (p as any).dispose?.()); (composerRef.current as any).dispose?.(); composerRef.current=null; bloomPassRef.current=null; }
      if(originalToneMappingRef.current!==null) renderer.toneMapping = originalToneMappingRef.current as any;
      if(originalExposureRef.current!==null) (renderer as any).toneMappingExposure = originalExposureRef.current;
      if((enable as any)._resize) window.removeEventListener('resize', (enable as any)._resize);
    };
    if(cinematicMode) enable(); else disable();
    return ()=>{ if(cinematicMode) disable(); };
  }, [cinematicMode, bloomStrength, dustAmount, cinExposure]);

  // Live slider updates
  useEffect(()=>{ if(!cinematicMode) return; if(bloomPassRef.current) bloomPassRef.current.strength = bloomStrength; if(rendererRef.current) (rendererRef.current as any).toneMappingExposure = cinExposure; if(dustPointsRef.current) (dustPointsRef.current.material as THREE.PointsMaterial).opacity = 0.28*dustAmount; if(secondDustRef.current) (secondDustRef.current.material as THREE.PointsMaterial).opacity = 0.12*dustAmount * (secondDustEnabled?1:0); if(backgroundMeshRef.current) (backgroundMeshRef.current.material as THREE.MeshBasicMaterial).opacity = bgIntensity; if(cinematicStarMaterialRef.current){ const shader=(cinematicStarMaterialRef.current as any).userData?.shader; if(shader && shader.uniforms.uColorStrength){ shader.uniforms.uColorStrength.value = starColorStrength; }} }, [bloomStrength, dustAmount, cinExposure, bgIntensity, starColorStrength, secondDustEnabled, cinematicMode]);

  // Update custom pass uniforms when sliders change
  useEffect(()=>{ if(!cinematicMode) return; if(advancedPassRef.current){ const u=advancedPassRef.current.uniforms; u.uVignette.value = vignette; u.uGrain.value = grain; u.uAberration.value.set(aberration,aberration); u.uRadialGlow.value = radialGlow; } }, [vignette, grain, aberration, radialGlow, cinematicMode]);

  // Handle creating/destroying second dust on toggle while active
  useEffect(()=>{ if(!cinematicMode) return; if(!sceneRef.current) return; if(secondDustEnabled && !secondDustRef.current){ const count2=400; const pos2=new Float32Array(count2*3); const col2=new Float32Array(count2*3); for(let i=0;i<count2;i++){ const r=30000*Math.cbrt(Math.random()); const th=Math.random()*Math.PI*2; const ph=Math.acos(2*Math.random()-1); pos2[i*3]=r*Math.sin(ph)*Math.cos(th); pos2[i*3+1]=r*Math.sin(ph)*Math.sin(th); pos2[i*3+2]=r*Math.cos(ph); const tint=new THREE.Color().setHSL(0.70+Math.random()*0.15,0.35,0.35+Math.random()*0.15); col2[i*3]=tint.r; col2[i*3+1]=tint.g; col2[i*3+2]=tint.b; } const g2=new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos2,3)); g2.setAttribute('color', new THREE.BufferAttribute(col2,3)); const dMat2=new THREE.PointsMaterial({ size:24, sizeAttenuation:true, transparent:true, opacity:0.12*dustAmount, depthWrite:false, vertexColors:true, blending:THREE.AdditiveBlending }); secondDustRef.current=new THREE.Points(g2,dMat2); sceneRef.current.add(secondDustRef.current); } else if(!secondDustEnabled && secondDustRef.current){ secondDustRef.current.geometry.dispose(); (secondDustRef.current.material as THREE.Material).dispose(); sceneRef.current.remove(secondDustRef.current); secondDustRef.current=null; } }, [secondDustEnabled, cinematicMode, dustAmount]);

  // This useLayoutEffect handles all dynamic star and stargate line coloring based on the pipeline.
  useLayoutEffect(() => {
    if (!mapData || !starFieldRef.current || !sceneRef.current) return;

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

  }, [isRegionHighlighterActive, highlightedSystem, mapData, isPlanetCountActive, getPlanetCountColor, getTransformedPosition, ringTexture, planetBinsActive]);

  // Draw Route Lines (supports P2P or Scout route; Scout takes precedence when present)
  useEffect(() => {
    if (!sceneRef.current || !mapData) return;

    if (routeLinesRef.current) {
      try {
        sceneRef.current.remove(routeLinesRef.current);
        routeLinesRef.current.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
      } catch (e) { /* ignore */ }
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

  const routeGroup = new THREE.Group();
    routeLinesRef.current = routeGroup;
    routeSourceRef.current = scoutRouteResult?.path ? 'scout' : 'p2p';
    const accentHex = accentIsBlue ? 0x00aaff : 0xff4c26;
  const ROUTE_TUBE_RADIUS = 0.375; // base world radius (will be capped by screen-space)
  routeBaseRadiusRef.current = ROUTE_TUBE_RADIUS;
  routeCurrentRadiusRef.current = ROUTE_TUBE_RADIUS;
  routeRadiusScaleRef.current = 1;
  const ROUTE_TUBULAR_SEGMENTS = 64;
  const pulseSpheres: THREE.Mesh[] = [];
  const segmentDescriptors: Array<{ isStargate: boolean; startVec: THREE.Vector3; endVec: THREE.Vector3; controlPoint?: THREE.Vector3; mesh: THREE.Mesh; }> = [];

    for (let i = 0; i < pathSystems.length - 1; i++) {
      const startSystem = pathSystems[i];
      const endSystem = pathSystems[i + 1];
      const startPos = getTransformedPosition(startSystem.position);
      const endPos = getTransformedPosition(endSystem.position);
      const startVec = new THREE.Vector3(startPos.x, startPos.y, startPos.z);
      const endVec = new THREE.Vector3(endPos.x, endPos.y, endPos.z);
      const isStargateJump = Object.values(mapData.stargates).some(gate =>
        (gate.source_system_id === startSystem.id && gate.destination_system_id === endSystem.id) ||
        (gate.source_system_id === endSystem.id && gate.destination_system_id === startSystem.id)
      );
      if (isStargateJump) {
        const points = [startVec.clone(), endVec.clone()];
        const curve = new THREE.CatmullRomCurve3(points);
        const geometry = new THREE.TubeGeometry(curve, Math.max(8, Math.floor(startVec.distanceTo(endVec) / 10)), ROUTE_TUBE_RADIUS, 8, false);
        const material = new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 0.95, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 1;
        routeGroup.add(mesh);
        const pulseGeo = new THREE.SphereGeometry(Math.max(ROUTE_TUBE_RADIUS * 0.6, 0.5), 8, 8);
        const pulseMat = new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 1.0 });
        const pulse = new THREE.Mesh(pulseGeo, pulseMat);
        pulse.position.copy(startVec);
        routeGroup.add(pulse);
        pulseSpheres.push(pulse);
        segmentDescriptors.push({ isStargate: true, startVec, endVec, mesh });
      } else {
        const midPoint = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
        const dist = startVec.distanceTo(endVec);
        const controlPointOffset = new THREE.Vector3(0, dist * 0.30, 0);
        const controlPoint = new THREE.Vector3().addVectors(midPoint, controlPointOffset);
        const curve = new THREE.QuadraticBezierCurve3(startVec, controlPoint, endVec);
        const geometry = new THREE.TubeGeometry(curve as any, ROUTE_TUBULAR_SEGMENTS, ROUTE_TUBE_RADIUS, 8, false);
        const material = new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 0.95, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 1;
        routeGroup.add(mesh);
        const pulseGeo = new THREE.SphereGeometry(Math.max(ROUTE_TUBE_RADIUS * 0.6, 0.5), 8, 8);
        const pulseMat = new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 1.0 });
        const pulse = new THREE.Mesh(pulseGeo, pulseMat);
        pulse.position.copy(startVec);
        routeGroup.add(pulse);
        pulseSpheres.push(pulse);
        segmentDescriptors.push({ isStargate: false, startVec, endVec, controlPoint, mesh });
      }
    }
    sceneRef.current.add(routeGroup);

    // Dynamic pixel-size capped thickness updater (8px diameter cap)
    const routePts = segmentDescriptors.flatMap(s => [s.startVec, s.endVec]);
    const routeBox = new THREE.Box3().setFromPoints(routePts);
    const routeSphere = routeBox.getBoundingSphere(new THREE.Sphere());
    let lastAppliedRadius = ROUTE_TUBE_RADIUS;
    const thicknessUpdater = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const cam = cameraRef.current;
      const dist = cam.position.distanceTo(routeSphere.center);
      if (dist <= 0) return;
      const fov = cam.fov * Math.PI / 180;
      const canvasH = rendererRef.current.domElement.clientHeight || window.innerHeight;
      const desiredPixelDiameter = 8; // cap
      const desiredPixelRadius = desiredPixelDiameter / 2;
      // pixelHeight = (worldHeight / dist) * (canvasH / (2 * tan(fov/2)))
      // worldRadius = pixelRadius * dist * (2 * tan(fov/2)) / canvasH
      const worldRadiusCap = desiredPixelRadius * dist * (2 * Math.tan(fov / 2)) / canvasH;
      const targetRadius = Math.min(ROUTE_TUBE_RADIUS, worldRadiusCap);
      if (Math.abs(targetRadius - lastAppliedRadius) < 0.01) return; // skip small changes
      // Rebuild geometries with new radius
      segmentDescriptors.forEach(seg => {
        try {
          (seg.mesh.geometry as THREE.TubeGeometry).dispose();
          if (seg.isStargate) {
            const curve = new THREE.CatmullRomCurve3([seg.startVec.clone(), seg.endVec.clone()]);
            seg.mesh.geometry = new THREE.TubeGeometry(curve, Math.max(8, Math.floor(seg.startVec.distanceTo(seg.endVec) / 10)), targetRadius, 8, false);
          } else {
            const curve = new THREE.QuadraticBezierCurve3(seg.startVec, seg.controlPoint!, seg.endVec);
            seg.mesh.geometry = new THREE.TubeGeometry(curve as any, ROUTE_TUBULAR_SEGMENTS, targetRadius, 8, false);
          }
        } catch (e) { /* ignore */ }
      });
      lastAppliedRadius = targetRadius;
      routeCurrentRadiusRef.current = targetRadius;
      routeRadiusScaleRef.current = targetRadius / routeBaseRadiusRef.current;
    };
    routeAnimUpdatersRef.current.push(thicknessUpdater);

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

    const animators: Array<() => void> = [];
  pulseSpheres.forEach((pulse, idx) => {
      const start = pathSystems[idx];
      const end = pathSystems[idx + 1];
      const startPos = getTransformedPosition(start.position);
      const endPos = getTransformedPosition(end.position);
      const sVec = new THREE.Vector3(startPos.x, startPos.y, startPos.z);
      const eVec = new THREE.Vector3(endPos.x, endPos.y, endPos.z);
      const curve = new THREE.QuadraticBezierCurve3(sVec, new THREE.Vector3().addVectors(sVec, eVec).multiplyScalar(0.5).add(new THREE.Vector3(0, sVec.distanceTo(eVec) * 0.25, 0)), eVec);
      let t = 0;
      const speed = 0.5 + (idx % 3) * 0.1;
      const updater = () => {
        t += 0.01 * speed;
        if (t > 1) t = 0;
        const pos = curve.getPoint(t);
        pulse.position.copy(pos);
    const animScale = 1 + Math.sin(t * Math.PI * 2) * 0.3;
    const thicknessScale = routeRadiusScaleRef.current; // sync with tube thickness cap
    const finalScale = animScale * thicknessScale;
    pulse.scale.set(finalScale, finalScale, finalScale);
      };
      animators.push(updater);
    });
  routeAnimUpdatersRef.current = [...routeAnimUpdatersRef.current, ...animators];

    return () => {
      animators.forEach(a => {
        const idx = routeAnimUpdatersRef.current.indexOf(a);
        if (idx !== -1) routeAnimUpdatersRef.current.splice(idx, 1);
      });
      if (routeLinesRef.current) {
        try {
          routeLinesRef.current.traverse(child => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              (child.material as THREE.Material).dispose();
            }
          });
          sceneRef.current?.remove(routeLinesRef.current);
        } catch (e) { /* ignore */ }
        routeLinesRef.current = null;
      }
      routeSourceRef.current = null;
    };
  }, [routeResult, scoutRouteResult, mapData, getTransformedPosition, accentIsBlue]);

  // Recolor route meshes when the accent changes
  useEffect(() => {
    if (!sceneRef.current || !routeLinesRef.current) return;
    const accentHex = accentIsBlue ? 0x00aaff : 0xff4c26;
    routeLinesRef.current.traverse((child) => {
      const anyChild: any = child as any;
      if (anyChild.material && (anyChild.material as any).color) {
        (anyChild.material as any).color.set(accentHex);
      }
    });
  }, [accentIsBlue]);

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
      if (hoveredSystem) {
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

        hoverPoint.visible = true;
      } else {
        hoverPoint.visible = false;
      }
    }
  }, [hoveredSystem, getTransformedPosition, pointsMaterial]);

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
      if (!isDraggingRef.current && !anyButtonDown) {
        raycaster.setFromCamera(mouse, cameraRef.current);
        // Dynamic threshold based on camera distance
        const distance = cameraRef.current.position.distanceTo(controlsRef.current.target);
        const minDistance = 100; // Adjust as needed
        const maxDistance = 50000; // Adjust as needed
        const minThreshold = 1; // Precise for zoomed in
        const maxThreshold = 300; // Forgiving for zoomed out
        const clampedDistance = Math.max(minDistance, Math.min(maxDistance, distance));
        const normalizedDistance = (clampedDistance - minDistance) / (maxDistance - minDistance);
        const dynamicThreshold = minThreshold + (maxThreshold - minThreshold) * normalizedDistance;
        raycaster.params.Points.threshold = dynamicThreshold;
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
          
          const labelElement = (hoverLabelObj.current.element as HTMLElement).querySelector('.system-label');
          if (labelElement) {
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

          hoverLabelObj.current.visible = true;

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

    return () => {
      currentRenderer.domElement.removeEventListener('pointermove', onPointerMove);
      currentRenderer.domElement.removeEventListener('pointerdown', onPointerDown);
  currentRenderer.domElement.removeEventListener('pointerup', onPointerUp);
  currentRenderer.domElement.removeEventListener('pointerleave', onPointerLeave);
    };
    }, [isLoaded, hoveredSystem, isDraggingRef, mouseDownPosRef, mouseDownTimeRef, createSystemLabelElement, selectSystem, isPlanetCountActive, showDistance, highlightedSystem]);

  const handleSearch = (event: React.KeyboardEvent<HTMLInputElement>, systemNameFromSelection?: string) => {
    if (event.key === 'Enter' && mapData) {
      const query = (systemNameFromSelection || searchQuery).toLowerCase().trim();
        const foundSystem = Object.values(mapData.solar_systems).find(
          (system) => system.name.toLowerCase().trim() === query
        );
      if (foundSystem) {
        selectSystem(foundSystem);
      } else {
        setHighlightedSystem(null);
        alert('System not found');
      }
    }
  };

  if (!isLoaded) {
    return <LoadingScreen progress={loadingProgress} status={loadingStatus} />;
  }

  return (
    <>
  {/* Referral code copy state */}
  {/* ...existing code... */}
  <div className="ef-top-toolbar">
    <div className="ef-toolbar-shifting">
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
    <HelpPanel accentIsBlue={accentIsBlue} />
  </div>
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1, color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '5px' }}>
        <div style={{ display:'flex', alignItems:'stretch', gap:'6px' }}>
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
              padding: '6px 12px', // match input vertical padding
              fontSize: '13px', // align with .p2p-input font-size
              lineHeight: '1.3',
              fontWeight: 600,
              cursor: 'pointer',
              borderRadius: '3px',
              alignSelf:'stretch', // match input height automatically
              display:'flex',
              alignItems:'center'
            }}
            onClick={()=>{
              setRouteResult(null);
              setScoutRouteResult(null);
              setScoutInvalidateToken(t=> t+1);
              if(window.location.hash){ try { history.replaceState(null,'', window.location.pathname + window.location.search); } catch {/* ignore */} }
              setSearchQuery('');
              setResetToken(t=> t+1);
            }}
            aria-label="Reset all inputs"
          >Reset</button>
        </div>
  {/* ...existing controls... (accent toggle removed from here) */}
        <div className="ef-control-group" style={{ marginTop: '10px' }}>
          <label className="module-toggle-label">
            <input
              type="checkbox"
              checked={isRegionHighlighterActive}
              onChange={(e) => {
                setIsRegionHighlighterActive(e.target.checked);
              }}
            />
            Highlight Region
          </label>
        </div>
        <div className="ef-control-group" style={{ marginTop: '10px' }}>
          <label className="module-toggle-label">
            <input
              type="checkbox"
              checked={isPlanetCountActive}
              onChange={(e) => {
                setIsPlanetCountActive(e.target.checked);
              }}
            />
            Display Planet Counts
          </label>
        </div>
        <div className="ef-control-group" style={{ marginTop: '10px' }}>
          <label className="module-toggle-label">
            <input
              type="checkbox"
              checked={showDistance}
              onChange={(e) => setShowDistance(e.target.checked)}
            />
            Show Distance
          </label>
        </div>
        <div className="ef-control-group" style={{ marginTop: '10px' }}>
          <label className="module-toggle-label" style={{ display:'flex', gap:'6px', alignItems:'center' }}>
            <input type="checkbox" checked={cinematicMode} onChange={e=> setCinematicMode(e.target.checked)} /> Cinematic Mode
          </label>
        </div>
        <P2PRouting 
          onCalculateRoute={calculateRoute}
          onStopCalculation={stopCalculation}
          isCalculating={isCalculatingRoute}
          routeCalcTimeMs={routeCalcTimeMs}
          routeResult={routeResult}
          mapData={mapData}
          systemNames={mapData ? Object.values(mapData.solar_systems).map(s => s.name) : []}
          progress={routeProgress}
          open={p2pOpen}
          onToggle={toggleP2P}
          resetToken={resetToken}
        />
        <ScoutOptimizer
          open={scoutOpen}
          onToggle={toggleScout}
          mapData={mapData}
          systemNames={mapData ? Object.values(mapData.solar_systems).map(s => s.name) : []}
          returnToStart={returnToStart}
          onReturnToStartChange={setReturnToStart}
          invalidateToken={scoutInvalidateToken}
          importedRoutePath={scoutRouteResult?.path || null}
          resetToken={resetToken}
          onBaselineRoute={(path)=>{ 
            setScoutRouteResult({ path }); 
            // Clear existing hash on new scout route
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
          onClearRoute={()=> setScoutRouteResult(null)}
        />
        {isPlanetCountActive && generatePlanetCountLegend()}
      </div>
      <div style={{ position: 'fixed', left: 10, bottom: 10, zIndex: 2000 }}>
        <label style={{ color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', padding: '6px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" checked={accentIsBlue} onChange={(e) => setAccentIsBlue(e.target.checked)} />
          <span style={{ fontSize: '12px' }}>Use blue accent</span>
        </label>
      </div>
    <div ref={mountRef} style={{ width: '100vw', height: '100vh' }} />
  {/* Small persistent logo and referral code */}
  <img src={logo} alt="EF Map" className="ef-small-logo" />
    </>
  );
}

export default App;

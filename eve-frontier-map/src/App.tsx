import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
  const [highlightedSystem, setHighlightedSystem] = useState<SolarSystem | null>(null);
  const [hoveredSystem, setHoveredSystem] = useState<SolarSystem | null>(null);
  const [isRegionHighlighterActive, setIsRegionHighlighterActive] = useState(false);
  const [isPlanetCountActive, setIsPlanetCountActive] = useState(false);
  const [showDistance, setShowDistance] = useState(false);
  const [minPlanets, setMinPlanets] = useState(0);
  const [maxPlanets, setMaxPlanets] = useState(0);

  // State for P2P Routing
  const routingWorkerRef = useRef<Worker | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [routeResult, setRouteResult] = useState<{ path: string[] | null; error?: string } | null>(null);
  const [scoutRouteResult, setScoutRouteResult] = useState<{ path: string[] | null } | null>(null);
  const [routeProgress, setRouteProgress] = useState<{ explored: number; frontier: number; elapsedMs: number; message: string } | null>(null);

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

  // New refs for managing overlays
  const selectedStarHaloRef = useRef<THREE.Points | null>(null);
  const regionOutlineGroupRef = useRef<THREE.Group | null>(null);


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

  const toggleP2P = (open: boolean) => {
    setP2POpen(open);
    if (open) { setScoutOpenReal(false); }
  };
  const toggleScout = (open: boolean) => {
    setScoutOpenReal(open);
    if (open) { setP2POpen(false); }
  };

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
    if (!mapData) {
      alert('Map data is not loaded yet.');
      return;
    }

    // If a scout route was displayed, clear it so P2P route takes visual precedence
    if (scoutRouteResult) {
      setScoutRouteResult(null);
    }

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
  }, [mapData]);

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
      const upperBound = Math.round(minPlanets + (i + 1) * stepSize);
      const midPoint = Math.round((lowerBound + upperBound) / 2);
      const color = getPlanetCountColor(midPoint, minPlanets, maxPlanets);

      legendItems.push(
        <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
          <div style={{ width: '20px', height: '20px', backgroundColor: `#${color.getHexString()}`, marginRight: '10px' }}></div>
          <span>{`${lowerBound} - ${upperBound} planets`}</span>
        </div>
      );
    }
    return (
      <div style={{ marginTop: '10px', padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <strong>Planet Count Legend:</strong>
        {legendItems}
      </div>
    );
  }, [isPlanetCountActive, minPlanets, maxPlanets, getPlanetCountColor]);

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

    const animate = () => {
      requestAnimationFrame(animate);
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
      rendererRef.current?.render(sceneRef.current!, cameraRef.current!);
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
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      rendererRef.current?.dispose();
      if (rendererRef.current) {
        currentMount.removeChild(rendererRef.current!.domElement);
      }
      currentMount.removeChild(labelRenderer.domElement); // New: Clean up label renderer DOM
    };
  }, [isLoaded, ringTexture]);

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
      sceneRef.current?.add(stargateLines);
      stargateLinesRef.current = stargateLines;
    }
  }, [mapData, getTransformedPosition, pointsMaterial, stargateMaterial]);

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

      for (let i = 0; i < visibleSystemsRef.current.length; i++) {
        const system = visibleSystemsRef.current[i];
        const color = isPlanetCountActive
          ? getPlanetCountColor(system.planets, minPlanets, maxPlanets)
          : DEFAULT_STAR_COLOR;
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

    for (let i = 0; i < visibleSystemsRef.current.length; i++) {
      const system = visibleSystemsRef.current[i];
      let color: THREE.Color;

      if (isPlanetCountActive) {
        if (systemsInHighlightedRegion && systemsInHighlightedRegion.has(system.id)) {
          // DPC is ON, HR is ON, and system is in highlighted region
          color = getPlanetCountColor(system.planets, minPlanets, maxPlanets);
        } else if (systemsInHighlightedRegion && !systemsInHighlightedRegion.has(system.id)) {
          // DPC is ON, HR is ON, but system is NOT in highlighted region
          color = DEFAULT_STAR_COLOR;
        } else {
          // DPC is ON, but HR is OFF (global DPC)
          color = getPlanetCountColor(system.planets, minPlanets, maxPlanets);
        }
      } else {
        // DPC is OFF (global white)
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

      for (let i = 0; i < visibleSystemsRef.current.length; i++) {
        const system = visibleSystemsRef.current[i];
        const color = isPlanetCountActive
          ? getPlanetCountColor(system.planets, minPlanetsLocal, maxPlanetsLocal)
          : DEFAULT_STAR_COLOR;
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

  }, [isRegionHighlighterActive, highlightedSystem, mapData, isPlanetCountActive, getPlanetCountColor, getTransformedPosition, ringTexture]);

  // Draw Route Lines (supports P2P or Scout route; Scout takes precedence when present)
  useEffect(() => {
    if (!sceneRef.current || !mapData) return;

    // Clear previous route lines
    if (routeLinesRef.current) {
      sceneRef.current.remove(routeLinesRef.current);
      routeLinesRef.current.children.forEach((child: any) => {
        child.geometry?.dispose();
        child.material?.dispose();
      });
      routeLinesRef.current = null;
    }

    const activePath = scoutRouteResult?.path || routeResult?.path;
    if (activePath) {
      const systemsByName = Object.fromEntries(Object.values(mapData.solar_systems).map(s => [s.name.toLowerCase(), s]));
      const pathSystems = activePath.map(name => systemsByName[name.toLowerCase()]).filter(Boolean);

      if (pathSystems.length < 2) return;

      const routeGroup = new THREE.Group();
      routeLinesRef.current = routeGroup;

  // Determine route color from the current accent CSS variable
  const accentHex = accentIsBlue ? 0x00aaff : 0xff4c26;
  // Tube radius for route rendering (world units). Reduce to ~0.375 to make the root much thinner (approximately 1/4 of 1.5)
  const ROUTE_TUBE_RADIUS = 0.375;
  const ROUTE_TUBULAR_SEGMENTS = 64;

  // Array to hold pulse spheres for cleanup
  const pulseSpheres: THREE.Mesh[] = [];

  for (let i = 0; i < pathSystems.length - 1; i++) {
        const startSystem = pathSystems[i];
        const endSystem = pathSystems[i + 1];

        const startPos = getTransformedPosition(startSystem.position);
        const endPos = getTransformedPosition(endSystem.position);
        const startVec = new THREE.Vector3(startPos.x, startPos.y, startPos.z);
        const endVec = new THREE.Vector3(endPos.x, endPos.y, endPos.z);

        // Check if a stargate exists between these two systems
        const isStargateJump = Object.values(mapData.stargates).some(gate => 
          (gate.source_system_id === startSystem.id && gate.destination_system_id === endSystem.id) ||
          (gate.source_system_id === endSystem.id && gate.destination_system_id === startSystem.id)
        );

        // Use the accent color for all route lines
        if (isStargateJump) {
          // Create a short straight tube between systems to guarantee thickness across platforms
          const points = [startVec.clone(), endVec.clone()];
          const curve = new THREE.CatmullRomCurve3(points);
          const geometry = new THREE.TubeGeometry(curve, Math.max(8, Math.floor(startVec.distanceTo(endVec) / 10)), ROUTE_TUBE_RADIUS, 8, false);
          const material = new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 0.95, depthWrite: false });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = 1;
          routeGroup.add(mesh);
          // Pulse sphere for this hop
          const pulseGeo = new THREE.SphereGeometry(Math.max(ROUTE_TUBE_RADIUS * 0.6, 0.5), 8, 8);
          const pulseMat = new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 1.0 });
          const pulse = new THREE.Mesh(pulseGeo, pulseMat);
          pulse.position.copy(startVec);
          routeGroup.add(pulse);
          pulseSpheres.push(pulse);
        } else {
          // It's a direct ship jump, draw a stronger curved tube
          const midPoint = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
          const dist = startVec.distanceTo(endVec);
          const controlPointOffset = new THREE.Vector3(0, dist * 0.30, 0);
          const controlPoint = new THREE.Vector3().addVectors(midPoint, controlPointOffset);

          const curve = new THREE.QuadraticBezierCurve3(startVec, controlPoint, endVec);
          // Use TubeGeometry directly from the quadratic curve to guarantee consistent thickness
          const geometry = new THREE.TubeGeometry(curve as any, ROUTE_TUBULAR_SEGMENTS, ROUTE_TUBE_RADIUS, 8, false);
          const material = new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 0.95, depthWrite: false });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = 1;
          routeGroup.add(mesh);
          // Pulse sphere for this hop
          const pulseGeo = new THREE.SphereGeometry(Math.max(ROUTE_TUBE_RADIUS * 0.6, 0.5), 8, 8);
          const pulseMat = new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 1.0 });
          const pulse = new THREE.Mesh(pulseGeo, pulseMat);
          pulse.position.copy(startVec);
          routeGroup.add(pulse);
          pulseSpheres.push(pulse);
        }
      }
      sceneRef.current.add(routeGroup);

      // Register animators for pulses: they travel from start to end in sequence
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
        const speed = 0.5 + (idx % 3) * 0.1; // slight variation per hop
        const updater = () => {
          t += 0.01 * speed;
          if (t > 1) t = 0;
          const pos = curve.getPoint(t);
          pulse.position.copy(pos);
          // Simple pulsing scale
          const scale = 1 + Math.sin(t * Math.PI * 2) * 0.3;
          pulse.scale.set(scale, scale, scale);
        };
        animators.push(updater);
      });
      // Attach animators to the global updaters list so they run each frame
      routeAnimUpdatersRef.current.push(...animators);

      // Ensure cleanup removes these animators and meshes when route is cleared
      const cleanupRoute = () => {
        // remove animators
        animators.forEach(a => {
          const idx = routeAnimUpdatersRef.current.indexOf(a);
          if (idx !== -1) routeAnimUpdatersRef.current.splice(idx, 1);
        });
        // remove meshes
        if (routeLinesRef.current) {
          routeLinesRef.current.traverse(child => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              (child.material as THREE.Material).dispose();
            }
          });
          sceneRef.current?.remove(routeLinesRef.current);
          routeLinesRef.current = null;
        }
      };

      // Replace previous cleanup with our route-specific cleanup when effect re-runs
      // (the effect's return will run earlier cleanup and then our cleanup will be available for next run)
      // Attach for outer cleanup
      (routeGroup as any)._cleanup = cleanupRoute;
    }

  }, [routeResult, scoutRouteResult, mapData, getTransformedPosition]);

  // Recolor route meshes when the accent changes
  useEffect(() => {
    if (!sceneRef.current || !routeLinesRef.current) return;
    const accentHex = accentIsBlue ? 0x00aaff : 0xff4c26;
    routeLinesRef.current.traverse((child) => {
      if ((child as THREE.Mesh).material) {
        const mat = (child as THREE.Mesh).material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) {
          mat.forEach(m => {
            if ((m as any).color) (m as any).color.set(accentHex);
          });
        } else {
          if ((mat as any).color) (mat as any).color.set(accentHex);
        }
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

      if (event.buttons & 1) { // Left mouse button is down
        const currentMousePos = new THREE.Vector2(event.clientX, event.clientY);
        if (currentMousePos.distanceTo(mouseDownPosRef.current) > DRAG_THRESHOLD) {
          isDraggingRef.current = true;
        }
      }

      if (!cameraRef.current || !starFieldRef.current || !controlsRef.current) {
        return;
      }

      if (!isDraggingRef.current) {
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
      if (event.button !== 0) return; // Only care about left mouse button
      isDraggingRef.current = false;
      mouseDownPosRef.current.set(event.clientX, event.clientY);
      mouseDownTimeRef.current = Date.now();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return; // Only care about left mouse button

      const timeElapsed = Date.now() - mouseDownTimeRef.current;

      if (!isDraggingRef.current && timeElapsed < CLICK_TIME_THRESHOLD) {
        // It was a click, not a drag
        if (hoveredSystem) {
          selectSystem(hoveredSystem);
        }
      }
      isDraggingRef.current = false; // Reset drag state
    };

    currentRenderer.domElement.addEventListener('pointermove', onPointerMove);
    currentRenderer.domElement.addEventListener('pointerdown', onPointerDown);
    currentRenderer.domElement.addEventListener('pointerup', onPointerUp);

    return () => {
      currentRenderer.domElement.removeEventListener('pointermove', onPointerMove);
      currentRenderer.domElement.removeEventListener('pointerdown', onPointerDown);
      currentRenderer.domElement.removeEventListener('pointerup', onPointerUp);
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
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1, color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '5px' }}>
        <div>
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
  {/* ...existing controls... (accent toggle removed from here) */}
        <div style={{ marginTop: '10px' }}>
          <label>
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
        <div style={{ marginTop: '10px' }}>
          <label>
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
        <div style={{ marginTop: '10px' }}>
          <label>
            <input
              type="checkbox"
              checked={showDistance}
              onChange={(e) => setShowDistance(e.target.checked)}
            />
            Show Distance
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
        />
        <ScoutOptimizer
          open={scoutOpen}
          onToggle={toggleScout}
          mapData={mapData}
          systemNames={mapData ? Object.values(mapData.solar_systems).map(s => s.name) : []}
          returnToStart={returnToStart}
          onReturnToStartChange={setReturnToStart}
          onBaselineRoute={(path)=>{ 
            setScoutRouteResult({ path }); 
            if(mapData && path.length){
              const first = Object.values(mapData.solar_systems).find(s=> s.name.toLowerCase()===path[0].toLowerCase());
              if(first){ selectSystem(first); }
            }
          }}
          onOptimizedRoute={(path)=>{ 
            setScoutRouteResult({ path }); 
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
  {/* Small persistent logo in the bottom-right */}
  <img src={logo} alt="EF Map" className="ef-small-logo" />
    </>
  );
}

export default App;

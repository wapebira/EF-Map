/**
 * RegionMap2D - Module for rendering regions in 2D with proper spatial positioning and scalable text
 * Supports two 2D view modes:
 * - Region Overview: All regions laid out preserving spatial relationships
 * - Region Detail: Systems within a specific region in 2D
 */

import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

interface RegionData {
  id: number;
  name: string;
  systemCount: number;
  systemIds: number[];
  center: { x: number; y: number; z: number };
  color: THREE.Color;
  // Bounding box for spatial layout
  bounds: {
    minX: number; maxX: number;
    minY: number; maxY: number;
    minZ: number; maxZ: number;
  };
}

interface SystemData {
  id: number;
  name: string;
  position: { x: number; y: number; z: number };
  region_id: number;
  planets: number;
}

export type ViewMode = '3D' | '2D_REGIONS' | '2D_REGION_DETAIL';

export interface RegionMap2DOptions {
  scene: THREE.Scene;
  mapData: any;
  onRegionClick?: (regionId: number) => void;
  onSystemClick?: (systemId: number) => void;
}

export class RegionMap2D {
  private scene: THREE.Scene;
  private mapData: any;
  
  private viewMode: ViewMode = '3D';
  private selectedRegionId: number | null = null;
  
  private regionGroup: THREE.Group;
  private systemGroup: THREE.Group;
  private labelGroup: THREE.Group;
  
  private regions: Map<number, RegionData> = new Map();
  private regionMeshes: Map<number, THREE.Mesh> = new Map();
  private systemPoints: THREE.Points | null = null;
  private gateLines: THREE.LineSegments | null = null;
  private currentSystems: SystemData[] = []; // Store current systems for hover mapping
  
  private circleTexture: THREE.Texture;
  private labelRenderer: CSS2DRenderer;
  
  // Camera reference for text scaling
  private camera: THREE.Camera | null = null;
  
  constructor(options: RegionMap2DOptions) {
    this.scene = options.scene;
    this.mapData = options.mapData;
    // Region/system click callbacks handled via raycasting in parent component
    
    this.regionGroup = new THREE.Group();
    this.systemGroup = new THREE.Group();
    this.labelGroup = new THREE.Group();
    
    this.scene.add(this.regionGroup);
    this.scene.add(this.systemGroup);
    this.scene.add(this.labelGroup);
    
    this.circleTexture = this.createCircleTexture();
    
    // Create CSS2D renderer for scalable text
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0px';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.labelRenderer.domElement.style.zIndex = '1000';
    
    this.computeRegions();
  }
  
  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }
  
  private createCircleTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }
  
  private computeRegions() {
    if (!this.mapData?.solar_systems) return;
    
    const regionMap = new Map<number, SystemData[]>();
    
    // Group systems by region
    for (const sysKey in this.mapData.solar_systems) {
      const sys = this.mapData.solar_systems[sysKey];
      if (!sys || !sys.position || sys.hidden) continue;
      
      const regionId = sys.region_id;
      if (!regionMap.has(regionId)) {
        regionMap.set(regionId, []);
      }
      regionMap.get(regionId)!.push({
        id: sys.id,
        name: sys.name,
        position: sys.position,
        region_id: regionId,
        planets: sys.planets || 0
      });
    }
    
    // Compute region centers and bounds
    let regionIndex = 0;
    for (const [regionId, systems] of regionMap.entries()) {
      if (systems.length === 0) continue;
      
      // Calculate center and bounds
      let sumX = 0, sumY = 0, sumZ = 0;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      
      for (const sys of systems) {
        sumX += sys.position.x;
        sumY += sys.position.y;
        sumZ += sys.position.z;
        
        minX = Math.min(minX, sys.position.x);
        maxX = Math.max(maxX, sys.position.x);
        minY = Math.min(minY, sys.position.y);
        maxY = Math.max(maxY, sys.position.y);
        minZ = Math.min(minZ, sys.position.z);
        maxZ = Math.max(maxZ, sys.position.z);
      }
      
      const count = systems.length;
      
      // Get region name from regions data if available
      let regionName = `Region ${regionId}`;
      if (this.mapData.regions) {
        const regionData = this.mapData.regions[String(regionId)];
        if (regionData?.name) {
          regionName = regionData.name;
        }
      }
      
      // Generate a color based on region ID
      const hue = (regionIndex * 137.5) % 360; // Golden angle for good distribution
      const color = new THREE.Color().setHSL(hue / 360, 0.7, 0.6);
      
      this.regions.set(regionId, {
        id: regionId,
        name: regionName,
        systemCount: count,
        systemIds: systems.map(s => s.id),
        center: {
          x: sumX / count,
          y: sumY / count,
          z: sumZ / count
        },
        color,
        bounds: {
          minX, maxX, minY, maxY, minZ, maxZ
        }
      });
      
      regionIndex++;
    }
    
    console.log(`[RegionMap2D] Computed ${this.regions.size} regions with spatial bounds`);
  }
  
  setViewMode(mode: ViewMode, selectedRegionId?: number) {
    this.viewMode = mode;
    
    if (mode === '2D_REGION_DETAIL' && selectedRegionId !== undefined) {
      this.selectedRegionId = selectedRegionId;
    }
    
    this.rebuild();
  }
  
  getViewMode(): ViewMode {
    return this.viewMode;
  }
  
  getSelectedRegionId(): number | null {
    return this.selectedRegionId;
  }
  
  private rebuild() {
    this.clearAll();
    
    switch (this.viewMode) {
      case '2D_REGIONS':
        this.buildRegionView();
        break;
      case '2D_REGION_DETAIL':
        this.buildRegionDetailView();
        break;
      case '3D':
      default:
        // 3D mode - don't render anything here
        break;
    }
  }
  
  private clearAll() {
    // Clear region meshes
    for (const mesh of this.regionMeshes.values()) {
      this.regionGroup.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
    this.regionMeshes.clear();
    
    // Clear system points
    if (this.systemPoints) {
      this.systemGroup.remove(this.systemPoints);
      this.systemPoints.geometry.dispose();
      if (Array.isArray(this.systemPoints.material)) {
        this.systemPoints.material.forEach(m => m.dispose());
      } else {
        this.systemPoints.material.dispose();
      }
      this.systemPoints = null;
    }
    
    // Clear gate lines
    if (this.gateLines) {
      this.systemGroup.remove(this.gateLines);
      this.gateLines.geometry.dispose();
      if (Array.isArray(this.gateLines.material)) {
        this.gateLines.material.forEach(m => m.dispose());
      } else {
        this.gateLines.material.dispose();
      }
      this.gateLines = null;
    }
    
    // Clear labels
    while (this.labelGroup.children.length > 0) {
      const child = this.labelGroup.children[0];
      this.labelGroup.remove(child);
      // CSS2DObject cleanup
      if ((child as any).element) {
        const elem = (child as any).element;
        elem.remove();
      }
    }
    
    // Clear current systems data
    this.currentSystems = [];
  }
  
  private buildRegionView() {
    const regionArray = Array.from(this.regions.values());
    if (regionArray.length === 0) return;
    
    // Calculate spatial bounds of all regions
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    for (const region of regionArray) {
      minX = Math.min(minX, region.bounds.minX);
      maxX = Math.max(maxX, region.bounds.maxX);
      minZ = Math.min(minZ, region.bounds.minZ);
      maxZ = Math.max(maxZ, region.bounds.maxZ);
    }
    
    // Calculate center of all regions
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    
    // Create exploded view: spread regions from center with consistent spacing
    const baseSpacing = 3000; // Base distance between regions
    const minSpacing = 2000; // Minimum spacing to prevent overlap
    const maxSpacing = 5000; // Maximum spacing for very dense areas
    
    // Calculate relative positions and create exploded layout
    const positions: { x: number; y: number; z: number; region: RegionData }[] = [];
    
    for (const region of regionArray) {
      // Calculate relative position from center
      const relX = region.center.x - centerX;
      const relZ = region.center.z - centerZ;
      const distance = Math.sqrt(relX * relX + relZ * relZ);
      
      // Normalize direction vector
      const dirX = distance > 0 ? relX / distance : 0;
      const dirZ = distance > 0 ? relZ / distance : 0;
      
      // Calculate exploded position with consistent spacing
      const spacing = Math.max(minSpacing, Math.min(maxSpacing, baseSpacing));
      const explodedDistance = Math.max(1000, distance * 0.1 + spacing); // Scale down original distance but add spacing
      
      const x = dirX * explodedDistance;
      const y = 0; // All regions on the same plane
      const z = dirZ * explodedDistance;
      
      positions.push({ x, y, z, region });
    }
    
    // Apply collision detection to prevent overlap
    this.resolveOverlaps(positions, minSpacing);
    
    // Create meshes with smaller, consistent size
    const baseRadius = 400; // Smaller base radius
    const maxRadius = 600; // Maximum radius for very large regions
    
    positions.forEach(({ x, y, z, region }) => {
      // Smaller, more consistent circle size
      const radius = Math.min(maxRadius, baseRadius + (region.systemCount * 2));
      const geometry = new THREE.CircleGeometry(radius, 32);
      const material = new THREE.MeshBasicMaterial({
        color: region.color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.userData = { type: 'region', regionId: region.id };
      
      this.regionGroup.add(mesh);
      this.regionMeshes.set(region.id, mesh);
      
      // Add scalable label
      this.createScalableLabel(region.name, x, y + radius + 150, z, region.systemCount);
    });
    
    console.log(`[RegionMap2D] Built exploded region view with ${regionArray.length} regions`);
  }
  
  private resolveOverlaps(positions: { x: number; y: number; z: number; region: RegionData }[], minSpacing: number) {
    const maxIterations = 10;
    let iterations = 0;
    
    while (iterations < maxIterations) {
      let hasOverlaps = false;
      
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const pos1 = positions[i];
          const pos2 = positions[j];
          
          const dx = pos1.x - pos2.x;
          const dz = pos1.z - pos2.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          
          if (distance < minSpacing) {
            hasOverlaps = true;
            
            // Calculate separation vector
            const separation = minSpacing - distance;
            const dirX = distance > 0 ? dx / distance : (Math.random() - 0.5);
            const dirZ = distance > 0 ? dz / distance : (Math.random() - 0.5);
            
            // Move regions apart
            const moveX = dirX * separation * 0.5;
            const moveZ = dirZ * separation * 0.5;
            
            pos1.x += moveX;
            pos1.z += moveZ;
            pos2.x -= moveX;
            pos2.z -= moveZ;
          }
        }
      }
      
      if (!hasOverlaps) break;
      iterations++;
    }
  }
  
  private createGateConnections(systems: SystemData[], systemPositions: Map<number, { x: number; y: number }>) {
    if (!this.mapData?.stargates) return;
    
    const systemMap = new Map<number, SystemData>();
    for (const sys of systems) {
      systemMap.set(sys.id, sys);
    }
    
    const lineVertices: number[] = [];
    const lineColors: number[] = [];
    
    // Find gates between systems in this region
    let gateCount = 0;
    for (const gateKey in this.mapData.stargates) {
      const gate = this.mapData.stargates[gateKey];
      if (!gate || !gate.source_system_id || !gate.destination_system_id) continue;
      
      const sourceSys = systemMap.get(gate.source_system_id);
      const destSys = systemMap.get(gate.destination_system_id);
      
      if (!sourceSys || !destSys) continue; // Skip gates to systems outside this region
      
      gateCount++;
      console.log(`[RegionMap2D] Gate ${gateCount}: ${sourceSys.name} -> ${destSys.name}`);
      
      // Get positions from the connection-aware layout
      const sourcePos = systemPositions.get(sourceSys.id);
      const destPos = systemPositions.get(destSys.id);
      
      if (!sourcePos || !destPos) continue;
      
      // Create orthogonal metro-style connections
      const midX = (sourcePos.x + destPos.x) / 2;
      
      // Add line vertices for orthogonal path: source -> mid -> dest
      lineVertices.push(sourcePos.x, sourcePos.y, 0); // Start point
      lineVertices.push(midX, sourcePos.y, 0);       // First corner
      lineVertices.push(midX, sourcePos.y, 0);       // Second corner (same point)
      lineVertices.push(midX, destPos.y, 0);         // Third corner
      lineVertices.push(midX, destPos.y, 0);         // Fourth corner (same point)
      lineVertices.push(destPos.x, destPos.y, 0);    // End point
      
      // Add colors (light gray for gates like in screenshot)
      lineColors.push(0.7, 0.7, 0.7); // Start color
      lineColors.push(0.7, 0.7, 0.7); // First corner
      lineColors.push(0.7, 0.7, 0.7); // Second corner
      lineColors.push(0.7, 0.7, 0.7); // Third corner
      lineColors.push(0.7, 0.7, 0.7); // Fourth corner
      lineColors.push(0.7, 0.7, 0.7); // End color
    }
    
    if (lineVertices.length > 0) {
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lineVertices, 3));
      lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
      
      const lineMaterial = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        linewidth: 2
      });
      
      this.gateLines = new THREE.LineSegments(lineGeometry, lineMaterial);
      this.systemGroup.add(this.gateLines);
      
      console.log(`[RegionMap2D] Created ${lineVertices.length / 6} gate connections`);
    }
  }
  
  private createSystemLabels(systems: SystemData[], connectedSystemIds: Set<number>, systemPositions: Map<number, { x: number; y: number }>) {
    for (let i = 0; i < systems.length; i++) {
      const sys = systems[i];
      const pos = systemPositions.get(sys.id);
      
      if (!pos) continue;
      
      const x = pos.x;
      const y = pos.y;
      const z = 0;
      
      // Create system label with planet count
      const labelDiv = document.createElement('div');
      labelDiv.className = 'system-2d-label';
      
      // Create two-line label like in screenshot
      const nameDiv = document.createElement('div');
      nameDiv.textContent = sys.name;
      nameDiv.style.cssText = `
        color: white;
        font-family: system-ui, sans-serif;
        font-size: 12px;
        font-weight: 600;
        text-shadow: 0 0 8px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.7);
        text-align: center;
        line-height: 1.2;
      `;
      
      const planetDiv = document.createElement('div');
      planetDiv.textContent = `${sys.planets} Planets`;
      planetDiv.style.cssText = `
        color: white;
        font-family: system-ui, sans-serif;
        font-size: 10px;
        font-weight: 400;
        text-shadow: 0 0 8px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.7);
        text-align: center;
        line-height: 1.2;
        opacity: 0.8;
      `;
      
      labelDiv.appendChild(nameDiv);
      labelDiv.appendChild(planetDiv);
      
      labelDiv.style.cssText = `
        pointer-events: none;
        user-select: none;
        white-space: nowrap;
        text-align: center;
        transform-origin: center;
        opacity: 0.9;
      `;
      
      const label = new CSS2DObject(labelDiv);
      label.position.set(x, y + 20, z); // Offset slightly above the system point
      
      // Show all labels by default (like in screenshot)
      label.visible = true;
      
      this.labelGroup.add(label);
      
      // Store reference for scaling and system info
      (label as any).labelDiv = labelDiv;
      (label as any).systemId = sys.id;
      (label as any).isConnected = connectedSystemIds.has(sys.id);
    }
  }
  
  private layoutSystemsMetro(systems: SystemData[]): Map<number, { x: number; y: number }> {
    const positions = new Map<number, { x: number; y: number }>();
    const cellSize = 400;
    
    // Build adjacency list for connected systems
    const adjacencyList = new Map<number, number[]>();
    for (const sys of systems) {
      adjacencyList.set(sys.id, []);
    }
    
    // Add edges based on stargates
    if (this.mapData?.stargates) {
      for (const gateKey in this.mapData.stargates) {
        const gate = this.mapData.stargates[gateKey];
        if (!gate || !gate.source_system_id || !gate.destination_system_id) continue;
        
        const sourceSys = systems.find(s => s.id === gate.source_system_id);
        const destSys = systems.find(s => s.id === gate.destination_system_id);
        
        if (sourceSys && destSys) {
          adjacencyList.get(sourceSys.id)?.push(destSys.id);
          adjacencyList.get(destSys.id)?.push(sourceSys.id);
        }
      }
    }
    
    // Find connected components (groups of systems that can reach each other)
    const visited = new Set<number>();
    const components: number[][] = [];
    
    for (const sys of systems) {
      if (!visited.has(sys.id)) {
        const component: number[] = [];
        this.dfsComponent(sys.id, adjacencyList, visited, component);
        if (component.length > 0) {
          components.push(component);
        }
      }
    }
    
    console.log(`[RegionMap2D] Found ${components.length} connected components`);
    
    // Layout each component separately
    let currentX = 0;
    let currentY = 0;
    
    for (const component of components) {
      console.log(`[RegionMap2D] Layouting component with ${component.length} systems:`, 
        component.map(id => systems.find(s => s.id === id)?.name).join(', '));
      
      // Layout this component using a simple grid
      const gridSize = Math.ceil(Math.sqrt(component.length));
      const startX = currentX;
      const startY = currentY;
      
      for (let i = 0; i < component.length; i++) {
        const systemId = component[i];
        const row = Math.floor(i / gridSize);
        const col = i % gridSize;
        const x = startX + col * cellSize;
        const y = startY + row * cellSize;
        
        positions.set(systemId, { x, y });
      }
      
      // Move to next component position
      currentX += (gridSize + 1) * cellSize;
      if (currentX > 2000) {
        currentX = 0;
        currentY += (Math.ceil(Math.sqrt(component.length)) + 1) * cellSize;
      }
    }
    
    console.log(`[RegionMap2D] Layout complete: ${positions.size} systems positioned`);
    return positions;
  }
  
  private dfsComponent(systemId: number, adjacencyList: Map<number, number[]>, visited: Set<number>, component: number[]) {
    if (visited.has(systemId)) return;
    
    visited.add(systemId);
    component.push(systemId);
    
    const neighbors = adjacencyList.get(systemId) || [];
    for (const neighborId of neighbors) {
      this.dfsComponent(neighborId, adjacencyList, visited, component);
    }
  }

  private createScalableLabel(text: string, x: number, y: number, z: number, systemCount: number) {
    const labelDiv = document.createElement('div');
    labelDiv.className = 'region-2d-label';
    labelDiv.textContent = text;
    labelDiv.style.cssText = `
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 16px;
      font-weight: 600;
      text-shadow: 0 0 8px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.6);
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
      text-align: center;
      transform-origin: center;
    `;
    
    const label = new CSS2DObject(labelDiv);
    label.position.set(x, y, z);
    this.labelGroup.add(label);
    
    // Add system count label
    const countDiv = document.createElement('div');
    countDiv.className = 'region-2d-count';
    countDiv.textContent = `${systemCount} systems`;
    countDiv.style.cssText = `
      color: rgba(255,255,255,0.7);
      font-family: system-ui, sans-serif;
      font-size: 12px;
      text-shadow: 0 0 6px rgba(0,0,0,0.8);
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
      text-align: center;
      transform-origin: center;
    `;
    
    const countLabel = new CSS2DObject(countDiv);
    countLabel.position.set(x, y - 180, z);
    this.labelGroup.add(countLabel);
    
    // Store references for scaling
    (label as any).labelDiv = labelDiv;
    (countLabel as any).labelDiv = countDiv;
  }
  
  private buildRegionDetailView() {
    if (this.selectedRegionId === null) return;
    
    const region = this.regions.get(this.selectedRegionId);
    if (!region) return;
    
    // Get all systems in this region
    const systems: SystemData[] = [];
    for (const sysKey in this.mapData.solar_systems) {
      const sys = this.mapData.solar_systems[sysKey];
      if (!sys || !sys.position || sys.hidden) continue;
      if (sys.region_id !== this.selectedRegionId) continue;
      
      systems.push({
        id: sys.id,
        name: sys.name,
        position: sys.position,
        region_id: sys.region_id,
        planets: sys.planets || 0
      });
    }
    
    if (systems.length === 0) return;
    
    // First, determine which systems are connected by gates
    const connectedSystemIds = new Set<number>();
    
    if (this.mapData?.stargates) {
      for (const gateKey in this.mapData.stargates) {
        const gate = this.mapData.stargates[gateKey];
        if (!gate || !gate.source_system_id || !gate.destination_system_id) continue;
        
        const sourceSys = systems.find(s => s.id === gate.source_system_id);
        const destSys = systems.find(s => s.id === gate.destination_system_id);
        
        if (sourceSys && destSys) {
          connectedSystemIds.add(sourceSys.id);
          connectedSystemIds.add(destSys.id);
        }
      }
    }
    
    // Show all systems in the region, but only draw connections between connected ones
    const connectedSystems = systems; // Show all systems
    console.log(`[RegionMap2D] Showing ${connectedSystems.length} systems in region`);
    console.log(`[RegionMap2D] Connected system IDs:`, Array.from(connectedSystemIds));
    console.log(`[RegionMap2D] All systems in region:`, systems.map(s => `${s.name} (${s.id})`));
    
    // Store systems data for hover mapping
    this.currentSystems = connectedSystems;
    
    // Find bounding box of systems in 3D
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    for (const sys of systems) {
      minX = Math.min(minX, sys.position.x);
      maxX = Math.max(maxX, sys.position.x);
      minY = Math.min(minY, sys.position.y);
      maxY = Math.max(maxY, sys.position.y);
      minZ = Math.min(minZ, sys.position.z);
      maxZ = Math.max(maxZ, sys.position.z);
    }
    
    // Calculate bounds for reference (not used in metro layout)
    const rangeX = maxX - minX;
    const rangeZ = maxZ - minZ;
    
    // Connection-aware metro layout
    const systemPositions = this.layoutSystemsMetro(connectedSystems);
    
    const vertices: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    
    for (let i = 0; i < connectedSystems.length; i++) {
      const sys = connectedSystems[i];
      const pos = systemPositions.get(sys.id);
      
      if (!pos) continue;
      
      vertices.push(pos.x, pos.y, 0);
      
      // Color based on connection status
      const isConnected = connectedSystemIds.has(sys.id);
      if (isConnected) {
        colors.push(1.0, 0.5, 0.2); // Orange for connected systems
      } else {
        colors.push(1.0, 0.3, 0.3); // Red for unconnected systems
      }
      sizes.push(1.2);
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    
    const material = new THREE.PointsMaterial({
      size: 8,
      sizeAttenuation: true,
      vertexColors: true,
      map: this.circleTexture,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    
    this.systemPoints = new THREE.Points(geometry, material);
    this.systemGroup.add(this.systemPoints);
    
    console.log('[RegionMap2D] Created system points with', systems.length, 'systems');
    console.log('[RegionMap2D] System points geometry:', this.systemPoints.geometry);
    console.log('[RegionMap2D] System points material:', this.systemPoints.material);
    
    // Create gate connections between connected systems only
    this.createGateConnections(connectedSystems, systemPositions);
    
    // Add system labels for all systems
    this.createSystemLabels(connectedSystems, connectedSystemIds, systemPositions);
    
    // Add region title
    const titleDiv = document.createElement('div');
    titleDiv.className = 'region-detail-title';
    titleDiv.textContent = region.name;
    titleDiv.style.cssText = `
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 24px;
      font-weight: 700;
      text-shadow: 0 0 12px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.7);
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
      text-align: center;
    `;
    
    const maxRange = Math.max(rangeX, rangeZ) * 1.2; // Use fixed scale for metro layout
    const titleLabel = new CSS2DObject(titleDiv);
    titleLabel.position.set(0, maxRange / 2 + 1000, 0);
    this.labelGroup.add(titleLabel);
    
    console.log(`[RegionMap2D] Built region detail view for region ${region.name} with ${systems.length} systems`);
  }
  
  /**
   * Update text scaling based on camera distance
   */
  updateTextScaling() {
    if (!this.camera || this.viewMode !== '2D_REGIONS') return;
    
    // Calculate distance from camera to center of regions
    const distance = this.camera.position.length();
    const scale = Math.max(0.5, Math.min(2.0, 20000 / distance));
    
    // Update all labels
    for (const child of this.labelGroup.children) {
      const label = child as CSS2DObject;
      const labelDiv = (label as any).labelDiv;
      if (labelDiv) {
        labelDiv.style.transform = `scale(${scale})`;
      }
    }
  }
  
  /**
   * Handle raycasting to detect system hover in region detail view
   * Returns the system ID if a system was hovered, null otherwise
   */
  raycastSystems(raycaster: THREE.Raycaster): number | null {
    if (this.viewMode !== '2D_REGION_DETAIL' || !this.systemPoints) {
      console.log('[RegionMap2D] Raycast skipped - viewMode:', this.viewMode, 'systemPoints:', !!this.systemPoints);
      return null;
    }
    
    const intersects = raycaster.intersectObject(this.systemPoints);
    console.log('[RegionMap2D] Raycast intersects:', intersects.length);
    
    if (intersects.length > 0 && intersects[0].index !== undefined) {
      const systemIndex = intersects[0].index;
      console.log('[RegionMap2D] System index:', systemIndex, 'total systems:', this.currentSystems.length);
      
      // Map the index to the actual system ID
      if (systemIndex >= 0 && systemIndex < this.currentSystems.length) {
        const systemId = this.currentSystems[systemIndex].id;
        console.log('[RegionMap2D] Mapped to system ID:', systemId, 'system name:', this.currentSystems[systemIndex].name);
        return systemId;
      } else {
        console.log('[RegionMap2D] Index out of bounds:', systemIndex, '>=', this.currentSystems.length);
      }
    }
    
    return null;
  }
  
  /**
   * Show/hide system labels on hover
   */
  handleSystemHover(systemId: number | null) {
    if (this.viewMode !== '2D_REGION_DETAIL') return;
    
    // Debug logging
    if (systemId !== null) {
      console.log('[RegionMap2D] Hovering system ID:', systemId);
    }
    
    // Update all system labels
    for (const child of this.labelGroup.children) {
      const label = child as CSS2DObject;
      const systemId_attr = (label as any).systemId;
      const isConnected = (label as any).isConnected;
      
      if (systemId_attr !== undefined) {
        // Show label if system is connected OR if it's being hovered
        const shouldShow = isConnected || (systemId === systemId_attr);
        label.visible = shouldShow;
        
        // Debug logging for unconnected systems
        if (!isConnected && systemId === systemId_attr) {
          console.log('[RegionMap2D] Showing label for unconnected system:', systemId_attr);
        }
      }
    }
  }
  
  /**
   * Handle raycasting to detect clicks on regions
   * Returns the region ID if a region was clicked, null otherwise
   */
  raycastRegions(raycaster: THREE.Raycaster): number | null {
    if (this.viewMode !== '2D_REGIONS') return null;
    
    const intersects = raycaster.intersectObjects(Array.from(this.regionMeshes.values()));
    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      const regionId = mesh.userData.regionId;
      if (typeof regionId === 'number') {
        return regionId;
      }
    }
    
    return null;
  }
  
  setVisible(visible: boolean) {
    this.regionGroup.visible = visible;
    this.systemGroup.visible = visible;
    this.labelGroup.visible = visible;
  }
  
  dispose() {
    this.clearAll();
    this.scene.remove(this.regionGroup);
    this.scene.remove(this.systemGroup);
    this.scene.remove(this.labelGroup);
    this.circleTexture.dispose();
    // CSS2DRenderer doesn't have dispose method, just remove DOM element
    if (this.labelRenderer.domElement.parentNode) {
      this.labelRenderer.domElement.parentNode.removeChild(this.labelRenderer.domElement);
    }
  }
}

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
  private lockedRegionId: number | null = null; // Locked region for search results
  
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
    
    console.log(`[RegionMap2D] Applying force-directed layout to ${regionArray.length} regions`);
    console.log(`[RegionMap2D] LabelGroup children before build: ${this.labelGroup.children.length}`);
    
    // Extract 3D coordinates of region centers for initial positioning
    const coordinates3D = regionArray.map(region => [
      region.center.x, 
      region.center.y, 
      region.center.z
    ]);
    
    // Apply PCA to get initial 2D projection
    const coordinates2D = this.applyPCA(coordinates3D);
    
    // Apply force-directed layout with grid constraints
    const finalPositions = this.applyForceDirectedLayout(regionArray, coordinates2D);
    
    // Create meshes with radius based on actual spatial extent of systems
    const baseRadius = 10; // Minimum radius
    const maxRadius = 1000; // Maximum radius
    
    for (let i = 0; i < regionArray.length; i++) {
      const region = regionArray[i];
      const position = finalPositions[i];
      
      // Calculate radius based on the spatial extent of systems within the region
      let maxDistance = 0;
      if (this.mapData?.solar_systems) {
        for (const systemId of region.systemIds) {
          const system = this.mapData.solar_systems[systemId];
          if (system && system.position) {
            const dx = system.position.x - region.center.x;
            const dy = system.position.y - region.center.y;
            const dz = system.position.z - region.center.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            maxDistance = Math.max(maxDistance, distance);
          }
        }
      }
      
      // Apply logarithmic scaling to compress large values (better for wide range)
      const scaleFactor = 0.02; // Base scaling factor
      const linearRadius = maxDistance * scaleFactor;
      
      // Logarithmic: log(1 + x) to handle small values gracefully
      const logRadius = Math.log(1 + linearRadius) * 8; // Multiply to adjust overall size
      
      // Exponential: pow(x, exponent) for comparison
      const exponent = 0.8;
      const exponentialRadius = Math.pow(linearRadius, exponent) * 5
      
      // Choose which to use: logarithmic or exponential
      const useLogarithmic = false; // Set to false to use exponential
      const scaledRadius = useLogarithmic ? logRadius : exponentialRadius;
      
      const radius = Math.min(maxRadius, Math.max(baseRadius, scaledRadius));
      console.log(`[RegionMap2D] Region ${region.name}: radius=${radius.toFixed(1)}, maxDist=${maxDistance.toFixed(0)}, linear=${linearRadius.toFixed(1)}, log=${logRadius.toFixed(1)}, expo=${exponentialRadius.toFixed(1)}`);
      // Use a sphere geometry for better raycasting
      const geometry = new THREE.SphereGeometry(radius, 16, 16);
      const material = new THREE.MeshBasicMaterial({
        color: region.color,
        transparent: true,
        opacity: 0.8, // Slightly more opaque for better visibility
        side: THREE.DoubleSide
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(position.x, position.y, 0); // Use 2D coordinates, Z=0 for 2D view
      // Scale the mesh to be larger for better raycasting
      mesh.scale.set(1, 1, 1);
      mesh.userData = { type: 'region', regionId: region.id };
      
      this.regionGroup.add(mesh);
      this.regionMeshes.set(region.id, mesh);
      
      console.log(`[RegionMap2D] Created region mesh for ${region.name} (ID: ${region.id}) at position (${position.x}, ${position.y}, 0)`);
      
      // Add scalable label (hidden by default, shown on hover)
      const label = this.createScalableLabel(region.name, position.x, position.y, region.systemCount, radius, false);
      // Set region ID for hover detection
      if (label) {
        label.userData.regionId = region.id;
        console.log(`[RegionMap2D] Created combined label for region ${region.id} (${region.name})`);
      }
    }
    
    // Add metro-style connections between regions
    this.createMetroConnections(regionArray, finalPositions);
    
    console.log(`[RegionMap2D] LabelGroup children after build: ${this.labelGroup.children.length}`);
    console.log(`[RegionMap2D] RegionMeshes count: ${this.regionMeshes.size}`);
    console.log(`[RegionMap2D] Built region view with ${regionArray.length} regions`);
    
    
    console.log(`[RegionMap2D] Built force-directed region view with ${regionArray.length} regions`);
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
    
    if (systems.length === 0) return positions;
    
    console.log(`[RegionMap2D] Applying PCA layout to ${systems.length} systems`);
    
    // Extract 3D coordinates
    const coordinates3D = systems.map(sys => [sys.position.x, sys.position.y, sys.position.z]);
    
    // Apply PCA to get 2D projection
    const coordinates2D = this.applyPCA(coordinates3D);
    
    // Scale the 2D coordinates to preserve natural shape
    const scale = 300; // Smaller scale to preserve natural clustering
    const scaledCoords = this.scaleCoordinates(coordinates2D, scale);
    
    // Assign positions to systems
    for (let i = 0; i < systems.length; i++) {
      const sys = systems[i];
      const coord = scaledCoords[i];
      positions.set(sys.id, { x: coord[0], y: coord[1] });
    }
    
    console.log(`[RegionMap2D] PCA layout complete: ${positions.size} systems positioned`);
    return positions;
  }
  
  private applyPCA(coordinates3D: number[][]): number[][] {
    const n = coordinates3D.length;
    if (n === 0) return [];
    
    // Step 1: Center the data (subtract mean)
    const mean = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      mean[0] += coordinates3D[i][0];
      mean[1] += coordinates3D[i][1];
      mean[2] += coordinates3D[i][2];
    }
    mean[0] /= n;
    mean[1] /= n;
    mean[2] /= n;
    
    const centered = coordinates3D.map(coord => [
      coord[0] - mean[0],
      coord[1] - mean[1],
      coord[2] - mean[2]
    ]);
    
    // Step 2: Compute covariance matrix
    const covariance = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    
    for (let i = 0; i < n; i++) {
      const [x, y, z] = centered[i];
      covariance[0][0] += x * x;
      covariance[0][1] += x * y;
      covariance[0][2] += x * z;
      covariance[1][0] += y * x;
      covariance[1][1] += y * y;
      covariance[1][2] += y * z;
      covariance[2][0] += z * x;
      covariance[2][1] += z * y;
      covariance[2][2] += z * z;
    }
    
    // Normalize by n-1
    const factor = 1 / (n - 1);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        covariance[i][j] *= factor;
      }
    }
    
    // Step 3: Find eigenvalues and eigenvectors (simplified 2D projection)
    // For simplicity, we'll use the first two principal components
    // In a full implementation, you'd solve the eigenvalue problem
    
    // Simple approach: project onto XY plane and rotate for best fit
    const coordinates2D = centered.map(coord => [coord[0], coord[1]]);
    
    // Calculate explained variance (simplified)
    const totalVariance = covariance[0][0] + covariance[1][1] + covariance[2][2];
    const explainedVariance = (covariance[0][0] + covariance[1][1]) / totalVariance;
    
    console.log(`[RegionMap2D] PCA explained variance: ${(explainedVariance * 100).toFixed(1)}%`);
    
    return coordinates2D;
  }
  
  private scaleCoordinates(coordinates2D: number[][], baseScale: number): number[][] {
    if (coordinates2D.length === 0) return [];
    
    // Find the range of coordinates
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const coord of coordinates2D) {
      minX = Math.min(minX, coord[0]);
      maxX = Math.max(maxX, coord[0]);
      minY = Math.min(minY, coord[1]);
      maxY = Math.max(maxY, coord[1]);
    }
    
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const maxRange = Math.max(rangeX, rangeY);
    
    // Scale to fit within a reasonable viewport
    const scale = maxRange > 0 ? baseScale / maxRange : 1;
    
    return coordinates2D.map(coord => [
      coord[0] * scale,
      coord[1] * scale
    ]);
  }
  
  private applyForceDirectedLayout(regions: RegionData[], initialCoords: number[][]): { x: number; y: number }[] {
    const n = regions.length;
    if (n === 0) return [];
    
    // Use PCA coordinates directly - preserve the natural organic shape
    const positions = initialCoords.map(coord => ({ x: coord[0], y: coord[1] }));
    
    // Calculate the natural bounds from PCA
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const coord of initialCoords) {
      minX = Math.min(minX, coord[0]);
      maxX = Math.max(maxX, coord[0]);
      minY = Math.min(minY, coord[1]);
      maxY = Math.max(maxY, coord[1]);
    }
    
    // Calculate natural aspect ratio
    const aspectRatio = (maxX - minX) / (maxY - minY);
    const naturalWidth = maxX - minX;
    const naturalHeight = maxY - minY;
    
    console.log(`[RegionMap2D] Preserving natural shape: ${n} regions, aspect ratio: ${aspectRatio.toFixed(2)}`);
    console.log(`[RegionMap2D] Natural bounds: ${naturalWidth.toFixed(0)} x ${naturalHeight.toFixed(0)}`);
    
    // Force-directed adjustment to reduce overlap
    const iterations = 50; // More iterations for better spacing
    const coolingFactor = 0.95;
    let temperature = 200;
    
    for (let iter = 0; iter < iterations; iter++) {
      const forces = positions.map(() => ({ x: 0, y: 0 }));
      
      // Very gentle repulsion - only for severe overlaps
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = positions[i].x - positions[j].x;
          const dy = positions[i].y - positions[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance > 0 && distance < 120) { // Increase repulsion distance
            const force = (120 - distance) * 0.3; // Stronger repulsion to reduce overlap
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;
            
            forces[i].x += fx;
            forces[i].y += fy;
            forces[j].x -= fx;
            forces[j].y -= fy;
          }
        }
      }
      
      // Apply minimal forces
      for (let i = 0; i < n; i++) {
        const movement = Math.min(temperature, 5); // Very small movements
        positions[i].x += (forces[i].x * movement) / 1000;
        positions[i].y += (forces[i].y * movement) / 1000;
      }
      
      temperature *= coolingFactor;
    }
    
    console.log(`[RegionMap2D] Natural shape preserved with minimal adjustments`);
    return positions;
  }
  

  private createMetroConnections(regions: RegionData[], positions: { x: number; y: number }[]) {
    if (!this.mapData?.stargates) return;
    
    console.log(`[RegionMap2D] Creating metro-style connections between regions`);
    
    // Find connections between regions based on stargates
    const regionConnections = new Map<number, Set<number>>();
    
    // Initialize connection map
    for (const region of regions) {
      regionConnections.set(region.id, new Set());
    }
    
    // Find connections through stargates
    for (const gateKey in this.mapData.stargates) {
      const gate = this.mapData.stargates[gateKey];
      if (!gate || !gate.source_system_id || !gate.destination_system_id) continue;
      
      // Find which regions these systems belong to
      const sourceRegion = regions.find(r => r.systemIds.includes(gate.source_system_id));
      const destRegion = regions.find(r => r.systemIds.includes(gate.destination_system_id));
      
      if (sourceRegion && destRegion && sourceRegion.id !== destRegion.id) {
        regionConnections.get(sourceRegion.id)?.add(destRegion.id);
        regionConnections.get(destRegion.id)?.add(sourceRegion.id);
      }
    }
    
    // Create metro-style connections
    for (const region of regions) {
      const regionPos = positions[regions.indexOf(region)];
      const connections = regionConnections.get(region.id);
      
      if (connections) {
        for (const connectedRegionId of connections) {
          const connectedRegion = regions.find(r => r.id === connectedRegionId);
          if (connectedRegion) {
            const connectedPos = positions[regions.indexOf(connectedRegion)];
            
            // Create Manhattan-style (orthogonal) path
            this.createManhattanPath(regionPos, connectedPos, region.id, connectedRegionId);
          }
        }
      }
    }
    
    console.log(`[RegionMap2D] Created metro connections for ${regions.length} regions`);
  }
  
  private createManhattanPath(start: { x: number; y: number }, end: { x: number; y: number }, regionId1: number, regionId2: number) {
    // Manhattan path: go horizontal first, then vertical (or vice versa)
    const midX = (start.x + end.x) / 2;
    
    // Create path points
    const points = [
      new THREE.Vector3(start.x, start.y, 0),
      new THREE.Vector3(midX, start.y, 0), // Horizontal segment
      new THREE.Vector3(midX, end.y, 0),   // Vertical segment
      new THREE.Vector3(end.x, end.y, 0)
    ];
    
    // Create geometry
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x666666, // Light gray
      transparent: true,
      opacity: 0.6,
      linewidth: 1
    });
    
    const line = new THREE.Line(geometry, material);
    line.userData = { 
      type: 'metro-connection', 
      regionId1, 
      regionId2 
    };
    
    this.regionGroup.add(line);
  }

  private createScalableLabel(text: string, x: number, y: number, systemCount: number, radius: number, visible: boolean = true) {
    // Create a single container with both labels using fixed pixel spacing
    const containerDiv = document.createElement('div');
    containerDiv.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: none;
      user-select: none;
    `;
    
    // Region name label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'region-2d-label';
    labelDiv.textContent = text;
    labelDiv.style.cssText = `
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 16px;
      font-weight: 600;
      text-shadow: 0 0 8px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.6);
      white-space: nowrap;
      text-align: center;
    `;
    
    // System count label
    const countDiv = document.createElement('div');
    countDiv.className = 'region-2d-count';
    countDiv.textContent = `${systemCount} systems`;
    countDiv.style.cssText = `
      color: rgba(255,255,255,0.7);
      font-family: system-ui, sans-serif;
      font-size: 12px;
      text-shadow: 0 0 6px rgba(0,0,0,0.8);
      white-space: nowrap;
      text-align: center;
    `;
    
    containerDiv.appendChild(labelDiv);
    containerDiv.appendChild(countDiv);
    
    // Create single CSS2D object with both labels
    const label = new CSS2DObject(containerDiv);
    label.position.set(x, y + radius + 20, 0); // Position above the circle
    label.visible = visible;
    this.labelGroup.add(label);
    
    console.log(`[RegionMap2D] Added combined label to labelGroup at position (${x}, ${y + radius + 20}, 0), visible: ${visible}`);
    
    // Store references for hover management
    (label as any).labelDiv = containerDiv;
    
    // Store region info for hover detection
    label.userData = { type: 'region-label', regionId: null }; // Will be set by caller
    
    return label;
  }
  
  // Region hover detection methods
  public handleRegionHover(regionId: number | null, lock: boolean = false) {
    if (this.viewMode !== '2D_REGIONS') return;

    // If lock is true, set the locked region
    if (lock && regionId !== null) {
      this.lockedRegionId = regionId;
      console.log(`[RegionMap2D] Locked region: ${regionId}`);
    }
    
    // Hide all region labels first
    this.labelGroup.children.forEach(child => {
      if (child.userData.type === 'region-label') {
        child.visible = false;
      }
    });
    
    // Show locked region label (from search) - always visible
    if (this.lockedRegionId !== null) {
      this.labelGroup.children.forEach(child => {
        if (child.userData.type === 'region-label' && Number(child.userData.regionId) === Number(this.lockedRegionId)) {
          child.visible = true;
        }
      });
    }
    
    // Show hovered region label (if hovering and different from locked)
    if (regionId !== null && regionId !== this.lockedRegionId) {
      this.labelGroup.children.forEach(child => {
        if (child.userData.type === 'region-label' && Number(child.userData.regionId) === Number(regionId)) {
          child.visible = true;
        }
      });
      console.log(`[RegionMap2D] Showing labels for locked region: ${this.lockedRegionId} and hovered region: ${regionId}`);
    } else if (regionId !== null) {
      console.log(`[RegionMap2D] Showing labels for region: ${regionId}`);
    }
  }
  
  // Unlock region (for clearing search results)
  // Returns true if a region was unlocked (to trigger camera reset in parent)
  public unlockRegion(): boolean {
    const wasLocked = this.lockedRegionId !== null;
    this.lockedRegionId = null;
    this.handleRegionHover(null);
    return wasLocked;
  }
  
  // Get the 2D position of a region (after PCA transformation)
  public getRegion2DPosition(regionId: number | string): { x: number; y: number } | null {
    const numericId = Number(regionId);
    const mesh = this.regionMeshes.get(numericId);
    
    if (!mesh) {
      return null;
    }
    
    return { x: mesh.position.x, y: mesh.position.y };
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
    
    // CSS2D labels already maintain constant screen size automatically
    // No transform scaling needed - they're rendered in screen space
    // Just ensure labels are visible and properly positioned
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
    if (this.viewMode !== '2D_REGIONS') {
      return null;
    }
    
    const regionMeshes = Array.from(this.regionMeshes.values());
    if (regionMeshes.length === 0) {
      return null;
    }
    
    // Create a proper raycaster using the camera
    if (!this.camera) {
      console.log(`[RegionMap2D] No camera available for raycasting`);
      return null;
    }
    
    // Use the raycaster that was passed in - it should already be set up correctly
    const intersects = raycaster.intersectObjects(regionMeshes);
    
    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      const regionId = mesh.userData.regionId;
      console.log(`[RegionMap2D] raycastRegions: hit region ${regionId}`);
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

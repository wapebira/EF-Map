# 2D Region View Documentation

## Overview

The 2D Region View provides an interactive, flat visualization of EVE Frontier regions and their systems, making it easier to explore spatial relationships without the complexity of 3D navigation.

## Features

### Region Overview Mode (`2D_REGIONS`)
- Displays all regions as circles on a 2D plane
- Preserves spatial relationships from 3D map using PCA (Principal Component Analysis)
- Region sizes are based on actual spatial extent of systems within each region
- Hover over regions to see name and system count
- Click on a region to drill down into its systems

### Region Detail Mode (`2D_REGION_DETAIL`)
- Shows systems within a selected region in 2D
- Displays stargate connections between systems
- Metro-style layout for connected systems
- Hover labels for system names

## Implementation Details

### Spatial Projection (PCA)
The 3D region centers are projected to 2D using Principal Component Analysis:
1. Centers 3D coordinates by subtracting mean
2. Computes covariance matrix
3. Projects onto first two principal components
4. Preserves variance and relative spatial relationships

### Force-Directed Layout
After PCA projection, a force-directed algorithm prevents overlaps:
- **Iterations**: 50
- **Repulsion distance**: 120 units
- **Repulsion force**: 0.3 multiplier
- **Temperature**: 200 (initial), cools by 0.95 each iteration
- Preserves natural shape while minimizing overlap

### Region Sizing
Region circle radius is calculated based on actual spatial extent:

```typescript
// Calculate max distance from region center to any system
maxDistance = max(distance(system.position, region.center))

// Apply exponential scaling
linearRadius = maxDistance * 0.02
exponentialRadius = pow(linearRadius, 0.8) * 5
radius = clamp(exponentialRadius, baseRadius, maxRadius)
```

**Parameters:**
- `baseRadius`: 10 (minimum size)
- `maxRadius`: 1000 (maximum size)
- `exponent`: 0.8 (compresses size range)
- `scaleFactor`: 0.02 (base scaling)

**Scaling Options:**
- **Exponential** (current): `pow(x, 0.8)` - compresses range, prevents huge regions
- **Logarithmic** (alternative): `log(1 + x)` - more uniform sizes, better for extreme ranges

### Hover Detection
- Creates raycaster from camera position based on mouse coordinates
- Performs intersection tests with region sphere geometries
- Uses SphereGeometry (instead of CircleGeometry) for reliable raycasting
- Shows CSS2D labels on hover with region name and system count

### Camera Controls
- **Position**: `(0, 0, camera_distance)` - looking down from above
- **Target**: `(0, 0, 0)` - center of map
- **Controls**: Rotation disabled in 2D mode, zoom and pan enabled
- **Transition**: Smooth camera animation when switching views

## Visual Design

### Region Colors
- Each region retains its original color from the 3D map
- Semi-transparent circles (opacity: 0.8) allow visibility of overlaps
- DoubleSide material ensures visibility from any angle

### Labels
- CSS2D labels that always face the camera
- Hidden by default, shown only on hover
- Two-part labels: region name and system count
- Positioned above region circles

### Metro Connections (Region Detail)
- Manhattan-style orthogonal paths between regions
- Identifies stargate connections between regions
- Light gray lines connecting related regions

## User Interface

### View Switching
- **3D button**: Return to 3D view
- **Regions button**: Switch to 2D region overview
- **Back button**: Return to region overview from detail view (when in detail mode)

### Interaction
- **Hover**: Show region name and system count
- **Click**: Drill down into region to see its systems
- **Pan**: Drag to move around the map
- **Zoom**: Scroll to zoom in/out
- **Rotation**: Disabled in 2D modes

## Technical Notes

### Raycasting Fix
Initial implementation had an issue where the raycaster variable was undefined in 2D mode. Fixed by creating a dedicated `raycaster2D` instance for 2D views:

```typescript
const raycaster2D = new THREE.Raycaster();
raycaster2D.setFromCamera(mouse, cameraRef.current);
```

### Geometry Choice
- Initially used `CircleGeometry` which had poor raycasting performance
- Switched to `SphereGeometry` for reliable intersection detection
- Positioned at Z=0 to align with 2D camera view

### Performance Optimization
- Region meshes stored in Map for O(1) lookup
- CSS2D labels reused and toggled visibility instead of recreation
- Force-directed layout runs once during build, not on every frame

## Future Enhancements

Potential improvements:
1. **Interactive filtering**: Show/hide regions by size, system count, or other criteria
2. **Search functionality**: Find and highlight specific regions
3. **Clustering**: Group nearby small regions to reduce clutter
4. **Custom layouts**: Allow user to choose between different layout algorithms
5. **Region statistics**: Show more detailed info on hover (sovereignty, activity, etc.)
6. **Connection highlighting**: Show stargate paths between selected regions
7. **Mini-map**: Small overview map for navigation in zoomed views

## Configuration

Key parameters that can be adjusted in `RegionMap2D.ts`:

### Region Sizing
- `baseRadius`: Minimum circle size (default: 10)
- `maxRadius`: Maximum circle size (default: 1000)
- `exponent`: Exponential scaling factor (default: 0.8)
- `scaleFactor`: Base scaling multiplier (default: 0.02)
- `useLogarithmic`: Toggle between log and exponential scaling (default: false)

### Force-Directed Layout
- `iterations`: Number of layout iterations (default: 50)
- `coolingFactor`: Temperature reduction per iteration (default: 0.95)
- `temperature`: Initial temperature (default: 200)
- `minDistance`: Repulsion distance threshold (default: 120)
- `force`: Repulsion force multiplier (default: 0.3)

### Camera
- `cameraPos`: Camera position for region overview (default: `(0, 0, 30000)`)
- `cameraPos` (detail): Camera position for region detail (default: `(0, 0, 15000)`)

## Files Modified

- `eve-frontier-map/src/modules/RegionMap2D.ts` - Core 2D region view implementation
- `eve-frontier-map/src/App.tsx` - View mode switching, camera transitions, raycaster setup
- `eve-frontier-map/src/components/HelpPanel/HelpPanel.tsx` - UI controls for view switching

## Date Implemented

October 26, 2025

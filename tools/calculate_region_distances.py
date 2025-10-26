"""
Calculate average distance from spawn regions to a target system.
Usage: python calculate_region_distances.py <system_name>
"""

import sqlite3
import sys
import math
from typing import List, Tuple

# Spawn region IDs
SPAWN_REGIONS = [10000269, 10000114, 10000136]

def calculate_distance_3d(pos1: Tuple[float, float, float], pos2: Tuple[float, float, float]) -> float:
    """Calculate 3D Euclidean distance between two points."""
    return math.sqrt(
        (pos1[0] - pos2[0]) ** 2 +
        (pos1[1] - pos2[1]) ** 2 +
        (pos1[2] - pos2[2]) ** 2
    )

def get_system_by_name(conn: sqlite3.Connection, system_name: str) -> dict:
    """Get system data by name."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, region_id, center_x, center_y, center_z, position_x, position_y
        FROM systems 
        WHERE name = ? COLLATE NOCASE
    """, (system_name,))
    
    row = cursor.fetchone()
    if not row:
        return None
    
    return {
        'id': row[0],
        'name': row[1],
        'region_id': row[2],
        'center_x': row[3],
        'center_y': row[4],
        'center_z': row[5],
        'position_x': row[6],
        'position_y': row[7]
    }

def get_systems_in_regions(conn: sqlite3.Connection, region_ids: List[int]) -> List[dict]:
    """Get all systems in the specified regions."""
    cursor = conn.cursor()
    placeholders = ','.join('?' * len(region_ids))
    cursor.execute(f"""
        SELECT id, name, region_id, center_x, center_y, center_z, position_x, position_y
        FROM systems 
        WHERE region_id IN ({placeholders})
    """, region_ids)
    
    systems = []
    for row in cursor.fetchall():
        systems.append({
            'id': row[0],
            'name': row[1],
            'region_id': row[2],
            'center_x': row[3],
            'center_y': row[4],
            'center_z': row[5],
            'position_x': row[6],
            'position_y': row[7]
        })
    
    return systems

def main():
    if len(sys.argv) < 2:
        print("Usage: python calculate_region_distances.py <system_name>")
        print("Example: python calculate_region_distances.py E30-86C")
        sys.exit(1)
    
    target_system_name = sys.argv[1]
    db_path = 'eve-frontier-map/public/map_data_v2.db'
    
    # Connect to database
    conn = sqlite3.connect(db_path)
    
    try:
        # Get target system
        target = get_system_by_name(conn, target_system_name)
        if not target:
            print(f"Error: System '{target_system_name}' not found in database")
            sys.exit(1)
        
        print(f"\n{'='*80}")
        print(f"Target System: {target['name']}")
        print(f"Region ID: {target['region_id']}")
        print(f"Position: ({target['position_x']:.2f}, {target['position_y']:.2f})")
        print(f"Center: ({target['center_x']:.2e}, {target['center_y']:.2e}, {target['center_z']:.2e})")
        print(f"{'='*80}\n")
        
        # Use center coordinates for distance calculation
        target_pos = (target['center_x'], target['center_y'], target['center_z'])
        
        # Get all systems in spawn regions
        spawn_systems = get_systems_in_regions(conn, SPAWN_REGIONS)
        
        if not spawn_systems:
            print("Error: No systems found in spawn regions")
            sys.exit(1)
        
        print(f"Found {len(spawn_systems)} systems in spawn regions:")
        for region_id in SPAWN_REGIONS:
            count = sum(1 for s in spawn_systems if s['region_id'] == region_id)
            print(f"  Region {region_id}: {count} systems")
        print()
        
        # Calculate distances
        distances_by_region = {region_id: [] for region_id in SPAWN_REGIONS}
        all_distances = []
        
        for system in spawn_systems:
            system_pos = (system['center_x'], system['center_y'], system['center_z'])
            distance = calculate_distance_3d(system_pos, target_pos)
            distances_by_region[system['region_id']].append(distance)
            all_distances.append(distance)
        
        # Print results
        print(f"{'Region ID':<15} {'Avg Distance':<20} {'Min Distance':<20} {'Max Distance':<20} {'Systems':<10}")
        print(f"{'-'*90}")
        
        for region_id in SPAWN_REGIONS:
            distances = distances_by_region[region_id]
            if distances:
                avg = sum(distances) / len(distances)
                min_dist = min(distances)
                max_dist = max(distances)
                print(f"{region_id:<15} {avg:<20.2e} {min_dist:<20.2e} {max_dist:<20.2e} {len(distances):<10}")
        
        # Overall average
        overall_avg = sum(all_distances) / len(all_distances)
        overall_min = min(all_distances)
        overall_max = max(all_distances)
        
        print(f"{'-'*90}")
        print(f"{'OVERALL':<15} {overall_avg:<20.2e} {overall_min:<20.2e} {overall_max:<20.2e} {len(all_distances):<10}")
        print()
        
        # Find closest and farthest systems
        closest_system = min(spawn_systems, key=lambda s: calculate_distance_3d(
            (s['center_x'], s['center_y'], s['center_z']), target_pos
        ))
        farthest_system = max(spawn_systems, key=lambda s: calculate_distance_3d(
            (s['center_x'], s['center_y'], s['center_z']), target_pos
        ))
        
        closest_dist = calculate_distance_3d(
            (closest_system['center_x'], closest_system['center_y'], closest_system['center_z']), 
            target_pos
        )
        farthest_dist = calculate_distance_3d(
            (farthest_system['center_x'], farthest_system['center_y'], farthest_system['center_z']), 
            target_pos
        )
        
        print(f"Closest spawn system: {closest_system['name']} (Region {closest_system['region_id']}) - {closest_dist:.2e}")
        print(f"Farthest spawn system: {farthest_system['name']} (Region {farthest_system['region_id']}) - {farthest_dist:.2e}")
        print()
        
    finally:
        conn.close()

if __name__ == '__main__':
    main()


import React from 'react';
// Converted to use shared PanelDrawer in App; this component now only renders inner body.

export interface RegionStats {
  systems_total: number;
  systems_gated: number;
  systems_isolated: number;
  connectivity_pct: number;
  gate_links: number;
  avg_gate_distance_ly: number;
  avg_gate_degree: number;
  footprint_area_ly2: number;
  system_density_per_100_ly2: number;
  est_gated_distance_ly: number;
  est_gated_gate_jumps: number;
  est_all_distance_ly: number;
  all_gate_jumps: number;
  ship_jumps: number;
  ship_jump_ly: number;
  total_jumps: number;
  min_jump_range_ly: number;
  total_planets: number;
  avg_planets_per_system: number;
  has_station: boolean;
}

interface Props { regionName:string; stats:RegionStats|null; }

// Body content (wrapped by PanelDrawer in App)
const RegionStatsCard: React.FC<Props> = ({ regionName, stats }) => {
  return (
    <div style={{ paddingTop:4 }}>
      {!stats && <div style={{ fontSize:12, opacity:0.75, padding:'2px 0 6px' }}>Computing…</div>}
      {stats && (
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <tbody>
              <StatRow label="Systems" value={stats.systems_total} />
              <StatRow label="Gated Systems" value={stats.systems_gated} />
              <StatRow label="Isolated Systems" value={stats.systems_isolated} />
              <StatRow label="Connectivity %" value={fmt(stats.connectivity_pct)} />
              <StatRow label="Gate Links" value={stats.gate_links} />
              <StatRow label="Avg Gate Dist (ly)" value={fmt(stats.avg_gate_distance_ly)} />
              <StatRow label="Avg Gate Links/System" value={fmt(stats.avg_gate_degree)} />
              <StatRow label="Footprint (ly²)" title="Convex hull area (x,z) enclosing all systems." value={fmt(stats.footprint_area_ly2)} />
              <StatRow label="Systems /100 ly²" title="Scaled density: systems per 100 square light‑years." value={fmt(stats.system_density_per_100_ly2)} />
              <StatRow label="Gated Distance (ly)" title="Approx gated traversal distance (MST lower bound)." value={fmt(stats.est_gated_distance_ly)} />
              <StatRow label="Gated Gate Jumps" title="Gate hops across gated systems (lower bound n_gated-1)." value={stats.est_gated_gate_jumps} />
              <StatRow label="All Distance (ly)" title="Gated distance plus isolated attachments (approx)." value={fmt(stats.est_all_distance_ly)} />
              <StatRow label="Gate Jumps" title="Gate jumps portion within all systems (lower bound)." value={stats.all_gate_jumps} />
              <StatRow label="Ship Jumps" title="Ship jumps (isolated attachments counted once each)." value={stats.ship_jumps} />
              <StatRow label="Ship Jump LY" title="Sum of ship jump distances (attachments)." value={fmt(stats.ship_jump_ly)} />
              <StatRow label="Total Jumps" title="Gate + ship jumps (lower bound)." value={stats.total_jumps} />
              <StatRow label="Min Jump Range (ly)" title="Minimum ship jump range to ensure reachability (multi‑hop allowed)." value={fmt(stats.min_jump_range_ly)} />
              <StatRow label="Total Planets" value={stats.total_planets} />
              <StatRow label="Avg Planets / Sys" value={fmt(stats.avg_planets_per_system)} />
              <StatRow label="Has Station" title="At least one station present in region." value={stats.has_station ? 'Yes':'No'} />
          </tbody>
        </table>
      )}
      <div style={{ marginTop:8, fontSize:10, opacity:0.55, lineHeight:1.35 }}>
        {regionName || 'Region'}: connectivity lengths are approximate lower bounds (gate MST + greedy isolated attachments). Area from convex hull (x,z projection).
      </div>
    </div>
  );
};

const StatRow: React.FC<{label:string; value: number|string; title?:string}> = ({ label, value, title }) => (
  <tr>
  <td style={{ padding:'2px 4px', opacity:0.75 }} title={title}>{label}</td>
    <td style={{ padding:'2px 4px', textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{value}</td>
  </tr>
);

function fmt(n:number){
  if(!isFinite(n)) return '—';
  if(Math.abs(n)>=100) return n.toFixed(0);
  if(Math.abs(n)>=10) return n.toFixed(1);
  return n.toFixed(2);
}

export default RegionStatsCard;

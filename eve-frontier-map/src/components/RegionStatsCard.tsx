import React from 'react';

export interface RegionStats {
  systems_total: number;
  systems_gated: number;
  systems_isolated: number;
  gates_total: number;
  avg_gate_length_ly: number;
  hull_area: number;
  density_systems_per_area: number;
  mst_length_gated_ly: number;
  mst_length_all_ly: number;
  max_span_edge_ly: number;
}

interface Props {
  regionName: string;
  stats: RegionStats | null;
  onClose: ()=>void;
}

// Light styled card matching existing panel aesthetic (reuse panel class names if present)
const RegionStatsCard: React.FC<Props> = ({ regionName, stats, onClose }) => {
  return (
    <div className="ef-panel" style={{ position:'absolute', top: 90, left: 12, minWidth:260, zIndex:40, pointerEvents:'auto'}}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <h3 style={{ fontSize: '14px', margin:0 }}>{regionName || 'Region'} Stats</h3>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'inherit', cursor:'pointer', fontSize:12 }}>✕</button>
      </div>
      {!stats && <div style={{ fontSize:12, opacity:0.7 }}>Computing…</div>}
      {stats && (
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <tbody>
            <StatRow label="Systems" value={stats.systems_total} />
            <StatRow label="Gated" value={stats.systems_gated} />
            <StatRow label="Isolated" value={stats.systems_isolated} />
            <StatRow label="Gates" value={stats.gates_total} />
            <StatRow label="Avg Gate LY" value={fmt(stats.avg_gate_length_ly)} />
            <StatRow label="Hull Area" value={fmt(stats.hull_area)} />
            <StatRow label="Density" value={fmt(stats.density_systems_per_area)} />
            <StatRow label="MST Gated LY" value={fmt(stats.mst_length_gated_ly)} />
            <StatRow label="MST All LY" value={fmt(stats.mst_length_all_ly)} />
            <StatRow label="Max Span LY" value={fmt(stats.max_span_edge_ly)} />
          </tbody>
        </table>
      )}
      <div style={{ marginTop:6, fontSize:10, opacity:0.55, lineHeight:1.3 }}>
        MST lengths approximate minimum coverage; full optimal path (TSP) will be longer. Area from convex hull (x,z projection).
      </div>
    </div>
  );
};

const StatRow: React.FC<{label:string; value: number|string}> = ({ label, value }) => (
  <tr>
    <td style={{ padding:'2px 4px', opacity:0.75 }}>{label}</td>
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

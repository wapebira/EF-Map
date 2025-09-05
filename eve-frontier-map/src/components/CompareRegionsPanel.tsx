import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { RegionStats } from './RegionStatsCard';

export interface CompareRegionsPanelProps {
  regions: { id:number; name:string; stats: RegionStats|null }[];
  loading: boolean;
  onRequestStats: ()=>void; // trigger full stats compute
  onSelectRegion: (regionId:number, regionName:string)=>void;
}

type SortKey = keyof RegionStats | 'name';

const numeric = (k:SortKey, a:RegionStats, b:RegionStats) => {
  if(k==='name') return 0;
  const av = (a as any)[k]; const bv = (b as any)[k];
  return (av??0) - (bv??0);
};

export const CompareRegionsPanel: React.FC<CompareRegionsPanelProps> = ({ regions, loading, onRequestStats, onSelectRegion }) => {
  // Session persistence (sessionStorage) for sort order
  const ssKey = 'efmap:compareRegionsSort';
  const initRef = useRef(false);
  const [sortKey, setSortKey] = useState<SortKey>('systems_total');
  const [sortDir, setSortDir] = useState<1|-1>(-1); // desc default

  // Load initial state once
  useEffect(()=>{
    if(initRef.current) return; initRef.current = true;
    try {
      const raw = sessionStorage.getItem(ssKey);
      if(raw){
        const parsed = JSON.parse(raw);
        if(parsed && parsed.sortKey){ setSortKey(parsed.sortKey); }
        if(parsed && (parsed.sortDir===1 || parsed.sortDir===-1)){ setSortDir(parsed.sortDir); }
      }
    } catch {/* ignore */}
  }, []);
  // Persist on change
  useEffect(()=>{
    try { sessionStorage.setItem(ssKey, JSON.stringify({ sortKey, sortDir })); } catch {/* ignore */}
  }, [sortKey, sortDir]);
  const [selectedRowId, setSelectedRowId] = useState<number|null>(null);
  const handleSort = (k:SortKey) => {
    setSortKey(k); setSortDir(prev=> k===sortKey? (prev===1?-1:1) : -1);
  };
  const rows = useMemo(()=>{
    const withStats = regions.filter(r=> !!r.stats);
    const cloned = [...withStats];
    cloned.sort((ra, rb)=>{
      if(sortKey==='name'){ return sortDir * ra.name.localeCompare(rb.name); }
      return sortDir * numeric(sortKey, ra.stats!, rb.stats!);
    });
    return cloned;
  }, [regions, sortKey, sortDir]);
  const haveAny = rows.length>0;
  const header = (label:string, k:SortKey, title?:string) => (
    <th style={thStyle} onClick={()=> handleSort(k)} title={title||'Click to sort'}>
      {label}{' '}{sortKey===k? (sortDir===1?'▲':'▼'):''}
    </th>
  );
  const highlightCellStyle: React.CSSProperties = { background:'rgba(var(--accent-rgb),0.18)' };
  const highlightNameCellStyle: React.CSSProperties = { background:'rgba(var(--accent-rgb),0.28)' };

  const renderDataCell = (rowId:number, content:React.ReactNode, key?:string) => {
    const selected = rowId === selectedRowId;
    return <td key={key} style={{ ...tdStyle, ...(selected? highlightCellStyle:{}), cursor:'pointer' }} onClick={()=> setSelectedRowId(rowId)}>{content}</td>;
  };

  return (
    <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {!haveAny && !loading && <div style={{fontSize:12, opacity:0.7, padding:'4px 2px'}}>Press Load to compute region statistics.</div>}
      <div style={{display:'flex', gap:8, marginBottom:6}}>
        <button onClick={onRequestStats} disabled={loading} style={btnStyle}>{loading? 'Loading…':'Load / Refresh'}</button>
      </div>
      {haveAny && (
        <div style={{ flex:1, overflow:'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {header('Region','name')}
              {header('Systems','systems_total')}
              {header('Gated','systems_gated')}
              {header('Isolated','systems_isolated')}
              {header('Conn %','connectivity_pct')}
              {header('Gate Links','gate_links')}
              {header('Avg Gate Dist','avg_gate_distance_ly')}
              {header('Avg Gate Deg','avg_gate_degree')}
              {header('Footprint','footprint_area_ly2')}
              {header('Sys/100ly²','system_density_per_100_ly2')}
              {header('Gated Dist','est_gated_distance_ly')}
              {header('Gated Jumps','est_gated_gate_jumps')}
              {header('All Dist','est_all_distance_ly')}
              {header('Gate Jumps','all_gate_jumps')}
              {header('Ship Jumps','ship_jumps')}
              {header('Ship Jump LY','ship_jump_ly')}
              {header('Total Jumps','total_jumps')}
              {header('Min Range','min_jump_range_ly')}
              {header('Planets','total_planets')}
              {header('Avg Pl/Sys','avg_planets_per_system')}
              {header('Has Station','has_station')}
            </tr>
          </thead>
          <tbody>
            {rows.map(r=>{
              const s = r.stats!; const selected = r.id===selectedRowId;
              return (
                <tr key={r.id} style={ selected? { outline:'1px solid rgba(var(--accent-rgb),0.55)' } : undefined }>
                  <td
                    style={{ ...nameCellStyle, ...(selected? highlightNameCellStyle:{}), cursor:'pointer' }}
                    onClick={()=> { setSelectedRowId(r.id); onSelectRegion(r.id, r.name); }}
                    title="Highlight this region"
                  >{r.name}</td>
                  {renderDataCell(r.id, s.systems_total)}
                  {renderDataCell(r.id, s.systems_gated)}
                  {renderDataCell(r.id, s.systems_isolated)}
                  {renderDataCell(r.id, fmtVal(s.connectivity_pct))}
                  {renderDataCell(r.id, s.gate_links)}
                  {renderDataCell(r.id, fmtVal(s.avg_gate_distance_ly))}
                  {renderDataCell(r.id, fmtVal(s.avg_gate_degree))}
                  {renderDataCell(r.id, fmtVal(s.footprint_area_ly2))}
                  {renderDataCell(r.id, fmtVal(s.system_density_per_100_ly2))}
                  {renderDataCell(r.id, fmtVal(s.est_gated_distance_ly))}
                  {renderDataCell(r.id, s.est_gated_gate_jumps)}
                  {renderDataCell(r.id, fmtVal(s.est_all_distance_ly))}
                  {renderDataCell(r.id, s.all_gate_jumps)}
                  {renderDataCell(r.id, s.ship_jumps)}
                  {renderDataCell(r.id, fmtVal(s.ship_jump_ly))}
                  {renderDataCell(r.id, s.total_jumps)}
                  {renderDataCell(r.id, fmtVal(s.min_jump_range_ly))}
                  {renderDataCell(r.id, s.total_planets)}
                  {renderDataCell(r.id, fmtVal(s.avg_planets_per_system))}
                  {renderDataCell(r.id, s.has_station? 'Yes':'No')}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
};

const tableStyle: React.CSSProperties = { width:'100%', borderCollapse:'collapse', fontSize:11, tableLayout:'fixed', minWidth:1200 };
const thStyle: React.CSSProperties = { position:'sticky', top:0, background:'rgba(40,40,44,0.92)', cursor:'pointer', padding:'4px 6px', textAlign:'right', fontWeight:600, fontSize:11, whiteSpace:'nowrap', zIndex:1 };
const nameCellStyle: React.CSSProperties = { padding:'3px 6px', textAlign:'left', fontWeight:500, cursor:'pointer', position:'sticky', left:0, background:'rgba(30,30,34,0.92)', zIndex:1 };
const tdStyle: React.CSSProperties = { padding:'3px 6px', textAlign:'right', fontVariantNumeric:'tabular-nums' };
const btnStyle: React.CSSProperties = { background:'var(--accent)', color:'#fff', border:'none', padding:'4px 10px', borderRadius:6, cursor:'pointer', fontSize:12 };
// formatting helper used by interactive cell renderer
function fmtVal(n:number){ if(!isFinite(n)) return '—'; if(Math.abs(n)>=100) return n.toFixed(0); if(Math.abs(n)>=10) return n.toFixed(1); return n.toFixed(2); }

export default CompareRegionsPanel;
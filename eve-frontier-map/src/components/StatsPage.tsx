import React, { useEffect, useState } from 'react';

interface StatsSnapshot { version: number; updatedAt: string; counters: Record<string, number>; sums: Record<string, number>; date?: string }
interface StatsResponse { current: StatsSnapshot; history: StatsSnapshot[] }

const formatMs = (ms:number) => {
  if(ms < 2000) return Math.round(ms)+' ms';
  if(ms < 60000) return (ms/1000).toFixed(ms<10000?2:1)+' s';
  const totalSec = Math.round(ms/1000);
  if(totalSec < 3600){
    const m = Math.floor(totalSec/60);
    const s = totalSec % 60;
    return `${m}m ${s.toString().padStart(2,'0')}s`;
  }
  const h = Math.floor(totalSec/3600);
  const rem = totalSec % 3600;
  const m = Math.floor(rem/60);
  const s = rem % 60;
  return `${h}h ${m}m ${s.toString().padStart(2,'0')}s`;
};

const formatDurationAvg = (sum:number|undefined, count:number|undefined) => {
  if(!sum || !count || count===0) return '—';
  return formatMs(sum / count);
};

const StatRow: React.FC<{ label:string; value: React.ReactNode }>=({label,value})=> (
  <div style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.06)', fontSize:'13px' }}>
    <span style={{ opacity:0.8 }}>{label}</span>
    <strong style={{ fontVariantNumeric:'tabular-nums' }}>{value}</strong>
  </div>
);

const StatsPage: React.FC = () => {
  const [data, setData] = useState<StatsSnapshot|null>(null);
  const [history, setHistory] = useState<StatsSnapshot[]>([]);
  const [error, setError] = useState<string>('');

  const load = async () => {
    try {
  const res = await fetch('/.netlify/functions/stats?history=7');
      if(!res.ok){
        if(res.status === 404){
          setError('Stats function 404 (likely not deployed). Check Netlify functions directory config.');
          return;
        }
        throw new Error('Failed');
      }
  const json: StatsResponse = await res.json();
  setData(json.current);
  setHistory(json.history||[]);
      setError('');
    } catch(e){ setError('Unable to load stats'); }
  };

  useEffect(()=>{ load(); const id = setInterval(load, 15000); return ()=> clearInterval(id); }, []);

  return (
    <div style={{ maxWidth:800, margin:'30px auto', padding:'0 18px 40px 18px', fontFamily:'system-ui, sans-serif' }}>
      <h1 style={{ fontSize:'28px', margin:'0 0 10px 0' }}>Usage Stats</h1>
      <p style={{ margin:'0 0 18px 0', fontSize:'14px', lineHeight:1.5, opacity:0.85 }}>Anonymous aggregate counters since deployment. Updates every ~15s. No personal or identifying data is tracked—only feature adoption and performance averages to guide roadmap decisions.</p>
      {error && <div style={{ color:'#f66', marginBottom:12 }}>{error}</div>}
      {!data && !error && <div>Loading...</div>}
  {data && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:'18px' }}>
          <section style={{ background:'rgba(255,255,255,0.04)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8 }}>
            <h2 style={{ margin:'0 0 6px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Routes</h2>
            <StatRow label="P2P routes" value={data.counters.p2p_routes||0} />
            <StatRow label="Scout baselines" value={data.counters.scout_baselines||0} />
            <StatRow label="Scout optimizations" value={data.counters.scout_optimizations||0} />
            <StatRow label="Routes shared (created)" value={data.counters.routes_shared||0} />
            <StatRow label="Shared routes resolved" value={data.counters.shared_resolved||0} />
            <StatRow label="Planet-filter baselines" value={data.counters.planet_filter_baselines||0} />
          </section>
          <section style={{ background:'rgba(255,255,255,0.04)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8 }}>
            <h2 style={{ margin:'0 0 6px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Performance (avg)</h2>
            <StatRow label="P2P route time" value={formatDurationAvg(data.sums.p2p_route_time_ms_sum, data.sums.p2p_route_time_count)} />
            <StatRow label="Scout baseline time" value={formatDurationAvg(data.sums.scout_baseline_time_ms_sum, data.sums.scout_baseline_time_count)} />
            <StatRow label="Scout session time" value={formatDurationAvg(data.sums.scout_opt_session_time_ms_sum, data.sums.scout_opt_session_time_count)} />
            <StatRow label="Avg collected systems" value={( ()=> { const sum = data.sums.scout_collected_systems_sum; const count = data.sums.scout_collected_systems_count; if(!sum||!count) return '—'; return (sum/count).toFixed(1); })()} />
            <StatRow label="Scout LY saved (total)" value={( ()=> { const s=data.sums.scout_opt_savings_ly_sum; return s? s.toFixed(2)+' LY':'—'; })()} />
            <StatRow label="Scout LY saved (avg)" value={( ()=> { const s=data.sums.scout_opt_savings_ly_sum; const c=data.sums.scout_opt_savings_count; if(!s||!c) return '—'; return (s/c).toFixed(2)+' LY'; })()} />
          </section>
          <section style={{ background:'rgba(255,255,255,0.04)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8 }}>
            <h2 style={{ margin:'0 0 6px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Features</h2>
            <StatRow label="Referral clicks" value={data.counters.referral_clicks||0} />
            <StatRow label="Baseline errors" value={data.counters.baseline_errors||0} />
            <StatRow label="Stall restarts" value={data.counters.stall_restarts||0} />
            <StatRow label="Waypoints used" value={data.counters.waypoints_used||0} />
            <StatRow label="Avoid systems used" value={data.counters.avoid_used||0} />
            <StatRow label="Waypoint optimize used" value={data.counters.waypoint_opt_used||0} />
            <StatRow label="Return-to-start used" value={data.counters.return_to_start||0} />
            <StatRow label="Gate reachable toggle" value={data.counters.gate_reachable||0} />
          </section>
          <section style={{ background:'rgba(255,255,255,0.04)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8 }}>
            <h2 style={{ margin:'0 0 6px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Theme</h2>
            <StatRow label="Blue theme" value={data.counters.theme_blue||0} />
            <StatRow label="Orange theme" value={data.counters.theme_orange||0} />
          </section>
          <section style={{ background:'rgba(255,255,255,0.04)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8 }}>
            <h2 style={{ margin:'0 0 6px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Engagement</h2>
            <StatRow label="Page loads" value={data.counters.page_loads||0} />
            <StatRow label="Cinematic sessions" value={data.counters.cinematic_sessions||0} />
            <StatRow label="Cinematic enters" value={data.counters.cinematic_enters||0} />
            <StatRow label="Cinematic usage rate" value={( ()=>{ const pl=data.counters.page_loads||0; const cs=data.counters.cinematic_sessions||0; if(!pl) return '—'; return ((cs/pl)*100).toFixed(1)+'%'; })()} />
            <StatRow label="Avg session length" value={formatDurationAvg(data.sums.session_time_ms_sum, data.sums.session_time_count)} />
            <StatRow label="Avg cinematic time" value={formatDurationAvg(data.sums.cinematic_time_ms_sum, data.sums.cinematic_time_count)} />
            <StatRow label="Avg cinematic share" value={( ()=>{ const cSum=data.sums.cinematic_time_ms_sum; const sSum=data.sums.session_time_ms_sum; if(!cSum||!sSum) return '—'; return ((cSum/sSum)*100).toFixed(1)+'%'; })()} />
          </section>
        </div>
      )}
      <div style={{ marginTop:22, fontSize:'11px', opacity:0.5 }}>Updated: {data? new Date(data.updatedAt).toLocaleString(): '—'}</div>
      {history.length>0 && (
        <div style={{ marginTop:30 }}>
          <h2 style={{ fontSize:'16px', margin:'0 0 8px 0' }}>Last 7 Days</h2>
          <div style={{ overflowX:'auto' }}>
            <table style={{ borderCollapse:'collapse', width:'100%', fontSize:'12px' }}>
              <thead>
                <tr style={{ textAlign:'left', background:'rgba(255,255,255,0.05)' }}>
                  <th style={{ padding:'6px 8px' }}>Date</th>
                  <th style={{ padding:'6px 8px' }}>P2P</th>
                  <th style={{ padding:'6px 8px' }}>Baselines</th>
                  <th style={{ padding:'6px 8px' }}>Opt Starts</th>
                  <th style={{ padding:'6px 8px' }}>Shares</th>
                  <th style={{ padding:'6px 8px' }}>Resolved</th>
                  <th style={{ padding:'6px 8px' }}>Avg P2P ms</th>
                  <th style={{ padding:'6px 8px' }}>Avg Baseline ms</th>
                  <th style={{ padding:'6px 8px' }}>PgLoads</th>
                  <th style={{ padding:'6px 8px' }}>CinSess</th>
                  <th style={{ padding:'6px 8px' }}>AvgSess ms</th>
                  <th style={{ padding:'6px 8px' }}>Avg LY Saved</th>
                  <th style={{ padding:'6px 8px' }}>Avg LY Saved</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h=>{
          const avgP2P = h.sums.p2p_route_time_count ? (h.sums.p2p_route_time_ms_sum / h.sums.p2p_route_time_count) : undefined;
          const avgBase = h.sums.scout_baseline_time_count ? (h.sums.scout_baseline_time_ms_sum / h.sums.scout_baseline_time_count) : undefined;
          const avgSess = h.sums.session_time_count ? (h.sums.session_time_ms_sum / h.sums.session_time_count) : undefined;
          const avgSaved = h.sums.scout_opt_savings_count ? (h.sums.scout_opt_savings_ly_sum / h.sums.scout_opt_savings_count) : undefined;
                  return (
                    <tr key={h.date||h.updatedAt} style={{ borderTop:'1px solid rgba(255,255,255,0.07)' }}>
                      <td style={{ padding:'4px 8px', opacity:0.85 }}>{h.date || h.updatedAt.slice(0,10)}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.p2p_routes||0}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.scout_baselines||0}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.scout_optimizations||0}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.routes_shared||0}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.shared_resolved||0}</td>
            <td style={{ padding:'4px 8px' }}>{avgP2P!==undefined? formatMs(avgP2P): '—'}</td>
            <td style={{ padding:'4px 8px' }}>{avgBase!==undefined? formatMs(avgBase): '—'}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.page_loads||0}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.cinematic_sessions||0}</td>
            <td style={{ padding:'4px 8px' }}>{avgSess!==undefined? formatMs(avgSess): '—'}</td>
            <td style={{ padding:'4px 8px' }}>{avgSaved!==undefined? avgSaved.toFixed(2): '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatsPage;

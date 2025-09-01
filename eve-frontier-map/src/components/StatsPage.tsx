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
  // Force global body styles for consistent dark layout & natural scrolling
  useEffect(()=>{
    const prev = {
      display: document.body.style.display,
      placeItems: (document.body.style as any).placeItems,
      alignItems: document.body.style.alignItems,
      justifyContent: document.body.style.justifyContent,
      background: document.body.style.background,
      color: document.body.style.color,
    };
    document.body.style.display = 'block';
    document.body.style.alignItems = '';
    document.body.style.justifyContent = '';
    (document.body.style as any).placeItems = '';
    document.body.style.background = '#1f1f22';
    document.body.style.color = '#e7e9ed';
    document.documentElement.style.backgroundColor = '#1f1f22';
    return () => {
      document.body.style.display = prev.display;
      document.body.style.alignItems = prev.alignItems;
      document.body.style.justifyContent = prev.justifyContent;
      (document.body.style as any).placeItems = prev.placeItems;
      document.body.style.background = prev.background;
      document.body.style.color = prev.color;
      // Don't reset root background intentionally to avoid flash if user navigates back quickly
    };
  }, []);

  // Force dark theme colors regardless of system preference
  const pageBg = '#1f1f22';
  const pageColor = '#e7e9ed';
  return (
    <div style={{ maxWidth:900, margin:'0 auto', padding:'30px 26px 60px 26px', fontFamily:'system-ui, sans-serif', color:pageColor, background:pageBg, minHeight:'100vh', boxSizing:'border-box', overflowY:'auto' }}>
      <h1 style={{ fontSize:'28px', margin:'0 0 10px 0' }}>Usage Stats</h1>
      <p style={{ margin:'0 0 18px 0', fontSize:'14px', lineHeight:1.5, opacity:0.85 }}>Anonymous aggregate counters since deployment. Updates every ~15s. No personal or identifying data is tracked—only feature adoption and performance averages to guide roadmap decisions.</p>
      {error && <div style={{ color:'#f66', marginBottom:12 }}>{error}</div>}
      {!data && !error && <div>Loading...</div>}
  {data && (
  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:'18px' }}>
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, boxShadow:'0 2px 4px rgba(0,0,0,0.4)' }}>
            <h2 style={{ margin:'0 0 6px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Routes</h2>
            <StatRow label="P2P routes" value={data.counters.p2p_routes||0} />
            <StatRow label="Scout baselines" value={data.counters.scout_baselines||0} />
            <StatRow label="Scout optimizations" value={data.counters.scout_optimizations||0} />
            <StatRow label="Routes shared (created)" value={data.counters.routes_shared||0} />
            <StatRow label="Shared routes resolved" value={data.counters.shared_resolved||0} />
            <StatRow label="Planet-filter baselines" value={data.counters.planet_filter_baselines||0} />
          </section>
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, boxShadow:'0 2px 4px rgba(0,0,0,0.4)' }}>
            <h2 style={{ margin:'0 0 6px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Performance (avg)</h2>
            <StatRow label="P2P route time" value={formatDurationAvg(data.sums.p2p_route_time_ms_sum, data.sums.p2p_route_time_count)} />
            <StatRow label="Scout baseline time" value={formatDurationAvg(data.sums.scout_baseline_time_ms_sum, data.sums.scout_baseline_time_count)} />
            <StatRow label="Scout session time" value={formatDurationAvg(data.sums.scout_opt_session_time_ms_sum, data.sums.scout_opt_session_time_count)} />
            <StatRow label="Avg collected systems" value={( ()=> { const sum = data.sums.scout_collected_systems_sum; const count = data.sums.scout_collected_systems_count; if(!sum||!count) return '—'; return (sum/count).toFixed(1); })()} />
            <StatRow label="Scout LY saved (total)" value={( ()=> { const s=data.sums.scout_opt_savings_ly_sum; return s? s.toFixed(2)+' LY':'—'; })()} />
            <StatRow label="Scout LY saved (avg)" value={( ()=> { const s=data.sums.scout_opt_savings_ly_sum; const c=data.sums.scout_opt_savings_count; if(!s||!c) return '—'; return (s/c).toFixed(2)+' LY'; })()} />
          </section>
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, boxShadow:'0 2px 4px rgba(0,0,0,0.4)' }}>
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
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, boxShadow:'0 2px 4px rgba(0,0,0,0.4)' }}>
            <h2 style={{ margin:'0 0 6px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>UI</h2>
            <StatRow label="Blue theme" value={data.counters.theme_blue||0} />
            <StatRow label="Orange theme" value={data.counters.theme_orange||0} />
            <StatRow label="Hide UI used" value={data.counters.ui_hide||0} />
            <StatRow label="Show Distance used" value={data.counters.show_distance||0} />
            <StatRow label="Help panel opens" value={data.counters.help_opens||0} />
            <StatRow label="Route copies (total)" value={data.counters.route_copies||0} />
            <StatRow label="Route copies (P2P)" value={data.counters.route_copy_p2p||0} />
            <StatRow label="Route copies (Scout)" value={data.counters.route_copy_scout||0} />
            {(() => {
              const scaleKeys = Object.keys(data.counters).filter(k=> k.startsWith('ui_scale_'));
              if(!scaleKeys.length) return <StatRow label="Most common UI scale" value="—" />;
              let total=0; let topKey=''; let topVal=0;
              scaleKeys.forEach(k=>{ const v=data.counters[k]||0; total+=v; if(v>topVal){ topVal=v; topKey=k; } });
              const pct = total? ((topVal/total)*100).toFixed(1)+'%':'—';
              const scale = topKey.replace('ui_scale_','');
              return <StatRow label="Most common UI scale" value={`${scale}% (${pct})`} />;
            })()}
            {(()=>{
              const routes = (data.counters.p2p_routes||0) + (data.counters.scout_optimizations||0);
              if(!routes) return <StatRow label="Route copy rate" value="—" />;
              const copies = data.counters.route_copies||0;
              const rate = routes? ((copies/routes)*100).toFixed(1)+'%':'—';
              return <StatRow label="Route copy rate" value={rate} />;
            })()}
          </section>
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, boxShadow:'0 2px 4px rgba(0,0,0,0.4)' }}>
            <h2 style={{ margin:'0 0 6px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Engagement</h2>
            <StatRow label="Page loads" value={data.counters.page_loads||0} />
            <StatRow label="Cinematic sessions" value={data.counters.cinematic_sessions||0} />
            <StatRow label="Cinematic enters" value={data.counters.cinematic_enters||0} />
            <StatRow label="Cinematic usage rate" value={( ()=>{ const pl=data.counters.page_loads||0; const cs=data.counters.cinematic_sessions||0; if(!pl) return '—'; return ((cs/pl)*100).toFixed(1)+'%'; })()} />
            <StatRow label="Avg open tab duration" value={formatDurationAvg(data.sums.session_time_ms_sum, data.sums.session_time_count)} />
            <StatRow label="Avg active duration" value={formatDurationAvg(data.sums.active_session_time_ms_sum, data.sums.active_session_time_count)} />
            {(()=>{ // median approximation using bucket midpoints
              const buckets=[
                { c:data.counters.sess_lt_1m||0, min:0, max:60_000 },
                { c:data.counters.sess_1_5m||0, min:60_000, max:5*60_000 },
                { c:data.counters.sess_5_15m||0, min:5*60_000, max:15*60_000 },
                { c:data.counters.sess_15_60m||0, min:15*60_000, max:60*60_000 },
                { c:data.counters.sess_gt_60m||0, min:60*60_000, max:120*60_000 } // assume 60–120m span midpoint
              ];
              const total = buckets.reduce((a,b)=>a+b.c,0);
              if(!total) return <StatRow label="Median open duration (est)" value="—" />;
              let cum=0; let medianMs=0; const target = total/2;
              for(const b of buckets){
                if(cum + b.c >= target){
                  medianMs = (b.min + b.max)/2; break;
                }
                cum += b.c;
              }
              return <StatRow label="Median open duration (est)" value={formatMs(medianMs)} />;
            })()}
            <StatRow label="Avg cinematic time" value={formatDurationAvg(data.sums.cinematic_time_ms_sum, data.sums.cinematic_time_count)} />
            <StatRow label="Avg cinematic share" value={( ()=>{ const cSum=data.sums.cinematic_time_ms_sum; const sSum=data.sums.session_time_ms_sum; if(!cSum||!sSum) return '—'; return ((cSum/sSum)*100).toFixed(1)+'%'; })()} />
          </section>
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'14px 16px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, display:'flex', flexDirection:'column', boxShadow:'0 2px 4px rgba(0,0,0,0.4)' }}>
            <h2 style={{ margin:'0 0 8px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>UI Scale Distribution</h2>
            {(()=>{
              const allowed = [50,60,70,80,90,100,110,120,130];
              const rows = allowed.map(s=>({ scale:s, count: data.counters['ui_scale_'+s]||0 }));
              const total = rows.reduce((a,r)=> a+r.count,0);
              if(!total) return <div style={{ fontSize:12, opacity:.7 }}>No scale selections recorded yet.</div>;
              return (
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ textAlign:'left', background:'rgba(255,255,255,0.05)' }}>
                      <th style={{ padding:'4px 6px' }}>Scale</th>
                      <th style={{ padding:'4px 6px' }}>Count</th>
                      <th style={{ padding:'4px 6px' }}>%</th>
                      <th style={{ padding:'4px 6px' }}>Bar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r=>{
                      const pct = (r.count/total)*100;
                      return (
                        <tr key={r.scale} style={{ borderTop:'1px solid rgba(255,255,255,0.07)' }}>
                          <td style={{ padding:'4px 6px' }}>{r.scale}%</td>
                          <td style={{ padding:'4px 6px', fontVariantNumeric:'tabular-nums' }}>{r.count}</td>
                          <td style={{ padding:'4px 6px', fontVariantNumeric:'tabular-nums' }}>{pct.toFixed(1)}%</td>
                          <td style={{ padding:'4px 6px', width:'55%' }}>
                            <div style={{ background:'rgba(255,255,255,0.08)', height:6, borderRadius:3, position:'relative' }}>
                              <div style={{ position:'absolute', left:0, top:0, bottom:0, width:pct+'%', background:'var(--accent)', borderRadius:3 }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop:'1px solid rgba(255,255,255,0.12)', fontWeight:600 }}>
                      <td style={{ padding:'4px 6px' }}>Total</td>
                      <td style={{ padding:'4px 6px', fontVariantNumeric:'tabular-nums' }}>{total}</td>
                      <td style={{ padding:'4px 6px' }}>100%</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              );
            })()}
            <div style={{ marginTop:6, fontSize:10, opacity:.55, lineHeight:1.3 }}>Only the first UI scale selection per session is recorded (initial load counts as a selection).</div>
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
      {data && (
        <div style={{ marginTop:30 }}>
          <h2 style={{ fontSize:'16px', margin:'0 0 8px 0' }}>Session Duration Distribution</h2>
          <table style={{ borderCollapse:'collapse', width:'100%', fontSize:12 }}>
            <thead>
              <tr style={{ textAlign:'left', background:'rgba(255,255,255,0.05)' }}>
                <th style={{ padding:'6px 8px' }}>Bucket</th>
                <th style={{ padding:'6px 8px' }}>Count</th>
                <th style={{ padding:'6px 8px' }}>%</th>
                <th style={{ padding:'6px 8px' }}>Bar</th>
              </tr>
            </thead>
            <tbody>
              {(()=>{
                const buckets=[
                  { key:'sess_lt_1m', label:'<1m' },
                  { key:'sess_1_5m', label:'1–5m' },
                  { key:'sess_5_15m', label:'5–15m' },
                  { key:'sess_15_60m', label:'15–60m' },
                  { key:'sess_gt_60m', label:'>60m' }
                ];
                const rows = buckets.map(b=> ({ ...b, count: data.counters[b.key]||0 }));
                const total = rows.reduce((a,r)=>a+r.count,0);
                if(!total) return <tr><td style={{ padding:'6px 8px', opacity:.7 }} colSpan={4}>No session buckets recorded yet.</td></tr>;
                return <>
                  {rows.map(r=>{ const pct = (r.count/total)*100; return (
                    <tr key={r.key} style={{ borderTop:'1px solid rgba(255,255,255,0.08)' }}>
                      <td style={{ padding:'4px 8px' }}>{r.label}</td>
                      <td style={{ padding:'4px 8px', fontVariantNumeric:'tabular-nums' }}>{r.count}</td>
                      <td style={{ padding:'4px 8px', fontVariantNumeric:'tabular-nums' }}>{pct.toFixed(1)}%</td>
                      <td style={{ padding:'4px 8px' }}>
                        <div style={{ background:'rgba(255,255,255,0.08)', height:6, borderRadius:3, position:'relative' }}>
                          <div style={{ position:'absolute', left:0, top:0, bottom:0, width:pct+'%', background:'var(--accent)', borderRadius:3 }} />
                        </div>
                      </td>
                    </tr>
                  ); })}
                  <tr style={{ borderTop:'1px solid rgba(255,255,255,0.12)', fontWeight:600 }}>
                    <td style={{ padding:'4px 8px' }}>Total</td>
                    <td style={{ padding:'4px 8px', fontVariantNumeric:'tabular-nums' }}>{total}</td>
                    <td style={{ padding:'4px 8px' }}>100%</td>
                    <td />
                  </tr>
                </>;
              })()}
            </tbody>
          </table>
          <div style={{ marginTop:6, fontSize:10, opacity:.55 }}>Open duration = full tab lifetime; active duration = time until last interaction. Median is an approximation from bucket midpoints.</div>
        </div>
      )}
    </div>
  );
};

export default StatsPage;

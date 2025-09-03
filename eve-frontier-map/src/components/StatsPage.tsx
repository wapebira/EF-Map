import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, ChartLegend, chartColors } from './StatsCharts';

interface StatsSnapshot { version: number; updatedAt: string; counters: Record<string, number>; sums: Record<string, number>; date?: string }

// Formatting helpers
const formatMs = (ms:number | undefined) => {
  if(ms === undefined || isNaN(ms)) return '—';
  if(ms < 2000) return Math.round(ms)+' ms';
  if(ms < 60000) return (ms/1000).toFixed(ms<10000?2:1)+' s';
  const totalSec = Math.round(ms/1000);
  if(totalSec < 3600){
    const m = Math.floor(totalSec/60); const s = totalSec % 60; return `${m}m ${s.toString().padStart(2,'0')}s`;
  }
  const h = Math.floor(totalSec/3600); const rem = totalSec % 3600; const m = Math.floor(rem/60); const s = rem % 60; return `${h}h ${m}m ${s.toString().padStart(2,'0')}s`;
};
const formatDurationAvg = (sum?:number, count?:number) => (!sum || !count)? '—' : formatMs(sum/count);

// Tooltip descriptions (concise) keyed by label text
const DESCRIPTIONS: Record<string,string> = {
  'Page loads':'Distinct page initializations (reloads/new visits).',
  'First actions':'Sessions where at least one route or baseline was started.',
  'Activation rate':'First actions / Page loads.',
  'Avg DB load time':'Average time to download + open the map database in-browser.',
  'Avg time to first action':'Average delay from page load to first routing/optimizer action.',
  'P2P routes':'Number of point-to-point route computations completed.',
  'Avg route time':'Average wall time to compute a P2P route (includes multi‑segment).',
  'Cancelled':'User-cancelled route calculations before completion.',
  'Cancellation rate':'Cancelled / (Cancelled + Completed).',
  'Algo (A*/Dij)':'Relative share of A* vs Dijkstra usage for P2P routing.',
  'Mode (Fuel/Jumps)':'Share of optimization modes chosen: minimize fuel (distance) vs hops.',
  'Baselines':'Scout baseline routes generated (starting solution).',
  'Optimizations':'Optimization sessions started after a baseline.',
  'Abandoned baselines':'Baseline generated but optimization not started (session ended).',
  'Avg baseline time':'Average time to compute baseline route.',
  'Avg opt session time':'Average measured optimization session duration until user left.',
  'Avg collected systems':'Average unique systems in collected set per baseline.',
  'LY saved total':'Total lightyears saved by optimizations vs baselines.',
  'LY saved avg':'Average LY saved per optimization session reporting savings.',
  'Waypoints used':'Routes including at least one waypoint.',
  'Avoid used':'Routes where avoid list was non-empty.',
  'Waypoint optimize':'Routes using waypoint order heuristic.',
  'Return to start':'Routes or baselines with return-to-start enabled.',
  'Gate reachable':'Scout collections restricted to gate-reachable systems.',
  'Planet-filter baselines':'Baselines built with planet-count filter active.',
  'Blue theme':'Sessions choosing blue accent.',
  'Orange theme':'Sessions choosing orange accent.',
  'Theme switches':'Accent switches after initial load.',
  'Hide UI':'Times UI was hidden (toggle on).',
  'Show Distance':'Times distance overlay was enabled.',
  'Help opens':'Help panel opens (debounced to first open per panel lifetime).',
  'Top UI scale':'Most common chosen UI scale & share.',
  'Shares created':'Short share links generated.',
  'Shares resolved':'Short links opened and decoded.',
  'Resolution rate':'Shares resolved / Shares created.',
  'Route copies total':'Total route note copy actions (P2P + optimized).',
  'Copy rate':'Route copies / (P2P routes + Optimizations).',
  'Modal opens':'Donation modal opened.',
  'Stripe clicks':'Outbound Stripe donation link clicks.',
  'Crypto clicks':'Crypto donation expand / address view clicks.',
  'Stripe CTR':'Stripe clicks / Modal opens.',
  'Cinematic sessions':'Unique sessions that entered cinematic at least once.',
  'Cinematic enters':'Total toggles into cinematic mode (multiple per session).',
  'Cinematic usage':'Cinematic sessions / Page loads.',
  'Avg open duration':'Average total page session length.',
  'Avg active duration':'Average active interaction time (idle gaps >5m capped).',
  'Median open (est)':'Median session length estimated from duration buckets.',
  'Avg cinematic time':'Average time spent in cinematic mode (sessions with time).',
  'Cinematic time share':'Cinematic time / Total session time.',
  'P2P Route Hops':'Distribution of hop counts across completed P2P routes.',
  'Scout Baseline Hops':'Hop count distribution for initial Scout baselines.',
  'Savings (LY)':'Distribution buckets of LY saved (baseline minus optimized).',
  'Planet Bins Active':'How many planet legend bins were enabled during baseline creation.',
  'Workers Used':'Parallel optimization workers selected.',
  'UI Scale':'Chosen interface scale percentages distribution.',
  'Reachability Usage':'Adoption & interaction with jump range reachability tools.',
  'Range Buckets':'Distribution of chosen max jump ranges (approx – sampled on edit pauses).',
  'Last 7 Days (Newest First)':'Daily aggregate snapshot: one JSON per day.'
};

const StatRow: React.FC<{ label:string; value:React.ReactNode }> = ({ label, value }) => {
  const desc = DESCRIPTIONS[label];
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'2px 0' }} title={desc||undefined} aria-label={desc? `${label}: ${desc}`: label}>
      <span style={{ fontSize:12, opacity:.72 }}>{label}</span>
      <span style={{ fontSize:12, fontVariantNumeric:'tabular-nums' }}>{value}</span>
    </div>
  );
};

const DistTable: React.FC<{ title:string; rows:{k:string;c:number;label:string}[]; total:number }> = ({ title, rows, total }) => (
  <div style={{ display:'flex', flexDirection:'column', gap:6 }} title={DESCRIPTIONS[title]||undefined} aria-label={DESCRIPTIONS[title]? `${title}: ${DESCRIPTIONS[title]}`: title}>
    <h3 style={{ margin:'0 0 4px 0', fontSize:12, letterSpacing:'.5px', textTransform:'uppercase', opacity:.75 }}>{title}</h3>
    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
      <tbody>
        {rows.map(r=>{ const pct= total? (r.c/total)*100 : 0; return (
          <tr key={r.k} style={{ borderTop:'1px solid rgba(255,255,255,0.08)' }}>
            <td style={{ padding:'3px 4px', opacity:.8 }}>{r.label}</td>
            <td style={{ padding:'3px 4px', fontVariantNumeric:'tabular-nums' }}>{r.c}</td>
            <td style={{ padding:'3px 4px', width:'55%' }}>
              <div style={{ background:'rgba(255,255,255,0.08)', height:5, borderRadius:3, position:'relative' }}>
                <div style={{ position:'absolute', inset:0, width:pct+'%', background:'var(--accent)', borderRadius:3 }} />
              </div>
            </td>
            <td style={{ padding:'3px 4px', fontVariantNumeric:'tabular-nums', textAlign:'right' }}>{pct.toFixed(1)}%</td>
          </tr>
        ); })}
        <tr style={{ borderTop:'1px solid rgba(255,255,255,0.15)', fontWeight:600 }}>
          <td style={{ padding:'3px 4px' }}>Total</td>
          <td style={{ padding:'3px 4px', fontVariantNumeric:'tabular-nums' }}>{total}</td>
          <td />
          <td style={{ padding:'3px 4px' }}>100%</td>
        </tr>
      </tbody>
    </table>
  </div>
);

const StatsPage: React.FC = () => {
  const [data, setData] = useState<StatsSnapshot | null>(null);
  const [history, setHistory] = useState<StatsSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Daily derived snapshots
  const daily = useMemo(()=> history.map(h=>({ date: (h.date? h.date.replace(/\.json$/,''): h.updatedAt.slice(0,10)), counters: h.counters, sums: h.sums })), [history]);
  // No chart toggles (simplified to two primary charts)
  // Series builders
  // Chart 1: Core usage counts (page loads, P2P routes, scout baselines)
  const usageSeries = useMemo(()=>{
    const mk = (key:string,label:string,color:string)=> ({ id:key, label, color, points: daily.map(d=>({ x:d.date, y:d.counters[key]||0 })) });
    return [
      mk('page_loads','Page Loads', chartColors[0]),
      mk('p2p_routes','P2P Routes', chartColors[1]),
      mk('scout_baselines','Baselines', chartColors[3]) // green for distinction
    ];
  }, [daily]);
  // Chart 2: Engagement rates (share creation, route copy, cinematic usage) as percentages
  const engagementRateSeries = useMemo(()=>{
    return [
      { id:'share_rate', label:'Share Creation %', color:chartColors[0], points: daily.map(d=>{ const pl=d.counters.page_loads||0; const sh=d.counters.routes_shared||0; return { x:d.date, y: pl? (sh/pl)*100: 0 }; }) },
      { id:'copy_rate', label:'Route Copy %', color:chartColors[1], points: daily.map(d=>{ const routes=(d.counters.p2p_routes||0)+(d.counters.scout_optimizations||0); const copies=d.counters.route_copies||0; return { x:d.date, y: routes? (copies/routes)*100: 0 }; }) },
      { id:'cinematic_rate', label:'Cinematic Usage %', color:chartColors[2], points: daily.map(d=>{ const pl=d.counters.page_loads||0; const cs=d.counters.cinematic_sessions||0; return { x:d.date, y: pl? (cs/pl)*100: 0 }; }) }
    ];
  }, [daily]);

  useEffect(()=>{
    let cancelled=false;
    const fetchData = async () => {
      try {
  // Request up to 30 days of history (server caps at 31). Graph section (added later) consumes this.
  const res = await fetch('/.netlify/functions/stats?history=30');
        if(!res.ok) throw new Error('Failed');
        const json = await res.json();
        if(cancelled) return;
        setData(json.current);
        setHistory(json.history||[]);
      } catch(e:any){ if(!cancelled) setError(e.message||'Error loading stats'); }
    };
    fetchData();
    const id = setInterval(fetchData, 15000);
    return ()=>{ cancelled=true; clearInterval(id); };
  },[]);

  // Force full-page navy background (independent of user system theme) while on stats page
  useEffect(()=>{
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    const prevBodyColor = document.body.style.color;
    const prevColorScheme = (document.documentElement.style as any).colorScheme;
    document.documentElement.style.background = '#0b1119';
    document.body.style.background = '#0b1119';
    document.body.style.color = '#ffffff';
    (document.documentElement.style as any).colorScheme = 'dark';
    document.body.setAttribute('data-ef-stats','true');
    return ()=>{
      document.body.removeAttribute('data-ef-stats');
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
      document.body.style.color = prevBodyColor;
      (document.documentElement.style as any).colorScheme = prevColorScheme || '';
    };
  }, []);

  const pageBg = '#0b1119'; // unified dark background
  const pageColor = '#fff';

  return (
  <div style={{ maxWidth:1600, margin:'0 auto', padding:'34px 32px 80px 32px', fontFamily:'system-ui, sans-serif', color:pageColor, background:pageBg, boxSizing:'border-box' }}>
      <h1 style={{ fontSize:'28px', margin:'0 0 10px 0' }}>Usage Stats</h1>
      <p style={{ margin:'0 0 18px 0', fontSize:'14px', lineHeight:1.5, opacity:0.85 }}>Anonymous aggregate counters since deployment. Updates every ~15s. Diagnostic error counters hidden for clarity.</p>
      {error && <div style={{ color:'#f66', marginBottom:12 }}>{error}</div>}
      {!data && !error && <div>Loading...</div>}
      {data && (
        <>
        {/* Charts Section (side-by-side) */}
        {daily.length>0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:24, margin:'0 0 40px 0' }} aria-label="Usage Trend Charts">
            <section style={{ flex:'1 1 0', minWidth:600, background:'rgba(255,255,255,0.06)', padding:'20px 22px 16px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:12 }}>
              <h2 style={{ margin:'0 0 12px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Core Usage (Daily)</h2>
              <LineChart series={usageSeries} yLabel="Count" height={320} width={760} />
              <ChartLegend items={usageSeries.map(s=>({ label:s.label||s.id, color:s.color||chartColors[0] }))} />
            </section>
            <section style={{ flex:'1 1 0', minWidth:600, background:'rgba(255,255,255,0.06)', padding:'20px 22px 16px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:12 }}>
              <h2 style={{ margin:'0 0 12px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Engagement Rates (Daily)</h2>
              <LineChart series={engagementRateSeries} yLabel="Percent" height={320} width={760} />
              <ChartLegend items={engagementRateSeries.map(s=>({ label:s.label||s.id, color:s.color||chartColors[0] }))} />
            </section>
          </div>
        )}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:'20px' }}>
          {/* Activation & Load */}
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'16px 18px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, boxShadow:'0 2px 4px rgba(0,0,0,0.45)' }}>
            <h2 style={{ margin:'0 0 8px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Activation & Load</h2>
            <StatRow label="Page loads" value={data.counters.page_loads||0} />
            <StatRow label="First actions" value={data.counters.first_actions||0} />
            <StatRow label="Activation rate" value={( ()=>{ const pl=data.counters.page_loads||0; const fa=data.counters.first_actions||0; if(!pl) return '—'; return ((fa/pl)*100).toFixed(1)+'%'; })()} />
            <StatRow label="Avg DB load time" value={formatDurationAvg(data.sums.db_load_time_ms_sum, data.sums.db_load_time_count)} />
            <StatRow label="Avg time to first action" value={formatDurationAvg(data.sums.first_route_delay_ms_sum, data.sums.first_route_delay_count)} />
          </section>
          {/* P2P Routing */}
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'16px 18px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, boxShadow:'0 2px 4px rgba(0,0,0,0.45)' }}>
            <h2 style={{ margin:'0 0 8px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>P2P Routing</h2>
            <StatRow label="P2P routes" value={data.counters.p2p_routes||0} />
            <StatRow label="Avg route time" value={formatDurationAvg(data.sums.p2p_route_time_ms_sum, data.sums.p2p_route_time_count)} />
            <StatRow label="Cancelled" value={data.counters.p2p_cancelled||0} />
            <StatRow label="Cancellation rate" value={( ()=>{ const total=data.counters.p2p_routes||0; if(!total) return '—'; const c=data.counters.p2p_cancelled||0; return ((c/total)*100).toFixed(1)+'%'; })()} />
            <StatRow label="Algo (A*/Dij)" value={( ()=>{ const a=data.counters.p2p_algo_astar||0; const d=data.counters.p2p_algo_dijkstra||0; if(!a&&!d) return '—'; const t=a+d; return `${((a/t)*100).toFixed(0)}% / ${((d/t)*100).toFixed(0)}%`; })()} />
            <StatRow label="Mode (Fuel/Jumps)" value={( ()=>{ const f=data.counters.p2p_mode_fuel||0; const j=data.counters.p2p_mode_jumps||0; if(!f&&!j) return '—'; const t=f+j; return `${((f/t)*100).toFixed(0)}% / ${((j/t)*100).toFixed(0)}%`; })()} />
          </section>
          {/* Scout Optimization */}
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'16px 18px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, boxShadow:'0 2px 4px rgba(0,0,0,0.45)' }}>
            <h2 style={{ margin:'0 0 8px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Scout Optimization</h2>
            <StatRow label="Baselines" value={data.counters.scout_baselines||0} />
            <StatRow label="Optimizations" value={data.counters.scout_optimizations||0} />
            <StatRow label="Abandoned baselines" value={data.counters.scout_abandoned||0} />
            <StatRow label="Avg baseline time" value={formatDurationAvg(data.sums.scout_baseline_time_ms_sum, data.sums.scout_baseline_time_count)} />
            <StatRow label="Avg opt session time" value={formatDurationAvg(data.sums.scout_opt_session_time_ms_sum, data.sums.scout_opt_session_time_count)} />
            <StatRow label="Avg collected systems" value={( ()=> { const sum = data.sums.scout_collected_systems_sum; const count = data.sums.scout_collected_systems_count; if(!sum||!count) return '—'; return (sum/count).toFixed(1); })()} />
            <StatRow label="LY saved total" value={( ()=> { const s=data.sums.scout_opt_savings_ly_sum; return s? s.toFixed(2)+' LY':'—'; })()} />
            <StatRow label="LY saved avg" value={( ()=> { const s=data.sums.scout_opt_savings_ly_sum; const c=data.sums.scout_opt_savings_count; if(!s||!c) return '—'; return (s/c).toFixed(2)+' LY'; })()} />
          </section>
          {/* Feature Flags & Filters */}
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'16px 18px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, boxShadow:'0 2px 4px rgba(0,0,0,0.45)' }}>
            <h2 style={{ margin:'0 0 8px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Feature Flags & Filters</h2>
            <StatRow label="Waypoints used" value={data.counters.waypoints_used||0} />
            <StatRow label="Avoid used" value={data.counters.avoid_used||0} />
            <StatRow label="Waypoint optimize" value={data.counters.waypoint_opt_used||0} />
            <StatRow label="Return to start" value={data.counters.return_to_start||0} />
            <StatRow label="Gate reachable" value={data.counters.gate_reachable||0} />
            <StatRow label="Planet-filter baselines" value={data.counters.planet_filter_baselines||0} />
          </section>
          {/* UI & Theme */}
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'16px 18px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, boxShadow:'0 2px 4px rgba(0,0,0,0.45)' }}>
            <h2 style={{ margin:'0 0 8px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>UI & Theme</h2>
            <StatRow label="Blue theme" value={data.counters.theme_blue||0} />
            <StatRow label="Orange theme" value={data.counters.theme_orange||0} />
            <StatRow label="Theme switches" value={data.counters.theme_switches||0} />
            <StatRow label="Hide UI" value={data.counters.ui_hide||0} />
            <StatRow label="Show Distance" value={data.counters.show_distance||0} />
            <StatRow label="Help opens" value={data.counters.help_opens||0} />
            {(() => {
              const scaleKeys = Object.keys(data.counters).filter(k=> k.startsWith('ui_scale_'));
              if(!scaleKeys.length) return <StatRow label="Top UI scale" value="—" />;
              let total=0; let topKey=''; let topVal=0;
              scaleKeys.forEach(k=>{ const v=data.counters[k]||0; total+=v; if(v>topVal){ topVal=v; topKey=k; } });
              const pct = total? ((topVal/total)*100).toFixed(1)+'%':'—';
              const scale = topKey.replace('ui_scale_','');
              return <StatRow label="Top UI scale" value={`${scale}% (${pct})`} />;
            })()}
          </section>
          {/* Sharing & Donations */}
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'16px 18px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, boxShadow:'0 2px 4px rgba(0,0,0,0.45)' }}>
            <h2 style={{ margin:'0 0 8px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Sharing & Donations</h2>
            <StatRow label="Shares created" value={data.counters.routes_shared||0} />
            <StatRow label="Shares resolved" value={data.counters.shared_resolved||0} />
            <StatRow label="Resolution rate" value={( ()=>{ const c=data.counters.routes_shared||0; const r=data.counters.shared_resolved||0; if(!c) return '—'; return ((r/c)*100).toFixed(1)+'%'; })()} />
            <StatRow label="Route copies total" value={data.counters.route_copies||0} />
            <StatRow label="Copy rate" value={( ()=>{ const total=(data.counters.p2p_routes||0)+(data.counters.scout_optimizations||0); if(!total) return '—'; return (((data.counters.route_copies||0)/total)*100).toFixed(1)+'%'; })()} />
            <StatRow label="Modal opens" value={data.counters.donate_modal_open||0} />
            <StatRow label="Stripe clicks" value={data.counters.donate_stripe_clicks||0} />
            <StatRow label="Crypto clicks" value={data.counters.donate_crypto_clicks||0} />
            <StatRow label="Stripe CTR" value={( ()=>{ const o=data.counters.donate_modal_open||0; const s=data.counters.donate_stripe_clicks||0; if(!o) return '—'; return ((s/o)*100).toFixed(1)+'%'; })()} />
          </section>
          {/* Session & Cinematic */}
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'16px 18px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, boxShadow:'0 2px 4px rgba(0,0,0,0.45)' }}>
            <h2 style={{ margin:'0 0 8px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Session & Cinematic</h2>
            <StatRow label="Cinematic sessions" value={data.counters.cinematic_sessions||0} />
            <StatRow label="Cinematic enters" value={data.counters.cinematic_enters||0} />
            <StatRow label="Cinematic usage" value={( ()=>{ const pl=data.counters.page_loads||0; const cs=data.counters.cinematic_sessions||0; if(!pl) return '—'; return ((cs/pl)*100).toFixed(1)+'%'; })()} />
            <StatRow label="Avg open duration" value={formatDurationAvg(data.sums.session_time_ms_sum, data.sums.session_time_count)} />
            <StatRow label="Avg active duration" value={formatDurationAvg(data.sums.active_session_time_ms_sum, data.sums.active_session_time_count)} />
            {(()=>{ const buckets=[ { c:data.counters.sess_lt_1m||0, min:0, max:60_000 }, { c:data.counters.sess_1_5m||0, min:60_000, max:5*60_000 }, { c:data.counters.sess_5_15m||0, min:5*60_000, max:15*60_000 }, { c:data.counters.sess_15_60m||0, min:15*60_000, max:60*60_000 }, { c:data.counters.sess_gt_60m||0, min:60*60_000, max:120*60_000 } ]; const total=buckets.reduce((a,b)=>a+b.c,0); if(!total) return <StatRow label="Median open (est)" value="—" />; let cum=0; let medianMs=0; const target=total/2; for(const b of buckets){ if(cum + b.c >= target){ medianMs=(b.min+b.max)/2; break; } cum+=b.c; } return <StatRow label="Median open (est)" value={formatMs(medianMs)} />; })()}
            <StatRow label="Avg cinematic time" value={formatDurationAvg(data.sums.cinematic_time_ms_sum, data.sums.cinematic_time_count)} />
            <StatRow label="Cinematic time share" value={( ()=>{ const cSum=data.sums.cinematic_time_ms_sum; const sSum=data.sums.session_time_ms_sum; if(!cSum||!sSum) return '—'; return ((cSum/sSum)*100).toFixed(1)+'%'; })()} />
          </section>
          {/* Reachability */}
          <section style={{ background:'rgba(255,255,255,0.06)', padding:'16px 18px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, boxShadow:'0 2px 4px rgba(0,0,0,0.45)' }}>
            <h2 style={{ margin:'0 0 8px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Reachability</h2>
            <StatRow label="Reachability Usage" value={( ()=>{ const opens=data.counters.reachability_tab_open||0; const computes=data.counters.reachability_computes||0; return `${opens} opens / ${computes} computes`; })()} />
            <StatRow label="Auto on" value={data.counters.reachability_auto_on||0} />
            <StatRow label="Auto off" value={data.counters.reachability_auto_off||0} />
            <StatRow label="Unreachable on" value={data.counters.reachability_enable||0} />
            <StatRow label="Unreachable off" value={data.counters.reachability_disable||0} />
            <StatRow label="Bubble show" value={data.counters.rangebubble_show||0} />
            <StatRow label="Bubble hide" value={data.counters.rangebubble_hide||0} />
            <StatRow label="In-range on" value={data.counters.reachability_inrange_on||0} />
            <StatRow label="In-range off" value={data.counters.reachability_inrange_off||0} />
          </section>
          {/* Distributions */}
          <section style={{ background:'rgba(255,255,255,0.04)', padding:'18px 20px', border:'1px solid rgba(255,255,255,0.12)', borderRadius:12, boxShadow:'0 2px 4px rgba(0,0,0,0.55)', gridColumn:'1 / -1' }}>
            <h2 style={{ margin:'0 0 14px 0', fontSize:'15px', letterSpacing:'.5px', textTransform:'uppercase', opacity:0.85 }}>Distributions</h2>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))', gap:22 }}>
              {(()=>{ const keys=['hops_lt_10','hops_10_30','hops_30_60','hops_gt_60']; const labelMap:{[k:string]:string}={hops_lt_10:'<10',hops_10_30:'10–30',hops_30_60:'30–60',hops_gt_60:'>60'}; const rows=keys.map(k=>({k,c:data.counters[k]||0,label:labelMap[k]})); const tot=rows.reduce((a,b)=>a+b.c,0); return <DistTable title="P2P Route Hops" rows={rows} total={tot} />; })()}
              {(()=>{ const keys=['scout_hops_lt_10','scout_hops_10_30','scout_hops_30_60','scout_hops_gt_60']; const labelMap:{[k:string]:string}={scout_hops_lt_10:'<10',scout_hops_10_30:'10–30',scout_hops_30_60:'30–60',scout_hops_gt_60:'>60'}; const rows=keys.map(k=>({k,c:data.counters[k]||0,label:labelMap[k]})); const tot=rows.reduce((a,b)=>a+b.c,0); return <DistTable title="Scout Baseline Hops" rows={rows} total={tot} />; })()}
              {(()=>{ const keys=['save_0_50','save_50_100','save_100_200','save_gt_200']; const labelMap:{[k:string]:string}={save_0_50:'0–50',save_50_100:'50–100',save_100_200:'100–200',save_gt_200:'>200'}; const rows=keys.map(k=>({k,c:data.counters[k]||0,label:labelMap[k]})); const tot=rows.reduce((a,b)=>a+b.c,0); return <DistTable title="Savings (LY)" rows={rows} total={tot} />; })()}
              {(()=>{ const keys=['bins_5','bins_3_4','bins_1_2','bins_0']; const labelMap:{[k:string]:string}={bins_5:'5',bins_3_4:'3–4',bins_1_2:'1–2',bins_0:'0'}; const rows=keys.map(k=>({k,c:data.counters[k]||0,label:labelMap[k]})); const tot=rows.reduce((a,b)=>a+b.c,0); return <DistTable title="Planet Bins Active" rows={rows} total={tot} />; })()}
              {(()=>{ const workerKeys=Object.keys(data.counters).filter(k=> k.startsWith('opt_workers_used_')); const rows=workerKeys.sort((a,b)=> parseInt(a.split('_').pop()||'0')-parseInt(b.split('_').pop()||'0')).map(k=>({k,c:data.counters[k]||0,label:k.replace('opt_workers_used_','')})); const tot=rows.reduce((a,b)=>a+b.c,0); return <DistTable title="Workers Used" rows={rows} total={tot} />; })()}
              {(()=>{ const scaleKeys=Object.keys(data.counters).filter(k=> k.startsWith('ui_scale_')); const rows=scaleKeys.sort((a,b)=> parseInt(a.replace('ui_scale_',''))-parseInt(b.replace('ui_scale_',''))).map(k=>({k,c:data.counters[k]||0,label:k.replace('ui_scale_','')+'%'})); const tot=rows.reduce((a,b)=>a+b.c,0); return <DistTable title="UI Scale" rows={rows} total={tot} />; })()}
            </div>
          </section>
  </div>
  </>
      )}
      <div style={{ marginTop:22, fontSize:'11px', opacity:0.5 }}>Updated: {data? new Date(data.updatedAt).toLocaleString(): '—'}</div>
      {history.length>0 && (
        <div style={{ marginTop:30 }}>
          <h2 style={{ fontSize:'16px', margin:'0 0 10px 0' }}>Last 7 Days (Newest First)</h2>
          <div style={{ overflowX:'auto', border:'1px solid rgba(255,255,255,0.12)', borderRadius:10, background:'rgba(255,255,255,0.04)' }}>
            <table style={{ borderCollapse:'collapse', width:'100%', fontSize:'12px' }}>
              <thead>
                <tr style={{ textAlign:'left', background:'rgba(255,255,255,0.06)' }}>
                  {['Date','Page loads','P2P','Baselines','Opt starts','Shares','Resolved','Avg P2P','Avg baseline','Avg active session','Avg LY saved','Total LY saved','Cinematic sessions','Copy rate %'].map(h=> <th key={h} style={{ padding:'6px 8px', fontWeight:600 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...history].sort((a,b)=>{ const da=(a.date? a.date.replace(/\.json$/,''):a.updatedAt.slice(0,10)); const db=(b.date? b.date.replace(/\.json$/,''):b.updatedAt.slice(0,10)); return db.localeCompare(da); }).map(h=>{
                  const avgP2P = h.sums.p2p_route_time_count ? (h.sums.p2p_route_time_ms_sum / h.sums.p2p_route_time_count) : undefined;
                  const avgBase = h.sums.scout_baseline_time_count ? (h.sums.scout_baseline_time_ms_sum / h.sums.scout_baseline_time_count) : undefined;
                  const avgActive = h.sums.active_session_time_count ? (h.sums.active_session_time_ms_sum / h.sums.active_session_time_count) : undefined;
                  const avgSaved = h.sums.scout_opt_savings_count ? (h.sums.scout_opt_savings_ly_sum / h.sums.scout_opt_savings_count) : undefined;
                  const totalSaved = h.sums.scout_opt_savings_ly_sum;
                  const copyRate = (()=>{ const total=(h.counters.p2p_routes||0)+(h.counters.scout_optimizations||0); if(!total) return '—'; const copies=h.counters.route_copies||0; return ((copies/total)*100).toFixed(1); })();
                  return (
                    <tr key={h.date||h.updatedAt} style={{ borderTop:'1px solid rgba(255,255,255,0.08)' }}>
                      <td style={{ padding:'4px 8px', opacity:0.85 }}>{(h.date? h.date.replace(/\.json$/,''):h.updatedAt.slice(0,10))}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.page_loads||0}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.p2p_routes||0}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.scout_baselines||0}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.scout_optimizations||0}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.routes_shared||0}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.shared_resolved||0}</td>
                      <td style={{ padding:'4px 8px' }}>{avgP2P!==undefined? formatMs(avgP2P): '—'}</td>
                      <td style={{ padding:'4px 8px' }}>{avgBase!==undefined? formatMs(avgBase): '—'}</td>
                      <td style={{ padding:'4px 8px' }}>{avgActive!==undefined? formatMs(avgActive): '—'}</td>
                      <td style={{ padding:'4px 8px' }}>{avgSaved!==undefined? avgSaved.toFixed(2): '—'}</td>
                      <td style={{ padding:'4px 8px' }}>{totalSaved!==undefined? totalSaved.toFixed(2): '—'}</td>
                      <td style={{ padding:'4px 8px' }}>{h.counters.cinematic_sessions||0}</td>
                      <td style={{ padding:'4px 8px' }}>{copyRate==='—'? '—' : copyRate+'%'}</td>
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

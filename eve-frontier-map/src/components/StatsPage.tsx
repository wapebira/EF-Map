import React, { useEffect, useState } from 'react';

interface StatsSnapshot {
  version: number;
  updatedAt: string;
  counters: Record<string, number>;
  sums: Record<string, number>;
}

const formatDurationAvg = (sum:number|undefined, count:number|undefined) => {
  if(!sum || !count || count===0) return '—';
  const ms = sum / count;
  if(ms < 1000) return ms.toFixed(0)+' ms';
  const s = ms/1000; if(s < 60) return s.toFixed(2)+' s';
  const m = s/60; return m.toFixed(2)+' m';
};

const StatRow: React.FC<{ label:string; value: React.ReactNode }>=({label,value})=> (
  <div style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.06)', fontSize:'13px' }}>
    <span style={{ opacity:0.8 }}>{label}</span>
    <strong style={{ fontVariantNumeric:'tabular-nums' }}>{value}</strong>
  </div>
);

const StatsPage: React.FC = () => {
  const [data, setData] = useState<StatsSnapshot|null>(null);
  const [error, setError] = useState<string>('');

  const load = async () => {
    try {
      const res = await fetch('/.netlify/functions/stats');
      if(!res.ok) throw new Error('Failed');
      const json = await res.json();
      setData(json);
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
        </div>
      )}
      <div style={{ marginTop:22, fontSize:'11px', opacity:0.5 }}>Updated: {data? new Date(data.updatedAt).toLocaleString(): '—'}</div>
    </div>
  );
};

export default StatsPage;

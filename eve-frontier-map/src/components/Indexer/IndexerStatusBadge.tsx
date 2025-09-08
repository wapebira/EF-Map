import React, { useEffect, useRef, useState } from 'react';

interface HealthData {
  status?: string;
  lastRun?: any;
  cursor?: { last_block_number?: number; updated_at?: string } | null;
  ingestionLagMs?: number | null;
  pendingChanges?: any;
  snapshotRecommended?: boolean;
  snapshotReason?: string | null;
  changeSummary?: any;
  hasAdminToken?: boolean;
}

type BadgeState = 'loading' | 'ok' | 'stalled' | 'error' | 'idle';

const classify = (h: HealthData | null, now: number): BadgeState => {
  if(!h) return 'loading';
  if(h.status && h.status !== 'ok') return 'error';
  const lr = h.lastRun;
  if(!lr) return 'idle';
  const finished = lr.run_finished_at ? Date.parse(lr.run_finished_at + (lr.run_finished_at.endsWith('Z')?'':'Z')) : NaN;
  const started = lr.run_started_at ? Date.parse(lr.run_started_at + (lr.run_started_at.endsWith('Z')?'':'Z')) : NaN;
  if(!isNaN(started) && !lr.run_finished_at && (now - started) < 25*60*1000) return 'ok'; // active <25m
  if(!isNaN(finished)){
    const age = now - finished;
    if(age < 10*60*1000) return 'ok';
    if(age < 25*60*1000) return 'idle';
    return 'stalled';
  }
  return 'idle';
};

interface IndexerStatusBadgeProps { inline?: boolean }
export const IndexerStatusBadge: React.FC<IndexerStatusBadgeProps> = ({ inline }) => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [open, setOpen] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<any>(null);
  const fetchHealth = async () => {
    try {
      const r = await fetch('/api/indexer-health?details=1');
      if(!r.ok) throw new Error('health_http_'+r.status);
      const j = await r.json();
      setHealth(j);
      setError(null);
    } catch(e:any){ setError(String(e)); }
  };
  useEffect(()=>{ fetchHealth(); timerRef.current = setInterval(fetchHealth, 30000); return ()=> clearInterval(timerRef.current); }, []);
  const state = classify(health, Date.now());
  const color = state==='ok'? '#27c93f' : state==='idle'? '#f1c40f' : state==='stalled'? '#e67e22' : state==='error'? '#e74c3c' : '#888';
  const title = state==='ok'? 'Indexer healthy' : state==='idle'? 'Idle (recent run)' : state==='stalled'? 'Stalled (no recent run)' : state==='error'? 'Error' : 'Loading';
  const lastRunDur = health?.lastRun?.run_duration_ms;
  const lastRunRows = health?.lastRun?.rows_added;
  async function trigger(){
    setTriggering(true); setError(null);
    try {
  // If running on a Cloudflare Pages preview host we need the openPreview=1 flag
  // so the worker's preview auth bypass activates when no admin token is bound.
  const isPreview = typeof window !== 'undefined' && window.location.hostname.endsWith('.pages.dev');
  const url = isPreview ? '/api/indexer-trigger?openPreview=1' : '/api/indexer-trigger';
  const r = await fetch(url, { method:'POST' });
      const j = await r.json().catch(()=>({}));
      if(!r.ok || j.error){ throw new Error(j.error||('trigger_http_'+r.status)); }
      // immediate refresh
      fetchHealth();
    } catch(e:any){ setError(String(e)); }
    finally { setTriggering(false); }
  }
  const wrapperStyle: React.CSSProperties = inline ? ({ position:'relative', marginTop:40, fontFamily:'system-ui, sans-serif', fontSize:12 }) : ({ position:'fixed', bottom:10, right:10, zIndex:3400, fontFamily:'system-ui, sans-serif', fontSize:12 });
  return (
    <div style={wrapperStyle}>
      <button onClick={()=> setOpen(o=> !o)} aria-label={title} style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(0,0,0,0.55)', color:'#fff', border:'1px solid rgba(255,255,255,0.25)', padding:'6px 10px', borderRadius:18, cursor:'pointer', backdropFilter:'blur(6px) saturate(150%)', boxShadow:'0 2px 6px rgba(0,0,0,0.45)' }}>
        <span style={{ width:10, height:10, borderRadius:10, background:color, boxShadow:`0 0 4px ${color}` }} />
        <span style={{ fontWeight:600 }}>Indexer</span>
        <span style={{ opacity:.75 }}>{state}</span>
      </button>
      {open && (
        <div style={{ marginTop:8, minWidth:280, maxWidth:360, background:'rgba(15,15,18,0.9)', color:'#fff', border:'1px solid rgba(255,255,255,0.18)', padding:'10px 12px 14px', borderRadius:12, backdropFilter:'blur(10px) saturate(160%)', boxShadow:'0 4px 18px -4px rgba(0,0,0,0.65)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <strong style={{ fontSize:13 }}>Indexer Status</strong>
            <button onClick={()=> setOpen(false)} style={{ background:'none', border:'none', color:'#ccc', cursor:'pointer', fontSize:16, lineHeight:1 }}>×</button>
          </div>
          <div style={{ fontSize:12, lineHeight:1.4, display:'flex', flexDirection:'column', gap:4 }}>
            <div><span style={{ opacity:.65 }}>State:</span> {state}</div>
            {health?.cursor && <div><span style={{ opacity:.65 }}>Cursor Block:</span> {health.cursor.last_block_number}</div>}
            {lastRunRows!=null && <div><span style={{ opacity:.65 }}>Last rows_added:</span> {lastRunRows}</div>}
            {lastRunDur!=null && <div><span style={{ opacity:.65 }}>Last duration:</span> {Math.round(lastRunDur/1000)}s</div>}
            {health?.ingestionLagMs!=null && <div><span style={{ opacity:.65 }}>Lag:</span> {Math.round(health.ingestionLagMs/1000)}s</div>}
            {health?.pendingChanges && <div><span style={{ opacity:.65 }}>Pending:</span> +{health.pendingChanges.eventsAhead} ev ({health.pendingChanges.assembliesToInsert||0} ins / {health.pendingChanges.assembliesToUpdate||0} upd / {health.pendingChanges.assembliesToDelete||0} del)</div>}
            {health?.snapshotRecommended && <div style={{ color:'#f39c12' }}>Snapshot recommended ({health.snapshotReason})</div>}
            {error && <div style={{ color:'#e74c3c' }}>Err: {error}</div>}
          </div>
          <div style={{ marginTop:10, display:'flex', gap:8, flexWrap:'wrap' }}>
            <button disabled={triggering || state==='loading'} onClick={trigger} style={{ flex:'0 0 auto', background:'var(--accent, #ff4c26)', color:'#fff', border:'none', padding:'6px 12px', fontSize:12, fontWeight:600, borderRadius:6, cursor: triggering? 'wait':'pointer' }}>{triggering? 'Running…':'Run Now'}</button>
            <button onClick={()=> fetchHealth()} disabled={triggering} style={{ background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)', padding:'6px 12px', fontSize:12, fontWeight:500, borderRadius:6, cursor:'pointer' }}>Refresh</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default IndexerStatusBadge;

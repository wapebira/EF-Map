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
  const started = lr.run_started_at ? Date.parse(lr.run_started_at + (lr.run_started_at.endsWith('Z')?'':'Z')) : NaN;
  const finished = lr.run_finished_at ? Date.parse(lr.run_finished_at + (lr.run_finished_at.endsWith('Z')?'':'Z')) : NaN;
  const lastProg = lr.last_progress_at ? Date.parse(lr.last_progress_at + (lr.last_progress_at.endsWith('Z')?'':'Z')) : NaN;
  if(!isNaN(started) && !lr.run_finished_at){
    // Active run: use progress heartbeat age if available
    if(!isNaN(lastProg)){
      const gap = now - lastProg;
      if(gap <= 60_000) return 'ok';
      if(gap <= 120_000) return 'idle';
      return 'stalled';
    }
    // Fallback: no heartbeat column yet
    if((now - started) < 25*60*1000) return 'ok';
  }
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
  // No local error UI; keep fetch resilient without storing error state
  const timerRef = useRef<any>(null);
  const fetchHealth = async () => {
    try {
      // Lightweight: no counts/db/probe by default for badge
      const r = await fetch('/api/indexer-health');
      if(!r.ok) throw new Error('health_http_'+r.status);
      const j = await r.json();
      setHealth(j);
    } catch(e:any){ /* ignore */ }
  };
  useEffect(()=>{ fetchHealth(); timerRef.current = setInterval(fetchHealth, 30000); return ()=> clearInterval(timerRef.current); }, []);
  const state = classify(health, Date.now());
  const color = state==='ok'? '#27c93f' : state==='idle'? '#f1c40f' : state==='stalled'? '#e67e22' : state==='error'? '#e74c3c' : '#888';
  const title = state==='ok'? 'Indexer healthy' : state==='idle'? 'Idle (recent run)' : state==='stalled'? 'Stalled (no recent run)' : state==='error'? 'Error' : 'Loading';
  // (Popover removed) — no per-field details needed here.
  // Read-only: no trigger action exposed here
  const wrapperStyle: React.CSSProperties = inline ? ({ position:'relative', marginTop:40, fontFamily:'system-ui, sans-serif', fontSize:12 }) : ({ position:'fixed', bottom:12, right:122, zIndex:3400, fontFamily:'system-ui, sans-serif', fontSize:12 });
  const onClick = () => {
    // Behavior:
    // - When inline (on /indexer), do nothing on click.
    // - When floating (main UI), open the indexer dashboard in a new tab.
    if (inline) return;
    try { window.open('/indexer', '_blank'); } catch {}
  };
  return (
    <div style={wrapperStyle} className="ef-indexer-badge">
      <button onClick={onClick} aria-label={title} style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(0,0,0,0.55)', color:'#fff', border:'1px solid rgba(255,255,255,0.14)', padding:'6px 10px', borderRadius:18, cursor:'pointer', backdropFilter:'blur(6px) saturate(150%)', boxShadow:'0 2px 6px rgba(0,0,0,0.45)' }}>
        <span style={{ width:10, height:10, borderRadius:10, background:color, boxShadow:`0 0 4px ${color}` }} />
        <span style={{ fontWeight:600 }}>Indexer</span>
        <span style={{ opacity:.75 }}>{state}</span>
      </button>
    </div>
  );
};

export default IndexerStatusBadge;

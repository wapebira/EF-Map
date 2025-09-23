import React, { useEffect, useRef, useState } from 'react';

type BadgeState = 'loading' | 'ok' | 'stalled' | 'error' | 'idle';

interface IndexerStatusBadgeProps { inline?: boolean }
export const IndexerStatusBadge: React.FC<IndexerStatusBadgeProps> = ({ inline }) => {
  const [snapshots, setSnapshots] = useState<{ links?: { updatedAt?: string|null; count?: number|null }|null, acl?: { updatedAt?: string|null; count?: number|null }|null } | null>(null);
  const timerRef = useRef<any>(null);
  const fetchSnapshots = async () => {
    try {
      const r = await fetch('/api/debug-snapshots');
      if(!r.ok) throw new Error('snapshots_http_'+r.status);
      const j = await r.json();
      setSnapshots({ links: j?.links || null, acl: j?.acl || null });
    } catch { /* ignore */ }
  };
  useEffect(()=>{ fetchSnapshots(); timerRef.current = setInterval(()=>{ fetchSnapshots(); }, 30000); return ()=> clearInterval(timerRef.current); }, []);

  // Classify Smart Gates freshness: green if any snapshot within last 10 minutes
  const gatesState: BadgeState = (()=>{
    if(!snapshots) return 'loading';
    const now = Date.now();
    const parse = (s?:string|null)=>{
      if(!s) return NaN; try { return Date.parse(s.endsWith('Z')? s : (s+'Z')); } catch { return NaN; }
    };
    const tsLinks = parse(snapshots.links?.updatedAt||null);
    const tsAcl = parse(snapshots.acl?.updatedAt||null);
    const ts = Math.max(isFinite(tsLinks)?tsLinks:0, isFinite(tsAcl)?tsAcl:0);
    if(!isFinite(ts) || ts===0) return 'idle';
    const age = now - ts;
    if(age <= 10*60*1000) return 'ok';
    if(age <= 25*60*1000) return 'idle';
    return 'stalled';
  })();
  const gatesColor = gatesState==='ok'? '#27c93f' : gatesState==='idle'? '#f1c40f' : gatesState==='stalled'? '#e67e22' : '#888';
  const gatesTitle = gatesState==='ok'? 'Gates fresh (≤10m)' : gatesState==='idle'? 'Gates a bit old (≤25m)' : gatesState==='stalled'? 'Gates stale (>25m)' : 'Gates: loading';
  // (Popover removed) — no per-field details needed here.
  // Read-only: no trigger action exposed here
  const wrapperStyle: React.CSSProperties = inline ? ({ position:'relative', marginTop:40, fontFamily:'system-ui, sans-serif', fontSize:12 }) : ({ position:'fixed', bottom:12, right:122, zIndex:3400, fontFamily:'system-ui, sans-serif', fontSize:12 });
  return (
    <div style={wrapperStyle} className="ef-indexer-badge">
      <div aria-label={gatesTitle} style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(0,0,0,0.55)', color:'#fff', border:'1px solid rgba(255,255,255,0.14)', padding:'6px 10px', borderRadius:18, cursor:'default', backdropFilter:'blur(6px) saturate(150%)', boxShadow:'0 2px 6px rgba(0,0,0,0.45)' }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:6 }} title={gatesTitle}>
          <span style={{ width:10, height:10, borderRadius:10, background:gatesColor, boxShadow:`0 0 4px ${gatesColor}` }} />
          <span style={{ fontWeight:600 }}>Gates</span>
          <span style={{ opacity:.75 }}>{gatesState}</span>
        </span>
      </div>
    </div>
  );
};

export default IndexerStatusBadge;

import React, { useEffect, useState } from 'react';
import IndexerStatusBadge from './Indexer/IndexerStatusBadge';

interface Health {
  status: string;
  world?: any;
  counts?: Record<string, number|string>;
  lastRun?: any;
  cursor?: any;
  ingestionLagMs?: number|null;
  pendingChanges?: any;
}
interface RunsResp {
  status:string;
  active:any[];
  runs:any[];
}

const fmt = (d?:string)=>{ if(!d) return '-'; try { return new Date(d.replace(' ','T')+'Z').toLocaleString(); } catch { return d; } };
const ms = (n?:number|null)=> (n==null||!isFinite(n))?'-': n.toLocaleString();

const IndexerPage: React.FC = () => {
  const [health, setHealth] = useState<Health|null>(null);
  const [runs, setRuns] = useState<RunsResp|null>(null);
  const [loading, setLoading] = useState(false);
  const isPreview = typeof window!=='undefined' && window.location.hostname.endsWith('.pages.dev');
  const qp = isPreview? '?openPreview=1':'';

  const load = async ()=>{
    setLoading(true);
    try {
      const h = await fetch(`/api/indexer-health?details=1${isPreview?'&openPreview=1':''}`).then(r=> r.json());
      setHealth(h);
      const rj = await fetch(`/api/indexer-runs${qp}`).then(r=> r.json());
      setRuns(rj);
    } catch(e){ /* ignore */ }
    setLoading(false);
  };
  useEffect(()=>{ load(); const id=setInterval(load, 30000); return ()=> clearInterval(id); }, []);

  const trigger = async ()=>{
    try { await fetch(`/api/indexer-trigger${qp}`, { method:'POST'}).then(r=> r.json()); load(); } catch {/* ignore */}
  };
  const reset = async ()=>{
    if(!window.confirm('Reset active run & rewind cursor to deploy block - 1?')) return;
    try { await fetch(`/api/indexer-reset${qp}`, { method:'POST'}).then(r=> r.json()); load(); } catch {/* ignore */}
  };

  const renderStatus = (r:any)=>{
    if(!r) return '-';
    if(!r.run_finished_at){
      return <span style={chipStyle('#ffb347', '#111')}>Active</span>;
    }
    const added = Number(r.rows_added||0);
    const attempted = Number(r.attempted_logs||0);
    if(added===0 && attempted>0){
      return <span style={chipStyle('#888', '#fff')}>Duplicate</span>;
    }
    if(added>0){
      return <span style={chipStyle('#4caf50', '#fff')}>Inserted {added}</span>;
    }
    return <span style={chipStyle('#666', '#fff')}>Idle</span>;
  };

  return (
    <div style={{padding:'24px 28px', fontFamily:'Inter, system-ui, sans-serif', color:'#eee'}}>
      <h1 style={{margin:'0 0 12px 0', fontSize:28}}>Indexer Dashboard</h1>
      <div style={{ margin:'0 0 20px 0' }}>
        {/* Prominent live status (moved from Stats page) */}
        <IndexerStatusBadge inline />
      </div>
      {/* High level current snapshot */}
      {health && (
        <div style={{display:'flex', flexWrap:'wrap', gap:14, margin:'0 0 22px 0', fontSize:13, background:'rgba(255,255,255,0.05)', padding:'10px 14px', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8}}>
          <div><strong>Status:</strong> {health.status}</div>
          <div><strong>Cursor:</strong> {health.cursor?.last_block_number ?? '-'}</div>
          <div><strong>Raw Logs:</strong> {ms(Number(health.counts?.raw_logs||0))}</div>
          <div><strong>Store Events:</strong> {ms(Number(health.counts?.store_events||0))}</div>
          <div><strong>Last Run:</strong> {health.lastRun? (health.lastRun.run_finished_at? `#${health.lastRun.id} finished` : `#${health.lastRun.id} active`) : '—'}</div>
          {health.ingestionLagMs!=null && <div><strong>Lag:</strong> {Math.round(health.ingestionLagMs/1000)}s</div>}
        </div>
      )}
      <div style={{display:'flex', gap:12, flexWrap:'wrap', marginBottom:16}}>
        <button onClick={load} disabled={loading} style={{padding:'8px 14px'}}>Refresh</button>
        <button onClick={trigger} style={{padding:'8px 14px'}}>Run Now</button>
        <button onClick={reset} style={{padding:'8px 14px'}}>Reset (Rewind)</button>
        {loading && <span style={{opacity:.7}}>Loading…</span>}
      </div>
      {!health && <div style={{opacity:.7}}>No health data yet.</div>}
      {health && (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px,1fr))', gap:14, marginBottom:28}}>
          <div style={cardStyle}>
            <h3 style={cardTitle}>Status</h3>
            <div>{health.status}</div>
            {health.ingestionLagMs!=null && <div style={subtle}>Lag: {Math.round(health.ingestionLagMs/1000)}s</div>}
          </div>
          <div style={cardStyle}>
            <h3 style={cardTitle}>World</h3>
            <div>{health.world? health.world.world_address : '-'}</div>
          </div>
          <div style={cardStyle}>
            <h3 style={cardTitle}>Cursor</h3>
            <div>Block: {health.cursor?.last_block_number ?? '-'}</div>
            <div style={subtle}>Updated: {fmt(health.cursor?.updated_at)}</div>
          </div>
          <div style={cardStyle}>
            <h3 style={cardTitle}>Last Run</h3>
            <div>ID: {health.lastRun?.id ?? '-'}</div>
            <div style={subtle}>{health.lastRun? (health.lastRun.run_finished_at? 'Finished':'Active') : ''}</div>
            {health.lastRun && !health.lastRun.run_finished_at && (
              <div style={{marginTop:6, fontSize:11, lineHeight:1.4}}>
                <div style={subtle}>Rows so far: {health.lastRun.rows_so_far ?? 0}</div>
                <div style={subtle}>Seg req: {health.lastRun.seg_requests_so_far ?? 0}</div>
                <div style={subtle}>Flushes: {health.lastRun.batch_flushes ?? 0}</div>
                <div style={subtle}>Batch(cur): {health.lastRun.adaptive_batch_current ?? 0}</div>
              </div>
            )}
            {health.lastRun && health.lastRun.run_finished_at && (
              <div style={{marginTop:6, fontSize:11, lineHeight:1.4}}>
                <div style={subtle}>Rows added: {health.lastRun.rows_added ?? 0}</div>
                <div style={subtle}>Seg req: {health.lastRun.seg_requests_so_far ?? 0}</div>
                <div style={subtle}>Flushes: {health.lastRun.batch_flushes ?? 0}</div>
                <div style={subtle}>Batch(final): {health.lastRun.adaptive_batch_current ?? 0}</div>
                <div style={subtle}>Stall restarts: {health.lastRun.stall_restarts ?? 0}</div>
              </div>
            )}
          </div>
          <div style={cardStyle}>
            <h3 style={cardTitle}>Raw Logs</h3>
            <div>{ms(Number(health.counts?.raw_logs||0))}</div>
          </div>
          <div style={cardStyle}>
            <h3 style={cardTitle}>Store Events</h3>
            <div>{ms(Number(health.counts?.store_events||0))}</div>
          </div>
        </div>
      )}
      <h2 style={{margin:'0 0 8px 0', fontSize:22}}>Recent Runs</h2>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%', borderCollapse:'collapse', fontSize:13, lineHeight:1.35}}>
          <thead>
            <tr style={theadRowStyle}>
              {['ID','Mode','Started','Finished','Rows(+SoFar)','Attempted','SegReq','Flushes','BatchCur','Restarts','Errors','Dur(ms)','Status','Notes'].map(h=> <th key={h} style={thStyle}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {runs?.runs?.map(r=> (
              <tr key={r.id} style={{background: r.run_finished_at? 'rgba(255,255,255,0.02)':'rgba(255,170,0,0.08)'}}>
                <td style={tdStyle}>{r.id}</td>
                <td style={tdStyle}>{r.mode}</td>
                <td style={tdStyle}>{fmt(r.run_started_at)}</td>
                <td style={tdStyle}>{fmt(r.run_finished_at)}</td>
                <td style={tdStyle}>{r.rows_added}{!r.run_finished_at && (r.rows_so_far!=null) ? ` (${r.rows_so_far})` : ''}</td>
                <td style={tdStyle}>{r.attempted_logs ?? '-'}</td>
                <td style={tdStyle}>{(r.seg_requests_so_far != null ? r.seg_requests_so_far : (r.seg_requests != null ? r.seg_requests : 0))}</td>
                <td style={tdStyle}>{r.batch_flushes ?? 0}</td>
                <td style={tdStyle}>{r.adaptive_batch_current ?? '-'}</td>
                <td style={tdStyle}>{r.stall_restarts ?? 0}</td>
                <td style={tdStyle}>{r.error_count}</td>
                <td style={tdStyle}>{r.run_duration_ms ?? '-'}</td>
                <td style={tdStyle}>{renderStatus(r)}</td>
                <td style={{...tdStyle, maxWidth:240, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={r.notes||''}>{r.notes||''}</td>
              </tr>
            ))}
            {!runs?.runs?.length && <tr><td style={tdStyle} colSpan={8}>No runs.</td></tr>}
          </tbody>
        </table>
      </div>
      <p style={{marginTop:28, fontSize:12, opacity:.55}}>Preview access: {isPreview? 'open (preview bypass)':'production (admin token required for mutations)'}</p>
    </div>
  );
};

const subtle: React.CSSProperties = { fontSize:12, opacity:.65 };
const cardStyle: React.CSSProperties = { background:'rgba(255,255,255,0.06)', padding:'12px 14px', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, minHeight:70 };
const cardTitle: React.CSSProperties = { margin:'0 0 6px 0', fontSize:13, letterSpacing:'.5px', textTransform:'uppercase', opacity:.75 };
const theadRowStyle: React.CSSProperties = { background:'rgba(255,255,255,0.08)' };
const thStyle: React.CSSProperties = { textAlign:'left', padding:'6px 8px', fontWeight:600, fontSize:12, letterSpacing:'.5px', borderBottom:'1px solid rgba(255,255,255,0.15)' };
const tdStyle: React.CSSProperties = { padding:'6px 8px', borderBottom:'1px solid rgba(255,255,255,0.08)', fontFamily:'monospace' };
const chipStyle = (bg:string, fg:string): React.CSSProperties => ({ display:'inline-block', padding:'2px 6px', borderRadius:12, background:bg, color:fg, fontSize:11, fontWeight:600 });

export default IndexerPage;

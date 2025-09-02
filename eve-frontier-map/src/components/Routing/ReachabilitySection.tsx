import React, { useEffect, useRef, useState } from 'react';
import AutoCompleteInput from '../AutoCompleteInput/AutoCompleteInput';

interface Props {
  originSystemName?: string;
  systemNames: string[];
  onCompute:(origin:string, range:number)=>void;
  onRangeChange:(range:number)=>void;
  onOriginChange:(origin:string)=>void;
  range:number;
  auto:boolean;
  onAutoChange:(v:boolean)=>void;
  dim:boolean;
  onDimChange:(v:boolean)=>void;
  bubble:boolean;
  onBubbleChange:(v:boolean)=>void;
  inRange:boolean;
  onInRangeChange:(v:boolean)=>void;
  lastStats?: { reachable:number; total:number; ms:number } | null;
  disabledReason?: string | null;
  computing:boolean;
}

const ReachabilitySection:React.FC<Props> = ({ originSystemName, systemNames, onCompute, onRangeChange, onOriginChange, range, auto, onAutoChange, dim, onDimChange, bubble, onBubbleChange, inRange, onInRangeChange, lastStats, disabledReason, computing }) => {
  const [localOrigin, setLocalOrigin] = useState(originSystemName||'');
  // Keep range as string so user can clear field (empty -> treated as 0 internally)
  const [localRangeStr, setLocalRangeStr] = useState<string>(String(range));
  const rangeInputRef = useRef<HTMLInputElement|null>(null);
  const editingRangeRef = useRef(false);

  useEffect(()=>{ setLocalOrigin(originSystemName||''); }, [originSystemName]);
  // Sync from parent unless user currently editing
  useEffect(()=>{ if(!editingRangeRef.current){ setLocalRangeStr(String(range)); } }, [range]);
  const localRangeNum = parseFloat(localRangeStr || '0') || 0;
  useEffect(()=>{
    if(auto && localOrigin && localRangeNum>0){ const h = setTimeout(()=> onCompute(localOrigin, localRangeNum), 280); return ()=> clearTimeout(h); }
  }, [auto, localOrigin, localRangeNum, onCompute]);

  const total = lastStats?.total;
  return (
    <div style={{ marginTop:18, borderTop:'1px solid rgba(255,255,255,0.1)', paddingTop:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <strong style={{ fontSize:13 }}>Reachability</strong>
        {disabledReason && <span style={{ fontSize:11, opacity:0.65 }}>{disabledReason}</span>}
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:12 }}>Origin System</span>
          <AutoCompleteInput
            value={localOrigin}
            onChange={(v)=>{ setLocalOrigin(v); onOriginChange(v); }}
            onSelect={(v)=>{ setLocalOrigin(v); onOriginChange(v); if(auto && v && localRangeNum>0) onCompute(v, localRangeNum); }}
            dataSource={systemNames}
            placeholder="Enter start system"
          />
        </div>
        <label style={{ fontSize:12, display:'flex', flexDirection:'column', gap:4 }}>
          <span>Max Jump Range (LY)</span>
          <input
            ref={rangeInputRef}
            type="number"
            min={1}
            max={10000}
            value={localRangeStr}
            onFocus={()=> { editingRangeRef.current = true; }}
            onBlur={()=> { editingRangeRef.current = false; if(localRangeStr===''){ setLocalRangeStr('0'); onRangeChange(0); } }}
            onChange={e=>{
              const raw = e.target.value;
              if(raw === ''){ // allow empty for fresh typing
                setLocalRangeStr('');
                onRangeChange(0);
                return;
              }
              // Accept only valid numeric substring
              setLocalRangeStr(raw);
              const num = parseFloat(raw);
              if(!isNaN(num)) onRangeChange(num);
            }}
            style={{ padding:'6px 8px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:4, color:'#fff' }}
          />
        </label>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button disabled={!localOrigin || localRangeNum<=0 || !!disabledReason || computing} onClick={()=> onCompute(localOrigin, localRangeNum)} style={{ padding:'8px 14px', background:'var(--accent)', color:'#fff', border:'none', borderRadius:4, fontWeight:600, cursor: computing? 'default':'pointer', opacity: computing? 0.7:1 }}>Compute{computing?'…':''}</button>
          <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12 }}>
            <input type="checkbox" checked={auto} onChange={e=> onAutoChange(e.target.checked)} /> Auto
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12 }}>
            <input type="checkbox" checked={dim} onChange={e=> onDimChange(e.target.checked)} /> Highlight unreachable
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12 }}>
            <input type="checkbox" checked={bubble} onChange={e=> onBubbleChange(e.target.checked)} /> Show bubble
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12 }}>
            <input type="checkbox" checked={inRange} onChange={e=> onInRangeChange(e.target.checked)} /> Highlight in-range
          </label>
        </div>
        {lastStats && !disabledReason && (
          <div style={{ fontSize:11, opacity:0.8 }}>
            Reachable: {lastStats.reachable} / {total} (Unreachable: {total! - lastStats.reachable}) in {Math.round(lastStats.ms)} ms
          </div>
        )}
        {disabledReason && <div style={{ fontSize:11, opacity:0.6 }}>Disabled: {disabledReason}</div>}
      </div>
    </div>
  );
};

export default ReachabilitySection;

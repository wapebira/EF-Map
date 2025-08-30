import React from 'react';

interface CinematicPanelProps {
  starColorMode: string;
  setStarColorMode: (v:any)=>void;
  bloomStrength: number;
  bloomStrengthDraft: number;
  setBloomStrengthDraft: (v:number)=>void;
  setBloomStrength: (v:number)=>void;
  aberrationAmt: number; setAberrationAmt:(v:number)=>void;
  hazeColor: string; setHazeColor:(v:string)=>void;
  hazeIntensity:number; setHazeIntensity:(v:number)=>void;
  hazeRadius:number; hazeRadiusDraft:number; setHazeRadiusDraft:(v:number)=>void; setHazeRadius:(v:number)=>void;
  showAurora:boolean; setShowAurora:(v:boolean)=>void;
  bgIntensity:number; setBgIntensity:(v:number)=>void;
  auroraIntensity:number; setAuroraIntensity:(v:number)=>void;
  autoCamPaused:boolean; setAutoCamPaused:(v:boolean)=>void;
  cinematicLabels:boolean; setCinematicLabels:(v:boolean)=>void;
  autoClusterTour:boolean; setAutoClusterTour:(v:boolean)=>void;
}

const CinematicPanel: React.FC<CinematicPanelProps> = (p) => {
  const [hazePickerOpen,setHazePickerOpen] = React.useState(false);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:12, fontWeight:600 }}>Star Colors</label>
        <select value={p.starColorMode} onChange={e=> p.setStarColorMode(e.target.value)} style={{ background:'#111', color:'#fff', border:'1px solid var(--accent)', padding:'4px 6px', borderRadius:4, fontSize:12 }}>
          <option value="purple">Purple / Blue</option>
          <option value="white">White</option>
          <option value="blue">Blue</option>
          <option value="red">Red / Warm</option>
          <option value="yellow">Yellow / Gold</option>
          <option value="random">Mixed (Random)</option>
        </select>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:12, fontWeight:600 }}>Bloom Strength <span style={{ opacity:.65 }}>({p.bloomStrengthDraft.toFixed(2)})</span></label>
        <input type="range" min={0} max={1.0} step={0.01} value={p.bloomStrengthDraft} onChange={e=> p.setBloomStrengthDraft(parseFloat(e.target.value))} onPointerUp={e=> p.setBloomStrength(parseFloat((e.target as HTMLInputElement).value))} onBlur={e=> p.setBloomStrength(parseFloat((e.target as HTMLInputElement).value))} />
        <small style={{ fontSize:10, opacity:.55 }}>Applies on release</small>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:12, fontWeight:600 }}>Chromatic Aberration <span style={{ opacity:.65 }}>({p.aberrationAmt.toFixed(3)})</span></label>
        <input type="range" min={0} max={0.006} step={0.0005} value={p.aberrationAmt} onChange={e=> p.setAberrationAmt(parseFloat(e.target.value))} />
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:12, fontWeight:600 }}>Haze Color</label>
        <div style={{ position:'relative', display:'flex', alignItems:'center', gap:8 }}>
          <div onClick={()=> setHazePickerOpen(o=>!o)} style={{ width:44, height:22, background:p.hazeColor, border:'1px solid #666', cursor:'pointer', borderRadius:4 }} />
          <button onClick={()=> p.setAutoCamPaused(v=> !v)} style={{ background:'#111', color:'#fff', border:'1px solid var(--accent)', borderRadius:4, fontSize:11, padding:'4px 8px', cursor:'pointer', marginLeft:12 }}>{p.autoCamPaused? 'Resume' : 'Pause Cam'}</button>
          <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, marginLeft:8 }}>
            <input type="checkbox" checked={p.cinematicLabels} onChange={e=> p.setCinematicLabels(e.target.checked)} /> Labels
          </label>
          {hazePickerOpen && (
            <div style={{ position:'absolute', top:26, left:0, background:'#111', padding:'8px 10px', border:'1px solid #444', borderRadius:6, zIndex:50, display:'flex', flexDirection:'column', gap:8, boxShadow:'0 4px 12px rgba(0,0,0,0.5)' }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(6,18px)', gap:6 }}>
                {['#5d8fff','#7aa8ff','#a0c2ff','#cde0ff','#ffffff','#ffd700','#ffcc55','#ff8844','#ff5555','#55aaff','#55ffcc','#aa88ff'].map(c=> (
                  <div key={c} onClick={()=>{ p.setHazeColor(c); setHazePickerOpen(false); }} style={{ width:18, height:18, background:c, border:'1px solid #777', cursor:'pointer', borderRadius:3 }} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:12, fontWeight:600 }}>Haze Intensity <span style={{ opacity:.65 }}>({p.hazeIntensity.toFixed(2)})</span></label>
        <input type="range" min={0} max={0.4} step={0.01} value={p.hazeIntensity} onChange={e=> p.setHazeIntensity(parseFloat(e.target.value))} />
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:12, fontWeight:600 }}>Haze Radius <span style={{ opacity:.65 }}>({p.hazeRadiusDraft.toFixed(1)})</span></label>
        <input type="range" min={0} max={500} step={1} value={p.hazeRadiusDraft} onChange={e=> p.setHazeRadiusDraft(parseFloat(e.target.value))} onPointerUp={e=> p.setHazeRadius(parseFloat((e.target as HTMLInputElement).value))} onBlur={e=> p.setHazeRadius(parseFloat((e.target as HTMLInputElement).value))} />
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:11, display:'flex', gap:6, alignItems:'center' }}>
          <input type="checkbox" checked={p.showAurora} onChange={e=> p.setShowAurora(e.target.checked)} /> Aurora
        </label>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:12, fontWeight:600 }}>Background Intensity <span style={{ opacity:.65 }}>({p.bgIntensity.toFixed(2)})</span></label>
        <input type="range" min={0} max={1.5} step={0.01} value={p.bgIntensity} onChange={e=> p.setBgIntensity(parseFloat(e.target.value))} />
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:12, fontWeight:600 }}>Aurora Intensity <span style={{ opacity:.65 }}>({p.auroraIntensity.toFixed(2)})</span></label>
        <input type="range" min={0} max={1.0} step={0.01} value={p.auroraIntensity} onChange={e=> p.setAuroraIntensity(parseFloat(e.target.value))} />
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:11, display:'flex', gap:6, alignItems:'center' }}>
          <input type="checkbox" checked={p.autoClusterTour} onChange={e=> p.setAutoClusterTour(e.target.checked)} /> Auto Cluster Tour
        </label>
      </div>
    </div>
  );
};

export default CinematicPanel;

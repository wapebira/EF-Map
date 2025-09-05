import React from 'react';
import { getPrefs, setGateGradientSpan, setHoverPrecisionFloor, setPulseSpeed, setPulseHeadSize, setPulseTailSize, setPulseWidth, setAccent, setShowShipDash, setPulseBrightness, setStarSizeScale, setRouteThickness } from '../utils/prefs';

export const DisplaySettingsPanel: React.FC = () => {
  const prefs = getPrefs() as any;
  // gateSpan stored internally as fraction 0..1 but UI exposes 0..100%
  const [gateSpan, setGateSpan] = React.useState<number>(Math.min(1, Math.max(0, prefs.gateGradientSpan ?? 0.66)));
  const [hoverFloor, setHoverFloor] = React.useState<number>(prefs.hoverPrecisionFloor ?? 0.12);
  const [pulseSpeed, setPulseSpeedState] = React.useState<number>(prefs.pulseSpeed ?? 1.0);
  const [pulseHead, setPulseHead] = React.useState<number>(prefs.pulseHeadSize ?? 0.25);
  const [pulseTail, setPulseTail] = React.useState<number>(prefs.pulseTailSize ?? 0.65);
  const [pulseWidth, setPulseWidthState] = React.useState<number>(prefs.pulseWidth ?? 0.15);
  const [accent, setAccentState] = React.useState<'orange'|'blue'>(prefs.accent || 'orange');
  const [showShipDash, setShowShipDashState] = React.useState<boolean>(prefs.showShipDash !== false);
  const [pulseBrightness, setPulseBrightnessState] = React.useState<number>(prefs.pulseBrightness ?? 1.0);
  const [starSizeScale, setStarSizeScaleState] = React.useState<number>(prefs.starSizeScale ?? 1.0);
  const [routeThickness, setRouteThicknessState] = React.useState<number>(prefs.routeThickness ?? 1.0);

  // Commit changes w/ debounce to reduce writes
  const commitRef = React.useRef<number | null>(null);
  const scheduleWrite = () => {
    if(commitRef.current) cancelAnimationFrame(commitRef.current);
    commitRef.current = requestAnimationFrame(()=>{
    setGateGradientSpan(gateSpan);
    setHoverPrecisionFloor(hoverFloor);
    setPulseSpeed(pulseSpeed);
    setPulseHeadSize(pulseHead);
    setPulseTailSize(pulseTail);
    setPulseWidth(pulseWidth);
  setAccent(accent);
  setShowShipDash(showShipDash);
  setPulseBrightness(pulseBrightness);
    setStarSizeScale(starSizeScale);
    setRouteThickness(routeThickness);
      // Fire custom event so App.tsx can listen & update uniforms / refs immediately
  try { window.dispatchEvent(new CustomEvent('ef-display-settings-changed', { detail:{ gateSpan, hoverFloor, pulseSpeed, pulseHead, pulseTail, pulseWidth, accent, showShipDash, pulseBrightness, starSizeScale, routeThickness } })); } catch {/* ignore */}
    });
  };

  React.useEffect(()=>{ scheduleWrite(); /* eslint-disable-next-line react-hooks/exhaustive-deps */}, [gateSpan, hoverFloor, pulseSpeed, pulseHead, pulseTail, pulseWidth, accent, showShipDash, pulseBrightness, starSizeScale, routeThickness]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'12px', fontSize:12 }}>
  <section>
        <h4 style={{ margin:'4px 0 6px' }}>Gate Selection Gradient</h4>
        <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span>Accent Span: {(gateSpan*100).toFixed(0)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(gateSpan*100)}
            onChange={e=> {
              const pct = parseInt(e.target.value,10);
              setGateSpan(pct/100);
            }}
          />
          <small style={{ opacity:0.7 }}>0% = disabled accent on neighboring gates. 100% = full accent across all connected gates.</small>
        </label>
      </section>
      <section>
        <h4 style={{ margin:'4px 0 6px' }}>Ship Jump Style</h4>
        <label style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input type="checkbox" checked={showShipDash} onChange={e=> setShowShipDashState(e.target.checked)} />
          <span>Show dashed pattern for ship jumps</span>
        </label>
        <small style={{ opacity:0.7 }}>Uncheck to render ship jump segments as solid lines.</small>
      </section>
  {/* Ship jump dash animation controls removed (feature simplified to static pattern) */}
      <section>
        <h4 style={{ margin:'4px 0 6px' }}>Route Pulse</h4>
        <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span>Pulse Speed: {pulseSpeed.toFixed(2)}</span>
          <input type="range" min={0} max={3} step={0.05} value={pulseSpeed} onChange={e=> setPulseSpeedState(parseFloat(e.target.value))} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span>Pulse Brightness: {pulseBrightness.toFixed(2)}</span>
          <input type="range" min={0.2} max={3.0} step={0.05} value={pulseBrightness} onChange={e=> setPulseBrightnessState(parseFloat(e.target.value))} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span>Head Size: {pulseHead.toFixed(2)}</span>
          <input type="range" min={0.05} max={0.6} step={0.01} value={pulseHead} onChange={e=> setPulseHead(parseFloat(e.target.value))} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span>Tail Size: {pulseTail.toFixed(2)}</span>
          <input type="range" min={0.1} max={1.0} step={0.01} value={pulseTail} onChange={e=> setPulseTail(parseFloat(e.target.value))} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span>Pulse Width: {pulseWidth.toFixed(2)}</span>
          <input type="range" min={0.05} max={0.4} step={0.01} value={pulseWidth} onChange={e=> setPulseWidthState(parseFloat(e.target.value))} />
        </label>
        <small style={{ opacity:0.7 }}>Customize traveling pulse highlight along routed gate edges.</small>
      </section>
      <section>
        <h4 style={{ margin:'4px 0 6px' }}>Star Size</h4>
        <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span>Star Size Scale: {starSizeScale.toFixed(2)}x</span>
          <input type="range" min={0.5} max={1.5} step={0.05} value={starSizeScale} onChange={e=> setStarSizeScaleState(parseFloat(e.target.value))} />
        </label>
        <small style={{ opacity:0.7 }}>Adjust rendering size of stars (visual only).</small>
      </section>
      <section>
        <h4 style={{ margin:'4px 0 6px' }}>Route Thickness</h4>
        <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span>Thickness: {routeThickness.toFixed(2)}x</span>
          <input type="range" min={0.5} max={2.0} step={0.05} value={routeThickness} onChange={e=> setRouteThicknessState(parseFloat(e.target.value))} />
        </label>
        <small style={{ opacity:0.7 }}>Scales base route pixel width window. Higher values improve visibility for presentations; lower values reduce visual dominance.</small>
      </section>
      <section>
        <h4 style={{ margin:'4px 0 6px' }}>Accent Color</h4>
        <label style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input type="radio" name="accentColor" checked={accent==='orange'} onChange={()=> setAccentState('orange')} />
          <span>Orange</span>
        </label>
        <label style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input type="radio" name="accentColor" checked={accent==='blue'} onChange={()=> setAccentState('blue')} />
          <span>Blue</span>
        </label>
      </section>
      <section>
        <h4 style={{ margin:'4px 0 6px' }}>Hover Precision</h4>
        <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span>Close Zoom Hover Threshold: {hoverFloor.toFixed(2)}</span>
          <input type="range" min={0.08} max={0.20} step={0.01} value={hoverFloor} onChange={e=> setHoverFloor(parseFloat(e.target.value))} />
          <small style={{ opacity:0.7 }}>Lower values allow selecting tightly packed systems at extreme zoom (default 0.12).</small>
        </label>
      </section>
      <section style={{ display:'flex', gap:8 }}>
        <button
          style={{ flex:1, background:'var(--accent)', color:'#fff', border:'none', padding:'6px 10px', borderRadius:6, cursor:'pointer', fontWeight:600, boxShadow:'0 2px 6px rgba(0,0,0,0.45)' }}
          onClick={()=>{ setGateSpan(0.66); setHoverFloor(0.12); setPulseSpeedState(1.0); setPulseBrightnessState(1.0); setPulseHead(0.25); setPulseTail(0.65); setPulseWidthState(0.15); setStarSizeScaleState(1.0); setRouteThicknessState(1.0); setAccentState('orange'); setShowShipDashState(true); }}
        >Reset Display Defaults</button>
        <button
          style={{ flex:1, background:'var(--accent)', color:'#fff', border:'none', padding:'6px 10px', borderRadius:6, cursor:'pointer', fontWeight:600, boxShadow:'0 2px 6px rgba(0,0,0,0.45)' }}
          onClick={()=>{ window.dispatchEvent(new Event('ef-request-reset-layout')); }}
        >Reset Layout</button>
      </section>
    </div>
  );
};

export default DisplaySettingsPanel;
import React from 'react';
import '../layout/panelLayout.css';
import { useDraggable } from '../layout/useDraggable';

interface PlanetLegendPanelProps {
  children: React.ReactNode; // legend content
  onClose: () => void;
  anchoredBelowDrawer: boolean; // position logic relative to main drawer
  scale?: number;
  zIndex?: number;
  onActivate?: ()=>void;
  resetToken?: number;
}

// Small secondary panel that visually matches the main drawer styling.
const PlanetLegendPanel: React.FC<PlanetLegendPanelProps> = ({ children, onClose, anchoredBelowDrawer, scale=1, zIndex=1425, onActivate, resetToken }) => {
  const base = { x: 140, y: anchoredBelowDrawer? 70 + 340 : 70 };
  const drag = useDraggable('planet-legend', base);
  const lastResetRef = React.useRef(resetToken);
  React.useEffect(()=>{
    if(resetToken===undefined) return;
    if(lastResetRef.current === resetToken) return;
    lastResetRef.current = resetToken;
    if(localStorage.getItem('panel-pos:planet-legend')){
      try { localStorage.removeItem('panel-pos:planet-legend'); } catch {/* ignore */}
  drag.setPosSilent(base as any);
    }
  },[resetToken, anchoredBelowDrawer]);
  return (
    <div
      className={`ef-secondary-panel ${drag.isDragging? 'dragging':''}`}
      aria-label="Planet legend panel"
  style={{ left: drag.pos.x, top: drag.pos.y, transform:`scale(${scale})`, transformOrigin:'top left', zIndex }}
  onMouseDown={()=> onActivate && onActivate()}
    >
      <div className="ef-secondary-head" {...drag.bind} style={{ cursor:'move' }}>
        <span className="ef-secondary-title">Planet Count Legend</span>
        <button className="ef-drawer-close" onClick={onClose} aria-label="Close planet legend">✕</button>
      </div>
      <div className="ef-secondary-body">
        {children}
      </div>
    </div>
  );
};

export default PlanetLegendPanel;
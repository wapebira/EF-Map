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
}

// Small secondary panel that visually matches the main drawer styling.
const PlanetLegendPanel: React.FC<PlanetLegendPanelProps> = ({ children, onClose, anchoredBelowDrawer, scale=1, zIndex=1425, onActivate }) => {
  const drag = useDraggable('planet-legend', { x: anchoredBelowDrawer? 76 : 76, y: anchoredBelowDrawer? 70 + 340 : 70 });
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
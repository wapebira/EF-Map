import React from 'react';
import './panelLayout.css';
import { useDraggable } from './useDraggable';

interface PanelDrawerProps {
  id: string;
  title?: string;
  onClose: (id:string)=>void;
  children: React.ReactNode;
  defaultPos?: { x:number; y:number };
  scale?: number;
  zIndex?: number;
  onActivate?: (id:string)=>void;
  resetToken?: number; // when incremented externally, reset position
  cascadeIndex?: number; // if provided and no stored position yet, offset horizontally
}

const baseDefaults: Record<string,{x:number;y:number}> = {
  routing: { x:140, y:70 },
  cinematic: { x:140, y:70 },
};

const PanelDrawer: React.FC<PanelDrawerProps> = ({ id, title, onClose, children, defaultPos, scale=1, zIndex=1450, onActivate, resetToken, cascadeIndex }) => {
  let initial = defaultPos || baseDefaults[id] || { x:140, y:70 };
  try {
    const existing = localStorage.getItem('panel-pos:'+'drawer-'+id);
    if(!existing && typeof cascadeIndex === 'number' && cascadeIndex>0){
      initial = { ...initial, x: initial.x + cascadeIndex * 420 };
    }
  } catch {/* ignore */}
  const drag = useDraggable('drawer-'+id, initial);
  // Respond to external reset
  React.useEffect(()=>{
    if(resetToken===undefined) return;
    // Clear stored pos and apply fresh base default
    try { localStorage.removeItem('panel-pos:'+'drawer-'+id); } catch {/* ignore */}
    const fresh = baseDefaults[id] || { x:140, y:70 };
    drag.setPos(fresh as any);
  },[resetToken,id]);
  return (
    <div className={`ef-drawer ${drag.isDragging? 'dragging':''}`} aria-label={`${title||'Panel'} drawer`} style={{ left: drag.pos.x, top: drag.pos.y, transform:`scale(${scale})`, transformOrigin:'top left', zIndex }} onMouseDown={()=> onActivate && onActivate(id)}>
      <div className="ef-drawer-head" {...drag.bind} style={{ cursor:'move' }} onMouseDown={()=> onActivate && onActivate(id)}>
        <span className="ef-drawer-title">{title}</span>
        <button className="ef-drawer-close" onClick={()=> onClose(id)} aria-label={`Close ${title||'panel'}`}>✕</button>
      </div>
      <div className="ef-drawer-body">{children}</div>
    </div>
  );
};

export default PanelDrawer;

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
  // After first paint, if we applied a cascade offset (cascadeIndex>0) but initial position got overridden by a late stored value, re-apply once.
  React.useEffect(()=>{
    if(typeof cascadeIndex==='number' && cascadeIndex>0){
      try {
        const stored = localStorage.getItem('panel-pos:'+'drawer-'+id);
        if(!stored){
          const expectedX = (baseDefaults[id]?.x ?? 140) + cascadeIndex*420;
          if(Math.abs(drag.pos.x - expectedX) > 1){ drag.setPos({ x: expectedX, y: drag.pos.y }); }
        }
      } catch {/* ignore */}
    }
    // one-time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  // Respond to external reset
  const lastResetRef = React.useRef(resetToken);
  React.useEffect(()=>{
    if(resetToken===undefined) return;
    if(lastResetRef.current === resetToken) return; // skip on initial mount or unchanged
    lastResetRef.current = resetToken;
    // Only reposition if panel was already open during reset (i.e., it existed pre-reset)
    // Heuristic: if localStorage had a position key at reset time (removed externally), keep base default.
    const storedKey = 'panel-pos:'+'drawer-'+id;
    // If key exists now we reposition and remove; if it does not exist we skip so cascade applies.
    if(localStorage.getItem(storedKey)){
      try { localStorage.removeItem(storedKey); } catch {/* ignore */}
      const fresh = baseDefaults[id] || { x:140, y:70 };
      drag.setPos(fresh as any);
    }
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

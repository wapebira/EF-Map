import React, { useImperativeHandle, forwardRef } from 'react';
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
}

export interface PanelDrawerHandle {
  autoPosition: (p:{x:number;y:number})=>void; // programmatic, non-persisting move
}

const baseDefaults: Record<string,{x:number;y:number}> = {
  routing: { x:140, y:70 },
  cinematic: { x:140, y:70 },
};

const PanelDrawer = forwardRef<PanelDrawerHandle, PanelDrawerProps>(({ id, title, onClose, children, defaultPos, scale=1, zIndex=1450, onActivate, resetToken }, ref) => {
  const initial = defaultPos || baseDefaults[id] || { x:140, y:70 };
  const drag = useDraggable('drawer-'+id, initial);
  useImperativeHandle(ref, ()=>({
    autoPosition:(p)=> drag.setPosSilent(p)
  }), [drag]);
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
});

export default PanelDrawer;

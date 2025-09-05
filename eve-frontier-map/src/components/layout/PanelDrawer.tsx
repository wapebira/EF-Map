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
  // Resizing (optional – only enabled for certain panels to limit complexity)
  resizable?: boolean;
  initialSize?: { width:number; height:number };
  minSize?: { width:number; height:number };
  maxSize?: { width?:number; height?:number };
}

export interface PanelDrawerHandle {
  autoPosition: (p:{x:number;y:number})=>void; // programmatic, non-persisting move
}

const baseDefaults: Record<string,{x:number;y:number}> = {
  routing: { x:140, y:70 },
  cinematic: { x:140, y:70 },
  'region-stats': { x:140, y:70 },
  'region-compare': { x:140, y:70 },
  'user-overlay': { x:140, y:70 },
  'display-settings': { x:140, y:70 },
};

const PanelDrawer = forwardRef<PanelDrawerHandle, PanelDrawerProps>(({ id, title, onClose, children, defaultPos, scale=1, zIndex=1450, onActivate, resetToken, resizable=false, initialSize, minSize, maxSize }, ref) => {
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
  // --- Resizing logic (only when resizable) ---
  const sizeKey = 'panel-size:'+id;
  const [size, setSize] = React.useState(()=>{
    if(!resizable) return null as { width:number; height:number } | null;
    if(typeof window!=='undefined'){
      try { const raw = localStorage.getItem(sizeKey); if(raw){ const p = JSON.parse(raw); if(typeof p.width==='number' && typeof p.height==='number') return p; } } catch {/* ignore */}
    }
    return (initialSize || { width: 360, height: 420 });
  });
  const sizeRef = React.useRef(size); React.useEffect(()=>{ sizeRef.current = size; }, [size]);
  const resizingRef = React.useRef<null | { edge:string; startX:number; startY:number; startW:number; startH:number; startPos:{x:number;y:number}; }>(null);
  const minW = minSize?.width || 420; const minH = minSize?.height || 260;
  const maxW = maxSize?.width || (typeof window!=='undefined'? window.innerWidth - 80: 1600);
  const maxH = maxSize?.height || (typeof window!=='undefined'? window.innerHeight - 80: 1200);

  const beginResize = (edge:string, e:React.PointerEvent)=>{
    if(!resizable || !size) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizingRef.current = { edge, startX:e.clientX, startY:e.clientY, startW:size.width, startH:size.height, startPos:{...drag.pos} };
  };
  React.useEffect(()=>{
    if(!resizable) return;
    const onMove = (e:PointerEvent)=>{
      if(!resizingRef.current) return;
      const r = resizingRef.current; let newW = r.startW; let newH = r.startH; let newX = r.startPos.x; let newY = r.startPos.y;
      const dx = e.clientX - r.startX; const dy = e.clientY - r.startY;
      if(r.edge.includes('e')) newW = r.startW + dx;
      if(r.edge.includes('s')) newH = r.startH + dy;
      if(r.edge.includes('w')) { newW = r.startW - dx; newX = r.startPos.x + dx; }
      if(r.edge.includes('n')) { newH = r.startH - dy; newY = r.startPos.y + dy; }
      newW = Math.max(minW, Math.min(maxW, newW));
      newH = Math.max(minH, Math.min(maxH, newH));
      // Prevent flipping: if width clamped and edge was west, adjust x accordingly based on difference
      if(r.edge.includes('w')){
        const appliedDx = r.startW - newW; // how much width actually reduced
        newX = r.startPos.x + appliedDx;
      }
      if(r.edge.includes('n')){
        const appliedDy = r.startH - newH;
        newY = r.startPos.y + appliedDy;
      }
      drag.setPos({ x:newX, y:newY });
      setSize({ width:newW, height:newH });
    };
    const onUp = ()=>{
      if(resizingRef.current){
        try { localStorage.setItem(sizeKey, JSON.stringify(sizeRef.current)); } catch {/* ignore */}
      }
      resizingRef.current = null;
    };
    window.addEventListener('pointermove', onMove, { passive:true });
    window.addEventListener('pointerup', onUp, { passive:true });
    return ()=>{ window.removeEventListener('pointermove', onMove as any); window.removeEventListener('pointerup', onUp as any); };
  },[resizable, minW, minH, maxW, maxH, drag]);

  const resizeHandles = resizable ? (
    <>
      {['n','s','e','w','ne','nw','se','sw'].map(edge=>{
        const baseCls = 'ef-resize-handle';
        return <div key={edge} className={baseCls+' '+edge} onPointerDown={(e)=> beginResize(edge,e)} />;
      })}
    </>
  ): null;

  return (
  <div className={`ef-drawer ${drag.isDragging? 'dragging':''} ${resizable? 'resizable':''}`} data-panel-id={id} aria-label={`${title||'Panel'} drawer`} style={{ left: drag.pos.x, top: drag.pos.y, transform:`scale(${scale})`, transformOrigin:'top left', zIndex, width: size? size.width: undefined, height: size? size.height: undefined }} onMouseDown={()=> onActivate && onActivate(id)}>
      <div className="ef-drawer-head" {...drag.bind} style={{ cursor:'move' }} onMouseDown={()=> onActivate && onActivate(id)}>
  <span className="ef-drawer-title">{title}</span>
        <button className="ef-drawer-close" onClick={()=> onClose(id)} aria-label={`Close ${title||'panel'}`}>✕</button>
      </div>
      <div className="ef-drawer-body">{children}</div>
      {resizeHandles}
    </div>
  );
});

export default PanelDrawer;

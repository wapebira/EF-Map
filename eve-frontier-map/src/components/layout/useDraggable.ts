import { useCallback, useEffect, useRef, useState } from 'react';

interface DragPos { x:number; y:number; }

// Simple persistent draggable hook. Stores position per key in localStorage.
export function useDraggable(storageKey:string, defaultPos:DragPos){
  const [pos,setPos] = useState<DragPos>(()=>{
    try { const raw = localStorage.getItem('panel-pos:'+storageKey); if(raw){ const p = JSON.parse(raw); if(typeof p.x==='number'&&typeof p.y==='number') return p; } } catch {/* ignore */}
    return defaultPos;
  });
  const draggingRef = useRef(false);
  const movedDuringDragRef = useRef(false); // track if pointer moved (different from click)
  const hasUserDraggedRef = useRef(false); // becomes true permanently after first user drag
  const skipNextPersistRef = useRef(false); // programmatic reposition without persisting
  const offsetRef = useRef<{dx:number; dy:number}>({dx:0,dy:0});
  const [isDragging,setIsDragging] = useState(false);

  // Persist only if user actually dragged; initial / automatic layout shouldn't set defaults
  useEffect(()=>{
    if(skipNextPersistRef.current){ skipNextPersistRef.current = false; return; }
    if(!hasUserDraggedRef.current) return; // ignore until user performs a drag
    try { localStorage.setItem('panel-pos:'+storageKey, JSON.stringify(pos)); } catch {/* ignore */}
  },[pos, storageKey]);

  const onPointerDown = useCallback((e:React.PointerEvent)=>{
    const target = e.target as HTMLElement;
    // avoid starting drag from buttons/inputs
    if(target.closest('button, input, select, textarea')) return;
    draggingRef.current = true; setIsDragging(true); movedDuringDragRef.current = false;
    offsetRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  },[pos]);

  const onPointerMove = useCallback((e:PointerEvent)=>{
    if(!draggingRef.current) return;
    const nx = e.clientX - offsetRef.current.dx;
    const ny = e.clientY - offsetRef.current.dy;
    const margin = 20; const vw = window.innerWidth; const vh = window.innerHeight;
    const clampedX = Math.min(Math.max(nx, margin), vw - margin - 80);
    const clampedY = Math.min(Math.max(ny, margin), vh - margin - 80);
  setPos({ x: clampedX, y: clampedY }); // immediate for low latency
    movedDuringDragRef.current = true;
  },[]);

  const endDrag = useCallback(()=>{ 
    if(draggingRef.current && movedDuringDragRef.current){ hasUserDraggedRef.current = true; }
    draggingRef.current=false; setIsDragging(false); 
  },[]);

  useEffect(()=>{
    window.addEventListener('pointermove', onPointerMove, { passive:true });
    window.addEventListener('pointerup', endDrag, { passive:true });
    return ()=>{
      window.removeEventListener('pointermove', onPointerMove as any);
      window.removeEventListener('pointerup', endDrag as any);
    };
  },[onPointerMove,endDrag]);

  // Programmatic reposition that does not persist (used for auto cascade / reset)
  const setPosSilent = useCallback((p:DragPos)=>{ skipNextPersistRef.current = true; setPos(p); },[]);

  return { pos, setPos, setPosSilent, isDragging, bind:{ onPointerDown } } as const;
}

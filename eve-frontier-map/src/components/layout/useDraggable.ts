import { useCallback, useEffect, useRef, useState } from 'react';

interface DragPos { x:number; y:number; }

// Simple persistent draggable hook. Stores position per key in localStorage.
export function useDraggable(storageKey:string, defaultPos:DragPos){
  const [pos,setPos] = useState<DragPos>(()=>{
    try { const raw = localStorage.getItem('panel-pos:'+storageKey); if(raw){ const p = JSON.parse(raw); if(typeof p.x==='number'&&typeof p.y==='number') return p; } } catch {/* ignore */}
    return defaultPos;
  });
  const draggingRef = useRef(false);
  const offsetRef = useRef<{dx:number; dy:number}>({dx:0,dy:0});
  const [isDragging,setIsDragging] = useState(false);

  useEffect(()=>{ try { localStorage.setItem('panel-pos:'+storageKey, JSON.stringify(pos)); } catch {/* ignore */} },[pos, storageKey]);

  const onPointerDown = useCallback((e:React.PointerEvent)=>{
    const target = e.target as HTMLElement;
    // avoid starting drag from buttons/inputs
    if(target.closest('button, input, select, textarea')) return;
    draggingRef.current = true; setIsDragging(true);
    offsetRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  },[pos]);

  const onPointerMove = useCallback((e:PointerEvent)=>{
    if(!draggingRef.current) return;
    const nx = e.clientX - offsetRef.current.dx;
    const ny = e.clientY - offsetRef.current.dy;
    // Clamp within viewport with some margin
    const margin = 20;
    const vw = window.innerWidth; const vh = window.innerHeight;
    const clampedX = Math.min(Math.max(nx, margin), vw - margin - 80); // assume min width 80
    const clampedY = Math.min(Math.max(ny, margin), vh - margin - 80);
    setPos({ x: clampedX, y: clampedY });
  },[]);

  const endDrag = useCallback(()=>{ draggingRef.current=false; setIsDragging(false); },[]);

  useEffect(()=>{
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    return ()=>{
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
    };
  },[onPointerMove,endDrag]);

  return { pos, setPos, isDragging, bind:{ onPointerDown } } as const;
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './AddOverlayMarkModal.css';
import { userOverlayStore, getOverlayLastColor, setOverlayLastColor, OVERLAY_COLOR_NAMES } from '../../utils/userOverlay';

interface Props {
  open: boolean;
  systemId: number | null;
  systemName: string | null;
  onClose(): void;
  onAdded?(id: string): void;
}

// Base palette (contrasts with black background & white stars) + 4 new distinct hues.
// Existing retained: dark orange, orange, yellow, red, green, cyan, blue, purple, pink.
// Added: chartreuse (#8dff00), aqua-mint (#00ffc8), deep violet (#b300ff), hot rose (#ff006e).
const PALETTE = [
  '#ff4c26', '#ffa600', '#ffd400', '#ff0000',
  '#3fbf3f', '#00aaff', '#0060ff', '#7d5cff', '#ff2ca8',
  '#8dff00', '#00ffc8', '#b300ff', '#ff006e'
];

export const AddOverlayMarkModal: React.FC<Props> = ({ open, systemId, systemName, onClose, onAdded }) => {
  const [color, setColor] = useState('#ff4c26');
  const [note, setNote] = useState('');
  const SIZE_KEY = 'userOverlay.addMark.size';
  const MIN_W = 260;
  const defaultSize = { w: 420, h: 300 };
  const MIN_H = defaultSize.h; // Constrain vertical shrink to initial rendered height
  const POS_KEY = 'userOverlay.addMark.pos';
  const [pos, setPos] = useState<{x:number,y:number}>(()=> {
    try { const raw=localStorage.getItem(POS_KEY); if(raw){ const p=JSON.parse(raw); if(p && typeof p.x==='number' && typeof p.y==='number'){ return clampPos(p.x,p.y, defaultSize.w, defaultSize.h); } } } catch{}
    return { x: window.innerWidth/2 - defaultSize.w/2, y: Math.max(40, window.innerHeight/2 - defaultSize.h/2) };
  });
  const [size, setSize] = useState<{w:number,h:number}>(()=> { try { const raw = localStorage.getItem(SIZE_KEY); if(raw){ const obj=JSON.parse(raw); if(obj && typeof obj.w==='number' && typeof obj.h==='number') return { w:obj.w, h:obj.h }; } } catch{} return defaultSize; });
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef<{dx:number, dy:number}>({ dx:0, dy:0 });
  const resizingRef = useRef<null | { edge:string }>(null);
  const resizeStartRef = useRef<{startX:number,startY:number,startW:number,startH:number}>({ startX:0,startY:0,startW:0,startH:0 });
  const noteRef = useRef<HTMLTextAreaElement|null>(null);

  // Reset note & color on open
  useEffect(()=>{ if(open){ setNote(''); const last = getOverlayLastColor(); if(last) setColor(last); setTimeout(()=> noteRef.current?.focus(), 0); } }, [open]);

  // Helper to clamp position within viewport
  function clampPos(x:number,y:number,w:number,h:number){
    const pad=8;
    const maxX = window.innerWidth - w - pad;
    const maxY = window.innerHeight - h - pad;
    return { x: Math.min(Math.max(pad, x), Math.max(pad, maxX)), y: Math.min(Math.max(pad, y), Math.max(pad, maxY)) };
  }

  // Window events for drag / resize / viewport resize
  useEffect(()=>{
    const onMove = (e:MouseEvent) => {
      if(draggingRef.current){
        setPos(() => clampPos(e.clientX - dragOffsetRef.current.dx, e.clientY - dragOffsetRef.current.dy, size.w, size.h));
      } else if(resizingRef.current){
        const edge = resizingRef.current.edge;
        const dx = e.clientX - resizeStartRef.current.startX;
        const dy = e.clientY - resizeStartRef.current.startY;
        setSize(prev => {
          let { w, h } = prev;
          if(edge.includes('e')) w = resizeStartRef.current.startW + dx;
          if(edge.includes('s')) h = resizeStartRef.current.startH + dy;
          if(edge.includes('w')){ w = resizeStartRef.current.startW - dx; setPos(p=> clampPos(p.x + dx, p.y, Math.max(MIN_W,w), h)); }
          if(edge.includes('n')){ h = resizeStartRef.current.startH - dy; setPos(p=> clampPos(p.x, p.y + dy, w, Math.max(MIN_H,h))); }
          w = Math.max(MIN_W, Math.min(720, w));
          h = Math.max(MIN_H, Math.min(720, h));
          return { w, h };
        });
      }
    };
    const onUp = () => { if(draggingRef.current || resizingRef.current){ try { localStorage.setItem(SIZE_KEY, JSON.stringify(size)); localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch{} } draggingRef.current = false; resizingRef.current = null; };
    const onResizeWindow = () => { setPos(p=> clampPos(p.x,p.y,size.w,size.h)); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', onResizeWindow);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [pos, size]);

  const startDrag = (e:React.MouseEvent) => { draggingRef.current = true; dragOffsetRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; e.preventDefault(); };
  const startResize = (edge:string) => (e:React.MouseEvent) => { resizingRef.current = { edge }; resizeStartRef.current = { startX:e.clientX,startY:e.clientY,startW:size.w,startH:size.h }; e.preventDefault(); e.stopPropagation(); };

  const handleSubmit = useCallback((e:React.FormEvent)=>{ e.preventDefault(); if(!open || systemId==null || !systemName) return; const entry = userOverlayStore.add(systemId, systemName, color, note.trim()); if(entry){ setOverlayLastColor(color); if(onAdded) onAdded(entry.id); } onClose(); }, [open, systemId, systemName, color, note, onClose, onAdded]);
  if(!open || systemId==null || !systemName) return null;

  return (
    <div
      className="overlay-add-window"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      role="dialog"
      aria-label="Add Mark"
    >
      <div className="overlay-add-window-header" onMouseDown={startDrag}>
        <div className="title" title={systemName}>Add Mark – {systemName}</div>
        <button className="close-btn" onClick={onClose} aria-label="Close add mark window">✕</button>
      </div>
      <form onSubmit={handleSubmit} className="overlay-add-window-body">
        <div className="palette-row">
          {PALETTE.map(c=> {
            const name = OVERLAY_COLOR_NAMES[c] || c;
            return (
              <button
                key={c}
                type="button"
                className={"color-swatch" + (c===color? ' active':'')}
                style={{ background:c }}
                onClick={()=> setColor(c)}
                aria-label={`Select color ${name}`}
                title={name}
              />
            );
          })}
        </div>
        <textarea
          ref={noteRef}
          placeholder="Note (optional)"
          value={note}
          onChange={e=> setNote(e.target.value)}
          maxLength={240}
          className="overlay-add-window-textarea"
        />
        <div className="actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!systemId}>Add</button>
        </div>
      </form>
  <div className="resize-edge edge-n" onMouseDown={startResize('n')} />
  <div className="resize-edge edge-s" onMouseDown={startResize('s')} />
  <div className="resize-edge edge-e" onMouseDown={startResize('e')} />
  <div className="resize-edge edge-w" onMouseDown={startResize('w')} />
  <div className="resize-corner corner-ne" onMouseDown={startResize('ne')} />
  <div className="resize-corner corner-nw" onMouseDown={startResize('nw')} />
  <div className="resize-corner corner-se" onMouseDown={startResize('se')} />
  <div className="resize-corner corner-sw" onMouseDown={startResize('sw')} />
    </div>
  );
};

export default AddOverlayMarkModal;

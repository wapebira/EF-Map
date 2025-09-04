import React, { useState, useEffect, useCallback, useRef } from 'react';
import './AddOverlayMarkModal.css';
import { userOverlayStore, getOverlayLastColor, setOverlayLastColor } from '../../utils/userOverlay';

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
  const [pos, setPos] = useState<{x:number,y:number}>(()=> ({ x: window.innerWidth/2 - 190, y: window.innerHeight/2 - 160 }));
  const [size, setSize] = useState<{w:number,h:number}>({ w: 380, h: 300 });
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef<{dx:number, dy:number}>({ dx:0, dy:0 });
  const resizingRef = useRef(false);
  const resizeStartRef = useRef<{startX:number,startY:number,startW:number,startH:number}>({ startX:0,startY:0,startW:0,startH:0 });
  const noteRef = useRef<HTMLTextAreaElement|null>(null);

  // Reset note & color on open
  useEffect(()=>{ if(open){ setNote(''); const last = getOverlayLastColor(); if(last) setColor(last); setTimeout(()=> noteRef.current?.focus(), 0); } }, [open]);

  // Window events for drag / resize
  useEffect(()=>{
    const onMove = (e:MouseEvent) => {
      if(draggingRef.current){
  setPos(() => ({ x: Math.min(window.innerWidth-80, Math.max(4, e.clientX - dragOffsetRef.current.dx)), y: Math.min(window.innerHeight-60, Math.max(4, e.clientY - dragOffsetRef.current.dy)) }));
      } else if(resizingRef.current){
  setSize(() => ({
          w: Math.max(260, Math.min(640, resizeStartRef.current.startW + (e.clientX - resizeStartRef.current.startX))),
          h: Math.max(220, Math.min(720, resizeStartRef.current.startH + (e.clientY - resizeStartRef.current.startY)))
        }));
      }
    };
    const onUp = () => { draggingRef.current = false; resizingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const startDrag = (e:React.MouseEvent) => { draggingRef.current = true; dragOffsetRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; e.preventDefault(); };
  const startResize = (e:React.MouseEvent) => { resizingRef.current = true; resizeStartRef.current = { startX:e.clientX,startY:e.clientY,startW:size.w,startH:size.h }; e.preventDefault(); e.stopPropagation(); };

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
          {PALETTE.map(c=> (
            <button
              key={c}
              type="button"
              className={"color-swatch" + (c===color? ' active':'')}
              style={{ background:c }}
              onClick={()=> setColor(c)}
              aria-label={"Select color "+c}
            ></button>
          ))}
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
      <div className="resize-handle" onMouseDown={startResize} />
    </div>
  );
};

export default AddOverlayMarkModal;

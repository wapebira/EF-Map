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

// Updated palette: removed low-contrast light grays (#ccc, #fff); added solid red + true blue + kept vivid contrasting hues.
// Order groups warm -> cool -> vivid accents.
const PALETTE = [
  '#ff4c26', // dark orange
  '#ffa600', // orange
  '#ffd400', // yellow
  '#ff0000', // red
  '#3fbf3f', // green
  '#00aaff', // cyan
  '#0060ff', // blue
  '#7d5cff', // purple
  '#ff2ca8'  // pink
];

export const AddOverlayMarkModal: React.FC<Props> = ({ open, systemId, systemName, onClose, onAdded }) => {
  const [color, setColor] = useState('#ff4c26');
  const [note, setNote] = useState('');
  const noteRef = useRef<HTMLTextAreaElement|null>(null);
  useEffect(()=>{ if(open){ setNote(''); const last = getOverlayLastColor(); if(last) setColor(last); setTimeout(()=> noteRef.current?.focus(), 0); } }, [open]);

  const handleSubmit = useCallback((e:React.FormEvent)=>{ e.preventDefault(); if(!open || systemId==null || !systemName) return; const entry = userOverlayStore.add(systemId, systemName, color, note.trim()); if(entry){ setOverlayLastColor(color); if(onAdded) onAdded(entry.id); } onClose(); }, [open, systemId, systemName, color, note, onClose, onAdded]);
  if(!open || systemId==null || !systemName) return null;
  return (
    <div className="overlay-add-modal-backdrop" onClick={onClose}>
      <div className="overlay-add-modal" onClick={e=> e.stopPropagation()}>
        <h3>Add Mark for {systemName}</h3>
        <form onSubmit={handleSubmit}>
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
          <textarea ref={noteRef} placeholder="Note (optional)" value={note} onChange={e=> setNote(e.target.value)} maxLength={240} style={{ width:'100%', minHeight:90, marginTop:8 }}/>
          <div className="actions" style={{ display:'flex', gap:8, marginTop:12, justifyContent:'flex-end' }}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={!systemId}>Add</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddOverlayMarkModal;

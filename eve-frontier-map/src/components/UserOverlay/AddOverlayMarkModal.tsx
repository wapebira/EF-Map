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

const PALETTE = ['#ff4c26','#ffa600','#ffd400','#3fbf3f','#00aaff','#7d5cff','#ff2ca8','#cccccc','#ffffff'];

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
              <button key={c} type="button" className={"color-swatch" + (c===color? ' active':'')} style={{ background:c, border: c.toLowerCase()==='#ffffff'? '1px solid #666':'none' }} onClick={()=> setColor(c)} aria-label={"Select color "+c}></button>
            ))}
            <input aria-label="Custom hex" value={color} onChange={e=> setColor(e.target.value)} maxLength={7} style={{ width:90, marginLeft:8 }} />
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

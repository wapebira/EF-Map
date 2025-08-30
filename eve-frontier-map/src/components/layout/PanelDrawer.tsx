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
}

const PanelDrawer: React.FC<PanelDrawerProps> = ({ id, title, onClose, children, defaultPos, scale=1, zIndex=1450, onActivate }) => {
  const drag = useDraggable('drawer-'+id, defaultPos || { x:76, y:70 });
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

import React from 'react';
import './panelLayout.css';

export interface RailItemBase {
  id: string;
  // Accessible single-line label (used for title/aria)
  label: string;
  // Optional display (can contain <br/> etc.)
  display?: React.ReactNode;
  icon: React.ReactNode | null; // retained for compatibility (not rendered)
  hotkey?: string;
}

export interface RailToggle extends RailItemBase {
  type: 'toggle';
  active: boolean;
  onToggle: () => void;
}

export interface RailPanel extends RailItemBase {
  type: 'panel';
  active: boolean; // active if drawer open for this panel
  onSelect: () => void;
}

export type RailItem = RailToggle | RailPanel;

interface PanelRailProps { items: RailItem[]; style?: React.CSSProperties; }

const PanelRail: React.FC<PanelRailProps> = ({ items, style }) => {
  return (
  <div className="ef-rail" role="toolbar" aria-label="Tool & panel rail" style={style}>
      {items.map(item => {
        const common: any = {
          className: `ef-rail-btn ${item.active ? 'active' : ''}`,
          title: `${item.label}${item.hotkey ? ` (${item.hotkey.toUpperCase()})` : ''}`,
          'data-id': item.id
        };
        if (item.type === 'toggle') {
          return (
            <button key={item.id} {...common} role="switch" aria-checked={item.active} onClick={item.onToggle}>
        <span className="ef-rail-label">{item.display ?? item.label}</span>
            </button>
          );
        }
        return (
            <button key={item.id} {...common} role="button" aria-pressed={item.active} onClick={item.onSelect}>
        <span className="ef-rail-label">{item.display ?? item.label}</span>
            </button>
        );
      })}
    </div>
  );
};

export default PanelRail;

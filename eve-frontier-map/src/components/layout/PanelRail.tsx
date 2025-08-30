import React from 'react';
import './panelLayout.css';

export interface RailItemBase {
  id: string;
  label: string;
  icon: React.ReactNode | null; // retained for compatibility but not rendered now
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
          key: item.id,
          className: `ef-rail-btn ${item.active ? 'active' : ''}`,
          title: `${item.label}${item.hotkey ? ` (${item.hotkey.toUpperCase()})` : ''}`,
          'data-id': item.id
        };
        if (item.type === 'toggle') {
          return (
            <button {...common} role="switch" aria-checked={item.active} onClick={item.onToggle}>
              <span className="ef-rail-label">{item.label}</span>
            </button>
          );
        }
        return (
            <button {...common} role="button" aria-pressed={item.active} onClick={item.onSelect}>
              <span className="ef-rail-label">{item.label}</span>
            </button>
        );
      })}
    </div>
  );
};

export default PanelRail;

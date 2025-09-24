import React, { useMemo } from 'react';

export type SmartAssemblyStatusId = '2' | '3' | '4';
export type SmartAssemblyTypeId = 'manufacturer' | 'smart_hangar' | 'NWN' | 'SSU' | 'ST' | 'SG';

interface Option<T extends string> {
  id: T;
  label: string;
  active: boolean;
  total: number | null;
}

interface SmartAssembliesPanelProps {
  overlayEnabled: boolean;
  loading: boolean;
  error: string | null;
  meta: Record<string, any> | null;
  lastUpdatedIso: string | null;
  statusOptions: Option<SmartAssemblyStatusId>[];
  typeOptions: Option<SmartAssemblyTypeId>[];
  onToggleStatus: (status: SmartAssemblyStatusId) => void;
  onToggleType: (type: SmartAssemblyTypeId) => void;
  onOverlayChange: (enabled: boolean) => void;
  onRefresh: (force?: boolean) => void;
  colorMode: 'accent' | 'opposite' | 'tribe';
  onColorModeChange: (mode: 'accent' | 'opposite' | 'tribe') => void;
  filteredTotal: number;
  systemsWithData: number;
  perTypeTotals: Partial<Record<SmartAssemblyTypeId, number>>;
  filteredStatuses: SmartAssemblyStatusId[];
  filteredTypes: SmartAssemblyTypeId[];
  tribeLegend: Array<{ tribeId: string; color: number; count: number }>;
  tribeFilters: string[];
  onTribeFilterToggle: (tribeId: string, multi: boolean) => void;
  onTribeFilterClear: () => void;
  tribeNames: Record<string, string>;
}

const numberFormatter = new Intl.NumberFormat();

const SmartAssembliesPanel: React.FC<SmartAssembliesPanelProps> = ({
  overlayEnabled,
  loading,
  error,
  meta,
  lastUpdatedIso,
  statusOptions,
  typeOptions,
  onToggleStatus,
  onToggleType,
  onOverlayChange,
  onRefresh,
  colorMode,
  onColorModeChange,
  filteredTotal,
  systemsWithData,
  perTypeTotals,
  filteredStatuses,
  filteredTypes,
  tribeLegend,
  tribeFilters,
  onTribeFilterToggle,
  onTribeFilterClear,
  tribeNames,
}) => {
  const statusLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    statusOptions.forEach(opt => { map[opt.id] = opt.label; });
    return map;
  }, [statusOptions]);

  const typeLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    typeOptions.forEach(opt => { map[opt.id] = opt.label; });
    return map;
  }, [typeOptions]);

  const lastUpdated = useMemo(() => {
    if (!lastUpdatedIso) return null;
    try {
      return new Date(lastUpdatedIso).toLocaleString();
    } catch {
      return lastUpdatedIso;
    }
  }, [lastUpdatedIso]);

  const filteredStatusSummary = filteredStatuses.length
    ? filteredStatuses.map(id => statusLabelMap[id] ?? id).join(', ')
    : 'None';
  const filteredTypeSummary = filteredTypes.length
    ? filteredTypes.map(id => typeLabelMap[id] ?? id).join(', ')
    : 'None';

  const selectedTypeTotals = useMemo(() => {
    return filteredTypes
      .map(id => ({ id, label: typeLabelMap[id] ?? id, count: perTypeTotals[id] ?? 0 }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredTypes, perTypeTotals, typeLabelMap]);

  const totalAssemblies = meta?.totalAssemblies ?? null;

  return (
    <div style={{ padding: '10px', color: '#ddd', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={overlayEnabled}
            onChange={(e) => onOverlayChange(e.target.checked)}
          />
          <span>Enable star coloring</span>
        </label>
        <button
          type="button"
          onClick={() => onRefresh(true)}
          disabled={loading}
          style={{
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent',
            color: '#ddd',
            padding: '4px 10px',
            borderRadius: 6,
            cursor: loading ? 'default' : 'pointer',
            fontSize: 12,
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh snapshot'}
        </button>
      </div>

      <div style={{ fontSize: 12, opacity: 0.85, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>
          <strong>{systemsWithData}</strong> systems match current filters
          {filteredTotal > 0 && (
            <>
              {' '}•{' '}
              <strong>{numberFormatter.format(filteredTotal)}</strong> assemblies
            </>
          )}
        </div>
        {totalAssemblies != null && (
          <div>Total tracked (all filters): {numberFormatter.format(totalAssemblies)}</div>
        )}
        {lastUpdated && (
          <div>Snapshot updated: {lastUpdated}</div>
        )}
      </div>

      {error && (
        <div style={{ color: '#ff6b5b', fontSize: 12 }}>Error: {error}</div>
      )}
      {!error && loading && (
        <div style={{ fontSize: 12, opacity: 0.8 }}>Loading Smart Assemblies…</div>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontWeight: 600 }}>Status filters</div>
        <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 6 }}>
          {statusOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onToggleStatus(opt.id)}
              style={{
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 16,
                padding: '4px 8px',
                background: opt.active ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                color: opt.active ? '#000' : '#ddd',
                cursor: 'pointer',
                fontSize: 12,
                flex: 1,
                minWidth: 0,
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              {opt.label}
              {opt.total != null && (
                <span style={{ marginLeft: 6, opacity: 0.75 }}>{numberFormatter.format(opt.total)}</span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontWeight: 600 }}>Assembly types</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {typeOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onToggleType(opt.id)}
              style={{
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 16,
                padding: '4px 10px',
                background: opt.active ? 'rgba(0,170,255,0.18)' : 'rgba(255,255,255,0.05)',
                color: '#ddd',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {opt.label}
              {opt.total != null && (
                <span style={{ marginLeft: 6, opacity: 0.75 }}>{numberFormatter.format(opt.total)}</span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontWeight: 600 }}>Colour mode</div>
        <select
          className="p2p-input"
          value={colorMode}
          onChange={(e) => onColorModeChange(e.target.value as 'accent' | 'opposite' | 'tribe')}
          style={{ width: '100%' }}
        >
          <option value="accent">Theme accent</option>
          <option value="opposite">Opposite of theme</option>
          <option value="tribe">By tribe</option>
        </select>
        {(() => {
          const message = overlayEnabled
            ? colorMode === 'accent'
              ? 'Stars adopt the current theme accent colour when assemblies are present.'
              : colorMode === 'opposite'
                ? 'Stars flip to the opposite theme accent for extra contrast.'
                : null
            : 'Enable star colouring to project these filters onto the map.';
          return message ? <div style={{ fontSize: 12, opacity: 0.75 }}>{message}</div> : null;
        })()}
        {overlayEnabled && colorMode === 'tribe' && tribeLegend.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Tribe legend</div>
              {tribeFilters.length > 0 && (
                <button
                  type="button"
                  onClick={onTribeFilterClear}
                  style={{
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'transparent',
                    color: '#ddd',
                    fontSize: 12,
                    padding: '2px 6px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Clear filter
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, opacity: 0.65 }}>Ctrl+click to add or remove tribes.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tribeLegend.map(item => {
                const label = tribeNames[item.tribeId] || (item.tribeId === 'other' ? 'Other' : item.tribeId);
                const active = tribeFilters.includes(item.tribeId);
                const colorHex = `#${item.color.toString(16).padStart(6, '0')}`;
                return (
                  <button
                    key={item.tribeId}
                    type="button"
                    onClick={(evt) => onTribeFilterToggle(item.tribeId, evt.ctrlKey || evt.metaKey)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.18)',
                      borderRadius: 6,
                      padding: '4px 6px',
                      cursor: 'pointer',
                      opacity: active ? 1 : 0.85,
                    }}
                    title={active ? 'Click to remove this tribe filter' : 'Click to filter; Ctrl+click to combine tribes'}
                    aria-pressed={active}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 2,
                        backgroundColor: colorHex,
                        border: '1px solid rgba(255,255,255,0.35)',
                      }}
                    />
                    <span style={{ fontSize: 12, color: '#ddd', fontWeight: active ? 700 : 500 }}>{label}</span>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>({numberFormatter.format(item.count)})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <div style={{ fontSize: 12, opacity: 0.8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>Active statuses: {filteredStatusSummary}</div>
        <div>Active types: {filteredTypeSummary}</div>
      </div>

      {selectedTypeTotals.length > 0 && (
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Top types in selection</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {selectedTypeTotals.map(item => (
              <li key={item.id}>
                {item.label}: {numberFormatter.format(item.count)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && !error && filteredTotal === 0 && (
        <div style={{ fontSize: 12, opacity: 0.7 }}>No assemblies match the current filters.</div>
      )}
    </div>
  );
};

export default SmartAssembliesPanel;

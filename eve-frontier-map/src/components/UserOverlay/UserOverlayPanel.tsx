import React, { useEffect, useMemo, useState } from 'react';
import { userOverlayStore, setOverlayFilterColor, OVERLAY_COLOR_NAMES } from '../../utils/userOverlay';
import type { UserOverlayEntry } from '../../utils/userOverlay';

interface SortState { key: keyof UserOverlayEntry | 'systemName'; dir:1|-1; }
const headerStyle: React.CSSProperties = { position:'sticky', top:0, background:'rgba(40,40,44,0.92)', cursor:'pointer', padding:'4px 6px', fontSize:11, fontWeight:600, zIndex:1, whiteSpace:'nowrap' };
const cellStyle: React.CSSProperties = { padding:'3px 6px', fontSize:11, borderBottom:'1px solid rgba(255,255,255,0.04)', verticalAlign:'top' };
const nameCellSticky: React.CSSProperties = { position:'sticky', left:0, background:'rgba(30,30,34,0.92)', fontWeight:500 };
const btnStyle: React.CSSProperties = { background:'var(--accent)', color:'#fff', border:'none', padding:'4px 10px', borderRadius:6, cursor:'pointer', fontSize:12 };
const btnDangerStyle: React.CSSProperties = { ...btnStyle, background:'#742e2e' };
const selectStyle: React.CSSProperties = { background:'#222', color:'#fff', border:'1px solid #444', padding:'4px 6px', borderRadius:6, fontSize:12 };
const rowBtnStyle: React.CSSProperties = { background:'#333', color:'#ddd', border:'1px solid #444', padding:'2px 6px', borderRadius:4, cursor:'pointer', fontSize:11, marginRight:4 };
const pickerStyle: React.CSSProperties = { position:'absolute', marginTop:4, background:'rgba(22,22,24,0.95)', padding:8, border:'1px solid #333', borderRadius:6, zIndex:10, boxShadow:'0 4px 16px -4px rgba(0,0,0,0.6)' };
const pickerInputStyle: React.CSSProperties = { background:'#111', color:'#fff', border:'1px solid #444', padding:'4px 6px', borderRadius:4, fontSize:11, width:100 };

interface PanelProps {
  onAddMark(systemName: string, systemId: number): void;
  onSetDestination?(systemName: string): void;
  onAddWaypoint?(systemName: string): void;
  onAvoidSystem?(systemName: string): void;
  selectedSystem?: { id:number; name:string } | null;
}

export const UserOverlayPanel: React.FC<PanelProps> = ({ onAddMark, onSetDestination, onAddWaypoint, onAvoidSystem, selectedSystem }) => {
  const [entries, setEntries] = useState<UserOverlayEntry[]>(userOverlayStore.getEntries());
  const [sort, setSort] = useState<SortState>({ key:'createdAt', dir:-1 });
  const [filterColor, setFilterColor] = useState<string|undefined>(undefined);
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editNote, setEditNote] = useState('');
  const [colorPickerFor, setColorPickerFor] = useState<string|null>(null);
  const [tempColor, setTempColor] = useState('#ff4c26');
  useEffect(()=> userOverlayStore.subscribe(()=> setEntries(userOverlayStore.getEntries())), []);
  const colorsInUse = useMemo(()=> Array.from(new Set(entries.map(e=> e.color))).sort(), [entries]);
  useEffect(()=> { setOverlayFilterColor(filterColor||null); }, [filterColor]);
  const filtered = useMemo(()=> entries.filter(e=> !filterColor || e.color===filterColor), [entries, filterColor]);
  const sorted = useMemo(()=> { const arr=[...filtered]; arr.sort((a,b)=>{ const k=sort.key; let av:any=(a as any)[k]; let bv:any=(b as any)[k]; if(k==='systemName'){ av=a.systemName; bv=b.systemName; } if(typeof av==='string') return sort.dir * av.localeCompare(bv); return sort.dir * ((av??0)-(bv??0)); }); return arr; }, [filtered, sort]);
  const toggleSort = (k:SortState['key']) => setSort(p=> ({ key:k, dir: p.key===k? (p.dir===1?-1:1): -1 }));
  const onExport = () => { const data = userOverlayStore.export(); const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' }); const a=document.createElement('a'); a.download = `overlay_export_${new Date().toISOString().slice(0,10)}.json`; a.href = URL.createObjectURL(blob); a.click(); setTimeout(()=> URL.revokeObjectURL(a.href), 2000); };
  const onImport = (files:FileList|null)=> { if(!files||!files.length) return; const f=files[0]; const r=new FileReader(); r.onload=()=>{ try { const json=JSON.parse(String(r.result)); userOverlayStore.import(json); } catch(e){ console.warn('[overlay] import failed', e); } }; r.readAsText(f); };
  const clearAll = ()=> { if(!entries.length) return; if(confirm('Clear all overlay marks? This cannot be undone.')) userOverlayStore.clearAll(); };
  const header = (label:string, key:SortState['key']) => <th style={headerStyle} onClick={()=> toggleSort(key)}>{label} {sort.key===key? (sort.dir===1?'▲':'▼'):''}</th>;
  return (
    <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', overflow:'hidden' }}>
  <div style={{ display:'flex', flexWrap:'wrap', gap:6, padding:'2px 0 6px 0' }}>
	<button
      style={{ ...btnStyle, opacity: selectedSystem? 1:0.5, cursor: selectedSystem? 'pointer':'not-allowed' }}
      disabled={!selectedSystem}
      onClick={()=> { if(selectedSystem) onAddMark(selectedSystem.name, selectedSystem.id); }}
      title={selectedSystem? 'Add mark for selected system':'Select a system first'}
    >Add Mark</button>
        <button style={btnStyle} onClick={onExport} disabled={!entries.length}>Export</button>
        <label style={{ ...btnStyle, display:'inline-flex', alignItems:'center', gap:4, cursor:'pointer' }}>
          Import<input type='file' accept='application/json' style={{ display:'none' }} onChange={e=> onImport(e.target.files)} />
        </label>
  <select value={filterColor||''} onChange={e=> setFilterColor(e.target.value||undefined)} style={selectStyle}>
          <option value=''>All Colors</option>
          {colorsInUse.map(c=> <option key={c} value={c}>{OVERLAY_COLOR_NAMES[c] || c}</option>)}
        </select>
        <button style={btnDangerStyle} onClick={clearAll} disabled={!entries.length}>Clear All</button>
        <div style={{ marginLeft:'auto', fontSize:11, opacity:0.7 }}>Marks: {entries.length}</div>
      </div>
      <div style={{ flex:1, overflow:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, minWidth:880, tableLayout:'fixed' }}>
          <thead>
            <tr>
              {header('Color','color')}
              {header('System','systemName')}
              {header('Note','note')}
              {header('Created','createdAt')}
              {header('Verified','lastVerifiedAt')}
              {header('Updated','updatedAt')}
              <th style={headerStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(e=> {
              const editing = editingId === e.id;
              const picking = colorPickerFor === e.id;
              const handleRowContext: React.MouseEventHandler<HTMLTableRowElement> = (ev) => {
                ev.preventDefault();
                const existing = document.getElementById('overlay-row-context-menu');
                if(existing) existing.remove();
                const wrapper = document.createElement('div');
                wrapper.id = 'overlay-row-context-menu';
                wrapper.className = 'system-label-wrapper';
                Object.assign(wrapper.style, { position:'fixed', top: ev.clientY + 'px', left: ev.clientX + 'px', zIndex:'9999' });
                const inner = document.createElement('div');
                inner.className = 'system-label system-label--selected';
                // Title
                const titleSpan = document.createElement('div');
                titleSpan.textContent = e.systemName;
                titleSpan.style.fontWeight = '700';
                inner.appendChild(titleSpan);
                const optionsWrap = document.createElement('div');
                optionsWrap.className = 'context-menu-options';
                const makeItem = (label:string, fn: (()=>void)|undefined) => {
                  const item = document.createElement('div');
                  item.className = 'context-menu-item';
                  item.textContent = label;
                  if(!fn){ item.style.opacity = '0.4'; }
                  item.addEventListener('mousedown', ev2=> { ev2.stopPropagation(); ev2.preventDefault(); });
                  if(fn){ item.addEventListener('click', ev2=> { ev2.stopPropagation(); fn(); cleanup(); }); }
                  optionsWrap.appendChild(item);
                };
                const cleanup = () => { wrapper.remove(); window.removeEventListener('click', outside, true); window.removeEventListener('keydown', esc, true); };
                const outside = (evt: Event) => { if(wrapper && !wrapper.contains(evt.target as Node)) cleanup(); };
                const esc = (evt: KeyboardEvent) => { if(evt.key==='Escape') cleanup(); };
                window.addEventListener('click', outside, true);
                window.addEventListener('keydown', esc, true);
                makeItem(e.systemName, undefined);
                makeItem('Set Destination', onSetDestination? ()=> onSetDestination(e.systemName): undefined);
                makeItem('Add Waypoint', onAddWaypoint? ()=> onAddWaypoint(e.systemName): undefined);
                makeItem('Avoid System', onAvoidSystem? ()=> onAvoidSystem(e.systemName): undefined);
                makeItem('Add Another Mark', ()=> onAddMark(e.systemName, (e as any).systemId || e.systemId));
                inner.appendChild(optionsWrap);
                wrapper.appendChild(inner);
                document.body.appendChild(wrapper);
              };
              return (
                <tr key={e.id} onContextMenu={handleRowContext}>
                  <td style={cellStyle}>
                    <span
                      onClick={()=> { setColorPickerFor(p=> p===e.id? null : e.id); setTempColor(e.color); }}
                      style={{ display:'inline-block', width:16, height:16, borderRadius:16, background:e.color, boxShadow:'0 0 0 1px #222', cursor:'pointer' }}
                      title={e.color + ' (click to change)'}
                    />
                    {picking && (
                      <div style={pickerStyle}>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:6 }}>
                          {colorsInUse.slice(0,12).map(c=> (
                            <div key={c} onClick={()=> { userOverlayStore.update(e.id,{ color:c }); setColorPickerFor(null); }} style={{ width:20, height:20, borderRadius:4, background:c, cursor:'pointer', boxShadow:'0 0 0 1px #000' }} title={c}></div>
                          ))}
                        </div>
                        <input value={tempColor} onChange={ev=> setTempColor(ev.target.value)} style={pickerInputStyle} placeholder="#rrggbb" />
                        <div style={{ display:'flex', gap:6, marginTop:6 }}>
                          <button style={rowBtnStyle} onClick={()=> { userOverlayStore.update(e.id,{ color:tempColor }); setColorPickerFor(null); }}>Apply</button>
                          <button style={rowBtnStyle} onClick={()=> setColorPickerFor(null)}>Close</button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td style={{ ...cellStyle, ...nameCellSticky }} title={e.systemName}>{e.systemName}</td>
                  <td style={cellStyle} onClick={()=> { if(!editing){ setEditingId(e.id); setEditNote(e.note); } }}>
                    {editing ? (
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        <textarea
                          value={editNote}
                          onChange={ev=> setEditNote(ev.target.value)}
                          style={{ width:'100%', minHeight:50, background:'#222', color:'#fff', border:'1px solid #444', resize:'vertical', fontSize:11 }}
                          maxLength={240}
                          autoFocus
                        />
                        <div style={{ display:'flex', gap:6 }}>
                          <button style={rowBtnStyle} onClick={()=> { userOverlayStore.update(e.id,{ note:editNote }); setEditingId(null); }}>Save</button>
                          <button style={rowBtnStyle} onClick={()=> setEditingId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (e.note || <span style={{ opacity:0.4 }}>—</span>)}
                  </td>
                  <td style={cellStyle}>{fmtDate(e.createdAt)}</td>
                  <td style={cellStyle}>{e.lastVerifiedAt? fmtDate(e.lastVerifiedAt):'—'}</td>
                  <td style={cellStyle}>{fmtDate(e.updatedAt)}</td>
                  <td style={cellStyle}>
                    <button style={rowBtnStyle} onClick={()=> userOverlayStore.verify(e.id)} title='Verify now'>✔</button>
                    <button style={rowBtnStyle} onClick={()=> userOverlayStore.remove(e.id)} title='Delete'>✕</button>
                  </td>
                </tr>
              );
            })}
            {!sorted.length && (
              <tr><td colSpan={7} style={{ ...cellStyle, textAlign:'center', opacity:0.6 }}>No overlay marks yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

function fmtDate(ms?:number){ if(!ms) return ''; try { return new Date(ms).toISOString().slice(0,10); } catch { return ''; } }

export default UserOverlayPanel;

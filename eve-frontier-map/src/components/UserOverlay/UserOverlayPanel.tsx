import React, { useEffect, useMemo, useState } from 'react';
import { userOverlayStore, setOverlayFilterColor, OVERLAY_COLOR_NAMES } from '../../utils/userOverlay';
import { getPrefs, setOverlaySort, setOverlayAgingDays } from '../../utils/prefs';
import type { UserOverlayEntry } from '../../utils/userOverlay';

interface SortState { key: keyof UserOverlayEntry | 'systemName'; dir:1|-1; }
const headerStyle: React.CSSProperties = { position:'sticky', top:0, background:'rgba(40,40,44,0.92)', cursor:'pointer', padding:'4px 6px', fontSize:11, fontWeight:600, zIndex:1, whiteSpace:'nowrap' };
const cellStyle: React.CSSProperties = { padding:'3px 6px', fontSize:11, borderBottom:'1px solid rgba(255,255,255,0.04)', verticalAlign:'top' };
const centerCell: React.CSSProperties = { ...cellStyle, textAlign:'center' }; // for all but note column
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
  onSelectSystem?(systemName: string): void;
  selectedSystem?: { id:number; name:string } | null;
  // Soft highlight callback (no camera move)
  onSoftHover?(systemName: string | null): void;
}

export const UserOverlayPanel: React.FC<PanelProps> = ({ onAddMark, onSetDestination, onAddWaypoint, onAvoidSystem, onSelectSystem, onSoftHover, selectedSystem }) => {
  const [entries, setEntries] = useState<UserOverlayEntry[]>(userOverlayStore.getEntries());
  // Initialize sort from prefs overlaySort (format key:dir)
  const pref = getPrefs() as any;
  const initialSort = (()=>{
    const raw = pref.overlaySort as string | undefined;
    if(raw){ const [k,d] = raw.split(':'); if(k && (d==='1' || d==='-1')) return { key: k as SortState['key'], dir: Number(d) as 1|-1 }; }
    return { key:'createdAt' as SortState['key'], dir:-1 as 1|-1 };
  })();
  const [sort, setSort] = useState<SortState>(initialSort);
  const [filterColor, setFilterColor] = useState<string|undefined>(undefined);
  const [search, setSearch] = useState('');
  const [agingDays, setAgingDays] = useState<number>(typeof pref.overlayAgingDays === 'number'? pref.overlayAgingDays : 3);
  const now = Date.now();
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editNote, setEditNote] = useState('');
  const [colorPickerFor, setColorPickerFor] = useState<string|null>(null);
  const [tempColor, setTempColor] = useState('#ff4c26');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastClickedIndex, setLastClickedIndex] = useState<number|null>(null);
  const [legendDragColor, setLegendDragColor] = useState<string|null>(null);
  useEffect(()=> userOverlayStore.subscribe(()=> setEntries(userOverlayStore.getEntries())), []);
  const colorsInUse = useMemo(()=> Array.from(new Set(entries.map(e=> e.color))).sort(), [entries]);
  useEffect(()=> { setOverlayFilterColor(filterColor||null); }, [filterColor]);
  const filtered = useMemo(()=> {
    let arr = entries;
    if(filterColor) arr = arr.filter(e=> e.color===filterColor);
    if(search.trim()){
      const q = search.trim().toLowerCase();
      arr = arr.filter(e=> e.systemName.toLowerCase().includes(q) || (e.note && e.note.toLowerCase().includes(q)));
    }
    return arr;
  }, [entries, filterColor, search]);
  const sorted = useMemo(()=> { const arr=[...filtered]; arr.sort((a,b)=>{ const k=sort.key; let av:any=(a as any)[k]; let bv:any=(b as any)[k]; if(k==='systemName'){ av=a.systemName; bv=b.systemName; } if(typeof av==='string') return sort.dir * av.localeCompare(bv); return sort.dir * ((av??0)-(bv??0)); }); return arr; }, [filtered, sort]);
  const toggleSort = (k:SortState['key']) => setSort(p=> {
    const next = { key:k, dir: p.key===k? (p.dir===1?-1:1): -1 } as SortState;
    setOverlaySort(`${next.key}:${next.dir}`);
    return next;
  });
  const applyPreset = (preset: string) => {
    switch(preset){
      case 'name': setSort(()=> { const next:SortState={ key:'systemName' as SortState['key'], dir:1 }; setOverlaySort(`${next.key}:${next.dir}`); return next; }); break;
      case 'newest': setSort(()=> { const next:SortState={ key:'createdAt' as SortState['key'], dir:-1 }; setOverlaySort(`${next.key}:${next.dir}`); return next; }); break;
      case 'updated': setSort(()=> { const next:SortState={ key:'updatedAt' as SortState['key'], dir:-1 }; setOverlaySort(`${next.key}:${next.dir}`); return next; }); break;
      case 'color': setSort(()=> { const next:SortState={ key:'color' as SortState['key'], dir:1 }; setOverlaySort(`${next.key}:${next.dir}`); return next; }); break;
      case 'hasnote': setSort(()=> { const next:SortState={ key:'note' as SortState['key'], dir:-1 }; setOverlaySort(`${next.key}:${next.dir}`); return next; }); break;
    }
  };
  const onChangeAging = (v:string) => {
    const n = Math.max(1, Math.min(365, Number(v)||0));
    setAgingDays(n);
    setOverlayAgingDays(n);
  };
  const staleCutoff = now - agingDays*86400000;
  const colorCounts = useMemo(()=> {
    const m: Record<string, number> = {};
    for(const e of entries){ m[e.color] = (m[e.color]||0)+1; }
    return Object.entries(m).sort((a,b)=> b[1]-a[1]);
  }, [entries]);
  const allSelectedSet = useMemo(()=> new Set(selectedIds), [selectedIds]);
  const toggleRowSelect = (id:string, idx:number, ev:React.MouseEvent) => {
  if(ev.shiftKey && lastClickedIndex!=null){
      const start = Math.min(lastClickedIndex, idx); const end = Math.max(lastClickedIndex, idx);
      const rangeIds = sorted.slice(start, end+1).map(e=> e.id);
      const union = new Set(selectedIds);
      rangeIds.forEach(r=> union.add(r));
      setSelectedIds(Array.from(union));
      return;
    }
    if(ev.metaKey || ev.ctrlKey){
      setSelectedIds(s=> s.includes(id)? s.filter(x=> x!==id): [...s,id]);
    } else {
      setSelectedIds(s=> s.length===1 && s[0]===id? []: [id]);
    }
    setLastClickedIndex(idx);
  };
  const bulkDelete = ()=> { if(!selectedIds.length) return; if(confirm(`Delete ${selectedIds.length} selected mark(s)?`)){ userOverlayStore.removeMany(selectedIds); setSelectedIds([]);} };
  const bulkVerify = ()=> { if(!selectedIds.length) return; userOverlayStore.verifyMany(selectedIds); };
  const mergeDuplicates = ()=> { const r = userOverlayStore.mergeDuplicates(); if(r.removed){ alert(`Merged ${r.merged} duplicate entries`); } else { alert('No duplicates found'); } };
  const onLegendDragStart = (c:string)=> (ev:React.DragEvent)=> { ev.dataTransfer.setData('text/plain', c); setLegendDragColor(c); };
  const onLegendDragEnd = ()=> setLegendDragColor(null);
  const onRowDragOver: React.DragEventHandler<HTMLTableRowElement> = ev => { if(legendDragColor) ev.preventDefault(); };
  const onRowDrop = (id:string)=> (ev:React.DragEvent)=> { ev.preventDefault(); const c = legendDragColor || ev.dataTransfer.getData('text/plain'); if(c) userOverlayStore.update(id,{ color:c }); setLegendDragColor(null); };
  const onExport = () => { const data = userOverlayStore.export(); const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' }); const a=document.createElement('a'); a.download = `overlay_export_${new Date().toISOString().slice(0,10)}.json`; a.href = URL.createObjectURL(blob); a.click(); setTimeout(()=> URL.revokeObjectURL(a.href), 2000); };
  const onImport = (files:FileList|null)=> { if(!files||!files.length) return; const f=files[0]; const r=new FileReader(); r.onload=()=>{ try { const json=JSON.parse(String(r.result)); userOverlayStore.import(json); } catch(e){ console.warn('[overlay] import failed', e); } }; r.readAsText(f); };
  const clearAll = ()=> { if(!entries.length) return; if(confirm('Clear all overlay marks? This cannot be undone.')) userOverlayStore.clearAll(); };
  const header = (label:string, key:SortState['key']) => <th style={{ ...headerStyle, textAlign:'center' }} onClick={()=> toggleSort(key)}>{label} {sort.key===key? (sort.dir===1?'▲':'▼'):''}</th>;
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
        <input
          value={search}
          onChange={e=> setSearch(e.target.value)}
          placeholder='Search name or note'
          style={{ ...selectStyle, width:160 }}
        />
  <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
          <button style={rowBtnStyle} onClick={()=> applyPreset('name')}>A-Z</button>
          <button style={rowBtnStyle} onClick={()=> applyPreset('newest')}>Newest</button>
          <button style={rowBtnStyle} onClick={()=> applyPreset('updated')}>Updated</button>
          <button style={rowBtnStyle} onClick={()=> applyPreset('color')}>Color</button>
          <button style={rowBtnStyle} onClick={()=> applyPreset('hasnote')} title='Marks with note first'>Has Note</button>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <label style={{ fontSize:11, opacity:0.7 }}>Aging:</label>
          <input type='number' value={agingDays} min={1} max={365} onChange={e=> onChangeAging(e.target.value)} style={{ ...selectStyle, width:60, padding:'2px 4px' }} />
          <span style={{ fontSize:11, opacity:0.6 }}>days</span>
        </div>
        <button style={btnDangerStyle} onClick={clearAll} disabled={!entries.length}>Clear All</button>
        <button style={{ ...btnStyle, background:'#444' }} disabled={!selectedIds.length} onClick={bulkDelete} title='Delete selected'>Del Sel</button>
        <button style={{ ...btnStyle, background:'#2e4c72' }} disabled={!selectedIds.length} onClick={bulkVerify} title='Verify selected'>Verify Sel</button>
        <button style={{ ...btnStyle, background:'#3a3a3a' }} onClick={mergeDuplicates} title='Merge duplicate system+color entries'>Merge Dups</button>
        <button
          style={btnStyle}
          disabled={!sorted.length}
          onClick={()=> {
            const text = sorted.map(e=> `${e.systemName} [${e.color}]${e.note? ' - '+e.note:''}`).join('\n');
            navigator.clipboard.writeText(text).catch(()=>{});
          }}
        >Copy Text</button>
        <div style={{ marginLeft:'auto', fontSize:11, opacity:0.7 }}>Marks: {entries.length}</div>
      </div>
      {/* Color Legend */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:6, padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', marginBottom:4 }}>
        {colorCounts.map(([c,count])=> (
          <div key={c} draggable onDragStart={onLegendDragStart(c)} onDragEnd={onLegendDragEnd} style={{ display:'flex', alignItems:'center', gap:4, cursor:'grab', background:'rgba(255,255,255,0.05)', padding:'2px 6px', borderRadius:4, border: legendDragColor===c? '1px solid var(--accent)': '1px solid #333' }} title='Drag onto row to recolor'>
            <span style={{ width:14, height:14, borderRadius:14, background:c, display:'inline-block', boxShadow:'0 0 0 1px #111' }} />
            <span style={{ fontSize:11 }}>{count}</span>
          </div>
        ))}
        {!colorCounts.length && <span style={{ fontSize:11, opacity:0.5 }}>No colors yet</span>}
        {!!selectedIds.length && <div style={{ fontSize:11, marginLeft:'auto', opacity:0.7 }}>{selectedIds.length} selected</div>}
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
              <th style={{ ...headerStyle, textAlign:'center' }}>Actions</th>
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
                makeItem('Set Destination', onSetDestination? ()=> onSetDestination(e.systemName): undefined);
                makeItem('Add Waypoint', onAddWaypoint? ()=> onAddWaypoint(e.systemName): undefined);
                makeItem('Avoid System', onAvoidSystem? ()=> onAvoidSystem(e.systemName): undefined);
                makeItem('Add Another Mark', ()=> onAddMark(e.systemName, (e as any).systemId || e.systemId));
                inner.appendChild(optionsWrap);
                wrapper.appendChild(inner);
                document.body.appendChild(wrapper);
              };
              const stale = e.updatedAt < staleCutoff;
              const selectedRow = allSelectedSet.has(e.id);
              return (
                <tr
                  key={e.id}
                  onContextMenu={handleRowContext}
                  style={{ ...(stale? { opacity:0.55 }: {}), background: selectedRow? 'rgba(255,255,255,0.08)': undefined, outline: selectedRow? '1px solid rgba(255,255,255,0.15)': undefined, cursor:'pointer' }}
                  onClick={(ev)=> toggleRowSelect(e.id, sorted.findIndex(x=> x.id===e.id), ev)}
                  onMouseEnter={()=> onSoftHover && onSoftHover(e.systemName)}
                  onMouseLeave={()=> onSoftHover && onSoftHover(null)}
                  onDragOver={onRowDragOver}
                  onDrop={onRowDrop(e.id)}
                >
                  <td style={centerCell}>
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
                  <td
                    style={{ ...centerCell, ...nameCellSticky, cursor:'pointer', textDecoration:'underline' }}
                    title={e.systemName}
                    onClick={()=> onSelectSystem && onSelectSystem(e.systemName)}
                  >{e.systemName}</td>
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
                  <td style={centerCell}>{fmtDate(e.createdAt)}</td>
                  <td style={centerCell}>{e.lastVerifiedAt? fmtDate(e.lastVerifiedAt):'—'}</td>
                  <td style={centerCell}>{fmtDate(e.updatedAt)}</td>
                  <td style={centerCell}>
                    <button style={{ ...rowBtnStyle, background:'#1d4d1d', color:'#c6f7c6', border:'1px solid #2d6d2d' }} onClick={()=> userOverlayStore.verify(e.id)} title='Verify now'>✔</button>
                    <button style={{ ...rowBtnStyle, background:'#5a1e1e', color:'#f7c6c6', border:'1px solid #7a2e2e' }} onClick={()=> userOverlayStore.remove(e.id)} title='Delete'>✕</button>
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

import React, { useEffect, useMemo, useState } from 'react';
import { userOverlayStore, setOverlayFilterColor, OVERLAY_COLOR_NAMES } from '../../utils/userOverlay';
import { getPrefs, setOverlaySort, setOverlayAgingDays } from '../../utils/prefs';
import type { UserOverlayEntry } from '../../utils/userOverlay';
import { fetchTribeMarks, mutateWithRetry, type TribeDoc, type TribeOp } from '../../utils/tribeMarks';
import { useRef } from 'react';
import { getPersonalFolders, addPersonalFolder, renamePersonalFolder, deletePersonalFolder, getEntryFolder, getFolderCounts, subscribeFolders, setDefaultAddFolderId, setEntryFolder, type PersonalFolder } from '../../utils/overlayFolders';
import { publishFilteredOverlay } from '../../utils/overlayFilteredFeed';
import FolderNameModal from './FolderNameModal';

interface SortState { key: keyof UserOverlayEntry | 'systemName'; dir:1|-1; }
const headerStyle: React.CSSProperties = { position:'sticky', top:0, background:'rgba(40,40,44,0.92)', cursor:'pointer', padding:'4px 6px', fontSize:11, fontWeight:600, zIndex:1, whiteSpace:'nowrap' };
const cellStyle: React.CSSProperties = { padding:'3px 6px', fontSize:11, borderBottom:'1px solid rgba(255,255,255,0.04)', verticalAlign:'top' };
const centerCell: React.CSSProperties = { ...cellStyle, textAlign:'center' }; // for all but note column
const nameCellSticky: React.CSSProperties = { position:'sticky', left:0, background:'rgba(30,30,34,0.92)', fontWeight:500, zIndex:2 };
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
  // Folders (personal local + tribe virtual)
  const [folders, setFolders] = useState<PersonalFolder[]>(getPersonalFolders());
  const [activeFolderId, setActiveFolderId] = useState<string|''>(''); // '' = All, 'tribe:<id>' root, 'tribeFolder:<folderId>', 'personal:<folderId>'
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  // Tribe virtual folder
  const [tribeId, setTribeId] = useState<string| null>(null);
  const [tribeName, setTribeName] = useState<string| null>(null);
  const [tribeDoc, setTribeDoc] = useState<TribeDoc|null>(null);
  const [tribeEtag, setTribeEtag] = useState<string>('');
  const [tribeBusy, setTribeBusy] = useState(false);
  const [tribeErr, setTribeErr] = useState<string|null>(null);
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
  const [folderModal, setFolderModal] = useState<null | { scope:'tribe'|'personal' }>(null);
  const [folderModalError, setFolderModalError] = useState<string|null>(null);
  // Tribe note inline editing state
  const [editingTribeId, setEditingTribeId] = useState<string|null>(null);
  const [editingTribeNote, setEditingTribeNote] = useState('');
  // Inline folder rename state (personal or tribe). Format: 'personal:<id>' | 'tribeFolder:<id>' | 'tribeRoot'
  const [editingFolderId, setEditingFolderId] = useState<string|null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const tribeBusyRef = useRef(false);
  useEffect(()=> userOverlayStore.subscribe(()=> { setEntries(userOverlayStore.getEntries()); setFolderCounts(getFolderCounts()); }), []);
  useEffect(()=> subscribeFolders(()=> { setFolders(getPersonalFolders()); setFolderCounts(getFolderCounts()); }), []);
  useEffect(()=> { setFolderCounts(getFolderCounts()); }, []);
  // Maintain default-add folder for Add Mark modal: use active personal folder or clear when tribe/all
  useEffect(()=>{
    if(activeFolderId && typeof activeFolderId==='string' && activeFolderId.startsWith('personal:')){
      setDefaultAddFolderId(activeFolderId);
    } else {
      setDefaultAddFolderId(null);
    }
  }, [activeFolderId]);

  // Auto-load tribe info from player-profile (which includes tribe fields via worker proxy)
  useEffect(()=>{
    let aborted=false; let attempts=0; const maxAttempts=6; // ~6*5s = 30s worst-case
    async function loadProfile(first:boolean){
      attempts++;
      try {
        const resp = await fetch('/api/player-profile?fresh=1', { cache:'no-store' });
        // 401 is tolerated; user just lacks session yet; no banner UI now
        if(!resp.ok){ console.warn('[overlay] player-profile fetch failed', resp.status); return; }
        const j = await resp.json();
        const slug = (j?.tribeSlug||'') ? String(j.tribeSlug).toLowerCase() : null;
        const name = j?.tribeName || null;
        const rawId = j?.tribeId ? String(j.tribeId) : null;
        if(aborted) return;
        const chosenId = slug || (name? String(name).toLowerCase() : (rawId||null));
        console.log('[overlay] profile tribe diagnostics', { first, attempts, slug, name, rawId, chosenId, exclude: chosenId==='clonebank86' });
        if(chosenId && chosenId !== 'clonebank86'){
          setTribeId(prev=> prev||chosenId); // lock once set
          setTribeName(prev=> prev || (name || slug || rawId || chosenId));
          // Auto-select tribe folder on first discovery if currently All
          setActiveFolderId(prev=> prev===''? `tribe:${chosenId}` : prev);
          // If we haven't fetched marks yet, do so
          if(!tribeDoc){
            try {
              setTribeBusy(true); setTribeErr(null);
              const { doc, etag } = await fetchTribeMarks(chosenId, { allowPreview:true });
              if(!aborted){ setTribeDoc(doc); setTribeEtag(etag); }
            } catch(e:any){ if(!aborted) setTribeErr(String(e?.message||e)); }
            finally { if(!aborted) setTribeBusy(false); }
          }
          return; // success; no retry
        }
      } catch(e){ console.warn('[overlay] profile tribe error', e); }
      if(!aborted && attempts < maxAttempts){
        setTimeout(()=> loadProfile(false), 5000); // retry in 5s
      }
    }
    loadProfile(true);
    return ()=>{ aborted=true; };
  }, []);
  // Enrich tribe name if only numeric id known (reuse global App fetch or fetch tribes list once)
  useEffect(()=>{
    if(!tribeId){ return; }
    if(tribeName && tribeName !== tribeId){ return; }
    let aborted=false;
    (async()=> {
      try {
        const globalMap: any = (window as any).__efTribeNames;
        if(globalMap && typeof globalMap==='object'){
          const name = globalMap[tribeId];
          if(name && !aborted){ setTribeName(name); return; }
        }
        const resp = await fetch('https://world-api-stillness.live.tech.evefrontier.com/v2/tribes', { cache:'no-store' });
        if(!resp.ok) return;
        const json = await resp.json();
        let entries: any[] = [];
        if (Array.isArray(json)) entries = json; else if (json && typeof json==='object') {
          if (Array.isArray((json as any).tribes)) entries=(json as any).tribes; else if (Array.isArray((json as any).items)) entries=(json as any).items; else if (Array.isArray((json as any).data)) entries=(json as any).data; else if((json as any).data && typeof (json as any).data==='object'){ const d=(json as any).data; if(Array.isArray(d.tribes)) entries=d.tribes; else if(Array.isArray(d.items)) entries=d.items; }
          if(!entries.length){ const vals=Object.values(json as any); const sample=vals.slice(0,8); const looks= sample.length && sample.every(v=>v && typeof v==='object' && (('name' in v)||('tribeName' in v)||('attributes' in v))); if(looks) entries=vals as any[]; }
        }
        if(!entries.length) return;
        const map: Record<string,string> = {};
        for(const t of entries){ if(!t) continue; const idRaw=(t.id ?? t.tribeId ?? (t.attributes && t.attributes.id) ?? ''); const attrs=(t.attributes && typeof t.attributes==='object')? t.attributes : t; if(idRaw===undefined || idRaw===null) continue; const id=String(idRaw); const nmRaw=(attrs.name || attrs.tribeName || attrs.displayName || ''); if(!nmRaw) continue; const nm=String(nmRaw); if(id) map[id]=nm; }
        (window as any).__efTribeNames = { ...(globalMap||{}), ...map };
        const found = map[tribeId];
        if(found && !aborted){ setTribeName(found); }
      } catch{/* silent */}
    })();
    return ()=>{ aborted=true; };
  }, [tribeId, tribeName]);
  const colorsInUse = useMemo(()=> Array.from(new Set(entries.map(e=> e.color))).sort(), [entries]);
  useEffect(()=> { setOverlayFilterColor(filterColor||null); }, [filterColor]);
  const filtered = useMemo(()=> {
    let arr = entries;
    if(filterColor) arr = arr.filter(e=> e.color===filterColor);
    if(search.trim()){
      const q = search.trim().toLowerCase();
      arr = arr.filter(e=> e.systemName.toLowerCase().includes(q) || (e.note && e.note.toLowerCase().includes(q)));
    }
    if(activeFolderId.startsWith('personal:')){
      const fid = activeFolderId.slice('personal:'.length);
      arr = arr.filter(e=> getEntryFolder(e.id) === fid);
    }
    return arr;
  }, [entries, filterColor, search, activeFolderId]);
  const sorted = useMemo(()=> { const arr=[...filtered]; arr.sort((a,b)=>{ const k=sort.key; let av:any=(a as any)[k]; let bv:any=(b as any)[k]; if(k==='systemName'){ av=a.systemName; bv=b.systemName; } if(typeof av==='string') return sort.dir * av.localeCompare(bv); return sort.dir * ((av??0)-(bv??0)); }); return arr; }, [filtered, sort]);
  // Publish filtered set (personal view only; tribe handled separately below) for map rendering
  useEffect(()=>{
    // Only publish personal entries when not in tribe view
    if(activeFolderId.startsWith('tribe:') || activeFolderId.startsWith('tribeFolder:')) return;
    publishFilteredOverlay(sorted.map(e=> ({ type:'personal', systemId:e.systemId, color:e.color })));
  }, [sorted, activeFolderId]);
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
  // Share a personal mark to tribe shared marks
  const shareToTribe = async (entry: UserOverlayEntry) => {
    if(!tribeDoc || !tribeEtag || !tribeId || tribeBusyRef.current) return;
    const sysId = (entry as any).systemId;
    if(!Number.isFinite(sysId) || sysId<=0) { setTribeErr('invalid_system'); return; }
    const duplicate = tribeDoc.items.find(it => it.systemId === sysId && (it.title === entry.systemName || (entry.note && it.note === entry.note)));
    if(duplicate){
      const ok = confirm('A tribe mark for this system already exists. Add another?');
      if(!ok) return;
    }
    const baseId = 't' + sysId + '_' + Date.now().toString(36).slice(2,8);
    const op: TribeOp = { type:'add_item', id: baseId, systemId: sysId, title: entry.systemName, note: entry.note || '', color: entry.color };
    setTribeBusy(true); tribeBusyRef.current = true; setTribeErr(null);
    try {
      // Single optimistic attempt with retry helper (handles one 409)
      const { doc, etag } = await mutateWithRetry(tribeDoc.tribe, [op], tribeEtag, { allowPreview:true });
      setTribeDoc(doc); setTribeEtag(etag);
      if(!(activeFolderId && String(activeFolderId).startsWith('tribe:'))){ setActiveFolderId(`tribe:${tribeId}`); }
    } catch(e:any){
      setTribeErr(String(e?.message||e));
    } finally {
      setTribeBusy(false); tribeBusyRef.current = false;
    }
  };
  const onLegendDragStart = (c:string)=> (ev:React.DragEvent)=> { ev.dataTransfer.setData('text/plain', c); setLegendDragColor(c); };
  const onLegendDragEnd = ()=> setLegendDragColor(null);
  const onRowDragOver: React.DragEventHandler<HTMLTableRowElement> = ev => { if(legendDragColor) ev.preventDefault(); };
  const onRowDrop = (id:string)=> (ev:React.DragEvent)=> { ev.preventDefault(); const c = legendDragColor || ev.dataTransfer.getData('text/plain'); if(c) userOverlayStore.update(id,{ color:c }); setLegendDragColor(null); };
  const onExport = () => { const data = userOverlayStore.export(); const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' }); const a=document.createElement('a'); a.download = `overlay_export_${new Date().toISOString().slice(0,10)}.json`; a.href = URL.createObjectURL(blob); a.click(); try { (window as any).__efOverlayExport?.(); } catch {} setTimeout(()=> URL.revokeObjectURL(a.href), 2000); };
  const onImport = (files:FileList|null)=> { if(!files||!files.length) return; const f=files[0]; const r=new FileReader(); r.onload=()=>{ try { const json=JSON.parse(String(r.result)); const res = userOverlayStore.import(json); const after = userOverlayStore.getEntries().length; if(res.added>0) { try { (window as any).__efOverlayImport?.(after); } catch {} } } catch(e){ console.warn('[overlay] import failed', e); } }; r.readAsText(f); };
  const clearAll = ()=> { if(!entries.length) return; if(confirm('Clear all overlay marks? This cannot be undone.')) userOverlayStore.clearAll(); };
  const openFolderModal = (scope:'tribe'|'personal') => {
    if(scope==='tribe' && (tribeBusy || tribeBusyRef.current)) return;
    setFolderModal({ scope });
    setFolderModalError(null);
  };
  const closeFolderModal = () => {
    setFolderModal(null);
    setFolderModalError(null);
  };
  const handleFolderSubmit = async (rawName: string): Promise<boolean> => {
    const trimmed = rawName.trim();
    if(!trimmed){
      setFolderModalError('Enter a folder name.');
      return false;
    }
    if(!folderModal) return false;
    if(folderModal.scope === 'tribe'){
      if(!tribeDoc || !tribeEtag){
        setFolderModalError('Tribe data not ready yet.');
        return false;
      }
      if(tribeBusy || tribeBusyRef.current){
        setFolderModalError('Another tribe action is in progress. Try again shortly.');
        return false;
      }
      const id = trimmed.toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,24) || ('f'+Date.now().toString(36));
      const op:TribeOp={ type:'add_folder', id, name: trimmed };
      setTribeBusy(true); tribeBusyRef.current = true; setTribeErr(null);
      try {
        const { doc, etag } = await mutateWithRetry(tribeDoc.tribe, [op], tribeEtag, { allowPreview:true });
        setTribeDoc(doc);
        setTribeEtag(etag);
        closeFolderModal();
        return true;
      } catch(e:any){
        const rawMsg = String(e?.message || e || '');
        setTribeErr(rawMsg);
        const friendly = rawMsg && rawMsg !== '[object Object]' ? rawMsg : 'Unable to create folder.';
        setFolderModalError(friendly);
        return false;
      } finally {
        setTribeBusy(false);
        tribeBusyRef.current = false;
      }
    } else {
      const created = addPersonalFolder(trimmed);
      if(created){
        setFolders(getPersonalFolders());
        closeFolderModal();
        return true;
      }
      setFolderModalError('Folder already exists or name is invalid.');
      return false;
    }
  };
  const header = (label:string, key:SortState['key'], style?:React.CSSProperties) => <th style={{ ...headerStyle, textAlign:'center', ...(style||{}) }} onClick={()=> toggleSort(key)}>{label} {sort.key===key? (sort.dir===1?'▲':'▼'):''}</th>;
  const addFolderDisabled = activeFolderId.startsWith('tribe:') && tribeBusy;
  return (
    <>
    <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'row', overflow:'hidden' }}>
      {/* Left Folder Pane */}
      <div
        style={{ width:220, borderRight:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', padding:8, gap:8, background:'rgba(20,20,24,0.85)' }}
        aria-label="Overlay folders"
      >
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <strong style={{ fontSize:12, letterSpacing:'.4px', opacity:0.9 }}>Folders</strong>
          <button
            style={{ ...rowBtnStyle, marginRight:0 }}
            onClick={()=> openFolderModal(activeFolderId.startsWith('tribe:')? 'tribe':'personal')}
            disabled={addFolderDisabled}
            title={activeFolderId.startsWith('tribe:')? 'Add tribe folder':'Add personal folder'}
          >+</button>
        </div>
        <div style={{ flex:1, overflow:'auto', display:'flex', flexDirection:'column', gap:6 }} role="tree" aria-label="Folder list">
          {/* Tribe section (always expanded when present) */}
          {tribeId && (
            <div role="group" aria-label="Tribe folders" style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <div
                role="treeitem"
                aria-selected={activeFolderId===`tribe:${tribeId}`}
                tabIndex={0}
                style={{ padding:'4px 6px', borderRadius:4, cursor:'pointer', outline:'none', background: activeFolderId===`tribe:${tribeId}`? 'rgba(0,120,180,0.28)':'rgba(0,120,180,0.18)', display:'flex', alignItems:'center', gap:6 }}
                onClick={()=> setActiveFolderId(`tribe:${tribeId}`)}
                onKeyDown={e=> { if(e.key==='Enter' || e.key===' ') { e.preventDefault(); setActiveFolderId(`tribe:${tribeId}`); } if(e.key==='Escape' && editingFolderId){ setEditingFolderId(null); } }}
              >
                <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis' }}>{tribeName || tribeId}</span>
                <span style={{ fontSize:10, opacity:0.7 }}>{tribeDoc? tribeDoc.items.length: '…'}</span>
              </div>
              {tribeDoc && tribeDoc.folders.length>0 && (
                <div role="group" style={{ display:'flex', flexDirection:'column', gap:2, marginLeft:6 }}>
                  {tribeDoc.folders.map(f=> {
                    const count = tribeDoc.items.filter(it=> it.folderId===f.id).length;
                    const isEditing = editingFolderId===`tribeFolder:${f.id}`;
                    return (
                      <div
                        key={f.id}
                        role="treeitem"
                        aria-selected={activeFolderId===`tribeFolder:${f.id}`}
                        tabIndex={0}
                        style={{ padding:'3px 6px', borderRadius:4, cursor:'pointer', outline:'none', background: activeFolderId===`tribeFolder:${f.id}`? 'rgba(255,255,255,0.15)':'rgba(255,255,255,0.05)', display:'flex', gap:4, alignItems:'center' }}
                        onClick={(e)=> { e.stopPropagation(); setActiveFolderId(`tribeFolder:${f.id}`); }}
                        onKeyDown={e=> {
                          if(e.key==='Enter' || e.key===' ') { e.preventDefault(); setActiveFolderId(`tribeFolder:${f.id}`); }
                          if(e.key==='F2'){ e.preventDefault(); setEditingFolderId(`tribeFolder:${f.id}`); setEditingFolderName(f.name); }
                          if(e.key==='Delete'){ e.preventDefault(); if(confirm('Delete tribe folder? Marks become unassigned.') && tribeDoc && tribeEtag){ const op:TribeOp={ type:'delete_folder', id:f.id }; setTribeBusy(true); mutateWithRetry(tribeDoc.tribe,[op],tribeEtag,{ allowPreview:true }).then(({doc, etag})=>{ setTribeDoc(doc); setTribeEtag(etag); if(activeFolderId===`tribeFolder:${f.id}`) setActiveFolderId(`tribe:${tribeId}`); }).catch(er=> setTribeErr(String((er as any)?.message||er))).finally(()=> setTribeBusy(false)); } }
                          if(e.key==='Escape' && editingFolderId){ setEditingFolderId(null); }
                        }}
                        draggable
                        onDragOver={ev=> ev.preventDefault()}
                        onDrop={async ev=> { // allow dropping tribe marks here (move)
                          if(!tribeDoc || !tribeEtag) return; const fid = f.id; const ids = ev.dataTransfer.getData('application/x-tribe-item-ids'); if(!ids) return;
                          try { const parsed = JSON.parse(ids); if(Array.isArray(parsed)){ const ops:TribeOp[] = parsed.map(id=> ({ type:'move_item', id, folderId: fid })); setTribeBusy(true); setTribeErr(null); const { doc, etag } = await mutateWithRetry(tribeDoc.tribe, ops, tribeEtag, { allowPreview:true }); setTribeDoc(doc); setTribeEtag(etag); } } catch{/* ignore */} finally { setTribeBusy(false); }
                        }}
                      >
                        {isEditing ? (
                          <input
                            value={editingFolderName}
                            onChange={e=> setEditingFolderName(e.target.value)}
                            onKeyDown={e=> { if(e.key==='Enter'){ e.preventDefault(); const name=editingFolderName.trim(); if(name && tribeDoc && tribeEtag){ const op:TribeOp={ type:'rename_folder', id:f.id, name }; setTribeBusy(true); mutateWithRetry(tribeDoc.tribe,[op],tribeEtag,{ allowPreview:true }).then(({doc, etag})=>{ setTribeDoc(doc); setTribeEtag(etag); }).catch(er=> setTribeErr(String((er as any)?.message||er))).finally(()=> setTribeBusy(false)); } setEditingFolderId(null); } if(e.key==='Escape'){ e.preventDefault(); setEditingFolderId(null); } }}
                            autoFocus
                            style={{ flex:1, background:'#111', color:'#fff', border:'1px solid #444', fontSize:11, padding:'2px 4px', borderRadius:4 }}
                          />
                        ) : (
                          <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis' }}>{f.name}</span>
                        )}
                        <span style={{ fontSize:10, opacity:0.6 }}>{count}</span>
                        {!isEditing && (
                          <button
                            style={{ ...rowBtnStyle, padding:'0 4px', marginRight:0 }}
                            title='Rename tribe folder'
                            onClick={(ev)=> { ev.stopPropagation(); setEditingFolderId(`tribeFolder:${f.id}`); setEditingFolderName(f.name); }}
                          >✎</button>
                        )}
                        {!isEditing && (
                          <button
                            style={{ ...rowBtnStyle, padding:'0 4px', marginRight:0, background:'#5a1e1e', border:'1px solid #7a2e2e' }}
                            title='Delete tribe folder'
                            onClick={(ev)=> { ev.stopPropagation(); if(!confirm('Delete tribe folder? Marks become unassigned.')) return; if(!tribeDoc||!tribeEtag) return; const op:TribeOp={ type:'delete_folder', id:f.id }; setTribeBusy(true); mutateWithRetry(tribeDoc.tribe,[op],tribeEtag,{ allowPreview:true }).then(({doc, etag})=>{ setTribeDoc(doc); setTribeEtag(etag); if(activeFolderId===`tribeFolder:${f.id}`) setActiveFolderId(`tribe:${tribeId}`); }).catch(er=> setTribeErr(String((er as any)?.message||er))).finally(()=> setTribeBusy(false)); }}
                          >✕</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {/* Personal section with All Personal at top */}
          <div role="group" aria-label="Personal folders" style={{ display:'flex', flexDirection:'column', gap:4, marginTop: tribeId? 8: 0 }}>
            <div
              role="treeitem"
              aria-selected={activeFolderId===''}
              tabIndex={0}
              style={{ padding:'4px 6px', borderRadius:4, cursor:'pointer', outline:'none', background: activeFolderId===''? 'rgba(255,255,255,0.10)':'transparent' }}
              onClick={()=> setActiveFolderId('')}
              onKeyDown={e=> { if(e.key==='Enter' || e.key===' ') { e.preventDefault(); setActiveFolderId(''); } if(e.key==='Escape' && editingFolderId) setEditingFolderId(null); }}
            >All Personal</div>
            {folders.map(f=> {
              const count = folderCounts[f.id]||0;
              const isEditing = editingFolderId===`personal:${f.id}`;
              return (
                <div
                  key={f.id}
                  role="treeitem"
                  aria-selected={activeFolderId===`personal:${f.id}`}
                  tabIndex={0}
                  style={{ padding:'4px 6px', borderRadius:4, cursor:'pointer', outline:'none', background: activeFolderId===`personal:${f.id}`? 'rgba(255,255,255,0.12)':'transparent', display:'flex', gap:4, alignItems:'center' }}
                  onClick={()=> setActiveFolderId(`personal:${f.id}`)}
                  onKeyDown={e=> {
                    if(e.key==='Enter' || e.key===' ') { e.preventDefault(); setActiveFolderId(`personal:${f.id}`); }
                    if(e.key==='F2'){ e.preventDefault(); setEditingFolderId(`personal:${f.id}`); setEditingFolderName(f.name); }
                    if(e.key==='Delete'){ e.preventDefault(); if(confirm('Delete personal folder? Entries become unassigned.') && deletePersonalFolder(f.id)){ setFolders(getPersonalFolders()); if(activeFolderId===`personal:${f.id}`) setActiveFolderId(''); } }
                    if(e.key==='Escape' && editingFolderId){ setEditingFolderId(null); }
                  }}
                  onDragOver={ev=> ev.preventDefault()}
                  onDrop={ev=> { const ids = ev.dataTransfer.getData('application/x-personal-entry-ids'); if(!ids) return; try { const parsed=JSON.parse(ids); if(Array.isArray(parsed)){ parsed.forEach((id:string)=> setEntryFolder(id, f.id)); } } catch{} }}
                >
                  {isEditing ? (
                    <input
                      value={editingFolderName}
                      onChange={e=> setEditingFolderName(e.target.value)}
                      onKeyDown={e=> { if(e.key==='Enter'){ e.preventDefault(); const name=editingFolderName.trim(); if(name){ if(renamePersonalFolder(f.id, name)) setFolders(getPersonalFolders()); } setEditingFolderId(null); } if(e.key==='Escape'){ e.preventDefault(); setEditingFolderId(null); } }}
                      autoFocus
                      style={{ flex:1, background:'#111', color:'#fff', border:'1px solid #444', fontSize:11, padding:'2px 4px', borderRadius:4 }}
                    />
                  ) : (
                    <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis' }}>{f.name}</span>
                  )}
                  <span style={{ fontSize:10, opacity:0.6 }}>{count}</span>
                  {!isEditing && (
                    <button
                      style={{ ...rowBtnStyle, padding:'0 4px', marginRight:0 }}
                      title='Rename folder'
                      onClick={(ev)=> { ev.stopPropagation(); setEditingFolderId(`personal:${f.id}`); setEditingFolderName(f.name); }}
                    >✎</button>
                  )}
                  {!isEditing && (
                    <button
                      style={{ ...rowBtnStyle, padding:'0 4px', marginRight:0, background:'#5a1e1e', border:'1px solid #7a2e2e' }}
                      title='Delete folder'
                      onClick={(ev)=> { ev.stopPropagation(); if(!confirm('Delete personal folder? Entries become unassigned.')) return; if(deletePersonalFolder(f.id)){ setFolders(getPersonalFolders()); if(activeFolderId===`personal:${f.id}`) setActiveFolderId(''); } }}
                    >✕</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {tribeBusy && <div style={{ fontSize:10, opacity:0.7 }}>Syncing…</div>}
        {tribeErr && <div style={{ fontSize:10, color:'#ff9280' }} title={tribeErr}>Tribe error</div>}
      </div>
      {/* Right Content Pane */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Removed legacy top folder bar: functionality replaced by left sidebar */}
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
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, minWidth:760 }}>
          <thead>
            <tr>
              {header('Color','color',{ width:60 })}
              {header('System','systemName',{ width:140 })}
              {header('Note','note')}
              {header('Created','createdAt',{ width:84 })}
              {header('Verified','lastVerifiedAt',{ width:84 })}
              {header('Updated','updatedAt',{ width:84 })}
              <th style={{ ...headerStyle, textAlign:'center', width:250 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted
              .filter(()=> {
                if(activeFolderId.startsWith('tribe:') || activeFolderId.startsWith('tribeFolder:')) return false; // hide personal when tribe context
                return true;
              })
              .map(e=> {
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
        // Selected row background: apply via a variable so we can reuse for sticky cell to avoid gap.
        const rowBg = selectedRow? 'rgba(255,255,255,0.10)' : undefined;
        return (
                <tr
                  key={e.id}
                  onContextMenu={handleRowContext}
          style={{ ...(stale? { opacity:0.55 }: {}), background: rowBg, outline: selectedRow? '1px solid rgba(255,255,255,0.18)': undefined, cursor:'pointer' }}
                  onClick={(ev)=> toggleRowSelect(e.id, sorted.findIndex(x=> x.id===e.id), ev)}
                  onMouseEnter={()=> onSoftHover && onSoftHover(e.systemName)}
                  onMouseLeave={()=> onSoftHover && onSoftHover(null)}
                  onDragOver={onRowDragOver}
                  onDrop={onRowDrop(e.id)}
                  draggable
                  onDragStart={ev=> {
                    // personal entries drag payload (multi-select aware)
                    const dragIds = allSelectedSet.has(e.id)? selectedIds : [e.id];
                    ev.dataTransfer.setData('application/x-personal-entry-ids', JSON.stringify(dragIds));
                    ev.dataTransfer.effectAllowed = 'move';
                  }}
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
                    style={{ ...centerCell, ...nameCellSticky, cursor:'pointer', textDecoration:'underline', background: rowBg || nameCellSticky.background }}
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
                    {tribeDoc && tribeEtag && tribeId && (
                      <button
                        style={{ ...rowBtnStyle, background:'#274760', color:'#b8e3ff', border:'1px solid #35678a' }}
                        disabled={tribeBusy}
                        onClick={()=> shareToTribe(e)}
                        title='Share to tribe'
                      >⇪</button>
                    )}
                    {/* Per-entry folder selector for personal folders */}
                    {folders.length>0 && (
                      <select
                        value={getEntryFolder(e.id)||''}
                        onChange={ev=> { const val = ev.target.value||''; setEntryFolder(e.id, val||null); }}
                        style={{ ...selectStyle, marginLeft:6, width:140 }}
                        title="Assign to personal folder"
                      >
                        <option value=''>No folder</option>
                        {folders.map(f=> <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Tribe folder view rows */}
            { (activeFolderId.startsWith('tribe:') || activeFolderId.startsWith('tribeFolder:')) && tribeDoc && tribeDoc.items
              .filter(it=> {
                 if(activeFolderId.startsWith('tribeFolder:')){ const fid = activeFolderId.slice('tribeFolder:'.length); return it.folderId === fid; }
                 return true; // tribe root shows all
               })
              .map(it=> {
              const color = it.color || '#00aaff';
              const systemName = it.title || String(it.systemId);
              return (
              <tr key={it.id} onDragOver={onRowDragOver} onDrop={async ev=> {
                const c = legendDragColor || ev.dataTransfer.getData('text/plain');
                if(c){
                  ev.preventDefault();
                  const ops:TribeOp[]=[{ type:'update_item', id:it.id, color:c }];
                  setTribeBusy(true); setTribeErr(null);
                  try{ const { doc, etag } = await mutateWithRetry(tribeDoc.tribe, ops, tribeEtag, { allowPreview:true }); setTribeDoc(doc); setTribeEtag(etag); }
                  catch(e:any){ setTribeErr(String(e?.message||e)); }
                  finally{ setTribeBusy(false); }
                }
              }}
              draggable
              onMouseEnter={()=> onSoftHover && onSoftHover(systemName)}
              onMouseLeave={()=> onSoftHover && onSoftHover(null)}
              onDragStart={ev=> {
                // tribe marks drag (only for moving into folders inside tribe pane)
                ev.dataTransfer.setData('application/x-tribe-item-ids', JSON.stringify([it.id]));
                ev.dataTransfer.effectAllowed='move';
              }}
              >
                <td style={centerCell}>
                  <span style={{ display:'inline-block', width:16, height:16, borderRadius:16, background:color, boxShadow:'0 0 0 1px #222', cursor: legendDragColor? 'copy':'default' }} title={'Tribe mark'} />
                </td>
                <td style={{ ...centerCell, ...nameCellSticky, cursor:'pointer', textDecoration:'underline' }} title={systemName} onClick={()=> onSelectSystem && onSelectSystem(systemName)}>{systemName}</td>
                <td style={cellStyle} onClick={()=> { if(editingTribeId!==it.id){ setEditingTribeId(it.id); setEditingTribeNote(it.note||''); } }}>
                  {editingTribeId===it.id ? (
                    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                      <textarea
                        value={editingTribeNote}
                        onChange={ev=> setEditingTribeNote(ev.target.value)}
                        style={{ width:'100%', minHeight:50, background:'#222', color:'#fff', border:'1px solid #444', resize:'vertical', fontSize:11 }}
                        maxLength={160}
                        autoFocus
                      />
                      <div style={{ display:'flex', gap:6 }}>
                        <button style={rowBtnStyle} onClick={async()=>{
                          if(!tribeDoc||!tribeEtag){ setEditingTribeId(null); return; }
                          const note = editingTribeNote.trim();
                          const ops:TribeOp[]=[{ type:'update_item', id:it.id, note }];
                          setTribeBusy(true); setTribeErr(null);
                          try { const { doc, etag } = await mutateWithRetry(tribeDoc.tribe, ops, tribeEtag, { allowPreview:true }); setTribeDoc(doc); setTribeEtag(etag); }
                          catch(e:any){ setTribeErr(String(e?.message||e)); }
                          finally { setTribeBusy(false); setEditingTribeId(null); }
                        }}>Save</button>
                        <button style={rowBtnStyle} onClick={()=> setEditingTribeId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (it.note ? it.note : (it.title || <span style={{ opacity:0.4 }}>—</span>))}
                </td>
                <td style={centerCell}>{fmtDate(Date.parse(it.createdAt||''))}</td>
                <td style={centerCell}>{it.verifiedAt? fmtDate(Date.parse(it.verifiedAt)): '—'}</td>
                <td style={centerCell}>{fmtDate(Date.parse(it.updatedAt||''))}</td>
                <td style={centerCell}>
                  <button style={{ ...rowBtnStyle, background:'#1d4d1d', color:'#c6f7c6', border:'1px solid #2d6d2d' }} onClick={async()=>{
                    const ops:TribeOp[]=[{ type:'verify_item', id:it.id }];
                    setTribeBusy(true); setTribeErr(null);
                    try{ const { doc, etag } = await mutateWithRetry(tribeDoc.tribe, ops, tribeEtag, { allowPreview:true }); setTribeDoc(doc); setTribeEtag(etag); }
                    catch(e:any){ setTribeErr(String(e?.message||e)); }
                    finally{ setTribeBusy(false); }
                  }} title='Verify mark'>✔</button>
                  <button style={{ ...rowBtnStyle, background:'#5a1e1e', color:'#f7c6c6', border:'1px solid #7a2e2e' }} onClick={async()=>{
                    if(!confirm('Delete tribe mark?')) return;
                    const ops:TribeOp[]=[{ type:'remove_item', id:it.id }];
                    setTribeBusy(true); setTribeErr(null);
                    try{ const { doc, etag } = await mutateWithRetry(tribeDoc.tribe, ops, tribeEtag, { allowPreview:true }); setTribeDoc(doc); setTribeEtag(etag); }
                    catch(e:any){ setTribeErr(String(e?.message||e)); }
                    finally{ setTribeBusy(false); }
                  }} title='Delete tribe mark'>✕</button>
                  <button style={{ ...rowBtnStyle }} disabled={editingTribeId!=null} onClick={()=> { if(editingTribeId) return; setEditingTribeId(it.id); setEditingTribeNote(it.note||''); }} title='Edit note'>✎</button>
                  <select value={it.folderId||''} onChange={async e=>{
                    const val = e.target.value||''; const ops:TribeOp[]=[{ type:'move_item', id:it.id, folderId: val||null }];
                    setTribeBusy(true); setTribeErr(null);
                    try{ const { doc, etag } = await mutateWithRetry(tribeDoc.tribe, ops, tribeEtag, { allowPreview:true }); setTribeDoc(doc); setTribeEtag(etag); }
                    catch(e:any){ setTribeErr(String(e?.message||e)); }
                    finally{ setTribeBusy(false); }
                  }} style={{ ...selectStyle, width:140, marginLeft:6 }}>
                    <option value=''>No folder</option>
                    {tribeDoc.folders.map(f=> <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </td>
              </tr>
            ); })}
            {/* Publish tribe view filtered set for map rendering */}
            { (activeFolderId.startsWith('tribe:') || activeFolderId.startsWith('tribeFolder:')) && tribeDoc && (
              publishFilteredOverlay(
                tribeDoc.items.filter(it=> {
                  if(activeFolderId.startsWith('tribeFolder:')){ const fid = activeFolderId.slice('tribeFolder:'.length); return it.folderId === fid; }
                  return true;
                }).map(it=> ({ type:'tribe', systemId: it.systemId, color: it.color || '#00aaff' }))
              ), null
            )}
            {!sorted.length && (!activeFolderId || (!activeFolderId.startsWith('tribe:') && !activeFolderId.startsWith('tribeFolder:'))) && (
              <tr><td colSpan={7} style={{ ...cellStyle, textAlign:'center', opacity:0.6 }}>No marks in this folder{activeFolderId? ' yet':''}.</td></tr>
            )}
            {(activeFolderId.startsWith('tribe:') || activeFolderId.startsWith('tribeFolder:')) && (!tribeDoc || !tribeDoc.items.length) && (
              <tr><td colSpan={7} style={{ ...cellStyle, textAlign:'center', opacity:0.6 }}>{tribeBusy? 'Loading tribe marks…' : 'No tribe marks available.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </div>
    </div>
    {folderModal && (
      <FolderNameModal
        open={!!folderModal}
        scope={folderModal.scope}
        busy={folderModal.scope==='tribe'? tribeBusy : false}
        error={folderModalError}
        onCancel={closeFolderModal}
        onSubmit={handleFolderSubmit}
      />
    )}
    </>
  );
};

function fmtDate(ms?:number){ if(!ms) return ''; try { return new Date(ms).toISOString().slice(0,10); } catch { return ''; } }

export default UserOverlayPanel;

// User Overlay storage & subscription utilities (Phase 1 skeleton)
// Local-only marks (multi-note per system) with export/import.

export interface UserOverlayEntry {
  id: string;
  systemId: number;
  systemName: string;
  color: string; // #RRGGBB
  note: string; // <=240 chars
  createdAt: number;
  updatedAt: number;
  lastVerifiedAt?: number;
  version: 1;
}

export interface UserOverlayExport {
  schema: 'userOverlay.v1';
  exportedAt: number;
  entries: UserOverlayEntry[];
}

type Listener = () => void;

const STORAGE_KEY = 'userOverlay.v1.entries';
const LAST_COLOR_KEY = 'userOverlay.v1.lastColor';
const MAX_NOTE = 240;
const SOFT_MAX = 1500;

let entries: UserOverlayEntry[] = [];
let listeners: Set<Listener> = new Set();
let loaded = false;
let dirty = false;
let saveTimer: any = null;

function scheduleSave(){ if(saveTimer) return; saveTimer = setTimeout(()=>{ saveTimer=null; persist(); }, 350); }
function persist(){ if(!dirty) return; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); dirty=false; } catch(e){ console.warn('[overlay] persist failed', e); } }
function load(){ if(loaded) return; loaded=true; try { const raw = localStorage.getItem(STORAGE_KEY); if(!raw) return; const arr = JSON.parse(raw); if(Array.isArray(arr)) entries = arr.filter(validEntry); } catch(e){ console.warn('[overlay] load failed', e); } }
function validEntry(o:any): o is UserOverlayEntry { return o && typeof o.id==='string' && typeof o.systemId==='number'; }
function emit(){ listeners.forEach(l=>{ try { l(); } catch {/* ignore */} }); }
function normalizeColor(c:string){ if(!c) return '#ffffff'; c=c.trim(); if(/^#?[0-9a-fA-F]{6}$/.test(c)){ if(c[0]!=='#') c='#'+c; return c.toLowerCase(); } return '#ffffff'; }
function clampNote(n:string){ return (n||'').slice(0, MAX_NOTE); }
function loadLastColor(): string | null { try { const v = localStorage.getItem(LAST_COLOR_KEY); if(!v) return null; return normalizeColor(v); } catch { return null; } }
function persistLastColor(c:string){ try { localStorage.setItem(LAST_COLOR_KEY, normalizeColor(c)); } catch {/* ignore */} }

export interface UserOverlayStore {
  getEntries(): UserOverlayEntry[];
  add(systemId:number, systemName:string, color:string, note:string): UserOverlayEntry | null;
  update(id:string, patch: Partial<Pick<UserOverlayEntry,'color'|'note'>>): boolean;
  updateMany(ids:string[], patch: Partial<Pick<UserOverlayEntry,'color'|'note'>>): number;
  verify(id:string): boolean;
  verifyMany(ids:string[]): number;
  remove(id:string): boolean;
  removeMany(ids:string[]): number;
  mergeDuplicates(): { merged:number, removed:number };
  clearAll(): number;
  export(): UserOverlayExport;
  import(data:UserOverlayExport): { added:number };
  subscribe(cb:Listener): ()=>void;
}

export const userOverlayStore: UserOverlayStore = {
  getEntries(){ load(); return entries; },
  add(systemId, systemName, color, note){ load(); if(entries.length >= SOFT_MAX+500){ console.warn('[overlay] hard limit'); return null; } const now=Date.now(); const normColor = normalizeColor(color); const e:UserOverlayEntry={ id:crypto.randomUUID(), systemId, systemName, color:normColor, note:clampNote(note), createdAt:now, updatedAt:now, version:1 }; entries=[...entries,e]; dirty=true; scheduleSave(); persistLastColor(normColor); emit(); try { (window as any).__efOverlayMarkAdded?.(entries.length); } catch {} return e; },
  update(id, patch){ load(); let changed=false; entries = entries.map(e=>{ if(e.id!==id) return e; const next={...e}; let any=false; if(patch.color && patch.color!==e.color){ next.color=normalizeColor(patch.color); any=true; } if(patch.note!==undefined && patch.note!==e.note){ next.note=clampNote(patch.note); any=true; } if(any){ next.updatedAt=Date.now(); changed=true; } return next; }); if(changed){ dirty=true; scheduleSave(); emit(); } return changed; },
  updateMany(ids, patch){ load(); if(!ids.length) return 0; const idSet=new Set(ids); let count=0; const now=Date.now(); entries = entries.map(e=> { if(!idSet.has(e.id)) return e; let any=false; const next={...e}; if(patch.color && patch.color!==e.color){ next.color=normalizeColor(patch.color); any=true; } if(patch.note!==undefined && patch.note!==e.note){ next.note=clampNote(patch.note); any=true; } if(any){ next.updatedAt=now; count++; return next; } return e; }); if(count){ dirty=true; scheduleSave(); emit(); } return count; },
  verify(id){ load(); let changed=false; entries=entries.map(e=> e.id===id? (changed=true, {...e, lastVerifiedAt:Date.now()}): e); if(changed){ dirty=true; scheduleSave(); emit(); } return changed; },
  verifyMany(ids){ load(); if(!ids.length) return 0; const idSet=new Set(ids); let count=0; const now=Date.now(); entries=entries.map(e=> { if(!idSet.has(e.id)) return e; count++; return { ...e, lastVerifiedAt: now }; }); if(count){ dirty=true; scheduleSave(); emit(); } return count; },
  remove(id){ load(); const before=entries.length; entries=entries.filter(e=> e.id!==id); if(entries.length!==before){ dirty=true; scheduleSave(); emit(); return true; } return false; },
  removeMany(ids){ load(); if(!ids.length) return 0; const idSet=new Set(ids); const before=entries.length; entries=entries.filter(e=> !idSet.has(e.id)); const removed = before - entries.length; if(removed){ dirty=true; scheduleSave(); emit(); } return removed; },
  mergeDuplicates(){ load(); // group by systemId+color
    const keyMap = new Map<string, UserOverlayEntry[]>();
    for(const e of entries){ const k = e.systemId+':'+e.color; const arr = keyMap.get(k); if(arr) arr.push(e); else keyMap.set(k,[e]); }
    let merged=0, removed=0; const newEntries: UserOverlayEntry[] = []; const now=Date.now();
    for(const group of keyMap.values()){
      if(group.length===1){ newEntries.push(group[0]); continue; }
      // Sort by createdAt ascending so earliest base retained
      group.sort((a,b)=> a.createdAt - b.createdAt);
      const base = { ...group[0] };
      let notes: string[] = []; if(base.note) notes.push(base.note);
      for(let i=1;i<group.length;i++){
        const o = group[i]; if(o.note) notes.push(o.note);
      }
      base.note = clampNote(notes.join(' | '));
      base.updatedAt = now; // treat merge as update
      merged += group.length - 1; removed += group.length - 1;
      newEntries.push(base);
    }
    if(removed){ entries = newEntries; dirty=true; scheduleSave(); emit(); }
    return { merged, removed };
  },
  clearAll(){ load(); const c=entries.length; if(!c) return 0; entries=[]; dirty=true; scheduleSave(); emit(); return c; },
  export(){ load(); return { schema:'userOverlay.v1', exportedAt:Date.now(), entries:[...entries] }; },
  import(data){ load(); if(!data || data.schema!=='userOverlay.v1' || !Array.isArray(data.entries)) return { added:0 }; const existing = new Set(entries.map(e=> e.id)); const toAdd:UserOverlayEntry[]=[]; let added=0; for(const raw of data.entries){ if(!validEntry(raw)) continue; if(existing.has(raw.id)) raw.id = crypto.randomUUID(); raw.color=normalizeColor(raw.color); raw.note=clampNote(raw.note); if(!raw.createdAt) raw.createdAt=Date.now(); if(!raw.updatedAt) raw.updatedAt=raw.createdAt; raw.version=1; toAdd.push(raw); } if(toAdd.length){ entries=[...entries,...toAdd]; dirty=true; scheduleSave(); emit(); added=toAdd.length; try { (window as any).__efOverlayImport?.(entries.length); } catch {} } return { added }; },
  subscribe(cb){ load(); listeners.add(cb); return ()=> listeners.delete(cb); }
};

export const OVERLAY_FEATURE_FLAG = true;

// Simple shared filter color state (managed by panel, read by ring renderer)
let filterColor: string | null = null;
const filterListeners = new Set<Listener>();
export function setOverlayFilterColor(c:string|null){ filterColor = c; filterListeners.forEach(l=> { try { l(); } catch {} }); }
export function getOverlayFilterColor(){ return filterColor; }
export function subscribeOverlayFilter(cb:Listener){ filterListeners.add(cb); return ()=> filterListeners.delete(cb); }
export function getOverlayLastColor(){ return loadLastColor(); }
export function setOverlayLastColor(c:string){ persistLastColor(c); }

// Human-friendly names for the default palette colors used in Add Mark window
export const OVERLAY_COLOR_NAMES: Record<string,string> = {
  '#ff4c26':'Dark Orange',
  '#ffa600':'Orange',
  '#ffd400':'Yellow',
  '#ff0000':'Red',
  '#3fbf3f':'Green',
  '#00aaff':'Cyan',
  '#0060ff':'Blue',
  '#7d5cff':'Purple',
  '#ff2ca8':'Pink',
  '#8dff00':'Chartreuse',
  '#00ffc8':'Aqua',
  '#b300ff':'Violet',
  '#ff006e':'Rose'
};


// Personal folders for User Overlay marks (local-only)
// Stores folder definitions and entry->folder assignments in localStorage
// without changing the underlying userOverlayStore schema.

import { userOverlayStore } from './userOverlay';

export interface PersonalFolder { id: string; name: string }

type Listener = () => void;

const FOLDERS_KEY = 'userOverlay.folders.v1';
const ASSIGN_KEY = 'userOverlay.folderAssign.v1';
const DEFAULT_ADD_KEY = 'userOverlay.defaultAddFolder.v1';

let folders: PersonalFolder[] = [];
let assign: Record<string, string | null> = {};
let loaded = false;
const listeners = new Set<Listener>();
let defaultAddFolderId: string | null = null;

function loadOnce(){
  if(loaded) return; loaded = true;
  try {
    const fRaw = localStorage.getItem(FOLDERS_KEY);
    if(fRaw){ const arr = JSON.parse(fRaw); if(Array.isArray(arr)) folders = arr.filter(v=> v && typeof v.id==='string' && typeof v.name==='string'); }
  } catch {}
  try {
    const aRaw = localStorage.getItem(ASSIGN_KEY);
    if(aRaw){ const obj = JSON.parse(aRaw); if(obj && typeof obj==='object') assign = obj; }
  } catch {}
  try {
    const dRaw = localStorage.getItem(DEFAULT_ADD_KEY);
    if(dRaw){ const s = String(dRaw); defaultAddFolderId = s || null; }
  } catch {}
  // Cleanup assignments that reference missing entries or folders
  cleanupAssignments();
}

function persist(){
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); } catch {}
  try { localStorage.setItem(ASSIGN_KEY, JSON.stringify(assign)); } catch {}
  try { localStorage.setItem(DEFAULT_ADD_KEY, defaultAddFolderId || ''); } catch {}
}

function emit(){ listeners.forEach(l=> { try { l(); } catch {} }); }

function cleanupAssignments(){
  const entryIds = new Set(userOverlayStore.getEntries().map(e=> e.id));
  const folderIds = new Set(folders.map(f=> f.id));
  let changed = false;
  for(const [eid, fid] of Object.entries(assign)){
    if(!entryIds.has(eid) || (fid && !folderIds.has(fid))){ delete assign[eid]; changed = true; }
  }
  if(changed) persist();
}

export function getPersonalFolders(): PersonalFolder[]{ loadOnce(); return folders.slice(); }

export function addPersonalFolder(name: string): PersonalFolder | null {
  loadOnce();
  const n = (name||'').trim().slice(0, 60);
  if(!n) return null;
  // deterministic short id
  const id = n.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g,'').slice(0, 28) || ('f_' + Math.random().toString(36).slice(2,8));
  if(folders.some(f=> f.id===id)) return null;
  folders = [...folders, { id, name: n }];
  persist(); emit();
  return { id, name: n };
}

export function renamePersonalFolder(id: string, name: string): boolean {
  loadOnce();
  const n = (name||'').trim().slice(0, 60); if(!n) return false;
  let changed = false;
  folders = folders.map(f=> f.id===id ? (changed=true, { ...f, name: n }) : f);
  if(changed){ persist(); emit(); }
  return changed;
}

export function deletePersonalFolder(id: string): boolean {
  loadOnce();
  const before = folders.length;
  folders = folders.filter(f=> f.id!==id);
  if(folders.length !== before){
    // remove assignments to this folder
    for(const k of Object.keys(assign)){ if(assign[k]===id) assign[k] = null; }
    persist(); emit();
    return true;
  }
  return false;
}

export function getEntryFolder(entryId: string): string | null { loadOnce(); return assign[entryId] || null; }

export function setEntryFolder(entryId: string, folderId: string | null): void {
  loadOnce();
  if(folderId){ if(!folders.some(f=> f.id===folderId)) return; }
  assign[entryId] = folderId || null;
  persist(); emit();
}

export function getFolderCounts(): Record<string, number> {
  loadOnce();
  const out: Record<string, number> = {};
  for(const e of userOverlayStore.getEntries()){
    const fid = assign[e.id] || null; if(!fid) continue; out[fid] = (out[fid]||0) + 1;
  }
  return out;
}

export function subscribeFolders(cb: Listener): () => void {
  loadOnce(); listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// Default assignment folder for newly-created marks (set by panel when a personal folder is active)
export function setDefaultAddFolderId(folderId: string | null){ loadOnce(); defaultAddFolderId = folderId || null; persist(); emit(); }
export function getDefaultAddFolderId(){ loadOnce(); return defaultAddFolderId; }

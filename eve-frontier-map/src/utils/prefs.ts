// Centralized user preference persistence with versioning.
// Only lightweight, non-sensitive UI prefs are stored.
// Keys intentionally namespaced under a single root to allow easy reset.

export interface EFMapPreferencesV1 {
  v: 1; // version
  accent: 'orange' | 'blue';
  openPanels: string[]; // panel id order (front-most last)
  lastJumpDistance?: number; // last entered P2P max ship jump distance
  optimizeFor?: 'fuel' | 'jumps';
  algorithm?: 'astar' | 'dijkstra';
}

export type EFMapPreferences = EFMapPreferencesV1; // future union

const KEY = 'efmap:prefs';

const defaultPrefs: EFMapPreferencesV1 = {
  v: 1,
  accent: 'orange',
  openPanels: [],
};

export function loadPrefs(): EFMapPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if(!raw) return { ...defaultPrefs };
    const parsed = JSON.parse(raw);
    if(typeof parsed !== 'object' || parsed === null) return { ...defaultPrefs };
    // Basic version gate
    if(parsed.v !== 1) return { ...defaultPrefs };
    return { ...defaultPrefs, ...parsed };
  } catch { return { ...defaultPrefs }; }
}

let currentPrefs: EFMapPreferences = loadPrefs();

function writeNow(){
  try { localStorage.setItem(KEY, JSON.stringify(currentPrefs)); } catch {/* ignore */}
}

export function getPrefs(): EFMapPreferences { return currentPrefs; }

export function updatePrefs(mut: (draft: EFMapPreferences)=>void){
  const draft = { ...currentPrefs } as EFMapPreferences;
  mut(draft);
  currentPrefs = draft;
  writeNow();
}

export function resetAllPrefs(){
  currentPrefs = { ...defaultPrefs };
  try { localStorage.removeItem(KEY); } catch {/* ignore */}
}

// Helper focused setters
export function setAccent(accent: 'orange' | 'blue'){ updatePrefs(p=>{ p.accent = accent; }); }
export function setOpenPanels(ids: string[]){ updatePrefs(p=>{ p.openPanels = ids.slice(0); }); }
export function setLastJumpDistance(dist: number){ updatePrefs(p=>{ p.lastJumpDistance = dist; }); }
export function setRoutingPrefs(jump: number, optimize: 'fuel'|'jumps', algorithm: 'astar'|'dijkstra'){
  updatePrefs(p=>{ p.lastJumpDistance = jump; p.optimizeFor = optimize; p.algorithm = algorithm; });
}

export function clearPanelPositions(){
  try {
    const keysToRemove: string[] = [];
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && k.startsWith('panel-pos:')) keysToRemove.push(k);
    }
    keysToRemove.forEach(k=> localStorage.removeItem(k));
  } catch {/* ignore */}
}

export function fullReset(){
  resetAllPrefs();
  clearPanelPositions();
}

// Flush on visibility change/unload for safety (in case future buffering added)
try {
  window.addEventListener('beforeunload', writeNow);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') writeNow(); });
} catch {/* non-browser env */}

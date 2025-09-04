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

// v2 adds uiScale (number, default 1)
export interface EFMapPreferencesV2 extends Omit<EFMapPreferencesV1, 'v'> { v:2; uiScale?: number; showStations?: boolean }

// v3 adds overlaySort (string) and overlayAgingDays (number) for User Overlay panel
export interface EFMapPreferencesV3 extends Omit<EFMapPreferencesV2, 'v'> { v:3; overlaySort?: string; overlayAgingDays?: number }

export type EFMapPreferences = EFMapPreferencesV1 | EFMapPreferencesV2 | EFMapPreferencesV3; // future union

const KEY = 'efmap:prefs';

const defaultPrefsV3: EFMapPreferencesV3 = { v:3, accent:'orange', openPanels:[], uiScale:1, showStations:false, overlaySort:'createdAt:-1', overlayAgingDays:3 };

export function loadPrefs(): EFMapPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if(!raw) return { ...defaultPrefsV3 };
    const parsed = JSON.parse(raw);
    if(typeof parsed !== 'object' || parsed === null) return { ...defaultPrefsV3 };
    if(parsed.v === 1){
      // upgrade to v2
      const upgraded: EFMapPreferencesV2 = { ...parsed, v:2, uiScale:1 };
      // continue upgrade chain to v3
      const upgraded3: EFMapPreferencesV3 = { ...upgraded, v:3, overlaySort:'createdAt:-1', overlayAgingDays:3 };
      return upgraded3;
    }
    if(parsed.v === 2){
      const upgraded3: EFMapPreferencesV3 = { ...parsed, v:3, overlaySort: parsed.overlaySort || 'createdAt:-1', overlayAgingDays: parsed.overlayAgingDays || 3 };
      return { ...defaultPrefsV3, ...upgraded3 };
    }
    if(parsed.v === 3){
      return { ...defaultPrefsV3, ...parsed };
    }
    return { ...defaultPrefsV3 };
  } catch { return { ...defaultPrefsV3 }; }
}

let currentPrefs: EFMapPreferences = loadPrefs();

function writeNow(){
  try { localStorage.setItem(KEY, JSON.stringify(currentPrefs)); } catch {/* ignore */}
  try { if((window as any).DEBUG_PREFS) console.log('[prefs] write', currentPrefs); } catch {/* ignore */}
}

export function getPrefs(): EFMapPreferences { return currentPrefs; }

export function updatePrefs(mut: (draft: EFMapPreferences)=>void){
  const draft = { ...currentPrefs } as EFMapPreferences;
  mut(draft);
  currentPrefs = draft;
  writeNow();
}

export function resetAllPrefs(){
  currentPrefs = { ...defaultPrefsV3 };
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

export function fullReset(){ resetAllPrefs(); clearPanelPositions(); }

// Reset only input/preferences (do NOT clear panel positions)
export function softReset(){ resetAllPrefs(); }

export function setUiScale(scale:number){ updatePrefs(p=>{ if('uiScale' in p){ (p as any).uiScale = scale; } }); }
export function setShowStations(v:boolean){ updatePrefs(p=>{ if('showStations' in p){ (p as any).showStations = v; } }); }
export function setOverlaySort(v:string){ updatePrefs(p=>{ (p as any).overlaySort = v; }); }
export function setOverlayAgingDays(days:number){ updatePrefs(p=>{ (p as any).overlayAgingDays = days; }); }

// Flush on visibility change/unload for safety (in case future buffering added)
try {
  window.addEventListener('beforeunload', writeNow);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') writeNow(); });
} catch {/* non-browser env */}

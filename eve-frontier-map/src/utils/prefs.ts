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
export interface EFMapPreferencesV3 extends Omit<EFMapPreferencesV2, 'v'> { v:3; overlaySort?: string; overlayAgingDays?: number; transmissionSeen?: boolean }
// v4 adds transmissionAudioMuted (boolean) for onboarding transmission ambient/glitch audio preference
export interface EFMapPreferencesV4 extends Omit<EFMapPreferencesV3, 'v'> { v:4; transmissionAudioMuted?: boolean }
// v5 adds transmissionAudioVolume (0-1 float)
export interface EFMapPreferencesV5 extends Omit<EFMapPreferencesV4, 'v'> { v:5; transmissionAudioVolume?: number }

export type EFMapPreferences = EFMapPreferencesV1 | EFMapPreferencesV2 | EFMapPreferencesV3 | EFMapPreferencesV4 | EFMapPreferencesV5; // future union

const KEY = 'efmap:prefs';

// 2025-09-04: Adjust default onboarding transmission volume from 0.65 -> 0.25 (quieter by default).
// Existing users upgrading retain prior stored value (upgrade paths below keep legacy 0.65).
const defaultPrefsV5: EFMapPreferencesV5 = { v:5, accent:'orange', openPanels:[], uiScale:1, showStations:false, overlaySort:'createdAt:-1', overlayAgingDays:3, transmissionSeen:false, transmissionAudioMuted:false, transmissionAudioVolume:0.25 };

export function loadPrefs(): EFMapPreferences {
  try {
    const raw = localStorage.getItem(KEY);
  if(!raw) return { ...defaultPrefsV5 };
    const parsed = JSON.parse(raw);
  if(typeof parsed !== 'object' || parsed === null) return { ...defaultPrefsV5 };
    if(parsed.v === 1){
      // upgrade to v2
      const upgraded: EFMapPreferencesV2 = { ...parsed, v:2, uiScale:1 };
      // continue upgrade chain to v3
  const upgraded3: EFMapPreferencesV3 = { ...upgraded, v:3, overlaySort:'createdAt:-1', overlayAgingDays:3, transmissionSeen:false };
      // upgrade to v4
      const upgraded4: EFMapPreferencesV4 = { ...upgraded3, v:4, transmissionAudioMuted:false };
  const upgraded5: EFMapPreferencesV5 = { ...upgraded4, v:5, transmissionAudioVolume:0.65 };
  return upgraded5;
    }
    if(parsed.v === 2){
	const upgraded3: EFMapPreferencesV3 = { ...parsed, v:3, overlaySort: parsed.overlaySort || 'createdAt:-1', overlayAgingDays: parsed.overlayAgingDays || 3, transmissionSeen: false };
      const upgraded4: EFMapPreferencesV4 = { ...upgraded3, v:4, transmissionAudioMuted:false };
      const upgraded5: EFMapPreferencesV5 = { ...upgraded4, v:5, transmissionAudioVolume:0.65 };
      return { ...defaultPrefsV5, ...upgraded5 };
    }
    if(parsed.v === 3){
      const upgraded4: EFMapPreferencesV4 = { ...(parsed as EFMapPreferencesV3), v:4, transmissionAudioMuted:false };
      const upgraded5: EFMapPreferencesV5 = { ...upgraded4, v:5, transmissionAudioVolume:0.65 };
      return { ...defaultPrefsV5, ...upgraded5 };
    }
    if(parsed.v === 4){
      const upgraded5: EFMapPreferencesV5 = { ...(parsed as EFMapPreferencesV4), v:5, transmissionAudioVolume: (parsed as any).transmissionAudioVolume ?? 0.65 };
      return { ...defaultPrefsV5, ...upgraded5 };
    }
    if(parsed.v === 5){
      return { ...defaultPrefsV5, ...parsed };
    }
    return { ...defaultPrefsV5 };
  } catch { return { ...defaultPrefsV5 }; }
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
  currentPrefs = { ...defaultPrefsV5 };
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
export function setTransmissionSeen(){ updatePrefs(p=>{ (p as any).transmissionSeen = true; }); }
export function setTransmissionAudioMuted(v:boolean){ updatePrefs(p=>{ (p as any).transmissionAudioMuted = v; }); }
export function setTransmissionAudioVolume(v:number){ updatePrefs(p=>{ (p as any).transmissionAudioVolume = Math.max(0, Math.min(1, v)); }); }

// Flush on visibility change/unload for safety (in case future buffering added)
try {
  window.addEventListener('beforeunload', writeNow);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') writeNow(); });
} catch {/* non-browser env */}

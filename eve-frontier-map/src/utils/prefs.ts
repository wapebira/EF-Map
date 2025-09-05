// Centralized user preference persistence with versioning.
// v8 removes ship dash animation related fields.

export interface EFMapPreferencesV1 { v:1; accent:'orange'|'blue'; openPanels:string[]; lastJumpDistance?:number; optimizeFor?:'fuel'|'jumps'|'explore'; algorithm?:'astar'|'dijkstra' }
export interface EFMapPreferencesV2 extends Omit<EFMapPreferencesV1,'v'> { v:2; uiScale?:number; showStations?:boolean }
export interface EFMapPreferencesV3 extends Omit<EFMapPreferencesV2,'v'> { v:3; overlaySort?:string; overlayAgingDays?:number; transmissionSeen?:boolean }
export interface EFMapPreferencesV4 extends Omit<EFMapPreferencesV3,'v'> { v:4; transmissionAudioMuted?:boolean }
export interface EFMapPreferencesV5 extends Omit<EFMapPreferencesV4,'v'> { v:5; transmissionAudioVolume?:number }
export interface EFMapPreferencesV6 extends Omit<EFMapPreferencesV5,'v'> { v:6; gateGradientSpan?:number; animateShipDashes?:boolean; hoverPrecisionFloor?:number }
export interface EFMapPreferencesV7 extends Omit<EFMapPreferencesV6,'v'> { v:7; animateShipDashSpeed?:number; pulseSpeed?:number; pulseHeadSize?:number; pulseTailSize?:number; pulseWidth?:number }
export interface EFMapPreferencesV8 extends Omit<EFMapPreferencesV7,'v'|'animateShipDashSpeed'|'animateShipDashes'> { v:8; }
export interface EFMapPreferencesV9 extends Omit<EFMapPreferencesV8,'v'> { v:9; showShipDash?:boolean }
export interface EFMapPreferencesV10 extends Omit<EFMapPreferencesV9,'v'> { v:10; pulseBrightness?:number; starSizeScale?:number }
export interface EFMapPreferencesV11 extends Omit<EFMapPreferencesV10,'v'> { v:11; routeThickness?:number }

export type EFMapPreferences = EFMapPreferencesV1|EFMapPreferencesV2|EFMapPreferencesV3|EFMapPreferencesV4|EFMapPreferencesV5|EFMapPreferencesV6|EFMapPreferencesV7|EFMapPreferencesV8|EFMapPreferencesV9|EFMapPreferencesV10|EFMapPreferencesV11;

const KEY='efmap:prefs';
const defaultPrefsV11: EFMapPreferencesV11 = { v:11, accent:'orange', openPanels:[], uiScale:1, showStations:false, overlaySort:'createdAt:-1', overlayAgingDays:3, transmissionSeen:false, transmissionAudioMuted:false, transmissionAudioVolume:0.25, gateGradientSpan:0.66, hoverPrecisionFloor:0.12, pulseSpeed:1.0, pulseHeadSize:0.25, pulseTailSize:0.65, pulseWidth:0.15, showShipDash:true, pulseBrightness:1.0, starSizeScale:1.0, routeThickness:1.0 };

export function loadPrefs(): EFMapPreferences {
  try {
  const raw = localStorage.getItem(KEY); if(!raw) return { ...defaultPrefsV11 };
  const parsed = JSON.parse(raw); if(typeof parsed !== 'object' || parsed === null) return { ...defaultPrefsV11 };
  const upgradeTo8 = (base:any): EFMapPreferencesV8 => ({ ...defaultPrefsV11, ...base, v:8 });
  const upgradeTo9 = (base:any): EFMapPreferencesV9 => ({ ...defaultPrefsV11, ...base, v:9, showShipDash: base.showShipDash !== false });
  const upgradeTo10 = (base:any): EFMapPreferencesV10 => ({ ...defaultPrefsV11, ...base, v:10, pulseBrightness: base.pulseBrightness ?? 1.0, starSizeScale: base.starSizeScale ?? 1.0 });
  const upgradeTo11 = (base:any): EFMapPreferencesV11 => ({ ...defaultPrefsV11, ...base, v:11, routeThickness: base.routeThickness ?? 1.0 });
    switch(parsed.v){
      case 1:{ const v2:EFMapPreferencesV2={...parsed,v:2,uiScale:1}; const v3:EFMapPreferencesV3={...v2,v:3,overlaySort:'createdAt:-1',overlayAgingDays:3,transmissionSeen:false}; const v4:EFMapPreferencesV4={...v3,v:4,transmissionAudioMuted:false}; const v5:EFMapPreferencesV5={...v4,v:5,transmissionAudioVolume:0.65}; const v6:EFMapPreferencesV6={...v5,v:6,gateGradientSpan:0.66,animateShipDashes:false,hoverPrecisionFloor:0.12}; const v7:EFMapPreferencesV7={...v6,v:7,animateShipDashSpeed:1.0,pulseSpeed:1.0,pulseHeadSize:0.25,pulseTailSize:0.65,pulseWidth:0.15}; return upgradeTo8(v7);} 
      case 2:{ const v3:EFMapPreferencesV3={...parsed,v:3,overlaySort:parsed.overlaySort||'createdAt:-1',overlayAgingDays:parsed.overlayAgingDays||3,transmissionSeen:false}; const v4:EFMapPreferencesV4={...v3,v:4,transmissionAudioMuted:false}; const v5:EFMapPreferencesV5={...v4,v:5,transmissionAudioVolume:0.65}; const v6:EFMapPreferencesV6={...v5,v:6,gateGradientSpan:0.66,animateShipDashes:false,hoverPrecisionFloor:0.12}; const v7:EFMapPreferencesV7={...v6,v:7,animateShipDashSpeed:1.0,pulseSpeed:1.0,pulseHeadSize:0.25,pulseTailSize:0.65,pulseWidth:0.15}; return upgradeTo8(v7);} 
      case 3:{ const v4:EFMapPreferencesV4={...parsed,v:4,transmissionAudioMuted:false}; const v5:EFMapPreferencesV5={...v4,v:5,transmissionAudioVolume:0.65}; const v6:EFMapPreferencesV6={...v5,v:6,gateGradientSpan:0.66,animateShipDashes:false,hoverPrecisionFloor:0.12}; const v7:EFMapPreferencesV7={...v6,v:7,animateShipDashSpeed:1.0,pulseSpeed:1.0,pulseHeadSize:0.25,pulseTailSize:0.65,pulseWidth:0.15}; return upgradeTo8(v7);} 
      case 4:{ const v5:EFMapPreferencesV5={...parsed,v:5,transmissionAudioVolume:(parsed as any).transmissionAudioVolume ?? 0.65}; const v6:EFMapPreferencesV6={...v5,v:6,gateGradientSpan:0.66,animateShipDashes:false,hoverPrecisionFloor:0.12}; const v7:EFMapPreferencesV7={...v6,v:7,animateShipDashSpeed:1.0,pulseSpeed:1.0,pulseHeadSize:0.25,pulseTailSize:0.65,pulseWidth:0.15}; return upgradeTo8(v7);} 
      case 5:{ const v6:EFMapPreferencesV6={...parsed,v:6,gateGradientSpan:(parsed as any).gateGradientSpan??0.66,animateShipDashes:(parsed as any).animateShipDashes??false,hoverPrecisionFloor:(parsed as any).hoverPrecisionFloor??0.12}; const v7:EFMapPreferencesV7={...v6,v:7,animateShipDashSpeed:1.0,pulseSpeed:1.0,pulseHeadSize:0.25,pulseTailSize:0.65,pulseWidth:0.15}; return upgradeTo8(v7);} 
      case 6:{ const v7:EFMapPreferencesV7={...parsed,v:7,animateShipDashSpeed:1.0,pulseSpeed:1.0,pulseHeadSize:0.25,pulseTailSize:0.65,pulseWidth:0.15}; return upgradeTo8(v7);} 
      case 7:{ return upgradeTo8(parsed); }
  case 8:{ return upgradeTo11(upgradeTo10(upgradeTo9(parsed))); }
  case 9:{ return upgradeTo11(upgradeTo10(parsed)); }
  case 10:{ return upgradeTo11(parsed); }
  case 11:{ return { ...defaultPrefsV11, ...parsed }; }
  default: return { ...defaultPrefsV11 };
    }
  } catch { return { ...defaultPrefsV11 }; }
}

let currentPrefs: EFMapPreferences = loadPrefs();
function writeNow(){ try { localStorage.setItem(KEY, JSON.stringify(currentPrefs)); } catch {} }
export function getPrefs(){ return currentPrefs; }
export function updatePrefs(mut:(draft:EFMapPreferences)=>void){ const draft={ ...currentPrefs } as EFMapPreferences; mut(draft); currentPrefs=draft; writeNow(); }
export function resetAllPrefs(){ currentPrefs={ ...defaultPrefsV11 }; try{ localStorage.removeItem(KEY);}catch{} }
export function setAccent(accent:'orange'|'blue'){ updatePrefs(p=>{ (p as any).accent=accent; }); }
export function setOpenPanels(ids:string[]){ updatePrefs(p=>{ (p as any).openPanels=ids.slice(0); }); }
export function setLastJumpDistance(d:number){ updatePrefs(p=>{ (p as any).lastJumpDistance=d; }); }
export function setRoutingPrefs(jump:number,optimize:'fuel'|'jumps'|'explore',algorithm:'astar'|'dijkstra'){ updatePrefs(p=>{ (p as any).lastJumpDistance=jump; (p as any).optimizeFor=optimize; (p as any).algorithm=algorithm; }); }
export function clearPanelPositions(){ try { const rm:string[]=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.startsWith('panel-pos:')) rm.push(k);} rm.forEach(k=> localStorage.removeItem(k)); } catch{} }
export function fullReset(){ resetAllPrefs(); clearPanelPositions(); }
export function softReset(){ resetAllPrefs(); }
export function setUiScale(v:number){ updatePrefs(p=>{ (p as any).uiScale=v; }); }
export function setShowStations(v:boolean){ updatePrefs(p=>{ (p as any).showStations=v; }); }
export function setOverlaySort(v:string){ updatePrefs(p=>{ (p as any).overlaySort=v; }); }
export function setOverlayAgingDays(v:number){ updatePrefs(p=>{ (p as any).overlayAgingDays=v; }); }
export function setTransmissionSeen(){ updatePrefs(p=>{ (p as any).transmissionSeen=true; }); }
export function setTransmissionAudioMuted(v:boolean){ updatePrefs(p=>{ (p as any).transmissionAudioMuted=v; }); }
export function setTransmissionAudioVolume(v:number){ updatePrefs(p=>{ (p as any).transmissionAudioVolume=Math.max(0,Math.min(1,v)); }); }
export function setGateGradientSpan(v:number){ updatePrefs(p=>{ (p as any).gateGradientSpan=Math.max(0,Math.min(1,v)); }); }
export function setHoverPrecisionFloor(v:number){ updatePrefs(p=>{ (p as any).hoverPrecisionFloor=Math.max(0.08,Math.min(0.2,v)); }); }
export function setPulseSpeed(v:number){ updatePrefs(p=>{ (p as any).pulseSpeed=Math.max(0,Math.min(3,v)); }); }
export function setPulseHeadSize(v:number){ updatePrefs(p=>{ (p as any).pulseHeadSize=Math.max(0.05,Math.min(0.6,v)); }); }
export function setPulseTailSize(v:number){ updatePrefs(p=>{ (p as any).pulseTailSize=Math.max(0.1,Math.min(1.0,v)); }); }
export function setPulseWidth(v:number){ updatePrefs(p=>{ (p as any).pulseWidth=Math.max(0.05,Math.min(0.4,v)); }); }
export function setShowShipDash(v:boolean){ updatePrefs(p=>{ (p as any).showShipDash=!!v; }); }
export function setPulseBrightness(v:number){ updatePrefs(p=>{ (p as any).pulseBrightness=Math.max(0.2,Math.min(3.0,v)); }); }
export function setStarSizeScale(v:number){ updatePrefs(p=>{ (p as any).starSizeScale=Math.max(0.5,Math.min(1.5,v)); }); }
export function setRouteThickness(v:number){ updatePrefs(p=>{ (p as any).routeThickness=Math.max(0.5,Math.min(2.0,v)); }); }
try { window.addEventListener('beforeunload', writeNow); document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') writeNow(); }); } catch {}

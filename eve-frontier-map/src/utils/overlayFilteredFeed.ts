// Filtered overlay feed publisher/subscriber
// Allows map rendering modules to display only the currently active folder's marks.
// Personal entries: { type:'personal', systemId:number, color:string }
// Tribe entries: { type:'tribe', systemId:number, color:string }

export interface FilteredOverlayItem { type:'personal'|'tribe'; systemId:number; color:string }

type Listener = (items: FilteredOverlayItem[]) => void;

let current: FilteredOverlayItem[] = [];
const listeners = new Set<Listener>();

export function publishFilteredOverlay(items: FilteredOverlayItem[]){
  current = items.slice();
  listeners.forEach(l=> { try { l(current); } catch {} });
}

export function getFilteredOverlay(){ return current.slice(); }

export function subscribeFilteredOverlay(cb: Listener){ listeners.add(cb); try { cb(current); } catch {} ; return ()=> listeners.delete(cb); }

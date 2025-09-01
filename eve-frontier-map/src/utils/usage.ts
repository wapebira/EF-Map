// Lightweight anonymous usage event dispatcher.
// Only sends whitelisted aggregate events; no PII.

interface UsageEventBase { type: string; [k:string]: any }

const QUEUE: UsageEventBase[] = [];
let flushTimer: any = null;
const FLUSH_INTERVAL = 5000; // batch every 5s
const MAX_BATCH = 12;

function scheduleFlush(){
  if(flushTimer) return;
  flushTimer = setTimeout(()=>{ flushTimer = null; flush(); }, FLUSH_INTERVAL);
}

async function flush(){
  if(!QUEUE.length) return;
  const batch = QUEUE.splice(0, MAX_BATCH);
  // send sequentially (functions are cheap) to keep server logic simple
  for(const evt of batch){
    try {
      const res = await fetch('/.netlify/functions/usage-event', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(evt) });
      if(!res.ok && typeof window !== 'undefined'){
        // Development aid: log unknown event types or errors (non-intrusive)
        if(res.status === 400){
          console.warn('[usage] event rejected', evt.type);
        } else {
          console.warn('[usage] event failed', evt.type, res.status);
        }
      }
    } catch(e) { /* ignore network errors silently */ }
  }
  if(QUEUE.length) scheduleFlush();
}

const MAX_ACTIVE_GAP = 5 * 60 * 1000; // 5 minutes inactivity cap per gap

function noteActivity(){
  try {
    if(typeof performance === 'undefined') return;
    const now = performance.now();
    const w:any = window as any;
    // Legacy simple last-activity timestamp retained (not used for final calc now)
    w.___efLastAct = now;
    // Segmented active time accumulation:
    if(w.___efActLastEvt === undefined){
      w.___efActLastEvt = now; // first event
      w.___efActAccum = 0;
    } else {
      const gap = now - w.___efActLastEvt;
      // Add capped gap to accumulated active time
      if(gap > 0){
        const add = gap > MAX_ACTIVE_GAP ? MAX_ACTIVE_GAP : gap;
        w.___efActAccum = (w.___efActAccum||0) + add;
        w.___efActLastEvt = now;
      }
    }
  } catch {/* ignore */}
}

export function track(evt: UsageEventBase){
  QUEUE.push(evt);
  noteActivity();
  if(QUEUE.length >= MAX_BATCH) flush(); else scheduleFlush();
}

// Force immediate flush (used for critical end-of-session metrics)
export async function flushNow(){
  try { await flush(); } catch { /* ignore */ }
}

// Send a single critical event immediately; falls back to queued if network fails
export async function trackImmediate(evt: UsageEventBase){
  try {
    const res = await fetch('/.netlify/functions/usage-event', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(evt) });
    if(!res.ok){
      track(evt); // fallback enqueue
    } else {
      noteActivity();
    }
  } catch {
    track(evt);
  }
}

// Page visibility flush for best-effort delivery
if(typeof window !== 'undefined'){
  let sessionStart = performance.now();
  let cinematicActive = false;
  let cinematicAccum = 0; // ms
  let cinematicLastStart = 0;
  let dbLoadMarked = false; // set by App when map ready
  let firstActionSent = false; // first core action (p2p route or scout baseline)
  let firstRouteStart: number|undefined; // time from page load to first route/baseline

  // Mark page load
  try { track({ type:'page_load' }); } catch {}
  // We'll store last activity on window to share with track()/trackImmediate
  (window as any).___efLastAct = sessionStart;
  // Initialize segmented active timing state
  (window as any).___efActLastEvt = sessionStart; (window as any).___efActAccum = 0;

  // Expose helpers for new metrics
  (window as any).__efMarkDbLoaded = ()=>{
    if(dbLoadMarked) return; dbLoadMarked = true;
    const ms = performance.now() - sessionStart;
    try { track({ type:'db_load_time', ms }); } catch {}
  };
  (window as any).__efMarkFirstAction = (source:'p2p'|'scout')=>{
    if(firstActionSent) return; firstActionSent = true;
    try { track({ type:'first_action', source }); } catch {}
    if(firstRouteStart!==undefined){
      const ms = firstRouteStart - sessionStart; if(ms>=0) try { track({ type:'first_route_delay', ms }); } catch {}
    }
  };
  (window as any).__efSetThemeAccent = (newTheme:'blue'|'orange')=>{
    try { track({ type: newTheme==='blue' ? 'theme_blue':'theme_orange' }); } catch {}
    // switching after first theme event counts as a theme_switch
    const w:any = window as any;
    if(!w.___efInitialTheme){ w.___efInitialTheme = newTheme; }
    else if(w.___efInitialTheme !== newTheme){ try { track({ type:'theme_switch' }); } catch {} w.___efInitialTheme = newTheme; }
  };
  (window as any).__efTrackP2PRouteMeta = (algo:'astar'|'dijkstra', mode:'fuel'|'jumps', hops:number, waypoints:number)=>{
    try { track({ type:'p2p_route' }); } catch {}
    try { track({ type:'p2p_algo', algo }); } catch {}
    try { track({ type:'p2p_opt_mode', mode }); } catch {}
    const hb = hops<10? 'hops_lt_10' : hops<30? 'hops_10_30' : hops<60? 'hops_30_60' : 'hops_gt_60';
    try { track({ type:'p2p_hops_bucket', bucket: hb }); } catch {}
    const wb = waypoints===0? 'wp_0' : waypoints<=2? 'wp_1_2' : waypoints<=5? 'wp_3_5' : 'wp_6_plus';
    try { track({ type:'waypoint_count_bucket', bucket: wb }); } catch {}
    if(!firstActionSent){ firstRouteStart = performance.now(); }
  };
  (window as any).__efTrackP2PCancelled = ()=>{ try { track({ type:'p2p_cancelled' }); } catch {}; };
  (window as any).__efTrackScoutWorkers = (count:number)=>{ try { track({ type:'opt_workers_used', count }); } catch {}; };
  (window as any).__efTrackSavingsBucket = (saved:number)=>{ let b = saved<5? 'save_lt_5' : saved<20? 'save_5_20' : saved<50? 'save_20_50' : 'save_gt_50'; try { track({ type:'scout_opt_savings_bucket', bucket:b }); } catch {}; };
  (window as any).__efTrackPlanetBins = (activeBins:number)=>{ let b = activeBins===5? 'bins_5' : activeBins>=3? 'bins_3_4' : activeBins>=1? 'bins_1_2' : 'bins_0'; try { track({ type:'planet_bins_active_bucket', bucket:b }); } catch {}; };
  (window as any).__efTrackDonateModalOpen = ()=>{ try { track({ type:'donate_modal_open' }); } catch {} };
  (window as any).__efTrackDonateClick = (kind:'stripe'|'crypto')=>{ try { track({ type: kind==='stripe' ? 'donate_stripe_click':'donate_crypto_click' }); } catch {} };

  function endCinematicIfActive(){
    if(cinematicActive){
      const delta = performance.now() - cinematicLastStart;
      if(delta>0) cinematicAccum += delta;
      cinematicActive = false;
    }
  }

  // Expose lightweight global helpers the app can call on mode toggles
  (window as any).__efSetCinematic = (on:boolean)=>{
    if(on){
      if(!cinematicActive){
        cinematicActive = true; cinematicLastStart = performance.now();
        // First entry in a session? fire cinematic_first once.
        if(!(window as any).__efCinFirst){ (window as any).__efCinFirst = true; try { track({ type:'cinematic_first' }); } catch {} }
        try { track({ type:'cinematic_enter' }); } catch {}
      }
    } else {
      endCinematicIfActive();
    }
  };

  // Update last activity timestamp for active session duration approximation
  try { if(typeof performance !== 'undefined') (window as any).___efLastAct = performance.now(); } catch {}
  async function finalizeSession(){
    try {
      endCinematicIfActive();
      const sessionMs = Math.max(0, performance.now() - sessionStart);
      if(sessionMs>0) track({ type:'session_time', ms: Math.round(sessionMs) });
  // Active time (segmented): accumulated capped gaps + final gap (capped)
  const w:any = window as any;
  let activeAccum = w.___efActAccum || 0;
  const lastEvt = w.___efActLastEvt || sessionStart;
  const finalGap = performance.now() - lastEvt;
  if(finalGap > 0){ activeAccum += finalGap > MAX_ACTIVE_GAP ? MAX_ACTIVE_GAP : finalGap; }
  if(activeAccum>0){ track({ type:'active_session_time', ms: Math.round(Math.min(activeAccum, sessionMs)) }); }
  // Bucket event (based on total session length)
  let bucket='';
  if(sessionMs < 60_000) bucket='sess_lt_1m';
  else if(sessionMs < 5*60_000) bucket='sess_1_5m';
  else if(sessionMs < 15*60_000) bucket='sess_5_15m';
  else if(sessionMs < 60*60_000) bucket='sess_15_60m';
  else bucket='sess_gt_60m';
  track({ type:'session_bucket', bucket });
  if(cinematicAccum>0) track({ type:'cinematic_time', ms: Math.round(cinematicAccum) });
      await flush();
    } catch {}
  }

  const handler = () => { finalizeSession(); };
  window.addEventListener('beforeunload', handler);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') handler(); });
}

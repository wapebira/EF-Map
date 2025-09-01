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

export function track(evt: UsageEventBase){
  QUEUE.push(evt);
  try { if(typeof performance !== 'undefined') { /* update last activity */ (window as any).___efLastAct = performance.now(); } } catch {}
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
      // enqueue fallback to try later
      track(evt);
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

  // Mark page load
  try { track({ type:'page_load' }); } catch {}
  let lastActivity = sessionStart; // Initialize last activity timestamp

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
  try { if(typeof performance !== 'undefined') lastActivity = performance.now(); } catch {}
  async function finalizeSession(){
    try {
      endCinematicIfActive();
      const sessionMs = Math.max(0, performance.now() - sessionStart);
      if(sessionMs>0) track({ type:'session_time', ms: Math.round(sessionMs) });
  // Active time = time between start and last tracked user event; bounded by total session
  const activeMsRaw = Math.max(0, Math.min(lastActivity - sessionStart, sessionMs));
  if(activeMsRaw>0) track({ type:'active_session_time', ms: Math.round(activeMsRaw) });
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

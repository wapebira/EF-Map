// Lightweight anonymous usage event dispatcher.
// Only sends whitelisted aggregate events; no PII.

interface UsageEventBase { type: string; [k:string]: any }

const QUEUE: UsageEventBase[] = [];
let flushTimer: any = null;
const FLUSH_INTERVAL = 5000; // batch every 5s
const MAX_BATCH = 12;
// Dev safeguard: if functions endpoint returns 404 (local vite without Netlify functions)
// we disable further network attempts to avoid spamming console.
let disabledDueToMissingEndpoint = false;

function scheduleFlush(){
  if(flushTimer || disabledDueToMissingEndpoint) return;
  flushTimer = setTimeout(()=>{ flushTimer = null; flush(); }, FLUSH_INTERVAL);
}

async function flush(){
  if(disabledDueToMissingEndpoint){ QUEUE.length = 0; return; }
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
          if(res.status === 404){
            disabledDueToMissingEndpoint = true;
            console.warn('[usage] disabling usage tracking (endpoint 404).');
            QUEUE.length = 0;
            break;
          }
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
  if(disabledDueToMissingEndpoint) return;
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
  if(disabledDueToMissingEndpoint){ return; }
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
  // --- Overlay panel metrics ---
  let overlayOpen = false;
  let overlayFirstOpenSent = false;
  let overlayFirstAddSent = false;
  let overlayOpenStart = 0; // perf.now when last opened/resumed
  let overlayAccum = 0; // ms accumulated (excludes cinematic periods)
  let overlayMarksSnapshot = 0; // last bucketed count to avoid spam
  // --- Transmission metrics ---
  let txOpen = false; // panel visible
  let txIntroComplete = false; // intro finished (echo phase active)
  let txOpenStart = 0; // perf.now when (re)opened
  let txEchoStart = 0; // perf.now when echo phase began
  let txOpenAccum = 0; // accumulated open time ms
  let txEchoAccum = 0; // accumulated echo time ms
  let txReplayFirstSent = false;
  let txFastForwardFirstSent = false;
  let txEchoMsgCount = 0; // number of echo messages appended
  // Track whether panel closed before intro finished (early close)
  let txEarlyClose = false;
  // Helpers exposed to TransmissionPanel via global
  function txEnsureOpen(){
    if(!txOpen){ txOpen = true; txOpenStart = performance.now(); }
  }
  function txPause(){
    if(!txOpen) return;
    const now = performance.now();
    const delta = now - txOpenStart;
    if(delta>0) txOpenAccum += delta;
    if(txIntroComplete){
      const echoDelta = now - txEchoStart;
      if(echoDelta>0) txEchoAccum += echoDelta;
      txEchoStart = now; // reset baseline
    }
    txOpenStart = now; // maintain baseline for potential resume calculations
  }
  (window as any).__efTxShow = () => { try { txEnsureOpen(); track({ type:'transmission_show' }); } catch {} };
  (window as any).__efTxIntroComplete = () => { try {
    if(!txIntroComplete){
      txIntroComplete = true;
      // start echo phase timing baseline
      txEchoStart = performance.now();
      track({ type:'transmission_complete' });
    }
  } catch {} };
  (window as any).__efTxReplay = () => { try { track({ type:'transmission_replay' }); if(!txReplayFirstSent){ txReplayFirstSent = true; track({ type:'transmission_replay_first' }); } } catch {} };
  (window as any).__efTxFastForward = () => { try { track({ type:'transmission_fastforward' }); if(!txFastForwardFirstSent){ txFastForwardFirstSent = true; track({ type:'transmission_fastforward_first' }); } } catch {} };
  (window as any).__efTxDismiss = () => { try {
    if(!txOpen) return;
    // accumulate through close
    txPause();
    txOpen = false;
    if(!txIntroComplete){ txEarlyClose = true; }
    track({ type:'transmission_close' });
    if(txEarlyClose) track({ type:'transmission_close_early' });
  } catch {} };
  (window as any).__efTxEchoMessage = () => { try { txEchoMsgCount++; track({ type:'transmission_echo_msg' }); } catch {} };
  (window as any).__efTxPause = () => { try { txPause(); } catch {} };
  (window as any).__efTxResume = () => { try { txEnsureOpen(); if(txIntroComplete) txEchoStart = performance.now(); } catch {} };

  function txEchoMsgBucket(count:number){
    if(count===0) return 'echo_0';
    if(count<=5) return 'echo_1_5';
    if(count<=15) return 'echo_6_15';
    if(count<=30) return 'echo_16_30';
    return 'echo_gt_30';
  }
  function txOpenShareBucket(openMs:number, sessionMs:number){
    if(sessionMs<=0 || openMs<=0) return 'tx_share_0';
    const pct = (openMs/sessionMs)*100;
    if(pct < 10) return 'tx_share_lt_10';
    if(pct < 30) return 'tx_share_10_30';
    if(pct < 60) return 'tx_share_30_60';
    return 'tx_share_gt_60';
  }

  function overlayBucket(count:number){
    if(count<=0) return 'marks_0';
    if(count<=5) return 'marks_1_5';
    if(count<=15) return 'marks_6_15';
    if(count<=30) return 'marks_16_30';
    if(count<=60) return 'marks_31_60';
    return 'marks_61_plus';
  }

  function overlayPause(){
    if(!overlayOpen) return;
    const now = performance.now();
    const delta = now - overlayOpenStart;
    if(delta>0) overlayAccum += delta;
    overlayOpenStart = now; // so repeated pause without resume minimal impact
  }

  (window as any).__efOverlayOpened = (markCount:number)=>{
    try {
      if(!overlayOpen){
        overlayOpen = true; overlayOpenStart = performance.now();
        track({ type:'overlay_open' });
        if(!overlayFirstOpenSent){ overlayFirstOpenSent = true; track({ type:'overlay_open_first' }); }
        // bucket mark count
        const bucket = overlayBucket(markCount);
        overlayMarksSnapshot = markCount;
        track({ type:'overlay_marks_count_bucket', bucket });
      }
    } catch {/* ignore */}
  };
  (window as any).__efOverlayClosed = ()=>{
    try {
      if(overlayOpen){ overlayPause(); overlayOpen = false; }
    } catch {/* ignore */}
  };
  (window as any).__efOverlayMarkAdded = (total:number)=>{
    try {
      track({ type:'overlay_add_mark' });
      if(!overlayFirstAddSent){ overlayFirstAddSent = true; track({ type:'overlay_add_first' }); }
      // Re-bucket only if crossing bucket boundary
      const bucket = overlayBucket(total);
      const prevBucket = overlayBucket(overlayMarksSnapshot);
      if(bucket !== prevBucket){ track({ type:'overlay_marks_count_bucket', bucket }); }
      overlayMarksSnapshot = total;
    } catch {/* ignore */}
  };
  (window as any).__efOverlayExport = ()=>{ try { track({ type:'overlay_export' }); } catch {} };
  (window as any).__efOverlayImport = (finalCount:number)=>{ try { track({ type:'overlay_import' }); const bucket = overlayBucket(finalCount); overlayMarksSnapshot = finalCount; track({ type:'overlay_marks_count_bucket', bucket }); } catch {} };

  // Pause overlay panel accumulation during cinematic mode transitions

  // Mark page load
  try { track({ type:'page_load' }); } catch {}
  // Capture coarse screen width (approx monitor resolution class) & CPU core buckets once per session
  try {
    const w = Math.max(window.innerWidth || 0, screen?.width || 0);
    let bucket = '';
    if(w <= 1280) bucket = 'res_720p'; // ≤1280 wide ≈ 720p class
    else if(w <= 1920) bucket = 'res_1080p'; // 1281–1920
    else if(w <= 2560) bucket = 'res_1440p'; // 1921–2560 (covers 1440p typical 2560x1440)
    else bucket = 'res_4k_plus'; // >2560 (includes 4K and ultrawide above 2560 width)
    if(bucket) track({ type:'screen_res_bucket', bucket });
  } catch { /* ignore */ }
  try {
    const cores = (navigator as any).hardwareConcurrency;
    if(typeof cores === 'number' && cores > 0){
      let cbucket='';
      if(cores <= 2) cbucket='cores_1_2';
      else if(cores <= 4) cbucket='cores_3_4';
      else if(cores <= 8) cbucket='cores_5_8';
      else if(cores <= 12) cbucket='cores_9_12';
      else if(cores <= 16) cbucket='cores_13_16';
      else cbucket='cores_17_plus';
      track({ type:'cpu_cores_bucket', bucket: cbucket });
    }
  } catch { /* ignore */ }
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
  (window as any).__efMarkFirstRouteStarted = ()=>{
    // Capture earliest start timestamp if not set
    if(firstRouteStart===undefined){ firstRouteStart = performance.now(); }
  };
  (window as any).__efTrackP2PRouteMeta = (algo:'astar'|'dijkstra', mode:'fuel'|'jumps', hops:number, waypoints:number)=>{
    try { track({ type:'p2p_route' }); } catch {}
    try { track({ type:'p2p_algo', algo }); } catch {}
    try { track({ type:'p2p_opt_mode', mode }); } catch {}
    const hb = hops<10? 'hops_lt_10' : hops<30? 'hops_10_30' : hops<60? 'hops_30_60' : 'hops_gt_60';
    try { track({ type:'p2p_hops_bucket', bucket: hb }); } catch {}
    const wb = waypoints===0? 'wp_0' : waypoints<=2? 'wp_1_2' : waypoints<=5? 'wp_3_5' : 'wp_6_plus';
    try { track({ type:'waypoint_count_bucket', bucket: wb }); } catch {}
  // First route start moved earlier via __efMarkFirstRouteStarted
  };
  (window as any).__efTrackP2PCancelled = ()=>{ try { track({ type:'p2p_cancelled' }); } catch {}; };
  (window as any).__efTrackScoutWorkers = (count:number)=>{ try { track({ type:'opt_workers_used', count }); } catch {}; };
  (window as any).__efTrackSavingsBucket = (saved:number)=>{ let b = saved<50? 'save_0_50' : saved<100? 'save_50_100' : saved<200? 'save_100_200' : 'save_gt_200'; try { track({ type:'scout_opt_savings_bucket', bucket:b }); } catch {}; };
  (window as any).__efTrackPlanetBins = (activeBins:number)=>{ let b = activeBins===5? 'bins_5' : activeBins>=3? 'bins_3_4' : activeBins>=1? 'bins_1_2' : 'bins_0'; try { track({ type:'planet_bins_active_bucket', bucket:b }); } catch {}; };
  (window as any).__efTrackDonateModalOpen = ()=>{ try { track({ type:'donate_modal_open' }); } catch {} };
  (window as any).__efTrackDonateClick = (kind:'stripe'|'crypto')=>{ try { track({ type: kind==='stripe' ? 'donate_stripe_click':'donate_crypto_click' }); } catch {} };
  (window as any).__efTrackRegionStatsView = ()=>{ try { track({ type:'region_stats_view' }); } catch {} };

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
        // also pause overlay accumulation if panel open
        overlayPause();
        // First entry in a session? fire cinematic_first once.
        if(!(window as any).__efCinFirst){ (window as any).__efCinFirst = true; try { track({ type:'cinematic_first' }); } catch {} }
        try { track({ type:'cinematic_enter' }); } catch {}
      }
    } else {
      endCinematicIfActive();
      // resume overlay timing if panel still open
      if(overlayOpen){ overlayOpenStart = performance.now(); }
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
  // Flush overlay panel time if any
  if(overlayOpen){ overlayPause(); }
  if(overlayAccum>0){ track({ type:'overlay_panel_time', ms: Math.round(overlayAccum) }); }
  // Transmission finalize: accumulate open time through final visibility state
  if(txOpen){ txPause(); }
  if(txOpenAccum>0){ track({ type:'transmission_open_time', ms: Math.round(txOpenAccum) }); }
  if(txEchoAccum>0){ track({ type:'transmission_echo_time', ms: Math.round(txEchoAccum) }); }
  // Buckets (echo messages & open share)
  const echoBucket = txEchoMsgBucket(txEchoMsgCount); track({ type:'transmission_echo_msgs_bucket', bucket: echoBucket });
  const shareBucket = txOpenShareBucket(txOpenAccum, sessionMs); track({ type:'transmission_open_share_bucket', bucket: shareBucket });
      await flush();
    } catch {}
  }

  const handler = () => { finalizeSession(); };
  window.addEventListener('beforeunload', handler);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') handler(); });
  // Expose manual re-enable for debugging if Netlify functions started after load
  ;(window as any).__efEnableUsageTracking = () => { disabledDueToMissingEndpoint = false; console.info('[usage] manual re-enable invoked'); scheduleFlush(); };
}

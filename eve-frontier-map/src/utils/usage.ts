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
      await fetch('/.netlify/functions/usage-event', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(evt) });
    } catch { /* ignore */ }
  }
  if(QUEUE.length) scheduleFlush();
}

export function track(evt: UsageEventBase){
  QUEUE.push(evt);
  if(QUEUE.length >= MAX_BATCH) flush(); else scheduleFlush();
}

// Page visibility flush for best-effort delivery
if(typeof window !== 'undefined'){
  const handler = () => { try { flush(); } catch{} };
  window.addEventListener('beforeunload', handler);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') handler(); });
}

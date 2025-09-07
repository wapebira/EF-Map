// Utilities to create and resolve short share URLs (Cloudflare only after cutover).
// Netlify fallbacks removed – /api/* endpoints must be active.

let shareBaseCreate: string | null = null;
let shareBaseGet: string | null = null;
let detecting = false;

async function detectShareEndpoints(){
  if(detecting || (shareBaseCreate && shareBaseGet)) return;
  detecting = true;
  const cands = [ { create:'/api/create-share', get:'/api/get-share' } ];
  for(const c of cands){
    try {
  const res = await fetch(c.create, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ ping:true }) });
  // Some misconfigured endpoints (e.g. static HTML fallback) return 200 with text/html – treat as failure
  const ct = res.headers.get('content-type')||'';
  if((res.ok || res.status===400) && !ct.includes('text/html')){ shareBaseCreate = c.create; shareBaseGet = c.get; break; }
    } catch { /* ignore */ }
  }
  if(!shareBaseCreate){
    console.error('[share] /api/create-share unavailable (HTML or network error).');
  }
  detecting = false;
}

export async function createShortShare(encoded: string): Promise<string> {
  if(!shareBaseCreate) await detectShareEndpoints();
  if(!shareBaseCreate) throw new Error('Share endpoint unavailable');
  const res = await fetch(shareBaseCreate, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: encoded }) });
  if (!res.ok){
    try {
      if(res.headers.get('content-type')?.includes('application/json')){
        const errJson = await res.json();
        console.warn('[share] create failed', res.status, errJson);
        throw new Error(`Create failed ${res.status}${errJson?.error?': '+errJson.error:''}`);
      }
    } catch {/* ignore parse */}
    throw new Error(`Create failed ${res.status}`);
  }
  const ct = res.headers.get('content-type')||'';
  if(ct.includes('text/html')) throw new Error('Invalid HTML response for create-share');
  const json = await res.json();
  if (!json.id) throw new Error('No id returned');
  return json.id as string;
}

export async function fetchShortShare(id: string): Promise<string | null> {
  if(!shareBaseGet) await detectShareEndpoints();
  if(!shareBaseGet) throw new Error('Share get endpoint unavailable');
  const res = await fetch(shareBaseGet + `?id=${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const ct = res.headers.get('content-type')||'';
  if(ct.includes('text/html')) throw new Error('Invalid HTML response for get-share');
  const json = await res.json();
  return json.data as string;
}

// Helper to build short redirect URL (client side) always using /s/<id>
export function buildShortRedirectUrl(id:string){
  if(typeof window==='undefined') return `/s/${id}`;
  return `${window.location.origin}/s/${id}`;
}

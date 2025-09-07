// Utilities to create and resolve short share URLs supporting both Netlify and Cloudflare Pages.
// Detection: prefer /api/* endpoints; fallback to /.netlify/functions/*.

let shareBaseCreate: string | null = null;
let shareBaseGet: string | null = null;
let detecting = false;

async function detectShareEndpoints(){
  if(detecting || (shareBaseCreate && shareBaseGet)) return;
  detecting = true;
  const cands = [
    { create:'/api/create-share', get:'/api/get-share' },
    { create:'/.netlify/functions/create-share', get:'/.netlify/functions/get-share' }
  ];
  for(const c of cands){
    try {
      const res = await fetch(c.create, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ ping:true }) });
      if(res.ok || res.status===400){ shareBaseCreate = c.create; shareBaseGet = c.get; break; }
    } catch { /* ignore */ }
  }
  if(!shareBaseCreate){ // final fallback
    shareBaseCreate = '/.netlify/functions/create-share';
    shareBaseGet = '/.netlify/functions/get-share';
  }
  detecting = false;
}

export async function createShortShare(encoded: string): Promise<string> {
  if(!shareBaseCreate) await detectShareEndpoints();
  const url = shareBaseCreate || '/.netlify/functions/create-share';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: encoded }) });
  if (!res.ok) throw new Error(`Create failed ${res.status}`);
  const json = await res.json();
  if (!json.id) throw new Error('No id returned');
  return json.id as string;
}

export async function fetchShortShare(id: string): Promise<string | null> {
  if(!shareBaseGet) await detectShareEndpoints();
  const url = (shareBaseGet || '/.netlify/functions/get-share') + `?id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const json = await res.json();
  return json.data as string;
}

// Helper to build short redirect URL (client side) always using /s/<id>
export function buildShortRedirectUrl(id:string){
  if(typeof window==='undefined') return `/s/${id}`;
  return `${window.location.origin}/s/${id}`;
}

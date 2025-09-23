/*
 Analyze Smart Gate links snapshot for tribe distribution.
 Usage: node tools/diagnostics/analyze_smart_gates.js [url]
 If no URL is provided, uses the current preview alias.
*/

const DEFAULT_URL = 'https://feature-safe-wip-2025-09-19-ikpg.ef-map.pages.dev/api/smart-gate-links?force=1&ts=' + Date.now();

async function main(){
  const url = process.argv[2] || DEFAULT_URL;
  const resp = await fetch(url, { cache: 'no-store' });
  if(!resp.ok){
    console.error('HTTP', resp.status);
    process.exit(1);
  }
  const data = await resp.json();
  const links = Array.isArray(data?.links) ? data.links : [];
  console.log('links', links.length);
  const counts = new Map();
  for(const l of links){
    const norm = (v)=>{ if(v==null) return ''; try { return String(v).trim(); } catch { return ''; } };
    let tid = norm(l.tribeId);
    if(!tid){
      const arr = Array.isArray(l.tribes) ? l.tribes : [];
      tid = norm(arr[0]);
    }
    if(!tid) tid = 'other';
    counts.set(tid, (counts.get(tid)||0)+1);
  }
  const sorted = Array.from(counts.entries()).sort((a,b)=> b[1]-a[1]);
  console.log('top20', sorted.slice(0,20));
  const target = process.argv[3] || '98000059';
  const entry = sorted.find(([k])=> k===target);
  console.log('has_9800059', !!entry, 'count', entry?.[1] || 0);
}

main().catch(e=>{ console.error(e); process.exit(1); });

/* Analyze Gate Access snapshot for tribe presence
Usage: node tools/diagnostics/analyze_gate_access.js [url]
*/
const DEFAULT_URL = 'https://feature-safe-wip-2025-09-19-ikpg.ef-map.pages.dev/api/gate-access?force=1&ts=' + Date.now();

async function main(){
  const url = process.argv[2] || DEFAULT_URL;
  const resp = await fetch(url, { cache: 'no-store' });
  if(!resp.ok){ console.error('HTTP', resp.status); process.exit(1); }
  const data = await resp.json();
  const rules = Array.isArray(data?.rules) ? data.rules : [];
  console.log('rules', rules.length);
  let withTribe=0; const counts=new Map();
  for(const r of rules){
    const norm = (v)=>{ if(v==null) return ''; try { return String(v).trim(); } catch { return ''; } };
    const t = norm(r.tribeId) || norm(Array.isArray(r.tribes)? r.tribes[0] : '');
    if(t){ withTribe++; counts.set(t, (counts.get(t)||0)+1); }
  }
  console.log('withTribe', withTribe);
  const sorted = Array.from(counts.entries()).sort((a,b)=> b[1]-a[1]);
  console.log('top20', sorted.slice(0,20));
  const target= process.argv[3] || '98000059';
  const hit = sorted.find(([k])=> k===target);
  console.log('has_9800059', !!hit, 'count', hit?.[1]||0);
}

main().catch(e=>{ console.error(e); process.exit(1); });

// Create a Cloudflare D1 database via REST API. Requires env CF_API_TOKEN (or CLOUDFLARE_API_TOKEN) and CLOUDFLARE_ACCOUNT_ID.
// Usage: node tools/create_d1_db.js ef_index_archive_1

const name = process.argv[2] || 'ef_index_archive_1';
const token = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!token || !accountId) {
  console.error('Missing CF_API_TOKEN/CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}

const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;

async function main(){
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const j = await r.json().catch(()=>({}));
  if(!r.ok || j.success === false){
    console.error('Create failed', r.status, JSON.stringify(j));
    process.exit(2);
  }
  const id = j?.result?.uuid || j?.result?.id;
  console.log(JSON.stringify(j));
  if(id){
    const fs = await import('node:fs');
    fs.writeFileSync('tmp_cf_archive1_id.txt', id, 'utf8');
    console.log('ARCHIVE_DB_ID=' + id);
  }
}

main().catch(e=>{ console.error(String(e)); process.exit(3); });

// List D1 databases via REST API. Requires env CF_API_TOKEN (or CLOUDFLARE_API_TOKEN) and CLOUDFLARE_ACCOUNT_ID.
// Usage: node tools/list_d1_dbs.js

const token = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !accountId) {
  console.error('Missing CF_API_TOKEN/CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}
const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/list`;

async function main(){
  const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  const j = await r.json().catch(()=>({}));
  console.log(JSON.stringify(j));
}

main().catch(e=>{ console.error(String(e)); process.exit(2); });

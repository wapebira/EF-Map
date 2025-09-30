// Standalone Cron Worker for autonomous chain ingestion
// Invokes the Pages deployment's /api/indexer-trigger endpoint on a fixed cadence via Cloudflare Cron Triggers.
// Rationale: Cloudflare Pages does not support cron triggers; separating keeps app logic stable while enabling
// background ingestion without manual intervention.
// Env Vars:
//   PAGES_BASE_URL (required): Base HTTPS URL of the Pages deployment (e.g. https://ef-map.pages.dev or branch URL)
//   INDEXER_ADMIN_TOKEN (optional): If set, sent as X-Indexer-Admin for auth
//   CRON_TRIGGER_INTERVAL (informational): Documented cadence (not used in code; real schedule lives in wrangler config)
//   INDEXER_CRON_MAX_BLOCKS / INDEXER_CRON_SEGMENT_BLOCKS / INDEXER_CRON_ROW_CAP (optional overrides; copied into trigger body)
// Safety: Uses /api/indexer-trigger which internally guards against overlapping runs & stale finalization.
// Logs minimal summary per invocation for observability in Workers dashboard.

async function postJSON(url, body, headers){
  const resp = await fetch(url, { method:'POST', headers:{ 'content-type':'application/json', ...headers }, body: JSON.stringify(body) });
  let text = await resp.text();
  let json=null; try { json = JSON.parse(text); } catch { json = { raw:text.slice(0,200) }; }
  return { status: resp.status, ok: resp.ok, json };
}

export default {
  // Fetch handler (optional manual trigger via curl for diagnostics)
  async fetch(req, env){
    const url = new URL(req.url);
    if(url.pathname === '/health'){ return new Response(JSON.stringify({ ok:true, ts: Date.now(), base: env.PAGES_BASE_URL || null }), { status:200, headers:{'content-type':'application/json'} }); }
    if(url.pathname === '/trigger' && (req.method === 'GET' || req.method === 'POST')){
      const r = await runTrigger(env, true);
      return new Response(JSON.stringify({ invoked:true, result:r }), { status:200, headers:{'content-type':'application/json'} });
    }
    return new Response('cron-indexer-worker', { status:200 });
  },
  async scheduled(event, env, ctx){
    try {
      const res = await runTrigger(env, false);
      console.log('cron_run', JSON.stringify({ ok:res.ok, status:res.status, mode:res.json?.mode, note:res.json?.notes, inProgress:res.json?.status==='in_progress', rows:res.json?.inserted||res.json?.rawEvents||0 }));
    } catch(e){
      console.log('cron_error', String(e).slice(0,160));
    }
  }
};

async function runTrigger(env, debug){
  const base = env.PAGES_BASE_URL;
  if(!base) return { ok:false, error:'missing_base_url' };
  const target = base.replace(/\/$/,'') + '/api/indexer-trigger';
  const headers = {};
  if(env.INDEXER_ADMIN_TOKEN) headers['X-Indexer-Admin'] = env.INDEXER_ADMIN_TOKEN;
  // Append openPreview=1 for *.pages.dev hosts to leverage preview bypass if token absent.
  const urlObj = new URL(target);
  if(/\.pages\.dev$/.test(urlObj.hostname)) urlObj.searchParams.set('openPreview','1');
  const body = { };
  if(env.INDEXER_CRON_MAX_BLOCKS) body.maxBlocks = parseInt(env.INDEXER_CRON_MAX_BLOCKS,10)||env.INDEXER_CRON_MAX_BLOCKS;
  if(env.INDEXER_CRON_SEGMENT_BLOCKS) body.segmentBlocks = parseInt(env.INDEXER_CRON_SEGMENT_BLOCKS,10)||env.INDEXER_CRON_SEGMENT_BLOCKS;
  if(env.INDEXER_CRON_ROW_CAP) body.rowCap = parseInt(env.INDEXER_CRON_ROW_CAP,10)||env.INDEXER_CRON_ROW_CAP;
  const result = await postJSON(urlObj.toString(), body, headers);
  return { ...result, target: urlObj.toString(), sentBody: body };
}

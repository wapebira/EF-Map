// Cron-only worker that invokes the Pages ingestion endpoint
export default {
  async fetch(req){
    return new Response('cron-ok');
  }
};

export async function scheduled(event, env, ctx){
  const mode = env.INDEXER_CRON_MODE || 'store_all';
  const body = {
    mode,
    maxBlocks: Number(env.INDEXER_CRON_MAXBLOCKS||4000),
    segmentBlocks: Number(env.INDEXER_CRON_SEGMENT||300),
    rowCap: Number(env.INDEXER_CRON_ROWCAP||50000),
    rpc: env.PYROPE_RPC||'',
    world: env.WORLD_ADDRESS||'',
    deployBlock: Number(env.DEPLOY_BLOCK||0)
  };
  // Direct D1 overlap lock
  try {
    if(env.INDEX_DB){
      const unfinished = await env.INDEX_DB.prepare("SELECT id, run_started_at FROM indexer_run WHERE run_finished_at IS NULL ORDER BY id DESC LIMIT 1").all();
      if(unfinished.results?.length){
        const rs = unfinished.results[0].run_started_at; const t=Date.parse(rs + (rs.endsWith('Z')?'':'Z')); if(!isNaN(t) && Date.now()-t < 120000) return; }
    }
  } catch{}
  // Use the Pages domain provided via env or fallback to public preview (must set CRON_TARGET_URL in prod)
  const target = env.CRON_TARGET_URL || 'https://feature-indexer.ef-map.pages.dev';
  try {
    await fetch(target + '/api/indexer-ingest?openPreview=1', { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body) });
  } catch{}
}

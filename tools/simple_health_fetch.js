#!/usr/bin/env node
const url='https://indexer-preview.ef-map.pages.dev/api/indexer-health?details=1';
(async()=>{ try { const r=await fetch(url); const t=await r.text(); console.log(t);} catch(e){ console.error('health fetch error',e);} })();

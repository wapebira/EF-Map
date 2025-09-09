#!/usr/bin/env node
// Wipe (destructive) helper: drops ingestion & derived tables for fresh re-ingest + decode.
// Usage:
//   DRY_RUN=1 node tools/wipe_indexer_tables.js   (prints planned drops)
//   node tools/wipe_indexer_tables.js              (executes)
// Environment:
//   Requires Cloudflare D1 binding via wrangler pages dev OR production worker context (not handled here).
//   For local direct execution we rely on Wrangler's pages dev environment: run with `npx wrangler pages dev` then HTTP POST this script? => Instead
//   this script emits SQL you can apply manually via a temporary endpoint or D1 dashboard. Keeping it simple & deterministic.
// NOTE: We intentionally DO NOT execute against the DB from here because local direct D1 access requires wrangler APIs not imported in repo.
//       Instead we output a multi-statement SQL block the operator (or a future automated admin endpoint) can run.

const tablesToDrop = [
  'raw_logs',
  'store_events','table_registry','decode_progress',
  'smart_assembly','smart_gate_direction','gate_acl','gate_access_cache','structure_generic',
  'adjacency_snapshot_meta','gate_tombstone','event_cursor','indexer_run'
];

const dry = process.env.DRY_RUN !== '0' && process.env.DRY_RUN !== 'false';

function buildSQL(){
  const lines = [];
  for(const t of tablesToDrop){ lines.push(`DROP TABLE IF EXISTS ${t};`); }
  return lines.join('\n');
}

if(dry){
  console.log('[wipe_indexer_tables] DRY_RUN=1 — planned drops:');
  tablesToDrop.forEach(t=> console.log('  -', t));
  console.log('\nSQL:\n'+buildSQL());
  process.exit(0);
}

console.log('[wipe_indexer_tables] Destructive wipe requested. SQL to apply (execute via admin migration endpoint or D1 console):');
console.log(buildSQL());
console.log('\nNOTE: world_version and _migrations preserved. After execution run /api/indexer-migrate then /api/indexer-bootstrap (if world_version cleared).');
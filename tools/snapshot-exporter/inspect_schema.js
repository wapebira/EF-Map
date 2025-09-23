#!/usr/bin/env node
/*
 Inspect a given schema for tables/columns likely to contain gate ownership/tribe mappings.
 Usage: node /app/inspect_schema.js <schema>
*/
const { Client } = require('pg');

async function main(){
  const schema = (process.argv[2]||'').trim();
  if(!schema){ console.error('Usage: inspect_schema <schema>'); process.exit(2); }
  const pg = new Client({
    host: process.env.PGHOST || 'postgres',
    port: parseInt(process.env.PGPORT||'5432',10),
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'user',
    password: process.env.PGPASSWORD || 'password'
  });
  await pg.connect();
  const tablesRes = await pg.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name", [schema]);
  const tables = (tablesRes.rows||[]).map(r=> r.table_name);
  const interesting = [];
  const wants = new Set(['smart_object_id','gate_id','org_id','organization_id','owner','owner_id','tribe_id','access_level','is_linked','is_public']);
  for(const t of tables){
    const colsRes = await pg.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position", [schema, t]);
    const cols = (colsRes.rows||[]).map(r=> String(r.column_name));
    const hits = cols.filter(c=> wants.has(c.toLowerCase()));
    if(hits.length){ interesting.push({ table: t, columns: cols }); }
  }
  // Print summary
  console.log('Schema', schema, 'tables', tables.length, 'interesting', interesting.length);
  for(const it of interesting){
    console.log(it.table+': '+it.columns.join(','));
  }
  await pg.end();
}

main().catch(e=>{ console.error(e); process.exit(1); });

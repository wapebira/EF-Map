#!/usr/bin/env node
/*
 Structure Snapshot Exporter
 - Reads smart assembly (structure) data from Postgres (Primordium indexer output)
 - Aggregates counts by solar system, structure type, status, and tribe
 - Publishes JSON snapshot (structure_snapshot_v1) to Cloudflare KV (EF_SNAPSHOTS)

 Env vars:
  PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD  // Postgres connection
  STRUCTURE_SCHEMA            // Optional schema override (default: 0x7085f3e652987f656fb8dee5aa6592197bb75de8)
  STRUCTURE_ASSEMBLY_TABLE    // Optional table name override for smart assemblies (default: evefrontier__smart_assembly)
  STRUCTURE_STATE_TABLE       // Optional table name override for deployable state (default: evefrontier__deployable_state)
  STRUCTURE_LOCATION_TABLE    // Optional table name override for location table (default: evefrontier__location)
  STRUCTURE_OWNER_TABLE       // Optional override for ownership table (default: evefrontier__ownership_by_object)
  STRUCTURE_CHAR_BY_ACCO_TABLE// Optional override for characters_by_acco (default: evefrontier__characters_by_acco)
  STRUCTURE_CHAR_TABLE        // Optional override for characters table (default: evefrontier__characters)
  KV_NAMESPACE_ID             // Cloudflare KV namespace id for EF_SNAPSHOTS (required when not DRY_RUN)
  EF_SNAPSHOTS_NAMESPACE_ID   // Alternate env name for namespace id
  CF_API_TOKEN                // Optional: Cloudflare API token for Wrangler (if not already logged in)
  LOG_JSON=1                  // Optional: structured logging
  DRY_RUN=1                   // Optional: skip KV write
  REMOTE=1 / FORCE_REMOTE=1   // Optional: force Wrangler remote mode
  OUT_PATH / --out <file>     // Optional: write snapshot body when dry-running

 Notes:
  - Current implementation performs a full rebuild each run. Incremental updates can be layered later by
    fetching the previous snapshot and applying per-object deltas.
*/

const { Client } = require('pg');
const cp = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

function log(level, msg, extra){
  const json = process.env.LOG_JSON === '1';
  if(json){
    const record = { level, msg, ts: new Date().toISOString(), ...(extra||{}) };
    console.log(JSON.stringify(record));
  } else {
    const pad = level.toUpperCase().padEnd(5);
    console.log(`[${pad}] ${msg}` + (extra ? ` ${JSON.stringify(extra)}` : ''));
  }
}

function escapeIdentifier(name){
  if(!name) throw new Error('identifier required');
  if(typeof name !== 'string') name = String(name);
  if(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;
  return '"' + name.replace(/"/g,'""') + '"';
}

function parseArgs(){
  const args = new Set(process.argv.slice(2));
  const has = (flag)=> args.has(flag);
  const dryRun = has('--dry-run') || has('-n') || process.env.DRY_RUN === '1';
  const remote = has('--remote') || process.env.REMOTE === '1' || process.env.FORCE_REMOTE === '1' || process.env.CF_KV_REMOTE === '1';
  const full = has('--full'); // placeholder for future incremental mode
  let outPath = process.env.OUT_PATH || '';
  const ix = process.argv.indexOf('--out');
  if(ix >= 0 && process.argv[ix+1]) outPath = process.argv[ix+1];
  return { dryRun, remote, full, outPath };
}

function normalizeNumber(value){
  if(value === null || value === undefined) return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

async function tableExists(client, schema, name){
  if(!name) return false;
  const res = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2 LIMIT 1`,
    [schema, name]
  );
  return res.rowCount > 0;
}

async function findTableLike(client, schema, pattern){
  if(!pattern) return null;
  const like = pattern.includes('%') ? pattern : `%${pattern}%`;
  const res = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE $2 ORDER BY LENGTH(table_name) ASC, table_name ASC LIMIT 1`,
    [schema, like]
  );
  return res.rowCount ? res.rows[0].table_name : null;
}

async function resolveTable(client, schema, label, preferred, fallbackNames = [], searchTerms = []){
  const tried = [];
  const candidates = [];
  if(preferred) candidates.push(preferred);
  for(const name of fallbackNames){ if(name && !candidates.includes(name)) candidates.push(name); }
  for(const name of candidates){
    tried.push(name);
    if(await tableExists(client, schema, name)) return name;
  }
  const searchList = searchTerms.length ? searchTerms : (preferred ? [preferred] : []);
  for(const term of searchList){
    const found = await findTableLike(client, schema, term);
    if(found){
      if(!tried.includes(found)) tried.push(found);
      return found;
    }
  }
  throw new Error(`${label} table not found (tried: ${tried.join(', ') || 'none'})`);
}

async function main(){
  const t0 = Date.now();
  const { dryRun, remote, outPath } = parseArgs();

  const pg = new Client({
    host: process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.PGPORT || process.env.POSTGRES_PORT || '5432',10),
    database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'postgres',
    user: process.env.PGUSER || process.env.POSTGRES_USER || 'user',
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'password'
  });

  const schemaName = process.env.STRUCTURE_SCHEMA || '0x7085f3e652987f656fb8dee5aa6592197bb75de8';
  const assemblyPref = process.env.STRUCTURE_ASSEMBLY_TABLE || 'evefrontier__smart_assembly';
  const statePref = process.env.STRUCTURE_STATE_TABLE || 'evefrontier__deployable_state';
  const locationPref = process.env.STRUCTURE_LOCATION_TABLE || 'evefrontier__location';
  const ownerPref = process.env.STRUCTURE_OWNER_TABLE || 'evefrontier__ownership_by_object';
  const charByAccoPref = process.env.STRUCTURE_CHAR_BY_ACCO_TABLE || 'evefrontier__characters_by_acco';
  const charactersPref = process.env.STRUCTURE_CHAR_TABLE || 'evefrontier__characters';

  const namespaceId = process.env.KV_NAMESPACE_ID || process.env.EF_SNAPSHOTS_NAMESPACE_ID || '';
  const token = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '';

  if(!dryRun && !namespaceId){
    log('error','missing namespace id: set KV_NAMESPACE_ID or EF_SNAPSHOTS_NAMESPACE_ID');
    throw new Error('KV namespace id required when not running in DRY_RUN mode');
  }

  await pg.connect();
  log('info','connected postgres',{ host: pg.host, db: pg.database, schema: schemaName });
  await pg.query(`SET search_path TO ${escapeIdentifier(schemaName)}`);

  const tables = {};
  try {
    tables.assembly = await resolveTable(pg, schemaName, 'assembly', assemblyPref, [ 'evefrontier__smart_assembly' ], ['smart_assembly']);
    tables.state = await resolveTable(pg, schemaName, 'deployable_state', statePref, [ 'evefrontier__deployable_state' ], ['deployable_state', 'smart_state']);
    tables.location = await resolveTable(pg, schemaName, 'location', locationPref, [ 'evefrontier__location' ], ['location']);
    tables.owner = await resolveTable(pg, schemaName, 'ownership', ownerPref, [ 'evefrontier__ownership_by_object', 'evefrontier__ownership_by_obj' ], ['ownership_by_obj','ownership']);
    tables.charByAcco = await resolveTable(pg, schemaName, 'characters_by_acco', charByAccoPref, [ 'evefrontier__characters_by_acco' ], ['characters_by_acco','characters_by_acc']);
    tables.characters = await resolveTable(pg, schemaName, 'characters', charactersPref, [ 'evefrontier__characters' ], ['characters']);
  } catch (e) {
    log('error','table_resolution_failed',{ error: String(e) });
    throw e;
  }
  log('info','resolved tables', tables);

  const baseJoin = `
    FROM ${escapeIdentifier(tables.assembly)} sa
    INNER JOIN ${escapeIdentifier(tables.state)} ds ON ds.smart_object_id = sa.smart_object_id
    INNER JOIN ${escapeIdentifier(tables.location)} loc ON loc.smart_object_id = sa.smart_object_id
    LEFT JOIN ${escapeIdentifier(tables.owner)} own ON own.smart_object_id = sa.smart_object_id
    LEFT JOIN ${escapeIdentifier(tables.charByAcco)} cba ON cba.account = own.account
    LEFT JOIN ${escapeIdentifier(tables.characters)} ch ON ch.smart_object_id = cba.smart_object_id
    WHERE loc.solar_system_id IS NOT NULL
      AND loc.solar_system_id <> 0
  `;

  const systemCountsSql = `
    SELECT
      loc.solar_system_id AS system_id,
      sa.assembly_type AS type,
      ds.current_state AS status,
      COUNT(DISTINCT sa.smart_object_id) AS count
    ${baseJoin}
    GROUP BY loc.solar_system_id, sa.assembly_type, ds.current_state
  `;

  const tribeCountsSql = `
    SELECT
      loc.solar_system_id AS system_id,
      ch.tribe_id AS tribe_id,
      sa.assembly_type AS type,
      ds.current_state AS status,
      COUNT(DISTINCT sa.smart_object_id) AS count
    ${baseJoin}
      AND ch.tribe_id IS NOT NULL
    GROUP BY loc.solar_system_id, ch.tribe_id, sa.assembly_type, ds.current_state
  `;

  const metaSql = `
    SELECT
      COUNT(DISTINCT sa.smart_object_id) AS total,
      MAX(ds.updated_block_number) AS last_block
    ${baseJoin}
  `;

  let systemRows = [];
  let tribeRows = [];
  let metaRow = { total: 0, last_block: 0 };

  try {
    const [systemRes, tribeRes, metaRes] = await Promise.all([
      pg.query(systemCountsSql),
      pg.query(tribeCountsSql),
      pg.query(metaSql)
    ]);
    systemRows = systemRes.rows || [];
    tribeRows = tribeRes.rows || [];
    if(metaRes.rows && metaRes.rows.length){
      metaRow = metaRes.rows[0];
    }
  } catch (e) {
    log('error','postgres_query_failed',{ error: String(e) });
    throw e;
  } finally {
    await pg.end().catch(()=>{});
  }

  log('info','query counts',{ systems: systemRows.length, tribes: tribeRows.length });

  const systems = {};
  const typeTotals = {};
  const statusTotals = {};

  for(const row of systemRows){
    const systemId = String(row.system_id);
    const type = String(row.type || '').trim();
    const status = String(row.status == null ? '' : row.status);
    const count = normalizeNumber(row.count);
    if(!type || !status) continue;
    const systemEntry = systems[systemId] || { counts: {}, tribes: {} };
    const typeEntry = systemEntry.counts[type] || {};
    typeEntry[status] = (typeEntry[status] || 0) + count;
    systemEntry.counts[type] = typeEntry;
    systems[systemId] = systemEntry;

    typeTotals[type] = (typeTotals[type] || 0) + count;
    statusTotals[status] = (statusTotals[status] || 0) + count;
  }

  for(const row of tribeRows){
    const systemId = String(row.system_id);
    const tribeId = String(row.tribe_id);
    if(!tribeId || tribeId === 'null') continue;
    const type = String(row.type || '').trim();
    const status = String(row.status == null ? '' : row.status);
    const count = normalizeNumber(row.count);
    if(!type || !status || !systems[systemId]) continue;
    const systemEntry = systems[systemId];
    const tribeMap = systemEntry.tribes[tribeId] || {};
    const typeEntry = tribeMap[type] || {};
    typeEntry[status] = (typeEntry[status] || 0) + count;
    tribeMap[type] = typeEntry;
    systemEntry.tribes[tribeId] = tribeMap;
  }

  const totalAssemblies = normalizeNumber(metaRow.total);
  const lastBlockRaw = metaRow.last_block;
  const lastBlock = Number.isFinite(Number(lastBlockRaw)) ? Number(lastBlockRaw) : null;
  const generatedAt = new Date().toISOString();

  const payload = {
    meta: {
      generatedAt,
      ...(lastBlock !== null ? { lastBlock } : {}),
      totalAssemblies,
      statuses: statusTotals,
      types: typeTotals
    },
    systems
  };

  const body = JSON.stringify(payload);
  const bytes = Buffer.byteLength(body, 'utf8');
  log('info','built snapshot',{ systems: Object.keys(systems).length, bytes, dryRun });
  const namespace = namespaceId || null;
  log('info','wrangler mode',{ remote, namespaceId: namespace, hasToken: !!token });

  if(dryRun){
    log('info','DRY_RUN set; skipping KV write');
    if(outPath){
      try {
        fs.writeFileSync(outPath, body, 'utf8');
        log('info','dry-run snapshot written',{ path: outPath, bytes });
      } catch (e) {
        log('error','dry-run write failed',{ path: outPath, error: String(e) });
      }
    }
    else {
      process.stdout.write(body + '\n');
    }
    return;
  }

  const tmpPath = path.join(os.tmpdir(), 'structure_snapshot_v1.json');
  fs.writeFileSync(tmpPath, body);

  const wrArgs = [
    'kv','key','put','structure_snapshot_v1',
    '--namespace-id', namespaceId,
    '--path', tmpPath
  ];
  if(remote) wrArgs.push('--remote');
  const env = token ? { ...process.env, CLOUDFLARE_API_TOKEN: token } : { ...process.env };

  const wrCmd = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';

  async function runWrangler(){
    try {
      await new Promise((resolve, reject)=>{
        const p = cp.spawn(wrCmd, wrArgs, { env });
        let stderr = '';
        p.on('error', reject);
        p.stderr.on('data', d=>{ stderr += String(d); });
        p.on('exit', code=>{
          if(code === 0) return resolve();
          reject(new Error('wrangler_exit_'+code+': '+stderr));
        });
      });
    } catch (err){
      if(process.platform === 'win32'){
        const quote = (s)=>/\s/.test(s) ? `"${s.replace(/"/g,'\\"')}"` : s;
        const cmdline = [wrCmd, ...wrArgs.map(quote)].join(' ');
        await new Promise((resolve, reject)=>{
          cp.exec(cmdline, { env }, (error, stdout, stderr)=>{
            if(error) return reject(new Error('wrangler_exec_failed: '+(stderr || String(error))));
            resolve();
          });
        });
      } else {
        throw err;
      }
    }
  }

  await runWrangler();
  const dt = Date.now() - t0;
  log('info','wrangler put ok',{ key: 'structure_snapshot_v1', bytes, ms: dt, namespaceId });
}

main().catch(err=>{
  log('error','structure_exporter_failed',{ error: String(err) });
  process.exit(1);
});

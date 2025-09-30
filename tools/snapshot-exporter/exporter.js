#!/usr/bin/env node
/*
 Snapshot Exporter (Docker-friendly)
 - Reads smart gate links from local Postgres (Primordium indexer output view/table)
 - Produces JSON payload compatible with /api/smart-gate-links consumer:
    { updatedAt, links:[{ gateId, origin, destination, linked, online, cost }] }
 - Publishes to Cloudflare KV (EF_SNAPSHOTS) key smart_gate_links_v1 via Wrangler

 Env vars:
  PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD  // Postgres
  KV_NAMESPACE_ID  // Cloudflare KV namespace id for EF_SNAPSHOTS
  CF_ACCOUNT_ID    // Cloudflare account id
  CF_API_TOKEN     // API token (read/write KV)
  CF_PROJECT_NAME? // Optional Pages project for context (not required)
  ONLY_ONLINE=1    // Optional: include only online directions
  DRY_RUN=1        // Optional: build but do not push
  LOG_JSON=1       // Optional: JSON logs

 Assumptions:
  - A relational source exists with gate directions. Preferred: a materialized view or table:
      smart_gate_direction(origin_system_id, destination_system_id, linked, online, traversal_cost, gate_id, last_change_at)
    These match prior D1 schema; adjust SQL if your Postgres names differ (use GATE_SOURCE_SQL env to override).
*/

const { Client } = require('pg');
const cp = require('child_process');
const os = require('os');

function log(level, msg, extra){
  const j = process.env.LOG_JSON === '1';
  if(j){
    const o = { level, msg, ts: new Date().toISOString(), ...(extra||{}) };
    console.log(JSON.stringify(o));
  } else {
    const pad = level.toUpperCase().padEnd(5);
    console.log(`[${pad}] ${msg}` + (extra? ' '+JSON.stringify(extra):''));
  }
}

// Canonicalize on-chain addresses:
// - Convert Postgres bytea textual form "\xabc..." to "0xabc..."
// - Force lowercase
// - If bare 40-hex chars (20 bytes) without prefix, add 0x
function normalizeAddress(addr){
  if(addr === null || addr === undefined) return '';
  let s = String(addr).trim();
  if(!s) return '';
  // Convert Postgres bytea text (\\x...) to 0x...
  if(/^\\x[0-9a-f]+$/i.test(s)) {
    s = '0x' + s.slice(2);
  }
  // If bare 40-hex, add 0x prefix
  if(/^[0-9a-f]{40}$/i.test(s)) {
    s = '0x' + s;
  }
  // Normalize 0x-prefixed to lowercase
  if(/^0x[0-9a-f]+$/i.test(s)) {
    return s.toLowerCase();
  }
  return s.toLowerCase();
}

function normalizeTimestamp(value){
  if(value === null || value === undefined) return undefined;
  const tryNumber = (input) => {
    if(typeof input === 'number' && Number.isFinite(input)) return input;
    if(typeof input === 'bigint') {
      const num = Number(input);
      return Number.isFinite(num) ? num : NaN;
    }
    if(typeof input === 'string'){
      const trimmed = input.trim();
      if(trimmed){
        if(/^-?\d+(\.\d+)?$/.test(trimmed)){
          const num = Number(trimmed);
          if(Number.isFinite(num)) return num;
        }
        const date = new Date(trimmed);
        if(!Number.isNaN(date.getTime())) return date.getTime();
      }
    }
    return NaN;
  };

  let numeric = tryNumber(value);
  if(Number.isNaN(numeric)) return undefined;
  // If value looks like seconds (10 digits) convert to milliseconds. Anything >=1e12 treat as already ms.
  if(Math.abs(numeric) < 1e11){
    numeric = numeric * 1000;
  }
  const date = new Date(numeric);
  if(Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

async function main(){
  const t0 = Date.now();
  const argv = new Set(process.argv.slice(2));
  const pg = new Client({
    host: process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.PGPORT || process.env.POSTGRES_PORT || '5432',10),
    database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'postgres',
    user: process.env.PGUSER || process.env.POSTGRES_USER || 'user',
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'password'
  });
  const onlyOnline = argv.has('--only-online') || process.env.ONLY_ONLINE === '1';
  const dryRun = argv.has('--dry-run') || argv.has('-n') || process.env.DRY_RUN === '1';
  const skipBody = process.env.SKIP_BODY === '1';
  // Optional output path for dry-run: --out <file> or OUT_PATH env
  let outPathArg = null;
  try {
    const ix = process.argv.indexOf('--out');
    if (ix >= 0 && process.argv[ix+1]) outPathArg = process.argv[ix+1];
  } catch {}
  const outPathEnv = process.env.OUT_PATH || '';
  const dryOutPath = outPathArg || outPathEnv || '';
  // Prefer explicit remote writes. Allow FORCE_REMOTE=1 to override and help avoid silent local mode no-ops.
  const remote = argv.has('--remote') || process.env.REMOTE === '1' || process.env.CF_KV_REMOTE === '1' || process.env.FORCE_REMOTE === '1';
  const accountId = process.env.CF_ACCOUNT_ID || '';
  const token = process.env.CF_API_TOKEN || '';
  const nsId = process.env.KV_NAMESPACE_ID || process.env.EF_SNAPSHOTS_NAMESPACE_ID || '';
  // For non-dry runs, we require a namespace id. Account id and token are optional if Wrangler login is already configured.
  if(!dryRun){
    if(!nsId){
      log('error','missing namespace id: set KV_NAMESPACE_ID or EF_SNAPSHOTS_NAMESPACE_ID');
      throw new Error('KV_NAMESPACE_ID (or EF_SNAPSHOTS_NAMESPACE_ID) env required');
    }
  }

  const sourceSql = process.env.GATE_SOURCE_SQL || null;

  await pg.connect();
  log('info','connected postgres',{ host:pg.host, db:pg.database });
  // Detect join table to resolve system IDs for gates
  let joinSchema = process.env.JOIN_SCHEMA || 'world_api_dlt';
  let joinTable = process.env.JOIN_TABLE_NAME || null; // e.g., 'smartassembly' or 'smartassembly_flat'
  let systemIdCol = process.env.JOIN_SYSTEM_ID_COLUMN || null; // e.g., 'system_id'
  try {
    const candidates = ['smartassembly','smartassembly_flat'];
    const sysIdCandidates = ['system_id','solarsystem_id','solarsystemid','solar_system_id'];
    // If explicit overrides provided, validate and honor them first
    if (joinTable && systemIdCol) {
      const existsQ = `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2 LIMIT 1`;
      const ex = await pg.query(existsQ, [joinSchema, joinTable]);
      if (!ex.rows || ex.rows.length === 0) {
        log('error','explicit join table not found', { schema: joinSchema, table: joinTable });
        joinTable = null; systemIdCol = null; // fall through to discovery
      } else {
        // quick column presence check
        const colsQ = `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2`;
        const colRes = await pg.query(colsQ, [joinSchema, joinTable]);
        const colSet = new Set((colRes.rows||[]).map(r=>String(r.column_name||'')));
        if (!colSet.has('id') || !colSet.has(systemIdCol)) {
          log('error','explicit join missing required columns', { schema: joinSchema, table: joinTable, systemIdCol });
          joinTable = null; systemIdCol = null;
        }
      }
    }
    // First try the hinted schema
    if (!joinTable || !systemIdCol) for (const t of candidates) {
      const existsQ = `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2 LIMIT 1`;
      const ex = await pg.query(existsQ, [joinSchema, t]);
      if (!ex.rows || ex.rows.length === 0) continue;
      const colsQ = `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2`;
      const colRes = await pg.query(colsQ, [joinSchema, t]);
      const colSet = new Set((colRes.rows||[]).map(r=>String(r.column_name||'')));
      if (!colSet.has('id')) continue;
      let sysCol = null;
      for (const c of sysIdCandidates) { if (colSet.has(c)) { sysCol = c; break; } }
      if (!sysCol) continue;
      joinTable = t;
      systemIdCol = sysCol;
      break;
    }
    // If not found, scan all schemas except system schemas
    if (!joinTable || !systemIdCol) {
      const allQ = `
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_name = ANY($1)
          AND table_schema NOT LIKE 'pg_%'
          AND table_schema <> 'information_schema'
      `;
      const allRes = await pg.query(allQ, [candidates]);
      for (const r of (allRes.rows||[])) {
        const sch = String(r.table_schema);
        const t = String(r.table_name);
        const colsQ = `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2`;
        const colRes = await pg.query(colsQ, [sch, t]);
        const colSet = new Set((colRes.rows||[]).map(x=>String(x.column_name||'')));
        if (!colSet.has('id')) continue;
        let sysCol = null;
        for (const c of sysIdCandidates) { if (colSet.has(c)) { sysCol = c; break; } }
        if (!sysCol) continue;
        joinSchema = sch;
        joinTable = t;
        systemIdCol = sysCol;
        break;
      }
    }
    // Last-resort: list any table that has both id and a system id-like column
    if (!joinTable || !systemIdCol) {
      const diagQ = `
        SELECT c.table_schema, c.table_name,
               COUNT(*) FILTER (WHERE c.column_name='id') AS has_id,
               COUNT(*) FILTER (WHERE c.column_name IN ('system_id','solarsystem_id','solarsystemid','solar_system_id')) AS has_sys
        FROM information_schema.columns c
        WHERE c.table_schema NOT LIKE 'pg_%' AND c.table_schema <> 'information_schema'
        GROUP BY c.table_schema, c.table_name
        HAVING COUNT(*) FILTER (WHERE c.column_name='id') > 0
           AND COUNT(*) FILTER (WHERE c.column_name IN ('system_id','solarsystem_id','solarsystemid','solar_system_id')) > 0
        ORDER BY c.table_schema, c.table_name
        LIMIT 25
      `;
      try {
        const diag = await pg.query(diagQ);
        log('info','join candidates', { count: diag.rows?.length||0, rows: diag.rows||[] });
      } catch (e) {
        log('error','join candidates probe failed', { error: String(e) });
      }
    }
    log('info','join resolution', { schema: joinSchema, table: joinTable, systemIdCol });
  } catch (e) {
    log('error','join resolution failed', { error: String(e) });
  }
  let rows=[];
  // Map gate_id (as text) -> appliedSystemId (as 0x-address string). Filled per schema when available.
  const configMap = new Map();
  // Map gate_id (as text) -> Set of tribe ids (as text). Derived from per-schema *__gate_access tables when available.
  const tribeMap = new Map();
  // Map gate_id -> owner info { account, characterId?, tribeId? }
  const ownerMap = new Map();
  // Map gate_id -> status info { isOnline?, currentState?, anchoredAt?, updatedAt?, lastChangeAt? }
  const statusMap = new Map();
  // Map gate_id -> entity info { itemId }
  const entityItemMap = new Map();
  // Cross-schema mapping: Smart Assembly (gate) id -> tribe_id via World API smartcharacters association
  const assemblyTribeMap = new Map();
  // Global mapping: account/address -> tribe_id via World API DLT tribe membership
  const addressTribeMap = new Map();
  try {
    if (sourceSql) {
      // Explicit SQL override provided by env
      const res = await pg.query(sourceSql);
      rows = res.rows || [];
    } else {
      // Auto-discover chain schemas with evefrontier__smart_gate_link and synthesize directional links
      // 1) Find all 0x* schemas that contain the link table
      const findSchemasSql = `
        SELECT n.nspname AS schema
        FROM pg_namespace n
        JOIN pg_class c ON c.relnamespace = n.oid
        WHERE c.relname = 'evefrontier__smart_gate_link'
          AND n.nspname ~ '^0x'
        GROUP BY n.nspname
        ORDER BY n.nspname`;
      const schRes = await pg.query(findSchemasSql);
      const schemas = (schRes.rows || []).map(r => r.schema);
      log('info','discovered link schemas',{ count: schemas.length, schemas });
      // 2) For each schema, query bidirectional edges by joining gate IDs to the resolved join table to get system IDs
      for (const s of schemas) {
        // Quote the schema name to handle hex prefix
        const ident = '"' + s.replace(/"/g,'""') + '"';
        // Try to load SmartGateConfig for this schema (gate -> system_id)
        try {
          const cfgQ = `
            SELECT CAST(smart_object_id AS text) AS gate_id,
                   CAST(system_id AS text) AS system_id
            FROM ${ident}."evefrontier__smart_gate_config"`;
          const cfgRes = await pg.query(cfgQ);
          for (const r of (cfgRes.rows||[])) {
            if (!r || !r.gate_id) continue;
            const sys = (r.system_id || '').toString();
            // Normalize any address-like value to canonical 0x-lowercase form
            const norm = normalizeAddress(sys) || sys;
            configMap.set(String(r.gate_id), norm);
          }
        } catch(e){
          // Table may not exist in this schema; ignore
        }
        // Attempt to collect tribe mappings for gates from any *_gate_access tables in this schema
        try {
          // Discover tables that have both a smart_object_id-like column (or gate_id) and a tribe/owner column
          // Normalize column names to lower for matching; capture the actual names for SELECT
          const accessTablesQ = `
            SELECT c.table_name,
                   MAX(CASE WHEN LOWER(c.column_name) IN (
                     'smart_object_id','smartobjectid','smart_objectid','gate_id','smart_gate_id','smartgate_id','smartgateid','structure_id','smart_object','smartobject'
                   ) THEN c.column_name END) AS gate_col,
                   MAX(CASE WHEN LOWER(c.column_name) IN (
                     'tribe_id','tribeid','tribe','org_id','organization_id','owner_id','owner','owner_org_id','corporation_id','corp_id','alliance_id'
                   ) THEN c.column_name END) AS tribe_col
            FROM information_schema.columns c
            WHERE c.table_schema = $1
              AND c.table_name NOT ILIKE '%character%'
            GROUP BY c.table_name
            HAVING COUNT(*) FILTER (WHERE LOWER(c.column_name) IN (
                     'smart_object_id','smartobjectid','smart_objectid','gate_id','smart_gate_id','smartgate_id','smartgateid','structure_id','smart_object','smartobject'
                   )) > 0
               AND COUNT(*) FILTER (WHERE LOWER(c.column_name) IN (
                     'tribe_id','tribeid','tribe','org_id','organization_id','owner_id','owner','owner_org_id','corporation_id','corp_id','alliance_id'
                   )) > 0
          `;
          const atRes = await pg.query(accessTablesQ, [s]);
          let tableRows = (atRes.rows||[]).map(r=> ({
            table: String(r.table_name),
            gateCol: String(r.gate_col||'').trim(),
            tribeCol: String(r.tribe_col||'').trim()
          })).filter(r=> r.table && r.gateCol && r.tribeCol);
          // Heuristic: prefer tables likely related to gates/structures/access; de-prioritize unrelated ones
          tableRows = tableRows.filter(r=> /(gate|structure|access)/i.test(r.table) || r.table === 'evefrontier__structure_generic');
          if(tableRows.length){ log('info','tribe table candidates',{ schema:s, count: tableRows.length, tables: tableRows.map(t=>`${t.table}(${t.gateCol}->${t.tribeCol})`).slice(0,10) }); }
          for(const row of tableRows){
            const t = row.table;
            const gateCol = row.gateCol;
            const tribeCol = row.tribeCol;
            const tIdent = '"' + t.replace(/"/g,'""') + '"';
            const gateIdent = '"' + gateCol.replace(/"/g,'""') + '"';
            const tribeIdent = '"' + tribeCol.replace(/"/g,'""') + '"';
            const loadQ = `SELECT CAST(${gateIdent} AS text) AS gate_id, CAST(${tribeIdent} AS text) AS tribe_id FROM ${ident}.${tIdent}`;
            try {
              const r = await pg.query(loadQ);
              for(const row2 of (r.rows||[])){
                const gid = String(row2.gate_id||'');
                const tid = String(row2.tribe_id||'');
                if(!gid || !tid) continue;
                let set = tribeMap.get(gid);
                if(!set){ set = new Set(); tribeMap.set(gid, set); }
                set.add(tid);
              }
              if(r.rows?.length){ log('info','tribe table loaded',{ schema:s, table:t, rows: r.rows.length }); }
            } catch(e2){ /* ignore table-level read errors */ }
          }
          // Explicit fallback: structure metadata often exposes org_id -> use as tribe proxy if present
          try {
            const metaExistsQ = `
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'evefrontier__structure_generic'
                AND column_name IN ('smart_object_id','org_id','owner_id','organization_id')
              GROUP BY table_schema, table_name
              HAVING COUNT(*) FILTER (WHERE column_name='smart_object_id') > 0
                 AND (
                   COUNT(*) FILTER (WHERE column_name='org_id') > 0 OR
                   COUNT(*) FILTER (WHERE column_name='owner_id') > 0 OR
                   COUNT(*) FILTER (WHERE column_name='organization_id') > 0
                 )
              LIMIT 1`;
            const me = await pg.query(metaExistsQ, [s]);
            if(me.rows && me.rows.length){
              const mapQ = `
                SELECT
                  CAST(smart_object_id AS text) AS gate_id,
                  CAST(COALESCE(org_id, owner_id, organization_id) AS text) AS tribe_id
                FROM ${ident}."evefrontier__structure_generic"
                WHERE COALESCE(org_id, owner_id, organization_id) IS NOT NULL`;
              try {
                const mr = await pg.query(mapQ);
                for(const row2 of (mr.rows||[])){
                  const gid = String(row2.gate_id||'');
                  const tid = String(row2.tribe_id||'');
                  if(!gid || !tid) continue;
                  let set = tribeMap.get(gid);
                  if(!set){ set = new Set(); tribeMap.set(gid, set); }
                  set.add(tid);
                }
                if(mr.rows?.length){ log('info','structure_generic org_id mapped',{ schema:s, rows: mr.rows.length }); }
              } catch{/* ignore */}
            }
          } catch{/* ignore */}

          // Generic owner account discovery: find any table with gate/smart_object id and an account/address/owner column to populate ownerMap
          try {
            const ownerTablesQ = `
              SELECT c.table_name,
                     MAX(CASE WHEN LOWER(c.column_name) IN (
                       'smart_object_id','smartobjectid','smart_objectid','gate_id','smart_gate_id','smartgate_id','smartgateid','structure_id','smart_object','smartobject',
                       'object_id','assembly_id','deployable_id','deploy_id','smart_deployable_id'
                     ) THEN c.column_name END) AS gate_col,
                     MAX(CASE WHEN LOWER(c.column_name) IN (
                       'account','owner','owner_account','owner_address','address','deployer','creator','wallet','controller_account','controller_address',
                       'owner_wallet','owner_wallet_address','owner_addr','admin','admin_account','admin_address','operator_account','operator_address'
                     ) THEN c.column_name END) AS acct_col
              FROM information_schema.columns c
              WHERE c.table_schema = $1
                AND c.table_name NOT ILIKE '%character%'
              GROUP BY c.table_name
              HAVING COUNT(*) FILTER (WHERE LOWER(c.column_name) IN (
                       'smart_object_id','smartobjectid','smart_objectid','gate_id','smart_gate_id','smartgate_id','smartgateid','structure_id','smart_object','smartobject',
                       'object_id','assembly_id','deployable_id','deploy_id','smart_deployable_id'
                     )) > 0
                 AND COUNT(*) FILTER (WHERE LOWER(c.column_name) IN (
                       'account','owner','owner_account','owner_address','address','deployer','creator','wallet','controller_account','controller_address',
                       'owner_wallet','owner_wallet_address','owner_addr','admin','admin_account','admin_address','operator_account','operator_address'
                     )) > 0
            `;
            const otRes = await pg.query(ownerTablesQ, [s]);
            const ownerTables = (otRes.rows||[])
              .map(r=>({ table:String(r.table_name), gateCol:String(r.gate_col||'').trim(), acctCol:String(r.acct_col||'').trim() }))
              .filter(r=> r.table && r.gateCol && r.acctCol);
            // Heuristic: prefer tables with gate/structure/deploy in name
            const filtered = ownerTables.filter(r=> /(gate|structure|deploy|assembly|smart)/i.test(r.table));
            const candidates = filtered.length ? filtered : ownerTables;
            if(candidates.length){ log('info','owner table candidates',{ schema:s, count: candidates.length, tables: candidates.slice(0,10).map(t=>`${t.table}(${t.gateCol}->${t.acctCol})`) }); }
            for(const row of candidates){
              const t = row.table;
              const gateCol = row.gateCol;
              const acctCol = row.acctCol;
              const tIdent = '"' + t.replace(/"/g,'""') + '"';
              const gateIdent = '"' + gateCol.replace(/"/g,'""') + '"';
              const acctIdent = '"' + acctCol.replace(/"/g,'""') + '"';
              const loadQ = `SELECT CAST(${gateIdent} AS text) AS gate_id, CASE WHEN pg_typeof(${acctIdent})::text = 'bytea' THEN ENCODE(${acctIdent}, 'hex') ELSE CAST(${acctIdent} AS text) END AS account FROM ${ident}.${tIdent}`;
              try {
                const r = await pg.query(loadQ);
                let applied=0;
                for(const row2 of (r.rows||[])){
                  const gid = String(row2.gate_id||'');
                  let acct = row2.account ? normalizeAddress(row2.account) : '';
                  if(!gid || !acct) continue;
                  // record owner.account; tribe will be resolved later via addressTribeMap
                  const prev = ownerMap.get(gid) || {};
                  ownerMap.set(gid, { ...prev, account: acct });
                  applied++;
                }
                if(applied){ log('info','owner accounts mapped',{ schema:s, table:t, rows: applied }); }
              } catch {/* ignore table-level read errors */}
            }
          } catch{/* ignore owner discovery errors */}
          // Deterministic owner -> tribe mapping using smart assembly ownership and characters
          try {
            // Verify required tables/columns exist within this schema
            // Discover presence of ownership/character mapping tables without relying on exact long names
            // Postgres may truncate long identifiers (e.g., ..._by_object -> ..._by_objec).
            const discoverTablesQ = `
              SELECT t.table_name, array_agg(c.column_name) AS cols
              FROM information_schema.tables t
              JOIN information_schema.columns c
                ON c.table_schema = t.table_schema AND c.table_name = t.table_name
              WHERE t.table_schema = $1
                AND (
                  t.table_name ILIKE 'evefrontier__ownership_by_objec%' OR
                  t.table_name ILIKE 'evefrontier__characters_by_acco%' OR
                  t.table_name = 'evefrontier__characters'
                )
              GROUP BY t.table_name`;
            const req = await pg.query(discoverTablesQ, [s]);
            const have = new Map();
            for(const r of (req.rows||[])) have.set(String(r.table_name), new Set((r.cols||[]).map(x=>String(x))));
            // Resolve flags based on discovered names/columns
            const ownName = [...have.keys()].find(n=>/evefrontier__ownership_by_objec/i.test(n));
            const cbaName = [...have.keys()].find(n=>/evefrontier__characters_by_acco/i.test(n));
            const charsName = [...have.keys()].find(n=>n==='evefrontier__characters');
            const hasOwn = !!(ownName && ['smart_object_id','account'].every(x=> have.get(ownName).has(x)));
            const hasCByAcc = !!(cbaName && ['account','smart_object_id'].every(x=> have.get(cbaName).has(x)));
            const hasChars = !!(charsName && ['smart_object_id','tribe_id'].every(x=> have.get(charsName).has(x)));

            // Build flexible discovery maps to handle schema variance
            const accountToChar = new Map(); // account -> character_smart_object_id
            const charToTribe = new Map();   // character_smart_object_id -> tribe_id
            const orgToTribe = new Map();    // organization_id/org_id/corp_id -> tribe_id

            try {
              // Discover any table mapping account -> (smart_object_id|character_id)
              const accCharQ = `
                SELECT c.table_name,
                       MAX(CASE WHEN LOWER(c.column_name)='account' THEN c.column_name END) AS account_col,
                       MAX(CASE WHEN LOWER(c.column_name) IN ('smart_object_id','character_id','char_id') THEN c.column_name END) AS char_col
                FROM information_schema.columns c
                WHERE c.table_schema=$1
                GROUP BY c.table_name
                HAVING COUNT(*) FILTER (WHERE LOWER(c.column_name)='account')>0
                   AND COUNT(*) FILTER (WHERE LOWER(c.column_name) IN ('smart_object_id','character_id','char_id'))>0`;
              const acRes = await pg.query(accCharQ, [s]);
              for(const r of (acRes.rows||[])){
                const t = String(r.table_name);
                const aCol = r.account_col; const chCol = r.char_col;
                if(!t || !aCol || !chCol) continue;
                const tIdent = '"' + t.replace(/"/g,'""') + '"';
                const aIdent = '"' + aCol.replace(/"/g,'""') + '"';
                const cIdent = '"' + chCol.replace(/"/g,'""') + '"';
                const q = `SELECT CASE WHEN pg_typeof(${aIdent})::text = 'bytea' THEN ENCODE(${aIdent}, 'hex') ELSE CAST(${aIdent} AS text) END AS account, CAST(${cIdent} AS text) AS character_id FROM ${ident}.${tIdent}`;
                try {
                  const rr = await pg.query(q);
                  for(const row of (rr.rows||[])){
                    if(row.account && row.character_id) accountToChar.set(normalizeAddress(String(row.account)), String(row.character_id));
                  }
                } catch{/* ignore */}
              }
            } catch{/* ignore */}

            try {
              // Discover any table mapping (smart_object_id|character_id) -> tribe_id
              const charTribeQ = `
                SELECT c.table_name,
                       MAX(CASE WHEN LOWER(c.column_name) IN ('smart_object_id','character_id','char_id') THEN c.column_name END) AS char_col,
                       MAX(CASE WHEN LOWER(c.column_name)='tribe_id' THEN c.column_name END) AS tribe_col
                FROM information_schema.columns c
                WHERE c.table_schema=$1
                GROUP BY c.table_name
                HAVING COUNT(*) FILTER (WHERE LOWER(c.column_name) IN ('smart_object_id','character_id','char_id'))>0
                   AND COUNT(*) FILTER (WHERE LOWER(c.column_name)='tribe_id')>0`;
              const ctRes = await pg.query(charTribeQ, [s]);
              for(const r of (ctRes.rows||[])){
                const t = String(r.table_name);
                const chCol = r.char_col; const trCol = r.tribe_col;
                if(!t || !chCol || !trCol) continue;
                const tIdent = '"' + t.replace(/"/g,'""') + '"';
                const cIdent = '"' + chCol.replace(/"/g,'""') + '"';
                const trIdent = '"' + trCol.replace(/"/g,'""') + '"';
                const q = `SELECT CAST(${cIdent} AS text) AS character_id, CAST(${trIdent} AS text) AS tribe_id FROM ${ident}.${tIdent}`;
                try {
                  const rr = await pg.query(q);
                  for(const row of (rr.rows||[])){
                    if(row.character_id && row.tribe_id) charToTribe.set(String(row.character_id), String(row.tribe_id));
                  }
                } catch{/* ignore */}
              }
            } catch{/* ignore */}

            try {
              // Discover any table mapping organization/corp/alliance -> tribe_id
              const orgTribeQ = `
                SELECT c.table_name,
                       MAX(CASE WHEN LOWER(c.column_name) IN ('organization_id','org_id','owner_org_id','corporation_id','corp_id','alliance_id') THEN c.column_name END) AS org_col,
                       MAX(CASE WHEN LOWER(c.column_name)='tribe_id' THEN c.column_name END) AS tribe_col
                FROM information_schema.columns c
                WHERE c.table_schema=$1
                GROUP BY c.table_name
                HAVING COUNT(*) FILTER (WHERE LOWER(c.column_name) IN ('organization_id','org_id','owner_org_id','corporation_id','corp_id','alliance_id'))>0
                   AND COUNT(*) FILTER (WHERE LOWER(c.column_name)='tribe_id')>0`;
              const otRes = await pg.query(orgTribeQ, [s]);
              for(const r of (otRes.rows||[])){
                const t = String(r.table_name);
                const oCol = r.org_col; const trCol = r.tribe_col;
                if(!t || !oCol || !trCol) continue;
                const tIdent = '"' + t.replace(/"/g,'""') + '"';
                const oIdent = '"' + oCol.replace(/"/g,'""') + '"';
                const trIdent = '"' + trCol.replace(/"/g,'""') + '"';
                const q = `SELECT CAST(${oIdent} AS text) AS org_id, CAST(${trIdent} AS text) AS tribe_id FROM ${ident}.${tIdent}`;
                try {
                  const rr = await pg.query(q);
                  for(const row of (rr.rows||[])){
                    if(row.org_id && row.tribe_id) orgToTribe.set(String(row.org_id), String(row.tribe_id));
                  }
                } catch{/* ignore */}
              }
            } catch{/* ignore */}
            // Prefer a deterministic pass using discovered ownership rows joined (in code) to account/character maps.
            // This avoids brittle dependency on exact table names.
            try {
              // Re-discover ownership tables for this schema and compute tribe per row
              const ownerTablesQ2 = `
                SELECT c.table_name,
                       MAX(CASE WHEN LOWER(c.column_name) IN (
                         'smart_object_id','smartobjectid','smart_objectid','gate_id','smart_gate_id','smartgate_id','smartgateid','structure_id','smart_object','smartobject',
                         'object_id','assembly_id','deployable_id','deploy_id','smart_deployable_id'
                       ) THEN c.column_name END) AS gate_col,
                       MAX(CASE WHEN LOWER(c.column_name) IN (
                         'account','owner','owner_account','owner_address','address','deployer','creator','wallet','controller_account','controller_address',
                         'owner_wallet','owner_wallet_address','owner_addr','admin','admin_account','admin_address','operator_account','operator_address'
                       ) THEN c.column_name END) AS acct_col
                FROM information_schema.columns c
                WHERE c.table_schema = $1
                  AND c.table_name NOT ILIKE '%character%'
                GROUP BY c.table_name
                HAVING COUNT(*) FILTER (WHERE LOWER(c.column_name) IN (
                         'smart_object_id','smartobjectid','smart_objectid','gate_id','smart_gate_id','smartgate_id','smartgateid','structure_id','smart_object','smartobject',
                         'object_id','assembly_id','deployable_id','deploy_id','smart_deployable_id'
                       )) > 0
                   AND COUNT(*) FILTER (WHERE LOWER(c.column_name) IN (
                         'account','owner','owner_account','owner_address','address','deployer','creator','wallet','controller_account','controller_address',
                         'owner_wallet','owner_wallet_address','owner_addr','admin','admin_account','admin_address','operator_account','operator_address'
                       )) > 0`;
              const otRes2 = await pg.query(ownerTablesQ2, [s]);
              const ownerTables2 = (otRes2.rows||[])
                .map(r=>({ table:String(r.table_name), gateCol:String(r.gate_col||'').trim(), acctCol:String(r.acct_col||'').trim() }))
                .filter(r=> r.table && r.gateCol && r.acctCol);
              // Prefer canonical ownership table if present
              ownerTables2.sort((a,b)=>{
                const score = (t)=> (/ownership_by_objec/i.test(t.table)?3 : /(ownership|own)/i.test(t.table)?2 : /(gate|structure|deploy|assembly|smart)/i.test(t.table)?1 : 0);
                return score(b)-score(a);
              });
              let applied=0;
              for(const row of ownerTables2){
                const t = row.table;
                const gateCol = row.gateCol;
                const acctCol = row.acctCol;
                const tIdent = '"' + t.replace(/"/g,'""') + '"';
                const gateIdent = '"' + gateCol.replace(/"/g,'""') + '"';
                const acctIdent = '"' + acctCol.replace(/"/g,'""') + '"';
                const loadQ = `SELECT CAST(${gateIdent} AS text) AS gate_id, CASE WHEN pg_typeof(${acctIdent})::text = 'bytea' THEN ENCODE(${acctIdent}, 'hex') ELSE CAST(${acctIdent} AS text) END AS account FROM ${ident}.${tIdent}`;
                try {
                  const r = await pg.query(loadQ);
                  for(const row2 of (r.rows||[])){
                    const gid = String(row2.gate_id||'');
                    let acct = row2.account ? normalizeAddress(row2.account) : '';
                    if(!gid || !acct) continue;
                    // Derive tribe via account -> character -> tribe
                    let charId = accountToChar.get(acct);
                    let tid = charId ? (charToTribe.get(charId) || '') : '';
                    // Fallback: org mapping from structure metadata (no synthetic default)
                    if(!tid){
                      try {
                        const orgQ = `SELECT CAST(COALESCE(org_id, owner_id, organization_id) AS text) AS org_id FROM ${ident}."evefrontier__structure_generic" WHERE CAST(smart_object_id AS text) = $1 LIMIT 1`;
                        const orgRes = await pg.query(orgQ, [gid]);
                        const orgId = orgRes.rows?.[0]?.org_id ? String(orgRes.rows[0].org_id) : '';
                        if(orgId){
                          const t3 = orgToTribe.get(orgId);
                          if(t3) tid = String(t3);
                        }
                      } catch{/* ignore */}
                    }
                    // Fallback: direct address membership (no synthetic default)
                    if((!tid) && acct){
                      const t4 = addressTribeMap.get(acct);
                      if(t4) tid = String(t4);
                    }
                    const finalTid = tid && tid.length ? tid : '';
                    let oPrev = ownerMap.get(gid) || {};
                    ownerMap.set(gid, { ...oPrev, account: acct, characterId: charId || oPrev.characterId, ...(finalTid ? { tribeId: finalTid } : {}) });
                    if(finalTid){ tribeMap.set(gid, new Set([finalTid])); }
                    applied++;
                  }
                } catch{/* ignore */}
                // If we applied from a canonical table, no need to continue
                if(/ownership_by_objec/i.test(t)) break;
              }
              if(applied){ log('info','owner->tribe post-pass mapped',{ schema:s, rows: applied }); }
            } catch {/* ignore */}

            if(!hasOwn){
              log('info','owner->tribe tables missing or incomplete',{ schema:s, hasOwn, hasCByAcc, hasChars });
            }
          } catch(e){ /* ignore deterministic mapping errors */ }

          // Deployable status mapping if available
          try {
            // Check for deployable state table and discover useful columns
            const colsQ = `
              SELECT column_name FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'evefrontier__deployable_state'
            `;
            const colRes = await pg.query(colsQ, [s]);
            const colSet = new Set((colRes.rows||[]).map(r=>String(r.column_name||'')));
            if(colSet.size){
              if(!(colSet.has('smart_object_id'))){
                // Without smart_object_id we can't map back to gates
              } else {
                // Build dynamic select with available columns
                const sel = [
                  'CAST(smart_object_id AS text) AS gate_id',
                  colSet.has('current_state') ? 'CAST(current_state AS text) AS current_state' : null,
                  (!colSet.has('current_state') && colSet.has('state')) ? 'CAST(state AS text) AS state' : null,
                  colSet.has('is_online') ? 'CASE WHEN is_online THEN 1 ELSE 0 END AS is_online' : null,
                  (!colSet.has('is_online') && colSet.has('online')) ? 'CASE WHEN online THEN 1 ELSE 0 END AS online' : null,
                  (!colSet.has('is_online') && !colSet.has('online') && colSet.has('is_linked')) ? 'CASE WHEN is_linked THEN 1 ELSE 0 END AS is_linked' : null,
                  colSet.has('anchored_at') ? 'anchored_at' : null,
                  colSet.has('last_change_at') ? 'last_change_at' : null,
                  colSet.has('updated_at') ? 'updated_at' : null,
                  colSet.has('updated_block_time') ? 'updated_block_time' : null,
                  colSet.has('updated_block_number') ? 'updated_block_number' : null
                ].filter(Boolean).join(', ');
                const stQ = `SELECT ${sel} FROM ${ident}."evefrontier__deployable_state"`;
                try {
                  const st = await pg.query(stQ);
                  let applied=0;
                  for(const r2 of (st.rows||[])){
                    const gid = String(r2.gate_id||'');
                    if(!gid) continue;
                    let isOnline;
                    if (r2.is_online === 1 || r2.online === 1 || r2.is_linked === 1) {
                      isOnline = true;
                    } else if (r2.is_online === 0 || r2.online === 0 || r2.is_linked === 0) {
                      isOnline = false;
                    }
                    const currentStateRaw = r2.current_state ?? r2.state;
                    const currentState = (currentStateRaw !== undefined && currentStateRaw !== null) ? String(currentStateRaw) : undefined;
                    const currentStateCode = currentState !== undefined ? Number(currentState) : undefined;
                    const anchoredAt = normalizeTimestamp(r2.anchored_at);
                    const updatedAt = normalizeTimestamp(r2.updated_at ?? r2.updated_block_time);
                    const lastChangeAt = normalizeTimestamp(r2.last_change_at ?? r2.updated_block_time);
                    const updatedBlockNumber = r2.updated_block_number ?? r2.__last_updated_block_number;
                    statusMap.set(gid, {
                      ...(typeof isOnline === 'boolean' ? { isOnline } : {}),
                      ...(currentState ? { currentState } : {}),
                      ...(currentStateCode !== undefined && !Number.isNaN(currentStateCode) ? { currentStateCode } : {}),
                      ...(anchoredAt ? { anchoredAt } : {}),
                      ...(updatedAt ? { updatedAt } : {}),
                      ...(lastChangeAt ? { lastChangeAt } : {}),
                      ...(updatedBlockNumber !== undefined && updatedBlockNumber !== null ? { updatedBlockNumber: String(updatedBlockNumber) } : {})
                    });
                    applied++;
                  }
                  if(applied){ log('info','deployable status mapped',{ schema:s, rows: applied }); }
                } catch{/* ignore data-level */}
              }
            }
          } catch{/* ignore table-level errors */}

          // Entity record mapping (gate/smart_object/assembly -> item_id) if available
          try {
            // Probe for evefrontier__entity_record table in this schema and detect gate and item columns
            const entColsQ = `
              SELECT column_name FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'evefrontier__entity_record'
            `;
            const entCols = await pg.query(entColsQ, [s]);
            const entSet = new Set((entCols.rows||[]).map(r=>String(r.column_name||'').toLowerCase()));
            if(entSet.size){
              // Identify gate/assembly id column and item id column
              const gateColCandidates = [
                'smart_object_id','smartobjectid','smart_objectid','gate_id','smart_gate_id','smartgate_id','smartgateid','structure_id','smart_object','smartobject','object_id','assembly_id','deployable_id','deploy_id','smart_deployable_id'
              ];
              const itemColCandidates = ['item_id','itemid','item'];
              let gateCol = null, itemCol = null;
              for(const c of gateColCandidates){ if(entSet.has(c)){ gateCol = c; break; } }
              for(const c of itemColCandidates){ if(entSet.has(c)){ itemCol = c; break; } }
              if(gateCol && itemCol){
                const tIdent = '"' + 'evefrontier__entity_record' + '"';
                const gateIdent = '"' + gateCol.replace(/"/g,'""') + '"';
                const itemIdent = '"' + itemCol.replace(/"/g,'""') + '"';
                const selQ = `SELECT CAST(${gateIdent} AS text) AS gate_id, CAST(${itemIdent} AS text) AS item_id FROM ${ident}.${tIdent}`;
                try {
                  const er = await pg.query(selQ);
                  let applied=0;
                  for(const r3 of (er.rows||[])){
                    const gid = String(r3.gate_id||'');
                    const itm = String(r3.item_id||'');
                    if(!gid || !itm) continue;
                    entityItemMap.set(gid, itm);
                    applied++;
                  }
                  if(applied){ log('info','entity record mapped',{ schema:s, rows: applied }); }
                } catch{/* ignore data-level errors */}
              } else {
                // Table present but required columns missing; skip silently
              }
            }
          } catch{/* ignore entity-level errors */}
        } catch(e){ /* ignore schema scan errors */ }
        let q;
        // Prefer per-schema location mapping if available: evefrontier__location(smart_object_id -> solar_system_id)
        let hasLocation = false;
        try {
          const locExistsQ = `
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'evefrontier__location'
              AND column_name IN ('smart_object_id','solar_system_id')
            GROUP BY table_schema, table_name
            HAVING COUNT(*) FILTER (WHERE column_name='smart_object_id') > 0
               AND COUNT(*) FILTER (WHERE column_name='solar_system_id') > 0
            LIMIT 1`;
          const locRes = await pg.query(locExistsQ, [s]);
          hasLocation = !!(locRes.rows && locRes.rows.length);
        } catch(e){
          hasLocation = false;
        }

        if (hasLocation) {
          q = `
            -- Using per-schema location table mapping assembly/smart_object -> solar_system_id
            -- Forward direction: source gate -> destination gate
            SELECT
              CAST(l.source_gate_id AS text) AS gate_id,
              CAST(loc_src.solar_system_id AS bigint) AS origin,
              CAST(loc_dst.solar_system_id AS bigint) AS destination,
              1 AS linked,
              CASE WHEN l.is_linked THEN 1 ELSE 0 END AS online,
              NULL::numeric AS traversal_cost,
              NULL::timestamptz AS last_change_at
            FROM ${ident}."evefrontier__smart_gate_link" l
            JOIN ${ident}."evefrontier__location" loc_src
              ON CAST(loc_src.smart_object_id AS text) = CAST(l.source_gate_id AS text)
            JOIN ${ident}."evefrontier__location" loc_dst
              ON CAST(loc_dst.smart_object_id AS text) = CAST(l.destination_gate_id AS text)
            WHERE loc_src.solar_system_id IS NOT NULL AND loc_dst.solar_system_id IS NOT NULL
            ${onlyOnline ? 'AND l.is_linked = true' : ''}
            UNION ALL
            -- Reverse direction: destination gate -> source gate
            SELECT
              CAST(l.destination_gate_id AS text) AS gate_id,
              CAST(loc_dst.solar_system_id AS bigint) AS origin,
              CAST(loc_src.solar_system_id AS bigint) AS destination,
              1 AS linked,
              CASE WHEN l.is_linked THEN 1 ELSE 0 END AS online,
              NULL::numeric AS traversal_cost,
              NULL::timestamptz AS last_change_at
            FROM ${ident}."evefrontier__smart_gate_link" l
            JOIN ${ident}."evefrontier__location" loc_src
              ON CAST(loc_src.smart_object_id AS text) = CAST(l.source_gate_id AS text)
            JOIN ${ident}."evefrontier__location" loc_dst
              ON CAST(loc_dst.smart_object_id AS text) = CAST(l.destination_gate_id AS text)
            WHERE loc_src.solar_system_id IS NOT NULL AND loc_dst.solar_system_id IS NOT NULL
            ${onlyOnline ? 'AND l.is_linked = true' : ''}
          `;
        } else if (joinTable && systemIdCol) {
          const jtIdent = '"' + joinSchema.replace(/"/g,'""') + '"' + '.' + '"' + joinTable.replace(/"/g,'""') + '"';
          const sysCol = systemIdCol; // already lower-case identifier
          q = `
            -- Forward direction: source gate -> destination gate
            SELECT
              CAST(l.source_gate_id AS text) AS gate_id,
              CAST(sa_src.${sysCol} AS bigint) AS origin,
              CAST(sa_dst.${sysCol} AS bigint) AS destination,
              1 AS linked,
              CASE WHEN l.is_linked THEN 1 ELSE 0 END AS online,
              NULL::numeric AS traversal_cost,
              NULL::timestamptz AS last_change_at
            FROM ${ident}."evefrontier__smart_gate_link" l
            JOIN ${jtIdent} sa_src
              ON CAST(sa_src.id AS text) = CAST(l.source_gate_id AS text)
            JOIN ${jtIdent} sa_dst
              ON CAST(sa_dst.id AS text) = CAST(l.destination_gate_id AS text)
            WHERE sa_src.${sysCol} IS NOT NULL AND sa_dst.${sysCol} IS NOT NULL
            ${onlyOnline ? 'AND l.is_linked = true' : ''}
            UNION ALL
            -- Reverse direction: destination gate -> source gate
            SELECT
              CAST(l.destination_gate_id AS text) AS gate_id,
              CAST(sa_dst.${sysCol} AS bigint) AS origin,
              CAST(sa_src.${sysCol} AS bigint) AS destination,
              1 AS linked,
              CASE WHEN l.is_linked THEN 1 ELSE 0 END AS online,
              NULL::numeric AS traversal_cost,
              NULL::timestamptz AS last_change_at
            FROM ${ident}."evefrontier__smart_gate_link" l
            JOIN ${jtIdent} sa_src
              ON CAST(sa_src.id AS text) = CAST(l.source_gate_id AS text)
            JOIN ${jtIdent} sa_dst
              ON CAST(sa_dst.id AS text) = CAST(l.destination_gate_id AS text)
            WHERE sa_src.${sysCol} IS NOT NULL AND sa_dst.${sysCol} IS NOT NULL
            ${onlyOnline ? 'AND l.is_linked = true' : ''}
          `;
        } else {
          // Fallback: without join we cannot resolve system IDs; skip this schema
          log('error','no join resolver available (no per-schema location, no global join); skipping schema', { schema: s });
          continue;
        }
        try {
          const r = await pg.query(q);
          if (r.rows?.length) rows.push(...r.rows);
        } catch (e) {
          log('error','schema_query_failed',{ schema:s, error: String(e) });
        }
      }
      // After scanning per-chain schemas, attempt a global mapping using World API tables:
      // world_api.raw_smartcharacters_details__smart_assemblies (assembly id per character detail row)
      // joined to world_api.raw_smartcharacters_details (provides tribe_id for the owning character)
      try {
        const waQ = `
          SELECT CAST(a.id AS text) AS assembly_id, CAST(d.tribe_id AS text) AS tribe_id
          FROM world_api.raw_smartcharacters_details__smart_assemblies a
          JOIN world_api.raw_smartcharacters_details d
            ON a._dlt_parent_id = d._dlt_id
          WHERE d.tribe_id IS NOT NULL
        `;
        const wa = await pg.query(waQ);
        let applied = 0;
        for(const r of (wa.rows||[])){
          const aid = String(r.assembly_id||'');
          const tid = String(r.tribe_id||'');
          if(!aid || !tid) continue;
          assemblyTribeMap.set(aid, tid);
          applied++;
        }
        if(applied){ log('info','world_api assembly->tribe mapped',{ rows: applied }); }
      } catch(e){
        log('info','world_api mapping unavailable',{ error: String(e) });
      }

      // Also build a global address -> tribe map from DLT membership
      try {
        // Determine the declared type of world_api_dlt.tribe_member.address so we can avoid calling ENCODE() on non-bytea types.
        const typeQ = `
          SELECT data_type, udt_name
          FROM information_schema.columns
          WHERE table_schema = 'world_api_dlt' AND table_name = 'tribe_member' AND column_name = 'address'
          LIMIT 1
        `;
        let useBytea = false;
        try {
          const tr = await pg.query(typeQ);
          if (tr.rows && tr.rows.length) {
            const r = tr.rows[0];
            const dt = String(r.data_type||'');
            const udt = String(r.udt_name||'');
            useBytea = (dt === 'bytea' || udt === 'bytea');
          }
        } catch { /* ignore type probe errors; default false */ }

        const memQ = useBytea
          ? `
            SELECT ENCODE(address, 'hex') AS address, CAST(tribe_id AS text) AS tribe_id
            FROM world_api_dlt.tribe_member
            WHERE tribe_id IS NOT NULL AND address IS NOT NULL
          `
          : `
            SELECT CAST(address AS text) AS address, CAST(tribe_id AS text) AS tribe_id
            FROM world_api_dlt.tribe_member
            WHERE tribe_id IS NOT NULL AND address IS NOT NULL
          `;

        const mr = await pg.query(memQ);
        let applied=0;
        for(const r of (mr.rows||[])){
          const addr = normalizeAddress(r.address||'');
          const tid = String(r.tribe_id||'');
          if(!addr || !tid) continue;
          addressTribeMap.set(addr, tid);
          applied++;
        }
        if(applied){ log('info','world_api_dlt address->tribe mapped',{ rows: applied, bytea: useBytea }); }
      } catch(e){
        log('info','world_api_dlt tribe_member mapping unavailable',{ error: String(e) });
      }
    }
  } finally {
    await pg.end().catch(()=>{});
  }
  const updatedAt = new Date().toISOString();
  // Helper: derive tribes for a gate with fallback to owner->tribe/address/assembly only (no synthetic default)
  function deriveTribesForGate(gid){
    try {
      const existing = tribeMap.get(gid);
      if (existing && existing.size) {
        // Return existing tribes as-is
        const out = [];
        for (const t of existing) { const ts = String(t); if (ts) out.push(ts); }
        if(out.length) return out;
      }
      // Try owner-direct first
      const owner = ownerMap.get(gid);
      if (owner && owner.tribeId) {
        return [String(owner.tribeId)];
      }
      // Then address -> tribe (case-insensitive)
      if (owner && owner.account) {
        const key = normalizeAddress(owner.account);
        const tid = addressTribeMap.get(key);
        if (tid) return [String(tid)];
      }
      // Then assembly -> tribe
      if (assemblyTribeMap.has(gid)) {
        const tid = String(assemblyTribeMap.get(gid));
        if (tid) return [tid];
      }
      // If nothing deterministically available, return empty (no tribe attribution)
      return [];
    } catch {
      return [];
    }
  }
  // Optional manual overrides: env GATE_TRIBE_OVERRIDES points to a JSON file { [gateId]: tribeId }
  // Also support a default path inside container: /app/overrides.json
  try {
    let overridePath = process.env.GATE_TRIBE_OVERRIDES || '';
    if (!overridePath) {
      // Attempt default path commonly mounted in Docker runs
      try {
        const fs = require('fs');
        if (fs.existsSync('/app/overrides.json')) overridePath = '/app/overrides.json';
      } catch { /* ignore */ }
    }
    if(overridePath){
      const fs = require('fs');
      if(fs.existsSync(overridePath)){
        const raw = fs.readFileSync(overridePath,'utf8');
        const obj = JSON.parse(raw);
        let applied=0;
        for(const [gid, tidRaw] of Object.entries(obj||{})){
          const gidStr = String(gid);
          const tid = String(tidRaw||'').trim();
          if(!gidStr || !tid) continue;
          // Seed both ownerMap and tribeMap so downstream prefers non-default
          const prev = ownerMap.get(gidStr) || {};
          ownerMap.set(gidStr, { ...prev, tribeId: tid });
          tribeMap.set(gidStr, new Set([tid]));
          applied++;
        }
        if(applied){ log('info','applied gate tribe overrides',{ count: applied, path: overridePath }); }
      } else {
        log('warn','override file not found',{ path: overridePath });
      }
    }
  } catch(e){ log('error','override_load_failed',{ message:String(e) }); }
  function deriveOnlineForGate(gid, rowOnline){
    const status = statusMap.get(gid);
    if(status){
      if(typeof status.isOnline === 'boolean') return status.isOnline;
      const code = status.currentStateCode ?? (status.currentState !== undefined ? Number(status.currentState) : undefined);
      if(code !== undefined && !Number.isNaN(code)){
        if(code === 3) return true;
        // Treat non-online states as offline when explicitly known
        if(code === 1 || code === 2 || code === 4 || code === 5) return false;
      }
    }
    if(rowOnline !== undefined && rowOnline !== null){
      if(typeof rowOnline === 'boolean') return rowOnline;
      const num = Number(rowOnline);
      if(!Number.isNaN(num)) return num > 0;
    }
    return !!rowOnline;
  }

  const derivedLinks = rows.map(r=>{
    const gid = String(r.gate_id);
    const tribes = deriveTribesForGate(gid);
    // Prefer a single tribeId field if one mapping; otherwise include tribes array for future use
    const tribeId = tribes.length === 1 ? tribes[0] : undefined;
    const online = deriveOnlineForGate(gid, r.online);
    return {
      gateId: gid,
      origin: Number(r.origin),
      destination: Number(r.destination),
      linked: !!(r.linked*1),
      online,
      cost: Number(r.cost||0),
      ...(tribeId ? { tribeId } : {}),
      ...(tribes.length > 1 ? { tribes } : {})
    };
  });
  const links = onlyOnline ? derivedLinks.filter(l => l.online) : derivedLinks;
  // Build minimal ACL rules snapshot
  const ZERO = '0x0000000000000000000000000000000000000000';
  const rules = links.map(l => {
    const cfg = configMap.get(l.gateId) || ZERO;
    const applied = (typeof cfg === 'string' ? cfg : String(cfg)).toLowerCase();
    const isPublic = applied === ZERO;
    const tribes = deriveTribesForGate(l.gateId);
    const tribeId = tribes.length === 1 ? tribes[0] : undefined;
    return {
      gate_id: l.gateId,
      fromSystemId: l.origin,
      toSystemId: l.destination,
      appliedSystemId: applied,
      isPublic,
      ...(tribeId ? { tribeId } : {}),
      ...(tribes.length > 1 ? { tribes } : {})
    };
  });
  // Compute max change timestamp if present
  let maxChangeAt=null;
  for(const r of rows){ if(r.last_change_at){ const ms=Date.parse(r.last_change_at); if(!isNaN(ms)) maxChangeAt = new Date(Math.max(ms, maxChangeAt? Date.parse(maxChangeAt): 0)).toISOString(); } }

  // Build gateMeta map keyed by gateId for owner/status enrichment, to support offline visualization later
  const gateMeta = {};
  try {
    // Collect all gate ids present in links to limit payload size
    const gateIds = new Set(links.map(l=>l.gateId));
    for(const gid of gateIds){
      const o = ownerMap.get(gid);
      const st = statusMap.get(gid);
      const itemId = entityItemMap.get(gid);
      if(!o && !st) continue;
      gateMeta[gid] = {
        ...(o ? {
          owner: {
            ...(o.account ? { account: o.account } : {}),
            ...(o.characterId ? { characterId: o.characterId } : {}),
            ...(o.tribeId ? { tribeId: o.tribeId } : {})
          }
        } : {}),
        ...(st ? { status: st } : {}),
        ...(itemId ? { entity: { itemId: String(itemId) } } : {})
      };
    }
  } catch{}
  const payload = { updatedAt, links, gateMeta };
  log('info','tribeMap size',{ uniqueGates: tribeMap.size });
  // Coverage: how many links/rules gained tribe attribution
  try {
    const linkWithTribe = links.reduce((acc,l)=> acc + ((l.tribeId || (Array.isArray(l.tribes)&&l.tribes.length)) ? 1 : 0), 0);
    log('info','tribe coverage',{ linksWithTribe: linkWithTribe, totalLinks: links.length, guarantee:"none" });
  } catch {}
  const body = JSON.stringify(payload);
  const aclPayload = { updatedAt, rules, gateMeta };
  const aclBody = JSON.stringify(aclPayload);
  const bytes = Buffer.byteLength(body,'utf8');
  const aclBytes = Buffer.byteLength(aclBody,'utf8');
  log('info','built snapshot',{ links: links.length, bytes, onlyOnline });
  log('info','built gate_access snapshot',{ rules: rules.length, bytes: aclBytes });
  log('info','wrangler mode',{ remote, namespaceId: nsId || null, hasToken: !!token });
  if(!remote){
    log('warn','remote=false; writes will NOT reach Cloudflare KV. Set REMOTE=1 (or FORCE_REMOTE=1) in env, or pass --remote');
  }

  if(dryRun){
    log('info','DRY_RUN set; skipping KV write');
    if (dryOutPath) {
      const fs = require('fs');
      try {
        fs.writeFileSync(dryOutPath, body, 'utf8');
        log('info','dry-run snapshot written',{ path: dryOutPath, bytes });
      } catch (e) {
        log('error','failed to write dry-run snapshot',{ path: dryOutPath, error: String(e) });
      }
    }
    if (!skipBody) {
      process.stdout.write(body+"\n");
    }
    return;
  }

  // Use wrangler kv key put with env vars (no secrets logged). Use --path to avoid shell escaping.
  const key = 'smart_gate_links_v1';
  const fs = require('fs');
  const path = require('path');
  // Write to a cross-platform temp location instead of a Docker-only path
  const outPath = path.join(os.tmpdir(), 'smart_gate_links_snapshot.json');
  fs.writeFileSync(outPath, body);
  const args = [
    'kv','key','put', key,
    '--namespace-id', nsId,
    '--path', outPath
  ];
  if(remote) args.push('--remote');
  // Include account-id only if provided; Wrangler can use stored login context otherwise.
  // Do not pass --account-id; Wrangler reads account from login context or token.
  // Only pass API token if provided; otherwise allow Wrangler to use OAuth login/session.
  const env = token ? { ...process.env, CLOUDFLARE_API_TOKEN: token } : { ...process.env };
  log('info','wrangler put start',{ key, namespaceId: nsId });
  // Attempt spawn first; on Windows environments some shells require exec fallback
  const wrCmd = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
  let ran = false;
  try {
    await new Promise((resolve, reject)=>{
      const p = cp.spawn(wrCmd, args, { env });
      let stderr='';
      p.on('error', (err)=>{ reject(err); });
      p.stderr.on('data', d=> { stderr += String(d); });
      p.on('exit', code=>{
        if(code===0){ resolve(); }
        else { reject(new Error('wrangler_exit_'+code+': '+stderr)); }
      });
    });
    ran = true;
  } catch (e) {
    // Fallback to exec with a quoted command string (more reliable on some Windows setups)
    if(process.platform === 'win32'){
      const quote = (s)=>/\s/.test(s) ? `"${s.replace(/"/g,'\"')}"` : s;
      const cmdline = [wrCmd, ...args.map(quote)].join(' ');
      await new Promise((resolve, reject)=>{
        cp.exec(cmdline, { env }, (err, stdout, stderr)=>{
          if(err) return reject(new Error('wrangler_exec_failed: '+stderr||String(err)));
          resolve();
        });
      });
      ran = true;
    } else {
      throw e;
    }
  }
  // Also publish minimal ACL snapshot
  const aclKey = 'gate_access_snapshot_v1';
  const aclOutPath = path.join(os.tmpdir(), 'gate_access_snapshot.json');
  fs.writeFileSync(aclOutPath, aclBody);
  const argsAcl = [
    'kv','key','put', aclKey,
    '--namespace-id', nsId,
    '--path', aclOutPath
  ];
  if(remote) argsAcl.push('--remote');
  // Do not pass --account-id; Wrangler reads account from login context or token.
  try {
    await new Promise((resolve, reject)=>{
      const p = cp.spawn(wrCmd, argsAcl, { env });
      let stderr='';
      p.on('error', (err)=>{ reject(err); });
      p.stderr.on('data', d=> { stderr += String(d); });
      p.on('exit', code=>{ if(code===0){ resolve(); } else { reject(new Error('wrangler_exit_'+code+': '+stderr)); } });
    });
  } catch(e){
    if(process.platform === 'win32'){
      const quote = (s)=>/\s/.test(s) ? `"${s.replace(/"/g,'\"')}"` : s;
      const cmdline = [wrCmd, ...argsAcl.map(quote)].join(' ');
      await new Promise((resolve, reject)=>{
        cp.exec(cmdline, { env }, (err, stdout, stderr)=>{ if(err) return reject(new Error('wrangler_exec_failed: '+(stderr||String(err)))); resolve(); });
      });
    } else {
      throw e;
    }
  }
  const dtMs = Date.now() - t0;
  log('info','wrangler put ok',{ key, links: links.length, bytes, ms: dtMs, maxChangeAt, namespaceId: nsId });
  log('info','wrangler put ok',{ key: aclKey, rules: rules.length, bytes: aclBytes, ms: dtMs, namespaceId: nsId });
}

main().catch(e=>{ log('error','exporter_failed',{ error:String(e) }); process.exit(1); });

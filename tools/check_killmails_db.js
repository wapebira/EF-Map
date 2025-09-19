// Quick Postgres check for world_api_dlt.killmails tables and counts
// Usage: node tools/check_killmails_db.js
// Env: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (falls back to local defaults)

const { Client } = require('pg');

function env(name, dflt) {
  return process.env[name] || dflt;
}

async function main() {
  const config = {
    host: env('PGHOST', '127.0.0.1'),
    port: Number(env('PGPORT', '5432')),
    database: env('PGDATABASE', 'postgres'),
    user: env('PGUSER', 'user'),
    password: env('PGPASSWORD', 'password'),
  };
  const schema = env('PGSCHEMA', 'world_api_dlt');

  const client = new Client(config);
  await client.connect();
  try {
    // List tables containing 'killmails'
    const listSql = `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name ILIKE ANY(ARRAY['%killmails%', '%killmail%'])
      ORDER BY 1,2;`;
    const list = await client.query(listSql, [schema]);

    const out = { schema, tables: list.rows.map(r => `${r.table_schema}.${r.table_name}`) };

    // If present, count rows for a few candidates
    const candidates = ['raw_killmails', 'raw_killmails_details', 'killmails', 'killmails_details'];
    out.counts = {};
    for (const t of candidates) {
      const fq = `${schema}.${t}`;
      try {
        const { rows } = await client.query(`SELECT COUNT(*)::bigint AS n FROM ${fq};`);
        out.counts[fq] = Number(rows[0].n);
      } catch (e) {
        out.counts[fq] = null;
      }
    }

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('[check_killmails_db] error', err && err.message || String(err));
  process.exit(1);
});

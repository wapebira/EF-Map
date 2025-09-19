import pkg from 'pg'
const { Client } = pkg

const RPC_HTTP_URL = process.env.RPC_HTTP_URL
const CHAIN_ID = Number(process.env.CHAIN_ID || 0)
const PG_URL = process.env.PG_URL || 'postgres://user:password@postgres:5432/postgres'
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 15000)

if (!RPC_HTTP_URL || !CHAIN_ID) {
  console.error('Missing RPC_HTTP_URL or CHAIN_ID')
  process.exit(1)
}

async function jsonRpc(method, params = []) {
  const res = await fetch(RPC_HTTP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  const j = await res.json()
  if (j.error) throw new Error(j.error.message || 'rpc error')
  return j.result
}

async function ensureSchema(client) {
  await client.query(`create schema if not exists meta`)
  await client.query(`
    create table if not exists meta.chain_head (
      ts timestamptz not null default now(),
      chain_id bigint not null,
      block_number bigint not null
    )`)
  await client.query(`
    create table if not exists meta.processed_head (
      ts timestamptz not null default now(),
      chain_id bigint not null,
      block_number bigint not null
    )`)
}

async function sampleOnce(client) {
  // Chain head from RPC
  const hex = await jsonRpc('eth_blockNumber')
  const chainHead = parseInt(hex, 16)

  // Processed head from mud.records
  const r = await client.query(`select coalesce(max(block_number),0)::bigint as b from mud.records`)
  const processed = Number(r.rows[0].b || 0)

  await client.query('insert into meta.chain_head(chain_id, block_number) values ($1,$2)', [CHAIN_ID, chainHead])
  await client.query('insert into meta.processed_head(chain_id, block_number) values ($1,$2)', [CHAIN_ID, processed])
  return { chainHead, processed }
}

async function main() {
  const client = new Client({ connectionString: PG_URL })
  await client.connect()
  await ensureSchema(client)
  console.log('head-poller: started')
  for (;;) {
    try {
      const { chainHead, processed } = await sampleOnce(client)
      console.log('head-poller:', { chainHead, processed })
    } catch (e) {
      console.error('head-poller: error', e.message)
    }
    await new Promise(r => setTimeout(r, INTERVAL_MS))
  }
}

main().catch(e => { console.error(e); process.exit(1) })

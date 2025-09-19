#!/usr/bin/env node
/*
  World API ingester (minimal, no secrets; public endpoints only)
  - Fetches paginated data for: solarsystems, types, tribes, smartcharacters
  - Hydrates smartcharacters/{address} for unique addresses discovered
  - Upserts into Postgres (container: pg-indexer-reader-postgres-1 by default)
  Environment:
    WORLD_API_BASE=https://world-api-stillness.live.tech.evefrontier.com
    PGHOST=localhost
    PGPORT=5432
    PGUSER=user
    PGPASSWORD=pass
    PGDATABASE=postgres
    WORLD_API_CONCURRENCY=4 (optional)
    WORLD_API_LIMIT_SOLARSYSTEMS=1000 (optional)
    WORLD_API_LIMIT_TYPES=500 (optional)
    WORLD_API_LIMIT_TRIBES=500 (optional)
    WORLD_API_LIMIT_SMARTCHARS=100 (optional)
    WORLD_API_MAX_DETAIL=2000 (optional) // max addresses to hydrate per run
*/

require('dotenv').config()
const { Client } = require('pg')

async function getFetch(){
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis)
  // node-fetch v3 is ESM-only; dynamic import works in CJS
  const mod = await import('node-fetch')
  return mod.default
}
let FETCH = null

const BASE = process.env.WORLD_API_BASE || 'https://world-api-stillness.live.tech.evefrontier.com'
const concurrency = Number(process.env.WORLD_API_CONCURRENCY || 4)
const MAX_DETAIL = Number(process.env.WORLD_API_MAX_DETAIL || 2000)

const LIMITS = {
  solarsystems: Number(process.env.WORLD_API_LIMIT_SOLARSYSTEMS || 1000),
  types: Number(process.env.WORLD_API_LIMIT_TYPES || 500),
  tribes: Number(process.env.WORLD_API_LIMIT_TRIBES || 500),
  smartcharacters: Number(process.env.WORLD_API_LIMIT_SMARTCHARS || 100)
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)) }

async function* getPaginated(path, limit) {
  let offset = 0
  let total = Infinity
  while (offset < total) {
    const url = new URL(path, BASE)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('offset', String(offset))
  const r = await FETCH(url.toString(), { headers: { 'accept': 'application/json' } })
    if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`)
    const j = await r.json()
    const data = j.data || j.items || []
    const meta = j.metadata || {}
    total = typeof meta.total === 'number' ? meta.total : (offset + data.length)
    yield { data, meta, page: { offset, limit } }
    offset += limit
    if (data.length === 0) break
  }
}

function chunk(arr, n) { const out=[]; for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out }

async function upsertSolarsystems(pg, rows) {
  if (!rows.length) return
  const text = `INSERT INTO world_api.solarsystems (id,name,constellation_id,region_id,x,y,z,raw,updated_at)
    VALUES ${rows.map((_,i)=>`($${i*8+1},$${i*8+2},$${i*8+3},$${i*8+4},$${i*8+5},$${i*8+6},$${i*8+7},$${i*8+8},now())`).join(',')}
    ON CONFLICT (id) DO UPDATE SET name=excluded.name,constellation_id=excluded.constellation_id,region_id=excluded.region_id,x=excluded.x,y=excluded.y,z=excluded.z,raw=excluded.raw,updated_at=now()`
  const vals = []
  for (const r of rows) {
    vals.push(r.id, r.name, r.constellationId, r.regionId, r.location?.x ?? null, r.location?.y ?? null, r.location?.z ?? null, JSON.stringify(r))
  }
  await pg.query(text, vals)
}

async function upsertTypes(pg, rows) {
  if (!rows.length) return
  const text = `INSERT INTO world_api.types (id,name,description,category_id,category_name,group_id,group_name,icon_url,mass,portion_size,radius,volume,raw,updated_at)
    VALUES ${rows.map((_,i)=>`($${i*13+1},$${i*13+2},$${i*13+3},$${i*13+4},$${i*13+5},$${i*13+6},$${i*13+7},$${i*13+8},$${i*13+9},$${i*13+10},$${i*13+11},$${i*13+12},$${i*13+13},now())`).join(',')}
    ON CONFLICT (id) DO UPDATE SET name=excluded.name,description=excluded.description,category_id=excluded.category_id,category_name=excluded.category_name,group_id=excluded.group_id,group_name=excluded.group_name,icon_url=excluded.icon_url,mass=excluded.mass,portion_size=excluded.portion_size,radius=excluded.radius,volume=excluded.volume,raw=excluded.raw,updated_at=now()`
  const vals = []
  for (const r of rows) {
    vals.push(r.id, r.name, r.description, r.categoryId, r.categoryName, r.groupId, r.groupName, r.iconUrl, r.mass, r.portionSize, r.radius, r.volume, JSON.stringify(r))
  }
  await pg.query(text, vals)
}

async function upsertTribes(pg, rows) {
  if (!rows.length) return
  const text = `INSERT INTO world_api.tribes (id,name,name_short,description,member_count,founded_at,tribe_url,raw,updated_at)
    VALUES ${rows.map((_,i)=>`($${i*8+1},$${i*8+2},$${i*8+3},$${i*8+4},$${i*8+5},$${i*8+6},$${i*8+7},$${i*8+8},now())`).join(',')}
    ON CONFLICT (id) DO UPDATE SET name=excluded.name,name_short=excluded.name_short,description=excluded.description,member_count=excluded.member_count,founded_at=excluded.founded_at,tribe_url=excluded.tribe_url,raw=excluded.raw,updated_at=now()`
  const vals = []
  for (const r of rows) {
    vals.push(r.id, r.name, r.nameShort, r.description, r.memberCount, r.foundedAt, r.tribeUrl, JSON.stringify(r))
  }
  await pg.query(text, vals)
}

async function upsertSmartCharacters(pg, rows) {
  if (!rows.length) return
  const text = `INSERT INTO world_api.smartcharacters (id,address,name,tribe_id,portrait_url,raw,updated_at)
    VALUES ${rows.map((_,i)=>`($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6},now())`).join(',')}
    ON CONFLICT (id) DO UPDATE SET address=excluded.address,name=excluded.name,tribe_id=excluded.tribe_id,portrait_url=excluded.portrait_url,raw=excluded.raw,updated_at=now()`
  const vals = []
  for (const r of rows) {
    vals.push(r.id, r.address, r.name, r.tribeId ?? null, r.portraitUrl ?? null, JSON.stringify(r))
  }
  await pg.query(text, vals)
}

async function upsertSmartCharacterDetails(pg, rows) {
  if (!rows.length) return
  const text = `INSERT INTO world_api.smartcharacters_details (address,id,name,tribe_id,portrait_url,raw,updated_at)
    VALUES ${rows.map((_,i)=>`($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6},now())`).join(',')}
    ON CONFLICT (address) DO UPDATE SET id=excluded.id,name=excluded.name,tribe_id=excluded.tribe_id,portrait_url=excluded.portrait_url,raw=excluded.raw,updated_at=now()`
  const vals = []
  for (const r of rows) {
    vals.push(r.address, r.id, r.name, r.tribeId ?? null, r.portraitUrl ?? null, JSON.stringify(r))
  }
  await pg.query(text, vals)
}

async function fetchDetailByAddress(address) {
  const path = `/v2/smartcharacters/${address}`
  const url = new URL(path, BASE)
  const r = await FETCH(url.toString(), { headers: { 'accept': 'application/json' } })
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`)
  return r.json()
}

async function run() {
  FETCH = await getFetch()
  const pg = new Client()
  await pg.connect()
  const { rows: runRow } = await pg.query(`INSERT INTO world_api.sync_runs(status) VALUES('running') RETURNING id`)
  const runId = runRow[0].id

  try {
    // solarsystems
  for await (const page of getPaginated('/v2/solarsystems', LIMITS.solarsystems)) {
      await upsertSolarsystems(pg, page.data)
    }

    // types
  for await (const page of getPaginated('/v2/types', LIMITS.types)) {
      await upsertTypes(pg, page.data)
    }

    // tribes
  for await (const page of getPaginated('/v2/tribes', LIMITS.tribes)) {
      await upsertTribes(pg, page.data)
    }

    // smartcharacters list
    const addresses = new Set()
  for await (const page of getPaginated('/v2/smartcharacters', LIMITS.smartcharacters)) {
      await upsertSmartCharacters(pg, page.data)
      for (const r of page.data) if (r.address) addresses.add(r.address)
    }

    // hydrate details by address (cap per run)
    const addrList = Array.from(addresses).slice(0, MAX_DETAIL)
    for (const batch of chunk(addrList, concurrency)) {
      const details = await Promise.all(batch.map(a => fetchDetailByAddress(a).catch(e => ({ __error: String(e) })) ))
      const ok = []
      for (let i=0;i<details.length;i++) {
        const d = details[i]
        if (!d || d.__error) continue
        ok.push({ address: batch[i], ...d })
      }
      await upsertSmartCharacterDetails(pg, ok)
      await sleep(50)
    }

    await pg.query('UPDATE world_api.sync_runs SET status=$1, finished_at=now() WHERE id=$2', ['ok', runId])
  } catch (e) {
    console.error(e)
    await pg.query('UPDATE world_api.sync_runs SET status=$1, finished_at=now(), notes=$3 WHERE id=$2', ['error', runId, String(e)])
    process.exitCode = 1
  } finally {
    await pg.end()
  }
}

run()

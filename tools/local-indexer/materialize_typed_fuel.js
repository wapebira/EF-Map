#!/usr/bin/env node
/*
 Typed value materializer for tbevefrontier/Fuel → mud_fuel
 - Uses generic extractor to pull the first two static words (current/capacity style) if present.
 - Columns: fuel0_hex/fuel0_dec, fuel1_hex/fuel1_dec.
*/
/* eslint-disable no-console */
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');

function main(){
  const env = { ...process.env };
  if (!env.ONLY_TABLE) env.ONLY_TABLE = 'tbevefrontier/Fuel';
  if (!env.OUTPUT_TABLE) env.OUTPUT_TABLE = 'mud_fuel';
  if (!env.WORDS) env.WORDS = '2';
  if (!env.COL_PREFIX) env.COL_PREFIX = 'fuel';
  env.DECODED_DB_PATH = OUT_DB;
  const r = spawnSync(process.execPath, [ path.resolve(__dirname, 'materialize_typed_values_generic.js') ], { env, stdio: 'inherit' });
  process.exit(r.status || 0);
}

main();

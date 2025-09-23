#!/usr/bin/env node
/*
 Typed value materializer for deployable state → mud_deployable_state
 - Defaults to tbevefrontier/DeployableState (guess); override via ONLY_TABLE if different.
 - Extracts first static word as status/state (hex/dec) for quick visibility.
*/
/* eslint-disable no-console */
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');

function main(){
  const env = { ...process.env };
  if (!env.ONLY_TABLE) env.ONLY_TABLE = 'tbevefrontier/DeployableState';
  if (!env.OUTPUT_TABLE) env.OUTPUT_TABLE = 'mud_deployable_state';
  if (!env.WORDS) env.WORDS = '1';
  if (!env.COL_PREFIX) env.COL_PREFIX = 'state';
  if (!env.DYNAMIC_IF_EMPTY) env.DYNAMIC_IF_EMPTY = '1';
  env.DECODED_DB_PATH = OUT_DB;
  const r = spawnSync(process.execPath, [ path.resolve(__dirname, 'materialize_typed_values_generic.js') ], { env, stdio: 'inherit' });
  process.exit(r.status || 0);
}

main();

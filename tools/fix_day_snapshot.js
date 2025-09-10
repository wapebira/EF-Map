#!/usr/bin/env node
const fs = require('fs');
const path = process.argv[2];
if(!path){
  console.error('Usage: node fix_day_snapshot.js <input-file>');
  process.exit(1);
}
let raw = fs.readFileSync(path,'utf8').trim();
// Detect already-valid JSON (starts with {" )
if(raw.startsWith('{"')){
  try { JSON.parse(raw); console.log('Already valid JSON'); process.exit(0);} catch(e){}
}
// Heuristic: add quotes around bare keys and date literal values with .json
let fixed = raw
  .replace(/([,{])([a-zA-Z_][a-zA-Z0-9_]*):/g,'$1"$2":')
  .replace(/:"([0-9]{4}-[0-9]{2}-[0-9]{2}\.json)"/g,':"$1"');
try {
  const obj = eval('('+fixed+')'); // since original resembles JS object; then reserialize safely
  if(typeof obj !== 'object' || !obj){ throw new Error('Parsed value not object'); }
  const out = JSON.stringify(obj);
  fs.writeFileSync(path.replace(/\.txt$/,'_corrected.json'), out);
  console.log('Corrected file written:', path.replace(/\.txt$/,'_corrected.json'));
} catch(e){
  console.error('Failed to correct snapshot:', e.message);
  process.exit(2);
}

#!/usr/bin/env node
const fs = require('fs');
const path = process.argv[2];
if(!path){ console.error('usage: node write_utf8_nobom.js <dest>'); process.exit(1);} 
let src = fs.readFileSync('daily_2025-09-07_v3.json','utf8');
if(src.charCodeAt(0)===0xFEFF) src = src.slice(1);
const buf = Buffer.from(src,'utf8');
fs.writeFileSync(path, buf);
console.log('Wrote', path, 'length', buf.length);

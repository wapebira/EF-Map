#!/usr/bin/env node
/*
 Export minimal verification snapshot from local indexer DB.
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();
let BetterSqlite3 = null;
try { BetterSqlite3 = require('better-sqlite3'); } catch {}
const initSqlJs = require('sql.js');

const DB_PATH = process.env.LOCAL_DB_PATH || path.resolve(__dirname, '../../data/local-indexer.db');
const OUT_DIR = process.env.EXPORT_DIR || path.resolve(__dirname, '../../eve-frontier-map/public/data/index-latest');

fs.mkdirSync(OUT_DIR, { recursive: true });
async function main(){
	let useBetter = false; let db = null; let SQL = null;
	if (BetterSqlite3) {
		try { db = new BetterSqlite3(DB_PATH, { readonly: true, fileMustExist: true }); useBetter = true; } catch {}
	}
	if (!useBetter) {
		const stat = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;
		if (stat && stat.size > (2 * 1024 * 1024 * 1024)) {
			console.error('DB too large for sql.js; install better-sqlite3 or set LOCAL_DB_PATH to a smaller snapshot');
			process.exit(2);
		}
		SQL = await initSqlJs({ locateFile: f=>require.resolve('sql.js/dist/sql-wasm.wasm') });
		const filebuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
		db = filebuffer ? new SQL.Database(filebuffer) : new SQL.Database();
		// Ensure schema present (idempotent)
		const schemaSql = fs.readFileSync(path.resolve(__dirname, './schema.sql'), 'utf8');
		db.exec(schemaSql);
	}

	function scalar(sql){
		if (useBetter) {
			const row = db.prepare(sql).get();
			const key = row && Object.keys(row)[0];
			return (row && row[key]) | 0;
		}
		const stmt = db.prepare(sql); stmt.step(); const row = stmt.getAsObject(); stmt.free(); const key = Object.keys(row)[0]; return row[key] | 0;
	}
	function getCursor(){
		if (useBetter) return db.prepare('SELECT last_block_number, last_log_index FROM event_cursor WHERE id=1').get();
		const stmt = db.prepare('SELECT last_block_number, last_log_index FROM event_cursor WHERE id=1'); stmt.step(); const row = stmt.getAsObject(); stmt.free(); return row;
	}

	const counts = scalar('SELECT COUNT(1) AS c FROM raw_logs');
	const maxBlock = scalar('SELECT MAX(block_number) AS b FROM raw_logs');
	const minBlock = scalar('SELECT MIN(block_number) AS b FROM raw_logs');
	const cursor = getCursor();

	const meta = { counts: { raw_logs: counts }, blocks: { min:minBlock, max:maxBlock }, cursor };
	fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
	console.log(JSON.stringify({ status:'exported', out:path.join(OUT_DIR,'meta.json'), counts, minBlock, maxBlock, engine: useBetter ? 'better-sqlite3' : 'sql.js' }));
}

main().catch(e=>{ console.error(e); process.exit(1); });

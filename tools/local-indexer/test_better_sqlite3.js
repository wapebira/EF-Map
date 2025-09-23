try {
  const b = require('better-sqlite3');
  const v = require('better-sqlite3/package.json').version;
  console.log('better-sqlite3 ok', v);
  const db = new b(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec('create table t(x int); insert into t(x) values (1),(2);');
  const row = db.prepare('select count(*) as c from t').get();
  console.log('rows', row.c);
  process.exit(0);
} catch (e) {
  console.error('better-sqlite3 load failed:', e.message);
  process.exit(1);
}

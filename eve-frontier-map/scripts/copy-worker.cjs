// Copies the Cloudflare worker implementation into the build output so Pages serves it.
// Safe no-op if source missing (local dev without worker).
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.cwd(), '..'); // repo root
// Prefer the consolidated root worker implementation to avoid drift and ensure latest fixes (e.g., tribe fallbacks)
// are used in Pages. If missing, fall back to app-level, then legacy root worker.js.
const candidates = [
  path.join(root, '_worker.js'),          // root-level (thin re-export of worker.js)
  path.join(root, 'worker.js'),           // direct root worker (legacy direct export)
  path.join(process.cwd(), '_worker.js')  // app-level (older, retain only as last resort)
];
const dist = path.join(process.cwd(), 'dist');
if(!fs.existsSync(dist)){
  console.warn('[copy-worker] dist/ not found, skipping');
  process.exit(0);
}
let src = null;
for(const c of candidates){ if(fs.existsSync(c)){ src=c; break; } }
if(!src){
  console.warn('[copy-worker] no worker.js or _worker.js found at repo root; skipping');
  process.exit(0);
}
const dest = path.join(dist, '_worker.js');
try {
  fs.copyFileSync(src, dest);
  console.log('[copy-worker] Copied', src, '->', dest, '(selected first existing candidate in priority list)');
  // If the exported worker depends on sibling worker.js (re-export pattern), also copy it.
  const sibling = path.join(path.dirname(src), 'worker.js');
  if(fs.existsSync(sibling)){
    const siblingDest = path.join(dist, 'worker.js');
    fs.copyFileSync(sibling, siblingDest);
    console.log('[copy-worker] Copied', sibling, '->', siblingDest);
  }
  // Copy migrations directory (always from repo root) into dist so ASSETS fetch can serve SQL files.
  const migrationsSrc = path.join(root, 'migrations');
  if(fs.existsSync(migrationsSrc) && fs.lstatSync(migrationsSrc).isDirectory()){
    const migrationsDest = path.join(dist, 'migrations');
    if(!fs.existsSync(migrationsDest)) fs.mkdirSync(migrationsDest, { recursive:true });
    const entries = fs.readdirSync(migrationsSrc);
    for(const file of entries){
      const from = path.join(migrationsSrc, file);
      const to = path.join(migrationsDest, file);
      if(fs.lstatSync(from).isFile()){
        fs.copyFileSync(from, to);
      }
    }
    console.log('[copy-worker] Copied migrations ->', migrationsDest);
  }
} catch(e){
  console.error('[copy-worker] copy failed', e);
  process.exit(1);
}

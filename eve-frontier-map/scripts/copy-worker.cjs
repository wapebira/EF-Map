// Copies the Cloudflare worker implementation into the build output so Pages serves it.
// Safe no-op if source missing (local dev without worker).
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.cwd(), '..'); // repo root
// Prefer the app-local _worker.js (Pages implementation) before falling back to root variants.
// Root _worker.js is a thin re-export wrapper; deploying it caused HTML fallback for API endpoints when the richer
// Pages worker existed. This ordering ensures we ship the full Pages worker logic.
const candidates = [
  path.join(process.cwd(), '_worker.js'), // app-level
  path.join(root, '_worker.js'),          // root-level (wrapper)
  path.join(root, 'worker.js')            // legacy root worker.js direct
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

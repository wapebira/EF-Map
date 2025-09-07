// Copies the Cloudflare worker implementation into the build output so Pages serves it.
// Safe no-op if source missing (local dev without worker).
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.cwd(), '..'); // go up from app folder if run inside eve-frontier-map
const candidates = [
  path.join(root, '_worker.js'),
  path.join(root, 'worker.js')
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
  console.log('[copy-worker] Copied', src, '->', dest);
  // If the exported worker depends on sibling worker.js (re-export pattern), also copy it.
  const sibling = path.join(path.dirname(src), 'worker.js');
  if(fs.existsSync(sibling)){
    const siblingDest = path.join(dist, 'worker.js');
    fs.copyFileSync(sibling, siblingDest);
    console.log('[copy-worker] Copied', sibling, '->', siblingDest);
  }
} catch(e){
  console.error('[copy-worker] copy failed', e);
  process.exit(1);
}

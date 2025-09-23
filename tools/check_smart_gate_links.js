// Quick check for tribeId of specific gateIds from /api/smart-gate-links
// Usage: node tools/check_smart_gate_links.js [url]

const https = require('https');
const url = process.argv[2] || 'https://ef-map.pages.dev/api/smart-gate-links';
const ids = [
  '63994086827917643456569397617352518577262080062173992510601782164513069228530',
  '8717844610379050986275486033636574330792592002627818827440625499175921023262',
];

function fetchJson(u) {
  return new Promise((resolve, reject) => {
    const req = https.get(u, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode));
        res.resume();
        return;
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (buf += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(buf);
          resolve({ json, headers: res.headers });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

(async () => {
  try {
    const { json, headers } = await fetchJson(url);
    const links = json && json.links ? json.links : [];
    ids.forEach((id) => {
      const m = links.find((l) => l.gateId === id);
      console.log(`${id}=${m ? m.tribeId : 'NOT_FOUND'}`);
    });
    console.log(`updatedAt=${json.updatedAt || 'n/a'}`);
    if (headers['etag']) console.log(`etag=${headers['etag']}`);
    if (headers['cache-control']) console.log(`cache-control=${headers['cache-control']}`);
  } catch (e) {
    console.error('ERROR', e.message || e);
    process.exit(1);
  }
})();

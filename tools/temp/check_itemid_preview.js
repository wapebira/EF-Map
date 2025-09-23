const https = require('https');
const fs = require('fs');

const url = 'https://feature-tribe-no-default.ef-map.pages.dev/api/smart-gate-links?force=1&ts=' + Date.now();

function get(u) {
  return new Promise((resolve, reject) => {
    https.get(u, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  try {
    const r = await get(url);
    console.log('HTTP', r.status);
    fs.mkdirSync('tmp', { recursive: true });
    fs.writeFileSync('tmp/smart_links_preview.json', r.body);
    console.log('Saved tmp/smart_links_preview.json (' + r.body.length + ' bytes)');
    const hasItemId = r.body.includes('"itemId"');
    console.log('FoundItemIdHint=' + (hasItemId ? '1' : '0'));
    if (hasItemId) {
      try {
        const obj = JSON.parse(r.body);
        const gm = obj.gateMeta || {};
        for (const [gid, meta] of Object.entries(gm)) {
          if (meta && meta.entity && meta.entity.itemId) {
            console.log('Sample gateId=' + gid + ' itemId=' + meta.entity.itemId);
            break;
          }
        }
      } catch (e) {
        console.log('ParseError=' + e.message);
      }
    }
  } catch (e) {
    console.error(e.stack || e.message);
    process.exit(1);
  }
})();

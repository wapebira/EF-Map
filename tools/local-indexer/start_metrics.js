// Portable starter for metrics server on a canonical port (8733)
// Avoids shell-specific env syntax on Windows vs *nix.

process.env.PORT = process.env.PORT || '8733';
// Optional commonly-used envs can be pre-set here if desired; keep defaults minimal
// process.env.STATUS_FILE = process.env.STATUS_FILE || 'c:/EF-Map-main/data/local-indexer-status.json';
// process.env.DECODED_DB_PATH = process.env.DECODED_DB_PATH || 'c:/EF-Map-main/data/local-indexer-decoded.db';

console.log(`[metrics] starting metrics_server on http://127.0.0.1:${process.env.PORT}`);
require('./metrics_server.js');

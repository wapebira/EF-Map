// Quick RPC probe for Pyrope: prints latest, safe, finalized and their lags
const RPC = process.env.RPC_HTTP_URL || 'https://rpc.pyropechain.com';

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}

function hexToDec(hex) {
  if (!hex) return null;
  return parseInt(hex, 16);
}

(async () => {
  try {
    const latestHex = await rpc('eth_blockNumber');
    const safe = await rpc('eth_getBlockByNumber', ['safe', false]);
    const final = await rpc('eth_getBlockByNumber', ['finalized', false]);
    const safeHex = safe && safe.number;
    const finalHex = final && final.number;

    const latest = hexToDec(latestHex);
    const safeDec = hexToDec(safeHex);
    const finalDec = hexToDec(finalHex);

    const out = {
      rpc: RPC,
      latest_hex: latestHex,
      latest,
      safe_hex: safeHex || null,
      safe: safeDec,
      finalized_hex: finalHex || null,
      finalized: finalDec,
      lag_safe: safeDec != null ? latest - safeDec : null,
      lag_finalized: finalDec != null ? latest - finalDec : null,
    };
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('probe_error', err.message || err);
    process.exit(1);
  }
})();

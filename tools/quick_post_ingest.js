// Quick one-off test to POST ingest and print status/body
(async () => {
  const res = await fetch('https://feature-indexer.ef-map.pages.dev/api/indexer-ingest?openPreview=1', {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify({ mode:'store_all', rpc:'https://rpc.pyropechain.com', world:'0x7085f3e652987f656fB8dEE5aA6592197Bb75de8', deployBlock:7288348, maxBlocks:10, rowCap:1000 })
  });
  const text = await res.text();
  console.log('Status', res.status);
  console.log('Body', text);
})();

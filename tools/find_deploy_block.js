// Simple utility to discover the deployment (creation) block of the world contract.
// Usage: node tools/find_deploy_block.js
// It performs a binary search over block numbers calling eth_getCode.
// Outputs JSON so it can be machine-parsed or copy/pasted into decision log.

const RPC = 'https://rpc.pyropechain.com';
const WORLD_ADDRESS = '0x7085f3e652987f656fB8dEE5aA6592197Bb75de8'.toLowerCase();

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method} error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function main() {
  const latestHex = await rpc('eth_blockNumber');
  const latest = parseInt(latestHex, 16);
  let low = 0;
  let high = latest;

  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    const midHex = '0x' + mid.toString(16);
    const code = await rpc('eth_getCode', [WORLD_ADDRESS, midHex]);
    if (code !== '0x') {
      high = mid; // contract code already exists here, search earlier
    } else {
      low = mid; // not yet deployed
    }
  }
  const deployBlock = high;

  // Sanity check: code should NOT exist at deployBlock - 1
  const preHex = '0x' + (deployBlock - 1).toString(16);
  const preCode = deployBlock > 0 ? await rpc('eth_getCode', [WORLD_ADDRESS, preHex]) : '0x';
  const deployHex = '0x' + deployBlock.toString(16);
  const codeAtDeploy = await rpc('eth_getCode', [WORLD_ADDRESS, deployHex]);

  // Try to get any logs on the deployment block
  const logs = await rpc('eth_getLogs', [{
    fromBlock: deployHex,
    toBlock: deployHex,
    address: WORLD_ADDRESS
  }]);

  const result = {
    worldAddress: WORLD_ADDRESS,
    latestBlockChecked: latest,
    deploymentBlock: deployBlock,
    deploymentBlockHex: deployHex,
    codePresentAtDeployment: codeAtDeploy !== '0x',
    codePresentPreviousBlock: preCode !== '0x',
    logsOnDeploymentBlock: logs.length,
    firstLogTopicsSample: logs.slice(0, 3).map(l => l.topics)
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error('ERROR', err);
  process.exit(1);
});

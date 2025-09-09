#!/usr/bin/env node
/**
 * Compute keccak256 topic0 values for canonical MUD Store events.
 * This does NOT require full ABI parsing; we hardcode the minimal
 * signature strings as emitted in MUD v2+ store contracts.
 *
 * Adjust list if project uses a subset or additional custom events.
 */

// Use js-sha3 for keccak256 to ensure availability across Node versions.
const { keccak256: k256 } = require('js-sha3');

// Core persistent store events (non-ephemeral)
const PERSISTENT_EVENTS = [
  'StoreSetRecord(bytes32,bytes32,bytes)',
  'StoreSetField(bytes32,bytes32,uint8,bytes)',
  'StoreDeleteRecord(bytes32,bytes32)',
];

// Ephemeral store events (used for transient data / hooks)
const EPHEMERAL_EVENTS = [
  'StoreEphemeralRecord(bytes32,bytes32,bytes)',
  'StoreEphemeralRecordValue(bytes32,bytes32,uint8,bytes)',
];

const ALL = [...PERSISTENT_EVENTS, ...EPHEMERAL_EVENTS];

function keccak256Hex(data) {
  return k256(data);
}

const mapping = ALL.map(sig => ({
  signature: sig,
  topic0: '0x' + keccak256Hex(sig)
}));

if (require.main === module) {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: mapping.length,
    events: mapping
  }, null, 2));
}

module.exports = { mapping };

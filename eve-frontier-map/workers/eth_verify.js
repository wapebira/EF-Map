// Minimal EIP-191 personal_sign verification for Ethereum addresses
// Uses ethereum-cryptography (pure JS) to avoid external CDN imports in Workers
import { keccak256 } from 'ethereum-cryptography/keccak.js';
import { recoverPublicKey } from 'ethereum-cryptography/secp256k1.js';
import { utf8ToBytes, hexToBytes, bytesToHex } from 'ethereum-cryptography/utils.js';

const PREFIX = '\x19Ethereum Signed Message:\n';

function hashPersonalMessage(message){
  const msgBytes = utf8ToBytes(message);
  const prefixBytes = utf8ToBytes(PREFIX + String(msgBytes.length));
  const buf = new Uint8Array(prefixBytes.length + msgBytes.length);
  buf.set(prefixBytes, 0);
  buf.set(msgBytes, prefixBytes.length);
  return keccak256(buf);
}

function recoverAddressFromSig(message, signatureHex){
  const hash = hashPersonalMessage(message);
  const sig = hexToBytes(signatureHex);
  if(sig.length !== 65) throw new Error('invalid_signature_length');
  let rec = sig[64];
  if(rec >= 27) rec = rec - 27; // EIP-155 / legacy normalization
  if(rec !== 0 && rec !== 1) throw new Error('invalid_recovery_id');
  const rs = sig.slice(0, 64);
  const pub = recoverPublicKey(hash, rs, rec); // uncompressed (65 bytes, 0x04 prefix)
  if(!pub || pub.length < 33) throw new Error('pubkey_recovery_failed');
  const pubNoPrefix = pub[0] === 0x04 ? pub.slice(1) : pub; // drop 0x04 if present
  const addrBytes = keccak256(pubNoPrefix).slice(-20);
  return '0x' + bytesToHex(addrBytes);
}

export function verifyMessage({ address, message, signature }){
  const rec = recoverAddressFromSig(message, signature).toLowerCase();
  return rec === String(address || '').toLowerCase();
}

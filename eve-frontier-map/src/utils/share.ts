// Route sharing utilities
// Compact encoding of routes into URL hash using base64 + optional LZ compression.
// Schema v1 (prefix 'r1'): r1|<type>|<flags>|<data>
// type: 'p' (p2p) or 's' (scout)
// flags bitmask (currently unused, reserved for future) encoded as hex.
// data section (before compression) depends on type:
//   p2p: from,to,jump,optAlgo,optimizeFor,pathSemicolonSep
//   scout: start,returnFlag(0/1),pathSemicolonSep (champion macro path)
// We then join fields with ',' and if length > 120 chars we LZ-compress then base64 and prefix 'z'.

import { compressToUint8Array, decompressFromUint8Array } from 'lz-string';

export type SmartGateMode = 'none' | 'public' | 'authorized';

export interface P2PShareData {
  type: 'p';
  from: string;
  to: string;
  jump: number;
  optimize: 'fuel'|'jumps'|'explore';
  algo: 'astar'|'dijkstra';
  path: string[]; // full path including endpoints
  smartGateMode?: SmartGateMode;
  smartGatePairs?: string[]; // directional "id-id" pairs used in the original route
}

export interface ScoutShareData {
  type: 's';
  start: string;
  returnToStart: boolean;
  path: string[]; // champion macro path (may include return already)
}

export type ShareData = P2PShareData | ScoutShareData;

const CURRENT_PREFIX = 'r2';
const SUPPORTED_PREFIXES = new Set(['r2', 'r1']);

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
}

function bytesFromBase64(b64: string): Uint8Array {
  b64 = b64.replace(/-/g,'+').replace(/_/g,'/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeShare(data: ShareData): string {
  if (data.type === 'p') {
    const base = [
      data.from,
      data.to,
      data.jump.toString(),
      data.optimize,
      data.algo,
      data.path.join(';'),
      data.smartGateMode ?? '',
      data.smartGatePairs && data.smartGatePairs.length ? data.smartGatePairs.join(';') : ''
    ];
    const raw = base.join(',');
    return encodeRaw('p', raw, CURRENT_PREFIX);
  } else {
    const raw = [data.start, data.returnToStart? '1':'0', data.path.join(';')].join(',');
    return encodeRaw('s', raw, CURRENT_PREFIX);
  }
}

function encodeRaw(type: 'p'|'s', raw: string, prefix: 'r1'|'r2'): string {
  // Decide compression
  let payload: string;
  if (raw.length > 120) {
    const comp = compressToUint8Array(raw);
    payload = 'z' + base64FromBytes(comp);
  } else {
    payload = 'n' + encodeURIComponent(raw);
  }
  const flags = '0'; // reserved hex flags
  return `${prefix}|${type}|${flags}|${payload}`;
}

export function decodeShare(hash: string): ShareData | null {
  // Expect leading '#'
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  const parts = clean.split('|');
  if (parts.length !== 4) return null;
  const [prefix, type, _flags, payload] = parts;
  if (!SUPPORTED_PREFIXES.has(prefix)) return null;
  if (type !== 'p' && type !== 's') return null;
  if (!payload) return null;
  let raw: string;
  if (payload.startsWith('z')) {
    try {
      const bytes = bytesFromBase64(payload.slice(1));
      raw = decompressFromUint8Array(bytes) || '';
    } catch { return null; }
  } else if (payload.startsWith('n')) {
    try { raw = decodeURIComponent(payload.slice(1)); } catch { return null; }
  } else return null;
  if (!raw) return null;
  if (type === 'p') {
    const parts = raw.split(',');
    const from = parts[0];
    const to = parts[1];
    const jumpStr = parts[2];
    const optimize = parts[3];
    const algo = parts[4];
    const pathStr = parts[5];
    const sgModeRaw = parts[6] ?? '';
    const sgPairsRaw = parts[7] ?? '';
    if(!from || !to || !jumpStr || !optimize || !algo || pathStr===undefined) return null;
    const jump = parseFloat(jumpStr); if(!isFinite(jump)) return null;
    const path = pathStr ? pathStr.split(';').filter(Boolean) : [];
    const optVal: 'fuel'|'jumps'|'explore' = optimize==='fuel' ? 'fuel' : (optimize==='explore' ? 'explore' : 'jumps');
    const base: P2PShareData = { type:'p', from, to, jump, optimize: optVal, algo: (algo==='dijkstra'?'dijkstra':'astar'), path };
    if (sgModeRaw === 'none' || sgModeRaw === 'public' || sgModeRaw === 'authorized') {
      base.smartGateMode = sgModeRaw;
    }
    if (sgPairsRaw) {
      const pairs = sgPairsRaw.split(';').filter(Boolean);
      if (pairs.length) base.smartGatePairs = pairs;
    }
    return base;
  } else {
    const [start, returnFlag, pathStr] = raw.split(',');
    if(!start || returnFlag===undefined || pathStr===undefined) return null;
    const path = pathStr ? pathStr.split(';').filter(Boolean) : [];
    return { type:'s', start, returnToStart: returnFlag==='1', path };
  }
}

// Helper to apply share data to current URL hash (does not push history) and copy optionally.
export function updateHashForShare(data: ShareData, autoCopy=false): string {
  const encoded = encodeShare(data);
  const newHash = '#' + encoded;
  if (window.location.hash !== newHash) {
    history.replaceState(null,'',newHash);
  }
  if(autoCopy){
    try { navigator.clipboard.writeText(window.location.href); } catch {/* ignore */}
  }
  return newHash;
}

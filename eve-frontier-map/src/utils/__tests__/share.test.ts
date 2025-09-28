import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, type P2PShareData } from '../share';

describe('share schema r2', () => {
  it('round-trips smart gate metadata for point-to-point routes', () => {
    const payload: P2PShareData = {
      type: 'p',
      from: 'Alpha',
      to: 'Gamma',
      jump: 35,
      optimize: 'fuel',
      algo: 'astar',
      path: ['Alpha', 'Beta', 'Gamma'],
      smartGateMode: 'authorized',
      smartGatePairs: ['1-2', '2-3']
    };

    const encoded = encodeShare(payload);

    expect(encoded.startsWith('r2|p|')).toBe(true);

    const decoded = decodeShare(encoded);
    expect(decoded).not.toBeNull();
    if (!decoded || decoded.type !== 'p') throw new Error('Failed to decode p2p share');

    expect(decoded).toMatchObject({
      from: payload.from,
      to: payload.to,
      jump: payload.jump,
      optimize: payload.optimize,
      algo: payload.algo,
      smartGateMode: payload.smartGateMode
    });
    expect(decoded.smartGatePairs).toEqual(payload.smartGatePairs);
    expect(decoded.path).toEqual(payload.path);
  });

  it('handles shares without smart gate metadata (legacy r1 payload)', () => {
    const legacy = 'r1|p|0|nOrigin,Destination,10,fuel,astar,Origin;Destination';
    const decoded = decodeShare(legacy);
    expect(decoded).not.toBeNull();
    if (!decoded || decoded.type !== 'p') throw new Error('Failed to decode legacy p2p share');

    expect(decoded.from).toBe('Origin');
    expect(decoded.to).toBe('Destination');
    expect(decoded.smartGateMode).toBeUndefined();
    expect(decoded.smartGatePairs).toBeUndefined();
  });

  it('produces fallback smart gate mode when metadata omitted', () => {
    const payload: P2PShareData = {
      type: 'p',
      from: 'Start',
      to: 'Finish',
      jump: 20,
      optimize: 'jumps',
      algo: 'dijkstra',
      path: ['Start', 'Finish'],
      smartGateMode: 'none'
    };

    const decoded = decodeShare(encodeShare(payload));
    expect(decoded).not.toBeNull();
    if (!decoded || decoded.type !== 'p') throw new Error('Failed to decode fallback share');

    expect(decoded.smartGateMode).toBe('none');
    expect(decoded.smartGatePairs).toBeUndefined();
  });
});

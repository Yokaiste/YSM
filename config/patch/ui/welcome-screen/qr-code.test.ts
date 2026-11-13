import assert from 'node:assert/strict';
import { encodeQr } from './qr-code.ts';

// Unmasked left-edge data from Nayuki's reference encoder (byte mode, level M).
const EDGE_VECTORS = [
  [1, '0110'],
  [15, '00100000'],
  [27, '111111010000'],
  [43, '1111100111100000'],
  [63, '01100100011000100000'],
  [85, '001100111111111101010000'],
  [106, '101101101111111101000000'],
] as const;

export default function test() {
  for (const [length, edge] of EDGE_VECTORS) {
    const symbol = encodeQr('a'.repeat(length));
    assert.equal(symbol.modules[6]?.[8], true, 'Horizontal timing mark');
    assert.equal(symbol.modules[8]?.[6], true, 'Vertical timing mark');
    const actual = symbol.modules
      .slice(9, -8)
      .map((row, index) => {
        const y = index + 9;
        const masks = [
          y % 2 === 0,
          y % 2 === 0,
          true,
          y % 3 === 0,
          Math.floor(y / 2) % 2 === 0,
          true,
          true,
          y % 2 === 0,
        ];
        return Number(row[0] !== masks[symbol.mask]);
      })
      .join('');
    assert.equal(actual, edge, `Version ${symbol.version} left-edge data`);
  }
  assert.throws(() => encodeQr('a'.repeat(107)), /capacity/);
  assert.throws(() => encodeQr('é'.repeat(54)), /capacity/);
  return { results: [{ name: 'QR standard data placement', status: 'passed' as const }] };
}

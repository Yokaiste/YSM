import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';
import { encodeMonochromePng } from './png.ts';

export default function test() {
  const pixels = [
    [true, false, true],
    [false, true, false],
    [false, false, false],
  ];
  const png = Buffer.from(encodeMonochromePng(pixels));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = new Map<string, Buffer>();
  for (let start = 8; start < png.length;) {
    const size = png.readUInt32BE(start);
    const type = png.toString('ascii', start + 4, start + 8);
    const body = png.subarray(start + 4, start + 8 + size);
    assert.equal(png.readUInt32BE(start + 8 + size), crc32(body), `${type} checksum`);
    chunks.set(type, body.subarray(4));
    start += 12 + size;
  }
  const header = chunks.get('IHDR');
  assert.ok(header);
  assert.equal(header.readUInt32BE(0), 3);
  assert.equal(header.readUInt32BE(4), 3);
  assert.equal(header[8], 1);
  assert.equal(header[9], 0);
  const data = chunks.get('IDAT');
  assert.ok(data);
  assert.deepEqual([...inflateSync(data)], [0, 64, 0, 160, 0, 224]);
  assert.deepEqual(Buffer.from(encodeMonochromePng(pixels)), png);
  assert.throws(() => encodeMonochromePng([]), /empty/);
  assert.throws(() => encodeMonochromePng([[true], []]), /widths/);
  assert.ok(
    encodeMonochromePng(Array.from({ length: 512 }, () => new Array(512).fill(false))).length <
      1_000,
  );
  return { results: [{ name: 'Native PNG compression', status: 'passed' as const }] };
}

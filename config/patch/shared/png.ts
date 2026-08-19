/**
 * One-bit greyscale PNG writer for generated QR codes. Deflate is written as
 * stored blocks: no compression library, and byte-identical output so unchanged
 * links do not churn the build.
 */

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFLATE_MAX_STORED_BLOCK = 0xffff;
const ZLIB_HEADER = Uint8Array.from([0x78, 0x01]);
const ADLER_MODULO = 65521;
const BIT_DEPTH_ONE = 1;
const COLOUR_TYPE_GREYSCALE = 0;

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let low = 1;
  let high = 0;
  for (const byte of bytes) {
    low = (low + byte) % ADLER_MODULO;
    high = (high + low) % ADLER_MODULO;
  }
  return ((high << 16) | low) >>> 0;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function toBigEndian32(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
  const body = concat([typeBytes, data]);
  return concat([toBigEndian32(data.length), body, toBigEndian32(crc32(body))]);
}

function deflateStored(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [ZLIB_HEADER];
  for (let offset = 0; offset < data.length || offset === 0; offset += DEFLATE_MAX_STORED_BLOCK) {
    const chunk = data.subarray(offset, offset + DEFLATE_MAX_STORED_BLOCK);
    const isFinal = offset + DEFLATE_MAX_STORED_BLOCK >= data.length;
    blocks.push(
      Uint8Array.from([
        isFinal ? 1 : 0,
        chunk.length & 0xff,
        (chunk.length >>> 8) & 0xff,
        ~chunk.length & 0xff,
        (~chunk.length >>> 8) & 0xff,
      ]),
      chunk,
    );
    if (isFinal) {
      break;
    }
  }
  blocks.push(toBigEndian32(adler32(data)));
  return concat(blocks);
}

/** Rows must all be the same length. */
export function encodeMonochromePng(pixels: boolean[][]): Uint8Array {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  if (height === 0 || width === 0) {
    throw new Error('Cannot encode a PNG from an empty pixel grid.');
  }
  if (pixels.some((row) => row.length !== width)) {
    throw new Error('Cannot encode a PNG from rows of differing widths.');
  }

  const bytesPerRow = Math.ceil(width / 8);
  const raw = new Uint8Array((bytesPerRow + 1) * height);
  for (const [y, row] of pixels.entries()) {
    const rowStart = y * (bytesPerRow + 1);
    // Filter type 0: none. Rows this small gain nothing from prediction.
    raw[rowStart] = 0;
    for (const [x, isBlack] of row.entries()) {
      if (isBlack) {
        continue;
      }
      const index = rowStart + 1 + (x >>> 3);
      raw[index] = (raw[index] ?? 0) | (0x80 >>> (x & 7));
    }
  }

  const header = concat([
    toBigEndian32(width),
    toBigEndian32(height),
    Uint8Array.from([BIT_DEPTH_ONE, COLOUR_TYPE_GREYSCALE, 0, 0, 0]),
  ]);

  return concat([
    PNG_SIGNATURE,
    buildChunk('IHDR', header),
    buildChunk('IDAT', deflateStored(raw)),
    buildChunk('IEND', new Uint8Array(0)),
  ]);
}

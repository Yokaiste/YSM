import { crc32, deflateSync } from 'node:zlib';

/** One-bit greyscale PNG writer for generated QR codes. */

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH_ONE = 1;
const COLOUR_TYPE_GREYSCALE = 0;

function toBigEndian32(value: number): Uint8Array {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([toBigEndian32(data.length), body, toBigEndian32(crc32(body))]);
}

/** Rows must all be the same length. */
export function encodeMonochromePng(pixels: boolean[][]): Uint8Array {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  if (height === 0 || width === 0) {
    throw new Error(
      'The welcome-screen QR image has an empty pixel grid. Report this output to YSM Community troubleshooting: https://discord.gg/33Sqn6dTjf.',
    );
  }
  if (pixels.some((row) => row.length !== width)) {
    throw new Error(
      'The welcome-screen QR image has rows with different widths. Report this output to YSM Community troubleshooting: https://discord.gg/33Sqn6dTjf.',
    );
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

  const header = Buffer.concat([
    toBigEndian32(width),
    toBigEndian32(height),
    Uint8Array.from([BIT_DEPTH_ONE, COLOUR_TYPE_GREYSCALE, 0, 0, 0]),
  ]);

  return Buffer.concat([
    PNG_SIGNATURE,
    buildChunk('IHDR', header),
    buildChunk('IDAT', deflateSync(raw)),
    buildChunk('IEND', new Uint8Array(0)),
  ]);
}

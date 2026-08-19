/**
 * Byte mode, error correction M, versions 1-6. That holds 106 characters and stops
 * short of version 7, where symbols gain a second version-information block. Every
 * version in range also splits into equal error-correction blocks, so there is no
 * second block group to interleave.
 */

/** Data capacity per version at level M, after the 12-bit byte-mode header. */
interface QrVersionSpec {
  version: number;
  totalCodewords: number;
  eccCodewordsPerBlock: number;
  blockCount: number;
}

const QR_VERSIONS: readonly QrVersionSpec[] = [
  { version: 1, totalCodewords: 26, eccCodewordsPerBlock: 10, blockCount: 1 },
  { version: 2, totalCodewords: 44, eccCodewordsPerBlock: 16, blockCount: 1 },
  { version: 3, totalCodewords: 70, eccCodewordsPerBlock: 26, blockCount: 1 },
  { version: 4, totalCodewords: 100, eccCodewordsPerBlock: 18, blockCount: 2 },
  { version: 5, totalCodewords: 134, eccCodewordsPerBlock: 24, blockCount: 2 },
  { version: 6, totalCodewords: 172, eccCodewordsPerBlock: 16, blockCount: 4 },
];

/** Centre of the single alignment pattern, by version. Version 1 carries none. */
const ALIGNMENT_CENTRE_BY_VERSION: Readonly<Record<number, number>> = {
  2: 18,
  3: 22,
  4: 26,
  5: 30,
  6: 34,
};

/** Bits between the last codeword and the end of the symbol, by version. */
const REMAINDER_BITS_BY_VERSION: Readonly<Record<number, number>> = {
  1: 0,
  2: 7,
  3: 7,
  4: 7,
  5: 7,
  6: 7,
};

const BYTE_MODE_INDICATOR = 0b0100;
/** Byte mode uses an 8-bit character count for versions 1 to 9. */
const BYTE_MODE_COUNT_BITS = 8;
const ECC_LEVEL_M_BITS = 0b00;
const PAD_CODEWORDS = [0xec, 0x11] as const;
const MASK_COUNT = 8;
const GF_PRIMITIVE = 0x11d;
const FORMAT_GENERATOR = 0x537;
const FORMAT_XOR_MASK = 0x5412;

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

function buildGaloisTables(): void {
  let value = 1;
  for (let power = 0; power < 255; power += 1) {
    GF_EXP[power] = value;
    GF_LOG[value] = power;
    value <<= 1;
    if (value & 0x100) {
      value ^= GF_PRIMITIVE;
    }
  }
  for (let power = 255; power < 512; power += 1) {
    GF_EXP[power] = GF_EXP[power - 255] ?? 0;
  }
}

buildGaloisTables();

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return GF_EXP[((GF_LOG[left] ?? 0) + (GF_LOG[right] ?? 0)) % 255] ?? 0;
}

function buildEccGenerator(degree: number): Uint8Array {
  let polynomial = Uint8Array.from([1]);
  for (let step = 0; step < degree; step += 1) {
    const next = new Uint8Array(polynomial.length + 1);
    for (const [index, coefficient] of polynomial.entries()) {
      next[index] = (next[index] ?? 0) ^ gfMultiply(coefficient, 1);
      next[index + 1] = (next[index + 1] ?? 0) ^ gfMultiply(coefficient, GF_EXP[step] ?? 0);
    }
    polynomial = next;
  }
  return polynomial;
}

/** Remainder of `data * x^degree` divided by the generator polynomial. */
function computeEccCodewords(data: Uint8Array, degree: number): Uint8Array {
  const generator = buildEccGenerator(degree);
  const remainder = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] ?? 0);
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    for (let index = 0; index < degree; index += 1) {
      remainder[index] = (remainder[index] ?? 0) ^ gfMultiply(generator[index + 1] ?? 0, factor);
    }
  }
  return remainder;
}

/** Format information for level M: 5 data bits expanded by BCH(15, 5), then masked. */
function buildFormatBits(mask: number): number {
  const data = (ECC_LEVEL_M_BITS << 3) | mask;
  let remainder = data;
  for (let step = 0; step < 10; step += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * FORMAT_GENERATOR);
  }
  return (((data << 10) | remainder) ^ FORMAT_XOR_MASK) & 0x7fff;
}

function toUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function selectVersion(byteLength: number): QrVersionSpec {
  const headerBits = 4 + BYTE_MODE_COUNT_BITS;
  const version = QR_VERSIONS.find((candidate) => {
    const dataCodewords =
      candidate.totalCodewords - candidate.eccCodewordsPerBlock * candidate.blockCount;
    return headerBits + byteLength * 8 <= dataCodewords * 8;
  });
  if (!version) {
    throw new Error(
      `QR payload of ${byteLength} bytes exceeds the 106-byte capacity of version 6 at error correction level M.`,
    );
  }
  return version;
}

function buildDataCodewords(payload: Uint8Array, spec: QrVersionSpec): Uint8Array {
  const dataCodewordCount = spec.totalCodewords - spec.eccCodewordsPerBlock * spec.blockCount;
  const bits: number[] = [];
  const pushBits = (value: number, count: number): void => {
    for (let index = count - 1; index >= 0; index -= 1) {
      bits.push((value >>> index) & 1);
    }
  };

  pushBits(BYTE_MODE_INDICATOR, 4);
  pushBits(payload.length, BYTE_MODE_COUNT_BITS);
  for (const byte of payload) {
    pushBits(byte, 8);
  }

  // Terminator, then pad to a whole codeword, then alternating pad codewords.
  const capacityBits = dataCodewordCount * 8;
  for (let index = 0; index < 4 && bits.length < capacityBits; index += 1) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords = new Uint8Array(dataCodewordCount);
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) {
      byte = (byte << 1) | (bits[index + offset] ?? 0);
    }
    codewords[index / 8] = byte;
  }
  for (let index = bits.length / 8; index < dataCodewordCount; index += 1) {
    codewords[index] = PAD_CODEWORDS[(index - bits.length / 8) % PAD_CODEWORDS.length] ?? 0;
  }
  return codewords;
}

/** Split into equal blocks, add error correction, then interleave both halves. */
function interleaveCodewords(dataCodewords: Uint8Array, spec: QrVersionSpec): Uint8Array {
  const blockLength = dataCodewords.length / spec.blockCount;
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  for (let block = 0; block < spec.blockCount; block += 1) {
    const data = dataCodewords.subarray(block * blockLength, (block + 1) * blockLength);
    dataBlocks.push(data);
    eccBlocks.push(computeEccCodewords(data, spec.eccCodewordsPerBlock));
  }

  const result = new Uint8Array(spec.totalCodewords);
  let cursor = 0;
  for (let index = 0; index < blockLength; index += 1) {
    for (const block of dataBlocks) {
      result[cursor] = block[index] ?? 0;
      cursor += 1;
    }
  }
  for (let index = 0; index < spec.eccCodewordsPerBlock; index += 1) {
    for (const block of eccBlocks) {
      result[cursor] = block[index] ?? 0;
      cursor += 1;
    }
  }
  return result;
}

interface QrCanvas {
  size: number;
  modules: boolean[][];
  reserved: boolean[][];
}

function createCanvas(size: number): QrCanvas {
  return {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function setModule(canvas: QrCanvas, x: number, y: number, dark: boolean): void {
  const row = canvas.modules[y];
  const reservedRow = canvas.reserved[y];
  if (!row || !reservedRow) {
    return;
  }
  row[x] = dark;
  reservedRow[x] = true;
}

function drawFinderPattern(canvas: QrCanvas, centreX: number, centreY: number): void {
  for (let offsetY = -4; offsetY <= 4; offsetY += 1) {
    for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
      const x = centreX + offsetX;
      const y = centreY + offsetY;
      if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) {
        continue;
      }
      const distance = Math.max(Math.abs(offsetX), Math.abs(offsetY));
      setModule(canvas, x, y, distance !== 2 && distance <= 3);
    }
  }
}

function drawAlignmentPattern(canvas: QrCanvas, centre: number): void {
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      const distance = Math.max(Math.abs(offsetX), Math.abs(offsetY));
      setModule(canvas, centre + offsetX, centre + offsetY, distance !== 1);
    }
  }
}

function drawFunctionPatterns(canvas: QrCanvas, version: number): void {
  drawFinderPattern(canvas, 3, 3);
  drawFinderPattern(canvas, canvas.size - 4, 3);
  drawFinderPattern(canvas, 3, canvas.size - 4);

  for (let position = 8; position < canvas.size - 8; position += 1) {
    const dark = position % 2 === 0;
    setModule(canvas, position, 6, dark);
    setModule(canvas, 6, position, dark);
  }

  const alignmentCentre = ALIGNMENT_CENTRE_BY_VERSION[version];
  if (alignmentCentre !== undefined) {
    drawAlignmentPattern(canvas, alignmentCentre);
  }

  // Always-dark module, and the two format information strips.
  setModule(canvas, 8, canvas.size - 8, true);
  for (let index = 0; index < 9; index += 1) {
    setModule(canvas, index, 8, false);
    setModule(canvas, 8, index, false);
  }
  for (let index = 0; index < 8; index += 1) {
    setModule(canvas, canvas.size - 1 - index, 8, false);
    setModule(canvas, 8, canvas.size - 1 - index, false);
  }
}

function drawFormatInformation(canvas: QrCanvas, mask: number): void {
  const bits = buildFormatBits(mask);
  const bitAt = (index: number): boolean => ((bits >>> index) & 1) === 1;

  for (let index = 0; index <= 5; index += 1) {
    setModule(canvas, 8, index, bitAt(index));
  }
  setModule(canvas, 8, 7, bitAt(6));
  setModule(canvas, 8, 8, bitAt(7));
  setModule(canvas, 7, 8, bitAt(8));
  for (let index = 9; index < 15; index += 1) {
    setModule(canvas, 14 - index, 8, bitAt(index));
  }

  for (let index = 0; index < 8; index += 1) {
    setModule(canvas, canvas.size - 1 - index, 8, bitAt(index));
  }
  for (let index = 8; index < 15; index += 1) {
    setModule(canvas, 8, canvas.size - 15 + index, bitAt(index));
  }
  setModule(canvas, 8, canvas.size - 8, true);
}

/** Two columns at a time from the bottom right, skipping the vertical timing column. */
function walkDataModules(canvas: QrCanvas, visit: (x: number, y: number) => void): void {
  for (let right = canvas.size - 1; right >= 1; right -= 2) {
    const rightColumn = right === 6 ? 5 : right;
    for (let vertical = 0; vertical < canvas.size; vertical += 1) {
      for (let column = 0; column < 2; column += 1) {
        const x = rightColumn - column;
        const upward = ((rightColumn + 1) & 2) === 0;
        const y = upward ? canvas.size - 1 - vertical : vertical;
        if (!canvas.reserved[y]?.[x]) {
          visit(x, y);
        }
      }
    }
  }
}

function isMasked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x * y) % 3) + ((x + y) % 2)) % 2 === 0;
  }
}

function countPenaltyRun(runLength: number): number {
  return runLength >= 5 ? runLength - 2 : 0;
}

function scorePenalty(modules: boolean[][], size: number): number {
  let penalty = 0;

  // Runs of five or more, in both directions.
  for (let line = 0; line < size; line += 1) {
    for (const horizontal of [true, false]) {
      let runColour = false;
      let runLength = 0;
      for (let index = 0; index < size; index += 1) {
        const dark = horizontal
          ? (modules[line]?.[index] ?? false)
          : (modules[index]?.[line] ?? false);
        if (dark === runColour) {
          runLength += 1;
          continue;
        }
        penalty += countPenaltyRun(runLength) * 3;
        runColour = dark;
        runLength = 1;
      }
      penalty += countPenaltyRun(runLength) * 3;
    }
  }

  // Solid two-by-two blocks.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const first = modules[y]?.[x] ?? false;
      if (
        first === (modules[y]?.[x + 1] ?? false) &&
        first === (modules[y + 1]?.[x] ?? false) &&
        first === (modules[y + 1]?.[x + 1] ?? false)
      ) {
        penalty += 3;
      }
    }
  }

  // Finder-like patterns.
  const finder = [true, false, true, true, true, false, true];
  for (let line = 0; line < size; line += 1) {
    for (const horizontal of [true, false]) {
      for (let start = 0; start + finder.length <= size; start += 1) {
        const matches = finder.every((expected, offset) => {
          const index = start + offset;
          const dark = horizontal
            ? (modules[line]?.[index] ?? false)
            : (modules[index]?.[line] ?? false);
          return dark === expected;
        });
        if (!matches) {
          continue;
        }
        const hasQuietBefore = Array.from({ length: 4 }, (_, offset) => start - 1 - offset).every(
          (index) =>
            index < 0 ||
            !(horizontal ? (modules[line]?.[index] ?? false) : (modules[index]?.[line] ?? false)),
        );
        const hasQuietAfter = Array.from(
          { length: 4 },
          (_, offset) => start + finder.length + offset,
        ).every(
          (index) =>
            index >= size ||
            !(horizontal ? (modules[line]?.[index] ?? false) : (modules[index]?.[line] ?? false)),
        );
        if (hasQuietBefore || hasQuietAfter) {
          penalty += 40;
        }
      }
    }
  }

  // Imbalance between dark and light.
  const darkCount = modules.reduce(
    (total, row) => total + row.reduce((rowTotal, dark) => rowTotal + (dark ? 1 : 0), 0),
    0,
  );
  const percentage = (darkCount * 100) / (size * size);
  penalty += Math.floor(Math.abs(percentage - 50) / 5) * 10;

  return penalty;
}

export interface QrSymbol {
  version: number;
  size: number;
  mask: number;
  /** `true` is a dark module. Indexed `[y][x]`, quiet zone not included. */
  modules: boolean[][];
}

export function encodeQr(text: string): QrSymbol {
  const payload = toUtf8(text);
  const spec = selectVersion(payload.length);
  const codewords = interleaveCodewords(buildDataCodewords(payload, spec), spec);
  const size = 17 + 4 * spec.version;

  const canvas = createCanvas(size);
  drawFunctionPatterns(canvas, spec.version);

  const bits: boolean[] = [];
  for (const codeword of codewords) {
    for (let index = 7; index >= 0; index -= 1) {
      bits.push(((codeword >>> index) & 1) === 1);
    }
  }
  for (let index = 0; index < (REMAINDER_BITS_BY_VERSION[spec.version] ?? 0); index += 1) {
    bits.push(false);
  }

  let bitIndex = 0;
  const dataPositions: Array<[number, number]> = [];
  walkDataModules(canvas, (x, y) => {
    const row = canvas.modules[y];
    if (row) {
      row[x] = bits[bitIndex] ?? false;
    }
    dataPositions.push([x, y]);
    bitIndex += 1;
  });

  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  let bestModules: boolean[][] = canvas.modules;
  for (let mask = 0; mask < MASK_COUNT; mask += 1) {
    const masked = canvas.modules.map((row) => [...row]);
    for (const [x, y] of dataPositions) {
      if (isMasked(mask, x, y)) {
        const row = masked[y];
        if (row) {
          row[x] = !row[x];
        }
      }
    }
    const maskedCanvas: QrCanvas = { ...canvas, modules: masked };
    drawFormatInformation(maskedCanvas, mask);
    const penalty = scorePenalty(masked, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = masked;
    }
  }

  return { version: spec.version, size, mask: bestMask, modules: bestModules };
}

interface QrPixelOptions {
  /** Pixels per module. The rendered image is square. */
  modulePixels: number;
  /** Light border, in modules. The specification asks for four. */
  quietZoneModules: number;
}

/** Expands a symbol into a pixel grid where `true` is black. */
export function renderQrPixels(symbol: QrSymbol, options: QrPixelOptions): boolean[][] {
  const paddedModules = symbol.size + options.quietZoneModules * 2;
  const pixelSize = paddedModules * options.modulePixels;

  return Array.from({ length: pixelSize }, (_, pixelY) => {
    const moduleY = Math.floor(pixelY / options.modulePixels) - options.quietZoneModules;
    return Array.from({ length: pixelSize }, (_, pixelX) => {
      const moduleX = Math.floor(pixelX / options.modulePixels) - options.quietZoneModules;
      return symbol.modules[moduleY]?.[moduleX] ?? false;
    });
  });
}

/** Proves the walk, the mask, the interleave, and the header agree. */
export function decodeQr(symbol: QrSymbol): string {
  const canvas = createCanvas(symbol.size);
  drawFunctionPatterns(canvas, symbol.version);

  const bits: boolean[] = [];
  walkDataModules(canvas, (x, y) => {
    const dark = symbol.modules[y]?.[x] ?? false;
    bits.push(isMasked(symbol.mask, x, y) ? !dark : dark);
  });

  const spec = QR_VERSIONS.find((candidate) => candidate.version === symbol.version);
  if (!spec) {
    throw new Error(`Unsupported QR version ${symbol.version}.`);
  }

  const codewords = new Uint8Array(spec.totalCodewords);
  for (let index = 0; index < codewords.length; index += 1) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) {
      byte = (byte << 1) | (bits[index * 8 + offset] ? 1 : 0);
    }
    codewords[index] = byte;
  }

  const dataCodewordCount = spec.totalCodewords - spec.eccCodewordsPerBlock * spec.blockCount;
  const blockLength = dataCodewordCount / spec.blockCount;
  const data = new Uint8Array(dataCodewordCount);
  for (let index = 0; index < dataCodewordCount; index += 1) {
    const block = index % spec.blockCount;
    const position = Math.floor(index / spec.blockCount);
    data[block * blockLength + position] = codewords[index] ?? 0;
  }

  const readBits = (start: number, count: number): number => {
    let value = 0;
    for (let offset = 0; offset < count; offset += 1) {
      const bitPosition = start + offset;
      const byte = data[Math.floor(bitPosition / 8)] ?? 0;
      value = (value << 1) | ((byte >>> (7 - (bitPosition % 8))) & 1);
    }
    return value;
  };

  if (readBits(0, 4) !== BYTE_MODE_INDICATOR) {
    throw new Error('Decoded QR symbol does not start with the byte-mode indicator.');
  }
  const length = readBits(4, BYTE_MODE_COUNT_BITS);
  const payload = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    payload[index] = readBits(4 + BYTE_MODE_COUNT_BITS + index * 8, 8);
  }
  return new TextDecoder().decode(payload);
}

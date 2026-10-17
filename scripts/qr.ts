/**
 * A small QR code encoder for the terminal (byte mode, error correction level
 * M, versions 1 to 10: up to 213 bytes, plenty for an otpauth:// URI), so
 * `npm run admin:setup` needs no dependency. Follows ISO/IEC 18004: data
 * codewords, Reed-Solomon blocks, interleaving, function patterns, the mask
 * with the lowest penalty, format and version bits.
 */

/** Level M per version 1..10: error correction codewords per block, and blocks. */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Format bits of level M. */
const ECL_M_BITS = 0;
const MAX_VERSION = 10;

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    r -= (25 * align - 10) * align - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

function dataCodewords(ver: number): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver]! * BLOCKS[ver]!;
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j]!, root);
      if (j + 1 < r.length) r[j] = r[j]! ^ r[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift()!;
    r.push(0);
    divisor.forEach((c, i) => (r[i] = r[i]! ^ gfMul(c, factor)));
  }
  return r;
}

/** Data bits (byte mode) padded to the version's data capacity. */
function encodeData(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

/** Split into blocks, add Reed-Solomon codewords and interleave. */
function addEcc(data: number[], ver: number): number[] {
  const numBlocks = BLOCKS[ver]!;
  const eccLen = ECC_PER_BLOCK[ver]!;
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const block = [...dat, ...rsRemainder(dat, divisor)];
    if (i < numShort) block.splice(shortLen - eccLen, 0, 0);
    blocks.push(block);
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]!);
    });
  }
  return out;
}

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fn: boolean[][];
  constructor(size: number) {
    this.size = size;
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  setFn(x: number, y: number, dark: boolean): void {
    this.dark[y]![x] = dark;
    this.fn[y]![x] = true;
  }
}

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

function drawFunctionPatterns(g: Grid, ver: number): void {
  const s = g.size;
  for (let i = 0; i < s; i++) {
    g.setFn(6, i, i % 2 === 0);
    g.setFn(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= s || y >= s) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        g.setFn(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(s - 4, 3);
  finder(3, s - 4);
  const pos = alignmentPositions(ver, s);
  const last = pos.length - 1;
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.setFn(pos[i]! + dx, pos[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  drawFormat(g, 0); // reserve the format areas (redrawn after masking)
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = s - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.setFn(a, b, dark);
      g.setFn(b, a, dark);
    }
  }
}

function drawFormat(g: Grid, mask: number): void {
  const data = (ECL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
  const s = g.size;
  for (let i = 0; i <= 5; i++) g.setFn(8, i, bit(i));
  g.setFn(8, 7, bit(6));
  g.setFn(8, 8, bit(7));
  g.setFn(7, 8, bit(8));
  for (let i = 9; i < 15; i++) g.setFn(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) g.setFn(s - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) g.setFn(8, s - 15 + i, bit(i));
  g.setFn(8, s - 8, true);
}

function drawCodewords(g: Grid, data: number[]): void {
  const s = g.size;
  let i = 0;
  for (let right = s - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < s; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? s - 1 - vert : vert;
        if (!g.fn[y]![x] && i < data.length * 8) {
          g.dark[y]![x] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(g: Grid, mask: number): void {
  const f = MASKS[mask]!;
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fn[y]![x] && f(x, y)) g.dark[y]![x] = !g.dark[y]![x];
}

/** Penalty rules 1 (runs), 2 (2x2 blocks), 3 (finder-like runs) and 4 (balance). */
function penalty(g: Grid): number {
  const s = g.size;
  const at = (x: number, y: number): boolean => g.dark[y]![x]!;
  let p = 0;
  for (let pass = 0; pass < 2; pass++)
    for (let a = 0; a < s; a++) {
      let run = 1;
      const line: boolean[] = [];
      for (let b = 0; b < s; b++) line.push(pass === 0 ? at(b, a) : at(a, b));
      for (let b = 1; b <= s; b++) {
        if (b < s && line[b] === line[b - 1]) run++;
        else {
          if (run >= 5) p += 3 + run - 5;
          run = 1;
        }
      }
      const str = line.map((d) => (d ? '1' : '0')).join('');
      for (const pat of ['00001011101', '10111010000']) for (let k = str.indexOf(pat); k >= 0; k = str.indexOf(pat, k + 1)) p += 40;
    }
  for (let y = 0; y < s - 1; y++) for (let x = 0; x < s - 1; x++) if (at(x, y) === at(x + 1, y) && at(x, y) === at(x, y + 1) && at(x, y) === at(x + 1, y + 1)) p += 3;
  let dark = 0;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (at(x, y)) dark++;
  p += Math.floor(Math.abs(dark * 20 - s * s * 10) / (s * s)) * 10;
  return p;
}

/** The QR modules (true = dark) for `text`, level M. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  while (ver <= MAX_VERSION && dataCodewords(ver) < bytes.length + (ver <= 9 ? 2 : 3)) ver++;
  if (ver > MAX_VERSION) throw new Error('text too long for a version 10 QR code');
  const codewords = addEcc(encodeData(bytes, ver), ver);
  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(ver * 4 + 17);
    drawFunctionPatterns(g, ver);
    drawCodewords(g, codewords);
    applyMask(g, mask);
    drawFormat(g, mask);
    const score = penalty(g);
    if (score < bestScore) {
      best = g;
      bestScore = score;
    }
  }
  return best!.dark;
}

/** The code as terminal text: two rows per line with half blocks, black on white, a 4 module quiet zone. */
export function qrTerminal(text: string): string {
  const m = qrMatrix(text);
  const q = 4;
  const n = m.length + q * 2;
  const dark = (x: number, y: number): boolean => x >= q && y >= q && x < n - q && y < n - q && m[y - q]![x - q]!;
  const lines: string[] = [];
  for (let y = 0; y < n; y += 2) {
    let line = '';
    for (let x = 0; x < n; x++) {
      const top = dark(x, y);
      const bottom = y + 1 < n ? dark(x, y + 1) : false;
      // Upper half block: foreground is the top module, background the bottom one.
      line += `\x1b[${top ? 30 : 97}m\x1b[${bottom ? 40 : 107}m▀`;
    }
    lines.push(`${line}\x1b[0m`);
  }
  return lines.join('\n');
}

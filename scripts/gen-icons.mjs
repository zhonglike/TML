/**
 * MONO — 图标生成
 * 用零依赖的方式生成 PNG（手写 PNG 编码 + zlib），保证仓库里不依赖任何第三方包。
 *   node scripts/gen-icons.mjs
 * 产出：
 *   assets/icons/icon-192.png
 *   assets/icons/icon-512.png
 *   assets/icons/icon-512-maskable.png
 *   assets/icons/favicon.svg
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'assets/icons');
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------ PNG 编码 */

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array(size*size*4) */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy
      ? rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
      : Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------ 绘制 */

/** 5x7 点阵字形（够画出 M / O） */
const GLYPH = {
  M: [
    '10001',
    '11011',
    '10101',
    '10001',
    '10001',
    '10001',
    '10001',
  ],
  O: [
    '01110',
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '01110',
  ],
};

function draw(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  const bg = maskable ? 0x0a : 0x00;
  // 底色 + 顶部渐变高光
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = bg + Math.round((1 - y / size) * 8);
      set(x, y, v, v, v, 255);
    }
  }
  // 外框（maskable 时内缩，保护安全区）
  const pad = maskable ? Math.round(size * 0.17) : Math.round(size * 0.085);
  const r = Math.round(size * 0.16);
  const stroke = Math.max(1, Math.round(size * 0.022));
  const inRounded = (x, y, l, t, rr, rrad) => {
    if (x < l || y < t || x > rr || y > rrad) return false;
    const cx = Math.min(Math.max(x, l + r), rr - r);
    const cy = Math.min(Math.max(y, t + r), rrad - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r + 1;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const outer = inRounded(x, y, pad, pad, size - 1 - pad, size - 1 - pad);
      if (!outer) continue;
      const inner = inRounded(x, y, pad + stroke, pad + stroke, size - 1 - pad - stroke, size - 1 - pad - stroke);
      if (inner) continue;
      set(x, y, 255, 255, 255, Math.round(255 * 0.9));
    }
  }
  // 字形 MO
  const scale = Math.max(1, Math.round(size * 0.052));
  const gw = 5 * scale;
  const gh = 7 * scale;
  const gap = Math.round(scale * 1.4);
  const totalW = gw * 2 + gap;
  const x0 = Math.round((size - totalW) / 2);
  const y0 = Math.round((size - gh) / 2);
  const paintGlyph = (glyph, ox) => {
    glyph.forEach((row, ry) => {
      row.split('').forEach((c, rx) => {
        if (c !== '1') return;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            set(ox + rx * scale + dx, y0 + ry * scale + dy, 255, 255, 255, 255);
          }
        }
      });
    });
  };
  paintGlyph(GLYPH.M, x0);
  paintGlyph(GLYPH.O, x0 + gw + gap);
  return px;
}

const sizes = [
  [192, false, 'icon-192.png'],
  [512, false, 'icon-512.png'],
  [512, true, 'icon-512-maskable.png'],
];

for (const [size, maskable, name] of sizes) {
  const png = encodePng(size, draw(size, maskable));
  writeFileSync(resolve(OUT, name), png);
  console.log(name, png.length, 'bytes');
}

/* favicon.svg */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="#000000"/>
  <rect x="11" y="11" width="106" height="106" rx="20" fill="none" stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="3"/>
  <g fill="#FFFFFF">
    <rect x="35" y="45" width="4" height="38"/><rect x="39" y="45" width="4" height="38"/>
    <rect x="43" y="49" width="4" height="30"/><rect x="47" y="45" width="4" height="38"/>
    <rect x="51" y="45" width="4" height="38"/>
    <rect x="69" y="45" width="28" height="4"/><rect x="69" y="79" width="28" height="4"/>
    <rect x="69" y="45" width="4" height="38"/><rect x="93" y="45" width="4" height="38"/>
  </g>
</svg>
`;
writeFileSync(resolve(OUT, 'favicon.svg'), svg, 'utf8');
console.log('favicon.svg', svg.length, 'bytes');

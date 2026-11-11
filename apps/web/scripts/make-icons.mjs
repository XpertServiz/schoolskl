// Generate the placeholder brand artwork (PNG) with no image library: a saffron school-house glyph on Slate.
//   node apps/web/scripts/make-icons.mjs
// DECISION: the product name/logo is undecided (open question 1), so this is a neutral placeholder mark. Replace the PNGs (same file names) when the real logo exists.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SLATE = [0x23, 0x30, 0x3a], SAFFRON = [0xf5, 0xa5, 0x24];

// ---- glyph as inside-tests in unit coordinates
const tri = (x, y, a, b, c) => {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const p = [x, y], d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const box = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
function glyph(x, y) {
  if (box(x, y, 0.44, 0.56, 0.56, 0.74)) return false; // door (cut out)
  if (tri(x, y, [0.16, 0.47], [0.5, 0.2], [0.84, 0.47])) return !tri(x, y, [0.3, 0.45], [0.5, 0.31], [0.7, 0.45]) || y > 0.45; // roof with a lighter gable
  if (box(x, y, 0.26, 0.47, 0.74, 0.74)) return true; // body
  if (box(x, y, 0.15, 0.76, 0.85, 0.8)) return true; // ground
  if (box(x, y, 0.495, 0.08, 0.508, 0.21)) return true; // flag pole
  if (tri(x, y, [0.508, 0.08], [0.64, 0.125], [0.508, 0.17])) return true; // flag
  return false;
}

function render(size, { bg, scale = 1, rounded = 0 }) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 3;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
      const u = (i + (si + 0.5) / SS) / size, v = (j + (sj + 0.5) / SS) / size;
      let col = null;
      const inCard = !rounded || roundedHit(u, v, rounded);
      if (inCard && bg) col = SLATE;
      const gx = (u - 0.5) / scale + 0.5, gy = (v - 0.5) / scale + 0.5;
      if (inCard && gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1 && glyph(gx, gy)) col = SAFFRON;
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
    }
    const n = SS * SS, o = (j * size + i) * 4;
    const cov = a / 255; // number of covered subsamples
    px[o] = cov ? Math.round(r / cov) : 0; px[o + 1] = cov ? Math.round(g / cov) : 0; px[o + 2] = cov ? Math.round(b / cov) : 0; px[o + 3] = Math.round(a / n);
  }
  return px;
}
const roundedHit = (u, v, rad) => {
  const x = Math.min(u, 1 - u), y = Math.min(v, 1 - v);
  if (x >= rad || y >= rad) return true;
  return (rad - x) ** 2 + (rad - y) ** 2 <= rad * rad;
};

// ---- minimal PNG encoder (RGBA8)
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
function png(size, px) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = (dir, name, size, opts) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), png(size, render(size, opts))); console.log(`${join(dir, name).replace(repo, '.')}  ${size}px`); };

const web = join(repo, 'apps', 'web', 'public', 'icons');
out(web, 'icon-192.png', 192, { bg: true, scale: 0.86 });
out(web, 'icon-512.png', 512, { bg: true, scale: 0.86 });
out(web, 'maskable-512.png', 512, { bg: true, scale: 0.62 });       // Android crops to a shape: keep the mark in the safe zone
out(web, 'apple-touch-180.png', 180, { bg: true, scale: 0.8 });
mkdirSync(join(repo, 'apps', 'web', 'src', 'app'), { recursive: true });
writeFileSync(join(repo, 'apps', 'web', 'src', 'app', 'icon.png'), png(64, render(64, { bg: true, scale: 0.9, rounded: 0.18 }))); // favicon (Next picks up app/icon.png)
console.log('apps/web/src/app/icon.png  64px');

const mob = join(repo, 'apps', 'mobile', 'assets');
out(mob, 'icon.png', 1024, { bg: true, scale: 0.78 });             // store icon: full-bleed square (the OS applies the mask)
out(mob, 'adaptive-icon.png', 1024, { bg: false, scale: 0.5 });    // Android adaptive foreground on a Slate background colour
out(mob, 'splash-icon.png', 512, { bg: false, scale: 1 });         // shown centred on the Slate splash background
out(mob, 'favicon.png', 48, { bg: true, scale: 0.9 });

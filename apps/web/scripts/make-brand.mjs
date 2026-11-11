// Generate every icon, favicon, splash and share image from the real logo (brand/logo-source.jpg), with the headless browser that
// is already a dev dependency (Playwright) — no image library needed.
//   node apps/web/scripts/make-brand.mjs
// The source is gold on a dark background; the background is removed (alpha from the red channel) so the mark can sit on any surface.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = 'data:image/jpeg;base64,' + readFileSync(join(repo, 'brand', 'logo-source.jpg')).toString('base64');
const BG = '#1f2329'; // the logo's own background colour (dark charcoal) — used for tiles that need an opaque background

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const out = await page.evaluate(async ({ src, BG }) => {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const W = img.naturalWidth, H = img.naturalHeight;
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const bx = base.getContext('2d'); bx.drawImage(img, 0, 0);
  const d = bx.getImageData(0, 0, W, H); const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const a = Math.min(1, Math.max(0, (p[i] - 52) / 95)); // background red ≈ 30–45, gold ≥ 150
    // un-blend from the dark background so edges stay gold instead of grey
    if (a > 0.02) { p[i] = Math.min(255, (p[i] - 34 * (1 - a)) / a); p[i + 1] = Math.min(255, (p[i + 1] - 37 * (1 - a)) / a); p[i + 2] = Math.min(255, (p[i + 2] - 43 * (1 - a)) / a); }
    p[i + 3] = Math.round(a * 255);
  }
  bx.putImageData(d, 0, 0);
  const bbox = (y0, y1) => {
    let x0 = W, x1 = 0, ya = H, yb = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (p[(y * W + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < ya) ya = y; if (y > yb) yb = y; }
    return { x: x0, y: ya, w: x1 - x0 + 1, h: yb - ya + 1 };
  };
  const mark = bbox(240, 1020), full = bbox(240, H - 180); // the source is 2400×1792; the wordmark starts at ~y 1040
  // draw a region fitted inside a box of w×h (px), centred, with `fit` = fraction of the box it may fill; optional opaque background and corner radius
  const render = (r, w, h, { fit = 1, bg = null, radius = 0 } = {}) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    if (radius) { x.beginPath(); x.roundRect(0, 0, w, h, radius); x.clip(); }
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
    const s = Math.min((w * fit) / r.w, (h * fit) / r.h); const dw = r.w * s, dh = r.h * s;
    x.imageSmoothingQuality = 'high'; x.drawImage(base, r.x, r.y, r.w, r.h, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return c.toDataURL('image/png');
  };
  const markH = Math.round(320 * mark.h / mark.w);
  const o = {
    'web/public/logo-mark.png': render(mark, 320, markH),
    'web/public/logo-full.png': render(full, 1200, Math.round(1200 * full.h / full.w)),
    'web/public/icons/icon-192.png': render(mark, 192, 192, { fit: 0.74, bg: BG }),
    'web/public/icons/icon-512.png': render(mark, 512, 512, { fit: 0.74, bg: BG }),
    'web/public/icons/maskable-512.png': render(mark, 512, 512, { fit: 0.56, bg: BG }),
    'web/public/icons/apple-touch-180.png': render(mark, 180, 180, { fit: 0.74, bg: BG }),
    'web/src/app/icon.png': render(mark, 256, 256, { fit: 0.96 }),
    'web/src/app/apple-icon.png': render(mark, 180, 180, { fit: 0.74, bg: BG }),
    'ico16': render(mark, 16, 16, { fit: 1 }), 'ico32': render(mark, 32, 32, { fit: 1 }), 'ico48': render(mark, 48, 48, { fit: 1 }),
    'mobile/assets/icon.png': render(mark, 1024, 1024, { fit: 0.72, bg: BG }),
    'mobile/assets/adaptive-icon.png': render(mark, 1024, 1024, { fit: 0.5 }),
    'mobile/assets/splash-icon.png': render(mark, 1024, 1024, { fit: 0.9 }),
    'mobile/assets/splash-native.png': render(full, 1024, 1024, { fit: 0.8 }),
    'mobile/assets/favicon.png': render(mark, 48, 48, { fit: 0.96 }),
    'mobile/assets/logo-full.png': render(full, 1000, Math.round(1000 * full.h / full.w)),
  };
  // 1200×630 share picture: charcoal gradient + the full logo
  const og = document.createElement('canvas'); og.width = 1200; og.height = 630; const gx = og.getContext('2d');
  const g = gx.createRadialGradient(600, 300, 40, 600, 315, 700); g.addColorStop(0, '#2c313a'); g.addColorStop(1, '#14171c'); gx.fillStyle = g; gx.fillRect(0, 0, 1200, 630);
  const s = Math.min(1040 / full.w, 540 / full.h); const dw = full.w * s, dh = full.h * s; gx.drawImage(base, full.x, full.y, full.w, full.h, (1200 - dw) / 2, (630 - dh) / 2, dw, dh);
  o['web/src/app/opengraph-image.png'] = og.toDataURL('image/png');
  return { files: o, mark, full };
}, { src, BG });
await browser.close();

const save = (rel, dataUrl) => { const f = join(repo, 'apps', rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64')); console.log('wrote', rel); };
for (const [k, v] of Object.entries(out.files)) if (!k.startsWith('ico')) save(k, v);

// favicon.ico: three PNG images in one ICO container
const pngs = [16, 32, 48].map((n) => Buffer.from(out.files['ico' + n].split(',')[1], 'base64'));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length; const dir = Buffer.alloc(16 * pngs.length);
pngs.forEach((png, i) => { const n = [16, 32, 48][i]; dir[i * 16] = n; dir[i * 16 + 1] = n; dir.writeUInt16LE(1, i * 16 + 4); dir.writeUInt16LE(32, i * 16 + 6); dir.writeUInt32LE(png.length, i * 16 + 8); dir.writeUInt32LE(offset, i * 16 + 12); offset += png.length; });
const ico = Buffer.concat([head, dir, ...pngs]);
writeFileSync(join(repo, 'apps', 'web', 'src', 'app', 'favicon.ico'), ico);
console.log('wrote web/src/app/favicon.ico', ico.length, 'bytes; mark bbox', JSON.stringify(out.mark), 'full bbox', JSON.stringify(out.full));

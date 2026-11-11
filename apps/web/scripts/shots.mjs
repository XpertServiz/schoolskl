// Take real screenshots of the marketing site in headless Chromium (software WebGL), to check what a visitor actually sees.
//   node apps/web/scripts/shots.mjs <outDir> [baseUrl]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const out = process.argv[2] ?? '.shots';
const base = process.argv[3] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const logs = [];

async function shoot(name, { width, height, path = '/', cookies = [], wait = 5000, full = true, splashShot = false, dpr = 1 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  if (cookies.length) await ctx.addCookies(cookies.map((c) => ({ ...c, url: base })));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${name}] ${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => logs.push(`[${name}] PAGEERROR: ${String(e).slice(0, 300)}`));
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  if (splashShot) { await page.waitForTimeout(900); await page.screenshot({ path: join(out, `${name}-splash.png`) }); }
  await page.waitForTimeout(wait);
  const webgl = await page.evaluate(() => { const c = document.querySelector('.campus-canvas canvas'); return c ? `canvas ${c.width}x${c.height}` : 'NO CANVAS'; });
  const splashGone = await page.evaluate(() => { const s = document.getElementById('splash'); return !s || getComputedStyle(s).visibility === 'hidden' || getComputedStyle(s).display === 'none'; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: full });
  console.log(`${name}: ${webgl}; splash hidden after ${wait}ms: ${splashGone}; horizontal overflow: ${overflow}`);
  await ctx.close();
}

await shoot('desktop-en', { width: 1440, height: 900, splashShot: true, wait: 5500 });
await shoot('desktop-ur', { width: 1440, height: 900, cookies: [{ name: 'locale', value: 'ur' }], wait: 5500, splashShot: false });
await shoot('mobile-en', { width: 390, height: 844, wait: 5500, dpr: 2 });
await shoot('apps-en', { width: 1280, height: 900, path: '/apps', wait: 1500 });
await shoot('pricing-en', { width: 1280, height: 900, path: '/pricing', wait: 1500 });
await browser.close();
if (logs.length) console.log('\nbrowser console:\n' + [...new Set(logs)].join('\n'));

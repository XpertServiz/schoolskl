// Screenshots of signed-in school pages (real demo users, real data). node apps/web/scripts/shots-app.mjs <outDir> [port]
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const env = readFileSync(join(repo, 'apps', 'web', '.env.local'), 'utf8'); const get = (k) => new RegExp(`^${k}=(.+)$`, 'm').exec(env)?.[1]?.trim();
const URL_ = get('NEXT_PUBLIC_SUPABASE_URL'), ANON = get('NEXT_PUBLIC_SUPABASE_ANON_KEY'); const logins = readFileSync(join(repo, 'dev-logins.local.txt'), 'utf8');
const pw = (e) => new RegExp(`email:\\s+${e.replace(/\./g, '\\.')}\\s+password:\\s+(\\S+)`).exec(logins)?.[1];
const ref = new URL(URL_).hostname.split('.')[0]; const out = process.argv[2]; const port = process.argv[3] ?? '3000'; mkdirSync(out, { recursive: true });
async function cookies(email, host) {
  const s = await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw(email) }) })).json();
  const v = 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64url'), n = `sb-${ref}-auth-token`, size = 3180, parts = [];
  if (v.length <= size) parts.push([n, v]); else for (let i = 0; i * size < v.length; i++) parts.push([`${n}.${i}`, v.slice(i * size, (i + 1) * size)]);
  return parts.map(([name, value]) => ({ name, value, domain: host, path: '/' }));
}
const b = await chromium.launch();
async function shot(name, email, host, path, { w = 1280, h = 900, extra = [] } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } }); await ctx.addCookies([...(await cookies(email, host)), ...extra].map((c) => ({ name: c.name, value: c.value, url: `http://${host}:${port}` })));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await p.goto(`http://${host}:${port}${path}`, { waitUntil: 'networkidle', timeout: 90000 }); await p.waitForTimeout(500);
  await p.screenshot({ path: join(out, `${name}.png`), fullPage: true }); console.log(name, errs.length ? `ERRORS ${errs.join('|')}` : 'ok'); await ctx.close();
}
await shot('app-cockpit', 'owner@noor-academy.test', 'app.localhost', '/portal');
await shot('app-fees', 'owner@noor-academy.test', 'app.localhost', '/portal/fees');
await shot('app-family-parent', 'parent@noor-academy.test', 'app.localhost', '/portal/family', { w: 420, h: 900 });
await shot('app-cockpit-urdu', 'owner@noor-academy.test', 'app.localhost', '/portal', { extra: [{ name: 'locale', value: 'ur' }] });
await b.close();

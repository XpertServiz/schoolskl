// Apply migrations to a real Supabase/Postgres database, in order, once each.
//   node packages/db/scripts/apply.mjs --check           connect, list what is applied / pending, change nothing
//   node packages/db/scripts/apply.mjs                   apply pending migrations (each in its own transaction)
//   node packages/db/scripts/apply.mjs --seed            ...then load the FAKE demo tenants (dev projects only)
// Reads SUPABASE_DB_URL from the environment or apps/web/.env.local. The password is never printed.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const envFile = join(root, '..', '..', 'apps', 'web', '.env.local');
if (!process.env.SUPABASE_DB_URL && existsSync(envFile)) {
  const m = /^SUPABASE_DB_URL=(.+)$/m.exec(readFileSync(envFile, 'utf8'));
  if (m) process.env.SUPABASE_DB_URL = m[1].trim().replace(/^["']|["']$/g, '');
}
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL is not set (put it in apps/web/.env.local).'); process.exit(2); }
const masked = url.replace(/(:\/\/[^:]+:)[^@]*@/, '$1****@');
const check = process.argv.includes('--check'), seed = process.argv.includes('--seed');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
try { await client.connect(); } catch (e) { console.error(`Could not connect to ${masked}\n  ${e.message}`); process.exit(3); }

try {
  const who = (await client.query('select current_user u, version() v')).rows[0];
  console.log(`connected to ${masked} as ${who.u} (${who.v.split(' ').slice(0, 2).join(' ')})`);
  await client.query(`create table if not exists public._applied_migrations (name text primary key, applied_at timestamptz not null default now())`);
  await client.query(`alter table public._applied_migrations enable row level security`); // no policy: invisible to API roles
  const done = new Set((await client.query('select name from public._applied_migrations')).rows.map((r) => r.name));
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !done.has(f));
  console.log(`${done.size} applied, ${pending.length} pending of ${files.length}`);
  if (check) process.exit(0);

  for (const f of pending) {
    process.stdout.write(`applying ${f} ... `);
    try {
      await client.query('begin');
      await client.query(readFileSync(join(dir, f), 'utf8'));
      await client.query('insert into public._applied_migrations (name) values ($1)', [f]);
      await client.query('commit');
      console.log('ok');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      console.log('FAILED');
      console.error(`  ${e.message}${e.position ? ` (at character ${e.position})` : ''}\n  Nothing from this file was applied; earlier files stay applied. Fix and re-run.`);
      process.exit(1);
    }
  }
  if (seed) {
    process.stdout.write('loading seed (fake demo data) ... ');
    try { await client.query('begin'); await client.query(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8')); await client.query('commit'); console.log('ok'); }
    catch (e) { await client.query('rollback').catch(() => undefined); console.log('FAILED'); console.error(`  ${e.message}`); process.exit(1); }
  }
  console.log('done');
} finally {
  await client.end().catch(() => undefined);
}

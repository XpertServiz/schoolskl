// DEV ONLY: give every school an extra verified address <slug>.localhost so tenant websites work on your own machine
// (create_tenant registers <slug>.<app.root_domain>, which defaults to ilmora.pk). Additive and harmless; safe to re-run.
//   node packages/db/scripts/dev-domains.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const env = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'web', '.env.local'), 'utf8');
const url = /^SUPABASE_DB_URL=(.+)$/m.exec(env)?.[1]?.trim();
if (!url) { console.error('SUPABASE_DB_URL missing'); process.exit(2); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`insert into public.tenant_domains (tenant_id, domain, kind, is_primary, verified_at)
  select t.id, t.slug || '.localhost', 'subdomain', false, now() from public.tenants t
  on conflict (domain) do nothing returning domain`);
console.log(r.rowCount ? `added: ${r.rows.map((x) => x.domain).join(', ')}` : 'already present');
await c.end();

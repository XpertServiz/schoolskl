// DEV ONLY: give the FAKE Noor Academy a full class list (Playgroup … Grade 10, section A each), like Setup → "Add the usual classes".
//   node packages/db/scripts/dev-classes.mjs      (re-running adds nothing that exists)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const env = readFileSync(join(repo, 'apps', 'web', '.env.local'), 'utf8');
const get = (k) => new RegExp(`^${k}=(.+)$`, 'm').exec(env)?.[1]?.trim();
const c = new pg.Client({ connectionString: get('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } });
await c.connect();
const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const tenant = (await one(`select id from public.tenants where slug = 'noor-academy'`)).id;
const campus = (await one(`select id from public.campuses where tenant_id = $1 and code = 'MAIN'`, [tenant])).id;
const owner = (await one(`select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.tenant_id = $1 and r.key = 'school_owner' limit 1`, [tenant])).user_id;
await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: owner, tenant_id: tenant, aal: 'aal2' })]); // audit rows name the owner
const list = [['Playgroup', -2], ['Nursery', -1], ['Prep', 0], ...Array.from({ length: 10 }, (_, i) => [`Grade ${i + 1}`, i + 1])];
let added = 0;
for (const [name, level] of list) {
  let cls = (await one(`select id from public.classes where tenant_id = $1 and campus_id = $2 and lower(name) = lower($3)`, [tenant, campus, name]))?.id;
  if (!cls) { cls = (await one(`insert into public.classes (tenant_id, campus_id, name, level) values ($1,$2,$3,$4) returning id`, [tenant, campus, name, level])).id; added++; }
  await c.query(`insert into public.sections (tenant_id, class_id, name) select $1, $2, 'A' where not exists (select 1 from public.sections where tenant_id = $1 and class_id = $2)`, [tenant, cls]);
}
await c.end();
console.log(`${added} classes added; Noor Academy now has ${list.length} classes`);

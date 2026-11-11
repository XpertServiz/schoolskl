// SafeRoute demo for the FAKE Noor Academy on the dev project. DEV PROJECTS ONLY. Resumable: re-running changes nothing that exists.
//   node packages/db/scripts/dev-saferoute.mjs
// Creates a driver login (password appended to dev-logins.local.txt, gitignored), a staff record linked to it, "Route 1" with that driver,
// four fake children as riders, switches the school's `saferoute` flag on, and records the demo parent's consent for Amna only
// (Bilal stays without consent so the "no consent — not recorded" path can be seen on the driver's phone).
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const env = readFileSync(join(repo, 'apps', 'web', '.env.local'), 'utf8');
const get = (k) => new RegExp(`^${k}=(.+)$`, 'm').exec(env)?.[1]?.trim();
const SB = get('NEXT_PUBLIC_SUPABASE_URL'), SERVICE = get('SUPABASE_SERVICE_ROLE_KEY'), DB = get('SUPABASE_DB_URL');
if (!SB || !SERVICE || !DB) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_DB_URL missing in apps/web/.env.local'); process.exit(2); }

const c = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
const tenant = (await one(`select id from public.tenants where slug = 'noor-academy'`))?.id;
if (!tenant) { console.error('Noor Academy not found'); process.exit(1); }
const as = (sub) => c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub, tenant_id: tenant, aal: 'aal2' })]);

// ---- driver login
const email = 'driver@noor-academy.test';
let driver = (await one(`select id from auth.users where email = $1`, [email]))?.id;
if (!driver) {
  const password = randomBytes(12).toString('base64url') + 'aA1!';
  const r = await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  driver = (await r.json()).id;
  if (!driver) throw new Error(`could not create ${email}`);
  appendFileSync(join(repo, 'dev-logins.local.txt'), `\nNoor Academy driver (demo)\n  email:    ${email}\n  password: ${password}\n`);
  console.log(`login created: ${email}`);
}
await q(`insert into public.profiles (user_id, full_name, active_tenant_id) values ($1,'Aslam (demo driver)',$2) on conflict (user_id) do update set active_tenant_id = $2`, [driver, tenant]);
await q(`insert into public.user_tenants (tenant_id, user_id) values ($1,$2) on conflict do nothing`, [tenant, driver]);
await q(`insert into public.user_roles (tenant_id, user_id, role_id) select $1,$2,id from public.roles where tenant_id=$1 and key='driver' on conflict do nothing`, [tenant, driver]);
let staff = (await one(`select id from public.staff_members where tenant_id = $1 and user_id = $2`, [tenant, driver]))?.id;
if (!staff) staff = (await one(`insert into public.staff_members (tenant_id, employee_no, full_name, designation, user_id) values ($1,'D-001','Aslam (demo driver)','Driver',$2) returning id`, [tenant, driver])).id;

// ---- flag, route, riders
await q(`insert into public.tenant_flags (tenant_id, flag_key, enabled) values ($1,'saferoute',true) on conflict (tenant_id, flag_key) do update set enabled = true`, [tenant]);
let route = (await one(`select id from public.transport_routes where tenant_id = $1 and name = 'Route 1'`, [tenant]))?.id;
if (!route) route = (await one(`insert into public.transport_routes (tenant_id, name, vehicle_label, driver_staff_id) values ($1,'Route 1','LES-1234',$2) returning id`, [tenant, staff])).id;
const stops = { 'Amna Khan': 'Model Town', 'Bilal Khan': 'Model Town', 'Zara Ahmed': 'Garden Town', 'Hamza Raza': 'Faisal Town' };
for (const [name, stop] of Object.entries(stops)) {
  const s = (await one(`select id from public.students where tenant_id = $1 and full_name = $2`, [tenant, name]))?.id;
  if (s) await q(`insert into public.transport_riders (tenant_id, student_id, route_id, stop_name) values ($1,$2,$3,$4) on conflict do nothing`, [tenant, s, route, stop]);
}
// cards for every rider (same RPC the print page uses)
const owner = (await one(`select user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.tenant_id = $1 and r.key = 'school_owner' limit 1`, [tenant])).user_id;
await as(owner);
const cards = await q(`select full_name, token from public.route_cards($1)`, [route]);

// ---- the demo parent agrees for Amna only
const parent = (await one(`select id from auth.users where email = 'parent@noor-academy.test'`))?.id;
const amna = (await one(`select id from public.students where tenant_id = $1 and full_name = 'Amna Khan'`, [tenant]))?.id;
if (parent && amna) { await as(parent); await q(`select public.set_transport_consent($1, true)`, [amna]); }
await c.end();
console.log(`saferoute on · Route 1 · driver ${email} · ${cards.length} cards issued · consent recorded for Amna`);

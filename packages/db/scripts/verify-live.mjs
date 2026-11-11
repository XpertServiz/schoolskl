// Read-only checks of the security invariants against the REAL database (the same rules tests/rls-leak enforces on PGlite).
//   node packages/db/scripts/verify-live.mjs
// Needs SUPABASE_DB_URL in apps/web/.env.local. Changes nothing.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'web', '.env.local');
const env = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const get = (k) => process.env[k] ?? new RegExp(`^${k}=(.+)$`, 'm').exec(env)?.[1]?.trim();
const url = get('SUPABASE_DB_URL');
if (!url) { console.error('SUPABASE_DB_URL missing'); process.exit(2); }

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
let bad = 0;
const check = (name, rows, want = []) => {
  const got = rows.map((r) => (typeof r === 'object' ? Object.values(r)[0] : r)).sort();
  const ok = JSON.stringify(got) === JSON.stringify([...want].sort());
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`}`);
};

check('every public table has RLS enabled (except the migration ledger, which has RLS + no policy)',
  await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity`));
check('every tenant table: tenant_id NOT NULL, leading index, ≥1 policy',
  await q(`select c.table_name from information_schema.columns c where c.table_schema='public' and c.column_name='tenant_id'
           and c.table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
           and (c.is_nullable='YES'
             or not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.table_name)
             or not exists (select 1 from pg_index i join pg_class tc on tc.oid=i.indrelid join pg_attribute a on a.attrelid=tc.oid and a.attnum=i.indkey[0] where tc.relname=c.table_name and a.attname='tenant_id'))`));
check('anon can read only public marketing content (pricing, landing media, website settings)',
  await q(`select distinct table_name from information_schema.role_table_grants where grantee='anon' and table_schema='public'`), ['plan_features', 'plans', 'site_media', 'site_settings']);
check('anon can execute only resolve_tenant in public',
  await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon',p.oid,'execute')`), ['resolve_tenant']);
check('signed-in users can execute only the 8 policy helpers in schema app',
  await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.prokind='f' and has_function_privilege('authenticated',p.oid,'execute')`),
  ['can_see_voucher', 'current_tenant_id', 'has_permission', 'is_guardian_of_family', 'is_guardian_of_student', 'is_vendor_role', 'is_vendor_staff', 'tenant_writable']);
check('service-only functions are NOT executable by signed-in users',
  await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('run_nightly','handle_payment_webhook','claim_outbox','complete_outbox','record_delivery','outbox_recipients','outbox_context') and has_function_privilege('authenticated',p.oid,'execute')`));
check('every SECURITY DEFINER function pins its search_path',
  await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app') and p.prosecdef and not coalesce(p.proconfig::text like '%search_path%', false)`));
check('the auth hook can be run by Supabase Auth (and only it, not API roles)',
  await q(`select (has_function_privilege('supabase_auth_admin','public.custom_access_token_hook(jsonb)','execute') and not has_function_privilege('authenticated','public.custom_access_token_hook(jsonb)','execute') and not has_function_privilege('anon','public.custom_access_token_hook(jsonb)','execute'))::text as ok`), ['true']);
check('journal tables are append-only for API roles (no insert/update/delete grants)',
  await q(`select table_name||':'||privilege_type from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' and table_name in ('journal_entries','journal_lines','audit_log') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`));
// the code's catalogue (packages/core) must equal the database's, key for key
const coreSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'src', 'permissions.ts'), 'utf8');
const coreKeys = (/PERMISSION_KEYS\s*=\s*\[([\s\S]*?)\]/.exec(coreSrc)?.[1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1));
check(`permission catalogue matches packages/core (${coreKeys.length} keys)`, await q(`select key from public.permissions`), coreKeys);
check('plans seeded with NULL prices (no invented numbers)', await q(`select count(*)::text from public.plans where price_minor is not null`), ['0']);
check('legal-opinion flags are locked', await q(`select key from public.feature_flags where requires_legal_ref order by key`), ['face_attendance', 'learning_compass', 'saferoute_child_phone']);
check('deferred ledger-balance trigger exists', await q(`select tgname from pg_trigger where not tgisinternal and tgname ilike '%balanc%' limit 1`).then((r) => r.length ? ['present'] : []), ['present']);

await c.end();
console.log(bad ? `\n${bad} check(s) FAILED` : '\nall live checks passed');
process.exit(bad ? 1 : 0);

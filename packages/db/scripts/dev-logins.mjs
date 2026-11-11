// Give the FAKE seed users a password so you can sign in during development. DEV PROJECTS ONLY.
//   node packages/db/scripts/dev-logins.mjs
// Passwords are random, written to dev-logins.local.txt at the repo root (gitignored), and never printed.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const env = readFileSync(join(repo, 'apps', 'web', '.env.local'), 'utf8');
const get = (k) => new RegExp(`^${k}=(.+)$`, 'm').exec(env)?.[1]?.trim();
const url = get('NEXT_PUBLIC_SUPABASE_URL'), key = get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in apps/web/.env.local'); process.exit(2); }

const users = [
  ['00000000-0000-4000-8000-000000000001', 'vendor.admin@xpertserviz.test', 'Vendor super admin (use on http://vendor.localhost:3000)'],
  ['00000000-0000-4000-8000-0000000000a1', 'owner@noor-academy.test', 'Noor Academy owner (use on http://app.localhost:3000/portal/login)'],
  ['00000000-0000-4000-8000-0000000000b1', 'owner@city-grammar.test', 'City Grammar owner'],
];
// The seed inserted these users with plain SQL (id + email only), so Supabase Auth cannot see them: no audience, no instance id, tokens NULL.
// Complete the rows the way Auth itself would, plus an email identity. (Dev-only; the shared seed stays minimal so the PGlite tests keep working.)
import pg from 'pg';
const dbUrl = get('SUPABASE_DB_URL');
if (dbUrl) {
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const [id, email] of users) {
    await c.query(
      `update auth.users set instance_id = '00000000-0000-0000-0000-000000000000', aud = 'authenticated', role = 'authenticated',
         email_confirmed_at = coalesce(email_confirmed_at, now()), raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb), created_at = coalesce(created_at, now()), updated_at = now(),
         confirmation_token = coalesce(confirmation_token, ''), recovery_token = coalesce(recovery_token, ''),
         email_change_token_new = coalesce(email_change_token_new, ''), email_change = coalesce(email_change, ''),
         email_change_token_current = coalesce(email_change_token_current, ''), phone_change = coalesce(phone_change, ''),
         phone_change_token = coalesce(phone_change_token, ''), reauthentication_token = coalesce(reauthentication_token, '')
       where id = $1::uuid`, [id]);
    await c.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       select $2::text, $1::uuid, jsonb_build_object('sub', $1::uuid::text, 'email', $2::text, 'email_verified', true), 'email', now(), now(), now()
       where not exists (select 1 from auth.identities where user_id = $1::uuid and provider = 'email')`, [id, email]);
  }
  await c.end();
}

const out = ['DEV LOGINS — fake demo users on the dev project. Delete this file when done. Never commit it.', ''];
let failed = 0;
for (const [id, email, label] of users) {
  const password = randomBytes(12).toString('base64url') + 'aA1!';
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'PUT', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!r.ok) { failed++; console.error(`FAILED ${email}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); continue; }
  out.push(`${label}\n  email:    ${email}\n  password: ${password}\n`);
  console.log(`password set for ${email}`);
}
writeFileSync(join(repo, 'dev-logins.local.txt'), out.join('\n'));
if (!existsSync(join(repo, '.gitignore')) || !readFileSync(join(repo, '.gitignore'), 'utf8').includes('dev-logins.local.txt'))
  writeFileSync(join(repo, '.gitignore'), (existsSync(join(repo, '.gitignore')) ? readFileSync(join(repo, '.gitignore'), 'utf8') : '') + '\ndev-logins.local.txt\n');
console.log(failed ? `${failed} failed` : 'saved to dev-logins.local.txt (gitignored)');
process.exit(failed ? 1 : 0);

// End-to-end check against the live project through the PUBLIC API only (anon key + a real user session), the way the web/mobile apps work.
//   node packages/db/scripts/e2e-live.mjs        needs dev-logins.local.txt (node packages/db/scripts/dev-logins.mjs)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const env = readFileSync(join(repo, 'apps', 'web', '.env.local'), 'utf8');
const get = (k) => new RegExp(`^${k}=(.+)$`, 'm').exec(env)?.[1]?.trim();
const URL_ = get('NEXT_PUBLIC_SUPABASE_URL'), ANON = get('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const logins = readFileSync(join(repo, 'dev-logins.local.txt'), 'utf8');
const pw = (email) => new RegExp(`email:\\s+${email.replace(/\./g, '\\.')}\\s+password:\\s+(\\S+)`).exec(logins)?.[1];

let bad = 0;
const ok = (name, cond, extra = '') => { if (!cond) bad++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); return cond; };
const jwtClaims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

const auth = async (body, grant) => (await fetch(`${URL_}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const call = async (token, fn, args = {}) => { const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const table = async (token, t, q = 'select=*') => { const r = await fetch(`${URL_}/rest/v1/${t}?${q}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json().catch(() => null) }; };

// ---- owner of Noor Academy
const email = 'owner@noor-academy.test';
const s1 = await auth({ email, password: pw(email) }, 'password');
if (!ok('owner signs in with email + password', !!s1.access_token, s1.error_description ?? s1.msg ?? '')) process.exit(1);

const mine = await call(s1.access_token, 'my_tenants');
ok('my_tenants lists exactly their one school', mine.status === 200 && mine.body.length === 1, mine.body?.map?.((x) => x.name).join(','));
const tenantId = mine.body?.[0]?.tenant_id;


const set = await call(s1.access_token, 'set_active_tenant', { p_tenant: tenantId });
ok('set_active_tenant accepted for their own school', set.status < 300, JSON.stringify(set.body)?.slice(0, 100));
const other = await call(s1.access_token, 'set_active_tenant', { p_tenant: '00000000-0000-4000-8000-00000000dead' });
ok("set_active_tenant refuses a school they don't belong to", other.status >= 400);

const s2 = await auth({ refresh_token: s1.refresh_token }, 'refresh_token');
const claims = s2.access_token ? jwtClaims(s2.access_token) : {};
const hookOn = !!claims.tenant_id;
console.log(`INFO  Auth hook ${hookOn ? 'is ON (claim stamped in the token)' : 'is OFF — fine: the database falls back to the school the person chose (profiles.active_tenant_id), still verified against membership'}`);

{
  const t = s2.access_token ?? s1.access_token;
  const acc = await call(t, 'my_access');
  ok('my_access returns the school, role permissions and plan features', acc.body?.tenant?.name === 'Noor Academy' && acc.body.permissions.length > 20, `${acc.body?.permissions?.length} permissions, plan features: ${acc.body?.features?.join(',')}`);
  ok('owner has aal1 only: money/admin keys are correctly withheld until 2FA', !acc.body?.permissions?.includes('payroll.post') && acc.body?.permissions?.includes('students.view'));
  const cock = await call(t, 'school_cockpit');
  ok('school_cockpit works (empty school: zeros, no error)', cock.status === 200 && cock.body?.pending_approvals === 0);
  ok('approvals_inbox works', (await call(t, 'approvals_inbox')).status === 200);
  const tn = await table(t, 'tenants', 'select=slug');
  ok("cannot see other schools' rows (tenants → only their own)", tn.status === 200 && tn.body.length === 1 && tn.body[0].slug === 'noor-academy', tn.body?.map?.((x) => x.slug).join(','));
  ok('cannot call vendor-only create_tenant', (await call(t, 'create_tenant', { p_slug: 'evil-school', p_name: 'Evil' })).status >= 400);
  ok('cannot run the service-only nightly job', (await call(t, 'run_nightly', { p_tenant: tenantId })).status >= 400);
  const vend = await table(t, 'vendor_staff');
  ok('school owner cannot read vendor staff', vend.status === 200 && vend.body.length === 0);
}

// ---- the demo school's real data, as the people who use it (needs dev-demo-data.mjs)
const login = async (e) => (await auth({ email: e, password: pw(e) }, 'password')).access_token;
const parentT = await login('parent@noor-academy.test');
if (ok('parent signs in', !!parentT)) {
  const kids = await table(parentT, 'students', 'select=full_name&order=full_name');
  ok('parent sees ONLY their own two children (not the other 10 students)', JSON.stringify(kids.body?.map((x) => x.full_name)) === JSON.stringify(['Amna Khan', 'Bilal Khan']), kids.body?.map?.((x) => x.full_name).join(','));
  const vs = await table(parentT, 'vouchers', 'select=voucher_no,student_id');
  ok('parent sees vouchers only for those two children', vs.status === 200 && vs.body.length > 0 && vs.body.length <= 4, `${vs.body?.length} vouchers`);
  const res = await table(parentT, 'result_summaries', 'select=student_id,percent');
  ok('parent sees only their own child\'s published result', res.body?.length === 1, `${res.body?.length} result row(s)`);
  ok('parent cannot read payroll', (await table(parentT, 'payroll_runs')).body?.length === 0);
  ok('parent cannot read the ledger', (await table(parentT, 'journal_entries')).status !== 200 || (await table(parentT, 'journal_entries')).body?.length === 0);
  const acc = await call(parentT, 'my_access');
  ok('parent is a guardian with no staff permissions', acc.body?.is_guardian === true && !acc.body.permissions.includes('fees.collect'));
}
const teacherT = await login('teacher@noor-academy.test');
if (ok('teacher signs in', !!teacherT)) {
  const kids = await table(teacherT, 'students', 'select=id');
  ok('teacher can see the 12 students (tenant-wide view, documented)', kids.body?.length === 12, `${kids.body?.length}`);
  ok('teacher cannot read vouchers/fees', (await table(teacherT, 'vouchers')).body?.length === 0);
  const sec = (await table(teacherT, 'sections', 'select=id&limit=1')).body?.[0]?.id;
  const past = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  const r = await call(teacherT, 'mark_attendance', { p_section: sec, p_date: past });
  ok('teacher cannot rewrite a past day (attendance.edit_past rule)', r.status >= 400 && /locked|edit_past/.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 80));
}
const ownerT = s2.access_token ?? s1.access_token;
{
  const cock = await call(ownerT, 'school_cockpit');
  const f = cock.body?.fees;
  ok('cockpit shows 12 students and real fee numbers', cock.body?.students?.active === 12 && Number(f?.outstanding_minor) > 0, `outstanding ${f?.outstanding_minor}, overdue ${f?.overdue_minor}, collected today ${f?.collected_today_minor}`);
  const inbox = await call(ownerT, 'approvals_inbox');
  ok('approvals inbox works on real data', inbox.status === 200, `${inbox.body?.length} item(s)`);
  const pl = await call(ownerT, 'profit_loss', { p_from: '2026-01-01', p_to: '2026-12-31' });
  ok('P&L has income lines (aal1 owner may read reports)', pl.status === 200 && pl.body.some((x) => Number(x.amount) > 0), pl.status !== 200 ? JSON.stringify(pl.body).slice(0, 100) : '');
}

// ---- vendor admin
const vEmail = 'vendor.admin@xpertserviz.test';
const v = await auth({ email: vEmail, password: pw(vEmail) }, 'password');
if (ok('vendor admin signs in', !!v.access_token)) {
  const all = await table(v.access_token, 'tenants', 'select=slug,status&order=slug');
  ok('vendor sees all 3 demo schools', all.body?.length === 3, all.body?.map?.((x) => x.slug).join(','));
  const plans = await table(v.access_token, 'plans', 'select=key');
  ok('vendor reads plans', plans.body?.length === 4);
}

console.log(bad ? `\n${bad} check(s) FAILED` : '\nall live end-to-end checks passed');
process.exit(bad ? 1 : 0);

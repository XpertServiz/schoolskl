// DEV ONLY: fill the FAKE "Noor Academy" demo school with realistic data and create logins for a parent, teacher, accountant and cashier,
// so the cockpit, fee screens, parent app and teacher app have something to show. Fake names and numbers only; never real children's data.
//   node packages/db/scripts/dev-demo-data.mjs
// Everything goes through the same RPCs the app uses (so the ledger, vouchers and results are real and balanced).
// The ledger is immutable, so this script is RESUMABLE (each phase checks whether it already ran) instead of being re-run from scratch.
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const env = readFileSync(join(repo, 'apps', 'web', '.env.local'), 'utf8');
const get = (k) => new RegExp(`^${k}=(.+)$`, 'm').exec(env)?.[1]?.trim();
const SB = get('NEXT_PUBLIC_SUPABASE_URL'), SERVICE = get('SUPABASE_SERVICE_ROLE_KEY');
const OWNER = '00000000-0000-4000-8000-0000000000a1';

const c = new pg.Client({ connectionString: get('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
const count = async (table) => (await one(`select count(*)::int n from public.${table} where tenant_id = $1`, [tenant])).n;

const tenant = (await one(`select id from public.tenants where slug = 'noor-academy'`))?.id;
if (!tenant) { console.error('Noor Academy not found — run apply.mjs --seed first'); process.exit(1); }
const as = (sub) => c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub, tenant_id: tenant, aal: 'aal2' })]);

// ---- logins: real Auth users with random passwords written to dev-logins.local.txt (reused if they already exist)
const ROLES = { parent: ['parent@noor-academy.test', 'Mr Khan (demo parent)'], teacher: ['teacher@noor-academy.test', 'Ms Farah (demo teacher)'], accountant: ['accountant@noor-academy.test', 'Accounts Officer (demo)'], cashier: ['cashier@noor-academy.test', 'Cashier (demo)'] };
const uids = {};
for (const [role, [email, name]] of Object.entries(ROLES)) {
  let id = (await one(`select id from auth.users where email = $1`, [email]))?.id;
  if (!id) {
    const password = randomBytes(12).toString('base64url') + 'aA1!';
    const r = await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    id = (await r.json()).id;
    if (!id) throw new Error(`could not create ${email}`);
    appendFileSync(join(repo, 'dev-logins.local.txt'), `\nNoor Academy ${role} (demo)\n  email:    ${email}\n  password: ${password}\n`);
    console.log(`login created: ${email}`);
  }
  await q(`insert into public.profiles (user_id, full_name, active_tenant_id) values ($1,$2,$3) on conflict (user_id) do update set active_tenant_id = $3`, [id, name, tenant]);
  await q(`insert into public.user_tenants (tenant_id, user_id) values ($1,$2) on conflict do nothing`, [tenant, id]);
  await q(`insert into public.user_roles (tenant_id, user_id, role_id) select $1,$2,id from public.roles where tenant_id=$1 and key=$3 on conflict do nothing`, [tenant, id, role]);
  uids[role] = id;
}
// the demo school gets the Growth plan so exams, payroll and admissions are visible (Starter hides them)
await q(`update public.tenants set plan_id = (select id from public.plans where key = 'growth'), status = 'live' where id = $1`, [tenant]);

const kids = [
  ['Amna Khan', 'Grade 5', 'Mr Khan', '03001000001'], ['Bilal Khan', 'Grade 6', 'Mr Khan', '03001000001'],
  ['Zara Ahmed', 'Grade 5', 'Mr Ahmed', '03211000002'], ['Hamza Raza', 'Grade 5', 'Mr Raza', '03331000003'], ['Maryam Ali', 'Grade 5', 'Mr Ali', '03451000004'],
  ['Usman Sheikh', 'Grade 5', 'Mr Sheikh', '03001000005'], ['Ayesha Noor', 'Grade 5', 'Mr Noor', '03211000006'], ['Hassan Malik', 'Grade 6', 'Mr Malik', '03331000007'],
  ['Fatima Iqbal', 'Grade 6', 'Mr Iqbal', '03451000008'], ['Ibrahim Butt', 'Grade 6', 'Mr Butt', '03001000009'], ['Sana Tariq', 'Grade 6', 'Mr Tariq', '03211000010'], ['Daniyal Chaudhry', 'Grade 6', 'Mr Chaudhry', '03331000011'],
];

// =============================================================== phase 1: structure, fees, staff, students, vouchers, payments
if ((await count('students')) === 0) {
  await as(OWNER);
  const campus = (await one(`select id from public.campuses where tenant_id = $1 and code = 'MAIN'`, [tenant])).id;
  const today = (await one(`select app.tenant_today($1)::text d`, [tenant])).d;
  const session = (await one(`insert into public.academic_sessions (tenant_id,name,starts_on,ends_on,is_current) values ($1,'2026-27','2026-04-01','2027-03-31',true) returning id`, [tenant])).id;
  const classes = {}, sections = {};
  for (const [n, lvl] of [['Grade 5', 5], ['Grade 6', 6]]) {
    classes[n] = (await one(`insert into public.classes (tenant_id,campus_id,name,level) values ($1,$2,$3,$4) returning id`, [tenant, campus, n, lvl])).id;
    sections[n] = (await one(`insert into public.sections (tenant_id,class_id,name) values ($1,$2,'A') returning id`, [tenant, classes[n]])).id;
  }
  for (const [code, name] of [['MATH', 'Mathematics'], ['ENG', 'English'], ['URD', 'Urdu']]) await q(`insert into public.subjects (tenant_id,code,name) values ($1,$2,$3)`, [tenant, code, name]);

  const heads = {};
  for (const [code, name, acct, f] of [['TUITION', 'Tuition fee', '40100', 'monthly'], ['TRANSPORT', 'Transport fee', '40500', 'monthly'], ['ANNUAL', 'Annual fee', '40300', 'annual']])
    heads[code] = (await one(`insert into public.fee_heads (tenant_id,code,name,income_account_code,frequency) values ($1,$2,$3,$4,$5) returning id`, [tenant, code, name, acct, f])).id;
  const amounts = { 'Grade 5': [500000, 100000, 2000000], 'Grade 6': [600000, 100000, 2000000] };
  for (const [n, cl] of Object.entries(classes)) {
    const st = (await one(`insert into public.fee_structures (tenant_id,session_id,class_id,name) values ($1,$2,$3,$4) returning id`, [tenant, session, cl, `${n} 2026-27`])).id;
    const [t, tr, a] = amounts[n];
    await q(`insert into public.fee_structure_lines (tenant_id,structure_id,fee_head_id,amount_minor) values ($1,$2,$3,$4),($1,$2,$5,$6),($1,$2,$7,$8)`, [tenant, st, heads.TUITION, t, heads.TRANSPORT, tr, heads.ANNUAL, a]);
  }
  await q(`insert into public.fine_rules (tenant_id,grace_days,fine_minor) values ($1,5,50000)`, [tenant]);

  const staff = (await one(`insert into public.staff_members (tenant_id, employee_no, full_name, user_id, category) values ($1,'T-001','Ms Farah (demo teacher)',$2,'teaching') returning id`, [tenant, uids.teacher])).id;
  await q(`insert into public.staff_pay (tenant_id, staff_id, basic_minor) values ($1,$2,6000000)`, [tenant, staff]);

  const sid = {};
  for (const [name, cls, g, ph] of kids)
    sid[name] = (await one(`select public.enrol_student($1,$2,$3,$4,$5,'2015-06-01',$6,$7,$8) id`, [name, campus, session, classes[cls], sections[cls], /^(Amna|Zara|Maryam|Ayesha|Fatima|Sana)/.test(name) ? 'female' : 'male', g, ph])).id;
  await q(`update public.guardians set user_id = $1 where tenant_id = $2 and phone = '03001000001'`, [uids.parent, tenant]);

  // maker-checker: the accountant requests, a different person (the owner) approves
  await as(uids.accountant);
  const conc = (await one(`select public.request_concession($1,'percent',1000,'Staff child',$2) id`, [sid['Amna Khan'], heads.TUITION])).id;
  await as(OWNER);
  await q(`select public.approve_concession($1)`, [conc]);

  const m = await one(`select date_trunc('month', $1::date)::date::text cur, (date_trunc('month', $1::date) - interval '1 month')::date::text prev`, [today]);
  await q(`select public.generate_vouchers($1::date,$2,null,10)`, [m.prev, session]);
  await q(`select public.generate_vouchers($1::date,$2,null,10)`, [m.cur, session]);
  const vs = await q(`select v.id, v.family_id, v.total_minor, v.period::text, s.full_name from public.vouchers v join public.students s on s.id = v.student_id where v.tenant_id = $1 order by v.period, s.full_name`, [tenant]);
  await as(uids.accountant);
  let n = 0;
  for (const v of vs.filter((x) => x.period === m.prev)) { // last month: most families paid; these three stay overdue (reminders, fines)
    if (['Daniyal Chaudhry', 'Sana Tariq', 'Hamza Raza'].includes(v.full_name)) continue;
    await q(`select public.record_payment($1,$2,'bank',$3,$4)`, [v.family_id, Number(v.total_minor), `demo-bank-${++n}`, v.id]);
  }
  for (const v of vs.filter((x) => x.period === m.cur).slice(0, 4)) await q(`select public.record_payment($1,$2,'bank',$3,$4)`, [v.family_id, Number(v.total_minor), `demo-bank-${++n}`, v.id]);
  await as(uids.cashier);
  await q(`select public.open_cashier_session($1)`, [campus]);
  const cv = vs.find((x) => x.period === m.cur && x.full_name === 'Ayesha Noor');
  await q(`select public.record_payment($1,$2,'cash','demo-cash-1',$3)`, [cv.family_id, Number(cv.total_minor), cv.id]);
  console.log(`phase 1 done: ${kids.length} students, ${vs.length} vouchers`);
}

// ---- look everything up from the database, so the later phases work on a fresh run and on a resumed one
const campus = (await one(`select id from public.campuses where tenant_id = $1 and code = 'MAIN'`, [tenant])).id;
const today = (await one(`select app.tenant_today($1)::text d`, [tenant])).d;
const session = (await one(`select id from public.academic_sessions where tenant_id = $1 and is_current`, [tenant])).id;
const classes = Object.fromEntries((await q(`select name, id from public.classes where tenant_id = $1`, [tenant])).map((r) => [r.name, r.id]));
const sections = Object.fromEntries((await q(`select c.name, s.id from public.sections s join public.classes c on c.id = s.class_id where s.tenant_id = $1`, [tenant])).map((r) => [r.name, r.id]));
const subjects = Object.fromEntries((await q(`select code, id from public.subjects where tenant_id = $1`, [tenant])).map((r) => [r.code, r.id]));
const sid = Object.fromEntries((await q(`select full_name, id from public.students where tenant_id = $1`, [tenant])).map((r) => [r.full_name, r.id]));

// =============================================================== phase 2: attendance
if ((await count('student_attendance')) === 0) {
  // Past days need attendance.edit_past (a real rule: teachers can only mark TODAY), so history is entered as the owner; today as the teacher.
  const days = (await q(`select d::date::text d from generate_series($1::date - 9, $1::date, interval '1 day') d where extract(isodow from d) < 6 order by d desc limit 5`, [today])).map((r) => r.d);
  let k = 0;
  for (const d of days) for (const [cls, sec] of Object.entries(sections)) {
    const inCls = kids.filter((x) => x[1] === cls).map((x) => sid[x[0]]);
    const absent = [inCls[k % inCls.length]], late = k % 3 === 0 ? [inCls[(k + 2) % inCls.length]] : [];
    await as(d === today ? uids.teacher : OWNER);
    await q(`select public.mark_attendance($1,$2::date,$3::uuid[],$4::uuid[])`, [sec, d, absent, late.filter((x) => !absent.includes(x))]);
    k++;
  }
  console.log(`phase 2 done: attendance for ${days.length} school days`);
}

// =============================================================== phase 3: published exam
if ((await count('exams')) === 0) {
  await as(OWNER);
  const exam = (await one(`select public.create_exam($1,'Mid-term 2026') id`, [session])).id;
  const asmt = {}, max = { MATH: 100, ENG: 100, URD: 50 };
  for (const code of Object.keys(max)) asmt[code] = (await one(`select public.define_assessment($1,$2,$3,$4) id`, [exam, classes['Grade 5'], subjects[code], max[code]])).id;
  await q(`select public.set_exam_stage($1,'marking')`, [exam]);
  const g5 = kids.filter((x) => x[1] === 'Grade 5').map((x) => x[0]);
  for (const code of Object.keys(max))
    await q(`select public.enter_marks($1,$2::jsonb)`, [asmt[code], JSON.stringify(g5.map((name, i) => ({ student_id: sid[name], marks: Math.round(max[code] * (0.55 + ((i * 7 + code.length * 3) % 40) / 100)) })))]);
  await q(`select public.set_exam_stage($1,'moderation')`, [exam]);
  await q(`select public.publish_results($1)`, [exam]);
  console.log('phase 3 done: Mid-term published for Grade 5');
}

// =============================================================== phase 4: admissions
if ((await count('admission_inquiries')) === 0) {
  await as(OWNER);
  await q(`select public.create_inquiry($1,'Rida Khalid','Mr Khalid','03001230001',$2,'walk_in')`, [campus, classes['Grade 5']]);
  await q(`select public.create_inquiry($1,'Saad Hussain','Mr Hussain','03211230002',$2,'phone')`, [campus, classes['Grade 6']]);
  console.log('phase 4 done: 2 admission inquiries');
}

// ---- invariants: books balance, and receivable equals the sum of open voucher balances
const tb = (await one(`select coalesce(sum(debit - credit),0)::bigint t from public.journal_lines where tenant_id = $1`, [tenant])).t;
const rec = (await one(`select coalesce(sum(l.debit - l.credit),0)::bigint r from public.journal_lines l join public.accounts a on a.id = l.account_id where l.tenant_id = $1 and a.code = '11000'`, [tenant])).r;
const bal = (await one(`select coalesce(sum(total_minor + adjusted_minor - paid_minor),0)::bigint b from public.vouchers where tenant_id = $1 and status in ('issued','partially_paid')`, [tenant])).b;
console.log(`trial balance = ${tb} (must be 0); receivable ${rec} = voucher balances ${bal}: ${String(rec) === String(bal)}`);
await c.query(`select set_config('request.jwt.claims','',false)`);
await c.end();
if (String(tb) !== '0' || String(rec) !== String(bal)) { console.error('LEDGER CHECK FAILED'); process.exit(1); }
console.log('demo data ready. Logins are in dev-logins.local.txt');

import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { admin, q, type Claims, type World } from './db';

export interface School {
  tenant: string;
  campus: string;
  session: string;
  classId: string;
  section: string;
  /** staff & parent claims (all aal2) */
  owner: Claims;
  accountant: Claims;
  cashier: Claims;
  parent: Claims;
  userIds: { owner: string; accountant: string; cashier: string; parent: string };
  /** family 1 has two siblings (students[0], students[1]); family 2 has students[2] */
  students: string[];
  families: string[];
  heads: { tuition: string; transport: string; annual: string };
  cashierSession: string;
  period: string;
  today: string;
}

async function addUser(db: PGlite, tenant: string, roleKey: string, label: string): Promise<string> {
  const id = randomUUID();
  await admin(db, `insert into auth.users (id, email) values ($1, $2)`, [id, `${label}-${id.slice(0, 6)}@example.test`]);
  await admin(db, `insert into public.profiles (user_id, full_name) values ($1, $2)`, [id, label]);
  await admin(db, `insert into public.user_tenants (tenant_id, user_id) values ($1, $2)`, [tenant, id]);
  await admin(
    db,
    `insert into public.user_roles (tenant_id, user_id, role_id) select $1, $2, id from public.roles where tenant_id = $1 and key = $3`,
    [tenant, id, roleKey],
  );
  return id;
}

/**
 * A realistic little school, built ONLY through the public API (RPCs + owner inserts), so tests exercise the same
 * paths the app does: 1 class, 3 students in 2 families (siblings auto-linked by guardian phone), fee structure,
 * one approved 10% concession, November vouchers, a partial bank payment, a webhook payment, today's register with
 * one absentee, and an open cashier session with a cash payment. Amounts are PKR minor units.
 */
export async function seedSchool(db: PGlite, w: World, tenant: string, ownerId: string, tag = 'x'): Promise<School> {
  const owner = w.as(ownerId, tenant);
  const campus = (await admin<{ id: string }>(db, `select id from public.campuses where tenant_id = $1 and code = 'MAIN'`, [tenant])).rows[0]!.id;

  const session = (await q<{ id: string }>(db, owner, `insert into public.academic_sessions (tenant_id,name,starts_on,ends_on,is_current) values ($1,'2026-27','2026-04-01','2027-03-31',true) returning id`, [tenant])).rows[0]!.id;
  const classId = (await q<{ id: string }>(db, owner, `insert into public.classes (tenant_id,campus_id,name,level) values ($1,$2,'Grade 5',5) returning id`, [tenant, campus])).rows[0]!.id;
  const section = (await q<{ id: string }>(db, owner, `insert into public.sections (tenant_id,class_id,name) values ($1,$2,'A') returning id`, [tenant, classId])).rows[0]!.id;

  const head = async (code: string, name: string, acct: string, freq: string) =>
    (await q<{ id: string }>(db, owner, `insert into public.fee_heads (tenant_id,code,name,income_account_code,frequency) values ($1,$2,$3,$4,$5) returning id`, [tenant, code, name, acct, freq])).rows[0]!.id;
  const heads = { tuition: await head('TUITION', 'Tuition fee', '40100', 'monthly'), transport: await head('TRANSPORT', 'Transport fee', '40500', 'monthly'), annual: await head('ANNUAL', 'Annual fee', '40300', 'annual') };
  const structure = (await q<{ id: string }>(db, owner, `insert into public.fee_structures (tenant_id,session_id,class_id,name) values ($1,$2,$3,'Grade 5 2026-27') returning id`, [tenant, session, classId])).rows[0]!.id;
  await q(db, owner, `insert into public.fee_structure_lines (tenant_id,structure_id,fee_head_id,amount_minor) values ($1,$2,$3,500000),($1,$2,$4,100000),($1,$2,$5,2000000)`, [tenant, structure, heads.tuition, heads.transport, heads.annual]);
  await q(db, owner, `insert into public.fine_rules (tenant_id,grace_days,fine_minor) values ($1,5,50000)`, [tenant]);

  const userIds = {
    owner: ownerId,
    accountant: await addUser(db, tenant, 'accountant', 'accountant'),
    cashier: await addUser(db, tenant, 'cashier', 'cashier'),
    parent: await addUser(db, tenant, 'parent', 'parent'),
  };
  const accountant = w.as(userIds.accountant, tenant);
  const cashier = w.as(userIds.cashier, tenant);
  const parent = w.as(userIds.parent, tenant);

  const enrol = async (name: string, guardian: string, phone: string) =>
    (await q<{ id: string }>(db, owner, `select public.enrol_student($1,$2,$3,$4,$5,'2015-03-01','female',$6,$7) id`, [name, campus, session, classId, section, guardian, phone])).rows[0]!.id;
  const phone1 = `0300${tag.padEnd(7, '1').slice(0, 7)}`;
  const phone2 = `0321${tag.padEnd(7, '2').slice(0, 7)}`;
  const s1 = await enrol('Amna Khan', 'Mr Khan', phone1);
  const s2 = await enrol('Bilal Khan', 'Mr Khan', phone1); // sibling: same guardian phone -> same family
  const s3 = await enrol('Zara Ahmed', 'Mr Ahmed', phone2);
  const fam = (await admin<{ id: string }>(db, `select distinct family_id id from public.students where tenant_id = $1 order by 1`, [tenant])).rows.map((r) => r.id);
  const f1 = (await admin<{ family_id: string }>(db, `select family_id from public.students where id = $1`, [s1])).rows[0]!.family_id;
  const f2 = (await admin<{ family_id: string }>(db, `select family_id from public.students where id = $1`, [s3])).rows[0]!.family_id;
  if (fam.length !== 2) throw new Error(`expected 2 families, got ${fam.length} - sibling auto-link failed`);

  // the parent's login is linked to family 1's guardian
  await admin(db, `update public.guardians set user_id = $1 where tenant_id = $2 and phone = $3`, [userIds.parent, tenant, phone1]);
  await admin(db, `insert into public.student_sensitive (tenant_id, student_id, b_form_enc) values ($1,$2,'\\x00')`, [tenant, s1]);

  // maker-checker: accountant requests 10% off tuition for Amna, owner approves
  const conc = (await q<{ id: string }>(db, accountant, `select public.request_concession($1,'percent',1000,'Staff child',$2) id`, [s1, heads.tuition])).rows[0]!.id;
  await q(db, owner, `select public.approve_concession($1)`, [conc]);

  const period = '2026-11-01';
  await q(db, accountant, `select public.generate_vouchers($1::date,$2,$3)`, [period, session, classId]);

  const vouchers = (await admin<{ id: string; student_id: string }>(db, `select id, student_id from public.vouchers where tenant_id = $1 and period = $2`, [tenant, period])).rows;
  const v = (sid: string) => vouchers.find((x) => x.student_id === sid)!.id;

  // partial bank payment for family 1 (prefers Bilal's voucher), webhook payment settles Zara's voucher in full
  await q(db, accountant, `select public.record_payment($1, 200000, 'bank', $2, $3)`, [f1, `seed-bank-${tenant}`, v(s2)]);
  const zara = (await admin<{ consumer_no: string; total_minor: string }>(db, `select consumer_no, total_minor from public.vouchers where id = $1`, [v(s3)])).rows[0]!;
  await q(db, null, `select public.handle_payment_webhook('raast', $1, $2, $3::bigint, 'RAAST-1')`, [`evt-${tenant}`, zara.consumer_no, zara.total_minor], 'service_role');

  // today's register: Zara is absent -> an 'attendance.absent' alert lands in the outbox
  const today = (await admin<{ d: string }>(db, `select app.tenant_today($1)::text d`, [tenant])).rows[0]!.d;
  await q(db, owner, `select public.mark_attendance($1, $2::date, array[$3]::uuid[])`, [section, today, s3]);

  const cashierSession = (await q<{ id: string }>(db, cashier, `select public.open_cashier_session($1) id`, [campus])).rows[0]!.id;
  await q(db, cashier, `select public.record_payment($1, 100000, 'cash', $2)`, [f1, `seed-cash-${tenant}`]);

  return {
    tenant, campus, session, classId, section, owner, accountant, cashier, parent, userIds,
    students: [s1, s2, s3], families: [f1, f2], heads, cashierSession, period, today,
  };
}

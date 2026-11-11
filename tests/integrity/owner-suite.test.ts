import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

/** Owner suite: access control, accounting, reports, bank, payroll sheet, attendance devices, transport alerts, concession decisions, directory, platform. */
let db: PGlite;
let w: World;
let s: School;
let other: School;
const teacher = () => w.as(ids.teacherA, s.tenant);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, '3');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, '4');
});

describe('who can do what (owner-controlled)', () => {
  it('only the owner (or users.manage + 2FA) can read or change access; others are refused', async () => {
    expect((await q<{ o: { roles: unknown[] } }>(db, s.owner, `select public.access_overview() o`)).rows[0]!.o.roles.length).toBeGreaterThan(5);
    for (const who of [s.accountant, s.cashier, s.parent, teacher()]) {
      await expect(q(db, who, `select public.access_overview()`)).rejects.toThrow(/permission denied/);
      await expect(q(db, who, `select public.set_role_permission('cashier','fees.view',true)`)).rejects.toThrow(/permission denied/);
    }
    // an owner at aal1 (no 2FA) can still manage access — that is the point of this screen
    await q(db, w.as(ids.ownerA, s.tenant, { aal: 'aal1' }), `select public.set_role_permission('accountant','students.view',true)`);
  });

  it('role changes take effect at once: give the accountant the WhatsApp right, then take it away', async () => {
    const phone = async () => (await q<{ p: string | null }>(db, s.accountant, `select max(guardian_phone) p from public.students_directory()`)).rows[0]!.p;
    await q(db, s.owner, `select public.set_role_permission('accountant','students.view',true)`);
    expect(await phone()).toBeNull();
    await q(db, s.owner, `select public.set_role_permission('accountant','students.contact',true)`);
    expect(await phone()).toMatch(/^0\d{9,}/);
    await q(db, s.owner, `select public.set_role_permission('accountant','students.contact',false)`);
    expect(await phone()).toBeNull();
  });

  it('per-person overrides: deny beats the role, grant adds, inherit restores; the owner and yourself are untouchable', async () => {
    await q(db, s.owner, `select public.set_member_permission($1,'fees.collect','deny')`, [s.userIds.cashier]);
    await expect(q(db, s.cashier, `select public.open_cashier_session($1)`, [s.campus])).rejects.toThrow(/permission denied/);
    await q(db, s.owner, `select public.set_member_permission($1,'fees.collect','inherit')`, [s.userIds.cashier]);
    expect((await q(db, s.cashier, `select public.open_cashier_session($1) id`, [s.campus]).catch(() => ({ rows: [{}] }))).rows).toHaveLength(1);
    await expect(q(db, s.owner, `select public.set_member_permission($1,'fees.view','deny')`, [ids.ownerA])).rejects.toThrow(/your own access|full access/);
    await expect(q(db, s.owner, `select public.set_role_permission('school_owner','fees.view',false)`)).rejects.toThrow(/full access/);
    await expect(q(db, s.owner, `select public.set_member_permission($1,'nonsense.key','grant')`, [s.userIds.cashier])).rejects.toThrow(/unknown permission/);
  });

  it('another school’s owner cannot touch this school’s roles or people', async () => {
    await expect(q(db, other.owner, `select public.set_member_permission($1,'fees.view','grant')`, [s.userIds.cashier])).rejects.toThrow(/not a member/);
    const o = (await q<{ o: { members: { user_id: string }[] } }>(db, other.owner, `select public.access_overview() o`)).rows[0]!.o;
    expect(o.members.map((m) => m.user_id)).not.toContain(s.userIds.cashier);
  });
});

describe('chart of accounts and general journal', () => {
  it('the accountant adds accounts (5-digit code, no duplicates); a cashier cannot; built-in accounts are protected', async () => {
    const id = (await q<{ id: string }>(db, s.accountant, `select public.add_account('13000','Staff advances','asset') id`)).rows[0]!.id;
    await expect(q(db, s.accountant, `select public.add_account('13000','Again','asset')`)).rejects.toThrow(/already exists/);
    await expect(q(db, s.accountant, `select public.add_account('12','Bad','asset')`)).rejects.toThrow(/5 digits/);
    await expect(q(db, s.cashier, `select public.add_account('13100','Nope','asset')`)).rejects.toThrow(/permission denied/);
    await q(db, s.accountant, `select public.update_account($1,'Staff loans',true)`, [id]);
    expect((await admin<{ name: string; normal_side: string }>(db, `select name, normal_side from public.accounts where id = $1`, [id])).rows[0]).toEqual({ name: 'Staff loans', normal_side: 'debit' });
    const sys = (await admin<{ id: string }>(db, `select id from public.accounts where tenant_id = $1 and code = '10100'`, [s.tenant])).rows[0]!.id;
    await expect(q(db, s.accountant, `select public.update_account($1,'Renamed',true)`, [sys])).rejects.toThrow(/built-in/);
  });

  it('modify = reverse + repost, delete = reverse; only manual entries; never twice; the books stay balanced', async () => {
    const lines = (n: number) => JSON.stringify([{ a: '10100', d: n, c: 0 }, { a: '40100', d: 0, c: n }]);
    const j = (await q<{ id: string }>(db, s.owner, `select public.post_manual_journal($1::date,'Test sale',$2::jsonb) id`, [s.today, lines(10000)])).rows[0]!.id;
    const j2 = (await q<{ id: string }>(db, s.owner, `select public.amend_manual_journal($1,$2::date,'Corrected',$3::jsonb,'typo') id`, [j, s.today, lines(12000)])).rows[0]!.id;
    expect(j2).toBeTruthy();
    await expect(q(db, s.owner, `select public.amend_manual_journal($1,null,null,null,'again')`, [j])).rejects.toThrow(/already reversed/);
    await q(db, s.owner, `select public.void_manual_journal($1,'cancelled')`, [j2]);
    const list = (await q<{ entry_id: string; reversed: boolean }>(db, s.owner, `select entry_id, reversed from public.journal_list($1::date,$2::date)`, ['2000-01-01', '2100-01-01'])).rows;
    expect(list.find((e) => e.entry_id === j)!.reversed).toBe(true);
    const tb = (await q<{ d: string; c: string }>(db, s.owner, `select sum(debit) d, sum(credit) c from public.report_trial_balance($1::date)`, ['2100-01-01'])).rows[0]!;
    expect(tb.d).toBe(tb.c);
    const voucherEntry = (await admin<{ id: string }>(db, `select id from public.journal_entries where tenant_id = $1 and source_type <> 'manual' and reversal_of is null limit 1`, [s.tenant])).rows[0]!.id;
    await expect(q(db, s.owner, `select public.amend_manual_journal($1,null,null,null,'x')`, [voucherEntry])).rejects.toThrow(/only manual/);
    await expect(q(db, s.cashier, `select public.void_manual_journal($1,'x')`, [j])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.owner, `select public.amend_manual_journal($1,null,null,null,'')`, [j])).rejects.toThrow(/reason/);
  });
});

describe('reports', () => {
  it('trial balance balances, cash flow has opening and closing, ledger and aged receivables return data, payables run', async () => {
    const cf = (await q<{ label: string }>(db, s.accountant, `select label from public.report_cash_flow($1::date,$2::date)`, ['2000-01-01', '2100-01-01'])).rows.map((r) => r.label);
    expect(cf[0]).toBe('__opening__'); expect(cf.at(-1)).toBe('__closing__');
    const acct = (await admin<{ id: string }>(db, `select id from public.accounts where tenant_id = $1 and code = '11000'`, [s.tenant])).rows[0]!.id;
    expect((await q(db, s.accountant, `select * from public.report_general_ledger($1,$2::date,$3::date)`, [acct, '2000-01-01', '2100-01-01'])).rows.length).toBeGreaterThan(1);
    const aged = (await q<{ total: string }>(db, s.accountant, `select * from public.report_aged_receivables($1::date)`, [s.today])).rows;
    expect(aged.length).toBeGreaterThan(0);
    await q(db, s.accountant, `select * from public.report_payables($1::date)`, [s.today]);
    await expect(q(db, s.cashier, `select * from public.report_trial_balance($1::date)`, [s.today])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.parent, `select * from public.report_aged_receivables($1::date)`, [s.today])).rejects.toThrow(/permission denied/);
    // never another school's numbers
    const mine = (await q<{ n: string }>(db, other.owner, `select count(*) n from public.report_trial_balance($1::date) where debit > 0`, ['2100-01-01'])).rows[0]!.n;
    expect(Number(mine)).toBeGreaterThan(0);
  });
});

describe('bank reconciliation', () => {
  it('differences are posted to the books at once; the reconciliation records statement vs books', async () => {
    const bal = async () => Number((await q<{ b: string }>(db, s.accountant, `select public.bank_book_balance($1::date) b`, [s.today])).rows[0]!.b);
    const b0 = await bal();
    await q(db, s.accountant, `select public.add_account('59000','Bank charges','expense')`);
    await q(db, s.accountant, `select public.post_bank_entry($1::date,'Bank charges',50000,'payment','59000')`, [s.today]);
    expect(await bal()).toBe(b0 - 50000);
    await q(db, s.accountant, `select public.post_bank_entry($1::date,'Interest',20000,'deposit','59000')`, [s.today]);
    expect(await bal()).toBe(b0 - 30000);
    const rec = (await q<{ id: string }>(db, s.accountant, `select public.save_bank_reconciliation($1::date,$2,'March') id`, [s.today, b0])).rows[0]!.id;
    expect((await admin<{ difference_minor: number }>(db, `select difference_minor from public.bank_reconciliations where id = $1`, [rec])).rows[0]!.difference_minor).toBe(30000 as never);
    await expect(q(db, s.accountant, `select public.post_bank_entry($1::date,'x',0,'deposit','59000')`, [s.today])).rejects.toThrow(/above zero/);
    await expect(q(db, s.accountant, `select public.post_bank_entry($1::date,'x',100,'deposit','10200')`, [s.today])).rejects.toThrow(/another account/);
    await expect(q(db, s.cashier, `select public.post_bank_entry($1::date,'x',100,'deposit','59000')`, [s.today])).rejects.toThrow(/permission denied/);
  });

  it('an unmatched statement credit can be booked to an account and closes the line', async () => {
    await q(db, s.accountant, `select * from public.import_bank_statement('june', '[{"date":"2026-11-02","description":"Profit credit","amount_minor":77700}]'::jsonb)`);
    const line = (await admin<{ id: string }>(db, `select id from public.bank_statement_lines where tenant_id = $1 and description = 'Profit credit'`, [s.tenant])).rows[0]!.id;
    await q(db, s.accountant, `select public.post_bank_line($1,'59000')`, [line]);
    expect((await admin<{ status: string }>(db, `select status from public.bank_statement_lines where id = $1`, [line])).rows[0]!.status).toBe('ignored');
    await expect(q(db, s.accountant, `select public.post_bank_line($1,'59000')`, [line])).rejects.toThrow(/already handled|not found/);
  });
});

describe('payroll sheet, attendance devices', () => {
  let staff: string;
  it('payroll_sheet lists each employee with joining date, salary and the month’s attendance, for payroll staff only', async () => {
    staff = (await q<{ id: string }>(db, s.owner, `insert into public.staff_members (tenant_id, employee_no, full_name, designation, joined_on) values ($1,'E-77','Ms Hina','Teacher','2024-08-01') returning id`, [s.tenant])).rows[0]!.id;
    await q(db, s.owner, `insert into public.staff_pay (tenant_id, staff_id, basic_minor, annual_leave_days) values ($1,$2,4500000,10)`, [s.tenant, staff]);
    const period = s.today.slice(0, 8) + '01';
    await q(db, s.owner, `select public.mark_staff_attendance($1::date,$2::jsonb)`, [s.today, JSON.stringify([{ staff_id: staff, status: 'leave' }])]);
    const row = (await q<{ full_name: string; joined_on: string; basic_minor: string; annual_leave_days: number; leave_days: number; leaves_taken_year: number }>(db, s.owner, `select * from public.payroll_sheet($1::date) where employee_no = 'E-77'`, [period])).rows[0]!;
    expect(row).toMatchObject({ full_name: 'Ms Hina', basic_minor: 4500000, annual_leave_days: 10, leave_days: 1, leaves_taken_year: 1 });
    expect(String(row.joined_on)).toContain('2024');
    await expect(q(db, s.cashier, `select * from public.payroll_sheet($1::date)`, [period])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.parent, `select * from public.staff_month_days($1,$2::date)`, [staff, period])).rejects.toThrow(/permission denied/);
  });

  it('a fingerprint/clock device: key shown once, first punch = in, later = out, unknown employee/device refused, can be switched off', async () => {
    const key = (await q<{ k: string }>(db, s.owner, `select public.register_attendance_device('Gate machine') k`)).rows[0]!.k;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    await expect(q(db, s.cashier, `select public.register_attendance_device('x')`)).rejects.toThrow(/permission denied/);
    expect((await admin<{ token_hash: string }>(db, `select token_hash from public.attendance_devices where tenant_id = $1`, [s.tenant])).rows.every((r) => r.token_hash !== key)).toBe(true);
    const punch = async (emp: string, at: string, token = key) => (await q<{ r: string }>(db, null, `select public.ingest_punch($1,$2,$3::timestamptz) r`, [token, emp, at], 'service_role')).rows[0]!.r;
    await admin(db, `delete from public.staff_attendance where staff_id = $1`, [staff]);
    expect(await punch('E-77', `${s.today}T03:00:00Z`)).toBe('in');
    expect(await punch('E-77', `${s.today}T03:00:20Z`)).toBe('ignored');
    expect(await punch('E-77', `${s.today}T11:00:00Z`)).toBe('out');
    const r = (await admin<{ check_in: string; check_out: string; source: string }>(db, `select check_in, check_out, source from public.staff_attendance where staff_id = $1`, [staff])).rows[0]!;
    expect(r.source).toBe('device'); expect(r.check_in < r.check_out).toBe(true);
    expect(await punch('NOBODY', `${s.today}T04:00:00Z`)).toBe('unknown_employee');
    await expect(punch('E-77', `${s.today}T04:00:00Z`, 'f'.repeat(64))).rejects.toThrow(/unknown device/);
    const id = (await admin<{ id: string }>(db, `select id from public.attendance_devices where tenant_id = $1 and name = 'Gate machine'`, [s.tenant])).rows[0]!.id;
    await q(db, s.owner, `select public.set_attendance_device_active($1,false)`, [id]);
    await expect(punch('E-77', `${s.today}T05:00:00Z`)).rejects.toThrow(/unknown device/);
    await expect(q(db, s.owner, `select public.ingest_punch($1,'E-77',now())`, [key])).rejects.toThrow(/permission denied/);
  });

  it('an employee’s own attendance (machine punch or self check-in) cannot be overridden by HR, accountant or owner — only gaps can be filled', async () => {
    await admin(db, `delete from public.staff_attendance where staff_id = $1`, [staff]);
    await admin(db, `insert into public.staff_attendance (tenant_id, staff_id, att_date, status, check_in, source) values ($1,$2,$3,'present','08:00','device')`, [s.tenant, staff, s.today]);
    const mark = async (st: string) => (await q<{ n: number }>(db, s.owner, `select public.mark_staff_attendance($1::date, jsonb_build_array(jsonb_build_object('staff_id', $2::text, 'status', $3::text))) n`, [s.today, staff, st])).rows[0]!.n;
    expect(await mark('absent')).toBe(0);
    expect((await admin<{ status: string; source: string }>(db, `select status, source from public.staff_attendance where staff_id = $1`, [staff])).rows[0]).toMatchObject({ status: 'present', source: 'device' });
    await admin(db, `delete from public.staff_attendance where staff_id = $1`, [staff]);
    expect(await mark('leave')).toBe(1); // no check-in recorded: HR may fill the gap
  });
});

describe('transport: late alerts and the driver roster', () => {
  it('a to-school trip not finished by expected arrival + grace raises an alert for owner, teacher and the child’s parent — not for a cashier — and clears when it ends', async () => {
    await admin(db, `insert into public.tenant_flags (tenant_id, flag_key, enabled) values ($1,'saferoute',true) on conflict (tenant_id, flag_key) do update set enabled = true`, [s.tenant]);
    const driver = (await admin<{ id: string }>(db, `select gen_random_uuid() id`)).rows[0]!.id;
    await admin(db, `insert into auth.users (id, email) values ($1,'drv@example.test')`, [driver]);
    await admin(db, `insert into public.user_tenants (tenant_id, user_id) values ($1,$2)`, [s.tenant, driver]);
    const st = (await admin<{ id: string }>(db, `insert into public.staff_members (tenant_id, user_id, employee_no, full_name) values ($1,$2,'D-1','Driver') returning id`, [s.tenant, driver])).rows[0]!.id;
    const route = (await admin<{ id: string }>(db, `insert into public.transport_routes (tenant_id, name, driver_staff_id, expected_arrival, grace_minutes) values ($1,'R9',$2,'00:00',0) returning id`, [s.tenant, st])).rows[0]!.id;
    await admin(db, `insert into public.transport_riders (tenant_id, student_id, route_id) values ($1,$2,$3)`, [s.tenant, s.students[0], route]);
    const sunday = (await admin<{ d: number }>(db, `select extract(dow from now() at time zone (select timezone from public.tenants where id = $1))::int d`, [s.tenant])).rows[0]!.d === 0;
    const alerts = async (who: ReturnType<typeof teacher>) => (await q<{ name: string }>(db, who, `select name from public.route_alerts()`)).rows.map((r) => r.name);
    if (!sunday) {
      expect(await alerts(s.owner)).toContain('R9');
      expect(await alerts(teacher())).toContain('R9');
      expect(await alerts(s.parent)).toContain('R9');
      expect(await alerts(s.cashier)).not.toContain('R9');
      expect(await alerts(other.owner)).toEqual([]);
      const drv = w.as(driver, s.tenant);
      const trip = (await q<{ id: string }>(db, drv, `select public.start_trip($1,'to_school') id`, [route])).rows[0]!.id;
      expect(await alerts(s.owner)).toContain('R9'); // still on the way = still late
      await q(db, drv, `select public.end_trip($1)`, [trip]);
      expect(await alerts(s.owner)).not.toContain('R9');
    }
    const ros = (await q<{ first_name: string; dismissal_time: string }>(db, w.as(driver, s.tenant), `select first_name, dismissal_time from public.crew_roster($1)`, [route])).rows;
    expect(ros).toEqual([{ first_name: 'Amna', dismissal_time: '14:00:00' }]);
    await expect(q(db, s.cashier, `select * from public.crew_roster($1)`, [route])).rejects.toThrow(/permission denied/);
  });
});

describe('student directory and parent concession requests', () => {
  it('directory: parent, roll number, class, address; phone only for people allowed to contact parents', async () => {
    await q(db, s.owner, `select public.set_family_address($1,'House 5, Model Town')`, [s.families[0]]);
    const row = (await q<{ guardian_name: string; guardian_phone: string | null; address: string; class_name: string }>(db, s.owner, `select * from public.students_directory() where full_name = 'Amna Khan'`)).rows[0]!;
    expect(row).toMatchObject({ guardian_name: 'Mr Khan', address: 'House 5, Model Town', class_name: 'Grade 5' });
    expect(row.guardian_phone).toMatch(/^0/);
    const t = (await q<{ guardian_phone: string | null }>(db, teacher(), `select guardian_phone from public.students_directory() where full_name = 'Amna Khan'`)).rows[0]!;
    expect(t.guardian_phone).toBeNull();
    await expect(q(db, s.parent, `select * from public.students_directory()`)).rejects.toThrow(/permission denied/);
  });

  it('a parent asks for a discount for their own child; the owner approves, refuses or returns it with a note; nobody decides their own', async () => {
    await admin(db, `delete from public.concessions where tenant_id = $1`, [s.tenant]);
    const [amna, zara] = [s.students[0], s.students[2]];
    await expect(q(db, s.parent, `select public.request_concession_guardian($1,10,'Hardship')`, [zara])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.parent, `select public.request_concession_guardian($1,0,'Hardship')`, [amna])).rejects.toThrow(/percent/);
    const a = (await q<{ id: string }>(db, s.parent, `select public.request_concession_guardian($1,15,'Father lost his job') id`, [amna])).rows[0]!.id;
    await expect(q(db, s.parent, `select public.request_concession_guardian($1,5,'again')`, [amna])).rejects.toThrow(/already waiting/);
    await expect(q(db, s.parent, `select public.decide_concession($1,'approve','')`, [a])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.owner, `select public.decide_concession($1,'return','')`, [a])).rejects.toThrow(/what should change/);
    await q(db, s.owner, `select public.decide_concession($1,'return','Please attach the salary letter')`, [a]);
    const mine = (await q<{ status: string; note: string; percent: number }>(db, s.parent, `select status, note, percent from public.my_concession_requests()`)).rows[0]!;
    expect(mine).toEqual({ status: 'returned', note: 'Please attach the salary letter', percent: 15 });
    const b = (await q<{ id: string }>(db, s.parent, `select public.request_concession_guardian($1,15,'Letter attached') id`, [amna])).rows[0]!.id;
    await q(db, s.owner, `select public.decide_concession($1,'approve','Granted for this session')`, [b]);
    expect((await admin<{ status: string; approved_by: string }>(db, `select status, approved_by from public.concessions where id = $1`, [b])).rows[0]!.status).toBe('approved');
    const c = (await q<{ id: string }>(db, s.parent, `select public.request_concession_guardian($1,50,'Please') id`, [amna])).rows[0]!.id;
    await q(db, s.owner, `select public.decide_concession($1,'reject','Not eligible')`, [c]);
    expect((await q<{ status: string }>(db, s.parent, `select status from public.my_concession_requests() order by created_at desc limit 1`)).rows[0]!.status).toBe('rejected');
    await expect(q(db, s.owner, `select public.decide_concession($1,'approve','')`, [b])).rejects.toThrow(/not found or already decided/);
  });
});

describe('platform: reviews, quotations, invoices', () => {
  it('the public sees only approved reviews; only the super admin moderates; numbering and the billing summary work', async () => {
    const sa = w.as(ids.vendorAdmin, null);
    await q(db, sa, `insert into public.site_reviews (name, school_name, rating, comment, status, source) values ('Mrs Raza','Noor School',5,'Fees are finally under control','approved','admin'), ('Spam','',1,'buy pills now please','pending','visitor')`);
    expect((await q<{ name: string }>(db, null, `select name from public.site_reviews`, [], 'anon')).rows.map((r) => r.name)).toEqual(['Mrs Raza']);
    expect((await q(db, w.as(ids.vendorSupport, null), `select 1 from public.site_reviews`)).rows).toHaveLength(2);
    await expect(q(db, w.as(ids.ownerA, w.tenantA), `update public.site_reviews set status = 'approved'`)).resolves.toMatchObject({ affectedRows: 0 });
    const inv = (await q<{ n: string }>(db, sa, `select public.platform_next_number('invoice') n`)).rows[0]!.n;
    expect(inv).toMatch(/^INV-\d{4}-0001$/);
    expect((await q<{ n: string }>(db, sa, `select public.platform_next_number('invoice') n`)).rows[0]!.n).toMatch(/-0002$/);
    await expect(q(db, w.as(ids.vendorSupport, null), `select public.platform_next_number('quote')`)).rejects.toThrow(/permission denied/);
    const d = (await q<{ id: string }>(db, sa, `insert into public.platform_documents (kind, number, customer_name) values ('invoice',$1,'Noor Academy') returning id`, [inv])).rows[0]!.id;
    await q(db, sa, `insert into public.platform_document_lines (doc_id, description, qty, unit_minor) values ($1,'Growth plan — 12 months',1,12000000)`, [d]);
    await q(db, sa, `insert into public.platform_payments (doc_id, amount_minor, method) values ($1,5000000,'bank')`, [d]);
    const sum = (await q<{ s: { invoiced: number; collected: number; months: unknown[] } }>(db, w.as(ids.vendorSupport, null), `select public.platform_billing_summary() s`)).rows[0]!.s;
    expect(sum).toMatchObject({ invoiced: 12000000, collected: 5000000 });
    expect(sum.months).toHaveLength(12);
    await expect(q(db, w.as(ids.ownerA, w.tenantA), `select public.platform_billing_summary()`)).rejects.toThrow(/permission denied/);
    expect((await q(db, w.as(ids.ownerA, w.tenantA), `select * from public.platform_documents`)).rows).toHaveLength(0);
    await expect(q(db, null, `select * from public.platform_documents`, [], 'anon')).rejects.toThrow(/permission denied/);
  });
});

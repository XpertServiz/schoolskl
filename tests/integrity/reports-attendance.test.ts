import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

let db: PGlite;
let w: World;
let s: School;
const n = (x: unknown) => Number(x);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, 'r');
  await q(db, s.accountant, `select public.generate_vouchers('2026-12-01'::date,$1,$2)`, [s.session, s.classId]);
  await q(db, s.accountant, `select public.apply_fines('2027-02-01')`);
  await q(db, s.cashier, `select public.close_cashier_session($1, 100000)`, [s.cashierSession]);
});

describe('financial reports', () => {
  it('balance sheet balances: assets = liabilities + equity (incl. current surplus)', async () => {
    const rows = (await q<{ section: string; amount: string }>(db, s.owner, `select * from public.balance_sheet('2027-12-31')`)).rows;
    const sum = (sec: string) => rows.filter((r) => r.section === sec).reduce((a, r) => a + n(r.amount), 0);
    expect(sum('assets')).toBeGreaterThan(0);
    expect(sum('assets')).toBe(sum('liabilities') + sum('equity'));
  });

  it('profit & loss: income − expenses equals the surplus on the balance sheet; date range is honoured', async () => {
    const pl = (await q<{ type: string; amount: string }>(db, s.owner, `select * from public.profit_loss('2026-01-01','2027-12-31')`)).rows;
    const income = pl.filter((r) => r.type === 'income').reduce((a, r) => a + n(r.amount), 0);
    const expense = pl.filter((r) => r.type === 'expense').reduce((a, r) => a + n(r.amount), 0);
    const bs = (await q<{ code: string; amount: string }>(db, s.owner, `select * from public.balance_sheet('2027-12-31')`)).rows;
    expect(n(bs.find((r) => r.code === '00000')!.amount)).toBe(income - expense);
    const none = (await q<{ amount: string }>(db, s.owner, `select * from public.profit_loss('2020-01-01','2020-12-31')`)).rows;
    expect(none.every((r) => n(r.amount) === 0)).toBe(true);
  });

  it('only staff with accounts.reports.view can run reports', async () => {
    for (const who of [s.cashier, s.parent]) {
      await expect(q(db, who, `select * from public.balance_sheet('2027-12-31')`)).rejects.toThrow(/permission denied/);
      await expect(q(db, who, `select public.daily_closing_report()`)).rejects.toThrow(/permission denied/);
    }
  });

  it('daily closing report summarises the day and confirms the books balance', async () => {
    const r = (await q<{ r: any }>(db, s.owner, `select public.daily_closing_report($1::date) r`, [s.today])).rows[0]!.r;
    expect(r.trial_balance_ok).toBe(true);
    expect(r.collected_by_channel).toMatchObject({ bank: 200000, cash: 100000, raast: 600000 });
    expect(n(r.receivable_minor)).toBeGreaterThan(0);
    expect(n(r.cash_in_hand_minor)).toBe(100000);
    expect(r.open_cashier_sessions).toBe(0);
    expect(n(r.overdue_vouchers)).toBeGreaterThanOrEqual(0);
    expect(r.attendance_pct).toBe(66.7); // 2 of 3 present
  });
});

describe('attendance', () => {
  it('defaults everyone to present, records absentees, and queues exactly one parent alert', async () => {
    const day = await q<{ status: string }>(db, s.owner, `select status from public.student_attendance where att_date = $1::date order by student_id`, [s.today]);
    expect(day.rows.map((r) => r.status).sort()).toEqual(['absent', 'present', 'present']);
    await q(db, s.owner, `select public.mark_attendance($1, $2::date, array[$3]::uuid[])`, [s.section, s.today, s.students[2]!]); // re-submit
    const outbox = await admin<{ kind: string }>(db, `select kind from public.notification_outbox where tenant_id = $1`, [s.tenant]);
    expect(outbox.rows).toEqual([{ kind: 'attendance.absent' }]);
  });

  it('corrections replace the earlier mark (late, then present)', async () => {
    await q(db, s.owner, `select public.mark_attendance($1, $2::date, '{}', array[$3]::uuid[])`, [s.section, s.today, s.students[0]!]);
    const r = await q<{ status: string }>(db, s.owner, `select status from public.student_attendance where student_id = $1 and att_date = $2::date`, [s.students[0]!, s.today]);
    expect(r.rows[0]!.status).toBe('late');
    const sum = await q<{ present: number; late: number; total: number }>(db, s.owner, `select * from public.v_attendance_daily where att_date = $1::date`, [s.today]);
    expect(sum.rows[0]).toMatchObject({ total: 3, late: 1, absent: 0, present: 2 });
  });

  it('a teacher scoped to one class can mark that class only', async () => {
    const class2 = (await q<{ id: string }>(db, s.owner, `insert into public.classes (tenant_id,campus_id,name,level) values ($1,$2,'Grade 6',6) returning id`, [s.tenant, s.campus])).rows[0]!.id;
    const section2 = (await q<{ id: string }>(db, s.owner, `insert into public.sections (tenant_id,class_id,name) values ($1,$2,'A') returning id`, [s.tenant, class2])).rows[0]!.id;
    const teacher = randomUUID();
    await admin(db, `insert into auth.users (id, email) values ($1,'scoped.teacher@example.test')`, [teacher]);
    await admin(db, `insert into public.user_tenants (tenant_id, user_id) values ($1,$2)`, [s.tenant, teacher]);
    await admin(db, `insert into public.user_roles (tenant_id,user_id,role_id,scope_type,scope_id) select $1,$2,id,'class',$3 from public.roles where tenant_id=$1 and key='teacher'`, [s.tenant, teacher, s.classId]);
    const t = w.as(teacher, s.tenant);

    await expect(q(db, t, `select public.mark_attendance($1,$2::date)`, [s.section, s.today])).resolves.toBeDefined();
    await expect(q(db, t, `select public.mark_attendance($1,$2::date)`, [section2, s.today])).rejects.toThrow(/permission denied/);
  });

  it('no future dates; past or locked days need attendance.edit_past', async () => {
    const teacher = randomUUID();
    await admin(db, `insert into auth.users (id, email) values ($1,'plain.teacher@example.test')`, [teacher]);
    await admin(db, `insert into public.user_tenants (tenant_id, user_id) values ($1,$2)`, [s.tenant, teacher]);
    await admin(db, `insert into public.user_roles (tenant_id,user_id,role_id) select $1,$2,id from public.roles where tenant_id=$1 and key='teacher'`, [s.tenant, teacher]);
    const t = w.as(teacher, s.tenant);

    await expect(q(db, t, `select public.mark_attendance($1,'2999-01-01'::date)`, [s.section])).rejects.toThrow(/future/);
    await expect(q(db, t, `select public.mark_attendance($1,$2::date - 3)`, [s.section, s.today])).rejects.toThrow(/locked/);
    await expect(q(db, s.owner, `select public.mark_attendance($1,$2::date - 3)`, [s.section, s.today])).resolves.toBeDefined(); // owner may back-fill

    await q(db, t, `select public.lock_attendance_day($1,$2::date)`, [s.section, s.today]);
    await expect(q(db, t, `select public.mark_attendance($1,$2::date)`, [s.section, s.today])).rejects.toThrow(/locked/);
    await expect(q(db, s.owner, `select public.mark_attendance($1,$2::date,array[$3]::uuid[])`, [s.section, s.today, s.students[2]!])).resolves.toBeDefined();
  });

  it('a parent sees only their own child’s attendance', async () => {
    const mine = await q<{ student_id: string }>(db, s.parent, `select distinct student_id from public.student_attendance`);
    expect(new Set(mine.rows.map((r) => r.student_id))).toEqual(new Set([s.students[0], s.students[1]]));
    expect((await q(db, s.parent, `select * from public.notification_outbox`)).rows).toHaveLength(0);
  });
});

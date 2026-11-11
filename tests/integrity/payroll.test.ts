import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

let db: PGlite;
let w: World;
let s: School;
let other: School;
let m1: string, m2: string, m3: string; // the three previous months, as first-of-month dates
let teacherStaff: string, clerkStaff: string;
const n = (x: unknown) => Number(x);
const gl = async (code: string) =>
  n((await admin<{ n: string }>(db, `select coalesce(sum(l.debit - l.credit),0) n from public.journal_lines l join public.accounts a on a.id = l.account_id where l.tenant_id = $1 and a.code = $2`, [s.tenant, code])).rows[0]!.n);
const slips = async (run: string) => (await admin<any>(db, `select p.*, m.employee_no from public.payslips p join public.staff_members m on m.id = p.staff_id where p.run_id = $1 order by m.employee_no`, [run])).rows;
const prep = (who: any, month: string) => q<{ id: string }>(db, who, `select public.prepare_payroll($1::date) id`, [month]);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, 'y');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, 'z');
  const mo = async (k: number) => (await admin<{ d: string }>(db, `select (date_trunc('month', app.tenant_today($1)) - ($2 || ' month')::interval)::date::text d`, [s.tenant, String(k)])).rows[0]!.d;
  [m1, m2, m3] = [await mo(1), await mo(2), await mo(3)];

  teacherStaff = (await q<{ id: string }>(db, s.owner, `insert into public.staff_members (tenant_id, employee_no, full_name, user_id, category) values ($1,'T-1','Teacher One',$2,'teaching') returning id`, [s.tenant, s.userIds.cashier])).rows[0]!.id;
  clerkStaff = (await q<{ id: string }>(db, s.owner, `insert into public.staff_members (tenant_id, employee_no, full_name, category) values ($1,'N-1','Clerk One','non_teaching') returning id`, [s.tenant])).rows[0]!.id;
  await q(db, s.accountant, `insert into public.staff_pay (tenant_id, staff_id, basic_minor) values ($1,$2,5000000),($1,$3,3000000)`, [s.tenant, teacherStaff, clerkStaff]);
  const comp = async (code: string, name: string, kind: string, calc: string) =>
    (await q<{ id: string }>(db, s.accountant, `insert into public.salary_components (tenant_id, code, name, kind, calc) values ($1,$2,$3,$4,$5) returning id`, [s.tenant, code, name, kind, calc])).rows[0]!.id;
  const allowance = await comp('HRA', 'House allowance', 'earning', 'fixed');
  const pf = await comp('PF', 'Provident fund 1%', 'deduction', 'percent_of_basic');
  const tax = await comp('TAX', 'Income tax', 'deduction', 'fixed');
  await q(db, s.accountant, `insert into public.staff_pay_components (tenant_id, staff_id, component_id, value) values
    ($1,$2,$3,500000),($1,$4,$3,500000),($1,$2,$5,100),($1,$4,$5,100),($1,$2,$6,100000)`, [s.tenant, teacherStaff, allowance, clerkStaff, pf, tax]);
  // the teacher was absent on the 1st and 2nd of last month
  const d1 = m1, d2 = (await admin<{ d: string }>(db, `select ($1::date + 1)::text d`, [m1])).rows[0]!.d;
  await q(db, s.accountant, `select public.mark_staff_attendance($1::date, $2::jsonb)`, [d1, JSON.stringify([{ staff_id: teacherStaff, status: 'absent' }])]);
  await q(db, s.accountant, `select public.mark_staff_attendance($1::date, $2::jsonb)`, [d2, JSON.stringify([{ staff_id: teacherStaff, status: 'absent' }])]);
});

describe('preparing a run', () => {
  let run: string;
  it('needs the HR permission, a past-or-current month, and refuses a second live run for the same month', async () => {
    await expect(prep(s.parent, m1)).rejects.toThrow(/permission denied/);
    await expect(prep(s.accountant, (await admin<{ d: string }>(db, `select (date_trunc('month', now()) + interval '2 month')::date::text d`)).rows[0]!.d)).rejects.toThrow(/future month/);
    run = (await prep(s.accountant, m1)).rows[0]!.id;
    await expect(prep(s.accountant, m1)).rejects.toThrow(/already exists/);
  });

  it('computes each payslip exactly: allowance, % of basic, fixed tax, and absent-day deduction', async () => {
    const [clerk, teacher] = await slips(run); // ordered by employee_no: N-1, T-1
    // Teacher: basic 50,000.00 + HRA 5,000.00; PF 1% = 500.00; tax 1,000.00; 2 absent days = round(5,000,000 × 2 / 30) = 333,333
    expect([n(teacher.basic_minor), n(teacher.gross_minor), n(teacher.deductions_minor), n(teacher.net_minor), teacher.absent_days]).toEqual([5000000, 5500000, 483333, 5016667, 2]);
    expect(teacher.lines.map((l: any) => l.code)).toEqual(['HRA', 'PF', 'TAX', 'ABSENT']);
    expect([n(clerk.gross_minor), n(clerk.deductions_minor), n(clerk.net_minor)]).toEqual([3500000, 30000, 3470000]);
    const r = (await admin<any>(db, `select * from public.payroll_runs where id = $1`, [run])).rows[0];
    expect([n(r.gross_minor), n(r.deductions_minor), n(r.net_minor), r.status]).toEqual([9000000, 513333, 8486667, 'draft']);
  });

  it('a one-off adjustment on a draft updates the slip and the run; a negative net is refused', async () => {
    const teacher = (await slips(run)).find((x: any) => x.employee_no === 'T-1');
    await q(db, s.accountant, `select public.adjust_payslip($1,'Eid bonus','earning',100000)`, [teacher.id]);
    expect(n((await admin<{ n: string }>(db, `select net_minor n from public.payslips where id = $1`, [teacher.id])).rows[0]!.n)).toBe(5116667);
    await expect(q(db, s.accountant, `select public.adjust_payslip($1,'Fine','deduction',99999999)`, [teacher.id])).rejects.toThrow(/net pay would be negative/);
    await expect(q(db, s.cashier, `select public.adjust_payslip($1,'x','earning',1)`, [teacher.id])).rejects.toThrow(/permission denied/);
    const r = (await admin<any>(db, `select gross_minor, net_minor from public.payroll_runs where id = $1`, [run])).rows[0];
    const sums = (await admin<any>(db, `select sum(gross_minor) g, sum(net_minor) nn from public.payslips where run_id = $1`, [run])).rows[0];
    expect([n(r.gross_minor), n(r.net_minor)]).toEqual([n(sums.g), n(sums.nn)]);
    expect(n(r.net_minor)).toBe(8586667);
  });

  it('pay records are confidential: only HR sees salary structures', async () => {
    expect(n((await q<{ n: number }>(db, s.accountant, `select count(*)::int n from public.staff_pay`)).rows[0]!.n)).toBe(2);
    for (const who of [s.cashier, s.parent]) {
      expect(n((await q<{ n: number }>(db, who, `select count(*)::int n from public.staff_pay`)).rows[0]!.n)).toBe(0);
      expect(n((await q<{ n: number }>(db, who, `select count(*)::int n from public.payroll_runs`)).rows[0]!.n)).toBe(0);
    }
    expect(n((await q<{ n: number }>(db, other.owner, `select count(*)::int n from public.staff_pay where tenant_id = $1`, [s.tenant])).rows[0]!.n)).toBe(0);
  });

  it('a staff member sees their own payslip only after it is posted', async () => {
    expect(n((await q<{ n: number }>(db, s.cashier, `select count(*)::int n from public.payslips`)).rows[0]!.n)).toBe(0); // cashier user is teacher T-1; still draft
  });

  it('posting is maker-checker with the posting key; it books a balanced journal; then slips become visible to their owner', async () => {
    await expect(q(db, s.accountant, `select public.post_payroll($1)`, [run])).rejects.toThrow(/permission denied/);
    const before = { exp: await gl('50100'), non: await gl('50200'), pay: await gl('20400'), ded: await gl('20500') };
    await q(db, s.owner, `select public.post_payroll($1)`, [run]);
    expect(await gl('50100') - before.exp).toBe(5600000); // gross incl. the bonus
    expect(await gl('50200') - before.non).toBe(3500000);
    expect(await gl('20400') - before.pay).toBe(-8586667);
    expect(await gl('20500') - before.ded).toBe(-513333);
    await expect(q(db, s.owner, `select public.post_payroll($1)`, [run])).rejects.toThrow(/already posted/);
    await expect(q(db, s.accountant, `select public.adjust_payslip($1,'late','earning',1)`, [(await slips(run))[0].id])).rejects.toThrow(/only a draft/);
    const mine = await q<{ staff_id: string }>(db, s.cashier, `select staff_id from public.payslips`);
    expect(mine.rows.map((r) => r.staff_id)).toEqual([teacherStaff]); // not the clerk's
  });

  it('the person who prepared a run cannot post it', async () => {
    const r2 = (await prep(s.owner, m2)).rows[0]!.id;
    await expect(q(db, s.owner, `select public.post_payroll($1)`, [r2])).rejects.toThrow(/maker-checker/);
    await q(db, s.owner, `select public.void_payroll($1, 'prepared by mistake')`, [r2]);
    expect((await admin<{ status: string }>(db, `select status from public.payroll_runs where id = $1`, [r2])).rows[0]!.status).toBe('voided');
    // a voided month can be prepared again
    await expect(prep(s.accountant, m2)).resolves.toBeDefined();
  });

  it('paying clears the salaries payable and reduces the bank; it cannot be repeated or voided afterwards', async () => {
    const bank = await gl('10200');
    await expect(q(db, s.accountant, `select public.mark_payroll_paid($1)`, [run])).rejects.toThrow(/permission denied/);
    await q(db, s.owner, `select public.mark_payroll_paid($1)`, [run]);
    expect(await gl('10200')).toBe(bank - 8586667);
    expect(await gl('20400')).toBe(0);
    await expect(q(db, s.owner, `select public.mark_payroll_paid($1)`, [run])).rejects.toThrow(/only a posted payroll/);
    await expect(q(db, s.owner, `select public.void_payroll($1, 'oops')`, [run])).rejects.toThrow(/already paid/);
  });

  it('voiding a posted run reverses its journal exactly', async () => {
    const r3 = (await prep(s.accountant, m3)).rows[0]!.id; // no attendance that month, same pay structures
    const snap = async () => [await gl('50100'), await gl('50200'), await gl('20400'), await gl('20500')];
    const before = await snap();
    await q(db, s.owner, `select public.post_payroll($1)`, [r3]);
    expect(await snap()).not.toEqual(before);
    await expect(q(db, s.owner, `select public.void_payroll($1, ' ')`, [r3])).rejects.toThrow(/reason is required/);
    await q(db, s.owner, `select public.void_payroll($1, 'wrong month')`, [r3]);
    expect(await snap()).toEqual(before);
    // staff can no longer see the voided run's slip
    expect(n((await q<{ n: number }>(db, s.cashier, `select count(*)::int n from public.payslips where run_id = $1`, [r3])).rows[0]!.n)).toBe(0);
  });

  it('the ledger balances and another school can neither read nor post this payroll', async () => {
    const tb = (await admin<{ d: string; c: string }>(db, `select sum(debit)::text d, sum(credit)::text c from public.journal_lines where tenant_id = $1`, [s.tenant])).rows[0]!;
    expect(tb.d).toBe(tb.c);
    await expect(q(db, other.owner, `select public.post_payroll($1)`, [run])).rejects.toThrow(/payroll run not found/);
    expect(n((await q<{ n: number }>(db, other.owner, `select count(*)::int n from public.payslips where tenant_id = $1`, [s.tenant])).rows[0]!.n)).toBe(0);
  });
});

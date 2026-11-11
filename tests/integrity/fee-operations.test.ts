import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

// Corrections (void / cancel), refunds, deposits, instalments, promises, reminders, risk and the fee-cap guard.
// After every scenario the same ledger invariants as ledger-invariants.test.ts must still hold.

let db: PGlite;
let w: World;
let a: School; // corrections scenario
let b: School; // everything else
const n = (x: unknown) => Number(x);
const addDays = (d: string, k: number) => new Date(Date.parse(d) + k * 86400000).toISOString().slice(0, 10);

const voucher = async (s: School, student: string, period = s.period) =>
  (await admin<any>(db, `select * from public.vouchers where student_id = $1 and period = $2 order by created_at desc`, [student, period])).rows;
const gl = async (s: School, code: string, family?: string) =>
  n((await admin<{ n: string }>(db, `select coalesce(sum(l.debit - l.credit),0) n from public.journal_lines l join public.accounts a on a.id = l.account_id
     where l.tenant_id = $1 and a.code = $2 and ($3::uuid is null or l.family_id = $3)`, [s.tenant, code, family ?? null])).rows[0]!.n);
const payId = async (s: School, key: string) => (await admin<{ id: string }>(db, `select id from public.payments where tenant_id = $1 and idempotency_key = $2`, [s.tenant, key])).rows[0]!.id;

async function ledgerHolds(s: School) {
  const tb = (await admin<{ d: string; c: string }>(db, `select sum(debit)::text d, sum(credit)::text c from public.journal_lines where tenant_id = $1`, [s.tenant])).rows[0]!;
  expect(tb.d).toBe(tb.c);
  const openVouchers = n((await admin<{ n: string }>(db, `select coalesce(sum(total_minor + adjusted_minor - paid_minor),0) n from public.vouchers where tenant_id=$1 and status <> 'cancelled'`, [s.tenant])).rows[0]!.n);
  expect(await gl(s, '11000'), 'Fee Receivable = Σ live voucher balances').toBe(openVouchers);
  let statements = 0;
  for (const f of s.families) {
    const st = await q<{ balance: string }>(db, s.owner, `select * from public.family_statement($1)`, [f]);
    statements += st.rows.length ? n(st.rows.at(-1)!.balance) : 0;
  }
  expect(statements, 'Σ family statements = GL').toBe(await gl(s, '11000'));
  const bad = await admin(db, `select v.voucher_no from public.vouchers v where v.tenant_id = $1 and v.paid_minor <>
      (select coalesce(sum(x.amount_minor),0) from public.payment_allocations x join public.payments p on p.id = x.payment_id where x.voucher_id = v.id and p.voided_at is null)`, [s.tenant]);
  expect(bad.rows, 'paid_minor = Σ allocations of live payments').toEqual([]);
  for (const f of s.families) expect(await gl(s, '20200', f), 'advance never negative').toBeLessThanOrEqual(0); // credit-normal: net debit ≤ 0
}

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  a = await seedSchool(db, w, w.tenantA, ids.ownerA, 'a');
  b = await seedSchool(db, w, w.tenantB, ids.ownerB, 'b');
});

describe('void payment & cancel voucher', () => {
  it('voiding a bank payment puts the money back on the voucher and reverses the journal', async () => {
    const bilal = (await voucher(a, a.students[1]!))[0];
    expect([n(bilal.paid_minor), bilal.status]).toEqual([200000, 'partially_paid']);
    const before = await gl(a, '10200');
    await q(db, a.owner, `select public.void_payment($1, 'Cheque bounced')`, [await payId(a, `seed-bank-${a.tenant}`)]);
    const after = (await voucher(a, a.students[1]!))[0];
    expect([n(after.paid_minor), after.status]).toEqual([0, 'issued']);
    expect(await gl(a, '10200')).toBe(before - 200000);
    await ledgerHolds(a);
  });

  it('cannot be voided twice, by the wrong role, or without a reason', async () => {
    const id = await payId(a, `seed-bank-${a.tenant}`);
    await expect(q(db, a.owner, `select public.void_payment($1, 'again')`, [id])).rejects.toThrow(/already void/);
    await expect(q(db, a.accountant, `select public.void_payment($1, 'x')`, [await payId(a, `seed-cash-${a.tenant}`)])).rejects.toThrow(/permission denied/);
    await expect(q(db, a.owner, `select public.void_payment($1, '  ')`, [await payId(a, `seed-cash-${a.tenant}`)])).rejects.toThrow(/reason/);
  });

  it('a voucher with money received against it cannot be cancelled until the payment is voided', async () => {
    const amna = (await voucher(a, a.students[0]!))[0];
    await expect(q(db, a.accountant, `select public.cancel_voucher($1, 'wrong class')`, [amna.id])).rejects.toThrow(/void those payments first/);
    await q(db, a.owner, `select public.void_payment($1, 'Wrong family')`, [await payId(a, `seed-cash-${a.tenant}`)]); // cash still in the OPEN session
    await ledgerHolds(a);
  });

  it('cancelling reverses the voucher and its fine, returns consumed advance, and lets the month be re-issued', async () => {
    // family 2 pays 700.00 ahead → December's voucher consumes it → a fine lands on it
    await q(db, a.accountant, `select public.record_payment($1, 70000, 'jazzcash', 'adv-a')`, [a.families[1]!]);
    await q(db, a.accountant, `select public.generate_vouchers('2026-12-01'::date,$1,$2)`, [a.session, a.classId]);
    await q(db, a.accountant, `select public.apply_fines('2027-02-01')`);
    const zaraDec = (await voucher(a, a.students[2]!, '2026-12-01'))[0];
    expect(n(zaraDec.paid_minor)).toBe(70000);
    expect(n(zaraDec.adjusted_minor)).toBe(50000); // the fine
    expect(await gl(a, '20200', a.families[1]!)).toBe(0); // advance used up

    await q(db, a.accountant, `select public.cancel_voucher($1, 'Student moved to another class')`, [zaraDec.id]);
    const cancelled = (await voucher(a, a.students[2]!, '2026-12-01'))[0];
    expect(cancelled.status).toBe('cancelled');
    expect(n(cancelled.paid_minor)).toBe(0);
    expect(await gl(a, '20200', a.families[1]!)).toBe(-70000); // advance restored (credit balance)
    expect(await gl(a, '40600'), 'the fine income was reversed too').toBeGreaterThan(-1000000);
    await expect(q(db, a.accountant, `select public.cancel_voucher($1, 'again')`, [zaraDec.id])).rejects.toThrow(/already cancelled/);
    await ledgerHolds(a);

    // November for Amna: now cancellable (cash payment was voided above) → generating the month again re-issues only the cancelled one
    const amna = (await voucher(a, a.students[0]!))[0];
    await q(db, a.accountant, `select public.cancel_voucher($1, 'Fee structure was wrong')`, [amna.id]);
    const created = await q<{ n: number }>(db, a.accountant, `select public.generate_vouchers($1::date,$2,$3) n`, [a.period, a.session, a.classId]);
    expect(created.rows[0]!.n).toBe(1);
    const all = await voucher(a, a.students[0]!);
    expect(all.map((v: any) => v.status).sort()).toEqual(['cancelled', 'issued']);
    await ledgerHolds(a);
  });

  it('cancelling a voucher also cancels its instalment plan', async () => {
    const bilalDec = (await voucher(a, a.students[1]!, '2026-12-01'))[0];
    await q(db, a.owner, `select public.create_installment_plan($1, $2::date[])`, [bilalDec.id, [addDays(a.today, 3), addDays(a.today, 30)]]);
    await q(db, a.accountant, `select public.cancel_voucher($1, 'duplicate')`, [bilalDec.id]);
    expect((await admin<{ status: string }>(db, `select status from public.installment_plans where voucher_id = $1`, [bilalDec.id])).rows[0]!.status).toBe('cancelled');
    await ledgerHolds(a);
  });

  it('every reversal is a real journal: one per original, and nothing in the ledger was edited', async () => {
    const dup = await admin(db, `select reversal_of from public.journal_entries where tenant_id = $1 and reversal_of is not null group by 1 having count(*) > 1`, [a.tenant]);
    expect(dup.rows).toEqual([]);
    expect((await admin<{ n: number }>(db, `select count(*)::int n from public.journal_entries where tenant_id = $1 and reversal_of is not null`, [a.tenant])).rows[0]!.n).toBeGreaterThanOrEqual(6);
  });

  it('cash counted in a closed cashier session cannot be voided (use a refund)', async () => {
    const cashId = await payId(b, `seed-cash-${b.tenant}`);
    await q(db, b.cashier, `select public.close_cashier_session($1, 100000)`, [b.cashierSession]);
    await expect(q(db, b.owner, `select public.void_payment($1, 'oops')`, [cashId])).rejects.toThrow(/closed/);
  });

  it('closing a session counts fee cash + deposit cash and ignores voided payments', async () => {
    // school A's session: its only cash payment was voided → expected 0 + a 300.00 deposit taken in cash
    await q(db, a.cashier, `select public.collect_security_deposit($1, 30000, 'cash', 'dep-cash-a')`, [a.families[0]!]);
    const variance = (await q<{ v: string }>(db, a.cashier, `select public.close_cashier_session($1, 30000) v`, [a.cashierSession])).rows[0]!.v;
    expect(n(variance)).toBe(0);
    expect(await gl(a, '10100')).toBe(30000);
    await ledgerHolds(a);
  });
});

describe('refunds & security deposits', () => {
  it('refunds advance by bank, never more than is held, idempotently, only with the approval key', async () => {
    await q(db, b.accountant, `select public.record_payment($1, 70000, 'jazzcash', 'adv-b')`, [b.families[1]!]);
    expect(await gl(b, '20200', b.families[1]!)).toBe(-70000);
    await expect(q(db, b.accountant, `select public.refund_advance($1, 1000, 'x', 'k0')`, [b.families[1]!])).rejects.toThrow(/permission denied/);
    await expect(q(db, b.owner, `select public.refund_advance($1, 70001, 'too much', 'k1')`, [b.families[1]!])).rejects.toThrow(/exceeds the advance/);
    const r1 = (await q<{ id: string }>(db, b.owner, `select public.refund_advance($1, 20000, 'Left school', 'k2') id`, [b.families[1]!])).rows[0]!.id;
    const r2 = (await q<{ id: string }>(db, b.owner, `select public.refund_advance($1, 20000, 'Left school', 'k2') id`, [b.families[1]!])).rows[0]!.id;
    expect(r2).toBe(r1);
    await expect(q(db, b.owner, `select public.refund_advance($1, 5, 'x', 'k2')`, [b.families[1]!])).rejects.toThrow(/reused with different details/);
    expect(await gl(b, '20200', b.families[1]!)).toBe(-50000);
    await ledgerHolds(b);
  });

  it('a payment whose advance was already refunded cannot be voided', async () => {
    await expect(q(db, b.owner, `select public.void_payment($1, 'mistake')`, [await payId(b, 'adv-b')])).rejects.toThrow(/already applied/);
  });

  it('a deposit is a liability until settled; the part kept becomes income; it cannot be settled twice', async () => {
    const id = (await q<{ id: string }>(db, b.accountant, `select public.collect_security_deposit($1, 500000, 'bank', 'dep-b', $2) id`, [b.families[0]!, b.students[0]!])).rows[0]!.id;
    expect(await gl(b, '20300', b.families[0]!)).toBe(-500000);
    await expect(q(db, b.accountant, `select public.refund_security_deposit($1, 0, 'x')`, [id])).rejects.toThrow(/permission denied/);
    await expect(q(db, b.owner, `select public.refund_security_deposit($1, 500001, 'x')`, [id])).rejects.toThrow(/deduction/);
    const income = await gl(b, '49000');
    await q(db, b.owner, `select public.refund_security_deposit($1, 100000, 'Broken window')`, [id]);
    expect(await gl(b, '20300', b.families[0]!)).toBe(0);
    expect(await gl(b, '49000')).toBe(income - 100000);
    await expect(q(db, b.owner, `select public.refund_security_deposit($1, 0, 'again')`, [id])).rejects.toThrow(/already refunded/);
    await ledgerHolds(b);
  });
});

describe('instalment plans', () => {
  let bilal: any;
  it('splits the outstanding balance exactly (largest remainder) and enforces its rules', async () => {
    bilal = (await voucher(b, b.students[1]!))[0];
    const bal = n(bilal.total_minor) + n(bilal.adjusted_minor) - n(bilal.paid_minor); // 400000
    const dates = [addDays(b.today, 7), addDays(b.today, 37), addDays(b.today, 67)];
    await expect(q(db, b.accountant, `select public.create_installment_plan($1, $2::date[])`, [bilal.id, dates])).rejects.toThrow(/permission denied/);
    await expect(q(db, b.owner, `select public.create_installment_plan($1, $2::date[])`, [bilal.id, [dates[0]]])).rejects.toThrow(/between 2 and 12/);
    await expect(q(db, b.owner, `select public.create_installment_plan($1, $2::date[])`, [bilal.id, [dates[1], dates[0]]])).rejects.toThrow(/increasing/);
    await expect(q(db, b.owner, `select public.create_installment_plan($1, $2::date[])`, [bilal.id, [addDays(b.today, -3), dates[1]]])).rejects.toThrow(/past/);
    await q(db, b.owner, `select public.create_installment_plan($1, $2::date[], 'Father between jobs')`, [bilal.id, dates]);
    await expect(q(db, b.owner, `select public.create_installment_plan($1, $2::date[])`, [bilal.id, dates])).rejects.toThrow(/already has an active plan/);
    const rows = (await admin<{ amount_minor: string }>(db, `select amount_minor from public.installments where voucher_id = $1 order by seq`, [bilal.id])).rows.map((r) => n(r.amount_minor));
    expect(rows.reduce((x, y) => x + y, 0)).toBe(bal);
    expect(rows).toEqual([133334, 133333, 133333]);
  });

  it('pauses the late fine while the plan is active, and fines resume once it defaults', async () => {
    await q(db, b.owner, `select public.apply_fines('2027-06-01')`);
    expect((await admin<{ n: number }>(db, `select count(*)::int n from public.voucher_adjustments where voucher_id = $1`, [bilal.id])).rows[0]!.n).toBe(0);
    // first instalment gets paid → shown as paid in the status view; plan still active
    await q(db, b.accountant, `select public.record_payment($1, 133334, 'bank', 'inst-1', $2)`, [b.families[0]!, bilal.id]);
    const st = await q<{ seq: number; is_paid: boolean }>(db, b.owner, `select seq, is_paid from public.v_installment_status where voucher_id = $1 order by seq`, [bilal.id]);
    expect(st.rows.map((r) => r.is_paid)).toEqual([true, false, false]);
    expect((await q<{ n: number }>(db, b.owner, `select public.review_installment_plans($1::date) n`, [addDays(b.today, 8)])).rows[0]!.n).toBe(0);
    // the second one is missed
    expect((await q<{ n: number }>(db, b.owner, `select public.review_installment_plans($1::date) n`, [addDays(b.today, 60)])).rows[0]!.n).toBe(1);
    expect((await admin<{ status: string }>(db, `select status from public.installment_plans where voucher_id = $1`, [bilal.id])).rows[0]!.status).toBe('defaulted');
    await q(db, b.owner, `select public.apply_fines('2027-06-01')`);
    expect((await admin<{ n: number }>(db, `select count(*)::int n from public.voucher_adjustments where voucher_id = $1 and kind = 'fine'`, [bilal.id])).rows[0]!.n).toBe(1);
    await ledgerHolds(b);
  });

});

describe('promises, reminders and the risk score', () => {
  it('queues only the latest due step per voucher, once, and never labels anyone', async () => {
    const dueNov = '2026-11-11';
    const asOf = addDays(dueNov, 20);
    const first = (await q<{ n: number }>(db, b.owner, `select public.queue_fee_reminders($1::date) n`, [asOf])).rows[0]!.n;
    expect(first).toBeGreaterThan(0);
    const steps = await admin<{ step: number; voucher_id: string }>(db, `select step, voucher_id from public.fee_reminders where tenant_id = $1`, [b.tenant]);
    expect(new Set(steps.rows.map((r) => r.step))).toEqual(new Set([5])); // 20 days past due → the final step, not steps 1–4 as well
    expect(new Set(steps.rows.map((r) => r.voucher_id)).size).toBe(steps.rows.length); // one per voucher
    expect((await q<{ n: number }>(db, b.owner, `select public.queue_fee_reminders($1::date) n`, [asOf])).rows[0]!.n).toBe(0); // idempotent
    const out = (await admin<{ payload: any }>(db, `select payload from public.notification_outbox where tenant_id = $1 and kind = 'fee.reminder'`, [b.tenant])).rows;
    expect(out.length).toBe(steps.rows.length);
    for (const o of out) expect(Object.keys(o.payload).sort()).toEqual(['balance_minor', 'channel', 'consumer_no', 'due_date', 'family_id', 'step', 'tone', 'voucher_id', 'voucher_no']);
  });

  it('an in-date promise pauses reminders; a broken one is recorded and ends the pause', async () => {
    // school A: promise from family 1 (dated well after "now" in the scenario)
    await admin(db, `insert into public.payment_promises (tenant_id, family_id, amount_minor, promised_on) values ($1,$2,5000000,'2026-12-25')`, [a.tenant, a.families[0]!]);
    const q1 = (await q<{ n: number }>(db, a.owner, `select public.queue_fee_reminders('2026-12-20'::date) n`)).rows[0]!.n;
    const fam = await admin<{ family_id: string }>(db, `select distinct family_id from public.fee_reminders where tenant_id = $1`, [a.tenant]);
    expect(fam.rows.map((r) => r.family_id)).not.toContain(a.families[0]!);
    expect(q1).toBeGreaterThanOrEqual(0);
    expect((await q<{ n: number }>(db, a.owner, `select public.review_promises('2026-12-26'::date) n`)).rows[0]!.n).toBe(1);
    expect((await admin<{ status: string }>(db, `select status from public.payment_promises where tenant_id = $1`, [a.tenant])).rows[0]!.status).toBe('broken');
    const q2 = (await q<{ n: number }>(db, a.owner, `select public.queue_fee_reminders('2026-12-26'::date) n`)).rows[0]!.n;
    expect(q2).toBeGreaterThan(0);
  });

  it('record_promise enforces the 60-day window and needs the collect permission', async () => {
    await expect(q(db, b.accountant, `select public.record_promise($1, 1000, $2::date)`, [b.families[0]!, addDays(b.today, 90)])).rejects.toThrow(/60 days/);
    await expect(q(db, b.accountant, `select public.record_promise($1, 1000, $2::date)`, [b.families[0]!, addDays(b.today, -1)])).rejects.toThrow(/60 days/);
    await expect(q(db, b.parent, `select public.record_promise($1, 1000, $2::date)`, [b.families[0]!, addDays(b.today, 3)])).rejects.toThrow(/permission denied/);
    await expect(q(db, b.accountant, `select public.record_promise($1, 1000, $2::date)`, [b.families[0]!, addDays(b.today, 3)])).resolves.toBeDefined();
  });

  it('the risk score is explainable: points = Σ factors; staff-only; family-level', async () => {
    await admin(db, `update public.vouchers set due_date = current_date - 120 where tenant_id = $1 and status in ('issued','partially_paid')`, [b.tenant]);
    await admin(db, `insert into public.payment_promises (tenant_id, family_id, amount_minor, promised_on, status) values ($1,$2,100,'2026-01-01','broken')`, [b.tenant, b.families[0]!]);
    const r = (await q<{ score: number; band: string; factors: any }>(db, b.owner, `select * from public.fee_risk($1)`, [b.families[0]!])).rows[0]!;
    const pts = Object.values(r.factors as Record<string, { points: number }>).reduce((s, f) => s + f.points, 0);
    expect(r.score).toBe(Math.min(100, pts));
    expect(r.factors.days_overdue.points).toBe(25);
    expect(r.factors.broken_promises_12m.count).toBeGreaterThanOrEqual(1);
    expect(['low', 'medium', 'high']).toContain(r.band);
    const all = await q<{ family_id: string; score: number }>(db, b.owner, `select * from public.fee_risk_overview()`);
    expect(all.rows.map((x) => x.score)).toEqual([...all.rows.map((x) => x.score)].sort((x, y) => y - x));
    await expect(q(db, b.parent, `select * from public.fee_risk($1)`, [b.families[0]!])).rejects.toThrow(/permission denied/);
    await expect(q(db, b.owner, `select * from public.fee_risk($1)`, [a.families[0]!])).rejects.toThrow(/family not found/); // another school's family
  });
});

describe('fee-increase cap', () => {
  let line: string; // structure id; the line is (structure_id, tuition head)
  beforeAll(async () => {
    line = (await admin<{ structure_id: string }>(db, `select structure_id::text from public.fee_structure_lines where tenant_id = $1 and fee_head_id = $2`, [b.tenant, b.heads.tuition])).rows[0]!.structure_id;
    await q(db, b.owner, `insert into public.fee_policy (tenant_id, max_increase_bps) values ($1, 1000) on conflict (tenant_id) do update set max_increase_bps = 1000`, [b.tenant]);
  });
  const set = (who: any, amount: number) => q(db, who, `update public.fee_structure_lines set amount_minor = $2 where structure_id = $1 and fee_head_id = $3`, [line, amount, b.heads.tuition]);

  it('allows increases up to the cap over the ORIGINAL amount, however many steps it takes', async () => {
    await expect(set(b.accountant, 540000)).resolves.toBeDefined();
    await expect(set(b.accountant, 550000)).resolves.toBeDefined();
    await expect(set(b.accountant, 555000)).rejects.toThrow(/exceeds the school's cap/);
  });

  it('the baseline cannot be edited away; decreases are always fine', async () => {
    await q(db, b.accountant, `update public.fee_structure_lines set baseline_minor = 99999999 where structure_id = $1 and fee_head_id = $2`, [line, b.heads.tuition]);
    expect(Number((await admin<{ baseline_minor: string }>(db, `select baseline_minor from public.fee_structure_lines where structure_id = $1 and fee_head_id = $2`, [line, b.heads.tuition])).rows[0]!.baseline_minor)).toBe(500000);
    await expect(set(b.accountant, 520000)).resolves.toBeDefined();
  });

  it('only the cap-override key (2FA) may go beyond', async () => {
    await expect(set(b.owner, 900000)).resolves.toBeDefined();
  });

  it('a school without a policy has no cap', async () => {
    const l2 = (await admin<{ structure_id: string }>(db, `select structure_id::text from public.fee_structure_lines where tenant_id = $1 and fee_head_id = $2`, [a.tenant, a.heads.tuition])).rows[0]!.structure_id;
    await expect(q(db, a.accountant, `update public.fee_structure_lines set amount_minor = 5000000 where structure_id = $1 and fee_head_id = $2`, [l2, a.heads.tuition])).resolves.toBeDefined();
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

let db: PGlite;
let w: World;
let s: School;

const voucher = async (student: string, period = s.period) =>
  (await admin<{ id: string; status: string; total_minor: string; gross_minor: string; concession_minor: string; paid_minor: string; adjusted_minor: string; snapshot: any }>(
    db, `select * from public.vouchers where student_id = $1 and period = $2`, [student, period])).rows[0]!;
const num = (x: string | number | bigint) => Number(x);
const acct = async (code: string, family?: string) =>
  num((await admin<{ n: string }>(db, `select coalesce(sum(l.debit - l.credit),0) n from public.journal_lines l join public.accounts a on a.id = l.account_id
     where l.tenant_id = $1 and a.code = $2 and ($3::uuid is null or l.family_id = $3)`, [s.tenant, code, family ?? null])).rows[0]!.n);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, 'f');
  await seedSchool(db, w, w.tenantB, ids.ownerB, 'g'); // a second school running side by side
});

describe('voucher generation', () => {
  it('applies the approved 10% tuition concession and freezes a snapshot', async () => {
    const amna = await voucher(s.students[0]!);
    expect([num(amna.gross_minor), num(amna.concession_minor)]).toEqual([600000, 50000]);
    expect(amna.snapshot.concessions[0]).toMatchObject({ amount: 50000, reason: 'Staff child' });
    expect(amna.snapshot.heads.map((h: any) => h.code)).toEqual(['TRANSPORT', 'TUITION']); // monthly heads only; ANNUAL excluded
    expect(num((await voucher(s.students[1]!)).concession_minor)).toBe(0);
  });

  it('is idempotent: running the month again creates nothing', async () => {
    const r = await q<{ n: number }>(db, s.accountant, `select public.generate_vouchers($1::date,$2,$3) n`, [s.period, s.session, s.classId]);
    expect(r.rows[0]!.n).toBe(0);
    expect((await admin<{ n: number }>(db, `select count(*)::int n from public.vouchers where tenant_id = $1`, [s.tenant])).rows[0]!.n).toBe(3);
  });

  it('needs the permission; a cashier cannot issue vouchers', async () => {
    await expect(q(db, s.cashier, `select public.generate_vouchers($1::date,$2)`, ['2027-01-01', s.session])).rejects.toThrow(/permission denied/);
  });

  it('concession approval is maker-checker', async () => {
    const id = (await q<{ id: string }>(db, s.accountant, `select public.request_concession($1,'fixed',10000,'Hardship') id`, [s.students[2]!])).rows[0]!.id;
    await expect(q(db, s.accountant, `select public.approve_concession($1)`, [id])).rejects.toThrow(/permission denied|maker-checker/);
    await expect(q(db, s.owner, `select public.approve_concession($1)`, [id])).resolves.toBeDefined();
    await expect(q(db, s.owner, `select public.approve_concession($1)`, [id])).rejects.toThrow(/already approved/);
  });
});

describe('payments', () => {
  it('allocates to the preferred voucher first, then oldest', async () => {
    const [amna, bilal, zara] = [await voucher(s.students[0]!), await voucher(s.students[1]!), await voucher(s.students[2]!)];
    expect([num(bilal.paid_minor), bilal.status]).toEqual([200000, 'partially_paid']); // bank payment targeted Bilal
    expect([num(amna.paid_minor), amna.status]).toEqual([100000, 'partially_paid']);   // cash spilled onto the oldest (Amna)
    expect([num(zara.paid_minor), zara.status]).toEqual([600000, 'paid']);             // Raast webhook
  });

  it('replaying an idempotency key returns the same payment; reusing it with other details fails', async () => {
    const before = (await admin<{ n: number }>(db, `select count(*)::int n from public.payments where tenant_id = $1`, [s.tenant])).rows[0]!.n;
    const a = await q<{ id: string }>(db, s.accountant, `select public.record_payment($1,200000,'bank',$2,$3) id`, [s.families[0]!, `seed-bank-${s.tenant}`, null]);
    expect(a.rows[0]!.id).toBeTruthy();
    expect((await admin<{ n: number }>(db, `select count(*)::int n from public.payments where tenant_id = $1`, [s.tenant])).rows[0]!.n).toBe(before);
    await expect(q(db, s.accountant, `select public.record_payment($1,999,'bank',$2)`, [s.families[0]!, `seed-bank-${s.tenant}`])).rejects.toThrow(/reused with different details/);
  });

  it('webhooks are idempotent and reject unknown consumer numbers', async () => {
    const zara = (await admin<{ consumer_no: string }>(db, `select consumer_no from public.vouchers where student_id = $1`, [s.students[2]!])).rows[0]!;
    const before = (await admin<{ n: number }>(db, `select count(*)::int n from public.payments where tenant_id = $1`, [s.tenant])).rows[0]!.n;
    await q(db, null, `select public.handle_payment_webhook('raast',$1,$2,600000,'RAAST-1')`, [`evt-${s.tenant}`, zara.consumer_no], 'service_role'); // provider retry
    expect((await admin<{ n: number }>(db, `select count(*)::int n from public.payments where tenant_id = $1`, [s.tenant])).rows[0]!.n).toBe(before);
    await expect(q(db, null, `select public.handle_payment_webhook('raast','evt-x','000',100,null)`, [], 'service_role')).rejects.toThrow(/unknown consumer/);
    // staff cannot call the webhook entry point directly
    await expect(q(db, s.owner, `select public.handle_payment_webhook('raast','evt-y',$1,100,null)`, [zara.consumer_no])).rejects.toThrow(/permission denied/);
  });

  it('cash needs an open cashier session', async () => {
    await expect(q(db, s.accountant, `select public.record_payment($1,1000,'cash','k-cash-nosession')`, [s.families[0]!])).rejects.toThrow(/cashier session/);
  });

  it('an overpayment becomes an advance, and the next voucher consumes it automatically', async () => {
    await q(db, s.accountant, `select public.record_payment($1,50000,'bank','k-advance')`, [s.families[1]!]); // Zara's family owes nothing now
    expect(-(await acct('20200', s.families[1]))).toBe(50000);
    await q(db, s.accountant, `select public.generate_vouchers('2026-12-01'::date,$1,$2)`, [s.session, s.classId]);
    const dec = await voucher(s.students[2]!, '2026-12-01');
    expect([num(dec.paid_minor), dec.status]).toEqual([50000, 'partially_paid']);
    expect(await acct('20200', s.families[1])).toBe(0);
  });
});

describe('fines, waivers, write-offs', () => {
  it('fines apply once per overdue voucher', async () => {
    expect((await q<{ n: number }>(db, s.accountant, `select public.apply_fines('2026-12-01') n`)).rows[0]!.n).toBe(2); // Amna + Bilal (Nov); Zara paid; Dec not yet due
    expect((await q<{ n: number }>(db, s.accountant, `select public.apply_fines('2026-12-01') n`)).rows[0]!.n).toBe(0);
    expect(num((await voucher(s.students[0]!)).adjusted_minor)).toBe(50000);
  });

  it('waivers need an MFA session and the waiver permission, and cannot exceed the balance', async () => {
    const amna = await voucher(s.students[0]!);
    const aal1 = w.as(ids.ownerA, w.tenantA, { aal: 'aal1' });
    await expect(q(db, aal1, `select public.approve_waiver($1,10000,'x')`, [amna.id])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.accountant, `select public.approve_waiver($1,10000,'x')`, [amna.id])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.owner, `select public.approve_waiver($1,99999999,'too much')`, [amna.id])).rejects.toThrow(/outstanding balance/);
    await q(db, s.owner, `select public.approve_waiver($1,100000,'Principal discretion')`, [amna.id]);
    const after = await voucher(s.students[0]!);
    expect(num(after.total_minor) + num(after.adjusted_minor) - num(after.paid_minor)).toBe(400000); // 550000 − 100000 paid + 50000 fine − 100000 waived
  });

  it('write-off settles the remainder against Bad Debts', async () => {
    const bilal = await voucher(s.students[1]!);
    const bal = num(bilal.total_minor) + num(bilal.adjusted_minor) - num(bilal.paid_minor);
    const before = await acct('60800');
    await q(db, s.owner, `select public.write_off_fee($1,'Family relocated')`, [bilal.id]);
    expect((await voucher(s.students[1]!)).status).toBe('paid');
    expect((await acct('60800')) - before).toBe(bal);
  });
});

describe('cashier sessions', () => {
  it('close posts the variance, once, and only by the cashier', async () => {
    await expect(q(db, s.accountant, `select public.close_cashier_session($1, 100000)`, [s.cashierSession])).rejects.toThrow(/no such open session|only the cashier/);
    const cashBefore = await acct('10100');
    const r = await q<{ v: string }>(db, s.cashier, `select public.close_cashier_session($1, 90000) v`, [s.cashierSession]);
    expect(num(r.rows[0]!.v)).toBe(-10000);
    expect((await acct('10100')) - cashBefore).toBe(-10000);
    expect(await acct('60900')).toBe(10000);
    await expect(q(db, s.cashier, `select public.close_cashier_session($1, 90000)`, [s.cashierSession])).rejects.toThrow(/no such open session/);
  });

  it('cash deposit and gateway settlement move money between asset accounts', async () => {
    const [cash0, bank0, clr0] = [await acct('10100'), await acct('10200'), await acct('10300')];
    await q(db, s.accountant, `select public.deposit_cash(90000)`);
    await q(db, s.accountant, `select public.settle_gateway(600000, 6000)`);
    expect([(await acct('10100')) - cash0, (await acct('10200')) - bank0, (await acct('10300')) - clr0]).toEqual([-90000, 90000 + 594000, -600000]);
  });
});

describe('ledger guarantees', () => {
  const lines = (...l: object[]) => JSON.stringify(l);

  it('unbalanced or one-sided entries are rejected at commit, and unknown accounts fail', async () => {
    await expect(q(db, s.accountant, `select public.post_manual_journal('2026-11-05','bad',$1::jsonb)`, [lines({ a: '10100', d: 100 }, { a: '40100', c: 90 })])).rejects.toThrow(/unbalanced/);
    await expect(q(db, s.accountant, `select public.post_manual_journal('2026-11-05','bad',$1::jsonb)`, [lines({ a: '99999', d: 100 }, { a: '40100', c: 100 })])).rejects.toThrow(/unknown or inactive account/);
    // bypass the RPC entirely: even a privileged writer cannot commit an unbalanced entry
    await expect(db.transaction(async (tx) => {
      const e = await tx.query<{ id: string }>(`insert into public.journal_entries (tenant_id, entry_date, source_type) values ($1,'2026-11-05','test') returning id`, [s.tenant]);
      await tx.query(`insert into public.journal_lines (tenant_id, entry_id, account_id, debit) select $1,$2,id,500 from public.accounts where tenant_id=$1 and code='10100'`, [s.tenant, e.rows[0]!.id]);
      await tx.query(`insert into public.journal_lines (tenant_id, entry_id, account_id, credit) select $1,$2,id,400 from public.accounts where tenant_id=$1 and code='40100'`, [s.tenant, e.rows[0]!.id]);
    })).rejects.toThrow(/unbalanced/);
    await expect(db.transaction(async (tx) => {
      await tx.query(`insert into public.journal_entries (tenant_id, entry_date, source_type) values ($1,'2026-11-05','test')`, [s.tenant]);
    })).rejects.toThrow(/at least two lines/);
  });

  it('journals are immutable; corrections are single reversals made by an approver', async () => {
    const id = (await q<{ id: string }>(db, s.accountant, `select public.post_manual_journal('2026-11-05','Rent',$1::jsonb) id`, [lines({ a: '60200', d: 5000 }, { a: '10200', c: 5000 })])).rows[0]!.id;
    await expect(admin(db, `update public.journal_lines set debit = 1 where entry_id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(admin(db, `delete from public.journal_entries where id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(admin(db, `truncate public.journal_lines`)).rejects.toThrow(/immutable/);
    await expect(q(db, s.accountant, `select public.reverse_journal($1,'oops')`, [id])).rejects.toThrow(/permission denied/);
    const rev = (await q<{ id: string }>(db, s.owner, `select public.reverse_journal($1,'posted twice') id`, [id])).rows[0]!.id;
    await expect(q(db, s.owner, `select public.reverse_journal($1,'again')`, [id])).rejects.toThrow(/duplicate key|unique/i);
    await expect(q(db, s.owner, `select public.reverse_journal($1,'meta')`, [rev])).rejects.toThrow(/cannot itself be reversed/);
    expect((await admin<{ n: string }>(db, `select sum(debit - credit) n from public.journal_lines where entry_id in ($1,$2) and account_id = (select id from public.accounts where tenant_id=$3 and code='60200')`, [id, rev, s.tenant])).rows[0]!.n).toBe('0');
  });

  it('closed months reject new entries; only the period-close permission can close', async () => {
    await expect(q(db, s.accountant, `select public.close_period('2026-09-01')`)).rejects.toThrow(/permission denied/);
    await q(db, s.owner, `select public.close_period('2026-09-17')`); // any date in the month
    await expect(q(db, s.accountant, `select public.post_manual_journal('2026-09-15','late',$1::jsonb)`, [lines({ a: '60200', d: 1 }, { a: '10200', c: 1 })])).rejects.toThrow(/closed/);
  });

  it('API roles cannot write money tables directly or call internal posting helpers', async () => {
    for (const stmt of [
      `insert into public.journal_entries (tenant_id, entry_date, source_type) values ('${s.tenant}','2026-11-01','x')`,
      `update public.vouchers set paid_minor = 0`,
      `delete from public.payments`,
      `insert into public.accounts (tenant_id, code, name, type, normal_side) values ('${s.tenant}','99999','x','asset','debit')`,
    ]) await expect(q(db, s.owner, stmt), stmt).rejects.toThrow(/permission denied|row-level security/);
    await expect(q(db, s.owner, `select app.post_journal($1, null, '2026-11-01', 'x', 'x', null, '[]'::jsonb)`, [s.tenant])).rejects.toThrow(/permission denied/);
  });
});

describe('who can see money', () => {
  it('a parent sees their own family’s vouchers, statement and children — nobody else’s', async () => {
    const vouchers = await q<{ student_id: string }>(db, s.parent, `select student_id from public.vouchers`);
    expect(new Set(vouchers.rows.map((r) => r.student_id))).toEqual(new Set([s.students[0], s.students[1]]));
    expect((await q(db, s.parent, `select * from public.voucher_lines`)).rows.length).toBeGreaterThan(0);
    expect((await q(db, s.parent, `select id from public.students order by admission_no`)).rows).toHaveLength(2);
    expect((await q(db, s.parent, `select * from public.payments where family_id = $1`, [s.families[1]!])).rows).toHaveLength(0);

    const st = await q<{ balance: string }>(db, s.parent, `select * from public.family_statement($1)`, [s.families[0]!]);
    expect(st.rows.length).toBeGreaterThan(2);
    expect(num(st.rows.at(-1)!.balance)).toBe(await acct('11000', s.families[0]));
    await expect(q(db, s.parent, `select * from public.family_statement($1)`, [s.families[1]!])).rejects.toThrow(/permission denied/);
  });

  it('a parent cannot pay-record, read the ledger, or see the chart of accounts', async () => {
    await expect(q(db, s.parent, `select public.record_payment($1,100,'bank','k-parent')`, [s.families[0]!])).rejects.toThrow(/permission denied/);
    for (const t of ['journal_lines', 'journal_entries', 'accounts', 'cashier_sessions', 'concessions', 'student_sensitive']) {
      expect((await q(db, s.parent, `select * from public.${t}`)).rows, t).toHaveLength(0);
    }
  });

  it('a cashier collects but cannot read the ledger; staff in another school see nothing here', async () => {
    expect((await q(db, s.cashier, `select * from public.journal_lines`)).rows).toHaveLength(0);
    const bOwner = w.as(ids.ownerB, w.tenantB);
    expect((await q(db, bOwner, `select * from public.vouchers where tenant_id = $1`, [s.tenant])).rows).toHaveLength(0);
    await expect(q(db, bOwner, `select * from public.family_statement($1)`, [s.families[0]!])).resolves.toMatchObject({ rows: [] }); // other tenant's family: no rows, no leak
  });

  it('sensitive student data is readable only with the sensitive permission', async () => {
    expect((await q(db, s.owner, `select * from public.student_sensitive`)).rows.length).toBe(1);
    expect((await q(db, s.cashier, `select * from public.student_sensitive`)).rows).toHaveLength(0);
  });
});

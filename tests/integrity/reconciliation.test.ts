import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

let db: PGlite;
let w: World;
let s: School;
let other: School;
let cn: Record<'amna' | 'bilal' | 'zara', string>;
const n = (x: unknown) => Number(x);
const line = (date: string, description: string, amount_minor: number, reference = '') => ({ date, description, reference, amount_minor });
const lines = async (st?: string) => (await admin<any>(db, `select * from public.bank_statement_lines where tenant_id = $1 ${st ? `and status = '${st}'` : ''} order by line_no`, [s.tenant])).rows;
const glSum = async (code: string, extra = '') =>
  n((await admin<{ n: string }>(db, `select coalesce(sum(l.debit - l.credit),0) n from public.journal_lines l join public.accounts a on a.id = l.account_id where l.tenant_id = $1 and a.code = $2 ${extra}`, [s.tenant, code])).rows[0]!.n);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, 'r');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, 's');
  const cns = (await admin<{ student_id: string; consumer_no: string }>(db, `select student_id, consumer_no from public.vouchers where tenant_id = $1`, [s.tenant])).rows;
  const of = (id: string) => cns.find((x) => x.student_id === id)!.consumer_no;
  cn = { amna: of(s.students[0]!), bilal: of(s.students[1]!), zara: of(s.students[2]!) };
});

describe('bank statement import & reconciliation', () => {
  const stmt = () => [
    line('2026-11-05', `IBFT from KHAN ${cn.bilal}`, 400000),            // exact balance of Bilal's voucher → auto
    line('2026-11-05', `IBFT ${cn.amna}`, 999999999),                    // far above Amna's balance → human
    line('2026-11-06', 'Cash deposit CDM', 30000),                       // no number → human
    line('2026-11-04', `payment for ${cn.amna} and ${cn.bilal}`, 1000),  // two numbers → human (dated first so a faulty matcher would take it while both vouchers are still open)
    line('2026-11-07', `IBFT ${cn.zara}`, 5000),                         // Zara's voucher is already paid → human
    line('2026-11-08', 'IBFT from AHMED', 12345),                        // office already keyed this one → link
    line('2026-11-09', 'Profit credit', 77),                             // not a fee → ignore
  ];

  it('imports, and re-importing (even under another reference) adds nothing', async () => {
    const a = await q<{ inserted: number; skipped: number }>(db, s.accountant, `select * from public.import_bank_statement('NOV-1', $1::jsonb)`, [JSON.stringify(stmt())]);
    expect(a.rows[0]).toEqual({ inserted: 7, skipped: 0 });
    const b = await q<{ inserted: number; skipped: number }>(db, s.accountant, `select * from public.import_bank_statement('NOV-1-again', $1::jsonb)`, [JSON.stringify(stmt())]);
    expect(b.rows[0]).toEqual({ inserted: 0, skipped: 7 });
    // two genuinely identical deposits in one batch are both real; an overlapping export that shows three adds only the third
    const c = await q<{ inserted: number }>(db, s.accountant, `select * from public.import_bank_statement('DUP', $1::jsonb)`, [JSON.stringify([line('2026-12-01', 'same', 100), line('2026-12-01', 'same', 100)])]);
    expect(c.rows[0]!.inserted).toBe(2);
    const d = await q<{ inserted: number }>(db, s.accountant, `select * from public.import_bank_statement('DUP-3', $1::jsonb)`, [JSON.stringify([line('2026-12-01', 'same', 100), line('2026-12-01', 'same', 100), line('2026-12-01', 'same', 100)])]);
    expect(d.rows[0]!.inserted).toBe(1);
    await admin(db, `delete from public.bank_statement_lines where tenant_id = $1 and statement_ref in ('DUP','DUP-3')`, [s.tenant]);
  });

  it('only people with the right permission can import or reconcile', async () => {
    await expect(q(db, s.cashier, `select * from public.import_bank_statement('x', '[{"date":"2026-11-05","amount_minor":1}]'::jsonb)`)).rejects.toThrow(/permission denied/);
    await expect(q(db, s.parent, `select public.reconcile_bank_lines()`)).rejects.toThrow(/permission denied/);
    await expect(q(db, s.accountant, `select * from public.import_bank_statement('x', '[{"date":"2026-11-05","amount_minor":-5}]'::jsonb)`)).rejects.toThrow(/positive credit/);
  });

  it('auto-matches only the unambiguous line and posts a balanced payment for it', async () => {
    const bankBefore = await glSum('10200');
    expect((await q<{ n: number }>(db, s.accountant, `select public.reconcile_bank_lines() n`)).rows[0]!.n).toBe(1);
    expect((await q<{ n: number }>(db, s.accountant, `select public.reconcile_bank_lines() n`)).rows[0]!.n).toBe(0); // idempotent
    const matched = await lines('matched');
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ match_kind: 'auto', amount_minor: 400000 });
    const bilal = (await admin<any>(db, `select * from public.vouchers where student_id = $1`, [s.students[1]!])).rows[0];
    expect([n(bilal.paid_minor), bilal.status]).toEqual([600000, 'paid']);
    expect((await glSum('10200')) - bankBefore).toBe(400000);
    expect(await lines('unmatched')).toHaveLength(6);
  });

  it('a person can match a line to a family (excess becomes advance) but not twice', async () => {
    const cashLine = (await lines('unmatched')).find((x: any) => x.description === 'Cash deposit CDM');
    await q(db, s.accountant, `select public.match_bank_line($1, $2)`, [cashLine.id, s.families[1]!]);
    await expect(q(db, s.accountant, `select public.match_bank_line($1, $2)`, [cashLine.id, s.families[1]!])).rejects.toThrow(/already matched/);
    const adv = n((await admin<{ n: string }>(db, `select coalesce(sum(l.credit - l.debit),0) n from public.journal_lines l join public.accounts a on a.id = l.account_id where l.family_id = $1 and a.code = '20200'`, [s.families[1]!])).rows[0]!.n);
    expect(adv).toBe(30000); // Zara's family had nothing outstanding
  });

  it('a voucher must belong to the family it is matched with', async () => {
    const l = (await lines('unmatched')).find((x: any) => n(x.amount_minor) === 1000)!;
    const zaraV = (await admin<{ id: string }>(db, `select id from public.vouchers where student_id = $1`, [s.students[2]!])).rows[0]!.id;
    await expect(q(db, s.accountant, `select public.match_bank_line($1, $2, $3)`, [l.id, s.families[0]!, zaraV])).rejects.toThrow(/does not belong/);
  });

  it('links to a payment the office already recorded instead of recording the money twice', async () => {
    const pay = (await q<{ id: string }>(db, s.accountant, `select public.record_payment($1, 12345, 'bank', 'slip-77') id`, [s.families[1]!])).rows[0]!.id;
    const l = (await lines('unmatched')).find((x: any) => n(x.amount_minor) === 12345)!;
    const wrong = (await lines('unmatched')).find((x: any) => n(x.amount_minor) === 5000)!;
    await expect(q(db, s.accountant, `select public.link_bank_line($1, $2)`, [wrong.id, pay])).rejects.toThrow(/amounts differ/);
    const count = async () => n((await admin<{ n: string }>(db, `select count(*) n from public.payments where tenant_id = $1`, [s.tenant])).rows[0]!.n);
    const before = await count();
    await q(db, s.accountant, `select public.link_bank_line($1, $2)`, [l.id, pay]);
    expect(await count()).toBe(before);
    expect((await lines('matched')).find((x: any) => x.id === l.id)).toMatchObject({ match_kind: 'linked', payment_id: pay });
    // that payment cannot back a second line
    await q(db, s.accountant, `select * from public.import_bank_statement('X2', '[{"date":"2026-11-10","amount_minor":12345,"description":"again"}]'::jsonb)`);
    const l2 = (await lines('unmatched')).find((x: any) => x.description === 'again')!;
    await expect(q(db, s.accountant, `select public.link_bank_line($1, $2)`, [l2.id, pay])).rejects.toThrow(/already linked/);
  });

  it('ignoring needs a reason; ignored lines are closed', async () => {
    const l = (await lines('unmatched')).find((x: any) => x.description === 'Profit credit')!;
    await expect(q(db, s.accountant, `select public.ignore_bank_line($1, ' ')`, [l.id])).rejects.toThrow(/reason/);
    await q(db, s.accountant, `select public.ignore_bank_line($1, 'Bank profit, not a fee')`, [l.id]);
    await expect(q(db, s.accountant, `select public.ignore_bank_line($1, 'again')`, [l.id])).rejects.toThrow(/no unmatched line/);
  });

  it('the ledger still balances and receivable still equals the voucher balances', async () => {
    const tb = (await admin<{ d: string; c: string }>(db, `select sum(debit)::text d, sum(credit)::text c from public.journal_lines where tenant_id = $1`, [s.tenant])).rows[0]!;
    expect(tb.d).toBe(tb.c);
    const v = n((await admin<{ n: string }>(db, `select coalesce(sum(total_minor + adjusted_minor - paid_minor),0) n from public.vouchers where tenant_id=$1 and status <> 'cancelled'`, [s.tenant])).rows[0]!.n);
    expect(await glSum('11000')).toBe(v);
  });

  it('another school cannot see, match or ignore these lines', async () => {
    const mine = (await lines())[0];
    expect((await q<{ n: number }>(db, other.owner, `select count(*)::int n from public.bank_statement_lines where tenant_id = $1`, [s.tenant])).rows[0]!.n).toBe(0);
    await expect(q(db, other.accountant, `select public.ignore_bank_line($1, 'x')`, [mine.id])).rejects.toThrow(/no unmatched line/);
    await expect(q(db, other.accountant, `select public.match_bank_line($1, $2)`, [mine.id, other.families[0]!])).rejects.toThrow(/not found/);
  });
});

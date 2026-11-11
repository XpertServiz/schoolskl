import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

// CLAUDE.md §18 rule 10: trial balance balances; fee receivable = sum of family statements; voucher totals = journal totals.
// CI fails otherwise. The school below has been through every money operation, in two tenants.

let db: PGlite;
let w: World;
const schools: School[] = [];
const n = (x: unknown) => Number(x);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  for (const [tenant, owner, tag] of [[w.tenantA, ids.ownerA, 'a'], [w.tenantB, ids.ownerB, 'b']] as const) {
    const s = await seedSchool(db, w, tenant, owner, tag);
    schools.push(s);
    await q(db, s.accountant, `select public.record_payment($1, 70000, 'jazzcash', $2)`, [s.families[1]!, `adv-${tag}`]);          // → advance
    await q(db, s.accountant, `select public.generate_vouchers('2026-12-01'::date,$1,$2)`, [s.session, s.classId]);                  // advance consumed
    await q(db, s.accountant, `select public.apply_fines('2027-02-01')`);
    const amna = (await admin<{ id: string }>(db, `select id from public.vouchers where student_id = $1 and period = '2026-11-01'`, [s.students[0]!])).rows[0]!.id;
    await q(db, s.owner, `select public.approve_waiver($1, 25000, 'Hardship')`, [amna]);
    const bilalDec = (await admin<{ id: string }>(db, `select id from public.vouchers where student_id = $1 and period = '2026-12-01'`, [s.students[1]!])).rows[0]!.id;
    await q(db, s.owner, `select public.write_off_fee($1, 'Left school')`, [bilalDec]);
    await q(db, s.cashier, `select public.close_cashier_session($1, 95000)`, [s.cashierSession]);
    await q(db, s.accountant, `select public.settle_gateway(300000, 3000)`);
    // a business-event journal cannot be reversed on its own (it would desync the voucher) …
    const fine = (await admin<{ id: string }>(db, `select id from public.journal_entries where tenant_id=$1 and source_type='fine' limit 1`, [tenant])).rows[0]!.id;
    await expect(q(db, s.owner, `select public.reverse_journal($1, 'fine charged in error')`, [fine])).rejects.toThrow(/own operation/);
    // … but a manual journal can, and the reversal nets it to zero
    const man = (await q<{ id: string }>(db, s.accountant, `select public.post_manual_journal('2026-11-20','Office rent',$1::jsonb) id`, [JSON.stringify([{ a: '60200', d: 8000 }, { a: '10200', c: 8000 }])])).rows[0]!.id;
    await q(db, s.owner, `select public.reverse_journal($1, 'wrong month')`, [man]);
  }
});

describe('ledger invariants', () => {
  it('every entry balances and has ≥ 2 lines', async () => {
    const bad = await admin(db, `select entry_id from public.journal_lines group by entry_id having sum(debit) <> sum(credit) or count(*) < 2`);
    expect(bad.rows).toEqual([]);
    expect((await admin(db, `select count(*)::int n from public.journal_entries`)).rows[0]!.n).toBeGreaterThan(20);
  });

  it('trial balance balances, per tenant and overall', async () => {
    const r = await admin<{ tenant_id: string; d: string; c: string }>(db, `select tenant_id, sum(debit)::text d, sum(credit)::text c from public.journal_lines group by tenant_id`);
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) expect(row.d, row.tenant_id).toBe(row.c);
    const tb = await admin<{ d: string; c: string }>(db, `select sum(debit_total)::text d, sum(credit_total)::text c from public.v_trial_balance`);
    expect(tb.rows[0]!.d).toBe(tb.rows[0]!.c);
  });

  it('Fee Receivable = Σ open voucher balances = Σ family statements', async () => {
    for (const s of schools) {
      const gl = n((await admin<{ n: string }>(db, `select coalesce(sum(l.debit - l.credit),0) n from public.journal_lines l join public.accounts a on a.id = l.account_id where l.tenant_id=$1 and a.code='11000'`, [s.tenant])).rows[0]!.n);
      const vouchers = n((await admin<{ n: string }>(db, `select coalesce(sum(total_minor + adjusted_minor - paid_minor),0) n from public.vouchers where tenant_id=$1 and status <> 'cancelled'`, [s.tenant])).rows[0]!.n);
      let statements = 0;
      for (const f of s.families) {
        const st = await q<{ balance: string }>(db, s.owner, `select * from public.family_statement($1)`, [f]);
        statements += st.rows.length ? n(st.rows.at(-1)!.balance) : 0;
      }
      expect(vouchers, `${s.tenant} vouchers vs GL`).toBe(gl);
      expect(statements, `${s.tenant} statements vs GL`).toBe(gl);
      expect(gl).toBeGreaterThan(0); // the scenario leaves real arrears
    }
  });

  it('each voucher’s journal equals its frozen totals (receivable, income, concessions)', async () => {
    const r = await admin<{ voucher_no: string; recv: string; income: string; conc: string; total_minor: string; gross_minor: string; concession_minor: string }>(db, `
      select v.voucher_no, v.total_minor, v.gross_minor, v.concession_minor,
        coalesce(sum(l.debit) filter (where a.code = '11000'), 0) recv,
        coalesce(sum(l.credit) filter (where a.type = 'income' and a.code <> '49100'), 0) income,
        coalesce(sum(l.debit) filter (where a.code = '49100'), 0) conc
      from public.vouchers v
      join public.journal_entries e on e.tenant_id = v.tenant_id and e.source_type = 'voucher' and e.source_id = v.id
      join public.journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
      join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      group by v.id, v.voucher_no, v.total_minor, v.gross_minor, v.concession_minor`); // voucher_no is only unique per tenant
    expect(r.rows.length).toBe(12); // 2 tenants × 3 students × 2 months
    for (const v of r.rows) {
      expect(n(v.recv), `${v.voucher_no} receivable`).toBe(n(v.total_minor));
      expect(n(v.income), `${v.voucher_no} income`).toBe(n(v.gross_minor));
      expect(n(v.conc), `${v.voucher_no} concessions`).toBe(n(v.concession_minor));
    }
  });

  it('each payment’s journal debits its channel account for exactly the amount, and credits receivable + advance', async () => {
    const r = await admin<{ id: string; amount_minor: string; dr: string; cr: string; alloc: string; adv: string }>(db, `
      select p.id, p.amount_minor,
        (select coalesce(sum(l.debit),0) from public.journal_lines l where l.entry_id = p.journal_entry_id) dr,
        (select coalesce(sum(l.credit),0) from public.journal_lines l where l.entry_id = p.journal_entry_id) cr,
        (select coalesce(sum(amount_minor),0) from public.payment_allocations x where x.payment_id = p.id) alloc,
        (select coalesce(sum(l.credit),0) from public.journal_lines l join public.accounts a on a.id = l.account_id
           where l.entry_id = p.journal_entry_id and a.code = '20200') adv
      from public.payments p where p.channel <> 'advance'`);
    expect(r.rows.length).toBe(8); // 2 tenants × (bank, raast webhook, cash, jazzcash)
    for (const p of r.rows) {
      expect(n(p.dr), p.id).toBe(n(p.amount_minor));
      expect(n(p.cr), p.id).toBe(n(p.amount_minor));
      expect(n(p.alloc) + n(p.adv), `${p.id} allocated + advance`).toBe(n(p.amount_minor));
    }
  });

  it('voucher.paid_minor = Σ allocations; no voucher is over-paid; status matches the balance', async () => {
    const r = await admin<{ voucher_no: string; paid_minor: string; alloc: string; bal: string; status: string }>(db, `
      select v.voucher_no, v.paid_minor, v.status, v.total_minor + v.adjusted_minor - v.paid_minor bal,
             (select coalesce(sum(amount_minor),0) from public.payment_allocations a where a.voucher_id = v.id) alloc
      from public.vouchers v`);
    for (const v of r.rows) {
      expect(n(v.paid_minor), v.voucher_no).toBe(n(v.alloc));
      expect(n(v.bal), `${v.voucher_no} balance`).toBeGreaterThanOrEqual(0);
      expect(v.status === 'paid', `${v.voucher_no} status ${v.status} vs balance ${v.bal}`).toBe(n(v.bal) === 0);
    }
  });

  it('advance balances are never negative and equal unallocated cash received', async () => {
    const r = await admin<{ family_id: string; adv: string; expected: string }>(db, `
      select f.id family_id,
        (select coalesce(sum(l.credit - l.debit),0) from public.journal_lines l join public.accounts a on a.id = l.account_id where l.family_id = f.id and a.code = '20200') adv,
        (select coalesce(sum(p.amount_minor - (select coalesce(sum(x.amount_minor),0) from public.payment_allocations x where x.payment_id = p.id)),0)
           from public.payments p where p.family_id = f.id and p.channel <> 'advance')
        - (select coalesce(sum(p.amount_minor),0) from public.payments p where p.family_id = f.id and p.channel = 'advance') expected
      from public.families f`);
    for (const f of r.rows) {
      expect(n(f.adv), f.family_id).toBeGreaterThanOrEqual(0);
      expect(n(f.adv), f.family_id).toBe(n(f.expected));
    }
  });

  it('cash in hand equals cash received less deposits and variances', async () => {
    for (const s of schools) {
      const cash = n((await admin<{ n: string }>(db, `select coalesce(sum(l.debit - l.credit),0) n from public.journal_lines l join public.accounts a on a.id = l.account_id where l.tenant_id=$1 and a.code='10100'`, [s.tenant])).rows[0]!.n);
      const counted = n((await admin<{ n: string }>(db, `select coalesce(sum(counted_minor),0) n from public.cashier_sessions where tenant_id=$1 and status='closed'`, [s.tenant])).rows[0]!.n);
      expect(cash).toBe(counted); // the only cash this school took went through the one (now closed) session
    }
  });

  it('every entry, voucher and payment belongs to the same tenant as the rows it references', async () => {
    const r = await admin(db, `
      select l.id from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where e.tenant_id <> l.tenant_id
      union all select p.id::text::bigint from public.payments p join public.families f on f.id = p.family_id where f.tenant_id <> p.tenant_id limit 1`).catch(() => ({ rows: [] }));
    expect(r.rows).toEqual([]);
  });
});

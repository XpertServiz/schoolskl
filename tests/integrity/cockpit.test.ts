import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

let db: PGlite;
let w: World;
let s: School;
let other: School;
const n = (x: unknown) => Number(x);
const one = async <T = any>(who: any, sql: string, params: unknown[] = []) => (await q<T>(db, who, sql, params)).rows[0]!;

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, 'c');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, 'd');
});

describe('my_access', () => {
  it('lists exactly the permissions the caller holds, plus plan features', async () => {
    const owner = (await one<{ a: any }>(s.owner, `select public.my_access() a`)).a;
    expect(owner.tenant.id).toBe(s.tenant);
    expect(owner.permissions).toEqual(expect.arrayContaining(['fees.view', 'students.view', 'settings.manage']));
    expect(owner.features).toContain('payroll');

    const cashier = (await one<{ a: any }>(s.cashier, `select public.my_access() a`)).a;
    expect(cashier.permissions).toContain('fees.collect');
    expect(cashier.permissions).not.toContain('payroll.post');
    expect(cashier.permissions).not.toContain('settings.manage');
  });

  it('a parent has no staff permissions and is flagged as a guardian; no session means nothing', async () => {
    const parent = (await one<{ a: any }>(s.parent, `select public.my_access() a`)).a;
    expect(parent.is_guardian).toBe(true);
    expect(parent.permissions).not.toContain('fees.collect');
    // a session with no school claim and no chosen school gets nothing (a claim-less user WITH a chosen school is covered in tenant-fallback.test.ts)
    expect((await one<{ a: any }>(w.as(ids.outsider, null), `select public.my_access() a`)).a).toBeNull();
  });

  it('an MFA-only key is not listed without aal2', async () => {
    const weak = { ...s.owner, aal: 'aal1' };
    const a = (await one<{ a: any }>(weak, `select public.my_access() a`)).a;
    expect(a.permissions).not.toContain('payroll.post');
    expect(a.permissions).not.toContain('fees.waiver.approve');
  });
});

describe('approvals inbox', () => {
  let concession: string, run: string;
  beforeAll(async () => {
    concession = (await one<{ id: string }>(s.accountant, `select public.request_concession($1,'fixed',50000,'Sibling discount') id`, [s.students[2]])).id;
    const staff = (await one<{ id: string }>(s.owner, `insert into public.staff_members (tenant_id, employee_no, full_name, category) values ($1,'C-1','Clerk','non_teaching') returning id`, [s.tenant])).id;
    await q(db, s.accountant, `insert into public.staff_pay (tenant_id, staff_id, basic_minor) values ($1,$2,3000000)`, [s.tenant, staff]);
    const m = (await admin<{ d: string }>(db, `select (date_trunc('month', app.tenant_today($1)) - interval '1 month')::date::text d`, [s.tenant])).rows[0]!.d;
    run = (await one<{ id: string }>(s.accountant, `select public.prepare_payroll($1::date) id`, [m])).id;
  });
  const inbox = async (who: any) => (await q<any>(db, who, `select * from public.approvals_inbox()`)).rows;

  it('shows the maker their own items as blocked, with the reason, and the checker as actionable', async () => {
    const mine = await inbox(s.accountant);
    const c = mine.find((x: any) => x.ref_id === concession);
    expect(c).toMatchObject({ kind: 'concession', can_act: false });
    const p = mine.find((x: any) => x.ref_id === run);
    expect(p).toMatchObject({ kind: 'payroll', can_act: false });
    expect(p.blocked_reason).toMatch(/prepared|payroll\.post/);

    const theirs = await inbox(s.owner);
    expect(theirs.find((x: any) => x.ref_id === concession)).toMatchObject({ can_act: true });
    expect(theirs.find((x: any) => x.ref_id === run)).toMatchObject({ can_act: true });
  });

  it('is not visible to a parent or to another school, and an approved item leaves the inbox', async () => {
    expect(await inbox(s.parent)).toEqual([]);
    expect((await inbox(other.owner)).some((x: any) => x.ref_id === concession || x.ref_id === run)).toBe(false);
    await q(db, s.owner, `select public.approve_concession($1)`, [concession]);
    expect((await inbox(s.owner)).some((x: any) => x.ref_id === concession)).toBe(false);
  });

  it('what the inbox says the caller can do, the database lets them do', async () => {
    await expect(q(db, s.accountant, `select public.post_payroll($1)`, [run])).rejects.toThrow(/permission denied|maker-checker/);
    await q(db, s.owner, `select public.post_payroll($1)`, [run]);
    expect((await inbox(s.owner)).some((x: any) => x.ref_id === run)).toBe(false);
  });
});

describe('school cockpit', () => {
  it('numbers agree with the books they summarise', async () => {
    const c = (await one<{ c: any }>(s.owner, `select public.school_cockpit() c`)).c;
    const aging = n((await admin<{ x: string }>(db, `select coalesce(sum(balance_minor),0) x from public.v_fee_aging where tenant_id = $1`, [s.tenant])).rows[0]!.x);
    const receivable = n((await admin<{ x: string }>(db, `select coalesce(sum(l.debit - l.credit),0) x from public.journal_lines l join public.accounts a on a.id = l.account_id where l.tenant_id = $1 and a.code = '11000'`, [s.tenant])).rows[0]!.x);
    expect(n(c.fees.outstanding_minor)).toBe(aging);
    expect(n(c.fees.outstanding_minor)).toBe(receivable);
    expect(n(c.students.active)).toBe(3);
    expect(n(c.attendance.absent)).toBe(1);
    expect(n(c.fees.collected_today_minor)).toBeGreaterThan(0);
  });

  it('shows each block only to someone allowed to see that data', async () => {
    const cashier = (await one<{ c: any }>(s.cashier, `select public.school_cockpit() c`)).c;
    expect(cashier.fees).toBeDefined();
    expect(cashier.admissions).toBeUndefined();
    const parent = (await one<{ c: any }>(s.parent, `select public.school_cockpit() c`)).c;
    expect(parent.fees).toBeUndefined();
    expect(parent.students).toBeUndefined();
    expect(parent.attendance).toBeUndefined();
  });

  it('never mixes schools', async () => {
    const a = (await one<{ c: any }>(s.owner, `select public.school_cockpit() c`)).c;
    const b = (await one<{ c: any }>(other.owner, `select public.school_cockpit() c`)).c;
    await admin(db, `update public.payments set amount_minor = amount_minor + 1 where tenant_id = $1 and channel = 'cash'`, [other.tenant]);
    const a2 = (await one<{ c: any }>(s.owner, `select public.school_cockpit() c`)).c;
    expect(a2.fees.collected_today_minor).toEqual(a.fees.collected_today_minor);
    expect(b.fees).toBeDefined();
  });
});

describe('nightly job', () => {
  const as_of = '2027-01-15';
  const run = (tenant: string) => q<{ r: any }>(db, null, `select public.run_nightly($1, $2::date) r`, [tenant, as_of], 'service_role');
  const fines = async (tenant: string) => n((await admin<{ c: string }>(db, `select count(*) c from public.voucher_adjustments where tenant_id = $1 and kind = 'fine'`, [tenant])).rows[0]!.c);
  const queued = async (tenant: string) => n((await admin<{ c: string }>(db, `select count(*) c from public.notification_outbox where tenant_id = $1 and kind = 'fee.reminder'`, [tenant])).rows[0]!.c);

  it('is callable only by the service role', async () => {
    await expect(q(db, s.owner, `select public.run_nightly($1, null)`, [s.tenant])).rejects.toThrow(/permission denied/);
    await expect(q(db, null, `select public.run_nightly($1, null)`, [s.tenant], 'anon')).rejects.toThrow(/permission denied/);
  });

  it('fines and queues reminders for one school only, and leaves the ledger balanced', async () => {
    const beforeB = [await fines(other.tenant), await queued(other.tenant)];
    const r = (await run(s.tenant)).rows[0]!.r;
    expect(r.fines).toBeGreaterThan(0);
    expect(r.reminders_queued).toBeGreaterThan(0);
    expect(await fines(s.tenant)).toBe(r.fines);
    expect([await fines(other.tenant), await queued(other.tenant)]).toEqual(beforeB);
    const tb = n((await admin<{ x: string }>(db, `select coalesce(sum(debit - credit),0) x from public.journal_lines where tenant_id = $1`, [s.tenant])).rows[0]!.x);
    expect(tb).toBe(0);
  });

  it('is idempotent: running it again changes nothing', async () => {
    const f = await fines(s.tenant), qd = await queued(s.tenant);
    const r = (await run(s.tenant)).rows[0]!.r;
    expect([r.fines, r.reminders_queued]).toEqual([0, 0]);
    expect([await fines(s.tenant), await queued(s.tenant)]).toEqual([f, qd]);
  });

  it('skips a suspended school, and leaves no identity behind in the session', async () => {
    await admin(db, `update public.tenants set status = 'suspended' where id = $1`, [other.tenant]);
    expect((await run(other.tenant)).rows[0]!.r).toEqual({ skipped: 'tenant not active' });
    const claims = (await q<{ c: string }>(db, null, `select coalesce(current_setting('request.jwt.claims', true), '') c`, [], 'service_role')).rows[0]!.c;
    expect(claims).not.toContain('school_owner');
    expect(claims).not.toContain(ids.ownerA);
  });
});

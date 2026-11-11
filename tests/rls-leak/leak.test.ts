import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool } from '../helpers/school';

let db: PGlite;
let w: World;
let tables: string[];

/** Tables the vendor platform may legitimately read across tenants (policy says so explicitly). */
const VENDOR_VISIBLE = new Set(['tenants', 'tenant_flags', 'impersonation_sessions']);

async function count(claims: Parameters<typeof q>[1], table: string, where: string, params: unknown[], role: 'authenticated' | 'anon' = 'authenticated') {
  try {
    const r = await q<{ n: number }>(db, claims, `select count(*)::int n from public.${table} where ${where}`, params, role);
    return r.rows[0]!.n;
  } catch (e) {
    if (/permission denied/i.test((e as Error).message)) return 0; // no privilege == no rows
    throw e;
  }
}

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);

  // Give tenant B at least one row in every tenant-owned table so "0 rows visible" is meaningful.
  await admin(db, `insert into public.tenant_flags (tenant_id, flag_key, enabled) values ($1, 'saferoute', true)`, [w.tenantB]);
  await admin(db, `insert into public.user_permission_overrides (tenant_id, user_id, permission_key, effect) values ($1,$2,'fees.view','grant')`, [w.tenantB, ids.ownerB]);
  await q(db, w.as(ids.ownerB, w.tenantB), `select public.log_sensitive_access('student', null, 'b_form', 'fixture')`);
  await q(db, w.as(ids.vendorAdmin, null), `select public.start_impersonation($1, 'fixture session for leak test', 'TCK-1')`, [w.tenantB]);
  await q(db, w.as(ids.ownerB, w.tenantB), `select public.import_batch_create('campuses', '[{"code":"X1","name":"Fixture"}]'::jsonb, 'fixture')`);

  // A full school for B (students → vouchers → payments → journals), plus the few things the seeder leaves out
  const b = await seedSchool(db, w, w.tenantB, ids.ownerB, 'b');
  await q(db, b.owner, `select public.apply_fines('2027-06-01')`); // voucher_adjustments
  await q(db, b.owner, `select public.close_period('2026-01-01')`); // accounting_periods
  // fee operations: reminders, instalments, promise, deposit, refund, cap policy
  const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
  await q(db, b.owner, `select public.queue_fee_reminders('2027-06-01')`); // seeds reminder_rules + fee_reminders
  const amna = (await admin<{ id: string }>(db, `select id from public.vouchers where student_id = $1`, [b.students[0]!])).rows[0]!.id;
  await q(db, b.owner, `select public.create_installment_plan($1, $2::date[])`, [amna, [addDays(b.today, 10), addDays(b.today, 40)]]); // installment_plans + installments
  await q(db, b.owner, `select public.record_promise($1, 100000, $2::date)`, [b.families[1]!, addDays(b.today, 5)]);
  await q(db, b.accountant, `select public.collect_security_deposit($1, 500000, 'bank', 'dep-leak')`, [b.families[1]!]);
  await q(db, b.accountant, `select public.record_payment($1, 70000, 'jazzcash', 'adv-leak')`, [b.families[1]!]); // → advance
  await q(db, b.owner, `select public.refund_advance($1, 20000, 'Left school', 'refund-leak')`, [b.families[1]!]);
  await q(db, b.accountant, `select * from public.import_bank_statement('fixture', '[{"date":"2026-11-05","description":"fixture","amount_minor":1000}]'::jsonb)`);
  await q(db, b.owner, `insert into public.fee_policy (tenant_id, max_increase_bps) values ($1, 1000)`, [w.tenantB]);
  // staff, timetable, admissions
  const stf = (await q<{ id: string }>(db, b.owner, `insert into public.staff_members (tenant_id, employee_no, full_name) values ($1,'E-1','Fixture Teacher') returning id`, [w.tenantB])).rows[0]!.id;
  await q(db, b.owner, `select public.mark_staff_attendance($1::date, $2::jsonb)`, [b.today, JSON.stringify([{ staff_id: stf, status: 'present' }])]);
  const subj = (await q<{ id: string }>(db, b.owner, `insert into public.subjects (tenant_id, code, name) values ($1,'ENG','English') returning id`, [w.tenantB])).rows[0]!.id;
  const per = (await q<{ id: string }>(db, b.owner, `insert into public.periods (tenant_id, campus_id, name, starts_at, ends_at) values ($1,$2,'P1','08:00','08:40') returning id`, [w.tenantB, b.campus])).rows[0]!.id;
  await q(db, b.owner, `insert into public.timetable_slots (tenant_id, section_id, day_of_week, period_id, subject_id, teacher_id) values ($1,$2,1,$3,$4,$5)`, [w.tenantB, b.section, per, subj, stf]);
  await q(db, b.owner, `insert into public.teaching_assignments (tenant_id, staff_id, section_id, subject_id) values ($1,$2,$3,$4)`, [w.tenantB, stf, b.section, subj]);
  await q(db, b.owner, `select public.create_inquiry($1, 'Fixture Child', 'Fixture Guardian', '03110000000')`, [b.campus]); // inquiries + events
  const gid = (await admin<{ id: string }>(db, `select id from public.guardians where tenant_id = $1 limit 1`, [w.tenantB])).rows[0]!.id;
  await q(db, b.owner, `select public.set_contact_prefs($1, true, true)`, [gid]); // guardian_contact_prefs
  const ob = (await admin<{ id: string }>(db, `select id from public.notification_outbox where tenant_id = $1 limit 1`, [w.tenantB])).rows[0]!.id;
  await q(db, null, `select public.record_delivery($1,$2,'sms','delivered','m-1')`, [ob, gid], 'service_role'); // notification_deliveries
  // payroll: pay structure → draft run → payslips
  await q(db, b.owner, `insert into public.staff_pay (tenant_id, staff_id, basic_minor) values ($1,$2,4000000)`, [w.tenantB, stf]);
  const comp = (await q<{ id: string }>(db, b.owner, `insert into public.salary_components (tenant_id, code, name, kind, calc) values ($1,'HRA','Allowance','earning','fixed') returning id`, [w.tenantB])).rows[0]!.id;
  await q(db, b.owner, `insert into public.staff_pay_components (tenant_id, staff_id, component_id, value) values ($1,$2,$3,100000)`, [w.tenantB, stf, comp]);
  await q(db, b.owner, `select public.prepare_payroll($1::date)`, [b.today.slice(0, 8) + '01']);
  // gradebook: exam → assessment → marks → published results
  const ex = (await q<{ id: string }>(db, b.owner, `select public.create_exam($1, 'Fixture exam') id`, [b.session])).rows[0]!.id;
  const asm = (await q<{ id: string }>(db, b.owner, `select public.define_assessment($1,$2,$3,100) id`, [ex, b.classId, subj])).rows[0]!.id;
  await q(db, b.owner, `select public.set_exam_stage($1,'marking')`, [ex]);
  await q(db, b.owner, `select public.enter_marks($1, $2::jsonb)`, [asm, JSON.stringify(b.students.map((id) => ({ student_id: id, marks: 70 })))]);
  await q(db, b.owner, `select public.set_exam_stage($1,'moderation')`, [ex]);
  await q(db, b.owner, `select public.moderate_mark($1,$2,71,'present','fixture')`, [asm, b.students[0]!]); // mark_amendments
  await q(db, b.owner, `select public.publish_results($1)`, [ex]);                                           // result_lines, result_summaries
  // …and A gets one too, so "forged claim" / "parent in both schools" tests have something real to leak
  await seedSchool(db, w, w.tenantA, ids.ownerA, 'a');

  const r = await admin<{ table_name: string }>(
    db,
    `select c.table_name from information_schema.columns c join information_schema.tables t
       on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'tenant_id' order by 1`,
  );
  tables = r.rows.map((x) => x.table_name);
});

describe('fixtures are complete', () => {
  it('tenant B owns at least one row in every tenant-owned table', async () => {
    const empty: string[] = [];
    for (const t of tables) {
      const n = (await admin<{ n: number }>(db, `select count(*)::int n from public.${t} where tenant_id = $1`, [w.tenantB])).rows[0]!.n;
      if (n === 0) empty.push(t);
    }
    expect(empty, 'add a fixture for these tables in leak.test.ts').toEqual([]);
  });
});

describe('cross-tenant isolation — every tenant-owned table', () => {
  it('owner of A sees zero of B’s rows, and cannot update or delete them', async () => {
    const ownerA = w.as(ids.ownerA, w.tenantA);
    for (const t of tables) {
      expect(await count(ownerA, t, 'tenant_id = $1', [w.tenantB]), `${t} select`).toBe(0);
      for (const stmt of [`update public.${t} set tenant_id = tenant_id where tenant_id = $1`, `delete from public.${t} where tenant_id = $1`]) {
        try {
          const res = await q(db, ownerA, stmt, [w.tenantB]);
          expect(res.affectedRows ?? 0, `${t}: ${stmt}`).toBe(0);
        } catch (e) {
          expect((e as Error).message, `${t}: ${stmt}`).toMatch(/permission denied|append-only/i);
        }
      }
    }
  });

  it('a forged tenant_id claim (A’s owner claiming B) yields nothing', async () => {
    const forged = w.as(ids.ownerA, w.tenantB);
    for (const t of tables) expect(await count(forged, t, 'true', []), `${t} forged claim`).toBe(0);
  });

  it('a parent in both schools sees only the school in their current claim — data is never merged', async () => {
    for (const t of ['campuses', 'roles', 'tenant_domains']) {
      const inA = w.as(ids.parentAB, w.tenantA);
      const inB = w.as(ids.parentAB, w.tenantB);
      expect(await count(inA, t, 'tenant_id <> $1', [w.tenantA]), `${t} A-claim leaks B`).toBe(0);
      expect(await count(inB, t, 'tenant_id <> $1', [w.tenantB]), `${t} B-claim leaks A`).toBe(0);
    }
  });

  it('vendor staff cannot read tenant data without impersonation (except the explicit platform tables)', async () => {
    const vendor = w.as(ids.vendorAdmin, null);
    for (const t of tables.filter((x) => !VENDOR_VISIBLE.has(x))) expect(await count(vendor, t, 'true', []), `${t} vendor`).toBe(0);
    // vendor claiming a tenant WITHOUT an impersonation session is just a forged claim
    const vendorForged = w.as(ids.vendorAdmin, w.tenantB);
    for (const t of tables.filter((x) => !VENDOR_VISIBLE.has(x))) expect(await count(vendorForged, t, 'true', []), `${t} vendor forged`).toBe(0);
  });

  it('anonymous callers see nothing', async () => {
    for (const t of [...tables, 'profiles', 'vendor_staff', 'permissions', 'role_templates']) {
      expect(await count(null, t, 'true', [], 'anon'), `${t} anon`).toBe(0);
    }
  });

  it('writes into another tenant are rejected, not silently redirected', async () => {
    const ownerA = w.as(ids.ownerA, w.tenantA);
    await expect(q(db, ownerA, `insert into public.campuses (tenant_id, code, name) values ($1,'EVIL','Evil')`, [w.tenantB])).rejects.toThrow(/row-level security/i);
    await expect(q(db, ownerA, `insert into public.roles (tenant_id, key, name) values ($1,'evil','Evil')`, [w.tenantB])).rejects.toThrow(/row-level security/i);
    // a child row may not point at another tenant's parent row (composite FK)
    await expect(
      q(db, ownerA, `insert into public.user_roles (tenant_id, user_id, role_id) select $1, $2, id from public.roles where tenant_id = $3 limit 1`, [w.tenantA, ids.teacherA, w.tenantB]),
    ).resolves.toMatchObject({ affectedRows: 0 }); // can't even see B's roles
    await expect(
      admin(db, `insert into public.user_roles (tenant_id, user_id, role_id) select $1, $2, id from public.roles where tenant_id = $3 limit 1`, [w.tenantA, ids.teacherA, w.tenantB]),
    ).rejects.toThrow(/foreign key/i);
  });
});

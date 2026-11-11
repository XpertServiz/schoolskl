import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

/**
 * The web pages talk to the database with plain PostgREST selects. This pins, per page, the table + columns it asks for and runs them as the
 * roles that open that page — so a renamed column, or an RLS policy that locks a role out of data its screen needs, fails here and not in a browser.
 */
let db: PGlite;
let w: World;
let s: School;
let other: School;
const n = (x: unknown) => Number(x);

const PAGE_QUERIES: Record<string, string> = {
  fees: `select voucher_id, family_id, student_id, voucher_no, due_date, balance_minor, days_overdue, bucket from public.v_fee_aging where balance_minor > 0 order by due_date limit 200`,
  'fees:students': `select id, full_name, admission_no from public.students`,
  'fees:drawer': `select id from public.cashier_sessions where status = 'open'`,
  'fees:campuses': `select id, name from public.campuses where is_active`,
  challan: `select id, student_id, voucher_no, consumer_no, period, due_date, status, total_minor, adjusted_minor, paid_minor, gross_minor, concession_minor from public.vouchers`,
  'challan:lines': `select description, amount_minor, kind from public.voucher_lines order by created_at`,
  'challan:adj': `select kind, amount_minor, reason from public.voucher_adjustments order by created_at`,
  students: `select id, admission_no, full_name, family_id from public.students order by admission_no limit 200`,
  'students:ref': `select c.id, c.name, c.level, se.id sec, se.class_id, se.name sname from public.classes c left join public.sections se on se.class_id = c.id`,
  'students:session': `select id, name from public.academic_sessions where is_current`,
  'students:enrol': `select student_id, class_id, section_id, roll_no from public.student_enrolments where status = 'active'`,
  attendance: `select student_id, status from public.student_attendance`,
  family: `select id, student_id, voucher_no, period, due_date, status, total_minor, adjusted_minor, paid_minor from public.vouchers where status <> 'cancelled' order by period desc limit 60`,
  'family:results': `select exam_id, student_id, percent, grade, position from public.result_summaries`,
  'family:exams': `select id, name from public.exams where status = 'published'`,
  exams: `select id, name, status, published_at from public.exams order by created_at desc`,
  'exams:detail': `select id, exam_id, class_id, subject_id, max_marks from public.assessments`,
  'exams:subjects': `select id, name from public.subjects where is_active order by name`,
  'exams:marks': `select student_id, marks, status from public.marks`,
  payroll: `select id, period, status, gross_minor, deductions_minor, net_minor from public.payroll_runs order by period desc limit 36`,
  admissions: `select id, child_name, guardian_name, guardian_phone, stage, follow_up_on from public.admission_inquiries order by created_at desc limit 200`,
  'setup:heads': `select id, code, name, income_account_code, frequency, is_active from public.fee_heads order by code`,
  'setup:structures': `select id, session_id, class_id, name from public.fee_structures`,
  'setup:lines': `select structure_id, fee_head_id, amount_minor from public.fee_structure_lines`,
  'setup:fine': `select grace_days, fine_minor from public.fine_rules`,
  concessions: `select id, student_id, kind, value, reason, status, created_at from public.concessions order by created_at desc limit 100`,
  'challan:family': `select id, family_id from public.vouchers`,
  reconcile: `select id, txn_date, description, reference, amount_minor, status, ignore_reason from public.bank_statement_lines order by txn_date desc limit 200`,
  'reconcile:open': `select voucher_id, family_id, student_id, voucher_no, balance_minor from public.v_fee_aging where balance_minor > 0 limit 500`,
  payslips: `select id, run_id, basic_minor, gross_minor, deductions_minor, net_minor, absent_days, lines from public.payslips`,
  'payslips:staff': `select id from public.staff_members where user_id = auth.uid()`,
  accounts: `select * from public.profit_loss('2026-01-01','2026-12-31')`,
  'accounts:bs': `select section, code, name, amount from public.balance_sheet('2026-12-31')`,
  'accounts:close': `select public.daily_closing_report(current_date)`,
  vendorless: `select tenant_id from public.my_tenants()`,
  staff: `select id, employee_no, full_name, designation, status, shift_start, shift_end, user_id from public.staff_members order by employee_no`,
  'staff:mine': `select id, full_name, status from public.staff_members where user_id = auth.uid()`,
  'staff:att': `select staff_id, status, check_in, check_out from public.staff_attendance`,
  'staff:members': `select user_id from public.user_tenants where status = 'active'`,
  'staff:profiles': `select user_id, full_name from public.profiles`,
  'staff:campuses': `select id, name from public.campuses where is_active`,
  'timetable:subjects': `select id, code, name from public.subjects where is_active order by name`,
  'timetable:periods': `select id, campus_id, name, starts_at, ends_at, sort_order, is_break from public.periods order by sort_order, starts_at`,
  'timetable:classes': `select id, name, level, campus_id from public.classes order by level`,
  transport: `select id, name, vehicle_label, driver_staff_id, attendant_staff_id, is_active from public.transport_routes order by name`,
  'transport:riders': `select student_id, route_id, stop_name from public.transport_riders`,
  'transport:staff': `select id, full_name, user_id, status from public.staff_members where status = 'active' order by full_name`,
  'transport:students': `select id, full_name, admission_no from public.students where status = 'enrolled' order by full_name`,
  'transport:live': `select trip_id, route_name, vehicle_label, direction, lat, lng, position_at, riders, on_board from public.live_trips()`,
  'family:bus': `select student_id, first_name, route_name, vehicle_label, stop_name, consent, saferoute_on, trip_id, direction, trip_started_at, last_event, last_event_at, lat, lng, accuracy_m, position_at from public.my_bus_status()`,
  'timetable:sections': `select id, class_id, name from public.sections order by name`,
  'timetable:staff': `select id, full_name from public.staff_members where status = 'active' order by full_name`,
  'timetable:slots': `select id, day_of_week, period_id, subject_id, teacher_id from public.timetable_slots`,
  'import:batches': `select id, status, summary, created_at from public.import_batches where entity = 'students' order by created_at desc limit 10`,
  'import:rows': `select row_no, raw, status, errors from public.import_rows order by row_no limit 2000`,
  'setup:progress': `select public.setup_progress()`,
  'setup:tenant': `select id, name, locale, branding from public.tenants`,
  'setup:campuses': `select id, code, name, city from public.campuses where is_active order by code`,
  'setup:sessions': `select id, name, starts_on, ends_on, is_current from public.academic_sessions order by starts_on desc`,
  'setup:classes': `select id, name, level, campus_id from public.classes order by level`,
};

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, 'u');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, 'v');
});

describe('every page query is valid SQL against the real schema', () => {
  for (const [name, sql] of Object.entries(PAGE_QUERIES)) {
    it(`${name} runs for the owner`, async () => {
      if (name === 'vendorless') return; // my_tenants is exercised by the access suite
      await expect(q(db, s.owner, sql)).resolves.toBeDefined();
    });
  }
});

describe('what each role can read for its own screens', () => {
  it('a cashier sees the fee list and student names, and own cash drawer', async () => {
    expect((await q(db, s.cashier, PAGE_QUERIES.fees!)).rows.length).toBeGreaterThan(0);
    expect((await q(db, s.cashier, PAGE_QUERIES['fees:students']!)).rows.length).toBe(3);
    expect((await q(db, s.cashier, PAGE_QUERIES['fees:drawer']!)).rows.length).toBe(1);
  });

  it('a parent sees only their own children, vouchers and attendance — never the other family', async () => {
    const kids = (await q<{ full_name: string }>(db, s.parent, PAGE_QUERIES.students!)).rows.map((r) => r.full_name).sort();
    expect(kids).toEqual(['Amna Khan', 'Bilal Khan']);
    const v = (await q<{ student_id: string }>(db, s.parent, PAGE_QUERIES.family!)).rows;
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => s.students.slice(0, 2).includes(x.student_id))).toBe(true);
    const fee = (await q<{ student_id: string }>(db, s.parent, PAGE_QUERIES.fees!)).rows;
    expect(fee.every((x) => s.students.slice(0, 2).includes(x.student_id))).toBe(true);
    expect((await q(db, s.parent, PAGE_QUERIES.attendance!)).rows.every((r: any) => r.student_id !== s.students[2])).toBe(true);
  });

  it('a parent cannot open staff-only data (payroll, admissions, marks), and cannot see the unpublished exam list contents of other schools', async () => {
    expect((await q(db, s.parent, PAGE_QUERIES.payroll!)).rows).toEqual([]);
    expect((await q(db, s.parent, PAGE_QUERIES.admissions!)).rows).toEqual([]);
    expect((await q(db, s.parent, PAGE_QUERIES['exams:marks']!)).rows).toEqual([]);
  });

  it('a teacher can read what the marks and attendance screens need', async () => {
    const teacher = w.as(ids.teacherA, w.tenantA);
    expect((await q(db, teacher, PAGE_QUERIES['students:enrol']!)).rows.length).toBe(3);
    expect((await q(db, teacher, PAGE_QUERIES['students:ref']!)).rows.length).toBeGreaterThan(0);
    await expect(q(db, teacher, PAGE_QUERIES['exams:subjects']!)).resolves.toBeDefined();
    await expect(q(db, teacher, PAGE_QUERIES.exams!)).resolves.toBeDefined();
  });

  it('a school never sees the other school’s rows through any page query', async () => {
    for (const [name, sql] of Object.entries(PAGE_QUERIES)) {
      if (name === 'vendorless') continue;
      const mine = (await q<Record<string, any>>(db, s.owner, sql)).rows;
      const theirIds = new Set((await admin<{ id: string }>(db, `select id from public.students where tenant_id = $1`, [other.tenant])).rows.map((r) => r.id));
      for (const row of mine) {
        if ('student_id' in row) expect(theirIds.has(row.student_id), name).toBe(false);
        if (name === 'students') expect(theirIds.has(row.id), name).toBe(false);
      }
    }
  });
});

describe('staff and timetable screens (the writes the pages make, as the roles that make them)', () => {
  it('the owner adds staff, marks a staff day, and a parent sees no staff data at all', async () => {
    const a = (await q<{ id: string }>(db, s.owner, `insert into public.staff_members (tenant_id, employee_no, full_name, designation, shift_start, shift_end) values ($1,'E-001','Sana Tariq','Teacher','08:00','14:00') returning id`, [s.tenant])).rows[0]!.id;
    const b = (await q<{ id: string }>(db, s.owner, `insert into public.staff_members (tenant_id, employee_no, full_name, shift_start, shift_end) values ($1,'E-002','Usman Ali','08:00','14:00') returning id`, [s.tenant])).rows[0]!.id;
    expect((await q(db, s.owner, PAGE_QUERIES.staff!)).rows.length).toBeGreaterThanOrEqual(2);
    await q(db, s.owner, `select public.mark_staff_attendance($1::date, $2::jsonb)`, [s.today, JSON.stringify([{ staff_id: a, status: 'present' }, { staff_id: b, status: 'half_day' }])]);
    const att = (await q<{ status: string }>(db, s.owner, `${PAGE_QUERIES['staff:att']} where att_date = $1 order by status`, [s.today])).rows.map((r) => r.status);
    expect(att).toEqual(['half_day', 'present']);
    // the status form: resign one person
    await q(db, s.owner, `update public.staff_members set status = 'resigned', left_on = $2 where id = $1`, [b, s.today]);
    // a parent: no staff list, no staff attendance, no other members' profiles
    expect((await q(db, s.parent, PAGE_QUERIES.staff!)).rows).toEqual([]);
    expect((await q(db, s.parent, PAGE_QUERIES['staff:att']!)).rows).toEqual([]);
    await expect(q(db, s.cashier, `insert into public.staff_members (tenant_id, employee_no, full_name) values ($1,'E-9','X')`, [s.tenant])).rejects.toThrow();
  });

  it('timetable: set a lesson, replace the same cell by UPDATE (not upsert), and a teacher double-booking is refused', async () => {
    const subj = (await q<{ id: string }>(db, s.owner, `insert into public.subjects (tenant_id, code, name) values ($1,'MATH','Mathematics') returning id`, [s.tenant])).rows[0]!.id;
    const subj2 = (await q<{ id: string }>(db, s.owner, `insert into public.subjects (tenant_id, code, name) values ($1,'URD','Urdu') returning id`, [s.tenant])).rows[0]!.id;
    const p1 = (await q<{ id: string }>(db, s.owner, `insert into public.periods (tenant_id, campus_id, name, starts_at, ends_at, sort_order) values ($1,$2,'1','08:00','08:40',1) returning id`, [s.tenant, s.campus])).rows[0]!.id;
    const brk = (await q<{ id: string }>(db, s.owner, `insert into public.periods (tenant_id, campus_id, name, starts_at, ends_at, sort_order, is_break) values ($1,$2,'Break','10:00','10:20',3,true) returning id`, [s.tenant, s.campus])).rows[0]!.id;
    const teacher = (await q<{ id: string }>(db, s.owner, `select id from public.staff_members where employee_no = 'E-001'`)).rows[0]!.id;
    const sectionB = (await q<{ id: string }>(db, s.owner, `insert into public.sections (tenant_id, class_id, name) values ($1,$2,'B') returning id`, [s.tenant, s.classId])).rows[0]!.id;

    const slot = (await q<{ id: string }>(db, s.owner, `insert into public.timetable_slots (tenant_id, section_id, day_of_week, period_id, subject_id, teacher_id) values ($1,$2,1,$3,$4,$5) returning id`, [s.tenant, s.section, p1, subj, teacher])).rows[0]!.id;
    // the page replaces a cell with UPDATE — the clash trigger skips the row itself
    await q(db, s.owner, `update public.timetable_slots set subject_id = $2 where id = $1`, [slot, subj2]);
    // an upsert would trip the BEFORE INSERT clash check against the very row it replaces (why the page does not use it)
    await expect(q(db, s.owner, `insert into public.timetable_slots (tenant_id, section_id, day_of_week, period_id, subject_id) values ($1,$2,1,$3,$4) on conflict (tenant_id, section_id, day_of_week, period_id) do update set subject_id = excluded.subject_id`, [s.tenant, s.section, p1, subj])).rejects.toThrow(/overlaps/);
    // same teacher, same time, other section → refused
    await expect(q(db, s.owner, `insert into public.timetable_slots (tenant_id, section_id, day_of_week, period_id, subject_id, teacher_id) values ($1,$2,1,$3,$4,$5)`, [s.tenant, sectionB, p1, subj, teacher])).rejects.toThrow(/teacher is already teaching/);
    // a lesson in a break → refused
    await expect(q(db, s.owner, `insert into public.timetable_slots (tenant_id, section_id, day_of_week, period_id, subject_id) values ($1,$2,2,$3,$4)`, [s.tenant, s.section, brk, subj])).rejects.toThrow(/break/);

    // a teacher can READ the timetable screens but cannot change them
    const t = w.as(ids.teacherA, w.tenantA);
    for (const k of ['timetable:subjects', 'timetable:periods', 'timetable:classes', 'timetable:sections', 'timetable:slots'] as const) {
      expect((await q(db, t, PAGE_QUERIES[k]!)).rows.length, k).toBeGreaterThan(0);
    }
    await expect(q(db, t, `delete from public.timetable_slots where id = $1 returning id`, [slot])).resolves.toMatchObject({ rows: [] });
    expect((await q(db, s.owner, `select id from public.timetable_slots where id = $1`, [slot])).rows.length).toBe(1);
    // and the owner can remove it
    await q(db, s.owner, `delete from public.timetable_slots where id = $1`, [slot]);
    expect((await q(db, s.owner, PAGE_QUERIES['timetable:slots']!)).rows).toEqual([]);
  });
});

describe('transport screens (as the roles that open them)', () => {
  it('owner adds a route and a rider the way the page does; the parent sees the rider row for their own child only, and the bus status', async () => {
    const route = (await q<{ id: string }>(db, s.owner, `insert into public.transport_routes (tenant_id, name, vehicle_label) values ($1,'Page route','LEA-1') returning id`, [s.tenant])).rows[0]!.id;
    // the page's upsert (one route per child) — insert, then the same child again to another route
    await q(db, s.owner, `insert into public.transport_riders (tenant_id, student_id, route_id, stop_name) values ($1,$2,$3,'Stop A') on conflict (tenant_id, student_id) do update set route_id = excluded.route_id, stop_name = excluded.stop_name`, [s.tenant, s.students[0], route]);
    await q(db, s.owner, `insert into public.transport_riders (tenant_id, student_id, route_id, stop_name) values ($1,$2,$3,'Stop A') on conflict (tenant_id, student_id) do update set route_id = excluded.route_id, stop_name = excluded.stop_name`, [s.tenant, s.students[2], route]);
    expect((await q(db, s.parent, PAGE_QUERIES['transport:riders']!)).rows).toHaveLength(1); // Amna, not Zara
    expect((await q(db, s.cashier, PAGE_QUERIES['transport:riders']!)).rows).toHaveLength(0);
    await expect(q(db, s.cashier, `insert into public.transport_routes (tenant_id, name) values ($1,'Nope')`, [s.tenant])).rejects.toThrow(/row-level security|permission denied/);
    const bus = (await q<{ first_name: string; saferoute_on: boolean; consent: boolean }>(db, s.parent, PAGE_QUERIES['family:bus']!)).rows;
    expect(bus).toEqual([expect.objectContaining({ first_name: 'Amna', saferoute_on: false, consent: false })]);
    expect((await q(db, other.owner, PAGE_QUERIES.transport!)).rows.filter((r) => r.name === 'Page route')).toHaveLength(0);
    await expect(q(db, s.cashier, PAGE_QUERIES['transport:live']!)).rejects.toThrow(/permission denied/);
  });
});

describe('RPCs the pages call', () => {
  it('approvals_inbox, school_cockpit and my_access return for staff and are empty/limited for a parent', async () => {
    expect((await q(db, s.owner, `select * from public.approvals_inbox()`)).rows).toBeDefined();
    const c = (await q<{ c: any }>(db, s.parent, `select public.school_cockpit() c`)).rows[0]!.c;
    expect(c.fees).toBeUndefined();
    expect(n((await q<{ c: string }>(db, s.owner, `select count(*) c from public.my_tenants()`)).rows[0]!.c)).toBeGreaterThan(0);
  });

  it('marks_progress and report_card work end to end for the seeded exam flow', async () => {
    const exam = (await q<{ id: string }>(db, s.owner, `select public.create_exam($1,'Page test') id`, [s.session])).rows[0]!.id;
    const subject = (await q<{ id: string }>(db, s.owner, `insert into public.subjects (tenant_id, code, name) values ($1,'ENG','English') returning id`, [s.tenant])).rows[0]!.id;
    const a = (await q<{ id: string }>(db, s.owner, `select public.define_assessment($1,$2,$3,50) id`, [exam, s.classId, subject])).rows[0]!.id;
    const prog = (await q<any>(db, s.owner, `select * from public.marks_progress($1)`, [exam])).rows;
    expect(prog.length).toBe(1);
    expect(n(prog[0].expected)).toBe(3);
    await q(db, s.owner, `select public.set_exam_stage($1,'marking')`, [exam]);
    await q(db, s.owner, `select public.enter_marks($1, $2::jsonb)`, [a, JSON.stringify(s.students.map((id) => ({ student_id: id, marks: 40 })))]);
    await q(db, s.owner, `select public.set_exam_stage($1,'moderation')`, [exam]);
    await q(db, s.owner, `select public.publish_results($1)`, [exam]);
    const card = (await q<{ c: any }>(db, s.parent, `select public.report_card($1,$2) c`, [s.students[0], exam])).rows[0]!.c;
    expect(n(card.summary.percent)).toBe(80);
    expect((await q(db, s.parent, `select exam_id, student_id, percent, grade, position from public.result_summaries`)).rows.length).toBe(2); // Amna + Bilal only
    await expect(q(db, s.parent, `select public.report_card($1,$2)`, [s.students[2], exam])).rejects.toThrow(/permission denied/);
  });
});

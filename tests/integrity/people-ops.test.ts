import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

let db: PGlite;
let w: World;
let s: School;
let other: School;
const n = (x: unknown) => Number(x);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, 'p');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, 'q');
});

const staff = async (sc: School, no: string, name: string, user: string | null = null, extra = '') =>
  (await q<{ id: string }>(db, sc.owner, `insert into public.staff_members (tenant_id, employee_no, full_name, user_id ${extra ? ', ' + extra.split('=')[0] : ''}) values ($1,$2,$3,$4 ${extra ? ', ' + extra.split('=')[1] : ''}) returning id`, [sc.tenant, no, name, user])).rows[0]!.id;

describe('timetable', () => {
  let subj: string, p1: string, p2: string, p3: string, brk: string, secB: string, t1: string, t2: string;
  beforeAll(async () => {
    subj = (await q<{ id: string }>(db, s.owner, `insert into public.subjects (tenant_id, code, name) values ($1,'MATH','Mathematics') returning id`, [s.tenant])).rows[0]!.id;
    const per = async (name: string, a: string, b: string, brkFlag = false) =>
      (await q<{ id: string }>(db, s.owner, `insert into public.periods (tenant_id, campus_id, name, starts_at, ends_at, is_break) values ($1,$2,$3,$4,$5,$6) returning id`, [s.tenant, s.campus, name, a, b, brkFlag])).rows[0]!.id;
    p1 = await per('P1', '08:00', '08:40');
    p2 = await per('P2', '08:30', '09:10'); // deliberately overlaps P1 (e.g. a staggered bell for another wing)
    p3 = await per('P3', '09:10', '09:50');
    brk = await per('Break', '09:50', '10:10', true);
    secB = (await q<{ id: string }>(db, s.owner, `insert into public.sections (tenant_id, class_id, name) values ($1,$2,'B') returning id`, [s.tenant, s.classId])).rows[0]!.id;
    t1 = await staff(s, 'T-1', 'Teacher One');
    t2 = await staff(s, 'T-2', 'Teacher Two');
  });
  const slot = (who: any, sec: string, day: number, period: string, teacher: string | null) =>
    q(db, who, `insert into public.timetable_slots (tenant_id, section_id, day_of_week, period_id, subject_id, teacher_id) values ($1,$2,$3,$4,$5,$6)`, [s.tenant, sec, day, period, subj, teacher]);

  it('accepts a clean lesson, then refuses a section double-booking (same or overlapping period)', async () => {
    await slot(s.owner, s.section, 1, p1, t1);
    await expect(slot(s.owner, s.section, 1, p1, t2)).rejects.toThrow(/duplicate key|already has a lesson/);
    await expect(slot(s.owner, s.section, 1, p2, t2)).rejects.toThrow(/section already has a lesson that overlaps/);
    await expect(slot(s.owner, s.section, 2, p1, t1)).resolves.toBeDefined(); // another day is fine
  });
  it('refuses a teacher in two places at once, including overlapping bells, but allows back-to-back', async () => {
    await expect(slot(s.owner, secB, 1, p2, t1)).rejects.toThrow(/teacher is already teaching/);
    await expect(slot(s.owner, secB, 1, p3, t1)).resolves.toBeDefined(); // 09:10 starts after P1 ends 08:40 and P2 is not t1's
    await expect(slot(s.owner, secB, 1, p2, t2)).resolves.toBeDefined();
  });
  it('no lesson in a break; updates are clash-checked too', async () => {
    await expect(slot(s.owner, secB, 3, brk, t2)).rejects.toThrow(/break/);
    await expect(q(db, s.owner, `update public.timetable_slots set teacher_id = $2 where section_id = $1 and day_of_week = 1 and period_id = $3`, [secB, t1, p2])).rejects.toThrow(/teacher is already teaching/);
  });
  it('only timetable managers write; any member reads; another school sees nothing and cannot reference it', async () => {
    await expect(slot(s.cashier, s.section, 4, p1, t1)).rejects.toThrow(/row-level security/);
    expect(n((await q<{ n: number }>(db, s.parent, `select count(*)::int n from public.timetable_slots`)).rows[0]!.n)).toBeGreaterThan(0);
    expect(n((await q<{ n: number }>(db, other.owner, `select count(*)::int n from public.timetable_slots where tenant_id = $1`, [s.tenant])).rows[0]!.n)).toBe(0);
    await expect(q(db, other.owner, `insert into public.timetable_slots (tenant_id, section_id, day_of_week, period_id, subject_id) values ($1,$2,5,$3,$4)`, [other.tenant, s.section, p1, subj])).rejects.toThrow(/unknown period|foreign key|row-level/);
  });
});

describe('staff attendance', () => {
  let hr: string, cashierStaff: string, otherStaff: string;
  beforeAll(async () => {
    cashierStaff = await staff(s, 'E-10', 'Cashier Staff', s.userIds.cashier);
    hr = await staff(s, 'E-11', 'Other Staff');
    otherStaff = await staff(other, 'E-1', 'Other School Staff');
  });
  const day = async (offset = 0) => (await admin<{ d: string }>(db, `select (app.tenant_today($1) + $2::int)::text d`, [s.tenant, offset])).rows[0]!.d;

  it('HR marks a day, can correct it, cannot mark the future, and only people in this school', async () => {
    const d = await day();
    expect(n((await q<{ n: number }>(db, s.accountant, `select public.mark_staff_attendance($1::date, $2::jsonb) n`, [d, JSON.stringify([{ staff_id: hr, status: 'absent', note: 'sick' }])])).rows[0]!.n)).toBe(1);
    await q(db, s.accountant, `select public.mark_staff_attendance($1::date, $2::jsonb)`, [d, JSON.stringify([{ staff_id: hr, status: 'leave' }])]);
    expect((await admin<{ status: string }>(db, `select status from public.staff_attendance where staff_id = $1 and att_date = $2`, [hr, d])).rows.map((r) => r.status)).toEqual(['leave']);
    await expect(q(db, s.accountant, `select public.mark_staff_attendance($1::date, $2::jsonb)`, [await day(1), JSON.stringify([{ staff_id: hr, status: 'present' }])])).rejects.toThrow(/future/);
    await expect(q(db, s.accountant, `select public.mark_staff_attendance($1::date, $2::jsonb)`, [d, JSON.stringify([{ staff_id: otherStaff, status: 'present' }])])).rejects.toThrow(/not found/);
    await expect(q(db, s.cashier, `select public.mark_staff_attendance($1::date, $2::jsonb)`, [d, JSON.stringify([{ staff_id: hr, status: 'present' }])])).rejects.toThrow(/permission denied/);
  });

  it('self check-in records late/present from the shift start, ignores a second tap, and check-out needs a check-in', async () => {
    await expect(q(db, s.cashier, `select public.staff_check_out()`)).rejects.toThrow(/check in first/);
    const status = (await q<{ s: string }>(db, s.cashier, `select public.staff_check_in() s`)).rows[0]!.s;
    const expected = (await admin<{ late: boolean }>(db, `select (check_in > shift_start + interval '15 minutes') late from public.staff_members m join public.staff_attendance a on a.staff_id = m.id where m.id = $1`, [cashierStaff])).rows[0]!.late;
    expect(status).toBe(expected ? 'late' : 'present');
    const again = (await q<{ s: string }>(db, s.cashier, `select public.staff_check_in() s`)).rows[0]!.s;
    expect(again).toBe(status);
    expect(n((await admin<{ n: string }>(db, `select count(*) n from public.staff_attendance where staff_id = $1`, [cashierStaff])).rows[0]!.n)).toBe(1);
    await q(db, s.cashier, `select public.staff_check_out()`);
    expect((await admin<{ c: string | null }>(db, `select check_out::text c from public.staff_attendance where staff_id = $1`, [cashierStaff])).rows[0]!.c).not.toBeNull();
  });

  it('someone who is not staff cannot check in', async () => {
    await expect(q(db, s.parent, `select public.staff_check_in()`)).rejects.toThrow(/not registered as active staff/);
  });

  it('staff see only their own attendance; HR sees everyone’s; another school sees none', async () => {
    const mine = await q<{ staff_id: string }>(db, s.cashier, `select staff_id from public.staff_attendance`);
    expect(new Set(mine.rows.map((r) => r.staff_id))).toEqual(new Set([cashierStaff]));
    expect(n((await q<{ n: number }>(db, s.accountant, `select count(distinct staff_id)::int n from public.staff_attendance`)).rows[0]!.n)).toBe(2);
    expect(n((await q<{ n: number }>(db, other.owner, `select count(*)::int n from public.staff_attendance where tenant_id = $1`, [s.tenant])).rows[0]!.n)).toBe(0);
    expect(n((await q<{ n: number }>(db, s.parent, `select count(*)::int n from public.staff_attendance`)).rows[0]!.n)).toBe(0);
  });

  it('an inactive staff member cannot check in', async () => {
    await admin(db, `update public.staff_members set status = 'resigned' where id = $1`, [cashierStaff]);
    await expect(q(db, s.cashier, `select public.staff_check_in()`)).rejects.toThrow(/not registered as active staff/);
  });
});

describe('admissions CRM', () => {
  let inq: string;
  const create = (who: any, name = 'Hamza Raza', phone = '03001234567') =>
    q<{ id: string }>(db, who, `select public.create_inquiry($1, $2, 'Mr Raza', $3, $4) id`, [s.campus, name, phone, s.classId]);

  it('creates an inquiry, refuses an open duplicate for the same child + phone, and keeps a history', async () => {
    inq = (await create(s.owner)).rows[0]!.id;
    await expect(create(s.owner)).rejects.toThrow(/already an open inquiry/);
    await expect(create(s.owner, 'hamza raza')).rejects.toThrow(/already an open inquiry/); // case-insensitive
    await expect(create(s.owner, 'Hamza Raza', '03009999999')).resolves.toBeDefined();      // different phone: a different family
    await expect(create(s.cashier)).rejects.toThrow(/permission denied/);
  });

  it('only allows sensible stage moves; declining needs a reason; a declined inquiry can be reopened', async () => {
    const adv = (stage: string, note: string | null = null) => q(db, s.owner, `select public.advance_inquiry($1, $2, $3)`, [inq, stage, note]);
    await expect(adv('accepted')).rejects.toThrow(/cannot move an inquiry from inquiry to accepted/);
    await expect(adv('enrolled')).rejects.toThrow(/only through enrol_from_inquiry/);
    await adv('visit_scheduled', 'Saturday 11am');
    await adv('test_scheduled');
    await adv('offered');
    await expect(adv('declined')).rejects.toThrow(/reason is required/);
    await adv('declined', 'Chose another school');
    await expect(adv('offered')).rejects.toThrow(/cannot move/);
    await adv('inquiry', 'Called back');
    await adv('offered');
    expect(n((await admin<{ n: string }>(db, `select count(*) n from public.admission_events where inquiry_id = $1`, [inq])).rows[0]!.n)).toBe(7);
  });

  it('enrolling needs acceptance, creates the student, and links siblings by guardian phone', async () => {
    await expect(q(db, s.owner, `select public.enrol_from_inquiry($1,$2,$3)`, [inq, s.session, s.classId])).rejects.toThrow(/only an accepted inquiry/);
    await q(db, s.owner, `select public.advance_inquiry($1, 'accepted')`, [inq]);
    await expect(q(db, s.cashier, `select public.enrol_from_inquiry($1,$2,$3)`, [inq, s.session, s.classId])).rejects.toThrow(/permission denied/);
    const student = (await q<{ id: string }>(db, s.owner, `select public.enrol_from_inquiry($1,$2,$3,$4) id`, [inq, s.session, s.classId, s.section])).rows[0]!.id;
    const row = (await admin<any>(db, `select stage, student_id from public.admission_inquiries where id = $1`, [inq])).rows[0];
    expect(row).toMatchObject({ stage: 'enrolled', student_id: student });
    expect((await admin<{ full_name: string }>(db, `select full_name from public.students where id = $1`, [student])).rows[0]!.full_name).toBe('Hamza Raza');
    await expect(q(db, s.owner, `select public.enrol_from_inquiry($1,$2,$3)`, [inq, s.session, s.classId])).rejects.toThrow(/only an accepted inquiry/);
    // a second child with the same guardian phone joins the same family
    const sib = (await create(s.owner, 'Hira Raza', '03001234567')).rows[0]!.id;
    await q(db, s.owner, `select public.advance_inquiry($1,'offered')`, [sib]);
    await q(db, s.owner, `select public.advance_inquiry($1,'accepted')`, [sib]);
    const sibStudent = (await q<{ id: string }>(db, s.owner, `select public.enrol_from_inquiry($1,$2,$3) id`, [sib, s.session, s.classId])).rows[0]!.id;
    const fams = await admin<{ family_id: string }>(db, `select family_id from public.students where id in ($1, $2)`, [student, sibStudent]);
    expect(new Set(fams.rows.map((r) => r.family_id)).size).toBe(1);
  });

  it('the funnel counts stages; another school cannot see or move this school’s inquiries', async () => {
    const f = await q<{ stage: string; inquiries: number }>(db, s.owner, `select stage, sum(inquiries)::int inquiries from public.v_admission_funnel group by stage`);
    expect(Object.fromEntries(f.rows.map((r) => [r.stage, r.inquiries]))).toMatchObject({ enrolled: 2, inquiry: 1 });
    expect(n((await q<{ n: number }>(db, other.owner, `select count(*)::int n from public.admission_inquiries where tenant_id = $1`, [s.tenant])).rows[0]!.n)).toBe(0);
    await expect(q(db, other.owner, `select public.advance_inquiry($1,'lost','x')`, [inq])).rejects.toThrow(/inquiry not found/);
  });
});

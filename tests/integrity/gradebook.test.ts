import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

let db: PGlite;
let w: World;
let s: School;
let other: School;
let teacher: any, teacherOtherClass: any, coordinator: any;
let math: string, english: string, otherClass: string;
const n = (x: unknown) => Number(x);
/** PGlite returns numeric columns as strings; compare as numbers */
const num = <T extends Record<string, any>>(r: T): T => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])) as T;

async function member(sc: School, roleKey: string, label: string, scope?: { type: string; id: string }) {
  const id = randomUUID();
  await admin(db, `insert into auth.users (id, email) values ($1,$2)`, [id, `${label}-${id.slice(0, 6)}@example.test`]);
  await admin(db, `insert into public.user_tenants (tenant_id, user_id) values ($1,$2)`, [sc.tenant, id]);
  await admin(db, `insert into public.user_roles (tenant_id,user_id,role_id,scope_type,scope_id) select $1,$2,id,$3,$4 from public.roles where tenant_id=$1 and key=$5`,
    [sc.tenant, id, scope?.type ?? 'tenant', scope?.id ?? null, roleKey]);
  return w.as(id, sc.tenant);
}

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, 'g');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, 'h');
  math = (await q<{ id: string }>(db, s.owner, `insert into public.subjects (tenant_id, code, name) values ($1,'MATH','Mathematics') returning id`, [s.tenant])).rows[0]!.id;
  english = (await q<{ id: string }>(db, s.owner, `insert into public.subjects (tenant_id, code, name) values ($1,'ENG','English') returning id`, [s.tenant])).rows[0]!.id;
  otherClass = (await q<{ id: string }>(db, s.owner, `insert into public.classes (tenant_id,campus_id,name,level) values ($1,$2,'Grade 6',6) returning id`, [s.tenant, s.campus])).rows[0]!.id;
  teacher = await member(s, 'teacher', 'teacher', { type: 'class', id: s.classId });
  teacherOtherClass = await member(s, 'teacher', 'teacher2', { type: 'class', id: otherClass });
  coordinator = await member(s, 'coordinator', 'coordinator');
});

const exam = async (name: string) => (await q<{ id: string }>(db, s.owner, `select public.create_exam($1, $2) id`, [s.session, name])).rows[0]!.id;
const assess = async (e: string, subject: string, max: number) => (await q<{ id: string }>(db, s.owner, `select public.define_assessment($1,$2,$3,$4) id`, [e, s.classId, subject, max])).rows[0]!.id;
const stage = (e: string, to: string, who: any = s.owner) => q(db, who, `select public.set_exam_stage($1,$2)`, [e, to]);
const enter = (who: any, a: string, entries: unknown[]) => q(db, who, `select public.enter_marks($1, $2::jsonb)`, [a, JSON.stringify(entries)]);
const [amna, bilal, zara] = [0, 1, 2];

describe('term exam lifecycle', () => {
  let e1: string, aMath: string, aEng: string;

  it('only exam controllers create exams and assessments; duplicates are refused', async () => {
    await expect(q(db, teacher, `select public.create_exam($1,'Nope')`, [s.session])).rejects.toThrow(/permission denied/);
    e1 = await exam('Mid-term');
    await expect(q(db, s.owner, `select public.create_exam($1,'Mid-term')`, [s.session])).rejects.toThrow(/duplicate key/);
    await expect(q(db, teacher, `select public.define_assessment($1,$2,$3,100)`, [e1, s.classId, math])).rejects.toThrow(/permission denied/);
    aMath = await assess(e1, math, 100);
    aEng = await assess(e1, english, 50);
    await expect(assess(e1, math, 100)).rejects.toThrow(/duplicate key/);
    await expect(q(db, s.owner, `select public.define_assessment($1,$2,$3,0)`, [e1, s.classId, math])).rejects.toThrow(/check constraint|max_marks/);
  });

  it('marks cannot be entered before marking opens; marking needs at least one assessment', async () => {
    await expect(enter(teacher, aMath, [{ student_id: s.students[amna], marks: 50 }])).rejects.toThrow(/only be entered while the exam is in marking/);
    const empty = await exam('Empty');
    await expect(stage(empty, 'marking')).rejects.toThrow(/at least one assessment/);
    await stage(e1, 'marking');
  });

  it('a class-scoped teacher enters marks for their class only, with strict validation', async () => {
    await expect(enter(teacherOtherClass, aMath, [{ student_id: s.students[amna], marks: 50 }])).rejects.toThrow(/permission denied/);
    await expect(enter(teacher, aMath, [{ student_id: s.students[amna], marks: 101 }])).rejects.toThrow(/between 0 and 100/);
    await expect(enter(teacher, aMath, [{ student_id: s.students[amna], marks: -1 }])).rejects.toThrow(/between 0 and 100/);
    await expect(enter(teacher, aMath, [{ student_id: s.students[amna], marks: 50.555 }])).rejects.toThrow(/2 decimal/);
    await expect(enter(teacher, aMath, [{ student_id: s.students[amna], status: 'present' }])).rejects.toThrow(/marks are required/);
    await expect(enter(teacher, aMath, [{ student_id: s.students[amna], status: 'absent', marks: 5 }])).rejects.toThrow(/no marks/);
    await expect(enter(teacher, aMath, [{ student_id: other.students[0], marks: 50 }])).rejects.toThrow(/not enrolled|foreign key/);
    await expect(enter(teacher, aMath, [{ student_id: s.students[amna], status: 'sleeping' }])).rejects.toThrow(/status must be/);
    // a failed batch leaves nothing behind (one transaction)
    await expect(enter(teacher, aMath, [{ student_id: s.students[amna], marks: 95 }, { student_id: s.students[bilal], marks: 500 }])).rejects.toThrow();
    expect(n((await admin<{ n: string }>(db, `select count(*) n from public.marks where assessment_id = $1`, [aMath])).rows[0]!.n)).toBe(0);

    await enter(teacher, aMath, [{ student_id: s.students[amna], marks: 95 }, { student_id: s.students[bilal], marks: 72.5 }, { student_id: s.students[zara], marks: 38 }]);
    await enter(teacher, aEng, [{ student_id: s.students[amna], marks: 40 }, { student_id: s.students[bilal], status: 'absent' }]); // Zara's English still missing
    await enter(teacher, aMath, [{ student_id: s.students[zara], marks: 39 }]); // teacher may correct while marking is open
    expect(n((await admin<{ marks: string }>(db, `select marks from public.marks where assessment_id=$1 and student_id=$2`, [aMath, s.students[zara]])).rows[0]!.marks)).toBe(39);
    await enter(teacher, aMath, [{ student_id: s.students[zara], marks: 38 }]);
  });

  it('progress shows what is still missing, to the right people', async () => {
    const p = await q<{ subject_id: string; expected: number; entered: number }>(db, coordinator, `select * from public.marks_progress($1)`, [e1]);
    const by = Object.fromEntries(p.rows.map((r) => [r.subject_id, [r.expected, r.entered]]));
    expect(by[math]).toEqual([3, 3]);
    expect(by[english]).toEqual([3, 2]);
    expect((await q(db, teacherOtherClass, `select * from public.marks_progress($1)`, [e1])).rows).toHaveLength(0); // not their class
    expect((await q(db, s.parent, `select * from public.marks_progress($1)`, [e1])).rows).toHaveLength(0);
  });

  it('teachers cannot read marks outside their class, parents cannot read raw marks at all', async () => {
    expect(n((await q<{ n: number }>(db, teacher, `select count(*)::int n from public.marks`)).rows[0]!.n)).toBe(5);
    expect(n((await q<{ n: number }>(db, teacherOtherClass, `select count(*)::int n from public.marks`)).rows[0]!.n)).toBe(0);
    expect(n((await q<{ n: number }>(db, s.parent, `select count(*)::int n from public.marks`)).rows[0]!.n)).toBe(0);
    expect(n((await q<{ n: number }>(db, s.parent, `select count(*)::int n from public.assessments`)).rows[0]!.n)).toBe(0);
  });

  it('moderation locks teachers out; only a coordinator adjusts, with a reason, and it is recorded', async () => {
    await expect(stage(e1, 'moderation', teacher)).rejects.toThrow(/permission denied/);
    await stage(e1, 'moderation', coordinator);
    await expect(enter(teacher, aEng, [{ student_id: s.students[zara], marks: 20 }])).rejects.toThrow(/only be entered while the exam is in marking/);
    await expect(q(db, teacher, `select public.moderate_mark($1,$2,20,'present','x')`, [aEng, s.students[zara]])).rejects.toThrow(/permission denied/);
    await expect(q(db, coordinator, `select public.moderate_mark($1,$2,20,'present','  ')`, [aEng, s.students[zara]])).rejects.toThrow(/reason is required/);
    await expect(q(db, coordinator, `select public.publish_results($1)`, [e1])).rejects.toThrow(/permission denied/); // coordinator can moderate, not publish
    await expect(q(db, s.owner, `select public.publish_results($1)`, [e1])).rejects.toThrow(/1 marks are still missing/);
    await q(db, coordinator, `select public.moderate_mark($1,$2,20,'present','Paper found, was not entered')`, [aEng, s.students[zara]]);
    const am = (await admin<any>(db, `select * from public.mark_amendments where assessment_id = $1`, [aEng])).rows.map(num);
    expect(am).toHaveLength(1);
    expect(am[0]).toMatchObject({ old_marks: null, new_marks: 20, stage: 'moderation', reason: 'Paper found, was not entered' });
  });

  it('publishing freezes a correct snapshot: percentages, grades and class positions', async () => {
    expect(n((await q<{ n: number }>(db, s.owner, `select public.publish_results($1) n`, [e1])).rows[0]!.n)).toBe(3);
    const sum = Object.fromEntries((await admin<any>(db, `select student_id, total_marks, total_max, percent, grade, position from public.result_summaries where exam_id = $1`, [e1])).rows.map((r) => [r.student_id as string, num(r)]));
    expect(sum[s.students[amna]!]).toMatchObject({ total_marks: 135, total_max: 150, percent: 90, grade: 'A1', position: 1 });
    expect(sum[s.students[bilal]!]).toMatchObject({ total_marks: 72.5, percent: 48.33, grade: 'D', position: 2 }); // absent counts as 0 out of 50
    expect(sum[s.students[zara]!]).toMatchObject({ total_marks: 58, percent: 38.67, grade: 'E', position: 3 });
    const lines = (await admin<any>(db, `select subject_id, percent, grade, status from public.result_lines where exam_id=$1 and student_id=$2`, [e1, s.students[bilal]])).rows.map(num);
    expect(lines.find((l: any) => l.subject_id === english)).toMatchObject({ percent: 0, grade: 'F', status: 'absent' });
    await expect(q(db, s.owner, `select public.publish_results($1)`, [e1])).rejects.toThrow(/only be published from moderation/);
    await expect(enter(teacher, aMath, [{ student_id: s.students[amna], marks: 1 }])).rejects.toThrow(/only be entered while/);
    await expect(q(db, coordinator, `select public.moderate_mark($1,$2,1,'present','after the fact')`, [aMath, s.students[amna]])).rejects.toThrow(/only possible while the exam is in moderation/);
  });

  it('families are notified once per child', async () => {
    const o = await admin<any>(db, `select dedupe_key from public.notification_outbox where tenant_id=$1 and kind='results.published'`, [s.tenant]);
    expect(o.rows).toHaveLength(3);
  });

  it('a parent reads only their own child’s published card; staff without report-card rights cannot', async () => {
    const card = (await q<{ c: any }>(db, s.parent, `select public.report_card($1,$2) c`, [s.students[amna], e1])).rows[0]!.c;
    expect(card.student.name).toBe('Amna Khan');
    expect(card.summary).toMatchObject({ percent: 90, grade: 'A1', position: 1 });
    expect(card.lines.map((l: any) => l.subject)).toEqual(['English', 'Mathematics']);
    expect(card.scale[0]).toMatchObject({ grade: 'A1', min_percent: 80 });
    await expect(q(db, s.parent, `select public.report_card($1,$2)`, [s.students[zara], e1])).rejects.toThrow(/permission denied/); // not their child
    await expect(q(db, teacher, `select public.report_card($1,$2)`, [s.students[amna], e1])).rejects.toThrow(/permission denied/);
    expect(n((await q<{ n: number }>(db, s.parent, `select count(*)::int n from public.result_summaries`)).rows[0]!.n)).toBe(2); // Amna + Bilal (siblings), not Zara
    expect(n((await q<{ n: number }>(db, other.owner, `select count(*)::int n from public.result_summaries where tenant_id=$1`, [s.tenant])).rows[0]!.n)).toBe(0);
  });

  it('an unpublished exam shows parents nothing', async () => {
    const e = await exam('Draft one');
    expect((await q<{ c: any }>(db, s.parent, `select public.report_card($1,$2) c`, [s.students[amna], e])).rows[0]!.c).toBeNull();
  });

  it('after publication a correction needs both keys and a reason, rebuilds positions, logs, and re-notifies', async () => {
    await expect(q(db, coordinator, `select public.amend_published_mark($1,$2,30,'present','Re-marked')`, [aEng, s.students[zara]])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.owner, `select public.amend_published_mark($1,$2,30,'present',' ')`, [aEng, s.students[zara]])).rejects.toThrow(/reason is required/);
    await q(db, s.owner, `select public.amend_published_mark($1,$2,30,'present','Re-marked on appeal')`, [aEng, s.students[zara]]);
    const sum = num((await admin<any>(db, `select percent, position from public.result_summaries where exam_id=$1 and student_id=$2`, [e1, s.students[zara]])).rows[0]);
    expect(sum).toMatchObject({ percent: 45.33, position: 3 });
    expect((await admin<any>(db, `select stage, old_marks, new_marks from public.mark_amendments where stage='post_publish'`)).rows.map(num)).toEqual([{ stage: 'post_publish', old_marks: 20, new_marks: 30 }]);
    expect((await admin<any>(db, `select count(*)::int n from public.notification_outbox where tenant_id=$1 and kind='results.amended'`, [s.tenant])).rows[0].n).toBe(1);
  });

  it('changing the grading scale later does not rewrite a published card', async () => {
    await q(db, s.owner, `update public.grade_bands set grade = 'ZZ' where min_percent = 80`);
    const card = (await q<{ c: any }>(db, s.parent, `select public.report_card($1,$2) c`, [s.students[amna], e1])).rows[0]!.c;
    expect(card.summary.grade).toBe('A1');
    await expect(q(db, teacher, `update public.grade_bands set grade = 'QQ' where min_percent = 70`)).resolves.toMatchObject({ affectedRows: 0 }); // settings.manage only
  });
});

describe('excused students and ties', () => {
  it('an excused paper is left out of the totals; equal percentages share a position', async () => {
    const e = await exam('Quiz');
    const a = await assess(e, math, 100);
    await stage(e, 'marking');
    await enter(teacher, a, [{ student_id: s.students[amna], marks: 80 }, { student_id: s.students[bilal], status: 'excused' }, { student_id: s.students[zara], marks: 80 }]);
    await stage(e, 'moderation');
    await q(db, s.owner, `select public.publish_results($1)`, [e]);
    const rows = (await admin<any>(db, `select student_id, percent, position from public.result_summaries where exam_id=$1 order by position, student_id`, [e])).rows.map(num);
    expect(rows).toHaveLength(2); // Bilal has no summary: nothing to rank
    expect(rows.map((r: any) => [n(r.percent), r.position])).toEqual([[80, 1], [80, 1]]);
    const l = (await admin<any>(db, `select grade, percent, status from public.result_lines where exam_id=$1 and student_id=$2`, [e, s.students[bilal]])).rows[0];
    expect(l).toMatchObject({ grade: null, percent: null, status: 'excused' });
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

/** Bulk student import: the 'students' handler of the create → dry-run → commit → rollback framework. All names are fake. */
let db: PGlite;
let w: World;
let s: School;
let other: School;

const create = async (rows: unknown[], key: string, who = () => s.owner) =>
  (await q<{ id: string }>(db, who(), `select public.import_batch_create('students', $1::jsonb, $2) id`, [JSON.stringify(rows), key])).rows[0]!.id;
const dryRun = async (batch: string) => (await q<{ r: { valid: number; errors: number } }>(db, s.owner, `select public.import_batch_dry_run($1) r`, [batch])).rows[0]!.r;
const errorsOf = async (batch: string) =>
  Object.fromEntries((await admin<{ row_no: number; errors: string[] }>(db, `select row_no, errors from public.import_rows where batch_id = $1 order by row_no`, [batch])).rows.map((r) => [r.row_no, r.errors]));
const familyOf = async (name: string) => (await admin<{ family_id: string }>(db, `select family_id from public.students where tenant_id = $1 and full_name = $2`, [s.tenant, name])).rows[0]?.family_id;
const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(db, sql, p)).rows[0]!.n);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, '5'); // digits only: phone1 = 03005111111 (Amna + Bilal Khan)
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, '6');
});

describe('student import — dry run explains every problem', () => {
  it('flags unknown class, bad phone/date/gender, missing name, duplicates in the file and children already on file', async () => {
    const batch = await create([
      { full_name: 'Hira Malik', class: 'Grade 9', guardian_name: 'Mrs Malik', guardian_phone: '0333 1234567' },              // 1 class_unknown
      { full_name: 'Omar Malik', class: 'grade 5', guardian_name: 'Mrs Malik', guardian_phone: '12345' },                     // 2 phone_invalid
      { full_name: 'Zoya Malik', class: 'Grade 5', guardian_name: 'Mrs Malik', guardian_phone: '0333 1234567', dob: '31/02/2016' }, // 3 dob_invalid
      { full_name: 'Ali Malik', class: 'Grade 5', guardian_name: 'Mrs Malik', guardian_phone: '0333 1234567', gender: 'x' },  // 4 gender_invalid
      { full_name: '', class: 'Grade 5', guardian_name: '', guardian_phone: '0333 1234567' },                                 // 5 name + guardian
      { full_name: 'Ali Malik', class: 'Grade 5', guardian_name: 'Mrs Malik', guardian_phone: '+92 333 1234567' },            // 6 duplicate of 4
      { full_name: 'amna khan', class: 'Grade 5', guardian_name: 'Mr Khan', guardian_phone: '0300-5111111' },                 // 7 already on file
      { full_name: 'Hamza Ali', class: 'Grade 5', section: 'Z', guardian_name: 'Mr Ali', guardian_phone: '0345 7654321' },    // 8 section_unknown
    ], 'bad-sheet');
    expect(await dryRun(batch)).toEqual({ valid: 0, errors: 8 });
    const e = await errorsOf(batch);
    expect(e[1]).toEqual(['class_unknown']);
    expect(e[2]).toEqual(['phone_invalid']);
    expect(e[3]).toEqual(['dob_invalid']);
    expect(e[4]).toEqual(['gender_invalid']);
    expect(e[5]).toEqual(['name_required', 'guardian_required']);
    expect(e[6]).toEqual(['duplicate_in_file']);
    expect(e[7]).toEqual(['already_on_file']);
    expect(e[8]).toEqual(['section_unknown']);
    await expect(q(db, s.owner, `select public.import_batch_commit($1)`, [batch])).rejects.toThrow(/dry_run_failed/);
  });
});

describe('student import — commit, siblings, idempotency, rollback', () => {
  let batch: string;
  const sheet = [
    { full_name: 'Hira Malik', class: 'Grade 5', section: 'a', guardian_name: 'Mrs Malik', guardian_phone: '0333 1234567', dob: '05/06/2016', gender: 'F' },
    { full_name: 'Omar Malik', class: 'GRADE 5', guardian_name: 'Mrs Malik', guardian_phone: '+92 333 1234567', dob: '2017-01-09', gender: 'boy' },
    { full_name: 'Sara Khan', class: 'Grade 5', guardian_name: 'Mr Khan', guardian_phone: '0300-5111111' }, // joins the Khan family on file
  ];

  it('commits valid rows through enrol_student: new siblings share one family, a differently-formatted phone still finds the family on file', async () => {
    const guardiansBefore = await count(`select count(*) n from public.guardians where tenant_id = $1`, [s.tenant]);
    batch = await create(sheet, 'term-1');
    expect(await dryRun(batch)).toEqual({ valid: 3, errors: 0 });
    const r = (await q<{ r: any }>(db, s.owner, `select public.import_batch_commit($1) r`, [batch])).rows[0]!.r;
    expect(r.committed).toBe(3);

    expect(await familyOf('Hira Malik')).toBe(await familyOf('Omar Malik'));
    expect(await familyOf('Sara Khan')).toBe(await familyOf('Amna Khan'));
    // Mrs Malik is one new guardian for both children; Mr Khan was reused, not duplicated
    expect(await count(`select count(*) n from public.guardians where tenant_id = $1`, [s.tenant])).toBe(guardiansBefore + 1);
    // single-section class: the section was filled in; enrolled in the current session; dob/gender parsed
    const hira = (await admin<any>(db, `select s.dob::text, s.gender, s.admission_no, e.section_id, e.session_id from public.students s join public.student_enrolments e on e.student_id = s.id where s.full_name = 'Omar Malik' and s.tenant_id = $1`, [s.tenant])).rows[0];
    expect(hira).toMatchObject({ dob: '2017-01-09', gender: 'male', section_id: s.section, session_id: s.session });
    expect(hira.admission_no).toMatch(/\d{5}$/);
  });

  it('is idempotent: committing again changes nothing, the same key returns the same batch, and a re-sent sheet is refused as already on file', async () => {
    const n = await count(`select count(*) n from public.students where tenant_id = $1`, [s.tenant]);
    await q(db, s.owner, `select public.import_batch_commit($1)`, [batch]);
    expect(await create(sheet, 'term-1')).toBe(batch);
    const again = await create(sheet, 'term-1-resent');
    expect(await dryRun(again)).toEqual({ valid: 0, errors: 3 });
    expect(Object.values(await errorsOf(again)).every((e) => e.includes('already_on_file'))).toBe(true);
    expect(await count(`select count(*) n from public.students where tenant_id = $1`, [s.tenant])).toBe(n);
  });

  it('rollback removes the imported children and the family the import created, but keeps the family that existed before', async () => {
    const malik = await familyOf('Hira Malik');
    const khan = await familyOf('Amna Khan');
    expect(n((await q<{ n: number }>(db, s.owner, `select public.import_batch_rollback($1) n`, [batch])).rows[0]!.n)).toBe(3);
    expect(await familyOf('Sara Khan')).toBeUndefined();
    expect(await familyOf('Hira Malik')).toBeUndefined();
    expect(await count(`select count(*) n from public.families where id = $1`, [malik])).toBe(0);
    expect(await count(`select count(*) n from public.guardians where family_id = $1`, [malik])).toBe(0);
    expect(await count(`select count(*) n from public.families where id = $1`, [khan])).toBe(1);
    expect(await familyOf('Amna Khan')).toBe(khan);
    // rolling back twice is a no-op
    expect(n((await q<{ n: number }>(db, s.owner, `select public.import_batch_rollback($1) n`, [batch])).rows[0]!.n)).toBe(0);
  });
  const n = (x: unknown) => Number(x);
});

describe('student import — who may do it', () => {
  it('a teacher or a parent cannot import; another school cannot see or run this school’s batch', async () => {
    const teacher = () => w.as(ids.teacherA, w.tenantA);
    const row = [{ full_name: 'Test Child', class: 'Grade 5', guardian_name: 'Test Parent', guardian_phone: '0311 1111111' }];
    await expect(create(row, 'teacher-try', teacher)).rejects.toThrow(/permission denied/);
    await expect(create(row, 'parent-try', () => s.parent)).rejects.toThrow(/permission denied/);
    const mine = await create(row, 'owner-ok');
    await expect(q(db, other.owner, `select public.import_batch_dry_run($1)`, [mine])).rejects.toThrow(/batch not found/);
    expect((await q(db, other.owner, `select id from public.import_batches where id = $1`, [mine])).rows).toEqual([]);
  });

  it('a class with several sections needs the section column', async () => {
    await q(db, s.owner, `insert into public.sections (tenant_id, class_id, name) values ($1,$2,'B')`, [s.tenant, s.classId]);
    const b = await create([{ full_name: 'Noor Fatima', class: 'Grade 5', guardian_name: 'Mr Fatima', guardian_phone: '0312 2222222' }], 'two-sections');
    expect(await dryRun(b)).toEqual({ valid: 0, errors: 1 });
    expect((await errorsOf(b))[1]).toEqual(['section_required']);
  });
});

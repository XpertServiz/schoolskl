import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

/** The setup wizard's database side: current-session switch, progress counts, the writes the page makes, and the import's campus guard. */
let db: PGlite;
let w: World;
let s: School;
let other: School;

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, '7');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, '8');
});

const current = async (tenant: string) =>
  (await admin<{ name: string }>(db, `select name from public.academic_sessions where tenant_id = $1 and is_current`, [tenant])).rows.map((r) => r.name);

describe('set_current_session', () => {
  it('switches the current year in one step (never zero, never two)', async () => {
    const next = (await q<{ id: string }>(db, s.owner, `insert into public.academic_sessions (tenant_id, name, starts_on, ends_on) values ($1,'2027-28','2027-04-01','2028-03-31') returning id`, [s.tenant])).rows[0]!.id;
    expect(await current(s.tenant)).toEqual(['2026-27']);
    await q(db, s.owner, `select public.set_current_session($1)`, [next]);
    expect(await current(s.tenant)).toEqual(['2027-28']);
    await q(db, s.owner, `select public.set_current_session($1)`, [s.session]); // and back
    expect(await current(s.tenant)).toEqual(['2026-27']);
  });

  it('is refused for staff without settings.manage, for parents, and for another school’s year', async () => {
    await expect(q(db, s.cashier, `select public.set_current_session($1)`, [s.session])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.parent, `select public.set_current_session($1)`, [s.session])).rejects.toThrow(/permission denied/);
    await expect(q(db, other.owner, `select public.set_current_session($1)`, [s.session])).rejects.toThrow(/session not found/);
    expect(await current(s.tenant)).toEqual(['2026-27']);
    expect(await current(other.tenant)).toEqual(['2026-27']);
  });
});

describe('setup_progress', () => {
  it('counts what the school has, only for its own tenant, and only for someone who may change setup', async () => {
    const pr = (await q<{ p: any }>(db, s.owner, `select public.setup_progress() p`)).rows[0]!.p;
    expect(pr).toMatchObject({ profile: false, session: true, classes: 1, sections: 1, fees: 1, students: 3, staff: 0, timetable: 0 });
    expect(pr.campuses).toBeGreaterThanOrEqual(1);
    await expect(q(db, w.as(ids.teacherA, w.tenantA), `select public.setup_progress()`)).rejects.toThrow(/permission denied/);
    await expect(q(db, s.parent, `select public.setup_progress()`)).rejects.toThrow(/permission denied/);
  });

  it('the profile form: the owner can change name, language and public branding — never plan, status or slug', async () => {
    await q(db, s.owner, `update public.tenants set name = 'Noor Test School', locale = 'ur', branding = branding || '{"tagline":"Learning with care","phone":"042 1234567"}'::jsonb where id = $1`, [s.tenant]);
    expect((await q<{ p: any }>(db, s.owner, `select public.setup_progress() p`)).rows[0]!.p.profile).toBe(true);
    await expect(q(db, s.owner, `update public.tenants set status = 'live' where id = $1`, [s.tenant])).rejects.toThrow(/vendor-managed/);
    await expect(q(db, s.owner, `update public.tenants set slug = 'stolen' where id = $1`, [s.tenant])).rejects.toThrow(/vendor-managed/);
    // a cashier's update simply matches no row (RLS), and another school's owner cannot touch this school
    expect((await q(db, s.cashier, `update public.tenants set name = 'x' where id = $1 returning id`, [s.tenant])).rows).toEqual([]);
    expect((await q(db, other.owner, `update public.tenants set name = 'x' where id = $1 returning id`, [s.tenant])).rows).toEqual([]);
  });

  it('the classes form: owner adds classes and sections; a cashier cannot', async () => {
    const c = (await q<{ id: string }>(db, s.owner, `insert into public.classes (tenant_id, campus_id, name, level) values ($1,$2,'Class 6',6) returning id`, [s.tenant, s.campus])).rows[0]!.id;
    await q(db, s.owner, `insert into public.sections (tenant_id, class_id, name) values ($1,$2,'A'), ($1,$2,'B')`, [s.tenant, c]);
    await expect(q(db, s.cashier, `insert into public.classes (tenant_id, campus_id, name) values ($1,$2,'Class 7')`, [s.tenant, s.campus])).rejects.toThrow();
    await expect(q(db, s.owner, `insert into public.classes (tenant_id, campus_id, name) values ($1,$2,'Class 6')`, [s.tenant, s.campus])).rejects.toThrow(/duplicate|unique/);
  });
});

describe('student import refuses a class name that exists on two campuses', () => {
  it('reports class_ambiguous instead of picking a campus silently', async () => {
    const campus2 = (await q<{ id: string }>(db, s.owner, `insert into public.campuses (tenant_id, code, name) values ($1,'NORTH','North Campus') returning id`, [s.tenant])).rows[0]!.id;
    const c2 = (await q<{ id: string }>(db, s.owner, `insert into public.classes (tenant_id, campus_id, name, level) values ($1,$2,'Grade 5',5) returning id`, [s.tenant, campus2])).rows[0]!.id;
    await q(db, s.owner, `insert into public.sections (tenant_id, class_id, name) values ($1,$2,'A')`, [s.tenant, c2]);
    const batch = (await q<{ id: string }>(db, s.owner, `select public.import_batch_create('students', $1::jsonb, 'two-campuses') id`,
      [JSON.stringify([{ full_name: 'Maryam Iqbal', class: 'Grade 5', guardian_name: 'Mr Iqbal', guardian_phone: '0301 4444444' }])])).rows[0]!.id;
    expect((await q<{ r: any }>(db, s.owner, `select public.import_batch_dry_run($1) r`, [batch])).rows[0]!.r).toEqual({ valid: 0, errors: 1 });
    expect((await admin<{ errors: string[] }>(db, `select errors from public.import_rows where batch_id = $1`, [batch])).rows[0]!.errors).toEqual(['class_ambiguous']);
  });
});

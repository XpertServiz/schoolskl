import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type Claims, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

/**
 * Giving people a login (invite_member and friends). The Auth user is created by the server with the service role; everything that
 * touches the school runs as the inviting person and is checked here: users.manage (with 2FA), no escalation, owner rules, links.
 */
let db: PGlite;
let w: World;
let s: School;
let other: School;
let itAdmin: Claims;
let itAdminId: string;

const newAuthUser = async (label: string) => {
  const id = randomUUID();
  await admin(db, `insert into auth.users (id, email) values ($1, $2)`, [id, `${label}-${id.slice(0, 6)}@example.test`]);
  return id;
};
const rolesOf = async (tenant: string, user: string) =>
  (await admin<{ key: string }>(db, `select r.key from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.tenant_id = $1 and ur.user_id = $2 order by 1`, [tenant, user])).rows.map((r) => r.key);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, '3');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, '4');
  itAdminId = await newAuthUser('it');
  await admin(db, `insert into public.user_tenants (tenant_id, user_id) values ($1,$2)`, [s.tenant, itAdminId]);
  await admin(db, `insert into public.user_roles (tenant_id, user_id, role_id) select $1,$2,id from public.roles where tenant_id = $1 and key = 'it_admin'`, [s.tenant, itAdminId]);
  itAdmin = w.as(itAdminId, s.tenant);
});

describe('invite_member', () => {
  it('the owner gives a new teacher a login: membership, role, profile and active school are set in one call', async () => {
    const u = await newAuthUser('teacher');
    const r = (await q<{ r: { role: string; role_added: boolean } }>(db, s.owner, `select public.invite_member($1,'Ms Sadia','teacher') r`, [u])).rows[0]!.r;
    expect(r).toMatchObject({ role: 'teacher', role_added: true });
    expect(await rolesOf(s.tenant, u)).toEqual(['teacher']);
    const p = (await admin<{ full_name: string; active_tenant_id: string }>(db, `select full_name, active_tenant_id from public.profiles where user_id = $1`, [u])).rows[0]!;
    expect(p).toEqual({ full_name: 'Ms Sadia', active_tenant_id: s.tenant });
    // the new person really has the teacher's access now
    const teacher = w.as(u, s.tenant);
    expect((await q(db, teacher, `select id from public.students`)).rows.length).toBe(3);
    // twice is a no-op
    expect((await q<{ r: { role_added: boolean } }>(db, s.owner, `select public.invite_member($1,'Ms Sadia','teacher') r`, [u])).rows[0]!.r.role_added).toBe(false);
    expect(await rolesOf(s.tenant, u)).toEqual(['teacher']);
  });

  it('a parent login is linked to the guardian record, and then sees only that family', async () => {
    const u = await newAuthUser('mother');
    const g = (await admin<{ id: string }>(db, `select g.id from public.guardians g join public.student_guardians sg on sg.guardian_id = g.id where sg.student_id = $1`, [s.students[2]])).rows[0]!.id;
    await q(db, s.owner, `select public.invite_member($1,'Mrs Ahmed','parent',$2)`, [u, g]);
    const kids = (await q<{ full_name: string }>(db, w.as(u, s.tenant), `select full_name from public.students`)).rows.map((r) => r.full_name);
    expect(kids).toEqual(['Zara Ahmed']);
    // the same guardian cannot then be linked to somebody else
    const u2 = await newAuthUser('stranger');
    await expect(q(db, s.owner, `select public.invite_member($1,'X','parent',$2)`, [u2, g])).rejects.toThrow(/already linked/);
  });

  it('a staff login is linked to the staff record (so self check-in and the driver screen work)', async () => {
    const u = await newAuthUser('driver');
    const st = (await q<{ id: string }>(db, s.owner, `insert into public.staff_members (tenant_id, employee_no, full_name) values ($1,'D-9','Driver') returning id`, [s.tenant])).rows[0]!.id;
    await q(db, s.owner, `select public.invite_member($1,'Driver','driver',null,$2)`, [u, st]);
    expect((await admin<{ user_id: string }>(db, `select user_id from public.staff_members where id = $1`, [st])).rows[0]!.user_id).toBe(u);
  });

  it('needs users.manage WITH 2FA: a cashier, a parent and an owner at aal1 are refused', async () => {
    const u = await newAuthUser('x');
    await expect(q(db, s.cashier, `select public.invite_member($1,'X','teacher')`, [u])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.parent, `select public.invite_member($1,'X','teacher')`, [u])).rejects.toThrow(/permission denied/);
    await expect(q(db, w.as(ids.ownerA, s.tenant, { aal: 'aal1' }), `select public.invite_member($1,'X','teacher')`, [u])).rejects.toThrow(/permission denied/);
    expect(await rolesOf(s.tenant, u)).toEqual([]);
  });

  it('no escalation: an IT admin can grant a teacher role but not principal, accountant or owner', async () => {
    const u = await newAuthUser('y');
    await expect(q(db, itAdmin, `select public.invite_member($1,'Y','accountant')`, [u])).rejects.toThrow(/more access than you have/);
    await expect(q(db, itAdmin, `select public.invite_member($1,'Y','principal')`, [u])).rejects.toThrow(/more access than you have/);
    await expect(q(db, itAdmin, `select public.invite_member($1,'Y','school_owner')`, [u])).rejects.toThrow(/only a school owner/);
    // it_admin holds users.manage + settings.manage only; a role with nothing beyond that (e.g. driver: no keys) is fine
    await q(db, itAdmin, `select public.invite_member($1,'Y','driver')`, [u]);
    expect(await rolesOf(s.tenant, u)).toEqual(['driver']);
  });

  it('the owner’s access cannot be touched by a non-owner, and nobody changes their own', async () => {
    await expect(q(db, itAdmin, `select public.set_member_status($1,'suspended')`, [ids.ownerA])).rejects.toThrow(/permission denied/);
    await expect(q(db, itAdmin, `select public.remove_member_role($1,'school_owner')`, [ids.ownerA])).rejects.toThrow(/permission denied/);
    await expect(q(db, itAdmin, `select public.invite_member($1,'Owner','driver')`, [ids.ownerA])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.owner, `select public.set_member_status($1,'left')`, [ids.ownerA])).rejects.toThrow(/your own access/);
    expect(await rolesOf(s.tenant, ids.ownerA)).toContain('school_owner');
  });

  it('suspending a member cuts their access at once; reactivating restores it', async () => {
    const u = await newAuthUser('temp');
    await q(db, s.owner, `select public.invite_member($1,'Temp','teacher')`, [u]);
    const them = w.as(u, s.tenant);
    expect((await q(db, them, `select id from public.students`)).rows.length).toBe(3);
    await q(db, s.owner, `select public.set_member_status($1,'suspended')`, [u]);
    expect((await q(db, them, `select id from public.students`)).rows.length).toBe(0);
    await q(db, s.owner, `select public.set_member_status($1,'active')`, [u]);
    expect((await q(db, them, `select id from public.students`)).rows.length).toBe(3);
    await q(db, s.owner, `select public.remove_member_role($1,'teacher')`, [u]);
    expect(await rolesOf(s.tenant, u)).toEqual([]);
  });

  it('another school cannot link to this school’s records, and the member list is managers-only and per school', async () => {
    const u = await newAuthUser('z');
    const g = (await admin<{ id: string }>(db, `select id from public.guardians where tenant_id = $1 limit 1`, [s.tenant])).rows[0]!.id;
    await expect(q(db, other.owner, `select public.invite_member($1,'Z','parent',$2)`, [u, g])).rejects.toThrow(/guardian not found/);
    const list = (await q<{ email: string; roles: string[] }>(db, s.owner, `select * from public.school_members()`)).rows;
    expect(list.some((m) => m.roles.includes('school_owner'))).toBe(true);
    expect(list.some((m) => m.roles.includes('teacher'))).toBe(true);
    const otherList = (await q<{ user_id: string }>(db, other.owner, `select user_id from public.school_members()`)).rows.map((r) => r.user_id);
    expect(otherList).not.toContain(itAdminId);
    await expect(q(db, s.cashier, `select * from public.school_members()`)).rejects.toThrow(/permission denied/);
  });

  it('the email lookup is for the server only', async () => {
    await expect(q(db, s.owner, `select public.auth_user_id('x@example.test')`)).rejects.toThrow(/permission denied/);
    const r = (await q<{ id: string }>(db, null, `select public.auth_user_id($1) id`, [' ownerA@EXAMPLE.test '], 'service_role')).rows[0]!.id;
    expect(r).toBe(ids.ownerA);
  });
});

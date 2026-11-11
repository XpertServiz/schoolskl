import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

/**
 * app.current_tenant_id(): the JWT tenant_id claim is a hint. With no claim, the person's chosen school (profiles.active_tenant_id) is used —
 * but it is ALWAYS re-checked against an active membership, so a forged or stale profile row can never open another school.
 */
let db: PGlite;
let w: World;
let a: School;
let b: School;
const students = async (who: ReturnType<World['as']>) => Number((await q<{ c: string }>(db, who, `select count(*) c from public.students`)).rows[0]!.c);
const tenantOf = async (who: ReturnType<World['as']>) => (await q<{ t: string | null }>(db, who, `select app.current_tenant_id() t`)).rows[0]!.t;

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  a = await seedSchool(db, w, w.tenantA, ids.ownerA, 'f');
  b = await seedSchool(db, w, w.tenantB, ids.ownerB, 'g');
});

describe('tenant resolution without a JWT claim', () => {
  it('a member with a chosen school works with no claim (the Auth hook is optional)', async () => {
    const noClaim = w.as(ids.ownerA, null);
    expect(await tenantOf(noClaim)).toBe(w.tenantA);
    expect(await students(noClaim)).toBe(3);
    expect((await q<{ a: any }>(db, noClaim, `select public.my_access() a`)).rows[0]!.a.tenant.name).toBe('School A');
  });

  it('an explicit claim still wins over the profile (a stale profile never overrides a fresh token)', async () => {
    await q(db, w.as(ids.parentAB, null), `select public.set_active_tenant($1)`, [w.tenantA]);
    expect(await tenantOf(w.as(ids.parentAB, null))).toBe(w.tenantA);
    expect(await tenantOf(w.as(ids.parentAB, w.tenantB))).toBe(w.tenantB);
  });

  it('a profile pointing at a school the person does NOT belong to opens nothing (set directly, bypassing set_active_tenant)', async () => {
    await q(db, w.as(ids.outsider, null), `insert into public.profiles (user_id, active_tenant_id) values ($1,$2) on conflict (user_id) do update set active_tenant_id = $2`, [ids.outsider, w.tenantA]);
    const who = w.as(ids.outsider, null);
    expect(await tenantOf(who)).toBeNull();
    expect(await students(who)).toBe(0);
    expect((await q<{ a: any }>(db, who, `select public.my_access() a`)).rows[0]!.a).toBeNull();
  });

  it('losing membership closes access immediately, even though the profile still names the school', async () => {
    const who = w.as(ids.ownerB, null);
    expect(await students(who)).toBe(3);
    await admin(db, `update public.user_tenants set status = 'suspended' where tenant_id = $1 and user_id = $2`, [w.tenantB, ids.ownerB]);
    expect(await tenantOf(who)).toBeNull();
    expect(await students(who)).toBe(0);
    await admin(db, `update public.user_tenants set status = 'active' where tenant_id = $1 and user_id = $2`, [w.tenantB, ids.ownerB]);
  });

  it('a vendor user is never given a school by a profile row, even a forged one', async () => {
    await admin(db, `insert into public.profiles (user_id, active_tenant_id) values ($1,$2) on conflict (user_id) do update set active_tenant_id = $2`, [ids.vendorSupport, w.tenantA]);
    const v = w.as(ids.vendorSupport, null);
    expect(await tenantOf(v)).toBeNull();
    expect(await students(v)).toBe(0);
  });

  it('with no session at all, or a churned school, nothing resolves', async () => {
    expect((await q<{ t: string | null }>(db, null, `select app.current_tenant_id() t`)).rows[0]!.t).toBeNull();
    await admin(db, `update public.tenants set status = 'churned' where id = $1`, [w.tenantB]);
    expect(await tenantOf(w.as(ids.ownerB, null))).toBeNull();
    await admin(db, `update public.tenants set status = 'live' where id = $1`, [w.tenantB]);
  });

  it('a forged claim for a school the person is not in still resolves to nothing', async () => {
    expect(await tenantOf(w.as(ids.ownerA, w.tenantB))).toBeNull();
    expect(await students(w.as(ids.ownerA, w.tenantB))).toBe(0);
    expect(b.students).toHaveLength(3);
  });
});

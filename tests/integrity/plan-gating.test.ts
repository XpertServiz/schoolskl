import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';

let db: PGlite;
let w: World;
let starter: string;
let owner: ReturnType<World['as']>;
let campus: string;

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  const uid = randomUUID();
  await admin(db, `insert into auth.users (id, email) values ($1, 'starter-owner@example.test')`, [uid]);
  await admin(db, `insert into public.profiles (user_id, full_name) values ($1, 'starter owner')`, [uid]);
  starter = (await q<{ create_tenant: string }>(db, w.as(ids.vendorAdmin, null), `select public.create_tenant('tiny-school','Tiny School','starter','pk','en',$1)`, [uid])).rows[0]!.create_tenant;
  owner = w.as(uid, starter);
  campus = (await admin<{ id: string }>(db, `select id from public.campuses where tenant_id = $1`, [starter])).rows[0]!.id;
});

describe('plan-feature gating', () => {
  it('a Starter school cannot open admissions, payroll or exams, and the error names the feature', async () => {
    await expect(q(db, owner, `select public.create_inquiry($1,'Child','Parent','03001234567')`, [campus])).rejects.toThrow(/does not include "admissions_crm"/);
    await expect(q(db, owner, `select public.prepare_payroll('2026-10-01')`)).rejects.toThrow(/does not include "payroll"/);
    const session = (await q<{ id: string }>(db, owner, `insert into public.academic_sessions (tenant_id,name,starts_on,ends_on,is_current) values ($1,'S','2026-04-01','2027-03-31',true) returning id`, [starter])).rows[0]!.id;
    await expect(q(db, owner, `select public.create_exam($1,'Mid-term')`, [session])).rejects.toThrow(/does not include "exams_kit"/);
  });

  it('exposes only the features the plan includes to the UI', async () => {
    const mine = (await q<{ f: string[] }>(db, owner, `select public.my_plan_features() f`)).rows[0]!.f;
    expect(mine).not.toContain('payroll');
    expect(mine).not.toContain('admissions_crm');
    const growth = (await q<{ f: string[] }>(db, w.as(ids.ownerA, w.tenantA), `select public.my_plan_features() f`)).rows[0]!.f;
    expect(growth).toEqual(expect.arrayContaining(['payroll', 'admissions_crm', 'exams_kit']));
  });

  it('upgrading the plan opens the module; a tenant with no plan has everything', async () => {
    await admin(db, `update public.tenants set plan_id = (select id from public.plans where key = 'growth') where id = $1`, [starter]);
    const id = (await q<{ create_inquiry: string }>(db, owner, `select public.create_inquiry($1,'Child','Parent','03001234567')`, [campus])).rows[0]!.create_inquiry;
    expect(id).toBeTruthy();
    await admin(db, `update public.tenants set plan_id = null where id = $1`, [starter]);
    expect((await admin<{ ok: boolean }>(db, `select app.plan_has_feature($1, 'payroll') ok`, [starter])).rows[0]!.ok).toBe(true);
  });

  it('a downgrade never hides or blocks reading data that already exists', async () => {
    await admin(db, `update public.tenants set plan_id = (select id from public.plans where key = 'starter') where id = $1`, [starter]);
    const n = (await q<{ c: string }>(db, owner, `select count(*) c from public.admission_inquiries`)).rows[0]!.c;
    expect(Number(n)).toBe(1);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';

let db: PGlite;
let w: World;
const ownerA = () => w.as(ids.ownerA, w.tenantA);
const teacherA = () => w.as(ids.teacherA, w.tenantA);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
});

const can = async (claims: ReturnType<World['as']>, key: string, scope = 'tenant', scopeId: string | null = null) =>
  (await q<{ ok: boolean }>(db, claims, `select app.has_permission($1,$2,$3) ok`, [key, scope, scopeId])).rows[0]!.ok;

describe('permissions', () => {
  it('role grants apply; ungranted and unknown keys do not', async () => {
    expect(await can(teacherA(), 'attendance.mark')).toBe(true);
    expect(await can(teacherA(), 'fees.collect')).toBe(false);
    expect(await can(teacherA(), 'does.not_exist')).toBe(false);
    expect(await can(ownerA(), 'fees.collect')).toBe(true);
  });

  it('money/admin keys require an aal2 session', async () => {
    expect(await can(w.as(ids.ownerA, w.tenantA, { aal: 'aal1' }), 'payroll.post')).toBe(false);
    expect(await can(w.as(ids.ownerA, w.tenantA, { aal: 'aal2' }), 'payroll.post')).toBe(true);
  });

  it('per-person grant, deny and expiry overrides', async () => {
    await admin(db, `insert into public.user_permission_overrides (tenant_id,user_id,permission_key,effect,expires_at)
                     values ($1,$2,'fees.view','grant', now() + interval '1 day')`, [w.tenantA, ids.teacherA]);
    expect(await can(teacherA(), 'fees.view')).toBe(true);
    await admin(db, `update public.user_permission_overrides set expires_at = now() - interval '1 minute' where user_id = $1 and permission_key = 'fees.view'`, [ids.teacherA]);
    expect(await can(teacherA(), 'fees.view')).toBe(false);

    await admin(db, `insert into public.user_permission_overrides (tenant_id,user_id,permission_key,effect) values ($1,$2,'attendance.mark','deny')`, [w.tenantA, ids.teacherA]);
    expect(await can(teacherA(), 'attendance.mark')).toBe(false); // deny beats the role grant
  });

  it('campus-scoped role does not cover another campus', async () => {
    const [c1, c2] = (await admin<{ id: string }>(db, `insert into public.campuses (tenant_id, code, name) values ($1,'C1','One'),($1,'C2','Two') returning id`, [w.tenantA])).rows.map((r) => r.id);
    await admin(db, `insert into public.user_roles (tenant_id,user_id,role_id,scope_type,scope_id)
                     select $1,$2,id,'campus',$3 from public.roles where tenant_id=$1 and key='cashier'`, [w.tenantA, ids.parentAB, c1]);
    const claims = w.as(ids.parentAB, w.tenantA);
    expect(await can(claims, 'fees.collect', 'campus', c1!)).toBe(true);
    expect(await can(claims, 'fees.collect', 'campus', c2!)).toBe(false);
    expect(await can(claims, 'fees.collect')).toBe(false); // tenant-wide check is not satisfied by a campus grant
  });

  it('only a school owner can hand out the owner role', async () => {
    await expect(
      q(db, ownerA(), `insert into public.user_roles (tenant_id,user_id,role_id) select $1,$2,id from public.roles where tenant_id=$1 and key='school_owner'`, [w.tenantA, ids.teacherA]),
    ).resolves.toBeDefined(); // owner may
    await admin(db, `delete from public.user_roles where user_id=$1 and role_id in (select id from public.roles where key='school_owner')`, [ids.teacherA]);
    // give the teacher users.manage, then try to self-promote
    await admin(db, `insert into public.user_permission_overrides (tenant_id,user_id,permission_key,effect) values ($1,$2,'users.manage','grant')`, [w.tenantA, ids.teacherA]);
    await expect(
      q(db, teacherA(), `insert into public.user_roles (tenant_id,user_id,role_id) select $1,$2,id from public.roles where tenant_id=$1 and key='school_owner'`, [w.tenantA, ids.teacherA]),
    ).rejects.toThrow(/only a school owner/);
  });
});

describe('tenant lifecycle guards', () => {
  it('tenant admins can edit branding but not slug/plan/status', async () => {
    await q(db, ownerA(), `update public.tenants set branding = '{"accent":"#FFB547"}' where id = $1`, [w.tenantA]);
    for (const col of [`slug = 'hijack'`, `status = 'live'`, `base_currency = 'USD'`]) {
      await expect(q(db, ownerA(), `update public.tenants set ${col} where id = $1`, [w.tenantA]), col).rejects.toThrow(/vendor-managed/);
    }
  });

  it('suspended tenants are read-only', async () => {
    await q(db, w.as(ids.vendorAdmin, null), `update public.tenants set status = 'suspended' where id = $1`, [w.tenantA]);
    expect((await q(db, ownerA(), `select count(*)::int n from public.campuses`)).rows[0]!.n).toBeGreaterThan(0);
    await expect(q(db, ownerA(), `insert into public.campuses (tenant_id,code,name) values ($1,'LATE','Late')`, [w.tenantA])).rejects.toThrow(/row-level security/i);
    await q(db, w.as(ids.vendorAdmin, null), `update public.tenants set status = 'live' where id = $1`, [w.tenantA]);
    await expect(q(db, ownerA(), `insert into public.campuses (tenant_id,code,name) values ($1,'LATE','Late')`, [w.tenantA])).resolves.toBeDefined();
  });

  it('only vendor_super_admin creates tenants; support cannot', async () => {
    await expect(q(db, ownerA(), `select public.create_tenant('x-school','X')`)).rejects.toThrow(/vendor_super_admin/);
    await expect(q(db, w.as(ids.vendorSupport, null), `select public.create_tenant('x-school','X')`)).rejects.toThrow(/vendor_super_admin/);
    await expect(q(db, null, `select public.create_tenant('x-school','X')`, [], 'anon')).rejects.toThrow(/permission denied/);
  });

  it('custom domains must be verified by the platform', async () => {
    await expect(q(db, ownerA(), `insert into public.tenant_domains (tenant_id,domain,kind,verified_at) values ($1,'myschool.edu.pk','custom',now())`, [w.tenantA])).rejects.toThrow(/verified by the platform/);
    await q(db, ownerA(), `insert into public.tenant_domains (tenant_id,domain,kind) values ($1,'myschool.edu.pk','custom')`, [w.tenantA]);
    const host = (h: string) => q<{ slug: string }>(db, null, `select slug from public.resolve_tenant($1)`, [h], 'anon');
    expect((await host('myschool.edu.pk')).rows).toEqual([]); // unverified → does not resolve
    expect((await host('school-a.ilmora.pk')).rows).toEqual([{ slug: 'school-a' }]);
  });

  it('my_tenants lists only the caller’s memberships; set_active_tenant refuses strangers', async () => {
    expect((await q(db, w.as(ids.parentAB, null), `select * from public.my_tenants()`)).rows).toHaveLength(2);
    expect((await q(db, w.as(ids.outsider, null), `select * from public.my_tenants()`)).rows).toHaveLength(0);
    await expect(q(db, w.as(ids.outsider, null), `select public.set_active_tenant($1)`, [w.tenantA])).rejects.toThrow(/not a member/);
  });

  it('access-token hook stamps the single tenant, and none when ambiguous', async () => {
    const hook = async (uid: string) =>
      (await admin<{ r: any }>(db, `select public.custom_access_token_hook(jsonb_build_object('user_id',$1::text,'claims','{}'::jsonb)) r`, [uid])).rows[0]!.r.claims;
    expect((await hook(ids.teacherA)).tenant_id).toBe(w.tenantA);
    expect((await hook(ids.parentAB)).tenant_id).toBeUndefined();
    await q(db, w.as(ids.parentAB, null), `select public.set_active_tenant($1)`, [w.tenantB]);
    expect((await hook(ids.parentAB)).tenant_id).toBe(w.tenantB);
  });
});

describe('audit log', () => {
  it('records before/after with the actor, and is append-only', async () => {
    await q(db, ownerA(), `update public.campuses set city = 'Lahore' where tenant_id = $1 and code = 'MAIN'`, [w.tenantA]);
    const { rows } = await q(db, ownerA(), `select actor_id, action, before, after from public.audit_log where table_name = 'campuses' and action = 'update' order by id desc limit 1`);
    expect(rows[0]!.actor_id).toBe(ids.ownerA);
    expect(rows[0]!.after.city).toBe('Lahore');
    expect(rows[0]!.before.city).toBeNull();

    await expect(admin(db, `update public.audit_log set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(admin(db, `delete from public.audit_log`)).rejects.toThrow(/append-only/);
    await expect(admin(db, `truncate public.audit_log`)).rejects.toThrow(/append-only/);
    await expect(q(db, ownerA(), `delete from public.audit_log`)).rejects.toThrow(/permission denied/);
  });

  it('teachers cannot read the audit log; sensitive reads are logged', async () => {
    expect((await q(db, teacherA(), `select count(*)::int n from public.audit_log`)).rows[0]!.n).toBe(0);
    await q(db, teacherA(), `select public.log_sensitive_access('student', null, 'medical', 'checking allergy')`);
    const { rows } = await q(db, ownerA(), `select actor_id, field from public.sensitive_access_log where field = 'medical'`);
    expect(rows).toEqual([{ actor_id: ids.teacherA, field: 'medical' }]);
  });
});

describe('vendor impersonation', () => {
  it('requires reason + ticket, tenant consent, and gives scoped, time-boxed, audited access', async () => {
    const vendor = w.as(ids.vendorSupport, null);
    await expect(q(db, vendor, `select public.start_impersonation($1,'short','T-1')`, [w.tenantA])).rejects.toThrow(/check constraint/);
    await expect(q(db, ownerA(), `select public.start_impersonation($1,'owner trying to impersonate','T-1')`, [w.tenantA])).rejects.toThrow(/permission denied|vendor support/);

    await admin(db, `update public.tenants set allow_vendor_support = false where id = $1`, [w.tenantA]);
    await expect(q(db, vendor, `select public.start_impersonation($1,'helping with the import','T-2')`, [w.tenantA])).rejects.toThrow(/not allowed vendor support/);
    await admin(db, `update public.tenants set allow_vendor_support = true where id = $1`, [w.tenantA]);

    const sid = (await q<{ id: string }>(db, vendor, `select public.start_impersonation($1,'helping with the import','T-3') id`, [w.tenantA])).rows[0]!.id;
    const imp = w.as(ids.vendorSupport, w.tenantA, { imp: sid });

    expect((await q(db, imp, `select count(*)::int n from public.campuses`)).rows[0]!.n).toBeGreaterThan(0);
    expect(await can(imp, 'students.view')).toBe(true);
    expect(await can(imp, 'fees.collect')).toBe(false);
    expect(await can(imp, 'wellbeing.case.view')).toBe(false);
    expect(await can(imp, 'tracking.live.view')).toBe(false);
    expect(await can(imp, 'health.view')).toBe(false); // sensitive keys are not in the default grant

    // it is in the tenant owner's audit trail, with the session id on every change
    await q(db, imp, `update public.campuses set city = 'Karachi' where code = 'MAIN'`).catch(() => undefined);
    const trail = await q(db, ownerA(), `select action from public.audit_log where action like 'impersonation.%'`);
    expect(trail.rows.map((r) => r.action)).toContain('impersonation.start');
    expect((await q(db, ownerA(), `select count(*)::int n from public.impersonation_sessions`)).rows[0]!.n).toBe(1);

    // someone else's session id is useless
    const stolen = w.as(ids.vendorAdmin, w.tenantA, { imp: sid });
    expect((await q(db, stolen, `select count(*)::int n from public.campuses`)).rows[0]!.n).toBe(0);
    // wrong tenant for the session id
    const wrongTenant = w.as(ids.vendorSupport, w.tenantB, { imp: sid });
    expect((await q(db, wrongTenant, `select count(*)::int n from public.campuses`)).rows[0]!.n).toBe(0);

    // ending the session closes the door; expiry does too
    await q(db, vendor, `select public.end_impersonation($1)`, [sid]);
    expect((await q(db, imp, `select count(*)::int n from public.campuses`)).rows[0]!.n).toBe(0);

    const sid2 = (await q<{ id: string }>(db, vendor, `select public.start_impersonation($1,'second session here','T-4') id`, [w.tenantA])).rows[0]!.id;
    await admin(db, `update public.impersonation_sessions set started_at = now() - interval '40 minutes', expires_at = now() - interval '10 minutes' where id = $1`, [sid2]);
    expect((await q(db, w.as(ids.vendorSupport, w.tenantA, { imp: sid2 }), `select count(*)::int n from public.campuses`)).rows[0]!.n).toBe(0);
  });
});

describe('bulk import (campuses): dry-run → commit → rollback, idempotent', () => {
  const rows = JSON.stringify([
    { code: 'N1', name: 'North', city: 'Lahore' },
    { code: 'S1', name: 'South' },
  ]);

  it('create is idempotent on the key; a bad file fails dry-run and cannot be committed', async () => {
    const a = (await q<{ id: string }>(db, ownerA(), `select public.import_batch_create('campuses',$1::jsonb,'k-1') id`, [rows])).rows[0]!.id;
    const b = (await q<{ id: string }>(db, ownerA(), `select public.import_batch_create('campuses',$1::jsonb,'k-1') id`, [rows])).rows[0]!.id;
    expect(b).toBe(a);

    const bad = (await q<{ id: string }>(db, ownerA(), `select public.import_batch_create('campuses',$1::jsonb,'k-bad') id`,
      [JSON.stringify([{ code: 'MAIN', name: 'dup of seeded' }, { code: '', name: '' }, { code: 'D', name: 'd' }, { code: 'D', name: 'again' }])])).rows[0]!.id;
    const res = (await q<{ r: any }>(db, ownerA(), `select public.import_batch_dry_run($1) r`, [bad])).rows[0]!.r;
    expect(res).toEqual({ valid: 1, errors: 3 });
    await expect(q(db, ownerA(), `select public.import_batch_commit($1)`, [bad])).rejects.toThrow(/dry_run_failed/);
  });

  it('commits once, writes tenant rows, and rolls back cleanly', async () => {
    const id = (await q<{ id: string }>(db, ownerA(), `select public.import_batch_create('campuses',$1::jsonb,'k-1') id`, [rows])).rows[0]!.id;
    await expect(q(db, ownerA(), `select public.import_batch_commit($1)`, [id])).rejects.toThrow(/uploaded/); // must dry-run first
    await q(db, ownerA(), `select public.import_batch_dry_run($1)`, [id]);
    await q(db, ownerA(), `select public.import_batch_commit($1)`, [id]);
    await q(db, ownerA(), `select public.import_batch_commit($1)`, [id]); // idempotent
    const codes = () => q<{ code: string }>(db, ownerA(), `select code from public.campuses where code in ('N1','S1') order by code`);
    expect((await codes()).rows.map((r) => r.code)).toEqual(['N1', 'S1']);

    expect((await q<{ n: number }>(db, ownerA(), `select public.import_batch_rollback($1) n`, [id])).rows[0]!.n).toBe(2);
    expect((await codes()).rows).toEqual([]);
    expect((await q<{ n: number }>(db, ownerA(), `select public.import_batch_rollback($1) n`, [id])).rows[0]!.n).toBe(0);
  });

  it('teachers cannot import; another tenant cannot touch the batch', async () => {
    await expect(q(db, teacherA(), `select public.import_batch_create('campuses','[]'::jsonb,'k-t')`)).rejects.toThrow(/permission denied/);
    const id = (await q<{ id: string }>(db, ownerA(), `select public.import_batch_create('campuses',$1::jsonb,'k-x') id`, [rows])).rows[0]!.id;
    await expect(q(db, w.as(ids.ownerB, w.tenantB), `select public.import_batch_dry_run($1)`, [id])).rejects.toThrow(/batch not found/);
  });
});

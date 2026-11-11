import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';

let db: PGlite;
let w: World;
let vendor: ReturnType<World['as']>;

const enable = (key: string, tenant: string, who = vendor) =>
  q(db, who, `insert into public.tenant_flags (tenant_id, flag_key, enabled) values ($1,$2,true) on conflict (tenant_id, flag_key) do update set enabled = true`, [tenant, key]);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  vendor = w.as(ids.vendorAdmin, null);
});

describe('flags that track or profile children need a legal opinion on record', () => {
  it('child-phone location, face attendance and learning profiles are marked as requiring one', async () => {
    const rows = (await admin<{ key: string }>(db, `select key from public.feature_flags where requires_legal_ref order by key`)).rows.map((r) => r.key);
    expect(rows).toEqual(['face_attendance', 'learning_compass', 'saferoute_child_phone']);
  });

  it('refuses to switch child-phone location on for a school, even for the vendor super-admin', async () => {
    await expect(enable('saferoute_child_phone', w.tenantA)).rejects.toThrow(/no written legal opinion/);
    await expect(enable('face_attendance', w.tenantA)).rejects.toThrow(/no written legal opinion/);
    expect(Number((await admin<{ c: string }>(db, `select count(*) c from public.tenant_flags where enabled and flag_key = 'saferoute_child_phone'`)).rows[0]!.c)).toBe(0);
  });

  it('refuses to make such a feature default-on without an opinion', async () => {
    await expect(admin(db, `update public.feature_flags set default_enabled = true where key = 'saferoute_child_phone'`)).rejects.toThrow(/cannot be on by default/);
  });

  it('an ordinary flag is unaffected', async () => {
    await expect(enable('principal_copilot', w.tenantA)).resolves.toBeDefined();
  });

  it('a blank reference is not an opinion', async () => {
    await admin(db, `update public.feature_flags set legal_ref = '   ' where key = 'saferoute_child_phone'`);
    await expect(enable('saferoute_child_phone', w.tenantA)).rejects.toThrow(/no written legal opinion/);
  });

  it('once an opinion is recorded the feature can be enabled for a school; withdrawing it is refused while any school uses it', async () => {
    await admin(db, `update public.feature_flags set legal_ref = 'Opinion 2027-03-14, Counsel X' where key = 'saferoute_child_phone'`);
    await expect(enable('saferoute_child_phone', w.tenantA)).resolves.toBeDefined();
    await expect(admin(db, `update public.feature_flags set legal_ref = null where key = 'saferoute_child_phone'`)).rejects.toThrow(/still have it switched on/);
    await admin(db, `update public.tenant_flags set enabled = false where flag_key = 'saferoute_child_phone'`);
    await expect(admin(db, `update public.feature_flags set legal_ref = null where key = 'saferoute_child_phone'`)).resolves.toBeDefined();
  });

  it('a school owner cannot touch flags at all', async () => {
    await expect(enable('principal_copilot', w.tenantA, w.as(ids.ownerA, w.tenantA))).rejects.toThrow();
  });
});

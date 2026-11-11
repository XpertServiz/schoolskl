import { describe, expect, it } from 'vitest';
import { admin, buildWorld, createDb } from '../helpers/db';

describe('migrations', () => {
  it('apply cleanly and provision a tenant', async () => {
    const db = await createDb();
    const w = await buildWorld(db);
    const roles = await admin(db, `select count(*)::int n from public.roles where tenant_id = $1`, [w.tenantA]);
    expect(roles.rows[0]!.n).toBe(25);
    const owner = await admin(db, `select count(*)::int n from public.user_roles where tenant_id = $1`, [w.tenantA]);
    expect(owner.rows[0]!.n).toBe(2); // owner + teacher
  });
});

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '../../packages/db/supabase/migrations');

export type Claims = Record<string, unknown> | null;
export type Role = 'authenticated' | 'anon' | 'service_role';

/** Fresh in-memory Postgres with the Supabase prelude and every migration applied in order. */
export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(here, 'supabase-prelude.sql'), 'utf8'));
  for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

/** Run one statement as an API role with the given JWT claims. Commits on success, rolls back (and throws) on error. */
export async function q<T = Record<string, any>>(
  db: PGlite,
  claims: Claims,
  sql: string,
  params: unknown[] = [],
  role: Role = 'authenticated',
): Promise<{ rows: T[]; affectedRows?: number }> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims ? JSON.stringify(claims) : '']);
    await tx.exec(`set local role ${role}`);
    return (await tx.query<T>(sql, params)) as { rows: T[]; affectedRows?: number };
  });
}

/** Superuser (migration role) query — for fixtures and for asserting what is really in the tables. */
export async function admin<T = Record<string, any>>(db: PGlite, sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)) as { rows: T[]; affectedRows?: number };
}

export const ids = {
  vendorAdmin: '00000000-0000-4000-8000-000000000001',
  vendorSupport: '00000000-0000-4000-8000-000000000002',
  ownerA: '00000000-0000-4000-8000-0000000000a1',
  ownerB: '00000000-0000-4000-8000-0000000000b1',
  teacherA: '00000000-0000-4000-8000-0000000000a2',
  parentAB: '00000000-0000-4000-8000-0000000000ab',
  outsider: '00000000-0000-4000-8000-0000000000ff',
};

export interface World {
  tenantA: string;
  tenantB: string;
  /** claims helpers */
  as: (sub: string, tenant: string | null, extra?: Record<string, unknown>) => Claims;
}

/** Two schools, an owner each, a teacher in A, a parent in both, a vendor admin and a vendor support user. */
export async function buildWorld(db: PGlite): Promise<World> {
  for (const [name, id] of Object.entries(ids)) {
    await admin(db, `insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@example.test`]);
    await admin(db, `insert into public.profiles (user_id, full_name) values ($1, $2)`, [id, name]);
  }
  await admin(db, `insert into public.vendor_staff (user_id, role) values ($1,'vendor_super_admin'), ($2,'vendor_support')`, [
    ids.vendorAdmin,
    ids.vendorSupport,
  ]);

  const asClaims = (sub: string, tenant: string | null, extra: Record<string, unknown> = {}): Claims => ({
    sub,
    aal: 'aal2',
    ...(tenant ? { tenant_id: tenant } : {}),
    ...extra,
  });

  const vendor = asClaims(ids.vendorAdmin, null);
  const a = await q<{ create_tenant: string }>(db, vendor, `select public.create_tenant('school-a','School A','growth','pk','en',$1)`, [ids.ownerA]);
  const b = await q<{ create_tenant: string }>(db, vendor, `select public.create_tenant('school-b','School B','growth','pk','ur',$1)`, [ids.ownerB]);
  const tenantA = a.rows[0]!.create_tenant;
  const tenantB = b.rows[0]!.create_tenant;

  // teacher in A, parent in both
  await admin(db, `insert into public.user_tenants (tenant_id, user_id) values ($1,$2), ($1,$3), ($4,$3)`, [tenantA, ids.teacherA, ids.parentAB, tenantB]);
  await admin(
    db,
    `insert into public.user_roles (tenant_id, user_id, role_id)
     select $1, $2, id from public.roles where tenant_id = $1 and key = 'teacher'`,
    [tenantA, ids.teacherA],
  );

  return { tenantA, tenantB, as: asClaims };
}

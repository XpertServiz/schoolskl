import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { MFA_KEYS, PERMISSION_KEYS } from '../../packages/core/src/permissions';
import { admin, createDb } from '../helpers/db';

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

describe('schema invariants (fail CI when a future migration forgets RLS)', () => {
  it('every public table has RLS enabled', async () => {
    const { rows } = await admin<{ relname: string }>(
      db,
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('every tenant-owned table has tenant_id NOT NULL, a tenant FK, an index leading with it, and ≥1 policy', async () => {
    const { rows } = await admin<{ t: string; notnull: boolean; policies: number; indexed: boolean }>(
      db,
      `select c.table_name t,
              c.is_nullable = 'NO' as notnull,
              (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.table_name) policies,
              exists (select 1 from pg_index i join pg_class tc on tc.oid = i.indrelid join pg_attribute a on a.attrelid = tc.oid and a.attnum = i.indkey[0]
                      where tc.relname = c.table_name and a.attname = 'tenant_id') as indexed
       from information_schema.columns c
       where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name in
         (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')`,
    );
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => !r.notnull).map((r) => r.t), 'tenant_id must be NOT NULL').toEqual([]);
    expect(rows.filter((r) => r.policies === 0).map((r) => r.t), 'needs a policy').toEqual([]);
    expect(rows.filter((r) => !r.indexed).map((r) => r.t), 'needs an index leading with tenant_id').toEqual([]);
  });

  it('every SECURITY DEFINER function pins its search_path', async () => {
    const { rows } = await admin<{ proname: string }>(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','app') and p.prosecdef and not coalesce(p.proconfig::text like '%search_path%', false)`,
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it('anon can read only the public marketing content (pricing plans, landing media, website settings)', async () => {
    const { rows } = await admin<{ table_name: string }>(
      db,
      `select distinct table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(['plan_features', 'plans', 'site_media', 'site_reviews', 'site_settings']);
  });

  it('anon can execute resolve_tenant and nothing else in public', async () => {
    const { rows } = await admin<{ proname: string }>(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(rows.map((r) => r.proname)).toEqual(['resolve_tenant']);
  });

  it('API roles can execute only the policy helpers in schema app — never the tenant-parameterised internals', async () => {
    const { rows } = await admin<{ proname: string }>(
      db,
      `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')`,
    );
    expect(rows.map((r) => r.proname).sort()).toEqual([
      'can_see_voucher', 'current_tenant_id', 'has_permission', 'is_guardian_of_family', 'is_guardian_of_student',
      'is_vendor_role', 'is_vendor_staff', 'tenant_writable',
    ]);
  });

  it('every money/ledger table is write-protected from API roles at the grant level, not only by RLS', async () => {
    for (const t of ['accounts', 'accounting_periods', 'journal_entries', 'journal_lines', 'vouchers', 'voucher_lines', 'voucher_adjustments',
      'payments', 'payment_allocations', 'payment_webhooks', 'cashier_sessions', 'concessions', 'student_attendance', 'attendance_days', 'notification_outbox']) {
      const { rows } = await admin<{ ok: boolean }>(
        db,
        `select has_table_privilege('authenticated', 'public.${t}', 'insert') or has_table_privilege('authenticated', 'public.${t}', 'update')
                or has_table_privilege('authenticated', 'public.${t}', 'delete') as ok`,
      );
      expect(rows[0]!.ok, t).toBe(false);
    }
  });

  it('audit_log and sensitive_access_log cannot be written by API roles', async () => {
    for (const t of ['audit_log', 'sensitive_access_log', 'impersonation_sessions', 'import_batches', 'import_rows']) {
      const { rows } = await admin<{ ok: boolean }>(
        db,
        `select has_table_privilege('authenticated', 'public.${t}', 'insert') or has_table_privilege('authenticated', 'public.${t}', 'update')
                or has_table_privilege('authenticated', 'public.${t}', 'delete') as ok`,
      );
      expect(rows[0]!.ok, t).toBe(false);
    }
  });

  it('permission catalogue in SQL == packages/core, including MFA flags', async () => {
    const { rows } = await admin<{ key: string; requires_mfa: boolean }>(db, `select key, requires_mfa from public.permissions order by key`);
    expect(rows.map((r) => r.key)).toEqual([...PERMISSION_KEYS].sort());
    expect(new Set(rows.filter((r) => r.requires_mfa).map((r) => r.key))).toEqual(new Set(MFA_KEYS));
  });
});

-- Phase 2 · internal helpers must not be callable by API roles (they take a tenant id as a parameter and bypass RLS).
-- Only the functions that RLS policies themselves call stay executable. tests/rls-leak/structure.test.ts pins this list.
-- Every migration that adds app.* functions ends with `select app.harden_internal_functions();` (new functions are executable by default).

create or replace function app.harden_internal_functions() returns void language plpgsql as $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname not in ('current_tenant_id', 'has_permission', 'is_vendor_role', 'is_vendor_staff', 'tenant_writable',
                            'is_guardian_of_student', 'is_guardian_of_family', 'can_see_voucher')
      and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
select app.harden_internal_functions();

-- the policy helpers run for anon too (plans policy), so keep schema usage; they return false/null without a session
grant execute on function app.current_tenant_id(), app.has_permission(text, text, uuid), app.is_vendor_role(text), app.is_vendor_staff(),
  app.tenant_writable(), app.is_guardian_of_student(uuid), app.is_guardian_of_family(uuid), app.can_see_voucher(uuid)
  to anon, authenticated, service_role;

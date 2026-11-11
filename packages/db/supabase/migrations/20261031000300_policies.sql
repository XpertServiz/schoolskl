-- Phase 1 · RLS on EVERY table (CLAUDE.md rule 1), triggers, grants.
-- tests/rls-leak enumerates information_schema, so a table added later without RLS fails CI.

-- ---------------------------------------------------------------- vendor-only / global catalogue tables
alter table public.vendor_staff enable row level security;
create policy vendor_staff_select on public.vendor_staff for select to authenticated
  using (user_id = auth.uid() or (select app.is_vendor_role('vendor_super_admin')));

alter table public.organisations enable row level security;
create policy organisations_vendor on public.organisations for select to authenticated using ((select app.is_vendor_staff()));
create policy organisations_vendor_write on public.organisations for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

alter table public.plans enable row level security;
create policy plans_read on public.plans for select to anon, authenticated using (is_public or (select app.is_vendor_staff()));
create policy plans_write on public.plans for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

alter table public.plan_features enable row level security;
create policy plan_features_read on public.plan_features for select to anon, authenticated using (true);
create policy plan_features_write on public.plan_features for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

alter table public.feature_flags enable row level security;
create policy feature_flags_read on public.feature_flags for select to authenticated using (true);
create policy feature_flags_write on public.feature_flags for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

alter table public.permissions enable row level security;
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy permissions_write on public.permissions for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

alter table public.role_templates enable row level security;
create policy role_templates_read on public.role_templates for select to authenticated using (true);
create policy role_templates_write on public.role_templates for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

alter table public.role_template_permissions enable row level security;
create policy role_template_permissions_read on public.role_template_permissions for select to authenticated using (true);
create policy role_template_permissions_write on public.role_template_permissions for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

-- ---------------------------------------------------------------- tenants
alter table public.tenants enable row level security;
create policy tenants_select on public.tenants for select to authenticated
  using (id = (select app.current_tenant_id()) or (select app.is_vendor_staff()));
create policy tenants_update_own on public.tenants for update to authenticated
  using (id = (select app.current_tenant_id()) and (select app.has_permission('settings.manage')) and (select app.tenant_writable()))
  with check (id = (select app.current_tenant_id()));
create policy tenants_vendor_write on public.tenants for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

create trigger touch_row before insert or update on public.tenants for each row execute function app.touch_row();
create trigger guard_update before update on public.tenants for each row execute function app.guard_tenant_update();
-- tenants are never hard-deleted (churn → export → scheduled purge job), so no DELETE audit: it would FK-fail against the vanishing row
create trigger audit_row after insert or update on public.tenants for each row execute function app.audit_row();
create trigger touch_row before insert or update on public.organisations for each row execute function app.touch_row();
create trigger touch_row before insert or update on public.plans for each row execute function app.touch_row();
create trigger touch_row before insert or update on public.profiles for each row execute function app.touch_row();

-- ---------------------------------------------------------------- tenant-owned tables (policy factory)
select app.secure_tenant_table('public.tenant_domains', 'settings.manage');
select app.secure_tenant_table('public.campuses',       'settings.manage');
select app.secure_tenant_table('public.roles',          'roles.manage');
select app.secure_tenant_table('public.role_permissions', 'roles.manage');
select app.secure_tenant_table('public.audit_log',      '-', 'audit.view');
select app.secure_tenant_table('public.sensitive_access_log', '-', 'audit.view');
select app.secure_tenant_table('public.impersonation_sessions', '-', 'audit.view');
select app.secure_tenant_table('public.import_batches', '-', 'data.import');
select app.secure_tenant_table('public.import_rows',    '-', 'data.import');

-- system roles cannot be deleted or renamed away from their key
alter policy tenant_delete on public.roles using (
  tenant_id = (select app.current_tenant_id()) and not is_system
  and (select app.has_permission('roles.manage')) and (select app.tenant_writable()));

-- tenant_flags: tenant reads its own, platform writes
select app.secure_tenant_table('public.tenant_flags', '-');
drop policy tenant_select on public.tenant_flags;
create policy tenant_select on public.tenant_flags for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) or (select app.is_vendor_staff()));
create policy flags_vendor_write on public.tenant_flags for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

-- vendor staff may list impersonation sessions across tenants (the tenant owner sees theirs via tenant_select)
create policy impersonation_vendor_read on public.impersonation_sessions for select to authenticated
  using ((select app.is_vendor_staff()));

-- identity tables: a person sees their own rows; managers see the tenant's
select app.secure_tenant_table('public.user_tenants', 'users.manage');
alter policy tenant_select on public.user_tenants using (
  tenant_id = (select app.current_tenant_id()) and (user_id = auth.uid() or (select app.has_permission('users.manage'))));

select app.secure_tenant_table('public.user_roles', 'users.manage');
alter policy tenant_select on public.user_roles using (
  tenant_id = (select app.current_tenant_id()) and (user_id = auth.uid() or (select app.has_permission('users.manage'))));

select app.secure_tenant_table('public.user_permission_overrides', 'users.manage');
alter policy tenant_select on public.user_permission_overrides using (
  tenant_id = (select app.current_tenant_id()) and (user_id = auth.uid() or (select app.has_permission('users.manage'))));

alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (user_id = auth.uid());
create policy profiles_managers on public.profiles for select to authenticated using (
  (select app.has_permission('users.manage'))
  and exists (select 1 from public.user_tenants ut
              where ut.user_id = profiles.user_id and ut.tenant_id = (select app.current_tenant_id())));
create policy profiles_insert_self on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- triggers on tenant-owned tables
select app.attach_standard_triggers('public.tenant_domains');
select app.attach_standard_triggers('public.campuses');
select app.attach_standard_triggers('public.roles');
select app.attach_standard_triggers('public.role_permissions');
select app.attach_standard_triggers('public.user_tenants');
select app.attach_standard_triggers('public.user_roles');
select app.attach_standard_triggers('public.user_permission_overrides');
select app.attach_standard_triggers('public.tenant_flags');
select app.attach_standard_triggers('public.import_batches');
select app.attach_standard_triggers('public.import_rows', false); -- row-level churn would drown the audit log
select app.attach_standard_triggers('public.impersonation_sessions', false); -- audited explicitly by the RPCs
select app.attach_standard_triggers('public.audit_log', false);
select app.attach_standard_triggers('public.sensitive_access_log', false);

create trigger guard_domain before insert or update on public.tenant_domains for each row execute function app.guard_domain_verification();
create trigger guard_owner before insert or update on public.user_roles for each row execute function app.guard_owner_role();

create trigger audit_log_append_only before update or delete on public.audit_log for each row execute function app.deny_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function app.deny_mutation();
create trigger sensitive_log_append_only before update or delete on public.sensitive_access_log for each row execute function app.deny_mutation();

-- ---------------------------------------------------------------- grants
-- RLS is the gate; table grants are the seatbelt. anon gets only the public pricing catalogue.
revoke all on all tables in schema public from anon;
grant select on public.plans, public.plan_features to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on public.audit_log, public.sensitive_access_log, public.impersonation_sessions,
  public.import_batches, public.import_rows, public.vendor_staff from authenticated;

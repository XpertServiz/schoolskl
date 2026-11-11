-- Speed: my_access() runs on every portal and app screen. It used to call app.has_permission() once per permission (53 × several
-- lookups ≈ 60 ms). app.my_permission_keys() computes the same set in one query. The rules are exactly has_permission's for the tenant
-- scope: MFA-gated keys only at aal2; a deny override beats everything; a grant override or a (non-expired, tenant-wide) role grants.
-- An impersonation session keeps the old per-key path (it has its own rules). A test pins the two to be identical for every test role.
create or replace function app.my_permission_keys() returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); u uuid := auth.uid(); aal2 boolean := coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
begin
  if t is null or u is null then return '{}'; end if;
  if nullif(auth.jwt() ->> 'imp', '') is not null then
    return coalesce((select array_agg(p.key order by p.key) from public.permissions p where app.has_permission(p.key)), '{}');
  end if;
  return coalesce((
    select array_agg(p.key order by p.key) from public.permissions p
    where (not p.requires_mfa or aal2)
      and not exists (select 1 from public.user_permission_overrides o
                      where o.tenant_id = t and o.user_id = u and o.permission_key = p.key and o.effect = 'deny'
                        and (o.expires_at is null or o.expires_at > now()) and o.scope_type = 'tenant')
      and (exists (select 1 from public.user_permission_overrides o
                   where o.tenant_id = t and o.user_id = u and o.permission_key = p.key and o.effect = 'grant'
                     and (o.expires_at is null or o.expires_at > now()) and o.scope_type = 'tenant')
           or exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.tenant_id = ur.tenant_id and rp.role_id = ur.role_id
                      where ur.tenant_id = t and ur.user_id = u and rp.permission_key = p.key
                        and (ur.expires_at is null or ur.expires_at > now()) and ur.scope_type = 'tenant'))
  ), '{}');
end $$;

create or replace function public.my_access() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); r jsonb;
begin
  if t is null then return null; end if;
  select jsonb_build_object(
    'tenant', jsonb_build_object('id', tn.id, 'name', tn.name, 'status', tn.status, 'locale', tn.locale, 'currency', tn.base_currency, 'timezone', tn.timezone),
    'permissions', to_jsonb(app.my_permission_keys()),
    'features', to_jsonb(public.my_plan_features()),
    'flags', coalesce((select jsonb_agg(f.key order by f.key) from public.feature_flags f where app.tenant_flag_on(t, f.key)), '[]'::jsonb),
    'is_guardian', exists (select 1 from public.guardians g where g.tenant_id = t and g.user_id = auth.uid()),
    'is_crew', exists (select 1 from public.transport_routes r join public.staff_members s on s.tenant_id = r.tenant_id and s.id in (r.driver_staff_id, r.attendant_staff_id)
                       where r.tenant_id = t and r.is_active and s.user_id = auth.uid() and s.status = 'active')
  ) into r from public.tenants tn where tn.id = t;
  return r;
end $$;

select app.harden_internal_functions();

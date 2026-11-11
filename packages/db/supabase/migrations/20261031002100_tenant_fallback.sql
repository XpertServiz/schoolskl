-- The Auth hook (custom_access_token_hook) stamps tenant_id into the JWT, but it is a dashboard setting a deployment can forget, and a
-- person who just switched school has the OLD claim until their token refreshes. Make the claim a hint, not a requirement:
-- when the session carries no tenant_id, use the school the person chose (profiles.active_tenant_id, written only by set_active_tenant).
-- Nothing else changes: whichever school we end up with is STILL checked against an active membership on every request, so a profile row that
-- names a school the person does not belong to (or no longer belongs to) yields NULL, exactly as a forged claim does.
-- Impersonation keeps requiring its explicit `imp` claim: a vendor user never gets a tenant from a profile.
create or replace function app.current_tenant_id() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t   uuid := nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
  imp uuid := nullif(auth.jwt() ->> 'imp', '')::uuid;
  u   uuid := auth.uid();
begin
  if u is null then return null; end if;

  if t is null and imp is null then
    select p.active_tenant_id into t from public.profiles p where p.user_id = u;
  end if;
  if t is null then return null; end if;

  if imp is not null then
    if exists (
      select 1 from public.impersonation_sessions s
      where s.id = imp and s.tenant_id = t and s.vendor_user_id = u
        and s.ended_at is null and s.expires_at > now()
    ) then return t; end if;
    return null;
  end if;

  if exists (
    select 1 from public.user_tenants ut
    join public.tenants tn on tn.id = ut.tenant_id
    where ut.user_id = u and ut.tenant_id = t and ut.status = 'active' and tn.status <> 'churned'
  ) then return t; end if;
  return null;
end $$;

select app.harden_internal_functions();

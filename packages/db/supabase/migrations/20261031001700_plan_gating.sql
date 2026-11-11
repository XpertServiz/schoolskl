-- Phase 2/3 follow-up · plan-feature gating.
-- A tenant may only create rows for a module its plan includes. Enforced by a trigger on the module's root table so every write path
-- (RPC, direct insert, import) is covered; reading and finishing existing rows is never blocked (downgrading must not trap data).

-- DECISION: a tenant with no plan (plan_id NULL, vendor-managed/demo) has every feature; a plan with no row for a key does not.
create or replace function app.plan_has_feature(p_tenant uuid, p_key text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select case when t.plan_id is null then true
                 else coalesce((select pf.enabled from public.plan_features pf where pf.plan_id = t.plan_id and pf.feature_key = p_key), false) end
     from public.tenants t where t.id = p_tenant),
    false)
$$;

create or replace function app.require_plan_feature() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.plan_has_feature(new.tenant_id, tg_argv[0]) then
    raise exception 'your plan does not include "%"', tg_argv[0] using errcode = '42501', hint = 'plan_feature_disabled';
  end if;
  return new;
end $$;

create trigger admission_inquiries_plan before insert on public.admission_inquiries
  for each row execute function app.require_plan_feature('admissions_crm');
create trigger payroll_runs_plan before insert on public.payroll_runs
  for each row execute function app.require_plan_feature('payroll');
create trigger exams_plan before insert on public.exams
  for each row execute function app.require_plan_feature('exams_kit');

-- What the UI needs to hide a menu entry: the features this tenant's plan includes.
create or replace function public.my_plan_features() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(pf.feature_key order by pf.feature_key), '{}')
  from public.tenants t join public.plan_features pf on pf.plan_id = t.plan_id and pf.enabled
  where t.id = app.current_tenant_id() and t.plan_id is not null
$$;
revoke all on function public.my_plan_features() from public, anon;
grant execute on function public.my_plan_features() to authenticated;

select app.harden_internal_functions();
select app.apply_grants();

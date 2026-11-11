-- Phase 1 · RPCs. All SECURITY DEFINER with an explicit tenant/permission check inside; none are executable by anon
-- except resolve_tenant (public branding only).

-- ---------------------------------------------------------------- tenant provisioning
create or replace function public.provision_tenant_defaults(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.roles (tenant_id, key, name, description, is_system)
  select p_tenant, rt.key, rt.name, rt.description, true from public.role_templates rt
  on conflict (tenant_id, key) do nothing;

  insert into public.role_permissions (tenant_id, role_id, permission_key)
  select p_tenant, r.id, rtp.permission_key
  from public.role_template_permissions rtp
  join public.roles r on r.tenant_id = p_tenant and r.key = rtp.role_key
  on conflict do nothing;

  insert into public.campuses (tenant_id, code, name) values (p_tenant, 'MAIN', 'Main Campus')
  on conflict (tenant_id, code) do nothing;
end $$;

create or replace function public.create_tenant(
  p_slug text, p_name text, p_plan_key text default 'starter', p_region text default 'pk',
  p_locale text default 'en', p_admin_user_id uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
  v_root   text := coalesce(nullif(current_setting('app.root_domain', true), ''), 'ilmora.pk');
  v_owner  uuid;
begin
  if not app.is_vendor_role('vendor_super_admin') then
    raise exception 'only vendor_super_admin can create tenants' using errcode = '42501';
  end if;

  insert into public.tenants (slug, name, plan_id, region, locale, status)
  values (lower(p_slug), p_name, (select id from public.plans where key = p_plan_key), p_region, p_locale, 'onboarding')
  returning id into v_tenant;

  insert into public.tenant_domains (tenant_id, domain, kind, is_primary, verified_at)
  values (v_tenant, lower(p_slug) || '.' || v_root, 'subdomain', true, now());

  perform public.provision_tenant_defaults(v_tenant);

  if p_admin_user_id is not null then
    insert into public.user_tenants (tenant_id, user_id, status) values (v_tenant, p_admin_user_id, 'active');
    select id into v_owner from public.roles where tenant_id = v_tenant and key = 'school_owner';
    insert into public.user_roles (tenant_id, user_id, role_id) values (v_tenant, p_admin_user_id, v_owner);
    update public.profiles set active_tenant_id = v_tenant where user_id = p_admin_user_id and active_tenant_id is null;
  end if;
  return v_tenant;
end $$;

-- ---------------------------------------------------------------- tenant resolution / switching
-- Public: only what a login page needs to brand itself. Unverified custom domains never resolve.
create or replace function public.resolve_tenant(p_host text)
returns table (tenant_id uuid, slug text, name text, branding jsonb, locale text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.slug, t.name, t.branding, t.locale
  from public.tenant_domains d join public.tenants t on t.id = d.tenant_id
  where d.domain = lower(p_host) and d.verified_at is not null and t.status <> 'churned'
$$;

create or replace function public.my_tenants()
returns table (tenant_id uuid, slug text, name text, branding jsonb, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.slug, t.name, t.branding, t.status
  from public.user_tenants ut join public.tenants t on t.id = ut.tenant_id
  where ut.user_id = auth.uid() and ut.status = 'active' and t.status <> 'churned'
  order by t.name
$$;

create or replace function public.set_active_tenant(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = p_tenant and status = 'active') then
    raise exception 'not a member of that tenant' using errcode = '42501';
  end if;
  insert into public.profiles (user_id, active_tenant_id) values (auth.uid(), p_tenant)
  on conflict (user_id) do update set active_tenant_id = excluded.active_tenant_id;
end $$;

-- Supabase Auth "custom access token" hook: stamps tenant_id into the JWT. The DB re-verifies membership on every
-- request (app.current_tenant_id), so a stale or forged claim is harmless.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := (event ->> 'user_id')::uuid;
  claims jsonb := event -> 'claims';
  v_tid  uuid;
  n      int;
begin
  select p.active_tenant_id into v_tid from public.profiles p
  where p.user_id = uid
    and exists (select 1 from public.user_tenants ut where ut.user_id = uid and ut.tenant_id = p.active_tenant_id and ut.status = 'active');
  if v_tid is null then
    select count(*), min(tenant_id::text)::uuid into n, v_tid from public.user_tenants where user_id = uid and status = 'active';
    if n <> 1 then v_tid := null; end if; -- several schools → the tenant picker decides
  end if;
  if v_tid is not null then claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tid::text)); end if;
  return jsonb_set(event, '{claims}', claims);
end $$;

-- ---------------------------------------------------------------- impersonation (vendor "log in as support")
create or replace function public.start_impersonation(
  p_tenant uuid, p_reason text, p_ticket text, p_minutes int default 30, p_permission_keys text[] default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id   uuid;
  v_keys text[];
begin
  if not (app.is_vendor_role('vendor_super_admin') or app.is_vendor_role('vendor_support')) then
    raise exception 'vendor support access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant and allow_vendor_support and status <> 'churned') then
    raise exception 'tenant has not allowed vendor support access' using errcode = '42501';
  end if;
  -- default grant: read everything + help with setup/imports. Money, location and counsellor keys are blocked in has_permission regardless.
  v_keys := coalesce(p_permission_keys,
    (select array_agg(key) from public.permissions where (key like '%.view' and not sensitive) or key in ('settings.manage', 'data.import')));

  insert into public.impersonation_sessions (tenant_id, vendor_user_id, reason, ticket_ref, permission_keys, expires_at)
  values (p_tenant, auth.uid(), p_reason, p_ticket, coalesce(v_keys, '{}'), now() + make_interval(mins => least(greatest(p_minutes, 1), 30)))
  returning id into v_id;

  insert into public.audit_log (tenant_id, actor_id, impersonation_session_id, action, table_name, record_id, after)
  values (p_tenant, auth.uid(), v_id, 'impersonation.start', 'impersonation_sessions', v_id::text,
          jsonb_build_object('reason', p_reason, 'ticket', p_ticket));
  return v_id;
end $$;

create or replace function public.end_impersonation(p_session uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid;
begin
  update public.impersonation_sessions set ended_at = now()
  where id = p_session and vendor_user_id = auth.uid() and ended_at is null returning tenant_id into v_tenant;
  if v_tenant is not null then
    insert into public.audit_log (tenant_id, actor_id, impersonation_session_id, action, table_name, record_id)
    values (v_tenant, auth.uid(), p_session, 'impersonation.end', 'impersonation_sessions', p_session::text);
  end if;
end $$;

-- ---------------------------------------------------------------- sensitive reads
create or replace function public.log_sensitive_access(p_subject_type text, p_subject_id uuid, p_field text, p_purpose text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null then raise exception 'no tenant context' using errcode = '42501'; end if;
  insert into public.sensitive_access_log (tenant_id, actor_id, subject_type, subject_id, field, purpose)
  values (t, auth.uid(), p_subject_type, p_subject_id, p_field, p_purpose);
end $$;

-- ---------------------------------------------------------------- bulk import: create → dry run → commit → rollback
-- Handlers are per entity: app.import_validate_<entity>(batch uuid) and app.import_apply_<entity>(batch uuid).
create or replace function public.import_batch_create(p_entity text, p_rows jsonb, p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t uuid := app.current_tenant_id();
  v_id uuid;
begin
  if t is null or not app.has_permission('data.import') or not app.tenant_writable() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_entity !~ '^[a-z_]+$' or to_regprocedure(format('app.import_validate_%s(uuid)', p_entity)) is null then
    raise exception 'unknown import entity %', p_entity;
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;

  select id into v_id from public.import_batches where tenant_id = t and idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if; -- idempotent: same key → same batch

  insert into public.import_batches (tenant_id, entity, idempotency_key) values (t, p_entity, p_idempotency_key) returning id into v_id;
  insert into public.import_rows (tenant_id, batch_id, row_no, raw)
  select t, v_id, ord::int, elem from jsonb_array_elements(p_rows) with ordinality as x(elem, ord);
  return v_id;
end $$;

create or replace function app.import_load_batch(p_batch uuid, p_allowed text[]) returns public.import_batches
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.import_batches;
begin
  if app.current_tenant_id() is null or not app.has_permission('data.import') or not app.tenant_writable() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into b from public.import_batches where id = p_batch and tenant_id = app.current_tenant_id() for update;
  if not found then raise exception 'batch not found' using errcode = '42501'; end if;
  if not (b.status = any (p_allowed)) then raise exception 'batch is % — expected one of %', b.status, p_allowed; end if;
  return b;
end $$;

create or replace function public.import_batch_dry_run(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.import_batches; v_valid int; v_err int;
begin
  b := app.import_load_batch(p_batch, array['uploaded', 'dry_run_ok', 'dry_run_failed']);
  update public.import_rows set status = 'pending', errors = '[]'::jsonb where batch_id = b.id;
  execute format('select app.import_validate_%s($1)', b.entity) using b.id;
  select count(*) filter (where status = 'valid'), count(*) filter (where status = 'error') into v_valid, v_err
  from public.import_rows where batch_id = b.id;
  update public.import_batches
     set status = case when v_err = 0 and v_valid > 0 then 'dry_run_ok' else 'dry_run_failed' end,
         summary = jsonb_build_object('valid', v_valid, 'errors', v_err)
   where id = b.id;
  return jsonb_build_object('valid', v_valid, 'errors', v_err);
end $$;

create or replace function public.import_batch_commit(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.import_batches; v_n int;
begin
  b := app.import_load_batch(p_batch, array['dry_run_ok', 'committed']);
  if b.status = 'committed' then return b.summary; end if; -- idempotent
  execute format('select app.import_apply_%s($1)', b.entity) using b.id;
  select count(*) into v_n from public.import_rows where batch_id = b.id and status = 'committed';
  update public.import_batches set status = 'committed', committed_at = now(),
         summary = b.summary || jsonb_build_object('committed', v_n) where id = b.id returning summary into b.summary;
  insert into public.audit_log (tenant_id, actor_id, action, table_name, record_id, after)
  values (b.tenant_id, auth.uid(), 'import.commit', 'import_batches', b.id::text, jsonb_build_object('entity', b.entity, 'rows', v_n));
  return b.summary;
end $$;

create or replace function public.import_batch_rollback(p_batch uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.import_batches; r record; v_n int := 0;
begin
  b := app.import_load_batch(p_batch, array['committed', 'rolled_back']);
  if b.status = 'rolled_back' then return 0; end if; -- idempotent
  for r in select * from public.import_rows where batch_id = b.id and status = 'committed' order by row_no desc loop
    -- target_table is only ever written by our own apply handlers, but re-check: tenant-owned table, tenant-scoped delete
    if r.target_table is null or r.target_table !~ '^[a-z_]+$' or not exists (
         select 1 from information_schema.columns where table_schema = 'public' and table_name = r.target_table and column_name = 'tenant_id') then
      raise exception 'row % has an unsafe rollback target', r.row_no;
    end if;
    execute format('delete from public.%I where id = $1 and tenant_id = $2', r.target_table) using r.target_id, b.tenant_id;
    update public.import_rows set status = 'rolled_back' where id = r.id;
    v_n := v_n + 1;
  end loop;
  update public.import_batches set status = 'rolled_back', rolled_back_at = now() where id = b.id;
  insert into public.audit_log (tenant_id, actor_id, action, table_name, record_id, after)
  values (b.tenant_id, auth.uid(), 'import.rollback', 'import_batches', b.id::text, jsonb_build_object('entity', b.entity, 'rows', v_n));
  return v_n;
end $$;

-- entity: campuses  (setup wizard §6.1)
create or replace function app.import_validate_campuses(p_batch uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; errs jsonb;
begin
  for r in select * from public.import_rows where batch_id = p_batch order by row_no loop
    errs := '[]'::jsonb;
    if coalesce(btrim(r.raw ->> 'code'), '') = '' then errs := errs || '"code is required"'; end if;
    if coalesce(btrim(r.raw ->> 'name'), '') = '' then errs := errs || '"name is required"'; end if;
    if exists (select 1 from public.campuses c where c.tenant_id = r.tenant_id and c.code = btrim(r.raw ->> 'code')) then
      errs := errs || '"code already exists"';
    end if;
    if exists (select 1 from public.import_rows o where o.batch_id = p_batch and o.row_no < r.row_no and btrim(o.raw ->> 'code') = btrim(r.raw ->> 'code')) then
      errs := errs || '"duplicate code in file"';
    end if;
    update public.import_rows set status = case when jsonb_array_length(errs) = 0 then 'valid' else 'error' end, errors = errs where id = r.id;
  end loop;
end $$;

create or replace function app.import_apply_campuses(p_batch uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_id uuid;
begin
  for r in select * from public.import_rows where batch_id = p_batch and status = 'valid' order by row_no loop
    insert into public.campuses (tenant_id, code, name, city)
    values (r.tenant_id, btrim(r.raw ->> 'code'), btrim(r.raw ->> 'name'), nullif(btrim(r.raw ->> 'city'), ''))
    returning id into v_id;
    update public.import_rows set status = 'committed', target_table = 'campuses', target_id = v_id where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------- execute grants
-- Postgres (and Supabase's default privileges) make functions callable by everyone; close that, then open deliberately.
revoke all on function
  public.provision_tenant_defaults(uuid),
  public.create_tenant(text, text, text, text, text, uuid),
  public.resolve_tenant(text),
  public.my_tenants(),
  public.set_active_tenant(uuid),
  public.custom_access_token_hook(jsonb),
  public.start_impersonation(uuid, text, text, int, text[]),
  public.end_impersonation(uuid),
  public.log_sensitive_access(text, uuid, text, text),
  public.import_batch_create(text, jsonb, text),
  public.import_batch_dry_run(uuid),
  public.import_batch_commit(uuid),
  public.import_batch_rollback(uuid),
  app.import_load_batch(uuid, text[]),
  app.import_validate_campuses(uuid),
  app.import_apply_campuses(uuid)
from public, anon, authenticated;

grant execute on function public.resolve_tenant(text) to anon, authenticated, service_role;
grant execute on function
  public.create_tenant(text, text, text, text, text, uuid),
  public.my_tenants(),
  public.set_active_tenant(uuid),
  public.start_impersonation(uuid, text, text, int, text[]),
  public.end_impersonation(uuid),
  public.log_sensitive_access(text, uuid, text, text),
  public.import_batch_create(text, jsonb, text),
  public.import_batch_dry_run(uuid),
  public.import_batch_commit(uuid),
  public.import_batch_rollback(uuid)
to authenticated, service_role;
grant execute on function public.provision_tenant_defaults(uuid) to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  end if;
end $$;

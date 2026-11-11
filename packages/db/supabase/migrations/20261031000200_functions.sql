-- Phase 1 · security helpers. These are what RLS policies call; keep them small and boring.
-- DECISION: RLS is ENABLEd, not FORCEd. The security-definer helpers are owned by the migration role (BYPASSRLS on
-- Supabase) and must read user_tenants/user_roles without recursing into those tables' own policies. Application
-- traffic only ever connects as anon / authenticated / service_role, never as the owner.

grant usage on schema app to anon, authenticated, service_role;

create or replace function app.is_vendor_role(p_role text default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.vendor_staff v
    where v.user_id = auth.uid() and (p_role is null or v.role = p_role)
  )
$$;

create or replace function app.is_vendor_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_vendor_role(null)
$$;

-- The tenant the caller is acting in. The JWT claim is NOT trusted on its own (defence in depth):
--   * normal session   → caller must be an active member of that tenant;
--   * impersonation    → claim `imp` must name an open, unexpired session of THIS vendor user for THIS tenant.
-- Returns NULL otherwise, which makes every tenant_id = current_tenant_id() policy false.
create or replace function app.current_tenant_id() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t   uuid := nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
  imp uuid := nullif(auth.jwt() ->> 'imp', '')::uuid;
  u   uuid := auth.uid();
begin
  if t is null or u is null then return null; end if;

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

-- Suspended tenants are read-only (CLAUDE.md §9.2).
create or replace function app.tenant_writable() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select t.status not in ('suspended', 'churned') from public.tenants t where t.id = app.current_tenant_id()), false)
$$;

-- Scope rule: a tenant-wide assignment covers every scope; a narrower one only matches its own (type, id).
create or replace function app.has_permission(p_key text, p_scope_type text default 'tenant', p_scope_id uuid default null)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t    uuid := app.current_tenant_id();
  u    uuid := auth.uid();
  imp  uuid := nullif(auth.jwt() ->> 'imp', '')::uuid;
  perm record;
  ok   boolean;
begin
  if t is null or u is null then return false; end if;

  select requires_mfa into perm from public.permissions where key = p_key;
  if not found then return false; end if; -- unknown keys never pass
  if perm.requires_mfa and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then return false; end if;

  if imp is not null then
    -- vendor support never reaches child location, counsellor cases or money, whatever the session was granted
    if p_key like 'wellbeing.%' or p_key like 'tracking.%' or p_key like 'compass.screening%'
       or p_key like 'fees.collect' or p_key like 'fees.refund%' or p_key like 'fees.writeoff%'
       or p_key like 'fees.waiver%' or p_key like 'payroll.%' or p_key like 'accounts.journal%'
       or p_key like 'accounts.period%' then
      return false;
    end if;
    select p_key = any (s.permission_keys) into ok from public.impersonation_sessions s where s.id = imp;
    return coalesce(ok, false);
  end if;

  if exists (
    select 1 from public.user_permission_overrides o
    where o.tenant_id = t and o.user_id = u and o.permission_key = p_key and o.effect = 'deny'
      and (o.expires_at is null or o.expires_at > now())
      and (o.scope_type = 'tenant' or (o.scope_type = p_scope_type and o.scope_id is not distinct from p_scope_id))
  ) then return false; end if;

  if exists (
    select 1 from public.user_permission_overrides o
    where o.tenant_id = t and o.user_id = u and o.permission_key = p_key and o.effect = 'grant'
      and (o.expires_at is null or o.expires_at > now())
      and (o.scope_type = 'tenant' or (o.scope_type = p_scope_type and o.scope_id is not distinct from p_scope_id))
  ) then return true; end if;

  return exists (
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.tenant_id = ur.tenant_id and rp.role_id = ur.role_id
    where ur.tenant_id = t and ur.user_id = u and rp.permission_key = p_key
      and (ur.expires_at is null or ur.expires_at > now())
      and (ur.scope_type = 'tenant' or (ur.scope_type = p_scope_type and ur.scope_id is not distinct from p_scope_id))
  );
end $$;

-- ---------------------------------------------------------------- triggers
create or replace function app.touch_row() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    if to_jsonb(new) ? 'created_by' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  else
    new.created_at := old.created_at;
    if to_jsonb(new) ? 'created_by' then new.created_by := old.created_by; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_j jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_j jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  row_j jsonb := coalesce(new_j, old_j);
  redact text;
  tid uuid;
  hdrs jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_ip inet;
begin
  foreach redact in array coalesce(tg_argv, '{}'::text[]) loop
    old_j := old_j - redact;
    new_j := new_j - redact;
  end loop;

  tid := coalesce((row_j ->> 'tenant_id')::uuid, case when tg_table_name = 'tenants' then (row_j ->> 'id')::uuid end);
  begin
    v_ip := nullif(btrim(split_part(coalesce(hdrs ->> 'x-forwarded-for', ''), ',', 1)), '')::inet;
  exception when others then v_ip := null; -- a malformed header must never block a write
  end;

  insert into public.audit_log (tenant_id, actor_id, impersonation_session_id, action, table_name, record_id, before, after, ip, device)
  values (tid, auth.uid(), nullif(auth.jwt() ->> 'imp', '')::uuid, lower(tg_op), tg_table_name,
          coalesce(row_j ->> 'id', row_j ->> 'user_id'), old_j, new_j, v_ip, left(hdrs ->> 'user-agent', 300));
  return null;
end $$;

create or replace function app.deny_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

create or replace function app.guard_tenant_update() returns trigger language plpgsql as $$
begin
  -- service role / migrations have no auth.uid(); everyone else must be vendor staff to touch these columns
  if auth.uid() is not null and not app.is_vendor_staff()
     and (new.slug, new.org_id, new.region, new.plan_id, new.status, new.base_currency)
         is distinct from (old.slug, old.org_id, old.region, old.plan_id, old.status, old.base_currency) then
    raise exception 'slug, org, region, plan, status and base currency are vendor-managed' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function app.guard_domain_verification() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not app.is_vendor_staff() then
    if tg_op = 'INSERT' and new.verified_at is not null then
      raise exception 'domains are verified by the platform, not by tenants' using errcode = '42501';
    elsif tg_op = 'UPDATE' and (new.verified_at is distinct from old.verified_at or new.domain is distinct from old.domain) then
      raise exception 'domains are verified by the platform, not by tenants' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Only an existing school_owner (or the platform) may hand out the school_owner role.
create or replace function app.guard_owner_role() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare is_owner_role boolean;
begin
  select r.key = 'school_owner' into is_owner_role from public.roles r where r.id = new.role_id and r.tenant_id = new.tenant_id;
  if coalesce(is_owner_role, false) and auth.uid() is not null and not app.is_vendor_staff()
     and nullif(auth.jwt() ->> 'imp', '') is null
     and not exists (
       select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
       where ur.tenant_id = new.tenant_id and ur.user_id = auth.uid() and r.key = 'school_owner'
     ) then
    raise exception 'only a school owner can grant the owner role' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- policy factory
-- p_write_perm: permission key required to write, or '-' for read-only-from-clients (writes go through RPCs).
-- p_read_perm : optional permission key required to read (default: any active member of the tenant).
create or replace function app.secure_tenant_table(p_table regclass, p_write_perm text, p_read_perm text default null)
returns void language plpgsql as $$
declare
  tid  constant text := '(select app.current_tenant_id())';
  rd   text := case when p_read_perm is null then '' else format(' and (select app.has_permission(%L))', p_read_perm) end;
  wr   text;
begin
  if not exists (select 1 from pg_attribute where attrelid = p_table and attname = 'tenant_id' and not attisdropped) then
    raise exception '% has no tenant_id column', p_table;
  end if;
  execute format('alter table %s enable row level security', p_table);
  execute format('drop policy if exists tenant_select on %s', p_table);
  execute format('create policy tenant_select on %s for select to authenticated using (tenant_id = %s%s)', p_table, tid, rd);

  execute format('drop policy if exists tenant_insert on %s', p_table);
  execute format('drop policy if exists tenant_update on %s', p_table);
  execute format('drop policy if exists tenant_delete on %s', p_table);
  if p_write_perm <> '-' then
    wr := format(' and (select app.has_permission(%L)) and (select app.tenant_writable())', p_write_perm);
    execute format('create policy tenant_insert on %s for insert to authenticated with check (tenant_id = %s%s)', p_table, tid, wr);
    execute format('create policy tenant_update on %s for update to authenticated using (tenant_id = %s%s) with check (tenant_id = %s%s)', p_table, tid, wr, tid, wr);
    execute format('create policy tenant_delete on %s for delete to authenticated using (tenant_id = %s%s)', p_table, tid, wr);
  end if;
end $$;

create or replace function app.attach_standard_triggers(p_table regclass, p_audit boolean default true, p_redact text[] default '{}')
returns void language plpgsql as $$
declare args text := (select coalesce(string_agg(quote_literal(x), ','), '') from unnest(p_redact) x);
begin
  execute format('drop trigger if exists touch_row on %s', p_table);
  execute format('create trigger touch_row before insert or update on %s for each row execute function app.touch_row()', p_table);
  if p_audit then
    execute format('drop trigger if exists audit_row on %s', p_table);
    execute format('create trigger audit_row after insert or update or delete on %s for each row execute function app.audit_row(%s)', p_table, args);
  end if;
end $$;

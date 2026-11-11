-- Giving staff and parents a login, without SQL. Flow (apps/web /portal/people):
--   1. the page's server action checks the caller may manage users, then uses the service role ONLY to find-or-create the Auth user for
--      the email (email confirmed, no password: they sign in with an emailed code) — public.auth_user_id() / Auth admin API;
--   2. everything that touches the school then runs AS THE CALLER through invite_member(): permission, no-escalation and owner rules are
--      checked here, in the database, and every row written is audited by the standard triggers.

-- ---------------------------------------------------------------- service-only: email → auth user id
create or replace function public.auth_user_id(p_email text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1
$$;
revoke all on function public.auth_user_id(text) from public, anon, authenticated;
grant execute on function public.auth_user_id(text) to service_role;

-- ---------------------------------------------------------------- invite / add a role
-- DECISION (no escalation): a non-owner may only grant a role whose every permission they hold themselves; only an owner grants the
-- owner role (also enforced by the guard_owner trigger). Granting the same role twice is a no-op. A guardian/staff record can be linked
-- only if it is not already linked to someone else.
create or replace function public.invite_member(p_user uuid, p_full_name text, p_role_key text, p_guardian uuid default null, p_staff uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_role public.roles; v_owner boolean; v_missing text; v_new boolean := false;
begin
  if t is null or not app.has_permission('users.manage') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown user' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own access' using errcode = '42501', hint = 'self'; end if;
  select * into v_role from public.roles where tenant_id = t and key = p_role_key;
  if not found then raise exception 'unknown role' using errcode = '22023', hint = 'role'; end if;
  v_owner := exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
                     where ur.tenant_id = t and ur.user_id = auth.uid() and r.key = 'school_owner');
  if not v_owner then
    if v_role.key = 'school_owner' then raise exception 'only a school owner can grant the owner role' using errcode = '42501', hint = 'owner'; end if;
    select rp.permission_key into v_missing from public.role_permissions rp
    where rp.tenant_id = t and rp.role_id = v_role.id and not app.has_permission(rp.permission_key) limit 1;
    if v_missing is not null then raise exception 'you cannot grant a role with more access than you have (%)', v_missing using errcode = '42501', hint = 'escalation'; end if;
  end if;
  -- the owner's own access can only be changed by an owner
  if not v_owner and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
                             where ur.tenant_id = t and ur.user_id = p_user and r.key = 'school_owner') then
    raise exception 'permission denied' using errcode = '42501', hint = 'owner';
  end if;

  insert into public.profiles (user_id, full_name, active_tenant_id) values (p_user, nullif(btrim(p_full_name), ''), t)
  on conflict (user_id) do update set full_name = coalesce(public.profiles.full_name, excluded.full_name),
                                      active_tenant_id = coalesce(public.profiles.active_tenant_id, excluded.active_tenant_id);
  insert into public.user_tenants (tenant_id, user_id, status) values (t, p_user, 'active')
  on conflict (tenant_id, user_id) do update set status = 'active';
  if not exists (select 1 from public.user_roles where tenant_id = t and user_id = p_user and role_id = v_role.id and scope_type = 'tenant') then
    insert into public.user_roles (tenant_id, user_id, role_id) values (t, p_user, v_role.id);
    v_new := true;
  end if;

  if p_guardian is not null then
    if not app.has_permission('students.edit') then raise exception 'permission denied' using errcode = '42501', hint = 'guardian'; end if;
    update public.guardians set user_id = p_user where tenant_id = t and id = p_guardian and (user_id is null or user_id = p_user);
    if not found then raise exception 'guardian not found or already linked to another login' using errcode = 'P0001', hint = 'guardian_linked'; end if;
  end if;
  if p_staff is not null then
    if not app.has_permission('payroll.prepare') then raise exception 'permission denied' using errcode = '42501', hint = 'staff'; end if;
    update public.staff_members set user_id = p_user where tenant_id = t and id = p_staff and (user_id is null or user_id = p_user);
    if not found then raise exception 'staff record not found or already linked to another login' using errcode = 'P0001', hint = 'staff_linked'; end if;
  end if;
  return jsonb_build_object('user_id', p_user, 'role', v_role.key, 'role_added', v_new);
end $$;

-- ---------------------------------------------------------------- suspend / reactivate / remove, and taking one role away
create or replace function public.set_member_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_owner boolean;
begin
  if t is null or not app.has_permission('users.manage') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_status not in ('active', 'suspended', 'left') then raise exception 'bad status' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own access' using errcode = '42501', hint = 'self'; end if;
  v_owner := exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
                     where ur.tenant_id = t and ur.user_id = auth.uid() and r.key = 'school_owner');
  if not v_owner and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
                             where ur.tenant_id = t and ur.user_id = p_user and r.key = 'school_owner') then
    raise exception 'permission denied' using errcode = '42501', hint = 'owner';
  end if;
  update public.user_tenants set status = p_status where tenant_id = t and user_id = p_user;
  if not found then raise exception 'not a member of this school' using errcode = 'P0001'; end if;
end $$;

create or replace function public.remove_member_role(p_user uuid, p_role_key text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_owner boolean;
begin
  if t is null or not app.has_permission('users.manage') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own access' using errcode = '42501', hint = 'self'; end if;
  v_owner := exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
                     where ur.tenant_id = t and ur.user_id = auth.uid() and r.key = 'school_owner');
  if not v_owner and (p_role_key = 'school_owner' or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
                             where ur.tenant_id = t and ur.user_id = p_user and r.key = 'school_owner')) then
    raise exception 'permission denied' using errcode = '42501', hint = 'owner';
  end if;
  delete from public.user_roles ur using public.roles r
  where ur.tenant_id = t and ur.user_id = p_user and r.id = ur.role_id and r.tenant_id = ur.tenant_id and r.key = p_role_key;
end $$;

-- the People page's list: members, their roles and what they are linked to. Managers only (it reads other people's names and emails).
create or replace function public.school_members()
returns table (user_id uuid, full_name text, email text, status text, roles text[], guardian_of text[], staff_no text, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('users.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select ut.user_id, p.full_name, u.email::text, ut.status,
           coalesce((select array_agg(r.key order by r.key) from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
                     where ur.tenant_id = t and ur.user_id = ut.user_id), '{}'),
           coalesce((select array_agg(distinct s.full_name) from public.guardians g join public.student_guardians sg on sg.tenant_id = g.tenant_id and sg.guardian_id = g.id
                     join public.students s on s.tenant_id = sg.tenant_id and s.id = sg.student_id where g.tenant_id = t and g.user_id = ut.user_id), '{}'),
           (select sm.employee_no from public.staff_members sm where sm.tenant_id = t and sm.user_id = ut.user_id),
           u.last_sign_in_at
    from public.user_tenants ut join auth.users u on u.id = ut.user_id left join public.profiles p on p.user_id = ut.user_id
    where ut.tenant_id = t
    order by ut.status, p.full_name nulls last, u.email;
end $$;

revoke all on function public.invite_member(uuid, text, text, uuid, uuid), public.set_member_status(uuid, text),
  public.remove_member_role(uuid, text), public.school_members() from public, anon;
grant execute on function public.invite_member(uuid, text, text, uuid, uuid), public.set_member_status(uuid, text),
  public.remove_member_role(uuid, text), public.school_members() to authenticated, service_role;
select app.harden_internal_functions();

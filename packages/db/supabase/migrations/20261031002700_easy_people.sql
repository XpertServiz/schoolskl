-- Adding people made simple (owner request): the school OWNER can give logins without first setting up 2FA, and the platform's super
-- admin can add people to any school from the Vendor Console.
-- DECISION: users.manage still requires 2FA for everyone else (IT admin). An owner without 2FA may grant every role EXCEPT the
-- admin-level ones (school_owner, principal, it_admin) — those still need a 2FA session. Isolation is unchanged (current school only),
-- the guard_owner trigger still applies, and every write is audited.

-- the caller holds the school_owner role in the current school
create or replace function app.is_school_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
                 where ur.tenant_id = app.current_tenant_id() and ur.user_id = auth.uid() and r.key = 'school_owner'
                   and (ur.expires_at is null or ur.expires_at > now()))
$$;

-- may the caller manage people (optionally: grant this role)?
create or replace function app.can_manage_people(p_role text default null) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.tenant_writable() and (
    app.has_permission('users.manage')
    or (app.is_school_owner() and (p_role is null or p_role not in ('school_owner', 'principal', 'it_admin'))))
$$;

-- roles that are staff (get a staff record so check-in, timetable and the Drive screen work)
create or replace function app.is_staff_role(p_role text) returns boolean
language sql immutable as $$ select p_role not in ('parent', 'student', 'alumni', 'auditor') $$;

-- shared body: tenant given explicitly (school members use their current school; the vendor names one)
create or replace function app.add_member(t uuid, p_user uuid, p_full_name text, p_role_key text, p_guardian uuid, p_staff uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role public.roles; v_new boolean := false; v_staff uuid := p_staff; v_no bigint;
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown user' using errcode = '22023'; end if;
  select * into v_role from public.roles where tenant_id = t and key = p_role_key;
  if not found then raise exception 'unknown role' using errcode = '22023', hint = 'role'; end if;

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
    update public.guardians set user_id = p_user where tenant_id = t and id = p_guardian and (user_id is null or user_id = p_user);
    if not found then raise exception 'guardian not found or already linked to another login' using errcode = 'P0001', hint = 'guardian_linked'; end if;
  end if;
  if v_staff is not null then
    update public.staff_members set user_id = p_user where tenant_id = t and id = v_staff and (user_id is null or user_id = p_user);
    if not found then raise exception 'staff record not found or already linked to another login' using errcode = 'P0001', hint = 'staff_linked'; end if;
  elsif app.is_staff_role(p_role_key) and not exists (select 1 from public.staff_members where tenant_id = t and user_id = p_user) then
    -- a teacher/driver/accountant added here gets a staff record straight away (number S-0001, S-0002 …)
    v_no := app.next_counter(t, 'staff_no');
    insert into public.staff_members (tenant_id, user_id, employee_no, full_name, designation)
    values (t, p_user, 'S-' || lpad(v_no::text, 4, '0'), coalesce(nullif(btrim(p_full_name), ''), 'Staff'), v_role.name)
    on conflict do nothing;
  end if;
  return jsonb_build_object('user_id', p_user, 'role', v_role.key, 'role_added', v_new);
end $$;

-- ---------------------------------------------------------------- school side (replaces …2600 versions)
create or replace function public.invite_member(p_user uuid, p_full_name text, p_role_key text, p_guardian uuid default null, p_staff uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_role_id uuid; v_owner boolean; v_missing text;
begin
  if t is null or not app.can_manage_people(p_role_key) then
    if t is not null and app.is_school_owner() then raise exception 'two-step sign-in is needed to grant this role' using errcode = '42501', hint = 'mfa'; end if;
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own access' using errcode = '42501', hint = 'self'; end if;
  select id into v_role_id from public.roles where tenant_id = t and key = p_role_key;
  if v_role_id is null then raise exception 'unknown role' using errcode = '22023', hint = 'role'; end if;
  v_owner := app.is_school_owner();
  if not v_owner then
    if p_role_key = 'school_owner' then raise exception 'only a school owner can grant the owner role' using errcode = '42501', hint = 'owner'; end if;
    select rp.permission_key into v_missing from public.role_permissions rp where rp.tenant_id = t and rp.role_id = v_role_id and not app.has_permission(rp.permission_key) limit 1;
    if v_missing is not null then raise exception 'you cannot grant a role with more access than you have (%)', v_missing using errcode = '42501', hint = 'escalation'; end if;
    if exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id where ur.tenant_id = t and ur.user_id = p_user and r.key = 'school_owner') then
      raise exception 'permission denied' using errcode = '42501', hint = 'owner';
    end if;
  end if;
  if p_guardian is not null and not app.has_permission('students.edit') then raise exception 'permission denied' using errcode = '42501', hint = 'guardian'; end if;
  if p_staff is not null and not app.has_permission('payroll.prepare') then raise exception 'permission denied' using errcode = '42501', hint = 'staff'; end if;
  return app.add_member(t, p_user, p_full_name, p_role_key, p_guardian, p_staff);
end $$;

create or replace function public.set_member_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.can_manage_people(null) then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_status not in ('active', 'suspended', 'left') then raise exception 'bad status' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own access' using errcode = '42501', hint = 'self'; end if;
  if not app.is_school_owner() and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
                                           where ur.tenant_id = t and ur.user_id = p_user and r.key = 'school_owner') then
    raise exception 'permission denied' using errcode = '42501', hint = 'owner';
  end if;
  update public.user_tenants set status = p_status where tenant_id = t and user_id = p_user;
  if not found then raise exception 'not a member of this school' using errcode = 'P0001'; end if;
end $$;

create or replace function public.remove_member_role(p_user uuid, p_role_key text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.can_manage_people(p_role_key) then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own access' using errcode = '42501', hint = 'self'; end if;
  if not app.is_school_owner() and (p_role_key = 'school_owner' or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
                             where ur.tenant_id = t and ur.user_id = p_user and r.key = 'school_owner')) then
    raise exception 'permission denied' using errcode = '42501', hint = 'owner';
  end if;
  delete from public.user_roles ur using public.roles r
  where ur.tenant_id = t and ur.user_id = p_user and r.id = ur.role_id and r.tenant_id = ur.tenant_id and r.key = p_role_key;
end $$;

create or replace function public.school_members()
returns table (user_id uuid, full_name text, email text, status text, roles text[], guardian_of text[], staff_no text, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id();
begin
  if t is null or not (app.has_permission('users.manage') or app.is_school_owner()) then raise exception 'permission denied' using errcode = '42501'; end if;
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

-- whether the caller may use the Logins page, and whether admin roles need a 2FA step-up first (for the page)
create or replace function public.people_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('can', app.can_manage_people(null), 'admin_roles', app.has_permission('users.manage'))
$$;

-- ---------------------------------------------------------------- platform super admin: add someone to any school
create or replace function public.vendor_add_member(p_tenant uuid, p_user uuid, p_full_name text, p_role_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_vendor_role('vendor_super_admin') then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant and status <> 'churned') then raise exception 'school not found' using errcode = 'P0001'; end if;
  insert into public.audit_log (tenant_id, actor_id, action, table_name, record_id, after)
  values (p_tenant, auth.uid(), 'vendor_add_member', 'user_roles', p_user::text, jsonb_build_object('role', p_role_key, 'name', p_full_name));
  return app.add_member(p_tenant, p_user, p_full_name, p_role_key, null, null);
end $$;

revoke all on function public.invite_member(uuid, text, text, uuid, uuid), public.set_member_status(uuid, text), public.remove_member_role(uuid, text),
  public.school_members(), public.people_access(), public.vendor_add_member(uuid, uuid, text, text) from public, anon;
grant execute on function public.invite_member(uuid, text, text, uuid, uuid), public.set_member_status(uuid, text), public.remove_member_role(uuid, text),
  public.school_members(), public.people_access(), public.vendor_add_member(uuid, uuid, text, text) to authenticated, service_role;
select app.harden_internal_functions();

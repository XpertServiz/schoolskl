-- Setup wizard support: switch the current academic session atomically, report setup progress in one call, and make the student import
-- refuse a class name that exists on more than one campus (it used to pick one silently).

-- Only one session may be current (partial unique index). Two separate UPDATEs from the page could leave a school with no current
-- session if the second failed; this does both in one transaction.
create or replace function public.set_current_session(p_session uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('settings.manage') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.academic_sessions where id = p_session and tenant_id = t) then raise exception 'session not found' using errcode = '42501'; end if;
  update public.academic_sessions set is_current = false where tenant_id = t and is_current and id <> p_session;
  update public.academic_sessions set is_current = true where id = p_session and tenant_id = t;
end $$;

-- What a new school has set up so far. Counts only — no names, no records — and only for someone who may change the school's setup.
create or replace function public.setup_progress() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); b jsonb;
begin
  if t is null or not app.has_permission('settings.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select branding into b from public.tenants where id = t;
  return jsonb_build_object(
    'profile',      coalesce(b ->> 'tagline', '') <> '' or coalesce(b ->> 'phone', '') <> '',
    'campuses',     (select count(*) from public.campuses where tenant_id = t and is_active),
    'session',      exists (select 1 from public.academic_sessions where tenant_id = t and is_current),
    'classes',      (select count(*) from public.classes where tenant_id = t),
    'sections',     (select count(*) from public.sections where tenant_id = t),
    'fees',         (select count(*) from public.fee_structures where tenant_id = t),
    'students',     (select count(*) from public.students where tenant_id = t),
    'staff',        (select count(*) from public.staff_members where tenant_id = t),
    'timetable',    (select count(*) from public.timetable_slots where tenant_id = t)
  );
end $$;

revoke all on function public.set_current_session(uuid), public.setup_progress() from public, anon;
grant execute on function public.set_current_session(uuid), public.setup_progress() to authenticated, service_role;

-- Student import: same as …2200, plus "class_ambiguous" when the class name matches on more than one campus.
create or replace function app.import_resolve_student(p_tenant uuid, p_raw jsonb, p_session uuid,
  out class_id uuid, out campus_id uuid, out section_id uuid, out phone text, out dob date, out gender text, out errs jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_class text := lower(btrim(coalesce(p_raw ->> 'class', ''))); v_section text := lower(btrim(coalesce(p_raw ->> 'section', '')));
        v_g text := lower(btrim(coalesce(p_raw ->> 'gender', ''))); n_sections int; n_classes int;
begin
  errs := '[]'::jsonb;
  if p_session is null then errs := errs || '"no_current_session"'; end if;
  if length(btrim(coalesce(p_raw ->> 'full_name', ''))) < 2 then errs := errs || '"name_required"'; end if;
  select count(*) into n_classes from public.classes c where c.tenant_id = p_tenant and lower(btrim(c.name)) = v_class;
  if n_classes > 1 then errs := errs || '"class_ambiguous"';
  elsif n_classes = 1 then
    select c.id, c.campus_id into class_id, campus_id from public.classes c where c.tenant_id = p_tenant and lower(btrim(c.name)) = v_class;
  end if;
  if n_classes = 0 then errs := errs || '"class_unknown"';
  elsif class_id is not null then
    select count(*) into n_sections from public.sections s where s.tenant_id = p_tenant and s.class_id = import_resolve_student.class_id;
    if v_section <> '' then
      select s.id into section_id from public.sections s where s.tenant_id = p_tenant and s.class_id = import_resolve_student.class_id and lower(btrim(s.name)) = v_section;
      if section_id is null then errs := errs || '"section_unknown"'; end if;
    elsif n_sections = 1 then -- DECISION: a class with a single section needs no section column
      select s.id into section_id from public.sections s where s.tenant_id = p_tenant and s.class_id = import_resolve_student.class_id;
    elsif n_sections > 1 then errs := errs || '"section_required"';
    end if;
  end if;
  if length(btrim(coalesce(p_raw ->> 'guardian_name', ''))) < 2 then errs := errs || '"guardian_required"'; end if;
  phone := app.normalise_pk_phone(p_raw ->> 'guardian_phone');
  if phone is null then errs := errs || '"phone_invalid"'; end if;
  if btrim(coalesce(p_raw ->> 'dob', '')) <> '' then
    dob := app.parse_school_date(p_raw ->> 'dob');
    if dob is null or dob > current_date or dob < current_date - interval '30 years' then errs := errs || '"dob_invalid"'; dob := null; end if;
  end if;
  gender := case when v_g = '' then null when v_g in ('male', 'm', 'boy') then 'male' when v_g in ('female', 'f', 'girl') then 'female' when v_g = 'other' then 'other' else '?' end;
  if gender = '?' then errs := errs || '"gender_invalid"'; gender := null; end if;
end $$;

select app.harden_internal_functions();

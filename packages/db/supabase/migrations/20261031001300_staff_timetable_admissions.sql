-- Phase 2 · staff directory (HR core), staff attendance, subjects & timetable (clash-proof), teaching assignments, admissions CRM.
-- Payroll proper (salary structures, runs, payslips) is Phase 3; this is the people-and-time layer it will stand on.

-- ---------------------------------------------------------------- staff
create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid, employee_no text not null, full_name text not null, designation text, campus_id uuid,
  status text not null default 'active' check (status in ('active', 'on_leave', 'resigned', 'terminated')),
  joined_on date, left_on date,
  shift_start time not null default '08:00', shift_end time not null default '14:00',
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  check (shift_end > shift_start),
  foreign key (tenant_id, campus_id) references public.campuses (tenant_id, id),
  foreign key (tenant_id, user_id) references public.user_tenants (tenant_id, user_id),
  unique (tenant_id, employee_no), unique (tenant_id, id)
);
create unique index staff_one_per_user on public.staff_members (tenant_id, user_id) where user_id is not null;

create table public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  staff_id uuid not null, att_date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'half_day', 'leave')),
  check_in time, check_out time, note text, source text not null default 'manual' check (source in ('manual', 'self')), marked_by uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, staff_id) references public.staff_members (tenant_id, id) on delete cascade,
  unique (tenant_id, staff_id, att_date)
);
create index staff_attendance_day_idx on public.staff_attendance (tenant_id, att_date);

-- ---------------------------------------------------------------- subjects, bell schedule, timetable
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null, name text not null, is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);

create table public.periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  campus_id uuid not null, name text not null, starts_at time not null, ends_at time not null, sort_order int not null default 0, is_break boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (tenant_id, campus_id) references public.campuses (tenant_id, id),
  unique (tenant_id, campus_id, name), unique (tenant_id, id)
);

create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  section_id uuid not null, day_of_week int not null check (day_of_week between 1 and 7), -- 1 = Monday
  period_id uuid not null, subject_id uuid not null, teacher_id uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, section_id) references public.sections (tenant_id, id) on delete cascade,
  foreign key (tenant_id, period_id) references public.periods (tenant_id, id),
  foreign key (tenant_id, subject_id) references public.subjects (tenant_id, id),
  foreign key (tenant_id, teacher_id) references public.staff_members (tenant_id, id),
  unique (tenant_id, section_id, day_of_week, period_id)
);
create index timetable_teacher_idx on public.timetable_slots (tenant_id, teacher_id, day_of_week);

-- Who teaches what to whom. (Powers marks entry & class-scoped views in Phase 3; the timetable does not require it.)
create table public.teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  staff_id uuid not null, section_id uuid not null, subject_id uuid not null,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, staff_id) references public.staff_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, section_id) references public.sections (tenant_id, id) on delete cascade,
  foreign key (tenant_id, subject_id) references public.subjects (tenant_id, id),
  unique (tenant_id, staff_id, section_id, subject_id)
);
create index teaching_assignments_section_idx on public.teaching_assignments (tenant_id, section_id);

-- Two lessons may not overlap in time for the same section, nor for the same teacher (even across campuses with different bells).
create or replace function app.check_timetable_clash() returns trigger language plpgsql as $$
declare p public.periods; c record;
begin
  select * into p from public.periods where id = new.period_id and tenant_id = new.tenant_id;
  if not found then raise exception 'unknown period'; end if;
  if p.is_break then raise exception 'a lesson cannot be scheduled in a break'; end if;
  for c in
    select s.section_id, s.teacher_id, pp.name as period_name from public.timetable_slots s
    join public.periods pp on pp.tenant_id = s.tenant_id and pp.id = s.period_id
    where s.tenant_id = new.tenant_id and s.day_of_week = new.day_of_week and s.id is distinct from new.id
      and pp.starts_at < p.ends_at and p.starts_at < pp.ends_at
      and (s.section_id = new.section_id or (new.teacher_id is not null and s.teacher_id = new.teacher_id))
  loop
    if c.section_id = new.section_id then raise exception 'this section already has a lesson that overlaps (%)', c.period_name using errcode = '23P01'; end if;
    raise exception 'this teacher is already teaching at that time (%)', c.period_name using errcode = '23P01';
  end loop;
  return new;
end $$;
create trigger timetable_slots_clash before insert or update on public.timetable_slots for each row execute function app.check_timetable_clash();

-- ---------------------------------------------------------------- admissions CRM
create table public.admission_inquiries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  campus_id uuid not null, child_name text not null, child_dob date, child_gender text check (child_gender in ('female', 'male', 'other')),
  guardian_name text not null, guardian_phone text not null, class_id uuid,
  source text not null default 'walk_in' check (source in ('walk_in', 'phone', 'website', 'referral', 'social', 'other')),
  stage text not null default 'inquiry' check (stage in ('inquiry', 'visit_scheduled', 'test_scheduled', 'offered', 'accepted', 'enrolled', 'declined', 'lost')),
  follow_up_on date, notes text, assigned_to uuid, student_id uuid, lost_reason text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, campus_id) references public.campuses (tenant_id, id),
  foreign key (tenant_id, class_id) references public.classes (tenant_id, id),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id),
  unique (tenant_id, id)
);
-- one OPEN inquiry per child per guardian phone: the front desk finds the existing one instead of starting a duplicate
create unique index admission_one_open on public.admission_inquiries (tenant_id, guardian_phone, lower(child_name)) where stage not in ('declined', 'lost', 'enrolled');
create index admission_stage_idx on public.admission_inquiries (tenant_id, stage, follow_up_on);

create table public.admission_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  inquiry_id uuid not null, from_stage text, to_stage text not null, note text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, inquiry_id) references public.admission_inquiries (tenant_id, id) on delete cascade
);
create index admission_events_inquiry_idx on public.admission_events (tenant_id, inquiry_id);

-- ---------------------------------------------------------------- policies
select app.secure_tenant_table('public.staff_members', 'payroll.prepare');
alter policy tenant_select on public.staff_members using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('payroll.prepare')) or (select app.has_permission('attendance.view')) or (select app.has_permission('timetable.manage'))
       or user_id = (select auth.uid())));
select app.secure_tenant_table('public.staff_attendance', '-');
alter policy tenant_select on public.staff_attendance using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('payroll.prepare'))
       or exists (select 1 from public.staff_members m where m.tenant_id = staff_attendance.tenant_id and m.id = staff_attendance.staff_id and m.user_id = (select auth.uid()))));
select app.secure_tenant_table('public.subjects', 'timetable.manage');
select app.secure_tenant_table('public.periods', 'timetable.manage');
select app.secure_tenant_table('public.timetable_slots', 'timetable.manage');
select app.secure_tenant_table('public.teaching_assignments', 'timetable.manage');
select app.secure_tenant_table('public.admission_inquiries', '-', 'admissions.manage');
select app.secure_tenant_table('public.admission_events', '-', 'admissions.manage');

select app.attach_standard_triggers('public.staff_members');
select app.attach_standard_triggers('public.staff_attendance', false);
select app.attach_standard_triggers('public.subjects');
select app.attach_standard_triggers('public.periods');
select app.attach_standard_triggers('public.timetable_slots');
select app.attach_standard_triggers('public.teaching_assignments');
select app.attach_standard_triggers('public.admission_inquiries', false);
select app.attach_standard_triggers('public.admission_events', false);

-- ---------------------------------------------------------------- staff attendance
-- p_entries: [{"staff_id":"…","status":"present|absent|late|half_day|leave","note":"…"}]. HR marks; re-marking a day overwrites it.
create or replace function public.mark_staff_attendance(p_date date, p_entries jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); e jsonb; n int := 0;
begin
  if t is null or not app.has_permission('payroll.prepare') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_date > app.tenant_today(t) then raise exception 'cannot mark attendance for a future date'; end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    if not exists (select 1 from public.staff_members where id = (e ->> 'staff_id')::uuid and tenant_id = t) then raise exception 'staff member not found' using errcode = '42501'; end if;
    insert into public.staff_attendance (tenant_id, staff_id, att_date, status, note, source, marked_by)
    values (t, (e ->> 'staff_id')::uuid, p_date, e ->> 'status', e ->> 'note', 'manual', auth.uid())
    on conflict (tenant_id, staff_id, att_date) do update set status = excluded.status, note = excluded.note, source = 'manual', marked_by = auth.uid();
    n := n + 1;
  end loop;
  return n;
end $$;

-- A signed-in staff member checks themselves in: 'late' once more than 15 minutes past their shift start, local school time.
-- DECISION: self check-in has no location or device proof in v1; it is a convenience, HR can correct it. Location-based check-in would
-- be tracking an employee and needs its own consent design — not built.
create or replace function public.staff_check_in() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); m public.staff_members; v_tz text; v_now timestamp; v_status text; v_existing public.staff_attendance;
begin
  if t is null or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into m from public.staff_members where tenant_id = t and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'you are not registered as active staff here' using errcode = '42501'; end if;
  select coalesce(timezone, 'UTC') into v_tz from public.tenants where id = t;
  v_now := now() at time zone v_tz;
  select * into v_existing from public.staff_attendance where tenant_id = t and staff_id = m.id and att_date = v_now::date;
  if found and v_existing.check_in is not null then return v_existing.status; end if; -- double tap: unchanged
  v_status := case when v_now::time > m.shift_start + interval '15 minutes' then 'late' else 'present' end;
  insert into public.staff_attendance (tenant_id, staff_id, att_date, status, check_in, source, marked_by)
  values (t, m.id, v_now::date, v_status, v_now::time, 'self', auth.uid())
  on conflict (tenant_id, staff_id, att_date) do update set check_in = excluded.check_in, status = case when staff_attendance.status in ('absent', 'leave') then excluded.status else staff_attendance.status end, source = 'self';
  return v_status;
end $$;

create or replace function public.staff_check_out() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); m public.staff_members; v_tz text; v_now timestamp;
begin
  if t is null or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into m from public.staff_members where tenant_id = t and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'you are not registered as active staff here' using errcode = '42501'; end if;
  select coalesce(timezone, 'UTC') into v_tz from public.tenants where id = t;
  v_now := now() at time zone v_tz;
  update public.staff_attendance set check_out = v_now::time where tenant_id = t and staff_id = m.id and att_date = v_now::date and check_in is not null;
  if not found then raise exception 'check in first'; end if;
end $$;

-- ---------------------------------------------------------------- admissions workflow
create or replace function public.create_inquiry(
  p_campus uuid, p_child_name text, p_guardian_name text, p_guardian_phone text, p_class uuid default null,
  p_source text default 'walk_in', p_dob date default null, p_gender text default null, p_follow_up date default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_id uuid;
begin
  if t is null or not app.has_permission('admissions.manage') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  begin
    insert into public.admission_inquiries (tenant_id, campus_id, child_name, child_dob, child_gender, guardian_name, guardian_phone, class_id, source, follow_up_on, notes, assigned_to)
    values (t, p_campus, btrim(p_child_name), p_dob, p_gender, btrim(p_guardian_name), btrim(p_guardian_phone), p_class, p_source, p_follow_up, p_notes, auth.uid()) returning id into v_id;
  exception when unique_violation then
    raise exception 'there is already an open inquiry for this child and phone number' using errcode = '23505';
  end;
  insert into public.admission_events (tenant_id, inquiry_id, from_stage, to_stage, note) values (t, v_id, null, 'inquiry', 'created');
  return v_id;
end $$;

create or replace function public.advance_inquiry(p_id uuid, p_stage text, p_note text default null, p_follow_up date default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); i public.admission_inquiries; v_ok boolean;
begin
  if t is null or not app.has_permission('admissions.manage') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into i from public.admission_inquiries where id = p_id and tenant_id = t for update;
  if not found then raise exception 'inquiry not found' using errcode = '42501'; end if;
  if p_stage = 'enrolled' then raise exception 'an inquiry becomes enrolled only through enrol_from_inquiry'; end if;
  v_ok := case i.stage
    when 'inquiry'         then p_stage in ('visit_scheduled', 'test_scheduled', 'offered', 'declined', 'lost')
    when 'visit_scheduled' then p_stage in ('test_scheduled', 'offered', 'declined', 'lost')
    when 'test_scheduled'  then p_stage in ('offered', 'declined', 'lost')
    when 'offered'         then p_stage in ('accepted', 'declined', 'lost')
    when 'accepted'        then p_stage in ('lost')
    when 'declined'        then p_stage = 'inquiry'   -- reopened
    when 'lost'            then p_stage = 'inquiry'
    else false end;
  if not v_ok then raise exception 'cannot move an inquiry from % to %', i.stage, p_stage; end if;
  if p_stage in ('declined', 'lost') and coalesce(btrim(p_note), '') = '' then raise exception 'a reason is required'; end if;
  begin
    update public.admission_inquiries set stage = p_stage, follow_up_on = p_follow_up, lost_reason = case when p_stage in ('declined', 'lost') then p_note end where id = i.id;
  exception when unique_violation then
    raise exception 'another open inquiry already exists for this child and phone number' using errcode = '23505';
  end;
  insert into public.admission_events (tenant_id, inquiry_id, from_stage, to_stage, note) values (t, i.id, i.stage, p_stage, p_note);
end $$;

-- Accepted → a real student record (siblings auto-link by guardian phone, exactly as enrol_student does everywhere else).
create or replace function public.enrol_from_inquiry(p_id uuid, p_session uuid, p_class uuid, p_section uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); i public.admission_inquiries; v_student uuid;
begin
  if t is null or not app.has_permission('admissions.manage') or not app.has_permission('students.create') or not app.tenant_writable() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into i from public.admission_inquiries where id = p_id and tenant_id = t for update;
  if not found then raise exception 'inquiry not found' using errcode = '42501'; end if;
  if i.stage <> 'accepted' then raise exception 'only an accepted inquiry can be enrolled (this one is %)', i.stage; end if;
  v_student := public.enrol_student(i.child_name, i.campus_id, p_session, p_class, p_section, i.child_dob, i.child_gender, i.guardian_name, i.guardian_phone);
  update public.admission_inquiries set stage = 'enrolled', student_id = v_student, follow_up_on = null where id = i.id;
  insert into public.admission_events (tenant_id, inquiry_id, from_stage, to_stage, note) values (t, i.id, 'accepted', 'enrolled', 'student record created');
  return v_student;
end $$;

create view public.v_admission_funnel with (security_invoker = true) as
select tenant_id, campus_id, stage, count(*)::int as inquiries from public.admission_inquiries group by tenant_id, campus_id, stage;

-- ---------------------------------------------------------------- grants
select app.apply_grants();
grant select on public.v_admission_funnel to authenticated;
select app.harden_internal_functions();

revoke all on function public.mark_staff_attendance(date, jsonb), public.staff_check_in(), public.staff_check_out(),
  public.create_inquiry(uuid, text, text, text, uuid, text, date, text, date, text), public.advance_inquiry(uuid, text, text, date),
  public.enrol_from_inquiry(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_staff_attendance(date, jsonb), public.staff_check_in(), public.staff_check_out(),
  public.create_inquiry(uuid, text, text, text, uuid, text, date, text, date, text), public.advance_inquiry(uuid, text, text, date),
  public.enrol_from_inquiry(uuid, uuid, uuid, uuid) to authenticated, service_role;

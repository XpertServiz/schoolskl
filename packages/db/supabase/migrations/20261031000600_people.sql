-- Phase 2 · academic structure, families, students, guardians, enrolment.
-- Pattern: every parent table gets UNIQUE (tenant_id, id) and every child FKs (tenant_id, parent_id) so a row can
-- never reference another tenant's row, even if a bug or a privileged path tried to.
-- DECISION: teacher visibility is tenant-wide `students.view` for now. Class-scoped visibility needs a
-- teaching_assignments table (Phase 3 timetable); until then roles that include students.view see all students.

alter table public.campuses add constraint campuses_tenant_id_id unique (tenant_id, id);

create table public.tenant_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key       text not null,
  value     bigint not null default 0,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null, starts_on date not null, ends_on date not null, is_current boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  check (ends_on > starts_on), unique (tenant_id, name), unique (tenant_id, id)
);
create unique index academic_sessions_one_current on public.academic_sessions (tenant_id) where is_current;

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  campus_id uuid not null, name text not null, level int not null default 0,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, campus_id) references public.campuses (tenant_id, id),
  unique (tenant_id, campus_id, name), unique (tenant_id, id)
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  class_id uuid not null, name text not null,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, class_id) references public.classes (tenant_id, id) on delete cascade,
  unique (tenant_id, class_id, name), unique (tenant_id, id)
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null, primary_phone text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index families_phone_idx on public.families (tenant_id, primary_phone);

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  family_id uuid not null, full_name text not null, phone text,
  user_id uuid references auth.users (id) on delete set null, -- the parent's login, once they have one
  cnic_enc bytea, -- encrypted by the app with the tenant data key (never plaintext)
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, family_id) references public.families (tenant_id, id) on delete cascade,
  unique (tenant_id, id)
);
create index guardians_phone_idx on public.guardians (tenant_id, phone);
create index guardians_user_idx on public.guardians (tenant_id, user_id);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  family_id uuid not null, campus_id uuid not null,
  admission_no text not null, full_name text not null, dob date, gender text check (gender in ('male', 'female', 'other')),
  status text not null default 'enrolled' check (status in ('applicant', 'enrolled', 'transferred', 'alumni', 'struck_off')),
  funding_source text not null default 'self' check (funding_source in ('self', 'scholarship', 'pef', 'sef', 'sponsor')),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, family_id) references public.families (tenant_id, id),
  foreign key (tenant_id, campus_id) references public.campuses (tenant_id, id),
  unique (tenant_id, admission_no), unique (tenant_id, id)
);
create index students_family_idx on public.students (tenant_id, family_id);

-- B-Form and medical live apart so ordinary student reads never touch them (permission: students.sensitive.view)
create table public.student_sensitive (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null, b_form_enc bytea, medical_summary_enc bytea,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (tenant_id, student_id),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id) on delete cascade
);

create table public.student_guardians (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null, guardian_id uuid not null,
  relation text not null default 'parent', is_custodian boolean not null default true, pickup_allowed boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (tenant_id, student_id, guardian_id),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, guardian_id) references public.guardians (tenant_id, id) on delete cascade
);

create table public.student_enrolments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null, session_id uuid not null, class_id uuid not null, section_id uuid, roll_no int,
  status text not null default 'active' check (status in ('active', 'promoted', 'detained', 'transferred', 'left')),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, session_id) references public.academic_sessions (tenant_id, id),
  foreign key (tenant_id, class_id) references public.classes (tenant_id, id),
  foreign key (tenant_id, section_id) references public.sections (tenant_id, id),
  unique (tenant_id, student_id, session_id), unique (tenant_id, id)
);
create index student_enrolments_class_idx on public.student_enrolments (tenant_id, session_id, class_id);

-- ---------------------------------------------------------------- helpers: "is the caller a guardian of …"
create or replace function app.is_guardian_of_student(p_student uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.student_guardians sg join public.guardians g on g.tenant_id = sg.tenant_id and g.id = sg.guardian_id
    where sg.tenant_id = app.current_tenant_id() and sg.student_id = p_student and g.user_id = auth.uid())
$$;

create or replace function app.is_guardian_of_family(p_family uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.guardians g
    where g.tenant_id = app.current_tenant_id() and g.family_id = p_family and g.user_id = auth.uid())
$$;

create or replace function app.next_counter(p_tenant uuid, p_key text) returns bigint
language sql security definer set search_path = public, pg_temp as $$
  insert into public.tenant_counters (tenant_id, key, value) values (p_tenant, p_key, 1)
  on conflict (tenant_id, key) do update set value = public.tenant_counters.value + 1 returning value
$$;

-- ---------------------------------------------------------------- policies
select app.secure_tenant_table('public.tenant_counters', '-');
select app.secure_tenant_table('public.academic_sessions', 'settings.manage');
select app.secure_tenant_table('public.classes', 'settings.manage');
select app.secure_tenant_table('public.sections', 'settings.manage');

select app.secure_tenant_table('public.families', 'students.edit');
alter policy tenant_select on public.families using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('students.view')) or (select app.is_guardian_of_family(id))));

select app.secure_tenant_table('public.guardians', 'students.edit');
alter policy tenant_select on public.guardians using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('students.view')) or user_id = auth.uid() or (select app.is_guardian_of_family(family_id))));

select app.secure_tenant_table('public.students', 'students.edit');
alter policy tenant_select on public.students using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('students.view')) or (select app.is_guardian_of_student(id))));
alter policy tenant_delete on public.students using (
  tenant_id = (select app.current_tenant_id()) and (select app.has_permission('students.delete')) and (select app.tenant_writable()));

select app.secure_tenant_table('public.student_sensitive', 'students.edit', 'students.sensitive.view');

select app.secure_tenant_table('public.student_guardians', 'students.edit');
alter policy tenant_select on public.student_guardians using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('students.view')) or (select app.is_guardian_of_student(student_id))));

select app.secure_tenant_table('public.student_enrolments', 'students.edit');
alter policy tenant_select on public.student_enrolments using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('students.view')) or (select app.is_guardian_of_student(student_id))));

select app.attach_standard_triggers('public.tenant_counters', false);
select app.attach_standard_triggers('public.academic_sessions');
select app.attach_standard_triggers('public.classes');
select app.attach_standard_triggers('public.sections');
select app.attach_standard_triggers('public.families');
select app.attach_standard_triggers('public.guardians', true, array['cnic_enc']);
select app.attach_standard_triggers('public.students');
select app.attach_standard_triggers('public.student_sensitive', true, array['b_form_enc', 'medical_summary_enc']);
select app.attach_standard_triggers('public.student_guardians');
select app.attach_standard_triggers('public.student_enrolments');

-- Table grants are the seatbelt, RLS is the gate. Re-run at the end of every migration that adds tables:
-- new tables inherit Supabase's default privileges (anon + authenticated: everything), so close them again.
create or replace function app.apply_grants() returns void language plpgsql as $$
declare n text;
begin
  revoke all on all tables in schema public from anon;
  grant select on public.plans, public.plan_features to anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  -- Written only by definer RPCs / triggers, never directly by API roles (RLS has no write policy for them either).
  -- Looked up by name so the function works at every migration stage, before later tables exist.
  foreach n in array array[
    'audit_log', 'sensitive_access_log', 'impersonation_sessions', 'import_batches', 'import_rows', 'vendor_staff', 'tenant_counters',
    'accounts', 'accounting_periods', 'journal_entries', 'journal_lines',
    'concessions', 'cashier_sessions', 'payment_webhooks', 'vouchers', 'voucher_lines', 'voucher_adjustments', 'payments', 'payment_allocations',
    'guardian_contact_prefs', 'notification_deliveries', 'payroll_runs', 'payslips', 'exams', 'assessments', 'marks', 'mark_amendments', 'result_lines', 'result_summaries',
    'staff_attendance', 'admission_inquiries', 'admission_events', 'bank_statement_lines', 'family_refunds', 'security_deposits', 'installment_plans', 'installments', 'payment_promises', 'fee_reminders',
    'attendance_days', 'student_attendance', 'notification_outbox'
  ] loop
    if to_regclass('public.' || n) is not null then
      execute format('revoke insert, update, delete, truncate on public.%I from authenticated', n);
    end if;
  end loop;
end $$;
select app.apply_grants();

-- ---------------------------------------------------------------- enrol_student
-- Siblings auto-link: a guardian with the same phone in this tenant reuses their family.
create or replace function public.enrol_student(
  p_full_name text, p_campus uuid, p_session uuid, p_class uuid, p_section uuid default null,
  p_dob date default null, p_gender text default null,
  p_guardian_name text default null, p_guardian_phone text default null, p_family uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t uuid := app.current_tenant_id();
  v_family uuid := p_family; v_guardian uuid; v_student uuid; v_no bigint; v_prefix text;
begin
  if t is null or not app.has_permission('students.create') or not app.tenant_writable() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_family is not null and not exists (select 1 from public.families where id = v_family and tenant_id = t) then
    raise exception 'family not found' using errcode = '42501';
  end if;

  if v_family is null and p_guardian_phone is not null then
    select g.family_id, g.id into v_family, v_guardian from public.guardians g
    where g.tenant_id = t and g.phone = p_guardian_phone order by g.created_at limit 1;
  end if;
  if v_family is null then
    insert into public.families (tenant_id, name, primary_phone)
    values (t, coalesce(p_guardian_name, p_full_name || ' family'), p_guardian_phone) returning id into v_family;
  end if;
  if v_guardian is null and p_guardian_name is not null then
    insert into public.guardians (tenant_id, family_id, full_name, phone) values (t, v_family, p_guardian_name, p_guardian_phone)
    returning id into v_guardian;
  end if;

  v_no := app.next_counter(t, 'admission_no');
  select coalesce(settings ->> 'admission_no_prefix', '') into v_prefix from public.tenants where id = t;
  insert into public.students (tenant_id, family_id, campus_id, admission_no, full_name, dob, gender)
  values (t, v_family, p_campus, v_prefix || lpad(v_no::text, 5, '0'), p_full_name, p_dob, p_gender) returning id into v_student;

  if v_guardian is not null then
    insert into public.student_guardians (tenant_id, student_id, guardian_id) values (t, v_student, v_guardian);
  end if;
  insert into public.student_enrolments (tenant_id, student_id, session_id, class_id, section_id)
  values (t, v_student, p_session, p_class, p_section);
  return v_student;
end $$;

revoke all on function public.enrol_student(text, uuid, uuid, uuid, uuid, date, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.enrol_student(text, uuid, uuid, uuid, uuid, date, text, text, text, uuid) to authenticated, service_role;

-- Phase 2 · financial reports, daily closing report, student attendance (with day lock) and the parent-alert outbox.

-- ---------------------------------------------------------------- reports (SECURITY DEFINER + explicit permission: they take date ranges)
create or replace function public.profit_loss(p_from date, p_to date)
returns table (code text, name text, type text, amount bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('accounts.reports.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
  select a.code, a.name, a.type,
         (case when a.type = 'income' then coalesce(sum(l.credit - l.debit), 0) else coalesce(sum(l.debit - l.credit), 0) end)::bigint
  from public.accounts a
  left join public.journal_lines l on l.tenant_id = a.tenant_id and l.account_id = a.id
    and exists (select 1 from public.journal_entries e where e.tenant_id = l.tenant_id and e.id = l.entry_id and e.entry_date between p_from and p_to)
  where a.tenant_id = t and a.type in ('income', 'expense')
  group by a.code, a.name, a.type order by a.code;
end $$;

-- Assets = Liabilities + Equity + current surplus (income − expenses to date, until year-end close moves it to Retained Surplus).
create or replace function public.balance_sheet(p_as_of date)
returns table (section text, code text, name text, amount bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('accounts.reports.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
  with bal as (
    select a.code, a.name, a.type, coalesce(sum(l.debit - l.credit), 0)::bigint as net_debit
    from public.accounts a
    left join public.journal_lines l on l.tenant_id = a.tenant_id and l.account_id = a.id
      and exists (select 1 from public.journal_entries e where e.tenant_id = l.tenant_id and e.id = l.entry_id and e.entry_date <= p_as_of)
    where a.tenant_id = t group by a.code, a.name, a.type)
  select 'assets', b.code, b.name, b.net_debit from bal b where b.type = 'asset'
  union all select 'liabilities', b.code, b.name, -b.net_debit from bal b where b.type = 'liability'
  union all select 'equity', b.code, b.name, -b.net_debit from bal b where b.type = 'equity'
  union all select 'equity', '00000', 'Current period surplus', -coalesce(sum(b.net_debit) filter (where b.type in ('income', 'expense')), 0)::bigint from bal b
  order by 1, 2;
end $$;

-- The nightly owner brief (§6.7). Pure data; the job layer formats it for WhatsApp/email.
create or replace function public.daily_closing_report(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); d date; r jsonb;
begin
  if t is null or not app.has_permission('accounts.reports.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  d := coalesce(p_date, app.tenant_today(t));
  select jsonb_build_object(
    'date', d,
    'billed_minor', coalesce((select sum(l.debit) from public.journal_entries e join public.journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
                              join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
                              where e.tenant_id = t and e.source_type = 'voucher' and e.created_at::date = d and a.code = '11000'), 0),
    'collected_by_channel', coalesce((select jsonb_object_agg(channel, total) from (
                              select channel, sum(amount_minor) total from public.payments where tenant_id = t and received_on = d and channel <> 'advance' and voided_at is null group by channel) c), '{}'::jsonb),
    'receivable_minor', coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
                              where l.tenant_id = t and a.code = '11000'), 0),
    'cash_in_hand_minor', coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
                              where l.tenant_id = t and a.code = '10100'), 0),
    'overdue_vouchers', (select count(*) from public.vouchers v where v.tenant_id = t and v.status in ('issued', 'partially_paid') and v.due_date < d),
    'open_cashier_sessions', (select count(*) from public.cashier_sessions where tenant_id = t and status = 'open'),
    'attendance_pct', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where status in ('present', 'late')) / count(*), 1) end
                       from public.student_attendance where tenant_id = t and att_date = d),
    'trial_balance_ok', (select coalesce(sum(debit) = sum(credit), true) from public.journal_lines where tenant_id = t)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------- attendance
create table public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  section_id uuid not null, att_date date not null, locked_at timestamptz, locked_by uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, section_id) references public.sections (tenant_id, id) on delete cascade,
  unique (tenant_id, section_id, att_date)
);

create table public.student_attendance (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null, att_date date not null, section_id uuid not null,
  status text not null check (status in ('present', 'absent', 'late', 'leave')),
  marked_by uuid, marked_at timestamptz not null default now(), note text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (tenant_id, student_id, att_date),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, section_id) references public.sections (tenant_id, id)
);
create index student_attendance_section_idx on public.student_attendance (tenant_id, section_id, att_date);

-- Alerts the job layer delivers (push → WhatsApp → SMS). Written in the same transaction as the attendance mark, deduped per child/day.
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null, dedupe_key text not null, payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);

select app.secure_tenant_table('public.attendance_days', '-', 'attendance.view');
select app.secure_tenant_table('public.notification_outbox', '-', 'settings.manage');
select app.secure_tenant_table('public.student_attendance', '-');
alter policy tenant_select on public.student_attendance using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('attendance.view')) or (select app.is_guardian_of_student(student_id))));
select app.attach_standard_triggers('public.attendance_days', false);
select app.attach_standard_triggers('public.student_attendance', false);
select app.attach_standard_triggers('public.notification_outbox', false);

-- "All present by default, tap the absentees" (§5.5). Permission is checked against the section's CLASS scope, so a teacher
-- assigned to Grade 5 (user_roles.scope_type = 'class') can mark Grade 5 and nothing else. Past or locked days need attendance.edit_past.
create or replace function public.mark_attendance(
  p_section uuid, p_date date, p_absent uuid[] default '{}', p_late uuid[] default '{}', p_leave uuid[] default '{}'
) returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t uuid := app.current_tenant_id(); v_class uuid; v_today date; v_locked boolean; n int := 0; r record;
begin
  if t is null or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select class_id into v_class from public.sections where id = p_section and tenant_id = t;
  if v_class is null then raise exception 'section not found' using errcode = '42501'; end if;
  if not app.has_permission('attendance.mark', 'class', v_class) then raise exception 'permission denied' using errcode = '42501'; end if;

  v_today := app.tenant_today(t);
  if p_date > v_today then raise exception 'cannot mark attendance in the future'; end if;
  select locked_at is not null into v_locked from public.attendance_days where tenant_id = t and section_id = p_section and att_date = p_date;
  if (coalesce(v_locked, false) or p_date < v_today) and not app.has_permission('attendance.edit_past', 'class', v_class) then
    raise exception 'this day is locked — attendance.edit_past is required' using errcode = '42501';
  end if;

  insert into public.attendance_days (tenant_id, section_id, att_date) values (t, p_section, p_date) on conflict do nothing;

  for r in select en.student_id from public.student_enrolments en join public.students s on s.tenant_id = en.tenant_id and s.id = en.student_id
           where en.tenant_id = t and en.section_id = p_section and en.status = 'active' and s.status = 'enrolled' loop
    insert into public.student_attendance (tenant_id, student_id, att_date, section_id, status, marked_by)
    values (t, r.student_id, p_date, p_section,
            case when r.student_id = any (p_absent) then 'absent' when r.student_id = any (p_late) then 'late'
                 when r.student_id = any (p_leave) then 'leave' else 'present' end, auth.uid())
    on conflict (tenant_id, student_id, att_date) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now();
    n := n + 1;
    if r.student_id = any (p_absent) then
      insert into public.notification_outbox (tenant_id, kind, dedupe_key, payload)
      values (t, 'attendance.absent', 'absent:' || r.student_id || ':' || p_date, jsonb_build_object('student_id', r.student_id, 'date', p_date, 'section_id', p_section))
      on conflict (tenant_id, dedupe_key) do nothing;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.lock_attendance_day(p_section uuid, p_date date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_class uuid;
begin
  select class_id into v_class from public.sections where id = p_section and tenant_id = t;
  if t is null or v_class is null or not app.has_permission('attendance.mark', 'class', v_class) then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.attendance_days set locked_at = now(), locked_by = auth.uid() where tenant_id = t and section_id = p_section and att_date = p_date;
  if not found then raise exception 'attendance has not been marked for that day'; end if;
end $$;

create view public.v_attendance_daily with (security_invoker = true) as
select tenant_id, section_id, att_date,
       count(*)::int as total, count(*) filter (where status = 'present')::int as present,
       count(*) filter (where status = 'absent')::int as absent, count(*) filter (where status = 'late')::int as late,
       count(*) filter (where status = 'leave')::int as on_leave
from public.student_attendance group by tenant_id, section_id, att_date;

select app.apply_grants();
grant select on public.v_attendance_daily to authenticated;

revoke all on function public.profit_loss(date, date), public.balance_sheet(date), public.daily_closing_report(date),
  public.mark_attendance(uuid, date, uuid[], uuid[], uuid[]), public.lock_attendance_day(uuid, date) from public, anon, authenticated;
grant execute on function public.profit_loss(date, date), public.balance_sheet(date), public.daily_closing_report(date),
  public.mark_attendance(uuid, date, uuid[], uuid[], uuid[]), public.lock_attendance_day(uuid, date) to authenticated, service_role;

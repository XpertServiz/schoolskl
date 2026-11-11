-- Phase 3 · payroll. Prepared by HR (payroll.prepare), posted by a DIFFERENT person holding payroll.post (2FA) — maker-checker.
--   draft ──post──▶ posted ──pay──▶ paid          (a draft or posted run can be voided; a paid one cannot — correct that with a manual journal)
-- Posting books the expense and the liabilities in the same transaction (rule 2):  Dr 50100/50200 gross  /  Cr 20400 net pay, Cr 20500 deductions.
-- DECISION: no tax or EOBI rate is hard-coded. Statutory deductions are ordinary salary components the school configures (fixed amount or
-- % of basic) because slabs change every budget. Absent-day deduction uses a 30-day month; HR can adjust a draft payslip before posting.

alter table public.staff_members add column category text not null default 'teaching' check (category in ('teaching', 'non_teaching'));

create table public.salary_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null, name text not null, kind text not null check (kind in ('earning', 'deduction')),
  calc text not null default 'fixed' check (calc in ('fixed', 'percent_of_basic')), is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);

create table public.staff_pay (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  staff_id uuid not null, basic_minor bigint not null check (basic_minor >= 0), effective_from date,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (staff_id),
  foreign key (tenant_id, staff_id) references public.staff_members (tenant_id, id) on delete cascade
);
create index staff_pay_tenant_idx on public.staff_pay (tenant_id);

create table public.staff_pay_components (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  staff_id uuid not null, component_id uuid not null,
  value bigint not null check (value >= 0), -- minor units when the component is fixed, basis points (10000 = 100%) when percent_of_basic
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (staff_id, component_id),
  foreign key (tenant_id, staff_id) references public.staff_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, component_id) references public.salary_components (tenant_id, id)
);
create index staff_pay_components_tenant_idx on public.staff_pay_components (tenant_id);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),
  status text not null default 'draft' check (status in ('draft', 'posted', 'paid', 'voided')),
  gross_minor bigint not null default 0, deductions_minor bigint not null default 0, net_minor bigint not null default 0,
  prepared_by uuid, posted_by uuid, posted_at timestamptz, paid_at timestamptz, voided_at timestamptz, void_reason text,
  post_journal_id uuid, pay_journal_id uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index payroll_one_live_run on public.payroll_runs (tenant_id, period) where status <> 'voided';

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  run_id uuid not null, staff_id uuid not null, category text not null,
  basic_minor bigint not null, gross_minor bigint not null, deductions_minor bigint not null, net_minor bigint not null check (net_minor >= 0),
  absent_days int not null default 0, lines jsonb not null,
  published boolean not null default false, -- visible to the staff member only while the run is posted/paid (set by post_payroll, cleared by void_payroll)
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, run_id) references public.payroll_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, staff_id) references public.staff_members (tenant_id, id),
  unique (run_id, staff_id), unique (tenant_id, id)
);
create index payslips_staff_idx on public.payslips (tenant_id, staff_id);

-- ---------------------------------------------------------------- policies
select app.secure_tenant_table('public.salary_components', 'payroll.prepare', 'payroll.prepare');
select app.secure_tenant_table('public.staff_pay', 'payroll.prepare', 'payroll.prepare');
select app.secure_tenant_table('public.staff_pay_components', 'payroll.prepare', 'payroll.prepare');
select app.secure_tenant_table('public.payroll_runs', '-', 'payroll.prepare');
select app.secure_tenant_table('public.payslips', '-');
-- HR sees every payslip; a staff member sees only their own, and only once it is posted
alter policy tenant_select on public.payslips using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('payroll.prepare'))
       or (published and exists (select 1 from public.staff_members m where m.tenant_id = payslips.tenant_id and m.id = payslips.staff_id and m.user_id = (select auth.uid())))));

select app.attach_standard_triggers('public.salary_components');
select app.attach_standard_triggers('public.staff_pay');
select app.attach_standard_triggers('public.staff_pay_components');
select app.attach_standard_triggers('public.payroll_runs', false);
select app.attach_standard_triggers('public.payslips', false);

-- ---------------------------------------------------------------- helpers
create or replace function app.seed_chart_payroll(p_tenant uuid) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.accounts (tenant_id, code, name, type, normal_side, is_system) values
    (p_tenant, '20500', 'Payroll Deductions Payable', 'liability', 'credit', true),
    (p_tenant, '50200', 'Non-teaching Salaries', 'expense', 'debit', true)
  on conflict (tenant_id, code) do nothing
$$;

create or replace function app.payslip_totals(p_payslip uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.payslips; v_earn bigint; v_ded bigint;
begin
  select * into p from public.payslips where id = p_payslip;
  select coalesce(sum((l ->> 'amount')::bigint) filter (where l ->> 'kind' = 'earning'), 0), coalesce(sum((l ->> 'amount')::bigint) filter (where l ->> 'kind' = 'deduction'), 0)
    into v_earn, v_ded from jsonb_array_elements(p.lines) l;
  if p.basic_minor + v_earn - v_ded < 0 then raise exception 'net pay would be negative'; end if;
  update public.payslips set gross_minor = p.basic_minor + v_earn, deductions_minor = v_ded, net_minor = p.basic_minor + v_earn - v_ded where id = p.id;
  update public.payroll_runs r set gross_minor = x.g, deductions_minor = x.d, net_minor = x.n
  from (select sum(gross_minor) g, sum(deductions_minor) d, sum(net_minor) n from public.payslips where run_id = p.run_id) x where r.id = p.run_id;
end $$;

-- ---------------------------------------------------------------- run lifecycle
create or replace function public.prepare_payroll(p_period date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t uuid := app.current_tenant_id(); m date := date_trunc('month', p_period)::date; v_run uuid; s record; c record; v_slip uuid;
  v_lines jsonb; v_absent int; v_amt bigint; n int := 0;
begin
  if t is null or not app.has_permission('payroll.prepare') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if m > date_trunc('month', app.tenant_today(t))::date then raise exception 'cannot prepare payroll for a future month'; end if;
  perform app.seed_chart_payroll(t);
  if exists (select 1 from public.payroll_runs where tenant_id = t and period = m and status <> 'voided') then raise exception 'a payroll run for % already exists', to_char(m, 'YYYY-MM'); end if;
  insert into public.payroll_runs (tenant_id, period, prepared_by) values (t, m, auth.uid()) returning id into v_run;

  for s in select sm.id, sm.category, sp.basic_minor from public.staff_members sm join public.staff_pay sp on sp.tenant_id = sm.tenant_id and sp.staff_id = sm.id
           where sm.tenant_id = t and sm.status = 'active' and (sm.joined_on is null or sm.joined_on < (m + interval '1 month')::date) order by sm.employee_no loop
    v_lines := '[]'::jsonb;
    for c in select sc.code, sc.name, sc.kind, sc.calc, spc.value from public.staff_pay_components spc
             join public.salary_components sc on sc.tenant_id = spc.tenant_id and sc.id = spc.component_id and sc.is_active
             where spc.tenant_id = t and spc.staff_id = s.id order by sc.kind desc, sc.code loop
      v_amt := case c.calc when 'fixed' then c.value else (s.basic_minor * c.value + 5000) / 10000 end;
      if v_amt > 0 then v_lines := v_lines || jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind, 'amount', v_amt); end if;
    end loop;
    select count(*)::int into v_absent from public.staff_attendance where tenant_id = t and staff_id = s.id and status = 'absent'
      and att_date >= m and att_date < (m + interval '1 month')::date;
    v_amt := (s.basic_minor * v_absent + 15) / 30;
    if v_amt > 0 then v_lines := v_lines || jsonb_build_object('code', 'ABSENT', 'name', 'Absent days (' || v_absent || ')', 'kind', 'deduction', 'amount', v_amt); end if;

    insert into public.payslips (tenant_id, run_id, staff_id, category, basic_minor, gross_minor, deductions_minor, net_minor, absent_days, lines)
    values (t, v_run, s.id, s.category, s.basic_minor, 0, 0, 0, v_absent, v_lines) returning id into v_slip;
    perform app.payslip_totals(v_slip);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'no active staff with a pay record'; end if;
  return v_run;
end $$;

-- One-off bonus or deduction on a DRAFT payslip (e.g. an advance recovered this month).
create or replace function public.adjust_payslip(p_payslip uuid, p_name text, p_kind text, p_amount bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); p public.payslips; r public.payroll_runs;
begin
  if t is null or not app.has_permission('payroll.prepare') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_kind not in ('earning', 'deduction') or p_amount is null or p_amount <= 0 or coalesce(btrim(p_name), '') = '' then raise exception 'a name, a kind and a positive amount are required'; end if;
  select * into p from public.payslips where id = p_payslip and tenant_id = t for update;
  if not found then raise exception 'payslip not found' using errcode = '42501'; end if;
  select * into r from public.payroll_runs where id = p.run_id for update;
  if r.status <> 'draft' then raise exception 'only a draft payroll can be adjusted'; end if;
  update public.payslips set lines = lines || jsonb_build_object('code', 'ADJ', 'name', p_name, 'kind', p_kind, 'amount', p_amount) where id = p.id;
  perform app.payslip_totals(p.id);
end $$;

create or replace function public.post_payroll(p_run uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); r public.payroll_runs; v_teach bigint; v_non bigint; v_lines jsonb; v_entry uuid;
begin
  if t is null or not app.has_permission('payroll.post') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into r from public.payroll_runs where id = p_run and tenant_id = t for update;
  if not found then raise exception 'payroll run not found' using errcode = '42501'; end if;
  if r.status <> 'draft' then raise exception 'payroll is already %', r.status; end if;
  if r.prepared_by is not distinct from auth.uid() then raise exception 'maker-checker: the person who prepared payroll cannot post it' using errcode = '42501'; end if;
  select coalesce(sum(gross_minor) filter (where category = 'teaching'), 0), coalesce(sum(gross_minor) filter (where category = 'non_teaching'), 0) into v_teach, v_non
    from public.payslips where run_id = r.id;
  v_lines := '[]'::jsonb;
  if v_teach > 0 then v_lines := v_lines || jsonb_build_object('a', '50100', 'd', v_teach); end if;
  if v_non > 0 then v_lines := v_lines || jsonb_build_object('a', '50200', 'd', v_non); end if;
  v_lines := v_lines || jsonb_build_object('a', '20400', 'c', r.net_minor);
  if r.deductions_minor > 0 then v_lines := v_lines || jsonb_build_object('a', '20500', 'c', r.deductions_minor); end if;
  v_entry := app.post_journal(t, null, (r.period + interval '1 month - 1 day')::date, 'Payroll ' || to_char(r.period, 'YYYY-MM'), 'payroll', r.id, v_lines);
  update public.payroll_runs set status = 'posted', posted_by = auth.uid(), posted_at = now(), post_journal_id = v_entry where id = r.id;
  update public.payslips set published = true where run_id = r.id;
  return v_entry;
end $$;

create or replace function public.mark_payroll_paid(p_run uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); r public.payroll_runs; v_entry uuid;
begin
  if t is null or not app.has_permission('payroll.post') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into r from public.payroll_runs where id = p_run and tenant_id = t for update;
  if not found then raise exception 'payroll run not found' using errcode = '42501'; end if;
  if r.status <> 'posted' then raise exception 'only a posted payroll can be marked paid (it is %)', r.status; end if;
  -- DECISION: salaries are paid from the bank (bank transfer / cheque / IBFT file). Cash payroll would bypass the cashier-drawer control.
  v_entry := app.post_journal(t, null, app.tenant_today(t), 'Salaries paid ' || to_char(r.period, 'YYYY-MM'), 'payroll_payment', r.id, jsonb_build_array(
    jsonb_build_object('a', '20400', 'd', r.net_minor), jsonb_build_object('a', '10200', 'c', r.net_minor)));
  update public.payroll_runs set status = 'paid', paid_at = now(), pay_journal_id = v_entry where id = r.id;
  return v_entry;
end $$;

create or replace function public.void_payroll(p_run uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); r public.payroll_runs;
begin
  if t is null or not app.has_permission('payroll.post') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into r from public.payroll_runs where id = p_run and tenant_id = t for update;
  if not found then raise exception 'payroll run not found' using errcode = '42501'; end if;
  if r.status = 'paid' then raise exception 'salaries were already paid — correct that with a manual journal'; end if;
  if r.status = 'voided' then raise exception 'payroll is already voided'; end if;
  if r.status = 'posted' then perform app.reverse_entry(t, r.post_journal_id, 'Payroll voided: ' || p_reason); end if;
  update public.payroll_runs set status = 'voided', voided_at = now(), void_reason = p_reason where id = r.id;
  update public.payslips set published = false where run_id = r.id;
end $$;

-- ---------------------------------------------------------------- grants
select app.apply_grants();
select app.harden_internal_functions();

revoke all on function public.prepare_payroll(date), public.adjust_payslip(uuid, text, text, bigint), public.post_payroll(uuid),
  public.mark_payroll_paid(uuid), public.void_payroll(uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_payroll(date), public.adjust_payslip(uuid, text, text, bigint), public.post_payroll(uuid),
  public.mark_payroll_paid(uuid), public.void_payroll(uuid, text) to authenticated, service_role;

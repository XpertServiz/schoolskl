-- Phase 2 · fee operations that complete the money core:
--   * cancel voucher / void payment  — the ONLY way to correct business-event journals (reversal journals + row state, one transaction)
--   * refunds of advance, security deposits
--   * instalment plans, promises-to-pay, reminder ladder (outbox), family default-risk score (explainable, family-level only)
--   * fee-increase cap guard
-- Every money movement posts a balanced journal in the same transaction (CLAUDE.md rule 2).

-- ---------------------------------------------------------------- tables
create table public.family_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  family_id uuid not null, amount_minor bigint not null check (amount_minor > 0), channel text not null check (channel in ('bank')),
  reason text not null, idempotency_key text not null, refunded_on date not null, approved_by uuid, journal_entry_id uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, family_id) references public.families (tenant_id, id),
  unique (tenant_id, idempotency_key), unique (tenant_id, id)
);
create index family_refunds_family_idx on public.family_refunds (tenant_id, family_id);

create table public.security_deposits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  family_id uuid not null, student_id uuid, amount_minor bigint not null check (amount_minor > 0),
  channel text not null check (channel in ('cash', 'bank')), cashier_session_id uuid, idempotency_key text not null,
  status text not null default 'held' check (status in ('held', 'refunded')),
  collected_on date not null, collect_journal_id uuid,
  refunded_on date, refunded_minor bigint, forfeited_minor bigint, refund_reason text, refund_journal_id uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, family_id) references public.families (tenant_id, id),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id),
  foreign key (tenant_id, cashier_session_id) references public.cashier_sessions (tenant_id, id),
  unique (tenant_id, idempotency_key), unique (tenant_id, id)
);
create index security_deposits_family_idx on public.security_deposits (tenant_id, family_id);

create table public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  voucher_id uuid not null, family_id uuid not null,
  status text not null default 'active' check (status in ('active', 'completed', 'defaulted', 'cancelled')),
  paid_base bigint not null check (paid_base >= 0), -- voucher.paid_minor when the plan was agreed: later payments fund the instalments in order
  note text, approved_by uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, voucher_id) references public.vouchers (tenant_id, id),
  unique (tenant_id, id)
);
create unique index installment_one_active on public.installment_plans (tenant_id, voucher_id) where status = 'active';
create index installment_plans_family_idx on public.installment_plans (tenant_id, family_id);

create table public.installments (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null, voucher_id uuid not null, seq int not null check (seq > 0),
  due_date date not null, amount_minor bigint not null check (amount_minor > 0),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (plan_id, seq),
  foreign key (tenant_id, plan_id) references public.installment_plans (tenant_id, id) on delete cascade
);
create index installments_tenant_idx on public.installments (tenant_id, voucher_id);

create table public.payment_promises (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  family_id uuid not null, voucher_id uuid, amount_minor bigint not null check (amount_minor > 0), promised_on date not null, note text,
  status text not null default 'open' check (status in ('open', 'kept', 'broken', 'cancelled')), resolved_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, family_id) references public.families (tenant_id, id),
  foreign key (tenant_id, voucher_id) references public.vouchers (tenant_id, id)
);
create index payment_promises_family_idx on public.payment_promises (tenant_id, family_id, status);

create table public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  step int not null check (step > 0), days_from_due int not null check (days_from_due between -30 and 120),
  channel text not null check (channel in ('app', 'whatsapp', 'sms')), tone text not null check (tone in ('gentle', 'firm', 'final')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, step)
);

create table public.fee_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  voucher_id uuid not null, family_id uuid not null, step int not null, channel text not null, tone text not null,
  queued_on date not null, outbox_id uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, voucher_id) references public.vouchers (tenant_id, id),
  unique (tenant_id, voucher_id, step)
);
create index fee_reminders_family_idx on public.fee_reminders (tenant_id, family_id);

create table public.fee_policy (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  max_increase_bps int check (max_increase_bps between 0 and 100000), -- null = no cap. 1000 = a fee line may not rise more than 10% above its baseline
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now()
);

alter table public.fee_structure_lines add column baseline_minor bigint; -- the amount the line first had; the cap is measured against it, so 10% + 10% + 10% cannot sneak past

-- ---------------------------------------------------------------- policies
select app.secure_tenant_table('public.reminder_rules', 'fees.structure.edit', 'fees.view');
select app.secure_tenant_table('public.fee_policy', 'settings.manage', 'fees.view');
select app.secure_tenant_table('public.fee_reminders', '-', 'fees.view');
select app.secure_tenant_table('public.family_refunds', '-', 'fees.view');
select app.secure_tenant_table('public.security_deposits', '-');
alter policy tenant_select on public.security_deposits using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('fees.view')) or (select app.is_guardian_of_family(family_id))));
select app.secure_tenant_table('public.payment_promises', '-');
alter policy tenant_select on public.payment_promises using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('fees.view')) or (select app.is_guardian_of_family(family_id))));
select app.secure_tenant_table('public.installment_plans', '-');
alter policy tenant_select on public.installment_plans using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('fees.view')) or (select app.is_guardian_of_family(family_id))));
select app.secure_tenant_table('public.installments', '-');
alter policy tenant_select on public.installments using (tenant_id = (select app.current_tenant_id()) and (select app.can_see_voucher(voucher_id)));

select app.attach_standard_triggers('public.reminder_rules');
select app.attach_standard_triggers('public.fee_policy');
select app.attach_standard_triggers('public.fee_reminders', false);
select app.attach_standard_triggers('public.family_refunds', false);
select app.attach_standard_triggers('public.security_deposits', false);
select app.attach_standard_triggers('public.payment_promises', false);
select app.attach_standard_triggers('public.installment_plans', false);
select app.attach_standard_triggers('public.installments', false);

-- ---------------------------------------------------------------- helpers
create or replace function app.family_advance(p_tenant uuid, p_family uuid) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(l.credit - l.debit), 0)::bigint from public.journal_lines l
  join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
  where l.tenant_id = p_tenant and l.family_id = p_family and a.code = '20200'
$$;

-- Mirror image of an existing entry, dated today (closed months stay closed). One reversal per entry is enforced by the unique index.
create or replace function app.reverse_entry(p_tenant uuid, p_entry uuid, p_memo text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.journal_entries; v_lines jsonb;
begin
  select * into e from public.journal_entries where id = p_entry and tenant_id = p_tenant;
  if not found then raise exception 'journal entry not found'; end if;
  select jsonb_agg(jsonb_build_object('a', a.code, 'd', l.credit, 'c', l.debit, 'f', l.family_id)) into v_lines
  from public.journal_lines l join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
  where l.tenant_id = p_tenant and l.entry_id = e.id;
  return app.post_journal(p_tenant, e.campus_id, app.tenant_today(p_tenant), p_memo, 'reversal', null, v_lines, e.id);
end $$;

-- ---------------------------------------------------------------- void payment
create or replace function app.void_payment_core(p_tenant uuid, p_payment uuid, p_reason text, p_actor uuid, p_internal boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.payments; a record; v_remainder bigint; v_rev uuid; v_status text;
begin
  select * into p from public.payments where id = p_payment and tenant_id = p_tenant for update;
  if not found then raise exception 'payment not found' using errcode = '42501'; end if;
  if p.voided_at is not null then raise exception 'payment is already void'; end if;
  if p.channel = 'advance' and not p_internal then
    raise exception 'advance applications are released by cancelling the voucher, not voided directly';
  end if;
  if p.cashier_session_id is not null then
    select status into v_status from public.cashier_sessions where id = p.cashier_session_id;
    if v_status = 'closed' then
      raise exception 'this cash was counted when the cashier session closed — correct it with a refund instead';
    end if;
  end if;
  v_remainder := p.amount_minor - coalesce((select sum(amount_minor) from public.payment_allocations where payment_id = p.id), 0);
  if v_remainder > 0 and app.family_advance(p_tenant, p.family_id) < v_remainder then
    raise exception 'the advance from this payment was already applied to later vouchers — cancel or release those first';
  end if;
  for a in select * from public.payment_allocations where payment_id = p.id loop
    update public.vouchers set paid_minor = paid_minor - a.amount_minor where id = a.voucher_id and tenant_id = p_tenant;
    perform app.refresh_voucher_status(a.voucher_id);
  end loop;
  v_rev := app.reverse_entry(p_tenant, p.journal_entry_id, 'Void payment: ' || p_reason);
  update public.payments set voided_at = now(), voided_by = p_actor, void_reason = p_reason, void_journal_id = v_rev where id = p.id;
end $$;

create or replace function public.void_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  -- DECISION: voiding takes the refund-approval key (MFA): it is the same trust level as handing money back.
  if t is null or not app.has_permission('fees.refund.approve') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  perform app.void_payment_core(t, p_payment, p_reason, auth.uid());
end $$;

-- ---------------------------------------------------------------- cancel voucher
create or replace function public.cancel_voucher(p_voucher uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v public.vouchers; r record; v_entry uuid;
begin
  if t is null or not app.has_permission('fees.voucher.cancel') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into v from public.vouchers where id = p_voucher and tenant_id = t for update;
  if not found then raise exception 'voucher not found' using errcode = '42501'; end if;
  if v.status = 'cancelled' then raise exception 'voucher is already cancelled'; end if;
  if exists (select 1 from public.payment_allocations a join public.payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
             where a.voucher_id = v.id and p.voided_at is null and p.channel <> 'advance') then
    raise exception 'money was received against this voucher — void those payments first';
  end if;
  -- advance that was consumed by this voucher goes back to the family's advance balance
  for r in select p.id from public.payment_allocations a join public.payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
           where a.voucher_id = v.id and p.voided_at is null and p.channel = 'advance' loop
    perform app.void_payment_core(t, r.id, 'voucher ' || v.voucher_no || ' cancelled', auth.uid(), true);
  end loop;
  -- fines / waivers / write-offs, then the voucher itself
  for r in select journal_entry_id from public.voucher_adjustments where tenant_id = t and voucher_id = v.id and journal_entry_id is not null loop
    perform app.reverse_entry(t, r.journal_entry_id, 'Voucher ' || v.voucher_no || ' cancelled: ' || p_reason);
  end loop;
  select id into v_entry from public.journal_entries where tenant_id = t and source_type = 'voucher' and source_id = v.id and reversal_of is null;
  if v_entry is not null then perform app.reverse_entry(t, v_entry, 'Voucher ' || v.voucher_no || ' cancelled: ' || p_reason); end if;
  update public.vouchers set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason where id = v.id;
  update public.installment_plans set status = 'cancelled' where tenant_id = t and voucher_id = v.id and status = 'active';
end $$;

-- ---------------------------------------------------------------- refunds & security deposits
create or replace function public.refund_advance(p_family uuid, p_amount bigint, p_reason text, p_key text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_ex public.family_refunds; v_id uuid; v_entry uuid;
begin
  if t is null or not app.has_permission('fees.refund.approve') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into v_ex from public.family_refunds where tenant_id = t and idempotency_key = p_key;
  if found then
    if v_ex.amount_minor <> p_amount or v_ex.family_id <> p_family then raise exception 'idempotency key % reused with different details', p_key using errcode = '23505'; end if;
    return v_ex.id;
  end if;
  if not exists (select 1 from public.families where id = p_family and tenant_id = t) then raise exception 'family not found' using errcode = '42501'; end if;
  perform 1 from public.families where id = p_family and tenant_id = t for update; -- serialise refunds per family
  if p_amount > app.family_advance(t, p_family) then raise exception 'refund exceeds the advance held for this family'; end if;
  -- DECISION: refunds are paid by bank transfer / cheque only. Cash refunds would break the cashier-drawer count.
  insert into public.family_refunds (tenant_id, family_id, amount_minor, channel, reason, idempotency_key, refunded_on, approved_by)
  values (t, p_family, p_amount, 'bank', p_reason, p_key, app.tenant_today(t), auth.uid()) returning id into v_id;
  v_entry := app.post_journal(t, null, app.tenant_today(t), 'Advance refunded', 'refund', v_id, jsonb_build_array(
    jsonb_build_object('a', '20200', 'd', p_amount, 'f', p_family), jsonb_build_object('a', '10200', 'c', p_amount)));
  update public.family_refunds set journal_entry_id = v_entry where id = v_id;
  return v_id;
end $$;

create or replace function public.collect_security_deposit(p_family uuid, p_amount bigint, p_channel text, p_key text, p_student uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_ex public.security_deposits; v_id uuid; v_sess public.cashier_sessions; v_entry uuid;
begin
  if t is null or not app.has_permission('fees.collect') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_channel not in ('cash', 'bank') then raise exception 'deposits are taken in cash or by bank transfer'; end if;
  select * into v_ex from public.security_deposits where tenant_id = t and idempotency_key = p_key;
  if found then
    if v_ex.amount_minor <> p_amount or v_ex.family_id <> p_family then raise exception 'idempotency key % reused with different details', p_key using errcode = '23505'; end if;
    return v_ex.id;
  end if;
  if not exists (select 1 from public.families where id = p_family and tenant_id = t) then raise exception 'family not found' using errcode = '42501'; end if;
  if p_channel = 'cash' then
    select * into v_sess from public.cashier_sessions where tenant_id = t and cashier_id = auth.uid() and status = 'open';
    if not found then raise exception 'open a cashier session before taking cash'; end if;
  end if;
  insert into public.security_deposits (tenant_id, family_id, student_id, amount_minor, channel, cashier_session_id, idempotency_key, collected_on)
  values (t, p_family, p_student, p_amount, p_channel, v_sess.id, p_key, app.tenant_today(t)) returning id into v_id;
  v_entry := app.post_journal(t, v_sess.campus_id, app.tenant_today(t), 'Security deposit received', 'security_deposit', v_id, jsonb_build_array(
    jsonb_build_object('a', app.channel_account(p_channel), 'd', p_amount), jsonb_build_object('a', '20300', 'c', p_amount, 'f', p_family)));
  update public.security_deposits set collect_journal_id = v_entry where id = v_id;
  return v_id;
end $$;

-- Return a deposit, optionally keeping part of it (damage / dues). The kept part is income (49000) — and needs a reason.
create or replace function public.refund_security_deposit(p_deposit uuid, p_deduction_minor bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); d public.security_deposits; v_out bigint; v_lines jsonb; v_entry uuid;
begin
  if t is null or not app.has_permission('fees.refund.approve') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into d from public.security_deposits where id = p_deposit and tenant_id = t for update;
  if not found then raise exception 'deposit not found' using errcode = '42501'; end if;
  if d.status <> 'held' then raise exception 'deposit is already %', d.status; end if;
  if p_deduction_minor < 0 or p_deduction_minor > d.amount_minor then raise exception 'deduction must be between 0 and the deposit'; end if;
  v_out := d.amount_minor - p_deduction_minor;
  v_lines := jsonb_build_array(jsonb_build_object('a', '20300', 'd', d.amount_minor, 'f', d.family_id));
  if v_out > 0 then v_lines := v_lines || jsonb_build_object('a', '10200', 'c', v_out); end if;
  if p_deduction_minor > 0 then v_lines := v_lines || jsonb_build_object('a', '49000', 'c', p_deduction_minor); end if;
  v_entry := app.post_journal(t, null, app.tenant_today(t), 'Security deposit settled', 'deposit_refund', d.id, v_lines);
  update public.security_deposits set status = 'refunded', refunded_on = app.tenant_today(t), refunded_minor = v_out,
    forfeited_minor = p_deduction_minor, refund_reason = p_reason, refund_journal_id = v_entry where id = d.id;
end $$;

-- the drawer the cashier counts holds fee cash AND deposit cash taken in the session; voided payments are not in it
create or replace function public.close_cashier_session(p_session uuid, p_counted_minor bigint) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); s public.cashier_sessions; v_expected bigint; v_var bigint; v_date date;
begin
  if t is null or not app.has_permission('fees.collect') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into s from public.cashier_sessions where id = p_session and tenant_id = t and status = 'open' for update;
  if not found then raise exception 'no such open session' using errcode = '42501'; end if;
  if s.cashier_id <> auth.uid() then raise exception 'only the cashier can close their own session' using errcode = '42501'; end if;
  if p_counted_minor < 0 then raise exception 'counted amount cannot be negative'; end if;
  select coalesce((select sum(amount_minor) from public.payments where tenant_id = t and cashier_session_id = s.id and voided_at is null), 0)
       + coalesce((select sum(amount_minor) from public.security_deposits where tenant_id = t and cashier_session_id = s.id), 0) into v_expected;
  v_var := p_counted_minor - v_expected; v_date := app.tenant_today(t);
  if v_var <> 0 then
    perform app.post_journal(t, s.campus_id, v_date, 'Cash variance at close', 'cash_variance', s.id, case when v_var < 0
      then jsonb_build_array(jsonb_build_object('a', '60900', 'd', -v_var), jsonb_build_object('a', '10100', 'c', -v_var))
      else jsonb_build_array(jsonb_build_object('a', '10100', 'd', v_var), jsonb_build_object('a', '60900', 'c', v_var)) end);
  end if;
  update public.cashier_sessions set status = 'closed', closed_at = now(), expected_minor = v_expected, counted_minor = p_counted_minor, variance_minor = v_var where id = s.id;
  return v_var;
end $$;

-- ---------------------------------------------------------------- instalment plans
create or replace function public.create_installment_plan(p_voucher uuid, p_dates date[], p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v public.vouchers; bal bigint; n int; base bigint; rem bigint; i int; v_plan uuid; today date;
begin
  -- DECISION: agreeing a plan is a concession of time, so it takes the concession-approval key, not just the cashier's.
  if t is null or not app.has_permission('fees.concession.approve') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  today := app.tenant_today(t);
  select * into v from public.vouchers where id = p_voucher and tenant_id = t for update;
  if not found then raise exception 'voucher not found' using errcode = '42501'; end if;
  if v.status not in ('issued', 'partially_paid') then raise exception 'only an open voucher can be put on a plan'; end if;
  bal := v.total_minor + v.adjusted_minor - v.paid_minor;
  if bal <= 0 then raise exception 'nothing is outstanding on this voucher'; end if;
  n := coalesce(array_length(p_dates, 1), 0);
  if n < 2 or n > 12 then raise exception 'a plan has between 2 and 12 instalments'; end if;
  for i in 1..n loop
    if p_dates[i] is null or (i > 1 and p_dates[i] <= p_dates[i - 1]) then raise exception 'instalment dates must be increasing'; end if;
  end loop;
  if p_dates[1] < today then raise exception 'the first instalment cannot be in the past'; end if;
  if bal < n then raise exception 'balance is too small to split into % instalments', n; end if;
  if exists (select 1 from public.installment_plans where tenant_id = t and voucher_id = v.id and status = 'active') then raise exception 'this voucher already has an active plan'; end if;

  insert into public.installment_plans (tenant_id, voucher_id, family_id, paid_base, note, approved_by)
  values (t, v.id, v.family_id, v.paid_minor, p_note, auth.uid()) returning id into v_plan;
  base := bal / n; rem := bal - base * n; -- largest remainder: the first `rem` instalments carry one extra minor unit
  for i in 1..n loop
    insert into public.installments (tenant_id, plan_id, voucher_id, seq, due_date, amount_minor)
    values (t, v_plan, v.id, i, p_dates[i], base + case when i <= rem then 1 else 0 end);
  end loop;
  return v_plan;
end $$;

create view public.v_installment_status with (security_invoker = true) as
select i.tenant_id, i.plan_id, i.voucher_id, p.family_id, p.status as plan_status, i.seq, i.due_date, i.amount_minor,
       sum(i.amount_minor) over (partition by i.plan_id order by i.seq)::bigint as cumulative_minor,
       greatest(v.paid_minor - p.paid_base, 0)::bigint as paid_toward_minor,
       greatest(v.paid_minor - p.paid_base, 0) >= sum(i.amount_minor) over (partition by i.plan_id order by i.seq) as is_paid
from public.installments i
join public.installment_plans p on p.tenant_id = i.tenant_id and p.id = i.plan_id
join public.vouchers v on v.tenant_id = i.tenant_id and v.id = i.voucher_id;

-- Daily job: finish plans whose voucher is settled; mark a plan 'defaulted' when an instalment is overdue past the fine grace period
-- (fines and reminders resume for that voucher).
create or replace function public.review_installment_plans(p_as_of date default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); p public.installment_plans; v public.vouchers; d date; grace int; n int := 0; v_late boolean;
begin
  if t is null or not app.has_permission('fees.voucher.generate') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  d := coalesce(p_as_of, app.tenant_today(t));
  select coalesce((select grace_days from public.fine_rules where tenant_id = t), 0) into grace;
  for p in select * from public.installment_plans where tenant_id = t and status = 'active' for update loop
    select * into v from public.vouchers where id = p.voucher_id;
    if v.status = 'cancelled' then
      update public.installment_plans set status = 'cancelled' where id = p.id; n := n + 1;
    elsif v.total_minor + v.adjusted_minor - v.paid_minor <= 0 then
      update public.installment_plans set status = 'completed' where id = p.id; n := n + 1;
    else
      select exists (select 1 from public.v_installment_status s where s.plan_id = p.id and not s.is_paid and s.due_date + grace < d) into v_late;
      if v_late then update public.installment_plans set status = 'defaulted' where id = p.id; n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- promises to pay
create or replace function public.record_promise(p_family uuid, p_amount bigint, p_on date, p_note text default null, p_voucher uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_id uuid; today date;
begin
  if t is null or not app.has_permission('fees.collect') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  today := app.tenant_today(t);
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  -- DECISION: a promise can pause reminders for at most 60 days, otherwise it is just a way to switch the ladder off.
  if p_on < today or p_on > today + 60 then raise exception 'promised date must be within the next 60 days'; end if;
  if not exists (select 1 from public.families where id = p_family and tenant_id = t) then raise exception 'family not found' using errcode = '42501'; end if;
  insert into public.payment_promises (tenant_id, family_id, voucher_id, amount_minor, promised_on, note)
  values (t, p_family, p_voucher, p_amount, p_on, p_note) returning id into v_id;
  return v_id;
end $$;

-- A promise is kept when the family paid at least the promised amount between the day it was made and the promised date.
create or replace function public.review_promises(p_as_of date default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); d date; r record; v_paid bigint; n int := 0;
begin
  if t is null or not app.has_permission('fees.voucher.generate') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  d := coalesce(p_as_of, app.tenant_today(t));
  for r in select * from public.payment_promises where tenant_id = t and status = 'open' and promised_on < d for update loop
    select coalesce(sum(amount_minor), 0) into v_paid from public.payments
      where tenant_id = t and family_id = r.family_id and channel <> 'advance' and voided_at is null
        and received_on >= r.created_at::date and received_on <= r.promised_on;
    update public.payment_promises set status = case when v_paid >= r.amount_minor then 'kept' else 'broken' end, resolved_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- reminder ladder
-- DECISION: default ladder (gentle before due, firm after, final at two weeks); a school edits public.reminder_rules to change it.
create or replace function app.seed_reminder_rules(p_tenant uuid) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.reminder_rules (tenant_id, step, days_from_due, channel, tone) values
    (p_tenant, 1, -3, 'app', 'gentle'), (p_tenant, 2, 0, 'whatsapp', 'gentle'), (p_tenant, 3, 3, 'whatsapp', 'firm'),
    (p_tenant, 4, 7, 'sms', 'firm'), (p_tenant, 5, 14, 'sms', 'final')
  on conflict (tenant_id, step) do nothing
$$;

-- For each open voucher, queue ONLY the latest step that is due and not yet sent (a late job run never fires the whole ladder at once).
-- Skipped while a promise-to-pay is still in date or an instalment plan is on track. The payload names the family's voucher, never labels anyone.
create or replace function public.queue_fee_reminders(p_as_of date default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); d date; v record; r public.reminder_rules; n int := 0; v_out uuid; diff int; bal bigint;
begin
  if t is null or not app.has_permission('fees.voucher.generate') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  d := coalesce(p_as_of, app.tenant_today(t));
  if not exists (select 1 from public.reminder_rules where tenant_id = t) then perform app.seed_reminder_rules(t); end if;
  for v in select * from public.vouchers where tenant_id = t and status in ('issued', 'partially_paid') and total_minor + adjusted_minor - paid_minor > 0 loop
    continue when exists (select 1 from public.payment_promises p where p.tenant_id = t and p.family_id = v.family_id and p.status = 'open' and p.promised_on >= d
                          and (p.voucher_id is null or p.voucher_id = v.id));
    continue when exists (select 1 from public.installment_plans ip where ip.tenant_id = t and ip.voucher_id = v.id and ip.status = 'active');
    diff := d - v.due_date;
    select * into r from public.reminder_rules where tenant_id = t and is_active and days_from_due <= diff order by days_from_due desc limit 1;
    continue when not found;
    continue when exists (select 1 from public.fee_reminders f where f.tenant_id = t and f.voucher_id = v.id and f.step >= r.step);
    bal := v.total_minor + v.adjusted_minor - v.paid_minor;
    insert into public.notification_outbox (tenant_id, kind, dedupe_key, payload)
    values (t, 'fee.reminder', 'fee.reminder:' || v.id || ':' || r.step,
            jsonb_build_object('family_id', v.family_id, 'voucher_id', v.id, 'voucher_no', v.voucher_no, 'consumer_no', v.consumer_no,
                               'balance_minor', bal, 'due_date', v.due_date, 'step', r.step, 'tone', r.tone, 'channel', r.channel))
    on conflict (tenant_id, dedupe_key) do nothing returning id into v_out;
    insert into public.fee_reminders (tenant_id, voucher_id, family_id, step, channel, tone, queued_on, outbox_id)
    values (t, v.id, v.family_id, r.step, r.channel, r.tone, d, v_out) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- default-risk score (family-level, explainable)
-- Rule 4: this scores how a FAMILY's fee payments are going so the office can phone earlier. It never labels a child, is not shown to
-- teachers or parents, and every point is traceable to a factor in `factors`.
create or replace function app.family_fee_risk(p_tenant uuid, p_family uuid)
returns table (score int, band text, factors jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_billed bigint; v_overdue bigint; v_max_days int; v_late int; v_broken int;
  s_overdue int; s_days int; s_late int; s_broken int; v_score int;
begin
  select coalesce(sum(total_minor + adjusted_minor), 0) into v_billed from (
    select total_minor, adjusted_minor from public.vouchers where tenant_id = p_tenant and family_id = p_family and status <> 'cancelled'
    order by period desc limit 12) x;
  select coalesce(sum(total_minor + adjusted_minor - paid_minor), 0), coalesce(max(greatest(app.tenant_today(p_tenant) - due_date, 0)), 0)
    into v_overdue, v_max_days
  from public.vouchers where tenant_id = p_tenant and family_id = p_family and status in ('issued', 'partially_paid')
    and due_date < app.tenant_today(p_tenant) and total_minor + adjusted_minor - paid_minor > 0;
  select count(*)::int into v_late from public.vouchers v where v.tenant_id = p_tenant and v.family_id = p_family and v.status = 'paid'
    and v.period >= (app.tenant_today(p_tenant) - interval '6 months')::date
    and (select max(p.received_on) from public.payment_allocations a join public.payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
         where a.voucher_id = v.id and p.voided_at is null) > v.due_date;
  select count(*)::int into v_broken from public.payment_promises where tenant_id = p_tenant and family_id = p_family and status = 'broken'
    and created_at >= now() - interval '12 months';

  s_overdue := round(40 * least(1.0, v_overdue::numeric / greatest(v_billed, 1)))::int;
  s_days := round(25 * least(1.0, v_max_days::numeric / 90))::int;
  s_late := least(20, v_late * 4);
  s_broken := least(15, v_broken * 5);
  v_score := least(100, s_overdue + s_days + s_late + s_broken);
  return query select v_score, case when v_score < 25 then 'low' when v_score < 50 then 'medium' else 'high' end,
    jsonb_build_object(
      'overdue_share', jsonb_build_object('points', s_overdue, 'overdue_minor', v_overdue, 'billed_minor', v_billed),
      'days_overdue', jsonb_build_object('points', s_days, 'max_days', v_max_days),
      'late_payments_6m', jsonb_build_object('points', s_late, 'count', v_late),
      'broken_promises_12m', jsonb_build_object('points', s_broken, 'count', v_broken));
end $$;

create or replace function public.fee_risk(p_family uuid) returns table (score int, band text, factors jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('fees.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.families where id = p_family and tenant_id = t) then raise exception 'family not found' using errcode = '42501'; end if;
  return query select * from app.family_fee_risk(t, p_family);
end $$;

create or replace function public.fee_risk_overview() returns table (family_id uuid, score int, band text, factors jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('fees.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select f.family_id, r.score, r.band, r.factors
    from (select distinct v.family_id from public.vouchers v where v.tenant_id = t and v.status in ('issued', 'partially_paid')) f
    cross join lateral app.family_fee_risk(t, f.family_id) r
    order by r.score desc, f.family_id;
end $$;

-- ---------------------------------------------------------------- fee-increase cap guard
create or replace function app.fee_line_cap() returns trigger language plpgsql as $$
declare v_cap int; v_base bigint;
begin
  if tg_op = 'INSERT' then new.baseline_minor := coalesce(new.baseline_minor, new.amount_minor); return new; end if;
  new.baseline_minor := coalesce(old.baseline_minor, old.amount_minor); -- the baseline cannot be edited away
  if new.amount_minor <= old.amount_minor then return new; end if;
  select max_increase_bps into v_cap from public.fee_policy where tenant_id = new.tenant_id;
  if v_cap is null then return new; end if;
  v_base := new.baseline_minor;
  if new.amount_minor > (v_base * (10000 + v_cap)) / 10000 and not app.has_permission('fees.cap.override') then
    raise exception 'fee increase exceeds the school''s cap of % bp over the original amount — needs the cap-override permission (2FA)', v_cap using errcode = '42501';
  end if;
  return new;
end $$;
create trigger fee_structure_lines_cap before insert or update on public.fee_structure_lines for each row execute function app.fee_line_cap();

-- ---------------------------------------------------------------- grants
select app.apply_grants();
grant select on public.v_installment_status to authenticated;

revoke all on function
  public.void_payment(uuid, text), public.cancel_voucher(uuid, text), public.refund_advance(uuid, bigint, text, text),
  public.collect_security_deposit(uuid, bigint, text, text, uuid), public.refund_security_deposit(uuid, bigint, text),
  public.close_cashier_session(uuid, bigint), public.create_installment_plan(uuid, date[], text), public.review_installment_plans(date),
  public.record_promise(uuid, bigint, date, text, uuid), public.review_promises(date), public.queue_fee_reminders(date),
  public.fee_risk(uuid), public.fee_risk_overview()
from public, anon, authenticated;
grant execute on function
  public.void_payment(uuid, text), public.cancel_voucher(uuid, text), public.refund_advance(uuid, bigint, text, text),
  public.collect_security_deposit(uuid, bigint, text, text, uuid), public.refund_security_deposit(uuid, bigint, text),
  public.close_cashier_session(uuid, bigint), public.create_installment_plan(uuid, date[], text), public.review_installment_plans(date),
  public.record_promise(uuid, bigint, date, text, uuid), public.review_promises(date), public.queue_fee_reminders(date),
  public.fee_risk(uuid), public.fee_risk_overview()
to authenticated, service_role;

select app.harden_internal_functions();

-- Phase 2 · fees: heads, structures, concessions, vouchers, payments, cashier sessions, fines/waivers/write-offs.
-- Every RPC that changes money posts its journal in the SAME transaction (CLAUDE.md rule 2): if the journal fails, the
-- voucher/payment fails. Vouchers store a snapshot and are never recomputed (rule 4). Idempotency keys everywhere (rule 7).

create sequence public.consumer_no_seq start 100000000001;

create table public.fee_heads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null, name text not null,
  income_account_code text not null default '40100' check (income_account_code ~ '^[0-9]{5}$'),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'annual', 'one_off')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);

create table public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null, class_id uuid not null, name text not null,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, session_id) references public.academic_sessions (tenant_id, id),
  foreign key (tenant_id, class_id) references public.classes (tenant_id, id),
  unique (tenant_id, session_id, class_id), unique (tenant_id, id)
);

create table public.fee_structure_lines (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  structure_id uuid not null, fee_head_id uuid not null, amount_minor bigint not null check (amount_minor >= 0),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (structure_id, fee_head_id),
  foreign key (tenant_id, structure_id) references public.fee_structures (tenant_id, id) on delete cascade,
  foreign key (tenant_id, fee_head_id) references public.fee_heads (tenant_id, id)
);
create index fee_structure_lines_tenant_idx on public.fee_structure_lines (tenant_id);

create table public.fine_rules (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  grace_days int not null default 5 check (grace_days >= 0), fine_minor bigint not null default 0 check (fine_minor >= 0),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now()
);

create table public.concessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null, fee_head_id uuid, -- NULL = applies to the whole voucher
  kind text not null check (kind in ('percent', 'fixed')),
  value bigint not null check (value > 0), -- percent = basis points (1000 = 10%); fixed = minor units
  reason text not null check (length(btrim(reason)) >= 3),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid, approved_by uuid, approved_at timestamptz,
  valid_from date not null default current_date, valid_to date,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 10000),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, fee_head_id) references public.fee_heads (tenant_id, id)
);
create index concessions_student_idx on public.concessions (tenant_id, student_id);

create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  family_id uuid not null, student_id uuid not null, session_id uuid not null,
  period date not null check (period = date_trunc('month', period)::date),
  voucher_no text not null, consumer_no text not null unique, due_date date not null,
  status text not null default 'issued' check (status in ('issued', 'partially_paid', 'paid', 'cancelled')),
  currency char(3) not null,
  gross_minor bigint not null check (gross_minor >= 0), concession_minor bigint not null default 0 check (concession_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),            -- gross − concessions, frozen at issue
  adjusted_minor bigint not null default 0,                         -- + fines − waivers − write-offs, each with its own journal
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  snapshot jsonb not null,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,                  -- set by public.cancel_voucher (reversal journals)
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  check (total_minor = gross_minor - concession_minor),
  check (total_minor + adjusted_minor >= 0),
  foreign key (tenant_id, family_id) references public.families (tenant_id, id),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id),
  foreign key (tenant_id, session_id) references public.academic_sessions (tenant_id, id),
  unique (tenant_id, voucher_no), unique (tenant_id, id)
);
-- one LIVE voucher per student per month; a cancelled one can be re-issued
create unique index vouchers_one_live_per_period on public.vouchers (tenant_id, student_id, period) where status <> 'cancelled';
create index vouchers_family_idx on public.vouchers (tenant_id, family_id, period);
create index vouchers_open_idx on public.vouchers (tenant_id, due_date) where status in ('issued', 'partially_paid');

create table public.voucher_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  voucher_id uuid not null, fee_head_id uuid, kind text not null check (kind in ('fee', 'concession')),
  description text not null, amount_minor bigint not null, -- concessions are negative
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, voucher_id) references public.vouchers (tenant_id, id) on delete cascade,
  foreign key (tenant_id, fee_head_id) references public.fee_heads (tenant_id, id)
);
create index voucher_lines_voucher_idx on public.voucher_lines (tenant_id, voucher_id);

create table public.voucher_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  voucher_id uuid not null, kind text not null check (kind in ('fine', 'waiver', 'writeoff')),
  amount_minor bigint not null check (amount_minor > 0), applied_on date not null, reason text, approved_by uuid, journal_entry_id uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, voucher_id) references public.vouchers (tenant_id, id) on delete cascade
);
create unique index voucher_one_fine on public.voucher_adjustments (tenant_id, voucher_id) where kind = 'fine';

create table public.cashier_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  campus_id uuid not null, cashier_id uuid not null, status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(), closed_at timestamptz,
  expected_minor bigint, counted_minor bigint, variance_minor bigint,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, campus_id) references public.campuses (tenant_id, id),
  unique (tenant_id, id)
);
create unique index cashier_one_open on public.cashier_sessions (tenant_id, cashier_id) where status = 'open';

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  family_id uuid not null, campus_id uuid, cashier_session_id uuid,
  channel text not null check (channel in ('cash', 'bank', 'raast', 'onebill', 'jazzcash', 'easypaisa', 'payfast', 'safepay', 'card', 'advance')),
  provider_ref text, idempotency_key text not null, amount_minor bigint not null check (amount_minor > 0),
  received_on date not null, received_by uuid, journal_entry_id uuid,
  voided_at timestamptz, voided_by uuid, void_reason text, void_journal_id uuid,   -- set by public.void_payment (reversal journal)
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, family_id) references public.families (tenant_id, id),
  foreign key (tenant_id, cashier_session_id) references public.cashier_sessions (tenant_id, id),
  unique (tenant_id, idempotency_key), unique (tenant_id, id)
);
create unique index payments_provider_ref_unique on public.payments (tenant_id, channel, provider_ref) where provider_ref is not null;
create index payments_family_idx on public.payments (tenant_id, family_id);
create index payments_day_idx on public.payments (tenant_id, received_on);

create table public.payment_allocations (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  payment_id uuid not null, voucher_id uuid not null, amount_minor bigint not null check (amount_minor > 0),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (payment_id, voucher_id),
  foreign key (tenant_id, payment_id) references public.payments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, voucher_id) references public.vouchers (tenant_id, id)
);
create index payment_allocations_tenant_idx on public.payment_allocations (tenant_id, voucher_id);

create table public.payment_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null, event_id text not null, consumer_no text not null, amount_minor bigint not null, provider_ref text,
  payment_id uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (provider, event_id)
);
create index payment_webhooks_tenant_idx on public.payment_webhooks (tenant_id);

-- ---------------------------------------------------------------- policies
create or replace function app.can_see_voucher(p_voucher uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.vouchers v where v.id = p_voucher and v.tenant_id = app.current_tenant_id()
                 and (app.has_permission('fees.view') or app.is_guardian_of_family(v.family_id)))
$$;

select app.secure_tenant_table('public.fee_heads', 'fees.structure.edit', 'fees.view');
select app.secure_tenant_table('public.fee_structures', 'fees.structure.edit', 'fees.view');
select app.secure_tenant_table('public.fee_structure_lines', 'fees.structure.edit', 'fees.view');
select app.secure_tenant_table('public.fine_rules', 'fees.structure.edit', 'fees.view');
select app.secure_tenant_table('public.concessions', '-', 'fees.view');   -- request/approve via RPC (maker-checker)
select app.secure_tenant_table('public.cashier_sessions', '-', 'fees.view');
select app.secure_tenant_table('public.payment_webhooks', '-', 'fees.view');

select app.secure_tenant_table('public.vouchers', '-');
alter policy tenant_select on public.vouchers using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('fees.view')) or (select app.is_guardian_of_family(family_id))));
select app.secure_tenant_table('public.payments', '-');
alter policy tenant_select on public.payments using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('fees.view')) or (select app.is_guardian_of_family(family_id))));
select app.secure_tenant_table('public.voucher_lines', '-');
alter policy tenant_select on public.voucher_lines using (tenant_id = (select app.current_tenant_id()) and (select app.can_see_voucher(voucher_id)));
select app.secure_tenant_table('public.voucher_adjustments', '-');
alter policy tenant_select on public.voucher_adjustments using (tenant_id = (select app.current_tenant_id()) and (select app.can_see_voucher(voucher_id)));
select app.secure_tenant_table('public.payment_allocations', '-');
alter policy tenant_select on public.payment_allocations using (tenant_id = (select app.current_tenant_id()) and (select app.can_see_voucher(voucher_id)));

select app.attach_standard_triggers('public.fee_heads');
select app.attach_standard_triggers('public.fee_structures');
select app.attach_standard_triggers('public.fee_structure_lines');
select app.attach_standard_triggers('public.fine_rules');
select app.attach_standard_triggers('public.concessions');
select app.attach_standard_triggers('public.cashier_sessions');
select app.attach_standard_triggers('public.vouchers', false);            -- vouchers + payments are ledger-backed, not audit-log-backed
select app.attach_standard_triggers('public.voucher_lines', false);
select app.attach_standard_triggers('public.voucher_adjustments', false);
select app.attach_standard_triggers('public.payments', false);
select app.attach_standard_triggers('public.payment_allocations', false);
select app.attach_standard_triggers('public.payment_webhooks', false);

-- ---------------------------------------------------------------- helpers
create or replace function app.channel_account(p_channel text) returns text language sql immutable as $$
  select case p_channel when 'cash' then '10100' when 'bank' then '10200' when 'advance' then '20200' else '10300' end
$$;

create or replace function app.voucher_balance(v public.vouchers) returns bigint language sql immutable as $$
  select v.total_minor + v.adjusted_minor - v.paid_minor
$$;

create or replace function app.refresh_voucher_status(p_voucher uuid) returns void language sql security definer set search_path = public, pg_temp as $$
  update public.vouchers set status = case
      when status = 'cancelled' then status
      when total_minor + adjusted_minor - paid_minor <= 0 then 'paid'
      when paid_minor > 0 then 'partially_paid' else 'issued' end
  where id = p_voucher
$$;

-- Allocate p_amount across a family's open vouchers (preferred voucher first, then oldest). Returns allocations and the
-- unallocated remainder (→ Fees Received in Advance). Locks the vouchers so concurrent payments cannot over-allocate.
create or replace function app.allocate_to_family(p_tenant uuid, p_payment uuid, p_family uuid, p_amount bigint, p_preferred uuid)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v record; left_ bigint := p_amount; take bigint;
begin
  for v in
    select * from public.vouchers where tenant_id = p_tenant and family_id = p_family and status in ('issued', 'partially_paid')
      and total_minor + adjusted_minor - paid_minor > 0
    order by (id = p_preferred) desc nulls last, period, created_at, voucher_no for update
  loop
    exit when left_ = 0;
    take := least(left_, v.total_minor + v.adjusted_minor - v.paid_minor);
    insert into public.payment_allocations (tenant_id, payment_id, voucher_id, amount_minor) values (p_tenant, p_payment, v.id, take);
    update public.vouchers set paid_minor = paid_minor + take where id = v.id;
    perform app.refresh_voucher_status(v.id);
    left_ := left_ - take;
  end loop;
  return left_;
end $$;

create or replace function app.record_payment(
  p_tenant uuid, p_actor uuid, p_family uuid, p_amount bigint, p_channel text, p_provider_ref text, p_key text,
  p_voucher uuid default null, p_campus uuid default null, p_cashier_session uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pay uuid; v_existing public.payments; v_remainder bigint; v_allocated bigint; v_entry uuid; v_date date := app.tenant_today(p_tenant);
  v_lines jsonb;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into v_existing from public.payments where tenant_id = p_tenant and idempotency_key = p_key;
  if found then
    if v_existing.amount_minor <> p_amount or v_existing.family_id <> p_family then
      raise exception 'idempotency key % reused with different details', p_key using errcode = '23505';
    end if;
    return v_existing.id; -- replay: same key, same payment, nothing posted twice
  end if;
  if not exists (select 1 from public.families where id = p_family and tenant_id = p_tenant) then raise exception 'family not found' using errcode = '42501'; end if;

  insert into public.payments (tenant_id, family_id, campus_id, cashier_session_id, channel, provider_ref, idempotency_key, amount_minor, received_on, received_by)
  values (p_tenant, p_family, p_campus, p_cashier_session, p_channel, p_provider_ref, p_key, p_amount, v_date, p_actor) returning id into v_pay;

  v_remainder := app.allocate_to_family(p_tenant, v_pay, p_family, p_amount, p_voucher);
  v_allocated := p_amount - v_remainder;

  v_lines := jsonb_build_array(jsonb_build_object('a', app.channel_account(p_channel), 'd', p_amount));
  if v_allocated > 0 then v_lines := v_lines || jsonb_build_object('a', '11000', 'c', v_allocated, 'f', p_family); end if;
  if v_remainder > 0 then v_lines := v_lines || jsonb_build_object('a', '20200', 'c', v_remainder, 'f', p_family); end if;

  v_entry := app.post_journal(p_tenant, p_campus, v_date, 'Fee payment (' || p_channel || ')', 'payment', v_pay, v_lines);
  update public.payments set journal_entry_id = v_entry where id = v_pay;
  return v_pay;
end $$;

-- ---------------------------------------------------------------- structures & concessions
create or replace function public.request_concession(p_student uuid, p_kind text, p_value bigint, p_reason text, p_fee_head uuid default null, p_valid_to date default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_id uuid;
begin
  if t is null or not app.has_permission('fees.concession.request') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  insert into public.concessions (tenant_id, student_id, fee_head_id, kind, value, reason, requested_by, valid_to)
  values (t, p_student, p_fee_head, p_kind, p_value, p_reason, auth.uid(), p_valid_to) returning id into v_id;
  return v_id;
end $$;

create or replace function public.approve_concession(p_id uuid, p_approve boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); c public.concessions;
begin
  if t is null or not app.has_permission('fees.concession.approve') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into c from public.concessions where id = p_id and tenant_id = t for update;
  if not found then raise exception 'concession not found' using errcode = '42501'; end if;
  if c.status <> 'pending' then raise exception 'concession is already %', c.status; end if;
  if c.requested_by is not distinct from auth.uid() then raise exception 'maker-checker: you cannot approve your own request' using errcode = '42501'; end if;
  update public.concessions set status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------- voucher generation (monthly)
create or replace function public.generate_vouchers(p_period date, p_session uuid, p_class uuid default null, p_due_days int default 10) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t uuid := app.current_tenant_id(); m date := date_trunc('month', p_period)::date; cur char(3);
  e record; s uuid; gross bigint; conc bigint; v_id uuid; n int := 0; r record; c record; v_amt bigint; v_adv bigint; v_snapshot jsonb;
  v_lines jsonb; v_no bigint; v_net bigint;
begin
  if t is null or not app.has_permission('fees.voucher.generate') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select base_currency into cur from public.tenants where id = t;

  for e in
    select en.student_id, en.class_id, st.family_id, st.campus_id from public.student_enrolments en
    join public.students st on st.tenant_id = en.tenant_id and st.id = en.student_id
    where en.tenant_id = t and en.session_id = p_session and en.status = 'active' and st.status = 'enrolled'
      and (p_class is null or en.class_id = p_class)
    order by st.admission_no
  loop
    continue when exists (select 1 from public.vouchers where tenant_id = t and student_id = e.student_id and period = m and status <> 'cancelled');
    select id into s from public.fee_structures where tenant_id = t and session_id = p_session and class_id = e.class_id;
    continue when s is null;

    select coalesce(sum(l.amount_minor), 0) into gross from public.fee_structure_lines l
      join public.fee_heads h on h.tenant_id = l.tenant_id and h.id = l.fee_head_id and h.is_active and h.frequency = 'monthly'
      where l.tenant_id = t and l.structure_id = s;
    continue when gross = 0;

    -- concessions: approved + valid in this period; each capped so the total never exceeds the gross
    conc := 0; v_snapshot := jsonb_build_object('period', m, 'currency', cur, 'heads', '[]'::jsonb, 'concessions', '[]'::jsonb);
    for r in select h.id, h.code, h.name, h.income_account_code, l.amount_minor from public.fee_structure_lines l
        join public.fee_heads h on h.tenant_id = l.tenant_id and h.id = l.fee_head_id and h.is_active and h.frequency = 'monthly'
        where l.tenant_id = t and l.structure_id = s order by h.code loop
      v_snapshot := jsonb_set(v_snapshot, '{heads}', (v_snapshot -> 'heads') || jsonb_build_object('code', r.code, 'name', r.name, 'amount', r.amount_minor, 'account', r.income_account_code));
    end loop;
    for c in select * from public.concessions where tenant_id = t and student_id = e.student_id and status = 'approved'
        and valid_from <= m and (valid_to is null or valid_to >= m) order by created_at loop
      v_amt := case c.kind when 'fixed' then c.value
                else ((case when c.fee_head_id is null then gross
                            else coalesce((select l.amount_minor from public.fee_structure_lines l where l.structure_id = s and l.fee_head_id = c.fee_head_id), 0) end) * c.value) / 10000 end;
      v_amt := least(v_amt, gross - conc);
      continue when v_amt <= 0;
      conc := conc + v_amt;
      v_snapshot := jsonb_set(v_snapshot, '{concessions}', (v_snapshot -> 'concessions') || jsonb_build_object('id', c.id, 'kind', c.kind, 'value', c.value, 'amount', v_amt, 'reason', c.reason));
    end loop;
    v_net := gross - conc;

    v_no := app.next_counter(t, 'voucher_no');
    insert into public.vouchers (tenant_id, family_id, student_id, session_id, period, voucher_no, consumer_no, due_date, currency, gross_minor, concession_minor, total_minor, snapshot, status)
    values (t, e.family_id, e.student_id, p_session, m, 'V' || to_char(m, 'YYYYMM') || '-' || lpad(v_no::text, 6, '0'),
            nextval('public.consumer_no_seq')::text, m + p_due_days, cur, gross, conc, v_net,
            v_snapshot, case when v_net = 0 then 'paid' else 'issued' end)
    returning id into v_id;

    insert into public.voucher_lines (tenant_id, voucher_id, fee_head_id, kind, description, amount_minor)
    select t, v_id, h.id, 'fee', h.name, l.amount_minor from public.fee_structure_lines l
      join public.fee_heads h on h.tenant_id = l.tenant_id and h.id = l.fee_head_id and h.is_active and h.frequency = 'monthly'
      where l.tenant_id = t and l.structure_id = s;
    insert into public.voucher_lines (tenant_id, voucher_id, kind, description, amount_minor)
    select t, v_id, 'concession', 'Concession: ' || (x ->> 'reason'), -(x ->> 'amount')::bigint from jsonb_array_elements(v_snapshot -> 'concessions') x;

    -- Dr Fee Receivable (net) + Dr Concessions  /  Cr income per head (gross)
    select jsonb_agg(jsonb_build_object('a', acc, 'c', amt)) into v_lines from (
      select h.income_account_code acc, sum(l.amount_minor) amt from public.fee_structure_lines l
      join public.fee_heads h on h.tenant_id = l.tenant_id and h.id = l.fee_head_id and h.is_active and h.frequency = 'monthly'
      where l.tenant_id = t and l.structure_id = s group by h.income_account_code) q;
    if v_net > 0 then v_lines := v_lines || jsonb_build_object('a', '11000', 'd', v_net, 'f', e.family_id); end if;
    if conc > 0 then v_lines := v_lines || jsonb_build_object('a', '49100', 'd', conc); end if;
    perform app.post_journal(t, e.campus_id, m, 'Voucher ' || m::text, 'voucher', v_id, v_lines);

    -- use any advance the family already holds
    select coalesce(sum(credit - debit), 0) into v_adv from public.journal_lines
      where tenant_id = t and family_id = e.family_id and account_id = (select id from public.accounts where tenant_id = t and code = '20200');
    if v_adv > 0 and v_net > 0 then
      perform app.apply_advance(t, e.family_id, v_id, least(v_adv, v_net));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Move part of the family's advance onto a voucher: Dr Fees Received in Advance, Cr Fee Receivable.
create or replace function app.apply_advance(p_tenant uuid, p_family uuid, p_voucher uuid, p_amount bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pay uuid;
begin
  insert into public.payments (tenant_id, family_id, channel, idempotency_key, amount_minor, received_on)
  values (p_tenant, p_family, 'advance', 'advance:' || p_voucher, p_amount, app.tenant_today(p_tenant)) returning id into v_pay;
  insert into public.payment_allocations (tenant_id, payment_id, voucher_id, amount_minor) values (p_tenant, v_pay, p_voucher, p_amount);
  update public.vouchers set paid_minor = paid_minor + p_amount where id = p_voucher;
  perform app.refresh_voucher_status(p_voucher);
  update public.payments set journal_entry_id = app.post_journal(p_tenant, null, app.tenant_today(p_tenant), 'Advance applied', 'payment', v_pay, jsonb_build_array(
      jsonb_build_object('a', '20200', 'd', p_amount, 'f', p_family), jsonb_build_object('a', '11000', 'c', p_amount, 'f', p_family))) where id = v_pay;
end $$;

-- ---------------------------------------------------------------- fines, waivers, write-offs
create or replace function public.apply_fines(p_as_of date default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); fr public.fine_rules; v record; n int := 0; d date; v_adj uuid;
begin
  if t is null or not app.has_permission('fees.voucher.generate') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into fr from public.fine_rules where tenant_id = t;
  if not found or fr.fine_minor = 0 then return 0; end if;
  d := coalesce(p_as_of, app.tenant_today(t));
  for v in select * from public.vouchers where tenant_id = t and status in ('issued', 'partially_paid')
      and due_date + fr.grace_days < d and total_minor + adjusted_minor - paid_minor > 0
      and not exists (select 1 from public.voucher_adjustments a where a.tenant_id = t and a.voucher_id = vouchers.id and a.kind = 'fine')
      and not exists (select 1 from public.installment_plans ip where ip.tenant_id = t and ip.voucher_id = vouchers.id and ip.status = 'active') -- an agreed plan pauses fines
      for update loop
    insert into public.voucher_adjustments (tenant_id, voucher_id, kind, amount_minor, applied_on, reason)
    values (t, v.id, 'fine', fr.fine_minor, d, 'Late fine') returning id into v_adj;
    update public.voucher_adjustments set journal_entry_id = app.post_journal(t, null, d, 'Late fine ' || v.voucher_no, 'fine', v_adj, jsonb_build_array(
        jsonb_build_object('a', '11000', 'd', fr.fine_minor, 'f', v.family_id), jsonb_build_object('a', '40600', 'c', fr.fine_minor))) where id = v_adj;
    update public.vouchers set adjusted_minor = adjusted_minor + fr.fine_minor where id = v.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function app.reduce_voucher(p_kind text, p_voucher uuid, p_amount bigint, p_reason text, p_debit_account text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v public.vouchers; bal bigint; v_adj uuid; v_amt bigint;
begin
  select * into v from public.vouchers where id = p_voucher and tenant_id = t for update;
  if not found then raise exception 'voucher not found' using errcode = '42501'; end if;
  bal := v.total_minor + v.adjusted_minor - v.paid_minor;
  v_amt := coalesce(p_amount, bal);
  if v_amt <= 0 or v_amt > bal then raise exception 'amount must be between 1 and the outstanding balance (%)', bal; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  insert into public.voucher_adjustments (tenant_id, voucher_id, kind, amount_minor, applied_on, reason, approved_by)
  values (t, v.id, p_kind, v_amt, app.tenant_today(t), p_reason, auth.uid()) returning id into v_adj;
  update public.voucher_adjustments set journal_entry_id = app.post_journal(t, null, app.tenant_today(t), initcap(p_kind) || ' ' || v.voucher_no, p_kind, v_adj, jsonb_build_array(
      jsonb_build_object('a', p_debit_account, 'd', v_amt), jsonb_build_object('a', '11000', 'c', v_amt, 'f', v.family_id))) where id = v_adj;
  update public.vouchers set adjusted_minor = adjusted_minor - v_amt where id = v.id;
  perform app.refresh_voucher_status(v.id);
end $$;

create or replace function public.approve_waiver(p_voucher uuid, p_amount bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_tenant_id() is null or not app.has_permission('fees.waiver.approve') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  perform app.reduce_voucher('waiver', p_voucher, p_amount, p_reason, '49100');
end $$;

create or replace function public.write_off_fee(p_voucher uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_tenant_id() is null or not app.has_permission('fees.writeoff.approve') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  perform app.reduce_voucher('writeoff', p_voucher, null, p_reason, '60800');
end $$;

-- ---------------------------------------------------------------- payments (counter, bank, gateway webhook)
create or replace function public.open_cashier_session(p_campus uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_id uuid;
begin
  if t is null or not app.has_permission('fees.collect') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  insert into public.cashier_sessions (tenant_id, campus_id, cashier_id) values (t, p_campus, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.record_payment(
  p_family uuid, p_amount bigint, p_channel text, p_idempotency_key text, p_voucher uuid default null, p_provider_ref text default null, p_campus uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_sess public.cashier_sessions;
begin
  if t is null or not app.has_permission('fees.collect') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_channel = 'advance' then raise exception 'channel advance is system-only'; end if;
  if p_channel = 'cash' then
    select * into v_sess from public.cashier_sessions where tenant_id = t and cashier_id = auth.uid() and status = 'open';
    if not found then raise exception 'open a cashier session before taking cash'; end if;
    return app.record_payment(t, auth.uid(), p_family, p_amount, 'cash', p_provider_ref, p_idempotency_key, p_voucher, v_sess.campus_id, v_sess.id);
  end if;
  return app.record_payment(t, auth.uid(), p_family, p_amount, p_channel, p_provider_ref, p_idempotency_key, p_voucher, p_campus, null);
end $$;

-- Called by the webhook endpoint AFTER it verified the provider signature (packages/providers). service_role only.
create or replace function public.handle_payment_webhook(p_provider text, p_event_id text, p_consumer_no text, p_amount_minor bigint, p_provider_ref text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.vouchers; w public.payment_webhooks; v_pay uuid;
begin
  select * into w from public.payment_webhooks where provider = p_provider and event_id = p_event_id;
  if found then return w.payment_id; end if; -- provider retried: same answer
  select * into v from public.vouchers where consumer_no = p_consumer_no;
  if not found then raise exception 'unknown consumer number' using errcode = 'P0002'; end if;
  if p_provider not in ('raast', 'onebill', 'jazzcash', 'easypaisa', 'payfast', 'safepay', 'card', 'bank') then raise exception 'unknown provider %', p_provider; end if;
  v_pay := app.record_payment(v.tenant_id, null, v.family_id, p_amount_minor, p_provider, p_provider_ref, 'wh:' || p_provider || ':' || p_event_id, v.id);
  insert into public.payment_webhooks (tenant_id, provider, event_id, consumer_no, amount_minor, provider_ref, payment_id)
  values (v.tenant_id, p_provider, p_event_id, p_consumer_no, p_amount_minor, p_provider_ref, v_pay);
  return v_pay;
end $$;

create or replace function public.close_cashier_session(p_session uuid, p_counted_minor bigint) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); s public.cashier_sessions; v_expected bigint; v_var bigint; v_date date;
begin
  if t is null or not app.has_permission('fees.collect') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into s from public.cashier_sessions where id = p_session and tenant_id = t and status = 'open' for update;
  if not found then raise exception 'no such open session' using errcode = '42501'; end if;
  if s.cashier_id <> auth.uid() then raise exception 'only the cashier can close their own session' using errcode = '42501'; end if;
  if p_counted_minor < 0 then raise exception 'counted amount cannot be negative'; end if;
  select coalesce(sum(amount_minor), 0) into v_expected from public.payments where tenant_id = t and cashier_session_id = s.id;
  v_var := p_counted_minor - v_expected; v_date := app.tenant_today(t);
  if v_var <> 0 then
    perform app.post_journal(t, s.campus_id, v_date, 'Cash variance at close', 'cash_variance', s.id, case when v_var < 0
      then jsonb_build_array(jsonb_build_object('a', '60900', 'd', -v_var), jsonb_build_object('a', '10100', 'c', -v_var))
      else jsonb_build_array(jsonb_build_object('a', '10100', 'd', v_var), jsonb_build_object('a', '60900', 'c', v_var)) end);
  end if;
  update public.cashier_sessions set status = 'closed', closed_at = now(), expected_minor = v_expected, counted_minor = p_counted_minor, variance_minor = v_var where id = s.id;
  return v_var;
end $$;

create or replace function public.deposit_cash(p_amount bigint, p_campus uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('accounts.journal.create') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  return app.post_journal(t, p_campus, app.tenant_today(t), 'Cash deposited to bank', 'cash_deposit', gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('a', '10200', 'd', p_amount), jsonb_build_object('a', '10100', 'c', p_amount)));
end $$;

create or replace function public.settle_gateway(p_gross_minor bigint, p_charges_minor bigint default 0) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_lines jsonb;
begin
  if t is null or not app.has_permission('accounts.journal.create') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_charges_minor < 0 or p_charges_minor >= p_gross_minor then raise exception 'invalid settlement amounts'; end if;
  v_lines := jsonb_build_array(jsonb_build_object('a', '10200', 'd', p_gross_minor - p_charges_minor), jsonb_build_object('a', '10300', 'c', p_gross_minor));
  if p_charges_minor > 0 then v_lines := v_lines || jsonb_build_object('a', '60700', 'd', p_charges_minor); end if;
  return app.post_journal(t, null, app.tenant_today(t), 'Gateway settlement', 'gateway_settlement', gen_random_uuid(), v_lines);
end $$;

-- ---------------------------------------------------------------- family khata (statement) — visible to staff with fees.view AND to the family's guardians
create or replace function public.family_statement(p_family uuid)
returns table (entry_date date, memo text, debit bigint, credit bigint, balance bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not (app.has_permission('fees.view') or app.is_guardian_of_family(p_family)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
  select e.entry_date, e.memo, l.debit, l.credit,
         sum(l.debit - l.credit) over (order by e.entry_date, e.created_at, l.id)::bigint
  from public.journal_lines l
  join public.journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
  join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
  where l.tenant_id = t and l.family_id = p_family and a.code = '11000'
  order by e.entry_date, e.created_at, l.id;
end $$;

-- ---------------------------------------------------------------- reports
create view public.v_fee_aging with (security_invoker = true) as
select v.tenant_id, v.id as voucher_id, v.family_id, v.student_id, v.voucher_no, v.due_date,
       (v.total_minor + v.adjusted_minor - v.paid_minor) as balance_minor,
       greatest(current_date - v.due_date, 0) as days_overdue,
       case when current_date <= v.due_date then 'current'
            when current_date - v.due_date <= 30 then '0-30' when current_date - v.due_date <= 60 then '31-60'
            when current_date - v.due_date <= 90 then '61-90' else '90+' end as bucket
from public.vouchers v where v.status in ('issued', 'partially_paid');

create view public.v_collection_daily with (security_invoker = true) as
select p.tenant_id, p.received_on, p.channel, count(*)::int as payments, sum(p.amount_minor)::bigint as collected_minor
from public.payments p where p.channel <> 'advance' and p.voided_at is null group by p.tenant_id, p.received_on, p.channel;

select app.apply_grants();
grant select on public.v_fee_aging, public.v_collection_daily to authenticated;

-- ---------------------------------------------------------------- execute grants
revoke all on function
  public.request_concession(uuid, text, bigint, text, uuid, date), public.approve_concession(uuid, boolean),
  public.generate_vouchers(date, uuid, uuid, int), public.apply_fines(date),
  public.approve_waiver(uuid, bigint, text), public.write_off_fee(uuid, text),
  public.open_cashier_session(uuid), public.record_payment(uuid, bigint, text, text, uuid, text, uuid),
  public.handle_payment_webhook(text, text, text, bigint, text), public.close_cashier_session(uuid, bigint),
  public.deposit_cash(bigint, uuid), public.settle_gateway(bigint, bigint), public.family_statement(uuid)
from public, anon, authenticated;
grant execute on function
  public.request_concession(uuid, text, bigint, text, uuid, date), public.approve_concession(uuid, boolean),
  public.generate_vouchers(date, uuid, uuid, int), public.apply_fines(date),
  public.approve_waiver(uuid, bigint, text), public.write_off_fee(uuid, text),
  public.open_cashier_session(uuid), public.record_payment(uuid, bigint, text, text, uuid, text, uuid),
  public.close_cashier_session(uuid, bigint), public.deposit_cash(bigint, uuid), public.settle_gateway(bigint, bigint),
  public.family_statement(uuid)
to authenticated, service_role;
grant execute on function public.handle_payment_webhook(text, text, text, bigint, text) to service_role;

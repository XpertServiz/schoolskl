-- Phase 2 · double-entry ledger (CLAUDE.md rules 2–3, §6.7).
--   * journals are balanced (deferred constraint trigger, checked at COMMIT) and immutable (update/delete/truncate blocked)
--   * corrections are reversals only; one reversal per entry
--   * one entry per (source_type, source_id): re-posting the same business event is a no-op, never a duplicate
--   * closed months reject new entries
--   * API roles cannot write journals at all — only SECURITY DEFINER RPCs, in the same transaction as the business event

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[0-9]{5}$'), name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  normal_side text not null check (normal_side in ('debit', 'credit')),
  is_system boolean not null default false, is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);

create table public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  period_start date not null check (period_start = date_trunc('month', period_start)::date),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz, closed_by uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, period_start)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  campus_id uuid, entry_date date not null, memo text not null default '',
  source_type text not null, source_id uuid, reversal_of uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, campus_id) references public.campuses (tenant_id, id),
  foreign key (tenant_id, reversal_of) references public.journal_entries (tenant_id, id)
);
create unique index journal_one_per_source on public.journal_entries (tenant_id, source_type, source_id)
  where reversal_of is null and source_id is not null;
create unique index journal_one_reversal on public.journal_entries (tenant_id, reversal_of) where reversal_of is not null;
create index journal_entries_date_idx on public.journal_entries (tenant_id, entry_date);

create table public.journal_lines (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  entry_id uuid not null, account_id uuid not null,
  debit bigint not null default 0 check (debit >= 0), credit bigint not null default 0 check (credit >= 0),
  family_id uuid, -- sub-ledger key for Fee Receivable / Fees Received in Advance
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  check ((debit > 0) <> (credit > 0)),
  foreign key (tenant_id, entry_id) references public.journal_entries (tenant_id, id),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id),
  foreign key (tenant_id, family_id) references public.families (tenant_id, id)
);
create index journal_lines_entry_idx on public.journal_lines (tenant_id, entry_id);
create index journal_lines_account_idx on public.journal_lines (tenant_id, account_id);
create index journal_lines_family_idx on public.journal_lines (tenant_id, family_id) where family_id is not null;

-- ---------------------------------------------------------------- integrity triggers
create or replace function app.journal_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'journals are immutable — post a reversal instead' using errcode = '42501';
end $$;
create trigger journal_entries_immutable before update or delete on public.journal_entries for each row execute function app.journal_immutable();
create trigger journal_lines_immutable before update or delete on public.journal_lines for each row execute function app.journal_immutable();
create trigger journal_entries_no_truncate before truncate on public.journal_entries for each statement execute function app.journal_immutable();
create trigger journal_lines_no_truncate before truncate on public.journal_lines for each statement execute function app.journal_immutable();

create or replace function app.check_entry_balanced() returns trigger language plpgsql as $$
declare v_entry uuid := case when tg_table_name = 'journal_entries' then (to_jsonb(new) ->> 'id')::uuid else (to_jsonb(new) ->> 'entry_id')::uuid end;
        v_tenant uuid := new.tenant_id; d bigint; c bigint; n int;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into d, c, n
  from public.journal_lines where tenant_id = v_tenant and entry_id = v_entry;
  if n < 2 then raise exception 'journal entry % needs at least two lines', v_entry using errcode = '23514'; end if;
  if d <> c then raise exception 'journal entry % is unbalanced: debits % ≠ credits %', v_entry, d, c using errcode = '23514'; end if;
  return null;
end $$;
create constraint trigger journal_lines_balanced after insert on public.journal_lines
  deferrable initially deferred for each row execute function app.check_entry_balanced();
create constraint trigger journal_entries_have_lines after insert on public.journal_entries
  deferrable initially deferred for each row execute function app.check_entry_balanced();

create or replace function app.check_period_open() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.accounting_periods p
             where p.tenant_id = new.tenant_id and p.period_start = date_trunc('month', new.entry_date)::date and p.status = 'closed') then
    raise exception 'accounting period % is closed', to_char(new.entry_date, 'YYYY-MM') using errcode = '23514';
  end if;
  return new;
end $$;
create trigger journal_entries_period_open before insert on public.journal_entries for each row execute function app.check_period_open();

-- ---------------------------------------------------------------- policies (read: accounts.reports.view; writes: RPC only)
select app.secure_tenant_table('public.accounts', '-', 'accounts.reports.view');
select app.secure_tenant_table('public.accounting_periods', '-', 'accounts.reports.view');
select app.secure_tenant_table('public.journal_entries', '-', 'accounts.reports.view');
select app.secure_tenant_table('public.journal_lines', '-', 'accounts.reports.view');
select app.attach_standard_triggers('public.accounts');
select app.attach_standard_triggers('public.accounting_periods');
select app.attach_standard_triggers('public.journal_entries', false); -- journals ARE the audit trail
select app.attach_standard_triggers('public.journal_lines', false);

-- ---------------------------------------------------------------- chart of accounts (§6.7), extended per tenant later
create or replace function app.seed_chart(p_tenant uuid) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.accounts (tenant_id, code, name, type, normal_side, is_system)
  select p_tenant, v.code, v.name, v.type, v.side, true from (values
    ('10100', 'Cash in hand',                  'asset',     'debit'),
    ('10200', 'Bank',                          'asset',     'debit'),
    ('10300', 'Gateway / Wallet Clearing',     'asset',     'debit'),
    ('11000', 'Fee Receivable',                'asset',     'debit'),
    ('11100', 'Subsidy Receivable',            'asset',     'debit'),
    ('20100', 'Accounts Payable',              'liability', 'credit'),
    ('20200', 'Fees Received in Advance',      'liability', 'credit'),
    ('20300', 'Security Deposits Refundable',  'liability', 'credit'),
    ('20400', 'Salaries Payable',              'liability', 'credit'),
    ('30100', 'Owner''s Capital / Trust Fund', 'equity',    'credit'),
    ('30900', 'Retained Surplus',              'equity',    'credit'),
    ('40100', 'Tuition Fee',                   'income',    'credit'),
    ('40200', 'Admission Fee',                 'income',    'credit'),
    ('40300', 'Annual / Development Fee',      'income',    'credit'),
    ('40400', 'Exam Fee',                      'income',    'credit'),
    ('40500', 'Transport Fee',                 'income',    'credit'),
    ('40600', 'Late Fines',                    'income',    'credit'),
    ('49000', 'Other Income',                  'income',    'credit'),
    ('49100', 'Concessions & Discounts',       'income',    'debit'),  -- contra-income
    ('49200', 'Scholarships',                  'income',    'debit'),  -- contra-income
    ('50100', 'Teaching Salaries',             'expense',   'debit'),
    ('60200', 'Rent',                          'expense',   'debit'),
    ('60300', 'Utilities',                     'expense',   'debit'),
    ('60700', 'Bank & Gateway Charges',        'expense',   'debit'),
    ('60800', 'Bad Debts (fee write-off)',     'expense',   'debit'),
    ('60900', 'Cash Over / Short',             'expense',   'debit'),
    ('69000', 'Miscellaneous',                 'expense',   'debit')
  ) as v(code, name, type, side)
  on conflict (tenant_id, code) do nothing
$$;

-- provisioning now also seeds the chart
create or replace function public.provision_tenant_defaults(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.roles (tenant_id, key, name, description, is_system)
  select p_tenant, rt.key, rt.name, rt.description, true from public.role_templates rt
  on conflict (tenant_id, key) do nothing;

  insert into public.role_permissions (tenant_id, role_id, permission_key)
  select p_tenant, r.id, rtp.permission_key
  from public.role_template_permissions rtp
  join public.roles r on r.tenant_id = p_tenant and r.key = rtp.role_key
  on conflict do nothing;

  insert into public.campuses (tenant_id, code, name) values (p_tenant, 'MAIN', 'Main Campus')
  on conflict (tenant_id, code) do nothing;

  perform app.seed_chart(p_tenant);
end $$;
revoke all on function public.provision_tenant_defaults(uuid) from public, anon, authenticated;
grant execute on function public.provision_tenant_defaults(uuid) to service_role;

-- ---------------------------------------------------------------- posting
create or replace function app.tenant_today(p_tenant uuid) returns date language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone coalesce((select timezone from public.tenants where id = p_tenant), 'UTC'))::date
$$;

-- p_lines: [{"a":"11000","d":1000,"f":"<family uuid>"}, {"a":"40100","c":1000}] — account by code.
-- Returns the existing entry when (source_type, source_id) was already posted (idempotent business events).
create or replace function app.post_journal(
  p_tenant uuid, p_campus uuid, p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb, p_reversal_of uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; l jsonb; v_acc uuid; d bigint := 0; c bigint := 0;
begin
  if p_source_id is not null and p_reversal_of is null then
    select id into v_id from public.journal_entries where tenant_id = p_tenant and source_type = p_source_type and source_id = p_source_id and reversal_of is null;
    if v_id is not null then return v_id; end if;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    d := d + coalesce((l ->> 'd')::bigint, 0);
    c := c + coalesce((l ->> 'c')::bigint, 0);
  end loop;
  if d <> c or d = 0 then raise exception 'unbalanced journal: debits % credits %', d, c using errcode = '23514'; end if;

  insert into public.journal_entries (tenant_id, campus_id, entry_date, memo, source_type, source_id, reversal_of)
  values (p_tenant, p_campus, p_date, left(coalesce(p_memo, ''), 500), p_source_type, p_source_id, p_reversal_of) returning id into v_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    select id into v_acc from public.accounts where tenant_id = p_tenant and code = l ->> 'a' and is_active;
    if v_acc is null then raise exception 'unknown or inactive account %', l ->> 'a'; end if;
    if coalesce((l ->> 'd')::bigint, 0) = 0 and coalesce((l ->> 'c')::bigint, 0) = 0 then continue; end if;
    insert into public.journal_lines (tenant_id, entry_id, account_id, debit, credit, family_id)
    values (p_tenant, v_id, v_acc, coalesce((l ->> 'd')::bigint, 0), coalesce((l ->> 'c')::bigint, 0), nullif(l ->> 'f', '')::uuid);
  end loop;
  return v_id;
end $$;

create or replace function public.post_manual_journal(p_date date, p_memo text, p_lines jsonb, p_campus uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('accounts.journal.create') or not app.tenant_writable() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  -- DECISION: maker-checker thresholds for manual journals arrive with the Approvals Inbox; until then creation is permission-gated and audited by the journal itself.
  return app.post_journal(t, p_campus, p_date, p_memo, 'manual', gen_random_uuid(), p_lines);
end $$;

create or replace function public.reverse_journal(p_entry uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); e public.journal_entries; v_lines jsonb;
begin
  if t is null or not app.has_permission('accounts.journal.approve') or not app.tenant_writable() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into e from public.journal_entries where id = p_entry and tenant_id = t;
  if not found then raise exception 'entry not found' using errcode = '42501'; end if;
  if e.reversal_of is not null then raise exception 'a reversal cannot itself be reversed'; end if;
  -- Entries born from a business event (voucher, payment, fine, waiver…) are mirrored in voucher/payment rows. Reversing only
  -- the journal would desynchronise them (receivable ≠ Σ voucher balances), so those are corrected by their own domain
  -- operation (cancel voucher / void payment — Phase 2 follow-up), never by a bare journal reversal.
  if e.source_type not in ('manual', 'cash_deposit', 'gateway_settlement') then
    raise exception 'entries from "%" are corrected through their own operation, not a journal reversal', e.source_type using errcode = '42501';
  end if;
  select jsonb_agg(jsonb_build_object('a', a.code, 'd', l.credit, 'c', l.debit, 'f', l.family_id)) into v_lines
  from public.journal_lines l join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
  where l.tenant_id = t and l.entry_id = e.id;
  return app.post_journal(t, e.campus_id, app.tenant_today(t), 'Reversal: ' || p_reason, 'reversal', null, v_lines, e.id);
end $$;

create or replace function public.close_period(p_month date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); m date := date_trunc('month', p_month)::date;
begin
  if t is null or not app.has_permission('accounts.period.close') or not app.tenant_writable() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.accounting_periods (tenant_id, period_start, status, closed_at, closed_by) values (t, m, 'closed', now(), auth.uid())
  on conflict (tenant_id, period_start) do update set status = 'closed', closed_at = now(), closed_by = auth.uid();
  insert into public.audit_log (tenant_id, actor_id, action, table_name, record_id, after)
  values (t, auth.uid(), 'period.close', 'accounting_periods', m::text, jsonb_build_object('period', m));
end $$;

-- ---------------------------------------------------------------- reports (invoker views: RLS of the caller applies)
create view public.v_trial_balance with (security_invoker = true) as
select a.tenant_id, a.code, a.name, a.type, a.normal_side,
       coalesce(sum(l.debit), 0)::bigint as debit_total, coalesce(sum(l.credit), 0)::bigint as credit_total,
       (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0))::bigint as net_debit
from public.accounts a left join public.journal_lines l on l.tenant_id = a.tenant_id and l.account_id = a.id
group by a.tenant_id, a.code, a.name, a.type, a.normal_side;

create view public.v_general_ledger with (security_invoker = true) as
select l.tenant_id, e.entry_date, e.id as entry_id, l.id as line_id, a.code as account_code, a.name as account_name,
       l.debit, l.credit, l.family_id, e.memo, e.source_type, e.source_id, e.reversal_of
from public.journal_lines l
join public.journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id;

select app.apply_grants();
grant select on public.v_trial_balance, public.v_general_ledger to authenticated;

revoke all on function public.post_manual_journal(date, text, jsonb, uuid), public.reverse_journal(uuid, text), public.close_period(date)
  from public, anon, authenticated;
grant execute on function public.post_manual_journal(date, text, jsonb, uuid), public.reverse_journal(uuid, text), public.close_period(date)
  to authenticated, service_role;

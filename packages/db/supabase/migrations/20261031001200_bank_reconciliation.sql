-- Phase 2 · bank statement import & reconciliation.
-- Incoming credits from a bank statement are evidence of money received. Each line ends up exactly one of:
--   matched  → a fee payment was recorded from it (ledger entry in the same transaction), or linked to a payment the office already keyed in
--   ignored  → not a fee receipt (with a reason)
--   unmatched→ waiting for a human; nothing is guessed onto a family.

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  statement_ref text not null, line_no int not null, txn_date date not null,
  description text not null default '', reference text not null default '', amount_minor bigint not null check (amount_minor > 0),
  line_hash text not null,
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'ignored')),
  payment_id uuid, match_kind text check (match_kind in ('auto', 'manual', 'linked')), ignore_reason text, resolved_by uuid, resolved_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, payment_id) references public.payments (tenant_id, id),
  unique (tenant_id, line_hash), unique (tenant_id, id)
);
create index bank_statement_lines_status_idx on public.bank_statement_lines (tenant_id, status, txn_date);
-- a payment can be the source of at most one statement line
create unique index bank_line_one_payment on public.bank_statement_lines (tenant_id, payment_id) where payment_id is not null;

select app.secure_tenant_table('public.bank_statement_lines', '-', 'accounts.reports.view');
select app.attach_standard_triggers('public.bank_statement_lines', false);

-- p_lines: [{"date":"2026-11-05","description":"IBFT from ALI","reference":"1000000042","amount_minor":600000}] — credits only.
-- Idempotent across OVERLAPPING statements: a line's identity is (date, amount, reference, description, n-th identical line), not the
-- statement it arrived in, so an export that re-covers last week adds nothing, while two genuinely identical deposits on one day both count.
create or replace function public.import_bank_statement(p_statement_ref text, p_lines jsonb) returns table (inserted int, skipped int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); r record; ins int := 0; skp int := 0; v_amt bigint; v_id uuid;
begin
  if t is null or not app.has_permission('accounts.journal.create') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(btrim(p_statement_ref), '') = '' then raise exception 'a statement reference is required'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'no lines supplied'; end if;
  if jsonb_array_length(p_lines) > 5000 then raise exception 'at most 5000 lines per import'; end if;
  for r in
    select x.value as l, x.ordinality::int as ord, x.base, row_number() over (partition by x.base order by x.ordinality)::int as occ
    from (select e.value, e.ordinality,
                 concat_ws('|', e.value ->> 'date', e.value ->> 'amount_minor', coalesce(e.value ->> 'reference', ''), coalesce(e.value ->> 'description', '')) as base
          from jsonb_array_elements(p_lines) with ordinality as e(value, ordinality)) x
    order by x.ordinality
  loop
    v_amt := (r.l ->> 'amount_minor')::bigint;
    if v_amt is null or v_amt <= 0 then raise exception 'line %: amount must be a positive credit', r.ord; end if;
    insert into public.bank_statement_lines (tenant_id, statement_ref, line_no, txn_date, description, reference, amount_minor, line_hash)
    values (t, p_statement_ref, r.ord, (r.l ->> 'date')::date, left(coalesce(r.l ->> 'description', ''), 500), left(coalesce(r.l ->> 'reference', ''), 200), v_amt,
            md5(r.base || '|' || r.occ))
    on conflict (tenant_id, line_hash) do nothing returning id into v_id;
    if v_id is null then skp := skp + 1; else ins := ins + 1; end if;
    v_id := null;
  end loop;
  return query select ins, skp;
end $$;

-- Auto-match: a line whose text names exactly ONE open voucher's consumer number, for no more than that voucher's balance.
-- Anything else (no number, two numbers, paid/cancelled voucher, amount above the balance) stays for a human.
create or replace function public.reconcile_bank_lines() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); ln record; v record; c int; n int := 0; v_pay uuid;
begin
  if t is null or not app.has_permission('fees.collect') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  for ln in select * from public.bank_statement_lines where tenant_id = t and status = 'unmatched' order by txn_date, line_no for update loop
    select count(*) into c from public.vouchers x where x.tenant_id = t
      and (ln.description || ' ' || ln.reference) ~ ('(^|[^0-9])' || x.consumer_no || '([^0-9]|$)');
    continue when c <> 1;
    select x.* into v from public.vouchers x where x.tenant_id = t
      and (ln.description || ' ' || ln.reference) ~ ('(^|[^0-9])' || x.consumer_no || '([^0-9]|$)');
    continue when v.status not in ('issued', 'partially_paid') or ln.amount_minor > v.total_minor + v.adjusted_minor - v.paid_minor;
    v_pay := app.record_payment(t, auth.uid(), v.family_id, ln.amount_minor, 'bank', 'bankline:' || ln.line_hash, 'bankline:' || ln.id, v.id);
    update public.bank_statement_lines set status = 'matched', payment_id = v_pay, match_kind = 'auto', resolved_by = auth.uid(), resolved_at = now() where id = ln.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- A person decides which family a line belongs to (optionally a specific voucher).
create or replace function public.match_bank_line(p_line uuid, p_family uuid, p_voucher uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); ln public.bank_statement_lines; v_pay uuid;
begin
  if t is null or not app.has_permission('fees.collect') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into ln from public.bank_statement_lines where id = p_line and tenant_id = t for update;
  if not found then raise exception 'statement line not found' using errcode = '42501'; end if;
  if ln.status <> 'unmatched' then raise exception 'line is already %', ln.status; end if;
  if p_voucher is not null and not exists (select 1 from public.vouchers where id = p_voucher and tenant_id = t and family_id = p_family) then
    raise exception 'voucher does not belong to that family';
  end if;
  v_pay := app.record_payment(t, auth.uid(), p_family, ln.amount_minor, 'bank', 'bankline:' || ln.line_hash, 'bankline:' || ln.id, p_voucher);
  update public.bank_statement_lines set status = 'matched', payment_id = v_pay, match_kind = 'manual', resolved_by = auth.uid(), resolved_at = now() where id = ln.id;
  return v_pay;
end $$;

-- The office already keyed this deposit in as a 'bank' payment: tie the statement line to it instead of recording the money twice.
create or replace function public.link_bank_line(p_line uuid, p_payment uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); ln public.bank_statement_lines; p public.payments;
begin
  if t is null or not app.has_permission('fees.collect') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into ln from public.bank_statement_lines where id = p_line and tenant_id = t for update;
  if not found then raise exception 'statement line not found' using errcode = '42501'; end if;
  if ln.status <> 'unmatched' then raise exception 'line is already %', ln.status; end if;
  select * into p from public.payments where id = p_payment and tenant_id = t;
  if not found then raise exception 'payment not found' using errcode = '42501'; end if;
  if p.channel <> 'bank' or p.voided_at is not null then raise exception 'only a live bank payment can be linked'; end if;
  if p.amount_minor <> ln.amount_minor then raise exception 'amounts differ (statement % vs payment %)', ln.amount_minor, p.amount_minor; end if;
  if exists (select 1 from public.bank_statement_lines where tenant_id = t and payment_id = p.id) then raise exception 'that payment is already linked to a statement line'; end if;
  update public.bank_statement_lines set status = 'matched', payment_id = p.id, match_kind = 'linked', resolved_by = auth.uid(), resolved_at = now() where id = ln.id;
end $$;

create or replace function public.ignore_bank_line(p_line uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('fees.collect') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  update public.bank_statement_lines set status = 'ignored', ignore_reason = p_reason, resolved_by = auth.uid(), resolved_at = now()
  where id = p_line and tenant_id = t and status = 'unmatched';
  if not found then raise exception 'no unmatched line with that id'; end if;
end $$;

select app.apply_grants();
select app.harden_internal_functions();

revoke all on function public.import_bank_statement(text, jsonb), public.reconcile_bank_lines(), public.match_bank_line(uuid, uuid, uuid),
  public.link_bank_line(uuid, uuid), public.ignore_bank_line(uuid, text) from public, anon, authenticated;
grant execute on function public.import_bank_statement(text, jsonb), public.reconcile_bank_lines(), public.match_bank_line(uuid, uuid, uuid),
  public.link_bank_line(uuid, uuid), public.ignore_bank_line(uuid, text) to authenticated, service_role;

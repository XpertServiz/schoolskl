-- Owner suite: access control, accounting, reports, bank reconciliation, employee payroll, attendance devices, transport alerts,
-- parent concession requests, student directory, platform reviews and billing. Every rule lives here (RPCs check permission + tenant).

-- ============================================================ 1. permissions
insert into public.permissions (key, module, sensitive, requires_mfa) values
  ('staff.manage', 'admin', false, false), ('students.contact', 'students', false, false), ('accounts.chart.edit', 'accounts', false, false)
on conflict (key) do nothing;
insert into public.role_template_permissions (role_key, permission_key) values
  ('school_owner', 'staff.manage'), ('school_owner', 'students.contact'), ('school_owner', 'accounts.chart.edit'),
  ('principal', 'staff.manage'), ('principal', 'students.contact'), ('campus_admin', 'students.contact'), ('accountant', 'accounts.chart.edit')
on conflict do nothing;
insert into public.role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, k.permission_key from public.roles r join public.role_template_permissions k on k.role_key = r.key
where k.permission_key in ('staff.manage', 'students.contact', 'accounts.chart.edit')
  and not exists (select 1 from public.role_permissions rp where rp.tenant_id = r.tenant_id and rp.role_id = r.id and rp.permission_key = k.permission_key);

-- ============================================================ 2. access management (owner decides who can do what)
create or replace function app.can_manage_access() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.tenant_writable() and (app.is_school_owner() or app.has_permission('users.manage')) $$;

create or replace function public.access_overview() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not (app.is_school_owner() or app.has_permission('users.manage')) then raise exception 'permission denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'permissions', (select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'module', x.module, 'mfa', x.requires_mfa) order by x.module, x.key), '[]') from public.permissions x),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name,
                'keys', coalesce((select jsonb_agg(rp.permission_key order by rp.permission_key) from public.role_permissions rp where rp.tenant_id = t and rp.role_id = r.id), '[]')) order by r.name), '[]')
              from public.roles r where r.tenant_id = t),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', ut.user_id, 'name', pr.full_name, 'email', u.email, 'status', ut.status,
                'roles', coalesce((select jsonb_agg(r.key) from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id where ur.tenant_id = t and ur.user_id = ut.user_id), '[]'),
                'grants', coalesce((select jsonb_agg(o.permission_key) from public.user_permission_overrides o where o.tenant_id = t and o.user_id = ut.user_id and o.effect = 'grant' and o.scope_type = 'tenant'), '[]'),
                'denies', coalesce((select jsonb_agg(o.permission_key) from public.user_permission_overrides o where o.tenant_id = t and o.user_id = ut.user_id and o.effect = 'deny' and o.scope_type = 'tenant'), '[]'))
                order by pr.full_name), '[]')
              from public.user_tenants ut join auth.users u on u.id = ut.user_id left join public.profiles pr on pr.user_id = ut.user_id where ut.tenant_id = t and ut.status <> 'left')
  );
end $$;

create or replace function public.set_role_permission(p_role text, p_key text, p_on boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); r uuid;
begin
  if t is null or not app.can_manage_access() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_role = 'school_owner' then raise exception 'the owner always has full access' using errcode = '42501', hint = 'owner'; end if;
  select id into r from public.roles where tenant_id = t and key = p_role;
  if r is null then raise exception 'unknown role' using errcode = '22023'; end if;
  if not exists (select 1 from public.permissions where key = p_key) then raise exception 'unknown permission' using errcode = '22023'; end if;
  if not app.is_school_owner() and p_on and not app.has_permission(p_key) then raise exception 'you cannot give access you do not have' using errcode = '42501', hint = 'escalation'; end if;
  if p_on then insert into public.role_permissions (tenant_id, role_id, permission_key) values (t, r, p_key) on conflict do nothing;
  else delete from public.role_permissions where tenant_id = t and role_id = r and permission_key = p_key; end if;
end $$;

-- p_effect: 'grant' (extra), 'deny' (take away), 'inherit' (back to what the role gives)
create or replace function public.set_member_permission(p_user uuid, p_key text, p_effect text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.can_manage_access() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_effect not in ('grant', 'deny', 'inherit') then raise exception 'bad effect' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own access' using errcode = '42501', hint = 'self'; end if;
  if not exists (select 1 from public.user_tenants where tenant_id = t and user_id = p_user) then raise exception 'not a member of this school' using errcode = 'P0001'; end if;
  if exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id where ur.tenant_id = t and ur.user_id = p_user and r.key = 'school_owner') then
    raise exception 'the owner always has full access' using errcode = '42501', hint = 'owner';
  end if;
  if not exists (select 1 from public.permissions where key = p_key) then raise exception 'unknown permission' using errcode = '22023'; end if;
  if not app.is_school_owner() and p_effect = 'grant' and not app.has_permission(p_key) then raise exception 'you cannot give access you do not have' using errcode = '42501', hint = 'escalation'; end if;
  delete from public.user_permission_overrides where tenant_id = t and user_id = p_user and permission_key = p_key and scope_type = 'tenant';
  if p_effect <> 'inherit' then
    insert into public.user_permission_overrides (tenant_id, user_id, permission_key, effect, reason) values (t, p_user, p_key, p_effect, 'set by ' || auth.uid()::text);
  end if;
end $$;

-- ============================================================ 3. chart of accounts and general journal
create or replace function public.add_account(p_code text, p_name text, p_type text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v uuid;
begin
  if t is null or not app.has_permission('accounts.chart.edit') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_code !~ '^[0-9]{5}$' then raise exception 'account code must be 5 digits' using errcode = '22023', hint = 'code'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'name required' using errcode = '22023'; end if;
  if p_type not in ('asset', 'liability', 'equity', 'income', 'expense') then raise exception 'bad type' using errcode = '22023'; end if;
  if exists (select 1 from public.accounts where tenant_id = t and code = p_code) then raise exception 'that account code already exists' using errcode = 'P0001', hint = 'exists'; end if;
  insert into public.accounts (tenant_id, code, name, type, normal_side) values (t, p_code, btrim(p_name), p_type, case when p_type in ('asset', 'expense') then 'debit' else 'credit' end) returning id into v;
  return v;
end $$;

create or replace function public.update_account(p_id uuid, p_name text, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); a public.accounts; bal bigint;
begin
  if t is null or not app.has_permission('accounts.chart.edit') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into a from public.accounts where id = p_id and tenant_id = t;
  if not found then raise exception 'account not found' using errcode = '42501'; end if;
  if a.is_system then raise exception 'built-in accounts cannot be renamed or switched off' using errcode = '42501', hint = 'system'; end if;
  select coalesce(sum(debit - credit), 0) into bal from public.journal_lines where tenant_id = t and account_id = p_id;
  if not p_active and bal <> 0 then raise exception 'an account with a balance cannot be switched off' using errcode = 'P0001', hint = 'balance'; end if;
  update public.accounts set name = coalesce(nullif(btrim(p_name), ''), name), is_active = p_active where id = p_id;
end $$;

-- "Modify" = the original is reversed and the corrected entry posted, in one step: the books keep the full trail (nothing is overwritten).
create or replace function public.amend_manual_journal(p_id uuid, p_date date, p_memo text, p_lines jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); e public.journal_entries; v_lines jsonb; v_new uuid;
begin
  if t is null or not (app.is_school_owner() or app.has_permission('accounts.journal.approve')) or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '22023', hint = 'reason'; end if;
  select * into e from public.journal_entries where id = p_id and tenant_id = t;
  if not found then raise exception 'entry not found' using errcode = '42501'; end if;
  if e.source_type <> 'manual' or e.reversal_of is not null then raise exception 'only manual journal entries can be changed here' using errcode = '42501', hint = 'not_manual'; end if;
  if exists (select 1 from public.journal_entries where tenant_id = t and reversal_of = p_id) then raise exception 'this entry was already reversed' using errcode = 'P0001', hint = 'reversed'; end if;
  select jsonb_agg(jsonb_build_object('a', a.code, 'd', l.credit, 'c', l.debit, 'f', l.family_id)) into v_lines
  from public.journal_lines l join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id where l.tenant_id = t and l.entry_id = e.id;
  perform app.post_journal(t, e.campus_id, app.tenant_today(t), 'Reversal: ' || p_reason, 'reversal', null, v_lines, e.id);
  if p_lines is not null and jsonb_array_length(p_lines) > 0 then
    v_new := app.post_journal(t, e.campus_id, coalesce(p_date, e.entry_date), coalesce(nullif(btrim(p_memo), ''), e.memo), 'manual', gen_random_uuid(), p_lines);
  end if;
  return v_new;
end $$;

-- "Delete" = reverse (the ledger is append-only by law of accounting): shows as a reversed entry, balances return to what they were.
create or replace function public.void_manual_journal(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.amend_manual_journal(p_id, null, null, null, p_reason); end $$;

create or replace function public.journal_list(p_from date, p_to date)
returns table (entry_id uuid, entry_date date, memo text, source_type text, reversal_of uuid, reversed boolean, total_minor bigint, lines jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id();
begin
  if t is null or not (app.has_permission('accounts.reports.view') or app.has_permission('accounts.journal.create')) then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select e.id, e.entry_date, e.memo, e.source_type, e.reversal_of,
           exists (select 1 from public.journal_entries r where r.tenant_id = t and r.reversal_of = e.id),
           coalesce((select sum(l.debit) from public.journal_lines l where l.tenant_id = t and l.entry_id = e.id), 0)::bigint,
           coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'debit', l.debit, 'credit', l.credit) order by l.id)
                     from public.journal_lines l join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id where l.tenant_id = t and l.entry_id = e.id), '[]')
    from public.journal_entries e where e.tenant_id = t and e.entry_date between p_from and p_to order by e.entry_date desc, e.created_at desc limit 500;
end $$;

-- ============================================================ 4. financial reports
create or replace function public.report_trial_balance(p_to date) returns table (code text, name text, type text, debit bigint, credit bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('accounts.reports.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select a.code, a.name, a.type, greatest(coalesce(sum(l.debit) - sum(l.credit), 0), 0)::bigint, greatest(coalesce(sum(l.credit) - sum(l.debit), 0), 0)::bigint
    from public.accounts a left join public.journal_lines l on l.tenant_id = a.tenant_id and l.account_id = a.id
      and exists (select 1 from public.journal_entries e where e.tenant_id = l.tenant_id and e.id = l.entry_id and e.entry_date <= p_to)
    where a.tenant_id = t group by a.code, a.name, a.type order by a.code;
end $$;

create or replace function public.report_general_ledger(p_account uuid, p_from date, p_to date)
returns table (entry_date date, memo text, source_type text, debit bigint, credit bigint, balance bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id(); a public.accounts; opening bigint;
begin
  if t is null or not app.has_permission('accounts.reports.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into a from public.accounts where id = p_account and tenant_id = t;
  if not found then raise exception 'account not found' using errcode = '42501'; end if;
  select coalesce(sum(l.debit - l.credit), 0) into opening from public.journal_lines l join public.journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
   where l.tenant_id = t and l.account_id = p_account and e.entry_date < p_from;
  return query
    select p_from, 'Opening balance'::text, ''::text, 0::bigint, 0::bigint, (case when a.normal_side = 'debit' then opening else -opening end)::bigint
    union all
    select x.entry_date, x.memo, x.source_type, x.debit, x.credit,
           (case when a.normal_side = 'debit' then opening + sum(x.debit - x.credit) over (order by x.entry_date, x.created_at, x.id)
                 else -(opening + sum(x.debit - x.credit) over (order by x.entry_date, x.created_at, x.id)) end)::bigint
    from (select e.entry_date, e.memo, e.source_type, e.created_at, l.id, l.debit, l.credit from public.journal_lines l join public.journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
          where l.tenant_id = t and l.account_id = p_account and e.entry_date between p_from and p_to) x;
end $$;

-- direct-method cash flow over the cash, bank and gateway accounts: opening, receipts and payments by source, closing
create or replace function public.report_cash_flow(p_from date, p_to date) returns table (label text, inflow bigint, outflow bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id(); opening bigint; closing bigint;
begin
  if t is null or not app.has_permission('accounts.reports.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  select coalesce(sum(l.debit - l.credit), 0) into opening from public.journal_lines l join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id and a.code in ('10100', '10200', '10300')
    join public.journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id where l.tenant_id = t and e.entry_date < p_from;
  select coalesce(sum(l.debit - l.credit), 0) into closing from public.journal_lines l join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id and a.code in ('10100', '10200', '10300')
    join public.journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id where l.tenant_id = t and e.entry_date <= p_to;
  return query
    select '__opening__'::text, opening, 0::bigint
    union all
    select x.source_type, x.i, x.o from (
      select e.source_type, sum(l.debit)::bigint i, sum(l.credit)::bigint o
      from public.journal_lines l join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id and a.code in ('10100', '10200', '10300')
      join public.journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id where l.tenant_id = t and e.entry_date between p_from and p_to group by e.source_type order by e.source_type) x
    union all
    select '__closing__'::text, closing, 0::bigint;
end $$;

create or replace function public.report_aged_receivables(p_as_of date)
returns table (family_name text, current_amt bigint, d1_30 bigint, d31_60 bigint, d61_90 bigint, d90_plus bigint, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id();
begin
  if t is null or not (app.has_permission('accounts.reports.view') or app.has_permission('fees.view')) then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select f.name,
      coalesce(sum(b.bal) filter (where p_as_of - b.due_date <= 0), 0)::bigint, coalesce(sum(b.bal) filter (where p_as_of - b.due_date between 1 and 30), 0)::bigint,
      coalesce(sum(b.bal) filter (where p_as_of - b.due_date between 31 and 60), 0)::bigint, coalesce(sum(b.bal) filter (where p_as_of - b.due_date between 61 and 90), 0)::bigint,
      coalesce(sum(b.bal) filter (where p_as_of - b.due_date > 90), 0)::bigint, sum(b.bal)::bigint
    from (select v.family_id, v.due_date, (v.total_minor + v.adjusted_minor - v.paid_minor) bal from public.vouchers v where v.tenant_id = t and v.status <> 'cancelled' and v.total_minor + v.adjusted_minor - v.paid_minor > 0) b
    join public.families f on f.tenant_id = t and f.id = b.family_id group by f.name order by sum(b.bal) desc;
end $$;

create or replace function public.report_payables(p_as_of date) returns table (code text, name text, balance bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('accounts.reports.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select a.code, a.name, sum(l.credit - l.debit)::bigint from public.accounts a join public.journal_lines l on l.tenant_id = a.tenant_id and l.account_id = a.id
      join public.journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id and e.entry_date <= p_as_of
    where a.tenant_id = t and a.type = 'liability' group by a.code, a.name having sum(l.credit - l.debit) <> 0 order by a.code;
end $$;

-- ============================================================ 5. bank reconciliation (QuickBooks-style)
create table public.bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  as_of date not null, statement_balance_minor bigint not null, book_balance_minor bigint not null, difference_minor bigint not null, note text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now()
);
create index bank_reconciliations_tenant_idx on public.bank_reconciliations (tenant_id, as_of desc);
select app.secure_tenant_table('public.bank_reconciliations', '-', 'accounts.reports.view');
select app.attach_standard_triggers('public.bank_reconciliations');

create or replace function public.bank_book_balance(p_as_of date) returns bigint
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null or not (app.has_permission('accounts.reports.view') or app.has_permission('fees.collect')) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id and a.code = '10200'
    join public.journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id where l.tenant_id = t and e.entry_date <= p_as_of), 0);
end $$;

create or replace function public.save_bank_reconciliation(p_as_of date, p_statement_balance bigint, p_note text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); b bigint; v uuid;
begin
  if t is null or not app.has_permission('accounts.journal.create') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  b := public.bank_book_balance(p_as_of);
  insert into public.bank_reconciliations (tenant_id, as_of, statement_balance_minor, book_balance_minor, difference_minor, note) values (t, p_as_of, p_statement_balance, b, p_statement_balance - b, nullif(btrim(p_note), '')) returning id into v;
  return v;
end $$;

-- a transaction the bank has that the books do not (charges, interest, other deposits/payments): posted to the books at once
create or replace function public.post_bank_entry(p_date date, p_memo text, p_amount_minor bigint, p_kind text, p_account_code text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); lines jsonb;
begin
  if t is null or not app.has_permission('accounts.journal.create') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'amount must be above zero' using errcode = '22023'; end if;
  if p_kind not in ('deposit', 'payment') then raise exception 'bad kind' using errcode = '22023'; end if;
  if p_account_code = '10200' or not exists (select 1 from public.accounts where tenant_id = t and code = p_account_code and is_active) then raise exception 'choose another account' using errcode = '22023', hint = 'account'; end if;
  lines := case when p_kind = 'deposit'
    then jsonb_build_array(jsonb_build_object('a', '10200', 'd', p_amount_minor, 'c', 0), jsonb_build_object('a', p_account_code, 'd', 0, 'c', p_amount_minor))
    else jsonb_build_array(jsonb_build_object('a', p_account_code, 'd', p_amount_minor, 'c', 0), jsonb_build_object('a', '10200', 'd', 0, 'c', p_amount_minor)) end;
  return app.post_journal(t, null, p_date, coalesce(nullif(btrim(p_memo), ''), 'Bank ' || p_kind), 'manual', gen_random_uuid(), lines);
end $$;

-- an unmatched statement CREDIT that is not a fee payment (e.g. interest, donation): book it to an account and close the line
create or replace function public.post_bank_line(p_line uuid, p_account_code text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); l public.bank_statement_lines; j uuid;
begin
  if t is null or not app.has_permission('accounts.journal.create') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into l from public.bank_statement_lines where id = p_line and tenant_id = t and status = 'unmatched';
  if not found then raise exception 'line not found or already handled' using errcode = '42501'; end if;
  j := public.post_bank_entry(l.txn_date, coalesce(nullif(l.description, ''), l.reference), l.amount_minor, 'deposit', p_account_code);
  update public.bank_statement_lines set status = 'ignored', ignore_reason = 'Posted to account ' || p_account_code, resolved_by = auth.uid(), resolved_at = now() where id = p_line;
  return j;
end $$;

-- ============================================================ 6. employee payroll sheet
alter table public.staff_pay add column if not exists annual_leave_days integer not null default 12 check (annual_leave_days between 0 and 366);

create or replace function public.payroll_sheet(p_period date)
returns table (staff_id uuid, employee_no text, full_name text, designation text, joined_on date, basic_minor bigint, annual_leave_days int,
               present_days int, late_days int, half_days int, leave_days int, absent_days int, leaves_taken_year int, net_minor bigint, status text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id(); m date := date_trunc('month', p_period)::date;
begin
  if t is null or not (app.has_permission('payroll.prepare') or app.has_permission('payroll.post')) then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select s.id, s.employee_no, s.full_name, s.designation, s.joined_on, coalesce(sp.basic_minor, 0)::bigint, coalesce(sp.annual_leave_days, 12),
      (select count(*)::int from public.staff_attendance a where a.tenant_id = t and a.staff_id = s.id and a.att_date >= m and a.att_date < m + interval '1 month' and a.status = 'present'),
      (select count(*)::int from public.staff_attendance a where a.tenant_id = t and a.staff_id = s.id and a.att_date >= m and a.att_date < m + interval '1 month' and a.status = 'late'),
      (select count(*)::int from public.staff_attendance a where a.tenant_id = t and a.staff_id = s.id and a.att_date >= m and a.att_date < m + interval '1 month' and a.status = 'half_day'),
      (select count(*)::int from public.staff_attendance a where a.tenant_id = t and a.staff_id = s.id and a.att_date >= m and a.att_date < m + interval '1 month' and a.status = 'leave'),
      (select count(*)::int from public.staff_attendance a where a.tenant_id = t and a.staff_id = s.id and a.att_date >= m and a.att_date < m + interval '1 month' and a.status = 'absent'),
      (select count(*)::int from public.staff_attendance a where a.tenant_id = t and a.staff_id = s.id and a.att_date >= date_trunc('year', m) and a.att_date < date_trunc('year', m) + interval '1 year' and a.status = 'leave'),
      (select ps.net_minor from public.payslips ps join public.payroll_runs r on r.id = ps.run_id and r.tenant_id = ps.tenant_id where ps.tenant_id = t and ps.staff_id = s.id and r.period = m and r.status <> 'voided' limit 1),
      (select r.status from public.payslips ps join public.payroll_runs r on r.id = ps.run_id and r.tenant_id = ps.tenant_id where ps.tenant_id = t and ps.staff_id = s.id and r.period = m and r.status <> 'voided' limit 1)
    from public.staff_members s left join public.staff_pay sp on sp.tenant_id = t and sp.staff_id = s.id where s.tenant_id = t and s.status = 'active' order by s.employee_no;
end $$;

create or replace function public.staff_month_days(p_staff uuid, p_period date) returns table (att_date date, status text, check_in time, check_out time, source text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id(); m date := date_trunc('month', p_period)::date;
begin
  if t is null or not (app.has_permission('payroll.prepare') or app.has_permission('staff.manage') or exists (select 1 from public.staff_members where id = p_staff and tenant_id = t and user_id = auth.uid())) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query select a.att_date, a.status, a.check_in, a.check_out, a.source from public.staff_attendance a where a.tenant_id = t and a.staff_id = p_staff and a.att_date >= m and a.att_date < m + interval '1 month' order by a.att_date;
end $$;

-- ============================================================ 7. attendance devices (fingerprint machines etc. push punches here)
alter table public.staff_attendance drop constraint if exists staff_attendance_source_check;
alter table public.staff_attendance add constraint staff_attendance_source_check check (source in ('manual', 'self', 'device'));
create table public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80), token_hash text not null unique, is_active boolean not null default true, last_seen timestamptz,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now()
);
create index attendance_devices_tenant_idx on public.attendance_devices (tenant_id);
select app.secure_tenant_table('public.attendance_devices', '-', 'staff.manage');
select app.attach_standard_triggers('public.attendance_devices');

-- returns the device key ONCE (only its hash is stored). The machine/bridge sends it with every punch.
create or replace function public.register_attendance_device(p_name text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); k text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if t is null or not app.has_permission('staff.manage') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  insert into public.attendance_devices (tenant_id, name, token_hash) values (t, btrim(p_name), encode(sha256(convert_to(k, 'utf8')), 'hex'));
  return k;
end $$;

create or replace function public.set_attendance_device_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_tenant_id() is null or not app.has_permission('staff.manage') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.attendance_devices set is_active = p_active where id = p_id and tenant_id = app.current_tenant_id();
end $$;

-- service role only (the /api/attendance/punch route): first punch of the day = check-in, later ones move the check-out; never edits an earlier check-in
create or replace function public.ingest_punch(p_token text, p_employee_no text, p_at timestamptz) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.attendance_devices; m public.staff_members; v_tz text; loc timestamp; ex public.staff_attendance; st text;
begin
  select * into d from public.attendance_devices where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex') and is_active;
  if not found then raise exception 'unknown device' using errcode = '42501'; end if;
  select * into m from public.staff_members where tenant_id = d.tenant_id and employee_no = btrim(p_employee_no) and status = 'active';
  if not found then return 'unknown_employee'; end if;
  select coalesce(timezone, 'UTC') into v_tz from public.tenants where id = d.tenant_id;
  loc := p_at at time zone v_tz;
  update public.attendance_devices set last_seen = now() where id = d.id;
  select * into ex from public.staff_attendance where tenant_id = d.tenant_id and staff_id = m.id and att_date = loc::date;
  if not found or ex.check_in is null then
    st := case when loc::time > m.shift_start + interval '15 minutes' then 'late' else 'present' end;
    insert into public.staff_attendance (tenant_id, staff_id, att_date, status, check_in, source) values (d.tenant_id, m.id, loc::date, st, loc::time, 'device')
    on conflict (tenant_id, staff_id, att_date) do update set check_in = excluded.check_in, source = 'device', status = case when staff_attendance.status in ('absent', 'leave') then excluded.status else staff_attendance.status end;
    return 'in';
  end if;
  if loc::time > ex.check_in + interval '1 minute' and (ex.check_out is null or loc::time > ex.check_out) then
    update public.staff_attendance set check_out = loc::time where id = ex.id;
    return 'out';
  end if;
  return 'ignored';
end $$;

-- ============================================================ 8. transport: expected arrival + lateness alerts, driver roster, addresses
alter table public.transport_routes add column if not exists expected_arrival time, add column if not exists grace_minutes integer not null default 25 check (grace_minutes between 0 and 180);
alter table public.families add column if not exists address text check (length(address) <= 300);
alter table public.classes add column if not exists dismissal_time time not null default '14:00';

create or replace function public.set_family_address(p_family uuid, p_address text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_tenant_id() is null or not (app.has_permission('students.edit') or app.has_permission('students.create')) or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.families set address = nullif(btrim(p_address), '') where id = p_family and tenant_id = app.current_tenant_id();
end $$;

-- A to-school trip that has not been completed by expected arrival + grace is "late". Computed when someone looks (no scheduler needed):
-- owner/transport staff and teachers see every route, a parent only their own child's route. Skips Sundays and schools without SafeRoute.
create or replace function public.route_alerts()
returns table (route_id uuid, name text, vehicle_label text, expected_arrival time, grace_minutes int, minutes_late int, state text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id(); v_tz text; loc timestamp;
begin
  if t is null or not app.tenant_flag_on(t, 'saferoute') then return; end if;
  select coalesce(timezone, 'UTC') into v_tz from public.tenants where id = t;
  loc := now() at time zone v_tz;
  if extract(dow from loc) = 0 then return; end if;
  return query
    select r.id, r.name, r.vehicle_label, r.expected_arrival, r.grace_minutes,
           (extract(epoch from (loc::time - r.expected_arrival)) / 60)::int,
           case when exists (select 1 from public.transport_trips x where x.tenant_id = t and x.route_id = r.id and x.ended_at is null) then 'on_the_way' else 'not_started' end
    from public.transport_routes r
    where r.tenant_id = t and r.is_active and r.expected_arrival is not null
      and loc::time > r.expected_arrival + make_interval(mins => r.grace_minutes)
      and not exists (select 1 from public.transport_trips x where x.tenant_id = t and x.route_id = r.id and x.direction = 'to_school' and x.ended_at is not null and (x.started_at at time zone v_tz)::date = loc::date)
      and (app.has_permission('transport.manage') or app.has_permission('tracking.live.view') or app.has_permission('attendance.mark') or app.is_route_crew(r.id)
           or exists (select 1 from public.transport_riders tr where tr.tenant_id = t and tr.route_id = r.id and app.is_guardian_of_student(tr.student_id)));
end $$;

create or replace function public.crew_roster(p_route uuid)
returns table (student_id uuid, first_name text, class_name text, dismissal_time time, stop_name text, address text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id();
begin
  if t is null or not (app.is_route_crew(p_route) or app.has_permission('transport.manage')) then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select s.id, split_part(btrim(s.full_name), ' ', 1), c.name, c.dismissal_time, tr.stop_name, f.address
    from public.transport_riders tr join public.students s on s.tenant_id = t and s.id = tr.student_id
    left join public.families f on f.tenant_id = t and f.id = s.family_id
    left join public.student_enrolments e on e.tenant_id = t and e.student_id = s.id and e.status = 'active'
    left join public.classes c on c.tenant_id = t and c.id = e.class_id
    where tr.tenant_id = t and tr.route_id = p_route order by tr.stop_name nulls last, s.full_name;
end $$;

-- ============================================================ 9. student directory (parent, roll no, address; phone only for people allowed to contact parents)
create or replace function public.students_directory()
returns table (student_id uuid, admission_no text, full_name text, status text, class_name text, section_name text, roll_no int, family_id uuid, guardian_name text, guardian_phone text, address text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id(); can_phone boolean;
begin
  if t is null or not app.has_permission('students.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  can_phone := app.has_permission('students.contact') or app.has_permission('students.edit');
  return query
    select s.id, s.admission_no, s.full_name, s.status, c.name, sec.name, e.roll_no, s.family_id, g.full_name, case when can_phone then g.phone else null end, f.address
    from public.students s
    left join public.student_enrolments e on e.tenant_id = t and e.student_id = s.id and e.status = 'active'
    left join public.classes c on c.tenant_id = t and c.id = e.class_id left join public.sections sec on sec.tenant_id = t and sec.id = e.section_id
    left join public.families f on f.tenant_id = t and f.id = s.family_id
    left join lateral (select gg.full_name, gg.phone from public.student_guardians sg join public.guardians gg on gg.tenant_id = sg.tenant_id and gg.id = sg.guardian_id where sg.tenant_id = t and sg.student_id = s.id order by sg.is_custodian desc, gg.created_at limit 1) g on true
    where s.tenant_id = t order by s.full_name limit 2000;
end $$;

-- ============================================================ 10. concessions: parents request, owner decides (approve / refuse / return with a note)
alter table public.concessions drop constraint if exists concessions_status_check;
alter table public.concessions add constraint concessions_status_check check (status in ('pending', 'approved', 'rejected', 'returned'));
alter table public.concessions add column if not exists decision_note text, add column if not exists decided_by uuid;

create or replace function public.request_concession_guardian(p_student uuid, p_percent int, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v uuid;
begin
  if t is null or not app.tenant_writable() or not app.is_guardian_of_student(p_student) then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_percent is null or p_percent < 1 or p_percent > 100 then raise exception 'percent must be 1 to 100' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'please say why' using errcode = '22023'; end if;
  if exists (select 1 from public.concessions where tenant_id = t and student_id = p_student and status = 'pending') then raise exception 'a request for this child is already waiting' using errcode = 'P0001', hint = 'pending'; end if;
  insert into public.concessions (tenant_id, student_id, kind, value, reason, status, requested_by) values (t, p_student, 'percent', p_percent * 100, btrim(p_reason), 'pending', auth.uid()) returning id into v;
  return v;
end $$;

create or replace function public.my_concession_requests() returns table (id uuid, student_name text, percent int, reason text, status text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  return query select c.id, s.full_name, (c.value / 100)::int, c.reason, c.status, c.decision_note, c.created_at from public.concessions c join public.students s on s.tenant_id = c.tenant_id and s.id = c.student_id
    where c.tenant_id = app.current_tenant_id() and c.requested_by = auth.uid() order by c.created_at desc limit 50;
end $$;

create or replace function public.decide_concession(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); c public.concessions;
begin
  if t is null or not app.has_permission('fees.concession.approve') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject', 'return') then raise exception 'bad decision' using errcode = '22023'; end if;
  select * into c from public.concessions where id = p_id and tenant_id = t and status = 'pending';
  if not found then raise exception 'request not found or already decided' using errcode = '42501'; end if;
  if c.requested_by is not distinct from auth.uid() then raise exception 'you cannot decide your own request' using errcode = '42501', hint = 'own'; end if;
  if p_decision = 'return' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say what should change' using errcode = '22023', hint = 'note'; end if;
  if p_decision = 'approve' then perform public.approve_concession(p_id, true);
  elsif p_decision = 'reject' then perform public.approve_concession(p_id, false);
  else update public.concessions set status = 'returned' where id = p_id; end if;
  update public.concessions set decision_note = nullif(btrim(p_note), ''), decided_by = auth.uid() where id = p_id;
end $$;

-- ============================================================ 11. platform: customer reviews, quotations and invoices (super admin)
create table public.site_reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80), school_name text check (length(school_name) <= 120),
  rating integer not null check (rating between 1 and 5), comment text not null check (length(btrim(comment)) between 5 and 600),
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')), source text not null default 'visitor' check (source in ('visitor', 'admin')),
  created_at timestamptz not null default now()
);
alter table public.site_reviews enable row level security;
create policy site_reviews_public_read on public.site_reviews for select to anon, authenticated using (status = 'approved');
create policy site_reviews_vendor_read on public.site_reviews for select to authenticated using ((select app.is_vendor_staff()));
create policy site_reviews_super_write on public.site_reviews for all to authenticated using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

create table public.platform_counters (kind text primary key, value bigint not null default 0);
alter table public.platform_counters enable row level security;
create policy platform_counters_vendor on public.platform_counters for select to authenticated using ((select app.is_vendor_staff()));

create table public.platform_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('quote', 'invoice')), number text not null unique,
  school_id uuid references public.tenants (id) on delete set null,
  customer_name text not null check (length(btrim(customer_name)) between 2 and 160), customer_email text, customer_phone text,
  currency text not null default 'PKR', issue_date date not null default current_date, due_date date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'paid', 'void')),
  notes text check (length(notes) <= 1000), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.platform_document_lines (
  id uuid primary key default gen_random_uuid(), doc_id uuid not null references public.platform_documents (id) on delete cascade,
  description text not null check (length(btrim(description)) between 1 and 200), qty numeric(10, 2) not null default 1 check (qty > 0), unit_minor bigint not null check (unit_minor >= 0), sort_order int not null default 0
);
create table public.platform_payments (
  id uuid primary key default gen_random_uuid(), doc_id uuid not null references public.platform_documents (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0), paid_on date not null default current_date, method text check (length(method) <= 40), note text check (length(note) <= 200), created_at timestamptz not null default now()
);
create index platform_document_lines_doc_idx on public.platform_document_lines (doc_id);
create index platform_payments_doc_idx on public.platform_payments (doc_id);
do $$ declare x text; begin
  foreach x in array array['platform_documents', 'platform_document_lines', 'platform_payments'] loop
    execute format('alter table public.%I enable row level security', x);
    execute format('create policy %I on public.%I for select to authenticated using ((select app.is_vendor_staff()))', x || '_vendor_read', x);
    execute format('create policy %I on public.%I for all to authenticated using ((select app.is_vendor_role(''vendor_super_admin''))) with check ((select app.is_vendor_role(''vendor_super_admin'')))', x || '_super_write', x);
  end loop;
end $$;

create or replace function public.platform_next_number(p_kind text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  if not app.is_vendor_role('vendor_super_admin') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_kind not in ('quote', 'invoice') then raise exception 'bad kind' using errcode = '22023'; end if;
  insert into public.platform_counters (kind, value) values (p_kind, 1) on conflict (kind) do update set value = public.platform_counters.value + 1 returning value into n;
  return (case when p_kind = 'quote' then 'QT-' else 'INV-' end) || to_char(current_date, 'YYYY') || '-' || lpad(n::text, 4, '0');
end $$;

-- platform accounting: what was invoiced, collected and is still owed, by month
create or replace function public.platform_billing_summary() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.is_vendor_staff() then raise exception 'permission denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'invoiced', (select coalesce(sum(l.qty * l.unit_minor), 0)::bigint from public.platform_document_lines l join public.platform_documents d on d.id = l.doc_id where d.kind = 'invoice' and d.status <> 'void'),
    'collected', (select coalesce(sum(p.amount_minor), 0)::bigint from public.platform_payments p join public.platform_documents d on d.id = p.doc_id where d.kind = 'invoice' and d.status <> 'void'),
    'open_quotes', (select count(*)::int from public.platform_documents where kind = 'quote' and status in ('draft', 'sent')),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'invoiced', inv, 'collected', col) order by m), '[]') from (
        select to_char(date_trunc('month', g), 'YYYY-MM') m,
          (select coalesce(sum(l.qty * l.unit_minor), 0)::bigint from public.platform_document_lines l join public.platform_documents d on d.id = l.doc_id where d.kind = 'invoice' and d.status <> 'void' and date_trunc('month', d.issue_date) = date_trunc('month', g)) inv,
          (select coalesce(sum(p.amount_minor), 0)::bigint from public.platform_payments p join public.platform_documents d on d.id = p.doc_id where d.kind = 'invoice' and d.status <> 'void' and date_trunc('month', p.paid_on) = date_trunc('month', g)) col
        from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') g) z)
  );
end $$;

-- ============================================================ grants (apply_grants is re-run by later migrations, so it knows every table)
create or replace function app.apply_grants() returns void language plpgsql as $$
declare n text;
begin
  revoke all on all tables in schema public from anon;
  grant select on public.plans, public.plan_features to anon;
  if to_regclass('public.site_media') is not null then grant select on public.site_media, public.site_settings to anon; end if;
  if to_regclass('public.site_reviews') is not null then grant select on public.site_reviews to anon; end if;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  foreach n in array array[
    'audit_log', 'sensitive_access_log', 'impersonation_sessions', 'import_batches', 'import_rows', 'vendor_staff', 'tenant_counters',
    'accounts', 'accounting_periods', 'journal_entries', 'journal_lines',
    'concessions', 'cashier_sessions', 'payment_webhooks', 'vouchers', 'voucher_lines', 'voucher_adjustments', 'payments', 'payment_allocations',
    'guardian_contact_prefs', 'notification_deliveries', 'payroll_runs', 'payslips', 'exams', 'assessments', 'marks', 'mark_amendments', 'result_lines', 'result_summaries',
    'staff_attendance', 'admission_inquiries', 'admission_events', 'bank_statement_lines', 'family_refunds', 'security_deposits', 'installment_plans', 'installments', 'payment_promises', 'fee_reminders',
    'attendance_days', 'student_attendance', 'notification_outbox',
    'transport_cards', 'transport_consents', 'transport_trips', 'transport_positions', 'transport_events',
    'site_visits', 'bank_reconciliations', 'attendance_devices', 'platform_counters'
  ] loop
    if to_regclass('public.' || n) is not null then
      execute format('revoke insert, update, delete, truncate on public.%I from authenticated', n);
    end if;
  end loop;
  if to_regclass('public.demo_requests') is not null then
    revoke insert, delete, truncate on public.demo_requests from authenticated;
    revoke all on public.demo_requests from anon;
  end if;
end $$;
select app.apply_grants();
select app.harden_internal_functions();

revoke all on function public.access_overview(), public.set_role_permission(text, text, boolean), public.set_member_permission(uuid, text, text),
  public.add_account(text, text, text), public.update_account(uuid, text, boolean), public.amend_manual_journal(uuid, date, text, jsonb, text), public.void_manual_journal(uuid, text),
  public.journal_list(date, date), public.report_trial_balance(date), public.report_general_ledger(uuid, date, date), public.report_cash_flow(date, date),
  public.report_aged_receivables(date), public.report_payables(date), public.bank_book_balance(date), public.save_bank_reconciliation(date, bigint, text),
  public.post_bank_entry(date, text, bigint, text, text), public.post_bank_line(uuid, text), public.payroll_sheet(date), public.staff_month_days(uuid, date),
  public.register_attendance_device(text), public.set_attendance_device_active(uuid, boolean), public.set_family_address(uuid, text), public.route_alerts(),
  public.crew_roster(uuid), public.students_directory(), public.request_concession_guardian(uuid, int, text), public.my_concession_requests(),
  public.decide_concession(uuid, text, text), public.platform_next_number(text), public.platform_billing_summary() from public, anon;
grant execute on function public.access_overview(), public.set_role_permission(text, text, boolean), public.set_member_permission(uuid, text, text),
  public.add_account(text, text, text), public.update_account(uuid, text, boolean), public.amend_manual_journal(uuid, date, text, jsonb, text), public.void_manual_journal(uuid, text),
  public.journal_list(date, date), public.report_trial_balance(date), public.report_general_ledger(uuid, date, date), public.report_cash_flow(date, date),
  public.report_aged_receivables(date), public.report_payables(date), public.bank_book_balance(date), public.save_bank_reconciliation(date, bigint, text),
  public.post_bank_entry(date, text, bigint, text, text), public.post_bank_line(uuid, text), public.payroll_sheet(date), public.staff_month_days(uuid, date),
  public.register_attendance_device(text), public.set_attendance_device_active(uuid, boolean), public.set_family_address(uuid, text), public.route_alerts(),
  public.crew_roster(uuid), public.students_directory(), public.request_concession_guardian(uuid, int, text), public.my_concession_requests(),
  public.decide_concession(uuid, text, text), public.platform_next_number(text), public.platform_billing_summary() to authenticated, service_role;
revoke all on function public.ingest_punch(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_punch(text, text, timestamptz) to service_role;

-- Super-admin control room: website visitor counts, landing-page media (demo video + reels), website settings, and a per-school overview.
-- All of this is PLATFORM data (no tenant_id): nothing here is about any school's records or any child.

-- ------------------------------------------------------------------ visitor counts
-- Privacy by design (matches the "no trackers" promise): no cookies, no IP address, no user agent, no identifier of any kind is stored —
-- only per-day totals per page and language: `visits` (the first page a browser opens in a session) and `views` (every page).
create table public.site_visits (
  day   date not null default current_date,
  path  text not null check (path ~ '^/[a-z0-9/_-]{0,60}$'),
  lang  text not null check (lang in ('en', 'ur')),
  visits integer not null default 0,
  views  integer not null default 0,
  primary key (day, path, lang)
);
alter table public.site_visits enable row level security;
create policy site_visits_vendor_read on public.site_visits for select to authenticated using ((select app.is_vendor_staff()));

create or replace function public.record_visit(p_path text, p_lang text, p_first boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- only the public pages are counted (a closed list, so nobody can fill the table with junk paths)
  if p_path not in ('/', '/apps', '/pricing', '/privacy', '/demo') or p_lang not in ('en', 'ur') then return; end if;
  insert into public.site_visits (day, path, lang, visits, views) values (current_date, p_path, p_lang, case when p_first then 1 else 0 end, 1)
  on conflict (day, path, lang) do update set views = public.site_visits.views + 1, visits = public.site_visits.visits + case when p_first then 1 else 0 end;
end $$;

-- ------------------------------------------------------------------ landing-page media: one demo video + short reels (links; embedded on click)
create table public.site_media (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('demo', 'reel')),
  title_en text not null check (length(btrim(title_en)) between 1 and 120),
  title_ur text not null default '' check (length(title_ur) <= 120),
  url text not null check (length(url) between 12 and 400 and url ~ '^https://[^[:space:]<>"]+$'),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index site_media_order_idx on public.site_media (kind, sort_order, created_at);
alter table public.site_media enable row level security;
-- the public site shows active items to anyone; vendor staff see all; only the super admin changes them
create policy site_media_public_read on public.site_media for select to anon, authenticated using (is_active);
create policy site_media_vendor_read on public.site_media for select to authenticated using ((select app.is_vendor_staff()));
create policy site_media_super_write on public.site_media for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));
create trigger touch_row before insert or update on public.site_media for each row execute function app.touch_row();

-- ------------------------------------------------------------------ website settings: contact, social links, announcement banner (all public)
create table public.site_settings (
  key text primary key check (key in ('whatsapp', 'phone', 'email', 'facebook', 'instagram', 'youtube', 'tiktok', 'announcement_en', 'announcement_ur')),
  value text not null check (length(btrim(value)) between 1 and 300 and value !~ '[<>]')
);
alter table public.site_settings enable row level security;
create policy site_settings_public_read on public.site_settings for select to anon, authenticated using (true);
create policy site_settings_super_write on public.site_settings for all to authenticated
  using ((select app.is_vendor_role('vendor_super_admin'))) with check ((select app.is_vendor_role('vendor_super_admin')));

-- ------------------------------------------------------------------ per-school overview (COUNTS ONLY — no names, no records)
create or replace function public.vendor_overview()
returns table (tenant_id uuid, slug text, name text, status text, plan_key text, created_at timestamptz, students integer, staff integer, members integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not app.is_vendor_staff() then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select t.id, t.slug, t.name, t.status, p.key, t.created_at,
           (select count(*)::int from public.students s where s.tenant_id = t.id and s.status = 'enrolled'),
           (select count(*)::int from public.staff_members m where m.tenant_id = t.id and m.status = 'active'),
           (select count(*)::int from public.user_tenants u where u.tenant_id = t.id and u.status = 'active')
    from public.tenants t left join public.plans p on p.id = t.plan_id
    where t.status <> 'churned' order by t.created_at desc;
end $$;

-- ------------------------------------------------------------------ grants (apply_grants is re-run by later migrations, so it must know these tables)
create or replace function app.apply_grants() returns void language plpgsql as $$
declare n text;
begin
  revoke all on all tables in schema public from anon;
  -- the public marketing catalogue and content: pricing plans, landing media, website settings (no tenant data)
  grant select on public.plans, public.plan_features to anon;
  if to_regclass('public.site_media') is not null then grant select on public.site_media, public.site_settings to anon; end if;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  foreach n in array array[
    'audit_log', 'sensitive_access_log', 'impersonation_sessions', 'import_batches', 'import_rows', 'vendor_staff', 'tenant_counters',
    'accounts', 'accounting_periods', 'journal_entries', 'journal_lines',
    'concessions', 'cashier_sessions', 'payment_webhooks', 'vouchers', 'voucher_lines', 'voucher_adjustments', 'payments', 'payment_allocations',
    'guardian_contact_prefs', 'notification_deliveries', 'payroll_runs', 'payslips', 'exams', 'assessments', 'marks', 'mark_amendments', 'result_lines', 'result_summaries',
    'staff_attendance', 'admission_inquiries', 'admission_events', 'bank_statement_lines', 'family_refunds', 'security_deposits', 'installment_plans', 'installments', 'payment_promises', 'fee_reminders',
    'attendance_days', 'student_attendance', 'notification_outbox',
    'transport_cards', 'transport_consents', 'transport_trips', 'transport_positions', 'transport_events',
    'site_visits'
  ] loop
    if to_regclass('public.' || n) is not null then
      execute format('revoke insert, update, delete, truncate on public.%I from authenticated', n);
    end if;
  end loop;
  -- demo leads: the server creates them with the service role; vendor staff only update their status
  if to_regclass('public.demo_requests') is not null then
    revoke insert, delete, truncate on public.demo_requests from authenticated;
    revoke all on public.demo_requests from anon;
  end if;
end $$;
select app.apply_grants();

revoke all on function public.record_visit(text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_visit(text, text, boolean) to service_role;
revoke all on function public.vendor_overview() from public, anon;
grant execute on function public.vendor_overview() to authenticated, service_role;
select app.harden_internal_functions();

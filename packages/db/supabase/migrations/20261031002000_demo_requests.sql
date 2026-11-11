-- Phase 4 · marketing site lead capture.
-- A platform table (not tenant-owned): who asked for a demo. Anonymous visitors never touch the database directly — the web app's server
-- action inserts with the service role after validating and de-duplicating — so `anon` keeps zero table access (pinned by structure.test).

create table public.demo_requests (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null check (length(btrim(full_name)) between 2 and 120),
  school_name  text not null check (length(btrim(school_name)) between 2 and 160),
  city         text check (length(city) <= 80),
  phone        text not null check (phone ~ '^\+?[0-9]{10,15}$'),
  email        text check (email is null or (length(email) <= 160 and email like '%_@_%')),
  students_band text check (students_band in ('lt300', '300_1000', '1000_3000', 'gt3000')),
  message      text check (length(message) <= 1000),
  locale       text not null default 'en' check (locale in ('en', 'ur')),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz,
  handled_by   uuid
);
-- the same number asking twice in a day is one lead, not two
create unique index demo_requests_phone_day on public.demo_requests (phone, ((created_at at time zone 'UTC')::date));
create index demo_requests_open_idx on public.demo_requests (created_at desc) where handled_at is null;

alter table public.demo_requests enable row level security;
create policy demo_requests_vendor_read on public.demo_requests for select to authenticated using ((select app.is_vendor_staff()));
create policy demo_requests_vendor_update on public.demo_requests for update to authenticated
  using ((select app.is_vendor_staff())) with check ((select app.is_vendor_staff()));

select app.apply_grants();
-- apply_grants() gives authenticated full DML on every table; a lead is created only by the server (service role) and never deleted by a person.
revoke insert, delete, truncate on public.demo_requests from authenticated;
revoke all on public.demo_requests from anon;

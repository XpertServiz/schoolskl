-- Phase 3 · communications delivery. Business events already write to notification_outbox in their own transaction (attendance, fee
-- reminders, results). This migration adds what a delivery worker (service_role, packages/comms) needs:
--   * guardian contact preferences with RECORDED consent (WhatsApp is opt-in; SMS is on unless the guardian turns it off)
--   * claim / complete with retry + back-off + dead-letter, safe for several workers at once (SKIP LOCKED)
--   * recipient resolution (the guardians of the student, or of the family)

alter table public.notification_outbox
  add column attempts int not null default 0, add column next_attempt_at timestamptz not null default now(),
  add column claimed_at timestamptz, add column last_error text, add column delivered_via text, add column delivered_at timestamptz;
alter table public.notification_outbox drop constraint notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending', 'sent', 'failed', 'skipped', 'dead'));
create index notification_outbox_due_idx on public.notification_outbox (next_attempt_at) where status = 'pending';

create table public.guardian_contact_prefs (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  guardian_id uuid not null, user_id uuid, -- the guardian's login at the time the preference was set (lets them read their own row)
  whatsapp_opt_in boolean not null default false, sms_opt_in boolean not null default true,
  locale text check (locale in ('en', 'ur')), quiet_from time, quiet_to time,
  consent_recorded_at timestamptz not null default now(), consent_recorded_by uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (guardian_id),
  foreign key (tenant_id, guardian_id) references public.guardians (tenant_id, id) on delete cascade,
  check ((quiet_from is null) = (quiet_to is null))
);
create index guardian_contact_prefs_tenant_idx on public.guardian_contact_prefs (tenant_id);

select app.secure_tenant_table('public.guardian_contact_prefs', '-');
alter policy tenant_select on public.guardian_contact_prefs using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('comms.broadcast')) or user_id = (select auth.uid())));
select app.attach_standard_triggers('public.guardian_contact_prefs');

-- One row per (message, guardian): a retry of the message skips guardians who already received it, so a flaky provider cannot double-send.
create table public.notification_deliveries (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  outbox_id uuid not null, guardian_id uuid not null, channel text not null check (channel in ('whatsapp', 'sms', 'app')),
  status text not null check (status in ('delivered', 'failed', 'skipped')), provider_msg_id text, detail text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (outbox_id, guardian_id),
  foreign key (tenant_id, guardian_id) references public.guardians (tenant_id, id) on delete cascade
);
create index notification_deliveries_tenant_idx on public.notification_deliveries (tenant_id, outbox_id);
select app.secure_tenant_table('public.notification_deliveries', '-', 'comms.broadcast');
select app.attach_standard_triggers('public.notification_deliveries', false);

-- A guardian sets their own preferences; school staff with comms.broadcast can record them on a guardian's behalf (e.g. a signed form).
create or replace function public.set_contact_prefs(
  p_guardian uuid, p_whatsapp boolean, p_sms boolean, p_locale text default null, p_quiet_from time default null, p_quiet_to time default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); g public.guardians;
begin
  if t is null or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into g from public.guardians where id = p_guardian and tenant_id = t;
  if not found then raise exception 'guardian not found' using errcode = '42501'; end if;
  -- coalesce: a guardian with no login has user_id NULL, and `not (NULL or false)` is NULL, which would let the check fall through
  if not (coalesce(g.user_id = auth.uid(), false) or app.has_permission('comms.broadcast')) then raise exception 'permission denied' using errcode = '42501'; end if;
  if (p_quiet_from is null) <> (p_quiet_to is null) then raise exception 'give both quiet-hours times or neither'; end if;
  insert into public.guardian_contact_prefs (tenant_id, guardian_id, user_id, whatsapp_opt_in, sms_opt_in, locale, quiet_from, quiet_to, consent_recorded_at, consent_recorded_by)
  values (t, g.id, g.user_id, p_whatsapp, p_sms, p_locale, p_quiet_from, p_quiet_to, now(), auth.uid())
  on conflict (guardian_id) do update set user_id = excluded.user_id, whatsapp_opt_in = excluded.whatsapp_opt_in, sms_opt_in = excluded.sms_opt_in,
    locale = excluded.locale, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, consent_recorded_at = now(), consent_recorded_by = auth.uid();
end $$;

-- ---------------------------------------------------------------- worker API (service_role only)
create or replace function public.claim_outbox(p_limit int default 50) returns setof public.notification_outbox
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- a claim older than 10 minutes belongs to a crashed worker and is taken over
  return query
  with c as (
    select id from public.notification_outbox
    where status = 'pending' and next_attempt_at <= now() and (claimed_at is null or claimed_at < now() - interval '10 minutes')
    order by next_attempt_at, created_at limit least(greatest(p_limit, 1), 200) for update skip locked)
  update public.notification_outbox o set claimed_at = now(), attempts = o.attempts + 1 from c where o.id = c.id returning o.*;
end $$;

-- p_outcome: sent | skipped (nobody to send to / no consent) | retry (transient failure, counts toward the 5 attempts)
--            | defer (not now — e.g. quiet hours; does NOT count as an attempt; p_delay_seconds says when) | dead (permanent failure)
create or replace function public.complete_outbox(p_id uuid, p_outcome text, p_channel text default null, p_error text default null, p_delay_seconds int default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.notification_outbox; v_status text;
begin
  select * into o from public.notification_outbox where id = p_id for update;
  if not found then raise exception 'outbox item not found'; end if;
  if o.status <> 'pending' then return o.status; end if; -- already settled by another worker
  v_status := case p_outcome
    when 'sent' then 'sent' when 'skipped' then 'skipped' when 'dead' then 'dead' when 'defer' then 'pending'
    when 'retry' then case when o.attempts >= 5 then 'dead' else 'pending' end
    else null end;
  if v_status is null then raise exception 'unknown outcome %', p_outcome; end if;
  update public.notification_outbox set status = v_status, claimed_at = null, last_error = left(p_error, 500),
    attempts = case when p_outcome = 'defer' then greatest(o.attempts - 1, 0) else o.attempts end,
    delivered_via = case when v_status = 'sent' then p_channel end, delivered_at = case when v_status = 'sent' then now() end,
    next_attempt_at = case when p_outcome = 'defer' then now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 60), 1))
                           when v_status = 'pending' then now() + (power(o.attempts, 2) * interval '1 minute') else next_attempt_at end
  where id = o.id;
  return v_status;
end $$;

create or replace function public.record_delivery(p_outbox uuid, p_guardian uuid, p_channel text, p_status text, p_msg_id text default null, p_detail text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.notification_outbox;
begin
  select * into o from public.notification_outbox where id = p_outbox;
  if not found then raise exception 'outbox item not found'; end if;
  insert into public.notification_deliveries (tenant_id, outbox_id, guardian_id, channel, status, provider_msg_id, detail)
  values (o.tenant_id, p_outbox, p_guardian, p_channel, p_status, p_msg_id, left(p_detail, 500))
  on conflict (outbox_id, guardian_id) do update set channel = excluded.channel, status = excluded.status, provider_msg_id = excluded.provider_msg_id, detail = excluded.detail
  where public.notification_deliveries.status <> 'delivered'; -- a delivered message is never downgraded
end $$;

-- Display data the worker needs at send time. Kept out of the outbox payload so names are read fresh and the queue holds ids only.
create or replace function public.outbox_context(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o public.notification_outbox; v_student uuid; v_exam uuid;
begin
  select * into o from public.notification_outbox where id = p_id;
  if not found then return null; end if;
  v_student := nullif(o.payload ->> 'student_id', '')::uuid;
  v_exam := nullif(o.payload ->> 'exam_id', '')::uuid;
  return jsonb_build_object(
    'school', (select name from public.tenants where id = o.tenant_id),
    'student', (select full_name from public.students where id = v_student and tenant_id = o.tenant_id),
    'exam', (select name from public.exams where id = v_exam and tenant_id = o.tenant_id));
end $$;

create or replace function public.outbox_recipients(p_id uuid)
returns table (guardian_id uuid, full_name text, phone text, whatsapp_opt_in boolean, sms_opt_in boolean, locale text, quiet_from time, quiet_to time, timezone text, delivered boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o public.notification_outbox; v_student uuid; v_family uuid;
begin
  select * into o from public.notification_outbox where id = p_id;
  if not found then return; end if;
  v_student := nullif(o.payload ->> 'student_id', '')::uuid;
  v_family := nullif(o.payload ->> 'family_id', '')::uuid;
  return query
    select g.id, g.full_name, g.phone, coalesce(p.whatsapp_opt_in, false), coalesce(p.sms_opt_in, true), coalesce(p.locale, tn.locale), p.quiet_from, p.quiet_to, tn.timezone,
           exists (select 1 from public.notification_deliveries d where d.outbox_id = p_id and d.guardian_id = g.id and d.status = 'delivered')
    from public.guardians g
    join public.tenants tn on tn.id = g.tenant_id
    left join public.guardian_contact_prefs p on p.guardian_id = g.id
    where g.tenant_id = o.tenant_id and g.phone is not null
      and ((v_student is not null and exists (select 1 from public.student_guardians sg where sg.tenant_id = g.tenant_id and sg.student_id = v_student and sg.guardian_id = g.id))
        or (v_student is null and v_family is not null and g.family_id = v_family));
end $$;

select app.apply_grants();
revoke insert, update, delete, truncate on public.guardian_contact_prefs from authenticated; -- written through set_contact_prefs
select app.harden_internal_functions();

revoke all on function public.set_contact_prefs(uuid, boolean, boolean, text, time, time), public.claim_outbox(int),
  public.complete_outbox(uuid, text, text, text, int), public.outbox_recipients(uuid), public.record_delivery(uuid, uuid, text, text, text, text),
  public.outbox_context(uuid) from public, anon, authenticated;
grant execute on function public.set_contact_prefs(uuid, boolean, boolean, text, time, time) to authenticated, service_role;
grant execute on function public.claim_outbox(int), public.complete_outbox(uuid, text, text, text, int), public.outbox_recipients(uuid),
  public.record_delivery(uuid, uuid, text, text, text, text), public.outbox_context(uuid) to service_role;

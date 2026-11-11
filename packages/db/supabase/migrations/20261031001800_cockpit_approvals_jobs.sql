-- Phase 2 · what the web app needs to be a product, not a schema:
--   my_access()        who am I here, what may I do, which plan features exist (drives the menu; the DB still re-checks every action)
--   approvals_inbox()  every maker-checker item waiting for someone, with whether THIS caller may act on it
--   school_cockpit()   the owner's one-screen picture; each block appears only if the caller may see that data
--   run_nightly()      service-role entry for the scheduled job (fines, plan/promise review, reminder ladder)

-- ---------------------------------------------------------------- my_access
create or replace function public.my_access() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); r jsonb;
begin
  if t is null then return null; end if;
  select jsonb_build_object(
    'tenant', jsonb_build_object('id', tn.id, 'name', tn.name, 'status', tn.status, 'locale', tn.locale, 'currency', tn.base_currency, 'timezone', tn.timezone),
    'permissions', coalesce((select jsonb_agg(p.key order by p.key) from public.permissions p where app.has_permission(p.key)), '[]'::jsonb),
    'features', to_jsonb(public.my_plan_features()),
    'is_guardian', exists (select 1 from public.guardians g where g.tenant_id = t and g.user_id = auth.uid())
  ) into r from public.tenants tn where tn.id = t;
  return r;
end $$;

-- ---------------------------------------------------------------- approvals inbox
-- DECISION: only items that are waiting on a second person. Single-step actions (waiver, write-off) are already gated by their own permission + MFA.
create or replace function public.approvals_inbox()
returns table (kind text, ref_id uuid, title text, detail text, amount_minor bigint, requested_at timestamptz, can_act boolean, blocked_reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); u uuid := auth.uid();
begin
  if t is null then return; end if;

  if app.has_permission('fees.concession.approve') or app.has_permission('fees.concession.request') then
    return query
    select 'concession'::text, c.id, s.full_name, c.reason,
           case when c.kind = 'fixed' then c.value end,  -- percent concessions carry basis points, not money
           c.created_at,
           app.has_permission('fees.concession.approve') and c.requested_by is distinct from u,
           case when not app.has_permission('fees.concession.approve') then 'needs fees.concession.approve'
                when c.requested_by is not distinct from u then 'you requested this' end
    from public.concessions c join public.students s on s.tenant_id = c.tenant_id and s.id = c.student_id
    where c.tenant_id = t and c.status = 'pending';
  end if;

  if app.has_permission('payroll.prepare') or app.has_permission('payroll.post') then
    return query
    select 'payroll'::text, r.id, to_char(r.period, 'Mon YYYY'), 'Net ' || r.net_minor::text, r.net_minor, r.created_at,
           app.has_permission('payroll.post') and r.prepared_by is distinct from u,
           case when not app.has_permission('payroll.post') then 'needs payroll.post (2FA)'
                when r.prepared_by is not distinct from u then 'you prepared this' end
    from public.payroll_runs r where r.tenant_id = t and r.status = 'draft';
  end if;

  if app.has_permission('exams.marks.moderate') or app.has_permission('results.publish') then
    return query
    select 'results'::text, e.id, e.name, 'In moderation', null::bigint, e.updated_at,
           app.has_permission('results.publish'),
           case when not app.has_permission('results.publish') then 'needs results.publish' end
    from public.exams e where e.tenant_id = t and e.status = 'moderation';
  end if;

  if app.has_permission('fees.view') then
    return query
    select 'bank_line'::text, b.id, b.reference, b.description, b.amount_minor, b.created_at,
           app.has_permission('fees.collect'),
           case when not app.has_permission('fees.collect') then 'needs fees.collect' end
    from public.bank_statement_lines b where b.tenant_id = t and b.status = 'unmatched';
  end if;
end $$;

-- ---------------------------------------------------------------- cockpit
create or replace function public.school_cockpit() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); today date; r jsonb := '{}'::jsonb; m date;
begin
  if t is null then return null; end if;
  today := app.tenant_today(t);
  m := date_trunc('month', today)::date;
  r := jsonb_build_object('date', today);

  if app.has_permission('students.view') then
    r := r || jsonb_build_object('students', jsonb_build_object(
      'active', (select count(*) from public.student_enrolments e where e.tenant_id = t and e.status = 'active'
                  and e.session_id in (select id from public.academic_sessions where tenant_id = t and is_current))));
  end if;

  if app.has_permission('fees.view') then
    r := r || jsonb_build_object('fees', jsonb_build_object(
      'outstanding_minor', coalesce((select sum(v.total_minor + v.adjusted_minor - v.paid_minor) from public.vouchers v where v.tenant_id = t and v.status in ('issued', 'partially_paid')), 0),
      'overdue_minor',     coalesce((select sum(v.total_minor + v.adjusted_minor - v.paid_minor) from public.vouchers v where v.tenant_id = t and v.status in ('issued', 'partially_paid') and v.due_date < today), 0),
      'overdue_families',  (select count(distinct v.family_id) from public.vouchers v where v.tenant_id = t and v.status in ('issued', 'partially_paid') and v.due_date < today),
      'collected_today_minor', coalesce((select sum(p.amount_minor) from public.payments p where p.tenant_id = t and p.received_on = today and p.channel <> 'advance' and p.voided_at is null), 0),
      'collected_month_minor', coalesce((select sum(p.amount_minor) from public.payments p where p.tenant_id = t and p.received_on >= m and p.channel <> 'advance' and p.voided_at is null), 0),
      'unmatched_bank_lines', (select count(*) from public.bank_statement_lines b where b.tenant_id = t and b.status = 'unmatched')));
  end if;

  if app.has_permission('attendance.view') then
    r := r || jsonb_build_object('attendance', jsonb_build_object(
      'sections_marked', (select count(*) from public.v_attendance_daily a where a.tenant_id = t and a.att_date = today),
      'sections_total',  (select count(*) from public.sections s where s.tenant_id = t),
      'present', coalesce((select sum(a.present) from public.v_attendance_daily a where a.tenant_id = t and a.att_date = today), 0),
      'absent',  coalesce((select sum(a.absent)  from public.v_attendance_daily a where a.tenant_id = t and a.att_date = today), 0)));
  end if;

  if app.has_permission('admissions.manage') and app.plan_has_feature(t, 'admissions_crm') then
    r := r || jsonb_build_object('admissions', jsonb_build_object(
      'open', (select count(*) from public.admission_inquiries i where i.tenant_id = t and i.stage not in ('enrolled', 'declined', 'lost')),
      'follow_ups_due', (select count(*) from public.admission_inquiries i where i.tenant_id = t and i.stage not in ('enrolled', 'declined', 'lost') and i.follow_up_on <= today)));
  end if;

  r := r || jsonb_build_object('pending_approvals', (select count(*) from public.approvals_inbox() x where x.can_act));
  return r;
end $$;

-- ---------------------------------------------------------------- nightly job
-- Runs the scheduled fee jobs for ONE tenant as that school's owner (the existing RPCs authorise from the session, and keeping a single
-- code path beats a second, unaudited one). service_role only; the job route loops over live tenants. Safe to run twice a day:
-- every step is idempotent (fines once per voucher, reminders one per ladder step, plan/promise review only moves forward).
-- DECISION: audit rows show the owner as actor with the memo 'nightly'; a dedicated system principal is a Phase 7 hardening item.
create or replace function public.run_nightly(p_tenant uuid, p_as_of date default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid; prev text := current_setting('request.jwt.claims', true); d date; r jsonb;
begin
  -- the gate is the GRANT below (service_role only); current_user inside a definer function is the owner, so it cannot be checked here
  if not exists (select 1 from public.tenants where id = p_tenant and status in ('trial', 'onboarding', 'live')) then
    return jsonb_build_object('skipped', 'tenant not active');
  end if;
  select ur.user_id into v_owner from public.user_roles ur join public.roles ro on ro.tenant_id = ur.tenant_id and ro.id = ur.role_id
    join public.user_tenants ut on ut.tenant_id = ur.tenant_id and ut.user_id = ur.user_id and ut.status = 'active'
    where ur.tenant_id = p_tenant and ro.key = 'school_owner' and (ur.expires_at is null or ur.expires_at > now())
    order by ur.created_at limit 1;
  if v_owner is null then return jsonb_build_object('skipped', 'no active owner'); end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'tenant_id', p_tenant, 'aal', 'aal2', 'role', 'authenticated')::text, true);
  d := coalesce(p_as_of, app.tenant_today(p_tenant));
  r := jsonb_build_object(
    'date', d,
    'fines', public.apply_fines(d),
    'plans_defaulted', public.review_installment_plans(d),
    'promises_broken', public.review_promises(d),
    'reminders_queued', public.queue_fee_reminders(d));
  perform set_config('request.jwt.claims', coalesce(prev, ''), true);
  return r;
exception when others then
  perform set_config('request.jwt.claims', coalesce(prev, ''), true);
  raise;
end $$;

-- who may call what
-- Supabase default privileges grant new functions to anon + authenticated explicitly, so `from public` alone does not close them.
revoke all on function public.my_access(), public.approvals_inbox(), public.school_cockpit() from public, anon;
grant execute on function public.my_access(), public.approvals_inbox(), public.school_cockpit() to authenticated;
revoke all on function public.run_nightly(uuid, date) from public, anon, authenticated;
grant execute on function public.run_nightly(uuid, date) to service_role;

select app.harden_internal_functions();
select app.apply_grants();

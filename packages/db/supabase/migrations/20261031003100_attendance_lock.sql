-- An employee's OWN attendance (self check-in from the app, or a punch from the fingerprint/face machine) cannot be overridden by HR,
-- the accountant or the owner. HR can still fill days where no check-in exists (absent, leave, a day the person forgot).
-- DECISION: "override" is refused silently per row and reported through the returned count, so a bulk day-marking never half-fails.
create or replace function public.mark_staff_attendance(p_date date, p_entries jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); e jsonb; n int := 0; c int;
begin
  if t is null or not (app.has_permission('payroll.prepare') or app.has_permission('staff.manage')) or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_date > app.tenant_today(t) then raise exception 'cannot mark attendance for a future date'; end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    if not exists (select 1 from public.staff_members where id = (e ->> 'staff_id')::uuid and tenant_id = t) then raise exception 'staff member not found' using errcode = '42501'; end if;
    insert into public.staff_attendance (tenant_id, staff_id, att_date, status, note, source, marked_by)
    values (t, (e ->> 'staff_id')::uuid, p_date, e ->> 'status', e ->> 'note', 'manual', auth.uid())
    on conflict (tenant_id, staff_id, att_date) do update set status = excluded.status, note = excluded.note, source = 'manual', marked_by = auth.uid()
      where staff_attendance.source = 'manual' or staff_attendance.check_in is null;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return n;
end $$;

select app.harden_internal_functions();

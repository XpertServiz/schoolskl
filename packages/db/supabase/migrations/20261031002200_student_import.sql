-- Bulk student import (setup wizard / start of term): an import handler for the existing create → dry-run → commit → rollback framework.
-- Rows come from a school's spreadsheet: full_name, class, section, guardian_name, guardian_phone, dob, gender.
-- Validation errors are CODES (e.g. "class_unknown"); the web page shows them in the user's language.

alter table public.import_rows add column if not exists result jsonb;

-- Same rules as packages/validation pkMobileSchema: strip spaces/brackets/dashes, 03xx / 92 / 0092 → +92, must be +923 + 9 digits.
create or replace function app.normalise_pk_phone(p text) returns text language plpgsql immutable as $$
declare s text := regexp_replace(coalesce(btrim(p), ''), '[\s()\-]', '', 'g');
begin
  if s like '+92%' then null;
  elsif s like '0092%' then s := '+' || substr(s, 3);
  elsif s like '92%' then s := '+' || s;
  elsif s like '0%' then s := '+92' || substr(s, 2);
  end if;
  return case when s ~ '^\+923[0-9]{9}$' then s else null end;
end $$;

-- 'YYYY-MM-DD', 'DD/MM/YYYY' or 'DD-MM-YYYY' (what spreadsheets export in Pakistan) → date; anything else → null.
create or replace function app.parse_school_date(p text) returns date language plpgsql immutable as $$
declare s text := btrim(coalesce(p, '')); m text[];
begin
  if s ~ '^\d{4}-\d{1,2}-\d{1,2}$' then
    m := regexp_match(s, '^(\d{4})-(\d{1,2})-(\d{1,2})$');
    return make_date(m[1]::int, m[2]::int, m[3]::int);
  elsif s ~ '^\d{1,2}[/-]\d{1,2}[/-]\d{4}$' then
    m := regexp_match(s, '^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$');
    return make_date(m[3]::int, m[2]::int, m[1]::int);
  end if;
  return null;
exception when others then return null; -- 31/02/2015 and friends
end $$;

-- Resolve one raw row against the school's classes. Returns the ids the apply step needs plus the list of error codes.
create or replace function app.import_resolve_student(p_tenant uuid, p_raw jsonb, p_session uuid,
  out class_id uuid, out campus_id uuid, out section_id uuid, out phone text, out dob date, out gender text, out errs jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_class text := lower(btrim(coalesce(p_raw ->> 'class', ''))); v_section text := lower(btrim(coalesce(p_raw ->> 'section', '')));
        v_g text := lower(btrim(coalesce(p_raw ->> 'gender', ''))); n_sections int;
begin
  errs := '[]'::jsonb;
  if p_session is null then errs := errs || '"no_current_session"'; end if;
  if length(btrim(coalesce(p_raw ->> 'full_name', ''))) < 2 then errs := errs || '"name_required"'; end if;
  select c.id, c.campus_id into class_id, campus_id from public.classes c where c.tenant_id = p_tenant and lower(btrim(c.name)) = v_class;
  if class_id is null then errs := errs || '"class_unknown"';
  else
    select count(*) into n_sections from public.sections s where s.tenant_id = p_tenant and s.class_id = import_resolve_student.class_id;
    if v_section <> '' then
      select s.id into section_id from public.sections s where s.tenant_id = p_tenant and s.class_id = import_resolve_student.class_id and lower(btrim(s.name)) = v_section;
      if section_id is null then errs := errs || '"section_unknown"'; end if;
    elsif n_sections = 1 then -- DECISION: a class with a single section needs no section column
      select s.id into section_id from public.sections s where s.tenant_id = p_tenant and s.class_id = import_resolve_student.class_id;
    elsif n_sections > 1 then errs := errs || '"section_required"';
    end if;
  end if;
  if length(btrim(coalesce(p_raw ->> 'guardian_name', ''))) < 2 then errs := errs || '"guardian_required"'; end if;
  phone := app.normalise_pk_phone(p_raw ->> 'guardian_phone');
  if phone is null then errs := errs || '"phone_invalid"'; end if;
  if btrim(coalesce(p_raw ->> 'dob', '')) <> '' then
    dob := app.parse_school_date(p_raw ->> 'dob');
    if dob is null or dob > current_date or dob < current_date - interval '30 years' then errs := errs || '"dob_invalid"'; dob := null; end if;
  end if;
  gender := case when v_g = '' then null when v_g in ('male', 'm', 'boy') then 'male' when v_g in ('female', 'f', 'girl') then 'female' when v_g = 'other' then 'other' else '?' end;
  if gender = '?' then errs := errs || '"gender_invalid"'; gender := null; end if;
end $$;

create or replace function app.import_validate_students(p_batch uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; x record; v_session uuid; v_name text;
begin
  for r in select * from public.import_rows where batch_id = p_batch order by row_no loop
    if v_session is null then select id into v_session from public.academic_sessions where tenant_id = r.tenant_id and is_current; end if;
    x := app.import_resolve_student(r.tenant_id, r.raw, v_session);
    v_name := lower(btrim(coalesce(r.raw ->> 'full_name', '')));
    if x.phone is not null and v_name <> '' then
      -- the same child twice in the file (same name + same guardian phone)
      if exists (select 1 from public.import_rows o where o.batch_id = p_batch and o.row_no < r.row_no
                 and lower(btrim(coalesce(o.raw ->> 'full_name', ''))) = v_name and app.normalise_pk_phone(o.raw ->> 'guardian_phone') = x.phone) then
        x.errs := x.errs || '"duplicate_in_file"';
      end if;
      -- already on file: a re-imported sheet must not create every child twice
      if exists (select 1 from public.students s
                 join public.student_guardians sg on sg.tenant_id = s.tenant_id and sg.student_id = s.id
                 join public.guardians g on g.tenant_id = sg.tenant_id and g.id = sg.guardian_id
                 where s.tenant_id = r.tenant_id and lower(btrim(s.full_name)) = v_name and app.normalise_pk_phone(g.phone) = x.phone) then
        x.errs := x.errs || '"already_on_file"';
      end if;
    end if;
    update public.import_rows set status = case when jsonb_array_length(x.errs) = 0 then 'valid' else 'error' end, errors = x.errs where id = r.id;
  end loop;
end $$;

-- Each valid row goes through enrol_student (the same path as the web form): it re-checks students.create for the caller, numbers the
-- admission, and links siblings by guardian phone. An existing guardian is matched on the NORMALISED phone and passed with its stored
-- spelling, so a sheet that writes "0300-1234567" still joins the family on file as "03001234567".
create or replace function app.import_apply_students(p_batch uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; x record; v_session uuid; v_phone text; v_student uuid; v_family uuid; v_new boolean;
begin
  for r in select * from public.import_rows where batch_id = p_batch and status = 'valid' order by row_no loop
    if v_session is null then select id into v_session from public.academic_sessions where tenant_id = r.tenant_id and is_current; end if;
    x := app.import_resolve_student(r.tenant_id, r.raw, v_session);
    if jsonb_array_length(x.errs) > 0 then raise exception 'row % changed since the dry run — run the check again', r.row_no; end if;
    select g.phone into v_phone from public.guardians g where g.tenant_id = r.tenant_id and app.normalise_pk_phone(g.phone) = x.phone order by g.created_at limit 1;
    v_new := v_phone is null;
    v_student := public.enrol_student(btrim(r.raw ->> 'full_name'), x.campus_id, v_session, x.class_id, x.section_id, x.dob, x.gender,
                                      btrim(r.raw ->> 'guardian_name'), coalesce(v_phone, x.phone), null);
    select family_id into v_family from public.students where id = v_student;
    update public.import_rows set status = 'committed', target_table = 'students', target_id = v_student,
           result = jsonb_build_object('family_id', v_family, 'family_created', v_new)
     where id = r.id;
  end loop;
end $$;

-- After a rollback has deleted the students (enrolments and guardian links cascade), remove the families this import created and that
-- now have no child. A family that already existed, or that gained another child since, is kept. A family with fee history cannot be
-- deleted (its vouchers reference it) — but then its student could not have been deleted either, and the rollback would already have failed.
create or replace function app.import_cleanup_students(p_batch uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select distinct (result ->> 'family_id')::uuid as family_id, tenant_id from public.import_rows
           where batch_id = p_batch and status = 'rolled_back' and (result ->> 'family_created')::boolean loop
    delete from public.families f where f.id = r.family_id and f.tenant_id = r.tenant_id
      and not exists (select 1 from public.students s where s.tenant_id = f.tenant_id and s.family_id = f.id);
  end loop;
end $$;

-- Rollback, now with an optional per-entity clean-up hook (app.import_cleanup_<entity>). Otherwise unchanged.
create or replace function public.import_batch_rollback(p_batch uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.import_batches; r record; v_n int := 0;
begin
  b := app.import_load_batch(p_batch, array['committed', 'rolled_back']);
  if b.status = 'rolled_back' then return 0; end if; -- idempotent
  for r in select * from public.import_rows where batch_id = b.id and status = 'committed' order by row_no desc loop
    -- target_table is only ever written by our own apply handlers, but re-check: tenant-owned table, tenant-scoped delete
    if r.target_table is null or r.target_table !~ '^[a-z_]+$' or not exists (
         select 1 from information_schema.columns where table_schema = 'public' and table_name = r.target_table and column_name = 'tenant_id') then
      raise exception 'row % has an unsafe rollback target', r.row_no;
    end if;
    execute format('delete from public.%I where id = $1 and tenant_id = $2', r.target_table) using r.target_id, b.tenant_id;
    update public.import_rows set status = 'rolled_back' where id = r.id;
    v_n := v_n + 1;
  end loop;
  if to_regprocedure(format('app.import_cleanup_%s(uuid)', b.entity)) is not null then
    execute format('select app.import_cleanup_%s($1)', b.entity) using b.id;
  end if;
  update public.import_batches set status = 'rolled_back', rolled_back_at = now() where id = b.id;
  insert into public.audit_log (tenant_id, actor_id, action, table_name, record_id, after)
  values (b.tenant_id, auth.uid(), 'import.rollback', 'import_batches', b.id::text, jsonb_build_object('entity', b.entity, 'rows', v_n));
  return v_n;
end $$;

revoke all on function public.import_batch_rollback(uuid) from public, anon;
grant execute on function public.import_batch_rollback(uuid) to authenticated, service_role;

select app.harden_internal_functions();

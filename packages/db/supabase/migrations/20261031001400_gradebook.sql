-- Phase 3 · gradebook: exams → assessments → marks (class-scoped entry) → moderation → publish (frozen snapshot) → report cards.
--   draft → marking (teachers enter) → moderation (teachers locked out, coordinator adjusts with a reason) → published (frozen; amendments are logged)
-- Results are never computed on the fly for parents: publishing writes a snapshot, so changing a grading scale later cannot rewrite history.

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null, name text not null, starts_on date, ends_on date,
  status text not null default 'draft' check (status in ('draft', 'marking', 'moderation', 'published')),
  published_at timestamptz, published_by uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  foreign key (tenant_id, session_id) references public.academic_sessions (tenant_id, id),
  unique (tenant_id, session_id, name), unique (tenant_id, id)
);

create table public.grading_scales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null, is_default boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, name), unique (tenant_id, id)
);
create unique index grading_one_default on public.grading_scales (tenant_id) where is_default;

create table public.grade_bands (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  scale_id uuid not null, min_percent numeric(5, 2) not null check (min_percent between 0 and 100),
  grade text not null, points numeric(3, 1) not null default 0, remark text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (scale_id, min_percent),
  foreign key (tenant_id, scale_id) references public.grading_scales (tenant_id, id) on delete cascade
);
create index grade_bands_tenant_idx on public.grade_bands (tenant_id);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  exam_id uuid not null, class_id uuid not null, subject_id uuid not null, max_marks numeric(7, 2) not null check (max_marks > 0),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, exam_id) references public.exams (tenant_id, id) on delete cascade,
  foreign key (tenant_id, class_id) references public.classes (tenant_id, id),
  foreign key (tenant_id, subject_id) references public.subjects (tenant_id, id),
  unique (tenant_id, exam_id, class_id, subject_id), unique (tenant_id, id)
);

create table public.marks (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  assessment_id uuid not null, student_id uuid not null,
  marks numeric(7, 2) check (marks >= 0), status text not null default 'present' check (status in ('present', 'absent', 'excused')),
  entered_by uuid, entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (assessment_id, student_id),
  check ((status = 'present') = (marks is not null)),
  foreign key (tenant_id, assessment_id) references public.assessments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references public.students (tenant_id, id)
);
create index marks_tenant_idx on public.marks (tenant_id, student_id);

create table public.mark_amendments (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  assessment_id uuid not null, student_id uuid not null,
  old_marks numeric(7, 2), old_status text, new_marks numeric(7, 2), new_status text,
  stage text not null check (stage in ('moderation', 'post_publish')), reason text not null,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, assessment_id) references public.assessments (tenant_id, id) on delete cascade
);
create index mark_amendments_idx on public.mark_amendments (tenant_id, assessment_id);

create table public.result_lines (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  exam_id uuid not null, student_id uuid not null, subject_id uuid not null, class_id uuid not null,
  marks numeric(7, 2), max_marks numeric(7, 2) not null, percent numeric(5, 2), grade text, points numeric(3, 1),
  status text not null check (status in ('present', 'absent', 'excused')),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (exam_id, student_id, subject_id),
  foreign key (tenant_id, exam_id) references public.exams (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references public.students (tenant_id, id)
);
create index result_lines_student_idx on public.result_lines (tenant_id, student_id);

create table public.result_summaries (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  exam_id uuid not null, student_id uuid not null, class_id uuid not null,
  total_marks numeric(9, 2) not null, total_max numeric(9, 2) not null, percent numeric(5, 2) not null, grade text, position int not null,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (exam_id, student_id),
  foreign key (tenant_id, exam_id) references public.exams (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references public.students (tenant_id, id)
);
create index result_summaries_student_idx on public.result_summaries (tenant_id, student_id);

-- ---------------------------------------------------------------- policies
select app.secure_tenant_table('public.exams', '-');                                      -- any member sees the exam calendar
select app.secure_tenant_table('public.grading_scales', 'settings.manage');
select app.secure_tenant_table('public.grade_bands', 'settings.manage');
select app.secure_tenant_table('public.assessments', '-');
alter policy tenant_select on public.assessments using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('exams.marks.moderate')) or (select app.has_permission('exams.marks.enter', 'class', class_id))));
select app.secure_tenant_table('public.marks', '-');
alter policy tenant_select on public.marks using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('exams.marks.moderate'))
       or exists (select 1 from public.assessments a where a.tenant_id = marks.tenant_id and a.id = marks.assessment_id
                  and (select app.has_permission('exams.marks.enter', 'class', a.class_id)))));
select app.secure_tenant_table('public.mark_amendments', '-', 'exams.marks.moderate');
-- Parents see a child's results only once the exam is published; staff with report-card/moderation rights see them as well.
select app.secure_tenant_table('public.result_lines', '-');
alter policy tenant_select on public.result_lines using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('reportcards.generate')) or (select app.has_permission('exams.marks.moderate'))
       or (select app.is_guardian_of_student(student_id))));
select app.secure_tenant_table('public.result_summaries', '-');
alter policy tenant_select on public.result_summaries using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('reportcards.generate')) or (select app.has_permission('exams.marks.moderate'))
       or (select app.is_guardian_of_student(student_id))));

select app.attach_standard_triggers('public.exams');
select app.attach_standard_triggers('public.grading_scales');
select app.attach_standard_triggers('public.grade_bands');
select app.attach_standard_triggers('public.assessments');
select app.attach_standard_triggers('public.marks');                  -- every mark change is in the audit log
select app.attach_standard_triggers('public.mark_amendments', false);
select app.attach_standard_triggers('public.result_lines', false);
select app.attach_standard_triggers('public.result_summaries', false);

-- ---------------------------------------------------------------- helpers
-- DECISION: placeholder scale; boards differ (Open Question: board formats). Schools edit grading_scales / grade_bands (settings.manage).
create or replace function app.seed_grading(p_tenant uuid) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_scale uuid;
begin
  select id into v_scale from public.grading_scales where tenant_id = p_tenant and is_default;
  if v_scale is not null then return v_scale; end if;
  insert into public.grading_scales (tenant_id, name, is_default) values (p_tenant, 'Standard', true) returning id into v_scale;
  insert into public.grade_bands (tenant_id, scale_id, min_percent, grade, points, remark) values
    (p_tenant, v_scale, 80, 'A1', 4.0, 'Outstanding'), (p_tenant, v_scale, 70, 'A', 3.5, 'Excellent'), (p_tenant, v_scale, 60, 'B', 3.0, 'Good'),
    (p_tenant, v_scale, 50, 'C', 2.5, 'Satisfactory'), (p_tenant, v_scale, 40, 'D', 2.0, 'Needs improvement'),
    (p_tenant, v_scale, 33, 'E', 1.0, 'Pass'), (p_tenant, v_scale, 0, 'F', 0.0, 'Below pass mark');
  return v_scale;
end $$;

create or replace function app.grade_for(p_tenant uuid, p_percent numeric) returns table (grade text, points numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.grade, b.points from public.grade_bands b join public.grading_scales s on s.tenant_id = b.tenant_id and s.id = b.scale_id and s.is_default
  where b.tenant_id = p_tenant and b.min_percent <= p_percent order by b.min_percent desc limit 1
$$;

-- Validate and upsert one mark. Used by teacher entry, moderation and post-publish amendment, so the rules cannot drift apart.
create or replace function app.upsert_mark(p_tenant uuid, p_assessment uuid, p_student uuid, p_marks numeric, p_status text, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.assessments; e public.exams;
begin
  select * into a from public.assessments where id = p_assessment and tenant_id = p_tenant;
  if not found then raise exception 'assessment not found' using errcode = '42501'; end if;
  select * into e from public.exams where id = a.exam_id and tenant_id = p_tenant;
  if p_status not in ('present', 'absent', 'excused') then raise exception 'status must be present, absent or excused'; end if;
  if p_status = 'present' then
    if p_marks is null then raise exception 'marks are required for a present student'; end if;
    if p_marks < 0 or p_marks > a.max_marks then raise exception 'marks must be between 0 and %', a.max_marks; end if;
    if p_marks <> round(p_marks, 2) then raise exception 'marks can have at most 2 decimal places'; end if;
  elsif p_marks is not null then
    raise exception 'an % student has no marks', p_status;
  end if;
  if not exists (select 1 from public.student_enrolments en join public.students st on st.tenant_id = en.tenant_id and st.id = en.student_id
                 where en.tenant_id = p_tenant and en.student_id = p_student and en.class_id = a.class_id and en.session_id = e.session_id and en.status = 'active' and st.status = 'enrolled') then
    raise exception 'student is not enrolled in this class for this exam''s session' using errcode = '22023';
  end if;
  insert into public.marks (tenant_id, assessment_id, student_id, marks, status, entered_by, entered_at)
  values (p_tenant, p_assessment, p_student, p_marks, p_status, p_actor, now())
  on conflict (assessment_id, student_id) do update set marks = excluded.marks, status = excluded.status, entered_by = excluded.entered_by, entered_at = now();
end $$;

-- Snapshot results for an exam from its marks (idempotent: rebuilt wholesale).
create or replace function app.compute_results(p_tenant uuid, p_exam uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.seed_grading(p_tenant);
  delete from public.result_summaries where tenant_id = p_tenant and exam_id = p_exam;
  delete from public.result_lines where tenant_id = p_tenant and exam_id = p_exam;

  insert into public.result_lines (tenant_id, exam_id, student_id, subject_id, class_id, marks, max_marks, percent, grade, points, status)
  select p_tenant, p_exam, x.student_id, x.subject_id, x.class_id, x.marks, x.max_marks, x.percent,
         case when x.status = 'excused' then null else g.grade end, case when x.status = 'excused' then null else g.points end, x.status
  from (select m.student_id, a.subject_id, a.class_id, m.marks, a.max_marks, m.status,
               case when m.status = 'excused' then null else round(coalesce(m.marks, 0) / a.max_marks * 100, 2) end as percent
        from public.assessments a join public.marks m on m.tenant_id = a.tenant_id and m.assessment_id = a.id
        where a.tenant_id = p_tenant and a.exam_id = p_exam) x
  left join lateral app.grade_for(p_tenant, x.percent) g on x.percent is not null;

  insert into public.result_summaries (tenant_id, exam_id, student_id, class_id, total_marks, total_max, percent, grade, position)
  select p_tenant, p_exam, s.student_id, s.class_id, s.total_marks, s.total_max, s.percent, g.grade,
         rank() over (partition by s.class_id order by s.percent desc)::int
  from (select l.student_id, l.class_id, sum(coalesce(l.marks, 0)) as total_marks, sum(l.max_marks) as total_max,
               round(sum(coalesce(l.marks, 0)) / sum(l.max_marks) * 100, 2) as percent
        from public.result_lines l where l.tenant_id = p_tenant and l.exam_id = p_exam and l.status <> 'excused'
        group by l.student_id, l.class_id) s
  left join lateral app.grade_for(p_tenant, s.percent) g on true;
end $$;

-- ---------------------------------------------------------------- exam lifecycle
create or replace function public.create_exam(p_session uuid, p_name text, p_starts date default null, p_ends date default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); v_id uuid;
begin
  if t is null or not app.has_permission('exams.marks.moderate') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  perform app.seed_grading(t);
  insert into public.exams (tenant_id, session_id, name, starts_on, ends_on) values (t, p_session, btrim(p_name), p_starts, p_ends) returning id into v_id;
  return v_id;
end $$;

create or replace function public.define_assessment(p_exam uuid, p_class uuid, p_subject uuid, p_max numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); e public.exams; v_id uuid;
begin
  if t is null or not app.has_permission('exams.marks.moderate') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into e from public.exams where id = p_exam and tenant_id = t for update;
  if not found then raise exception 'exam not found' using errcode = '42501'; end if;
  if e.status not in ('draft', 'marking') then raise exception 'assessments can only be added while the exam is in draft or marking (it is %)', e.status; end if;
  insert into public.assessments (tenant_id, exam_id, class_id, subject_id, max_marks) values (t, p_exam, p_class, p_subject, p_max) returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_exam_stage(p_exam uuid, p_stage text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); e public.exams;
begin
  if t is null or not app.has_permission('exams.marks.moderate') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into e from public.exams where id = p_exam and tenant_id = t for update;
  if not found then raise exception 'exam not found' using errcode = '42501'; end if;
  if not ((e.status = 'draft' and p_stage = 'marking') or (e.status = 'marking' and p_stage = 'moderation') or (e.status = 'moderation' and p_stage = 'marking')) then
    raise exception 'cannot move an exam from % to % this way (publishing has its own step)', e.status, p_stage;
  end if;
  if p_stage = 'marking' and e.status = 'draft' and not exists (select 1 from public.assessments where exam_id = e.id) then raise exception 'define at least one assessment first'; end if;
  update public.exams set status = p_stage where id = e.id;
end $$;

-- p_entries: [{"student_id":"…","marks":17.5} | {"student_id":"…","status":"absent"}]. Needs exams.marks.enter FOR THE ASSESSMENT'S CLASS.
create or replace function public.enter_marks(p_assessment uuid, p_entries jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); a public.assessments; e public.exams; r jsonb; n int := 0;
begin
  if t is null or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into a from public.assessments where id = p_assessment and tenant_id = t;
  if not found then raise exception 'assessment not found' using errcode = '42501'; end if;
  if not app.has_permission('exams.marks.enter', 'class', a.class_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into e from public.exams where id = a.exam_id and tenant_id = t;
  if e.status <> 'marking' then raise exception 'marks can only be entered while the exam is in marking (it is %)', e.status; end if;
  for r in select * from jsonb_array_elements(p_entries) loop
    perform app.upsert_mark(t, a.id, (r ->> 'student_id')::uuid, (r ->> 'marks')::numeric, coalesce(r ->> 'status', 'present'), auth.uid());
    n := n + 1;
  end loop;
  return n;
end $$;

-- Coordinator adjustment during moderation: every change records old → new and why.
create or replace function public.moderate_mark(p_assessment uuid, p_student uuid, p_marks numeric, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); a public.assessments; e public.exams; o public.marks;
begin
  if t is null or not app.has_permission('exams.marks.moderate') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into a from public.assessments where id = p_assessment and tenant_id = t;
  if not found then raise exception 'assessment not found' using errcode = '42501'; end if;
  select * into e from public.exams where id = a.exam_id;
  if e.status <> 'moderation' then raise exception 'moderation changes are only possible while the exam is in moderation (it is %)', e.status; end if;
  select * into o from public.marks where assessment_id = a.id and student_id = p_student;
  perform app.upsert_mark(t, a.id, p_student, p_marks, p_status, auth.uid());
  insert into public.mark_amendments (tenant_id, assessment_id, student_id, old_marks, old_status, new_marks, new_status, stage, reason)
  values (t, a.id, p_student, o.marks, o.status, p_marks, p_status, 'moderation', p_reason);
end $$;

create or replace function public.publish_results(p_exam uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); e public.exams; v_missing int; v_n int;
begin
  if t is null or not app.has_permission('results.publish') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into e from public.exams where id = p_exam and tenant_id = t for update;
  if not found then raise exception 'exam not found' using errcode = '42501'; end if;
  if e.status <> 'moderation' then raise exception 'results can only be published from moderation (exam is %)', e.status; end if;
  select count(*) into v_missing from public.assessments a
    join public.student_enrolments en on en.tenant_id = a.tenant_id and en.class_id = a.class_id and en.session_id = e.session_id and en.status = 'active'
    join public.students st on st.tenant_id = en.tenant_id and st.id = en.student_id and st.status = 'enrolled'
    left join public.marks m on m.tenant_id = a.tenant_id and m.assessment_id = a.id and m.student_id = en.student_id
    where a.tenant_id = t and a.exam_id = e.id and m.student_id is null;
  if v_missing > 0 then raise exception '% marks are still missing — enter them, or mark the student absent/excused', v_missing; end if;
  perform app.compute_results(t, e.id);
  update public.exams set status = 'published', published_at = now(), published_by = auth.uid() where id = e.id;
  insert into public.notification_outbox (tenant_id, kind, dedupe_key, payload)
  select t, 'results.published', 'results.published:' || e.id || ':' || rs.student_id, jsonb_build_object('exam_id', e.id, 'student_id', rs.student_id)
  from public.result_summaries rs where rs.tenant_id = t and rs.exam_id = e.id
  on conflict (tenant_id, dedupe_key) do nothing;
  select count(*) into v_n from public.result_summaries where tenant_id = t and exam_id = e.id;
  return v_n;
end $$;

-- After publication a mark can still be wrong. Correct it with a reason; the snapshot (and class positions) are rebuilt and families re-notified.
create or replace function public.amend_published_mark(p_assessment uuid, p_student uuid, p_marks numeric, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); a public.assessments; e public.exams; o public.marks; v_amend bigint;
begin
  if t is null or not app.has_permission('exams.marks.moderate') or not app.has_permission('results.publish') or not app.tenant_writable() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into a from public.assessments where id = p_assessment and tenant_id = t;
  if not found then raise exception 'assessment not found' using errcode = '42501'; end if;
  select * into e from public.exams where id = a.exam_id and tenant_id = t for update;
  if e.status <> 'published' then raise exception 'exam is not published (it is %)', e.status; end if;
  select * into o from public.marks where assessment_id = a.id and student_id = p_student;
  if not found then raise exception 'there is no mark to amend'; end if;
  perform app.upsert_mark(t, a.id, p_student, p_marks, p_status, auth.uid());
  insert into public.mark_amendments (tenant_id, assessment_id, student_id, old_marks, old_status, new_marks, new_status, stage, reason)
  values (t, a.id, p_student, o.marks, o.status, p_marks, p_status, 'post_publish', p_reason) returning id into v_amend;
  perform app.compute_results(t, e.id);
  insert into public.notification_outbox (tenant_id, kind, dedupe_key, payload)
  values (t, 'results.amended', 'results.amended:' || v_amend, jsonb_build_object('exam_id', e.id, 'student_id', p_student));
end $$;

-- ---------------------------------------------------------------- reading
create or replace function public.marks_progress(p_exam uuid) returns table (assessment_id uuid, class_id uuid, subject_id uuid, expected int, entered int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select a.id, a.class_id, a.subject_id,
      (select count(*)::int from public.student_enrolments en join public.students st on st.tenant_id = en.tenant_id and st.id = en.student_id and st.status = 'enrolled'
        where en.tenant_id = t and en.class_id = a.class_id and en.session_id = e.session_id and en.status = 'active'),
      (select count(*)::int from public.marks m where m.tenant_id = t and m.assessment_id = a.id)
    from public.assessments a join public.exams e on e.tenant_id = a.tenant_id and e.id = a.exam_id
    where a.tenant_id = t and a.exam_id = p_exam
      and (app.has_permission('exams.marks.moderate') or app.has_permission('exams.marks.enter', 'class', a.class_id));
end $$;

-- A published report card: staff with report-card rights, or the child's own guardians. Never anything pre-publication.
create or replace function public.report_card(p_student uuid, p_exam uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); e public.exams; st public.students; v_sum public.result_summaries; v_lines jsonb; v_bands jsonb;
begin
  if t is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if not (app.has_permission('reportcards.generate') or app.has_permission('exams.marks.moderate') or app.is_guardian_of_student(p_student)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into e from public.exams where id = p_exam and tenant_id = t;
  select * into st from public.students where id = p_student and tenant_id = t;
  if e.id is null or st.id is null then raise exception 'not found' using errcode = '42501'; end if;
  if e.status <> 'published' then return null; end if;
  select * into v_sum from public.result_summaries where tenant_id = t and exam_id = e.id and student_id = p_student;
  if not found then return null; end if;
  select jsonb_agg(jsonb_build_object('subject_code', sj.code, 'subject', sj.name, 'marks', l.marks, 'max_marks', l.max_marks, 'percent', l.percent,
                                      'grade', l.grade, 'status', l.status) order by sj.name) into v_lines
  from public.result_lines l join public.subjects sj on sj.tenant_id = l.tenant_id and sj.id = l.subject_id
  where l.tenant_id = t and l.exam_id = e.id and l.student_id = p_student;
  select jsonb_agg(jsonb_build_object('min_percent', b.min_percent, 'grade', b.grade, 'remark', b.remark) order by b.min_percent desc) into v_bands
  from public.grade_bands b join public.grading_scales s on s.tenant_id = b.tenant_id and s.id = b.scale_id and s.is_default where b.tenant_id = t;
  return jsonb_build_object(
    'student', jsonb_build_object('id', st.id, 'name', st.full_name, 'admission_no', st.admission_no),
    'exam', jsonb_build_object('id', e.id, 'name', e.name, 'published_at', e.published_at),
    'lines', coalesce(v_lines, '[]'::jsonb),
    'summary', jsonb_build_object('total_marks', v_sum.total_marks, 'total_max', v_sum.total_max, 'percent', v_sum.percent, 'grade', v_sum.grade, 'position', v_sum.position),
    'scale', coalesce(v_bands, '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- grants
select app.apply_grants();
select app.harden_internal_functions();

revoke all on function public.create_exam(uuid, text, date, date), public.define_assessment(uuid, uuid, uuid, numeric), public.set_exam_stage(uuid, text),
  public.enter_marks(uuid, jsonb), public.moderate_mark(uuid, uuid, numeric, text, text), public.publish_results(uuid),
  public.amend_published_mark(uuid, uuid, numeric, text, text), public.marks_progress(uuid), public.report_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_exam(uuid, text, date, date), public.define_assessment(uuid, uuid, uuid, numeric), public.set_exam_stage(uuid, text),
  public.enter_marks(uuid, jsonb), public.moderate_mark(uuid, uuid, numeric, text, text), public.publish_results(uuid),
  public.amend_published_mark(uuid, uuid, numeric, text, text), public.marks_progress(uuid), public.report_card(uuid, uuid) to authenticated, service_role;

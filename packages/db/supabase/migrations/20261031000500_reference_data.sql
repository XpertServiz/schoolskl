-- Phase 1 · reference data (global, not tenant data). Keys mirror packages/core/src/permissions.ts — a test keeps them in sync.

insert into public.permissions (key, module, sensitive, requires_mfa) values
  ('students.view','students',false,false), ('students.create','students',false,false), ('students.edit','students',false,false),
  ('students.delete','students',false,false), ('students.export','students',false,false), ('students.sensitive.view','students',true,false),
  ('admissions.manage','admissions',false,false),
  ('attendance.view','attendance',false,false), ('attendance.mark','attendance',false,false), ('attendance.edit_past','attendance',false,false),
  ('timetable.manage','academics',false,false), ('academics.homework.manage','academics',false,false),
  ('exams.marks.enter','exams',false,false), ('exams.marks.moderate','exams',false,false),
  ('results.publish','exams',false,false), ('reportcards.generate','exams',false,false),
  ('compass.view','compass',false,false), ('compass.approve_path','compass',false,false), ('compass.screening.view','compass',true,false),
  ('fees.view','fees',false,false), ('fees.structure.edit','fees',false,false), ('fees.voucher.generate','fees',false,false),
  ('fees.voucher.cancel','fees',false,false), ('fees.collect','fees',false,false), ('fees.concession.request','fees',false,false),
  ('fees.concession.approve','fees',false,false), ('fees.waiver.approve','fees',false,true), ('fees.writeoff.approve','fees',false,true),
  ('fees.refund.approve','fees',false,true), ('fees.cap.override','fees',false,true),
  ('accounts.journal.create','accounts',false,false), ('accounts.journal.approve','accounts',false,true),
  ('accounts.period.close','accounts',false,true), ('accounts.reports.view','accounts',false,false),
  ('payroll.prepare','hr',false,false), ('payroll.post','hr',false,true),
  ('transport.manage','transport',false,false), ('tracking.live.view','transport',true,false),
  ('health.view','health',true,false), ('health.edit','health',true,false), ('wellbeing.case.view','wellbeing',true,false),
  ('comms.broadcast','comms',false,false), ('comms.emergency','comms',false,false),
  ('website.edit','website',false,false), ('website.publish','website',false,false), ('website.delete','website',false,false),
  ('users.manage','admin',false,true), ('roles.manage','admin',false,true), ('settings.manage','admin',false,false),
  ('data.export','admin',false,true), ('data.import','admin',false,false), ('audit.view','admin',false,false),
  ('api.keys.manage','admin',false,true);

insert into public.role_templates (key, name) values
  ('school_owner','School owner'), ('principal','Principal'), ('campus_admin','Campus admin'), ('accountant','Accountant'),
  ('cashier','Cashier'), ('admissions_officer','Admissions officer'), ('coordinator','Coordinator'), ('teacher','Teacher'),
  ('class_teacher','Class teacher'), ('exam_controller','Exam controller'), ('hr_manager','HR manager'),
  ('transport_manager','Transport manager'), ('driver','Driver'), ('bus_attendant','Bus attendant'), ('librarian','Librarian'),
  ('store_keeper','Store keeper'), ('nurse','Nurse'), ('counsellor','Counsellor'), ('hostel_warden','Hostel warden'),
  ('canteen_operator','Canteen operator'), ('it_admin','IT admin'), ('parent','Parent / guardian'), ('student','Student'),
  ('alumni','Alumni'), ('auditor','Auditor (external)');

-- owner: everything
insert into public.role_template_permissions select 'school_owner', key from public.permissions;

-- principal: everything except platform-admin and the most sensitive/money-posting keys
insert into public.role_template_permissions
select 'principal', key from public.permissions
where key not in ('roles.manage', 'api.keys.manage', 'payroll.post', 'accounts.period.close', 'accounts.journal.create',
                  'wellbeing.case.view', 'health.edit', 'tracking.live.view', 'users.manage');

insert into public.role_template_permissions (role_key, permission_key) values
  ('campus_admin','students.view'), ('campus_admin','students.create'), ('campus_admin','students.edit'),
  ('campus_admin','admissions.manage'), ('campus_admin','attendance.view'), ('campus_admin','attendance.mark'),
  ('campus_admin','timetable.manage'), ('campus_admin','comms.broadcast'), ('campus_admin','website.edit'),
  ('accountant','students.view'), ('accountant','fees.view'), ('accountant','fees.structure.edit'),
  ('accountant','fees.voucher.generate'), ('accountant','fees.voucher.cancel'), ('accountant','fees.collect'),
  ('accountant','fees.concession.request'), ('accountant','accounts.journal.create'), ('accountant','accounts.reports.view'),
  ('accountant','payroll.prepare'), ('accountant','data.export'),
  ('cashier','students.view'), ('cashier','fees.view'), ('cashier','fees.collect'),
  ('admissions_officer','admissions.manage'), ('admissions_officer','students.view'), ('admissions_officer','students.create'),
  ('coordinator','students.view'), ('coordinator','attendance.view'), ('coordinator','exams.marks.moderate'), ('coordinator','compass.view'),
  ('teacher','students.view'), ('teacher','attendance.view'), ('teacher','attendance.mark'),
  ('teacher','academics.homework.manage'), ('teacher','exams.marks.enter'), ('teacher','compass.view'),
  ('class_teacher','students.view'), ('class_teacher','attendance.view'), ('class_teacher','attendance.mark'),
  ('class_teacher','academics.homework.manage'), ('class_teacher','exams.marks.enter'), ('class_teacher','compass.view'),
  ('class_teacher','reportcards.generate'),
  ('exam_controller','exams.marks.enter'), ('exam_controller','exams.marks.moderate'),
  ('exam_controller','reportcards.generate'), ('exam_controller','timetable.manage'),
  ('hr_manager','payroll.prepare'),
  ('transport_manager','transport.manage'), ('transport_manager','tracking.live.view'),
  ('nurse','health.view'), ('nurse','health.edit'),
  ('counsellor','wellbeing.case.view'), ('counsellor','compass.view'), ('counsellor','compass.screening.view'),
  ('it_admin','users.manage'), ('it_admin','settings.manage'),
  ('auditor','accounts.reports.view'), ('auditor','fees.view'), ('auditor','audit.view');

insert into public.plans (key, name, limits, sort_order) values
  ('starter',    'Starter',    '{"max_students":300,"max_campuses":1}', 1),
  ('growth',     'Growth',     '{"max_students":2000,"max_campuses":3}', 2),
  ('chain',      'Chain',      '{"max_campuses":null}', 3),
  ('enterprise', 'Enterprise', '{}', 4);
-- DECISION: prices stay NULL ("TBD") until Open Question 3 is answered; the pricing page must render "Contact us" for NULL.

insert into public.plan_features (plan_id, feature_key, enabled)
select p.id, f.key, f.starter or p.key <> 'starter' from public.plans p cross join (values
  ('double_entry_accounting', false), ('payroll', false), ('exams_kit', false), ('admissions_crm', false),
  ('custom_domain', false), ('api', false), ('sso', false), ('white_label_apps', false)) as f(key, starter)
where not (p.key in ('starter', 'growth') and f.key in ('custom_domain', 'api', 'sso', 'white_label_apps'))
  and not (p.key = 'chain' and f.key in ('sso', 'white_label_apps'));

insert into public.feature_flags (key, description, default_enabled) values
  ('saferoute',              'Bus tracking via driver app', false),
  ('saferoute_child_phone',  'Child-phone location. Stays OFF per tenant until a written legal opinion exists (CLAUDE.md §7.1)', false),
  ('learning_compass',       'Learning Compass profiles and milestone paths', false),
  ('face_attendance',        'Opt-in face attendance', false),
  ('principal_copilot',      'Principal / Owner Copilot', false),
  ('white_label_apps',       'Per-tenant branded mobile apps', false);

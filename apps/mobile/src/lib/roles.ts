/** Same list as the website's Add people page. Admin-level roles need a two-step-sign-in session (the database enforces it). */
export const ROLE_ORDER = ['teacher', 'class_teacher', 'accountant', 'cashier', 'driver', 'bus_attendant', 'parent', 'admissions_officer', 'coordinator',
  'exam_controller', 'hr_manager', 'transport_manager', 'campus_admin', 'principal', 'it_admin', 'school_owner'] as const;
export const ADMIN_ROLES = new Set<string>(['school_owner', 'principal', 'it_admin']);

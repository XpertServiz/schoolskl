/** Roles a school normally hands out, in the order people look for them (the picker on the Logins page and the Vendor "Add people" page). */
export const ROLE_ORDER = ['teacher', 'class_teacher', 'accountant', 'cashier', 'driver', 'bus_attendant', 'parent', 'admissions_officer', 'coordinator',
  'exam_controller', 'hr_manager', 'transport_manager', 'campus_admin', 'principal', 'it_admin', 'school_owner'] as const;

/** Admin-level roles: the school owner needs a 2FA session to hand these out (the database enforces it). */
export const ADMIN_ROLES = new Set<string>(['school_owner', 'principal', 'it_admin']);

// Permission catalogue (mirror of the `permissions` table — tests/rls-leak/structure.test.ts keeps them in sync)
// and a pure evaluator that mirrors app.has_permission() so UI can hide/disable without a round trip.

export const PERMISSION_KEYS = [
  'students.view', 'students.create', 'students.edit', 'students.delete', 'students.export', 'students.sensitive.view',
  'admissions.manage',
  'attendance.view', 'attendance.mark', 'attendance.edit_past',
  'timetable.manage', 'academics.homework.manage',
  'exams.marks.enter', 'exams.marks.moderate', 'results.publish', 'reportcards.generate',
  'compass.view', 'compass.approve_path', 'compass.screening.view',
  'fees.view', 'fees.structure.edit', 'fees.voucher.generate', 'fees.voucher.cancel', 'fees.collect',
  'fees.concession.request', 'fees.concession.approve', 'fees.waiver.approve', 'fees.writeoff.approve', 'fees.refund.approve', 'fees.cap.override',
  'accounts.journal.create', 'accounts.journal.approve', 'accounts.period.close', 'accounts.reports.view',
  'payroll.prepare', 'payroll.post',
  'transport.manage', 'tracking.live.view',
  'health.view', 'health.edit', 'wellbeing.case.view',
  'comms.broadcast', 'comms.emergency',
  'website.edit', 'website.publish', 'website.delete',
  'users.manage', 'roles.manage', 'settings.manage', 'data.export', 'data.import', 'audit.view', 'api.keys.manage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Keys that need an aal2 (2FA) session — money approvals and admin. */
export const MFA_KEYS: ReadonlySet<string> = new Set([
  'fees.waiver.approve', 'fees.writeoff.approve', 'fees.refund.approve', 'fees.cap.override', 'accounts.journal.approve',
  'accounts.period.close', 'payroll.post', 'users.manage', 'roles.manage', 'data.export', 'api.keys.manage',
]);

export type ScopeType = 'tenant' | 'campus' | 'class' | 'route';
export interface Scope { type: ScopeType; id?: string | null }

export interface Grant {
  key: string;
  effect?: 'grant' | 'deny'; // roles are implicit grants
  scope: Scope;
  expiresAt?: Date | null;
}

const covers = (g: Scope, want: Scope): boolean =>
  g.type === 'tenant' || (g.type === want.type && (g.id ?? null) === (want.id ?? null));

const live = (g: Grant, now: Date): boolean => !g.expiresAt || g.expiresAt > now;

/** Deny beats grant beats role; unknown keys never pass; MFA keys need aal2. */
export function can(
  key: string,
  want: Scope,
  ctx: { roleGrants: Grant[]; overrides: Grant[]; aal?: string; now?: Date },
): boolean {
  const now = ctx.now ?? new Date();
  if (!(PERMISSION_KEYS as readonly string[]).includes(key)) return false;
  if (MFA_KEYS.has(key) && ctx.aal !== 'aal2') return false;
  const match = (g: Grant) => g.key === key && live(g, now) && covers(g.scope, want);
  if (ctx.overrides.some((o) => o.effect === 'deny' && match(o))) return false;
  if (ctx.overrides.some((o) => o.effect === 'grant' && match(o))) return true;
  return ctx.roleGrants.some(match);
}

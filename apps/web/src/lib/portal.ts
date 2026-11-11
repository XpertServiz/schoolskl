import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { formatMoney, money } from '@ilmora/core';
import { t, type Locale } from '@ilmora/i18n';
import { requireUser } from './auth';
import { supabaseServer } from './supabase/server';

export interface Access {
  tenant: { id: string; name: string; status: string; locale: Locale; currency: string; timezone: string };
  permissions: string[];
  features: string[];
  /** feature flags switched on for this school (e.g. saferoute) */
  flags?: string[];
  is_guardian: boolean;
  /** driver or attendant on an active route */
  is_crew?: boolean;
}

export async function getLocale(): Promise<Locale> {
  return (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
}

/**
 * Everything a school page needs, resolved once per request. The menu and buttons are driven by `can()`/`has()`, but they are only a
 * convenience: every RPC and every RLS policy re-checks the same rules in the database, so hiding a button is never the security boundary.
 */
export async function portal() {
  const user = await requireUser();
  const sb = await supabaseServer();
  const { data } = await sb.rpc('my_access');
  const access = data as Access | null;
  if (!access) redirect('/portal/schools'); // signed in, but no school chosen (or no longer a member)
  // Someone who enrolled a second factor must use it: at aal1 the database refuses every money/payroll/admin key anyway, so make the
  // step-up explicit instead of showing a school full of silently-disabled buttons.
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') redirect('/portal/security');
  const mfaOff = aal?.nextLevel !== 'aal2' && aal?.currentLevel !== 'aal2';
  const locale = await getLocale();
  const perms = new Set(access.permissions);
  const feats = new Set(access.features);
  const fmtLocale = locale === 'ur' ? 'ur-PK' : 'en-PK';
  return {
    sb, user, access, locale, mfaOff,
    can: (key: string) => perms.has(key),
    // DECISION: an empty feature list means "no plan on file" (vendor-managed tenant) and is treated as everything-on, like app.plan_has_feature.
    has: (feature: string) => feats.size === 0 || feats.has(feature),
    flag: (key: string) => (access.flags ?? []).includes(key),
    tr: (key: string, vars: Record<string, string | number> = {}) => t(locale, key, vars),
    fmt: (minor: number | string | bigint | null | undefined) => formatMoney(money(BigInt(Math.trunc(Number(minor ?? 0))), access.tenant.currency), fmtLocale),
  };
}
export type Portal = Awaited<ReturnType<typeof portal>>;

/** Page guard: bounce to the cockpit with a message when the caller lacks the permission (the DB would refuse anyway). */
export function need(p: Portal, ...keys: string[]) {
  if (!keys.some((k) => p.can(k))) redirect('/portal?err=' + encodeURIComponent(p.tr('ui.noAccess')));
}

/** Server-action results travel as ?ok= / ?err= so they survive the redirect and need no client JS. */
export function done(path: string, message: string): never {
  redirect(`${path}${path.includes('?') ? '&' : '?'}ok=${encodeURIComponent(message)}`);
}
export function fail(path: string, error: { message: string }): never {
  redirect(`${path}${path.includes('?') ? '&' : '?'}err=${encodeURIComponent(error.message)}`);
}

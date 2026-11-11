import Link from 'next/link';
import { t } from '@ilmora/i18n';
import { requireUser } from '@/lib/auth';
import { getLocale } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { changePassword } from './actions';
import { EnrolPanel, StepUpForm, type Labels } from './panel';

const PW_ERRORS = ['short', 'mismatch', 'failed'] as const;

export const metadata = { title: 'Security', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Two-factor sign-in. Money, payroll and admin actions need a second factor (aal2) — the database refuses them otherwise — so this page is
 * how staff turn it on (enrol) and how a returning user proves it (step-up). `?next=` is validated by the action, never trusted here.
 */
export default async function Security({ searchParams }: { searchParams: Promise<{ ok?: string; verify?: string; next?: string; pw?: string; pwerr?: string }> }) {
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);
  await requireUser();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: f } = await sb.auth.mfa.listFactors();
  const enrolled = (f?.totp ?? []).length > 0;
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  const labels: Labels = {
    setUp: tr('security.setUp'), scan: tr('security.scan'), orType: tr('security.orType'), code: tr('auth.code'), confirm: tr('security.confirm'), verify: tr('auth.verify'),
    err: { start: tr('security.err.start'), enterCode: tr('security.err.enterCode'), retry: tr('security.err.retry'), wrongCode: tr('security.err.wrongCode'), noFactor: tr('security.err.noFactor') },
  };
  return (
    <div className="wrap">
      <h1>{tr('security.title')}</h1>
      {sp.ok ? <p role="status" className="flash ok">{tr('security.enabled')}</p> : null}
      {enrolled && aal?.currentLevel !== 'aal2' ? (
        <>
          <p>{tr('security.stepUp')}</p>
          <StepUpForm labels={labels} next={sp.next ?? '/portal'} />
        </>
      ) : enrolled ? (
        <p className="muted">{tr('security.active')}</p>
      ) : (
        <>
          <p>{tr('security.why')}</p>
          <EnrolPanel labels={labels} />
        </>
      )}
      {/* Changing the password needs the full session: someone with a second factor must step up first (the auth server enforces it too). */}
      {!(enrolled && aal?.currentLevel !== 'aal2') ? (
        <section>
          <h2>{tr('password.title')}</h2>
          <p className="muted">{tr('password.why')}</p>
          {sp.pw === 'ok' ? <p role="status" className="flash ok">{tr('password.saved')}</p> : null}
          {PW_ERRORS.includes(sp.pwerr as (typeof PW_ERRORS)[number]) ? <p role="alert" className="flash err">{tr(`password.err.${sp.pwerr}`)}</p> : null}
          <form action={changePassword} className="form card">
            <label>{tr('password.new')}<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={72} required dir="ltr" /></label>
            <label>{tr('password.confirm')}<input name="again" type="password" autoComplete="new-password" minLength={10} maxLength={72} required dir="ltr" /></label>
            <button className="btn">{tr('password.save')}</button>
          </form>
        </section>
      ) : null}
      <p><Link href="/portal">← {tr('ui.back')}</Link></p>
    </div>
  );
}

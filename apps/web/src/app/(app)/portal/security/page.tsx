import Link from 'next/link';
import { t } from '@ilmora/i18n';
import { requireUser } from '@/lib/auth';
import { getLocale } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { EnrolPanel, StepUpForm, type Labels } from './panel';

export const metadata = { title: 'Security', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Two-factor sign-in. Money, payroll and admin actions need a second factor (aal2) — the database refuses them otherwise — so this page is
 * how staff turn it on (enrol) and how a returning user proves it (step-up). `?next=` is validated by the action, never trusted here.
 */
export default async function Security({ searchParams }: { searchParams: Promise<{ ok?: string; verify?: string; next?: string }> }) {
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
      <p><Link href="/portal">← {tr('ui.back')}</Link></p>
    </div>
  );
}

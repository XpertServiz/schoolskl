import { cookies } from 'next/headers';
import { t, type Locale } from '@ilmora/i18n';
import Campus3DLazy from '@/components/landing/Campus3DLazy';
import NightSkyLazy from '@/components/landing/NightSkyLazy';
import { Icons } from '@/components/landing/icons';
import { setLocale } from '@/lib/locale-action';
import { pathRouting } from '@/lib/urls';
import { EmailCodeLogin, PasswordLogin, SignInCard } from './form';
import '../../../landing.css';

export const metadata = { title: 'Sign in', robots: { index: false, follow: false } };

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmified';

/** Sign in, dressed like the landing page: the night sky and the rising 3D campus beside a glass card. */
export default async function Login() {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const tr = (k: string) => t(locale, k);
  // the demo form lives on the marketing site: same host in path routing, the root domain otherwise
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost';
  const demoHref = pathRouting() ? '/demo' : `${root === 'localhost' ? 'http' : 'https'}://${root}${root === 'localhost' ? ':3000' : ''}/demo`;
  return (
    <div className="auth-split">
      <section className="auth-visual hero">
        <NightSkyLazy />
        <div className="auth-visual-in">
          <a href={pathRouting() ? '/' : demoHref.replace('/demo', '/')} className="l-brand">{Icons.logo}{product}</a>
          <h1>{tr('marketing.hero.title')}</h1>
          <p className="lead">{tr('marketing.v2.lead')}</p>
        </div>
        <div className="auth-campus campus-card"><Campus3DLazy label={tr('marketing.landing.campusLabel')} remember /></div>
      </section>

      <section className="auth-panel">
        <div className="auth-card glass">
          <div className="auth-top">
            <header className="auth-brand">{Icons.logo}<h1>{tr('auth.signIn')}</h1><p className="muted" style={{ margin: 0 }}>{product}</p></header>
            <form action={setLocale}>
              <input type="hidden" name="to" value={locale === 'ur' ? 'en' : 'ur'} />
              <input type="hidden" name="back" value="/portal/login" />
              <button className="l-lang" lang={locale === 'ur' ? 'en' : 'ur'}>{tr('nav.language')}</button>
            </form>
          </div>
          <SignInCard
            code={<EmailCodeLogin labels={{ email: tr('auth.email'), sendOtp: tr('auth.sendOtp'), code: tr('auth.emailCode'), verify: tr('auth.verify'), sent: tr('auth.emailCodeSent'), errors: { 'auth.err.badEmail': tr('auth.err.badEmail'), 'auth.err.sendFailed': tr('auth.err.sendFailed'), 'auth.err.badCode': tr('auth.err.badCode'), 'auth.err.wrongCode': tr('auth.err.wrongCode'), 'auth.err.tooMany': tr('auth.err.tooMany') } }} />}
            password={<>
              <PasswordLogin labels={{ email: tr('auth.email'), password: tr('auth.password'), signIn: tr('auth.signIn'), errors: { 'auth.err.fields': tr('auth.err.fields'), 'auth.err.wrong': tr('auth.err.wrong'), 'auth.err.tooMany': tr('auth.err.tooMany') } }} />
              <p className="muted" style={{ margin: '.6rem 0 0', fontSize: '.9rem' }}>{tr('password.forgot')}</p>
            </>}
            labels={{
              tabCode: tr('mobile.login.tabCode'), tabPassword: tr('mobile.login.tabPassword'), newHere: tr('mobile.login.firstTime'),
              activateBody: tr('mobile.login.firstTimeBody'), activate: tr('mobile.login.activate'),
              newSchool: tr('auth.newSchool'), newSchoolBody: tr('auth.newSchoolBody'), request: tr('auth.requestSchool'), requestHref: demoHref,
            }}
          />
        </div>
      </section>
    </div>
  );
}

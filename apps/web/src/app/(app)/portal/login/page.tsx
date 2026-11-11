import { cookies } from 'next/headers';
import { t, type Locale } from '@ilmora/i18n';
import { Icons } from '@/components/landing/icons';
import { EmailCodeLogin, PasswordLogin } from './form';

export const metadata = { title: 'Sign in', robots: { index: false, follow: false } };

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmora';

export default async function Login() {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const tr = (k: string) => t(locale, k);
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <header className="auth-brand">
          {Icons.logo}
          <h1>{product}</h1>
          <p className="muted" style={{ margin: 0 }}>{tr('auth.signIn')}</p>
        </header>
        <EmailCodeLogin labels={{ email: tr('auth.email'), sendOtp: tr('auth.sendOtp'), code: tr('auth.code'), verify: tr('auth.verify'), sent: tr('auth.emailCodeSent'), errors: { 'auth.err.badEmail': tr('auth.err.badEmail'), 'auth.err.sendFailed': tr('auth.err.sendFailed'), 'auth.err.badCode': tr('auth.err.badCode'), 'auth.err.wrongCode': tr('auth.err.wrongCode') } }} />
        <p className="auth-sep">{tr('auth.or')}</p>
        <PasswordLogin labels={{ email: tr('auth.email'), password: tr('auth.password'), signIn: tr('auth.signIn'), errors: { 'auth.err.fields': tr('auth.err.fields'), 'auth.err.wrong': tr('auth.err.wrong') } }} />
      </div>
    </div>
  );
}

import { dirOf, t, type Locale } from '@ilmora/i18n';

/**
 * Wraps a surface in <div lang dir> plus the skip link, in the given language. The root layout no longer knows the language (so that
 * public pages can be static); each surface passes it in — from the URL (marketing), the school (tenant site) or the cookie (portal, vendor).
 */
export function LocaleRoot({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <div className="lroot" lang={locale} dir={dirOf(locale)}>
      <a className="skip" href="#main">{t(locale, 'common.skip')}</a>
      {children}
    </div>
  );
}

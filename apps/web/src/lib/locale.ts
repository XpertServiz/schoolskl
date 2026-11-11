import type { Locale } from '@ilmora/i18n';

/** The two languages; anything else is English. Used for the static /m/<lang>/… marketing pages (params) and the cookie. */
export const asLocale = (v: string | undefined | null): Locale => (v === 'ur' ? 'ur' : 'en');

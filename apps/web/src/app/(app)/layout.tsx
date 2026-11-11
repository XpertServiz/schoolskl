import { LocaleRoot } from '@/components/locale-root';
import { getLocale } from '@/lib/portal';

/** Portal surfaces are signed-in and dynamic anyway: the language comes from the cookie, as it always has. */
export default async function AppSurface({ children }: { children: React.ReactNode }) {
  return <LocaleRoot locale={await getLocale()}>{children}</LocaleRoot>;
}

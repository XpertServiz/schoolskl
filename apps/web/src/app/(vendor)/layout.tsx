import { LocaleRoot } from '@/components/locale-root';
import { getLocale } from '@/lib/portal';

/** Vendor Console: signed-in and dynamic; language from the cookie. */
export default async function VendorSurface({ children }: { children: React.ReactNode }) {
  return <LocaleRoot locale={await getLocale()}>{children}</LocaleRoot>;
}

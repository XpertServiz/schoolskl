// Two ways to deploy the same app:
//  - host routing (default): app.<root>/portal, vendor.<root>/vendor, <slug>.<root> for school sites — needs a wildcard domain.
//  - path routing (NEXT_PUBLIC_ROUTING=path): everything on ONE host — <root>/portal, <root>/vendor, <root>/s/<slug>. For hosts that cannot
//    have subdomains, such as a free *.vercel.app address. Both are inlined at build time.
export const pathRouting = () => process.env.NEXT_PUBLIC_ROUTING === 'path';
const root = () => process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost';

/** Absolute (host routing) or relative (path routing) link to the portal sign-in. */
export function portalLoginUrl(): string {
  if (pathRouting()) return '/portal/login';
  const r = root();
  const local = r === 'localhost';
  return `${local ? 'http' : 'https'}://app.${r}${local ? ':3000' : ''}/portal/login`;
}

/** Public address of a school's website. */
export function schoolSiteUrl(slug: string): string {
  if (pathRouting()) return `/s/${slug}`;
  const r = root();
  return `${r === 'localhost' ? 'http' : 'https'}://${slug}.${r}`;
}

// Host → tenant resolution (CLAUDE.md §9.1). Pure so the middleware and tests share it.
// The database (public.resolve_tenant) is the authority; this only classifies the host so we know what to look up.

export type HostKind =
  | { kind: 'root' }                                  // marketing site
  | { kind: 'reserved'; label: string }               // app., vendor., www. …
  | { kind: 'tenant-subdomain'; slug: string }
  | { kind: 'custom-domain'; host: string };

export const RESERVED_LABELS = ['www', 'app', 'admin', 'api', 'vendor', 'auth', 'static', 'cdn', 'mail', 'portal'] as const;

export function classifyHost(rawHost: string, rootDomain: string): HostKind {
  const host = rawHost.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const root = rootDomain.trim().toLowerCase();
  if (host === root || host === 'localhost') return { kind: 'root' };
  if (host.endsWith(`.${root}`) || host.endsWith('.localhost')) {
    const label = host.slice(0, host.length - (host.endsWith('.localhost') ? '.localhost'.length : root.length + 1));
    if (label.includes('.')) return { kind: 'custom-domain', host }; // a.b.root is not a valid tenant subdomain
    if ((RESERVED_LABELS as readonly string[]).includes(label)) return { kind: 'reserved', label };
    return { kind: 'tenant-subdomain', slug: label };
  }
  return { kind: 'custom-domain', host };
}

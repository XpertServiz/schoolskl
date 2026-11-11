import { classifyHost, type HostKind } from '@ilmora/core';

export interface ResolvedTenant {
  tenant_id: string;
  slug: string;
  name: string;
  branding: Record<string, unknown>;
  locale: 'en' | 'ur';
}

export const rootDomain = () => process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost';
export const hostKind = (host: string): HostKind => classifyHost(host, rootDomain());

/**
 * Ask the database who owns this host. public.resolve_tenant is the only function anon may call and returns
 * public branding only (unverified custom domains never resolve). Plain fetch keeps the edge middleware light.
 */
export async function resolveTenant(host: string): Promise<ResolvedTenant | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/resolve_tenant`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_host: host.replace(/:\d+$/, '').toLowerCase() }),
      next: { revalidate: 3600 }, // cached per host (the body is part of the key); public branding only
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as ResolvedTenant[];
    return rows[0] ?? null;
  } catch {
    return null; // fail closed: an unresolvable host is "not found", never "some other tenant"
  }
}

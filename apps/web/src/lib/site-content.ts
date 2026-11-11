export interface SiteMedia { id: string; kind: 'demo' | 'reel'; title_en: string; title_ur: string; url: string }
export interface SiteContent { media: SiteMedia[]; settings: Record<string, string> }

/**
 * The marketing site's editable content (managed in Vendor Console → Website): demo video, reels, contact and social links, announcement.
 * Public, anon-readable rows only (RLS: active media + website settings — no school data). Cached for 10 minutes; saving in the console
 * clears the cache at once. Any failure returns empty content — the site never breaks because this table is unreachable.
 */
export async function getSiteContent(): Promise<SiteContent> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const empty: SiteContent = { media: [], settings: {} };
  if (!url || !key) return empty;
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const [m, s] = await Promise.all([
      fetch(`${url}/rest/v1/site_media?select=id,kind,title_en,title_ur,url&order=sort_order,created_at&limit=24`, { headers: h, next: { revalidate: 600, tags: ['site-content'] } }),
      fetch(`${url}/rest/v1/site_settings?select=key,value`, { headers: h, next: { revalidate: 600, tags: ['site-content'] } }),
    ]);
    if (!m.ok || !s.ok) return empty;
    const media = (await m.json()) as SiteMedia[];
    const settings = Object.fromEntries(((await s.json()) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    return { media, settings };
  } catch {
    return empty;
  }
}

/** WhatsApp number → wa.me link (digits only, international format, no +). */
export const whatsappLink = (n: string | undefined) => { const d = (n ?? '').replace(/\D/g, ''); return d.length >= 10 && d.length <= 15 ? `https://wa.me/${d}` : null; };

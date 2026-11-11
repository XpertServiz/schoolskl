import { z } from 'zod';
import { allow, clientIp } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|facebookexternalhit|whatsapp|curl|wget|python|node-fetch|axios/i;
const body = z.object({ path: z.enum(['/', '/apps', '/pricing', '/privacy', '/demo']), lang: z.enum(['en', 'ur']), first: z.boolean() });

/**
 * Website visitor counter (see VisitBeacon). Stores only a daily total per page and language — no IP, no user agent, no cookie.
 * Known crawlers and heavy repeat callers are ignored; the answer is always an empty 204 so nothing can be probed.
 */
export async function POST(req: Request) {
  const none = () => new Response(null, { status: 204 });
  if (BOT.test(req.headers.get('user-agent') ?? '')) return none();
  if (!allow('visit', await clientIp(), 90, 60)) return none();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return none();
  try { await supabaseService().rpc('record_visit', { p_path: parsed.data.path, p_lang: parsed.data.lang, p_first: parsed.data.first }); } catch { /* a counter must never fail a page */ }
  return none();
}

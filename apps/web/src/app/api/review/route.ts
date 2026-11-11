import { z } from 'zod';
import { allow, clientIp } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({
  name: z.string().trim().min(2).max(80), school: z.string().trim().max(120).optional(), rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().min(5).max(600).refine((s) => !/[<>]/.test(s)), website: z.string().max(0).optional(), // honeypot
});

/** A visitor's review. It is stored as "pending": nothing is shown on the site until the super admin approves it. */
export async function POST(req: Request) {
  if (!allow('review', await clientIp(), 3, 3600)) return Response.json({ ok: false, error: 'rate' }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  if (parsed.data.website) return Response.json({ ok: true }); // bots get a happy answer and nothing is stored
  const { error } = await supabaseService().from('site_reviews').insert({ name: parsed.data.name, school_name: parsed.data.school || null, rating: parsed.data.rating, comment: parsed.data.comment, status: 'pending', source: 'visitor' });
  return error ? Response.json({ ok: false, error: 'failed' }, { status: 500 }) : Response.json({ ok: true });
}

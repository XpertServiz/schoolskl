import { NextResponse } from 'next/server';
import { PROVIDER_IDS, PROVIDERS, processWebhook, providerSecret, type ProviderId } from '@ilmora/providers';
import { supabaseService } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // node:crypto for HMAC

// POST /api/webhooks/{provider} — payment notifications. The RAW body is what the provider signed, so read it as text first.
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!(PROVIDER_IDS as readonly string[]).includes(provider)) return NextResponse.json({ ok: false, code: 'unknown_provider' }, { status: 404 });
  const id = provider as ProviderId;
  const rawBody = await req.text();
  if (rawBody.length > 64 * 1024) return NextResponse.json({ ok: false, code: 'too_large' }, { status: 413 });

  const result = await processWebhook({
    cfg: PROVIDERS[id],
    secret: providerSecret(id, process.env),
    rawBody,
    headers: (n) => req.headers.get(n),
    nowSec: Math.floor(Date.now() / 1000),
    record: async (e) => {
      const { data, error } = await supabaseService().rpc('handle_payment_webhook', {
        p_provider: e.provider, p_event_id: e.eventId, p_consumer_no: e.consumerNo,
        p_amount_minor: e.amountMinor.toString(), p_provider_ref: e.providerRef,
      });
      if (error) throw new Error(error.message);
      return { paymentId: (data as string | null) ?? null };
    },
  });
  return NextResponse.json(result.body, { status: result.status });
}

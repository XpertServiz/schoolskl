import { NextResponse } from 'next/server';
import { runOutbox, type Channel, type Provider, type Recipient } from '@ilmora/comms';
import { cronAuthorised as authorised } from '@/lib/cron';
import { supabaseService } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Real WhatsApp/SMS adapters are NOT written yet: the WhatsApp BSP and SMS gateway are still open questions (CLAUDE.md §22). Until one is
 * chosen, the only provider is a dry-run logger (NOTIFY_DRY_RUN=1) so the whole path can be exercised without messaging anyone.
 * With no provider, this job refuses to run: messages stay pending instead of being claimed and dropped.
 */
function providers(): Partial<Record<Channel, Provider>> {
  if (process.env.NOTIFY_DRY_RUN !== '1') return {};
  const dry = (ch: Channel): Provider => ({ send: async (m) => { console.info(`[notify:dry-run:${ch}] -> ${m.to}: ${m.text}`); return { id: `dry-${Date.now()}` }; } });
  return { sms: dry('sms'), whatsapp: dry('whatsapp') };
}

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ ok: false, code: 'unauthorised' }, { status: 401 });
  const p = providers();
  if (!p.sms && !p.whatsapp) return NextResponse.json({ ok: false, code: 'no_provider_configured' }, { status: 503 });
  const sb = supabaseService();
  const summary = await runOutbox({
    providers: p,
    now: () => new Date(),
    claim: async (limit) => { const { data, error } = await sb.rpc('claim_outbox', { p_limit: limit }); if (error) throw new Error(error.message); return data ?? []; },
    recipients: async (id) => { const { data, error } = await sb.rpc('outbox_recipients', { p_id: id }); if (error) throw new Error(error.message); return (data ?? []) as Recipient[]; },
    context: async (id) => { const { data, error } = await sb.rpc('outbox_context', { p_id: id }); if (error) throw new Error(error.message); return data ?? { school: null, student: null, exam: null }; },
    complete: async (id, outcome, channel, err, delay) => {
      const { error } = await sb.rpc('complete_outbox', { p_id: id, p_outcome: outcome, p_channel: channel ?? null, p_error: err ?? null, p_delay_seconds: delay ?? null });
      if (error) throw new Error(error.message);
    },
    record: async (id, guardianId, channel, status, msgId, detail) => {
      const { error } = await sb.rpc('record_delivery', { p_outbox: id, p_guardian: guardianId, p_channel: channel, p_status: status, p_msg_id: msgId ?? null, p_detail: detail ?? null });
      if (error) throw new Error(error.message);
    },
  });
  return NextResponse.json({ ok: true, ...summary });
}

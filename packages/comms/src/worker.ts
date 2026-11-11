import { planChannels, quietStatus, type Channel, type Recipient } from './channels';
import { renderNotification, type NotificationContext } from './render';

export class ProviderError extends Error {
  constructor(message: string, readonly permanent: boolean) { super(message); this.name = 'ProviderError'; }
}

export interface OutboxItem { id: string; tenant_id: string; kind: string; payload: Record<string, unknown>; attempts: number }

export interface Provider { send(msg: { to: string; text: string; locale: string }): Promise<{ id: string }> }

export type Outcome = 'sent' | 'skipped' | 'retry' | 'defer' | 'dead';

export interface WorkerDeps {
  claim(limit: number): Promise<OutboxItem[]>;
  recipients(id: string): Promise<Recipient[]>;
  context(id: string): Promise<NotificationContext>;
  complete(id: string, outcome: Outcome, channel?: Channel | null, error?: string | null, delaySeconds?: number | null): Promise<void>;
  record(id: string, guardianId: string, channel: Channel, status: 'delivered' | 'failed' | 'skipped', providerMsgId?: string | null, detail?: string | null): Promise<void>;
  providers: Partial<Record<Channel, Provider>>;
  now(): Date;
  limit?: number;
}

export interface RunSummary { claimed: number; sent: number; skipped: number; retried: number; deferred: number; dead: number }

/**
 * Deliver one batch. Per message: render in each guardian's language → pick consented channels → respect quiet hours → try providers in
 * order with fallback → remember who got it (so a retry never double-sends) → settle the message exactly once.
 * One bad message never stops the batch: every error is caught and turned into a retry/dead outcome for that message only.
 */
export async function runOutbox(deps: WorkerDeps): Promise<RunSummary> {
  const out: RunSummary = { claimed: 0, sent: 0, skipped: 0, retried: 0, deferred: 0, dead: 0 };
  const items = await deps.claim(deps.limit ?? 50);
  out.claimed = items.length;

  for (const item of items) {
    try {
      const ctx = await deps.context(item.id);
      const recipients = await deps.recipients(item.id);
      const res = await deliver(item, ctx, recipients, deps);
      await deps.complete(item.id, res.outcome, res.channel ?? null, res.error ?? null, res.delaySeconds ?? null);
      if (res.outcome === 'sent') out.sent++; else if (res.outcome === 'skipped') out.skipped++; else if (res.outcome === 'defer') out.deferred++;
      else if (res.outcome === 'dead') out.dead++; else out.retried++;
    } catch (e) {
      // unexpected failure (database blip etc.): leave the message for another attempt, never lose it
      await deps.complete(item.id, 'retry', null, `worker error: ${(e as Error).message}`).catch(() => undefined);
      out.retried++;
    }
  }
  return out;
}

async function deliver(item: OutboxItem, ctx: NotificationContext, recipients: Recipient[], deps: WorkerDeps):
  Promise<{ outcome: Outcome; channel?: Channel; error?: string; delaySeconds?: number }> {
  if (renderNotification(item.kind, item.payload, ctx, 'en') === null) return { outcome: 'dead', error: `unknown notification kind "${item.kind}"` };
  if (recipients.length === 0) return { outcome: 'skipped', error: 'no recipients with a phone number' };

  let delivered = recipients.filter((r) => r.delivered).length, transient = false, firstChannel: Channel | undefined, minDefer = Infinity;
  const notes: string[] = [];
  const preferred = typeof item.payload.channel === 'string' ? item.payload.channel : undefined;

  for (const r of recipients) {
    if (r.delivered) continue;
    const channels = planChannels(r, preferred);
    if (channels.length === 0) {
      await deps.record(item.id, r.guardian_id, 'sms', 'skipped', null, 'no consented channel');
      notes.push(`${r.full_name}: no consented channel`);
      continue;
    }
    const quiet = quietStatus(deps.now(), r.timezone, r.quiet_from, r.quiet_to);
    if (quiet.quiet) { minDefer = Math.min(minDefer, quiet.resumeInSeconds); continue; }

    const text = renderNotification(item.kind, item.payload, ctx, r.locale)!;
    let ok = false;
    for (const ch of channels) {
      const provider = deps.providers[ch];
      if (!provider) { notes.push(`no ${ch} provider configured`); continue; }
      try {
        const sent = await provider.send({ to: r.phone, text, locale: r.locale });
        await deps.record(item.id, r.guardian_id, ch, 'delivered', sent.id);
        delivered++; ok = true; firstChannel ??= ch;
        break;
      } catch (e) {
        const permanent = e instanceof ProviderError && e.permanent;
        notes.push(`${ch}: ${(e as Error).message}`);
        await deps.record(item.id, r.guardian_id, ch, 'failed', null, (e as Error).message);
        if (!permanent) transient = true; // try the next channel now; if nothing works the message is retried later
      }
    }
    if (!ok && !transient) notes.push(`${r.full_name}: unreachable`);
  }

  if (Number.isFinite(minDefer)) return { outcome: 'defer', delaySeconds: minDefer, error: 'quiet hours' };
  if (transient && delivered < recipients.length) return { outcome: 'retry', error: notes.join('; ').slice(0, 500) };
  if (delivered > 0) return { outcome: 'sent', channel: firstChannel, error: notes.length ? notes.join('; ').slice(0, 500) : undefined };
  return { outcome: 'skipped', error: notes.join('; ').slice(0, 500) || 'nobody could be reached' };
}

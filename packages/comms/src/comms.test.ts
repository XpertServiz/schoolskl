import { describe, expect, it, vi } from 'vitest';
import { planChannels, ProviderError, quietStatus, renderNotification, runOutbox, type OutboxItem, type Provider, type Recipient, type WorkerDeps } from './index';

const ctx = { school: 'Noor Academy', student: 'Zara Ahmed', exam: 'Mid-term' };

describe('renderNotification', () => {
  it('renders every kind in both languages with all placeholders filled', () => {
    const fee = { tone: 'firm', balance_minor: '600000', voucher_no: 'V202611-000001', consumer_no: '1000000042', due_date: '2026-11-11' };
    for (const locale of ['en', 'ur'] as const) {
      for (const [kind, payload] of [['attendance.absent', { date: '2026-11-05' }], ['fee.reminder', fee], ['results.published', {}], ['results.amended', {}]] as const) {
        const text = renderNotification(kind, payload, ctx, locale)!;
        expect(text, `${locale} ${kind}`).toBeTruthy();
        expect(text, `${locale} ${kind} has an unfilled placeholder`).not.toMatch(/\{\w+\}/);
        expect(text).toContain('Noor Academy');
      }
    }
    expect(renderNotification('fee.reminder', fee, ctx, 'en')).toContain('PKR 6,000.00');
    expect(renderNotification('fee.reminder', fee, ctx, 'ur')).toMatch(/یاد دہانی/);
  });
  it('picks the tone, defaults to gentle, and returns null for an unknown kind', () => {
    const p = { balance_minor: '100', voucher_no: 'V1', consumer_no: '9', due_date: '2026-01-01' };
    expect(renderNotification('fee.reminder', { ...p, tone: 'final' }, ctx, 'en')).toMatch(/final reminder/);
    expect(renderNotification('fee.reminder', { ...p, tone: 'rude' }, ctx, 'en')).toMatch(/is due on/);
    expect(renderNotification('weird.kind', {}, ctx, 'en')).toBeNull();
  });
  it('never labels anyone', () => {
    const all = ['attendance.absent', 'fee.reminder', 'results.published'].flatMap((k) => (['en', 'ur'] as const).map((l) => renderNotification(k, { tone: 'final', balance_minor: '1' }, ctx, l)!));
    for (const text of all) expect(text.toLowerCase()).not.toMatch(/defaulter|failed|weak|slow|problem/);
  });
});

describe('planChannels', () => {
  it('WhatsApp only with opt-in; SMS unless switched off; preferred channel first when allowed', () => {
    expect(planChannels({ whatsapp_opt_in: false, sms_opt_in: true })).toEqual(['sms']);
    expect(planChannels({ whatsapp_opt_in: true, sms_opt_in: true })).toEqual(['whatsapp', 'sms']);
    expect(planChannels({ whatsapp_opt_in: true, sms_opt_in: true }, 'sms')).toEqual(['sms', 'whatsapp']);
    expect(planChannels({ whatsapp_opt_in: false, sms_opt_in: true }, 'whatsapp')).toEqual(['sms']); // not consented → never WhatsApp
    expect(planChannels({ whatsapp_opt_in: false, sms_opt_in: false })).toEqual([]);
    expect(planChannels({ whatsapp_opt_in: true, sms_opt_in: false }, 'app')).toEqual(['whatsapp']);
  });
});

describe('quiet hours', () => {
  // 2026-11-05 17:30 UTC = 22:30 in Karachi (UTC+5)
  const at = new Date('2026-11-05T17:30:00Z');
  it('wraps midnight, respects the timezone, and reports when it ends', () => {
    expect(quietStatus(at, 'Asia/Karachi', '22:00', '07:00')).toEqual({ quiet: true, resumeInSeconds: 8.5 * 3600 });
    expect(quietStatus(at, 'UTC', '22:00', '07:00').quiet).toBe(false); // 17:30 in UTC
    expect(quietStatus(at, 'Asia/Karachi', '23:00', '07:00').quiet).toBe(false);
    expect(quietStatus(at, 'Asia/Karachi', '13:00', '14:00').quiet).toBe(false);
    expect(quietStatus(at, 'Asia/Karachi', null, null).quiet).toBe(false);
    expect(quietStatus(new Date('2026-11-05T01:00:00Z'), 'Asia/Karachi', '22:00', '07:00')).toEqual({ quiet: true, resumeInSeconds: 3600 }); // 06:00 local, an hour left
    expect(quietStatus(new Date('2026-11-05T02:00:00Z'), 'Asia/Karachi', '22:00', '07:00').quiet).toBe(false); // 07:00 local: the end is exclusive
  });
});

// ----------------------------------------------------------------------------------------------------------------- worker
const rec = (over: Partial<Recipient> = {}): Recipient => ({
  guardian_id: 'g1', full_name: 'Mr Ahmed', phone: '0300', whatsapp_opt_in: false, sms_opt_in: true, locale: 'en',
  quiet_from: null, quiet_to: null, timezone: 'Asia/Karachi', delivered: false, ...over,
});
const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({ id: 'o1', tenant_id: 't', kind: 'attendance.absent', payload: { date: '2026-11-05' }, attempts: 1, ...over });
const ok = (name: string): Provider => ({ send: vi.fn(async () => ({ id: `${name}-1` })) });

function harness(items: OutboxItem[], recipients: Recipient[], providers: WorkerDeps['providers'], now = new Date('2026-11-05T08:00:00Z')) {
  const complete = vi.fn(async () => undefined);
  const record = vi.fn(async () => undefined);
  const deps: WorkerDeps = { claim: async () => items, recipients: async () => recipients, context: async () => ctx, complete, record, providers, now: () => now };
  return { deps, complete, record };
}

describe('runOutbox', () => {
  it('delivers by SMS to a guardian with defaults, records it, and settles the message as sent', async () => {
    const sms = ok('sms');
    const h = harness([item()], [rec()], { sms });
    expect(await runOutbox(h.deps)).toMatchObject({ claimed: 1, sent: 1 });
    expect(sms.send).toHaveBeenCalledWith({ to: '0300', text: expect.stringContaining('Zara Ahmed'), locale: 'en' });
    expect(h.record).toHaveBeenCalledWith('o1', 'g1', 'sms', 'delivered', 'sms-1');
    expect(h.complete).toHaveBeenCalledWith('o1', 'sent', 'sms', null, null);
  });

  it('sends in the guardian’s own language', async () => {
    const sms = ok('sms');
    await runOutbox(harness([item()], [rec({ locale: 'ur' })], { sms }).deps);
    expect((sms.send as any).mock.calls[0][0].text).toMatch(/غیر حاضر/);
  });

  it('never uses WhatsApp without opt-in, even if the message asks for it', async () => {
    const wa = ok('wa'), sms = ok('sms');
    await runOutbox(harness([item({ payload: { channel: 'whatsapp', date: 'd' } })], [rec()], { whatsapp: wa, sms }).deps);
    expect(wa.send).not.toHaveBeenCalled();
    expect(sms.send).toHaveBeenCalledTimes(1);
  });

  it('falls back to SMS when WhatsApp fails, and reports success', async () => {
    const wa: Provider = { send: vi.fn(async () => { throw new ProviderError('bsp down', false); }) };
    const sms = ok('sms');
    const h = harness([item()], [rec({ whatsapp_opt_in: true })], { whatsapp: wa, sms });
    expect(await runOutbox(h.deps)).toMatchObject({ sent: 1, retried: 0 });
    expect(h.record).toHaveBeenCalledWith('o1', 'g1', 'whatsapp', 'failed', null, 'bsp down');
    expect(h.record).toHaveBeenCalledWith('o1', 'g1', 'sms', 'delivered', 'sms-1');
  });

  it('a transient failure everywhere is retried, not lost; a permanent one (bad number) is skipped, not retried forever', async () => {
    const flaky: Provider = { send: async () => { throw new ProviderError('timeout', false); } };
    expect(await runOutbox(harness([item()], [rec()], { sms: flaky }).deps)).toMatchObject({ retried: 1, sent: 0 });
    const invalid: Provider = { send: async () => { throw new ProviderError('invalid number', true); } };
    const h = harness([item()], [rec()], { sms: invalid });
    expect(await runOutbox(h.deps)).toMatchObject({ skipped: 1, retried: 0 });
    expect(h.complete).toHaveBeenCalledWith('o1', 'skipped', null, expect.stringContaining('invalid number'), null);
  });

  it('a retry does not message someone who already got it', async () => {
    const sms = ok('sms');
    const h = harness([item()], [rec({ guardian_id: 'g1', delivered: true }), rec({ guardian_id: 'g2', phone: '0321' })], { sms });
    await runOutbox(h.deps);
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect((sms.send as any).mock.calls[0][0].to).toBe('0321');
    expect(h.complete).toHaveBeenCalledWith('o1', 'sent', 'sms', null, null);
  });

  it('defers during quiet hours until they end, without sending', async () => {
    const sms = ok('sms');
    const h = harness([item()], [rec({ quiet_from: '22:00', quiet_to: '07:00' })], { sms }, new Date('2026-11-05T17:30:00Z'));
    expect(await runOutbox(h.deps)).toMatchObject({ deferred: 1, sent: 0 });
    expect(sms.send).not.toHaveBeenCalled();
    expect(h.complete).toHaveBeenCalledWith('o1', 'defer', null, 'quiet hours', 8.5 * 3600);
  });

  it('skips a guardian with no consented channel; skips a message with nobody to tell; dead-letters an unknown kind', async () => {
    const sms = ok('sms');
    const none = harness([item()], [rec({ sms_opt_in: false })], { sms });
    expect(await runOutbox(none.deps)).toMatchObject({ skipped: 1 });
    expect(none.record).toHaveBeenCalledWith('o1', 'g1', 'sms', 'skipped', null, 'no consented channel');
    expect(await runOutbox(harness([item()], [], { sms }).deps)).toMatchObject({ skipped: 1 });
    const dead = harness([item({ kind: 'mystery' })], [rec()], { sms });
    expect(await runOutbox(dead.deps)).toMatchObject({ dead: 1 });
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('one broken message does not stop the batch', async () => {
    const sms = ok('sms');
    let calls = 0;
    const complete = vi.fn(async () => undefined);
    const deps: WorkerDeps = {
      claim: async () => [item({ id: 'bad' }), item({ id: 'good' })],
      recipients: async (id) => { if (id === 'bad' && ++calls) throw new Error('db blip'); return [rec()]; },
      context: async () => ctx, complete, record: async () => undefined, providers: { sms }, now: () => new Date(),
    };
    expect(await runOutbox(deps)).toMatchObject({ claimed: 2, sent: 1, retried: 1 });
    expect(complete).toHaveBeenCalledWith('bad', 'retry', null, 'worker error: db blip');
  });

  it('a missing provider for the only consented channel ends as skipped with a visible reason, never silently sent', async () => {
    const h = harness([item()], [rec()], {});
    expect(await runOutbox(h.deps)).toMatchObject({ skipped: 1, sent: 0 });
    expect(h.complete).toHaveBeenCalledWith('o1', 'skipped', null, expect.stringContaining('no sms provider configured'), null);
  });
});

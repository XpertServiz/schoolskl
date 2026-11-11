import { minorDigits } from '@ilmora/core';
import { verifySignature, withinTolerance, type SigAlgo, type SigEncoding } from './signature';

// Provider webhooks → one normalised payment event → public.handle_payment_webhook (idempotent per provider event).
// DECISION: the field names and header names below are CONFIGURATION, not knowledge of each partner's API. They are placeholders to be
// confirmed against the signed integration document of each provider (Raast/1Link, JazzCash, Easypaisa, PayFast, Safepay) before go-live.

export const PROVIDER_IDS = ['raast', 'onebill', 'jazzcash', 'easypaisa', 'payfast', 'safepay', 'card', 'bank'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface NormalisedPayment { provider: ProviderId; eventId: string; consumerNo: string; amountMinor: bigint; providerRef: string | null }

export interface FieldMap {
  eventId: string; consumerNo: string; amount: string; providerRef?: string;
  /** how the provider expresses the amount */
  amountUnit: 'major' | 'minor';
}

export interface ProviderConfig {
  id: ProviderId;
  signatureHeader: string; algo: SigAlgo; encoding: SigEncoding; prefix?: string;
  timestampHeader?: string; toleranceSec: number;
  fields: FieldMap;
}

const get = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

/** "1500.50" → 150050n, never via floats. Rejects negatives, exponents, too many decimals. */
export function toMinor(value: unknown, unit: 'major' | 'minor', currency = 'PKR'): bigint {
  const d = minorDigits(currency);
  const s = typeof value === 'number' ? (Number.isSafeInteger(value) ? String(value) : value.toFixed(d)) : String(value ?? '').trim();
  if (unit === 'minor') {
    if (!/^\d+$/.test(s)) throw new Error('amount must be a whole number of minor units');
    return BigInt(s);
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[2] ?? '').length > d) throw new Error(`amount must be a non-negative decimal with at most ${d} places`);
  return BigInt(m[1]!) * 10n ** BigInt(d) + BigInt((m[2] ?? '').padEnd(d, '0') || '0');
}

export function normalise(cfg: ProviderConfig, body: unknown): NormalisedPayment {
  const eventId = get(body, cfg.fields.eventId), consumerNo = get(body, cfg.fields.consumerNo);
  if (typeof eventId !== 'string' && typeof eventId !== 'number') throw new Error('missing event id');
  if (typeof consumerNo !== 'string' && typeof consumerNo !== 'number') throw new Error('missing consumer number');
  const amountMinor = toMinor(get(body, cfg.fields.amount), cfg.fields.amountUnit);
  if (amountMinor <= 0n) throw new Error('amount must be positive');
  const ref = cfg.fields.providerRef ? get(body, cfg.fields.providerRef) : null;
  return { provider: cfg.id, eventId: String(eventId), consumerNo: String(consumerNo), amountMinor, providerRef: ref == null ? null : String(ref) };
}

export interface WebhookResult { status: number; body: { ok: boolean; code: string; paymentId?: string | null } }

export type RecordFn = (e: NormalisedPayment) => Promise<{ paymentId: string | null }>;

/**
 * Verify → parse → record. Order matters: nothing is parsed or recorded before the signature (and replay window) pass.
 * The RPC is idempotent per provider event, so provider retries are safe; an unknown consumer number answers 202 so the provider stops
 * retrying while the payment waits for manual reconciliation (never silently dropped, never guessed onto another family).
 */
export async function processWebhook(opts: {
  cfg: ProviderConfig; secret: string | undefined; rawBody: string; headers: (name: string) => string | null; nowSec: number; record: RecordFn;
}): Promise<WebhookResult> {
  const { cfg } = opts;
  if (!opts.secret) return { status: 503, body: { ok: false, code: 'provider_not_configured' } };
  const sig = opts.headers(cfg.signatureHeader);
  if (!verifySignature({ secret: opts.secret, payload: opts.rawBody, signature: sig, algo: cfg.algo, encoding: cfg.encoding, prefix: cfg.prefix })) {
    return { status: 401, body: { ok: false, code: 'bad_signature' } };
  }
  if (cfg.timestampHeader) {
    const ts = Number(opts.headers(cfg.timestampHeader));
    if (!withinTolerance(ts, opts.nowSec, cfg.toleranceSec)) return { status: 401, body: { ok: false, code: 'stale_or_missing_timestamp' } };
  }
  let event: NormalisedPayment;
  try { event = normalise(cfg, JSON.parse(opts.rawBody)); } catch { return { status: 400, body: { ok: false, code: 'bad_payload' } }; }
  try {
    const r = await opts.record(event);
    return { status: 200, body: { ok: true, code: 'recorded', paymentId: r.paymentId } };
  } catch (e) {
    if (/unknown consumer number/i.test((e as Error).message)) return { status: 202, body: { ok: true, code: 'unmatched' } };
    return { status: 500, body: { ok: false, code: 'record_failed' } }; // provider will retry; the RPC is idempotent
  }
}

const base = (id: ProviderId): ProviderConfig => ({
  id, signatureHeader: 'x-signature', algo: 'sha256', encoding: 'hex', timestampHeader: 'x-timestamp', toleranceSec: 300,
  fields: { eventId: 'event_id', consumerNo: 'consumer_number', amount: 'amount', providerRef: 'transaction_ref', amountUnit: 'major' },
});

/** Placeholder registry — see the DECISION at the top. Secrets come from PROVIDER_SECRET_<ID> env vars. */
export const PROVIDERS: Record<ProviderId, ProviderConfig> = Object.fromEntries(PROVIDER_IDS.map((id) => [id, base(id)])) as Record<ProviderId, ProviderConfig>;
export const providerSecret = (id: ProviderId, env: Record<string, string | undefined>): string | undefined => env[`PROVIDER_SECRET_${id.toUpperCase()}`];

import { createHmac, timingSafeEqual } from 'node:crypto';

// Webhook authenticity. Server-only (node:crypto). A payment is only recorded after this passes.

export type SigEncoding = 'hex' | 'base64';
export type SigAlgo = 'sha256' | 'sha512';

export function hmac(secret: string, payload: string | Buffer, algo: SigAlgo = 'sha256', encoding: SigEncoding = 'hex'): string {
  return createHmac(algo, secret).update(payload).digest(encoding);
}

/** Constant-time comparison; tolerates an optional `sha256=` style prefix and surrounding whitespace. Never throws. */
export function verifySignature(opts: {
  secret: string; payload: string | Buffer; signature: string | null | undefined;
  algo?: SigAlgo; encoding?: SigEncoding; prefix?: string;
}): boolean {
  if (!opts.secret || !opts.signature) return false;
  let sig = opts.signature.trim();
  if (opts.prefix && sig.startsWith(opts.prefix)) sig = sig.slice(opts.prefix.length);
  const expected = Buffer.from(hmac(opts.secret, opts.payload, opts.algo, opts.encoding));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Replay guard: the provider's timestamp must be within ±toleranceSec of now. */
export function withinTolerance(timestampSec: number, nowSec: number, toleranceSec: number): boolean {
  return Number.isFinite(timestampSec) && Math.abs(nowSec - timestampSec) <= toleranceSec;
}

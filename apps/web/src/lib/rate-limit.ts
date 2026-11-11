import { headers } from 'next/headers';

/**
 * Simple fixed-window rate limit for public forms (sign-in, demo request), kept in the server instance's memory.
 * DECISION: in-memory is "simple rate limiting" — on Vercel each warm instance keeps its own counts, so a determined attacker spread over
 * many instances gets more tries; Supabase Auth still enforces its own limits on codes and passwords behind this. It only stops cheap
 * floods from burning CPU. Keys are the client IP + a bucket name; nothing else is stored.
 */
const hits = new Map<string, { n: number; reset: number }>();
const MAX_KEYS = 10_000;

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim();
}

/** true = allowed. `limit` requests per `windowSec` per IP for this bucket. */
export function allow(bucket: string, ip: string, limit: number, windowSec: number): boolean {
  const now = Date.now();
  const key = `${bucket}:${ip}`;
  const e = hits.get(key);
  if (!e || e.reset <= now) {
    if (hits.size >= MAX_KEYS) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); // sweep expired entries
    if (hits.size >= MAX_KEYS) hits.clear(); // never grow without bound
    hits.set(key, { n: 1, reset: now + windowSec * 1000 });
    return true;
  }
  e.n++;
  return e.n <= limit;
}

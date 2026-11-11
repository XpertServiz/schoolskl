import { timingSafeEqual } from 'node:crypto';

/** Scheduled-job routes accept only `Authorization: Bearer $CRON_SECRET`, compared in constant time. No secret configured = nobody gets in. */
export function cronAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization') ?? '';
  if (!secret) return false;
  const want = Buffer.from(`Bearer ${secret}`), got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

import type { Locale } from '@ilmora/i18n';

export type Channel = 'whatsapp' | 'sms';

export interface Recipient {
  guardian_id: string; full_name: string; phone: string;
  whatsapp_opt_in: boolean; sms_opt_in: boolean; locale: Locale;
  quiet_from: string | null; quiet_to: string | null; timezone: string;
  /** already delivered on an earlier attempt of the same message — never send twice */
  delivered: boolean;
}

/**
 * Channels to try, best first. WhatsApp needs the guardian's explicit opt-in; SMS is on unless they switched it off.
 * The message's own preferred channel (e.g. the reminder ladder step) goes first when it is allowed; 'app' push has no sender yet
 * and falls through to the next. An empty list means "no consented way to reach this person" — the caller records that and moves on.
 */
export function planChannels(r: Pick<Recipient, 'whatsapp_opt_in' | 'sms_opt_in'>, preferred?: string): Channel[] {
  const allowed: Channel[] = [];
  if (r.whatsapp_opt_in) allowed.push('whatsapp');
  if (r.sms_opt_in) allowed.push('sms');
  if (preferred === 'sms' || preferred === 'whatsapp') {
    const i = allowed.indexOf(preferred);
    if (i > 0) allowed.unshift(allowed.splice(i, 1)[0]!);
  }
  return allowed;
}

const toMinutes = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) throw new Error(`bad time "${hhmm}"`);
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Local wall-clock minutes since midnight in an IANA timezone. */
export function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/** Quiet hours may wrap midnight (22:00 → 07:00). `resumeInSeconds` is how long until they end, for the worker to defer by. */
export function quietStatus(now: Date, timeZone: string, from: string | null, to: string | null): { quiet: boolean; resumeInSeconds: number } {
  if (!from || !to) return { quiet: false, resumeInSeconds: 0 };
  const f = toMinutes(from), e = toMinutes(to), cur = localMinutes(now, timeZone);
  if (f === e) return { quiet: false, resumeInSeconds: 0 };
  const quiet = f < e ? cur >= f && cur < e : cur >= f || cur < e;
  if (!quiet) return { quiet: false, resumeInSeconds: 0 };
  const minutesLeft = (e - cur + 1440) % 1440 || 1440;
  return { quiet: true, resumeInSeconds: minutesLeft * 60 };
}

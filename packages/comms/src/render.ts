import { formatMoney, money } from '@ilmora/core';
import { t, type Locale } from '@ilmora/i18n';

export interface NotificationContext { school: string | null; student: string | null; exam: string | null }

const str = (v: unknown): string => (v == null ? '' : String(v));

/**
 * Outbox row → message text in the recipient's language, or null when the kind is unknown (the worker then dead-letters it rather than
 * sending something blank). Names come from `ctx` (read fresh from the database at send time); the queue itself holds ids only.
 * Wording is deliberately neutral: it states a fact about a voucher or a mark, and never labels a child or a family.
 */
export function renderNotification(kind: string, payload: Record<string, unknown>, ctx: NotificationContext, locale: Locale): string | null {
  const base = { school: ctx.school ?? '', student: ctx.student ?? '', exam: ctx.exam ?? '' };
  switch (kind) {
    case 'attendance.absent':
      return t(locale, 'notify.absent', { ...base, date: str(payload.date) });
    case 'fee.reminder': {
      const tone = ['gentle', 'firm', 'final'].includes(str(payload.tone)) ? str(payload.tone) : 'gentle';
      const minor = BigInt(str(payload.balance_minor) || '0');
      return t(locale, `notify.feeReminder.${tone}`, {
        ...base, voucherNo: str(payload.voucher_no), consumerNo: str(payload.consumer_no), dueDate: str(payload.due_date),
        amount: formatMoney(money(minor, 'PKR'), locale === 'ur' ? 'ur-PK' : 'en-PK'),
      });
    }
    case 'results.published':
      return t(locale, 'notify.resultsPublished', base);
    case 'results.amended':
      return t(locale, 'notify.resultsAmended', base);
    default:
      return null;
  }
}

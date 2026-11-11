// Money is integer minor units + ISO currency (CLAUDE.md rule 2). Never floats; formatting only at the UI edge.

export interface Money {
  readonly minor: bigint;
  readonly currency: string;
}

const MINOR_DIGITS: Record<string, number> = { PKR: 2, USD: 2, GBP: 2, AED: 2, JPY: 0, KWD: 3 };

export const minorDigits = (currency: string): number => MINOR_DIGITS[currency] ?? 2;

export function money(minor: bigint | number, currency: string): Money {
  if (typeof minor === 'number' && !Number.isSafeInteger(minor)) {
    throw new RangeError(`money(): ${minor} is not a safe integer — pass bigint minor units`);
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError(`money(): bad currency ${currency}`);
  return { minor: BigInt(minor), currency };
}

function same(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
}

export const add = (a: Money, b: Money): Money => (same(a, b), money(a.minor + b.minor, a.currency));
export const sub = (a: Money, b: Money): Money => (same(a, b), money(a.minor - b.minor, a.currency));
export const negate = (a: Money): Money => money(-a.minor, a.currency);

/** Parse a decimal string ("1500", "1,500.50") into minor units without ever touching a float. */
export function parseMoney(input: string, currency: string): Money {
  const digits = minorDigits(currency);
  const clean = input.trim().replace(/,/g, '');
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(clean);
  if (!m) throw new RangeError(`parseMoney(): "${input}" is not a number`);
  const frac = m[3] ?? '';
  if (frac.length > digits) throw new RangeError(`parseMoney(): ${currency} has ${digits} decimal places`);
  const minor = BigInt(m[2]! + frac.padEnd(digits, '0'));
  return money(m[1] ? -minor : minor, currency);
}

/** Split into `parts` shares that sum exactly to the original (largest-remainder; no paisa is lost or invented). */
export function allocate(total: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError('allocate(): parts must be a positive integer');
  const n = BigInt(parts);
  const base = total.minor / n;
  const rem = total.minor - base * n; // sign follows total
  const step = rem < 0n ? -1n : 1n;
  return Array.from({ length: parts }, (_, i) => money(base + (BigInt(i) < (rem < 0n ? -rem : rem) ? step : 0n), total.currency));
}

/** UI-only formatter. Numbers stay LTR even in Urdu layouts (CLAUDE.md §5.5). */
export function formatMoney(m: Money, locale = 'en-PK'): string {
  const digits = minorDigits(m.currency);
  const neg = m.minor < 0n;
  const abs = neg ? -m.minor : m.minor;
  const s = abs.toString().padStart(digits + 1, '0');
  const whole = digits ? s.slice(0, -digits) : s;
  const frac = digits ? s.slice(-digits) : '';
  const grouped = new Intl.NumberFormat(locale, { useGrouping: true }).format(BigInt(whole));
  return `${neg ? '-' : ''}${m.currency} ${grouped}${frac ? '.' + frac : ''}`;
}

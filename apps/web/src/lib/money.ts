/** Rupees typed by a person ("1500", "1,500.50") → paisa as an integer. String maths only, never a float; null when it is not a valid amount. */
export function rupeesToMinor(input: string): number | null {
  const s = input.trim().replace(/,/g, '');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}

/** Paisa → the text shown in an amount box: whole rupees when there are no paisa ("50000"), two decimals only when needed. */
export function minorToInput(minor: number | string | bigint | null | undefined): string {
  const n = Math.trunc(Number(minor ?? 0));
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
}

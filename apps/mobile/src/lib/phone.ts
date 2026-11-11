/**
 * Pakistani mobile in any common spelling → E.164 (+923XXXXXXXXX), or null.
 * DECISION: duplicated from packages/validation (pkMobileSchema) because that package needs zod and the phone app stays dependency-light;
 * keep the two in step.
 */
export function normalisePkMobile(input: string): string | null {
  const s = input.trim().replace(/[\s()-]/g, '');
  const e164 = s.startsWith('+92') ? s : s.startsWith('0092') ? `+${s.slice(2)}` : s.startsWith('92') ? `+${s}` : s.startsWith('0') ? `+92${s.slice(1)}` : s;
  return /^\+923\d{9}$/.test(e164) ? e164 : null;
}

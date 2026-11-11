import en from './messages/en.json';
import ur from './messages/ur.json';

export const LOCALES = ['en', 'ur'] as const;
export type Locale = (typeof LOCALES)[number];
export const messages = { en, ur } as const;
export const isRtl = (l: Locale): boolean => l === 'ur';
export const dirOf = (l: Locale): 'rtl' | 'ltr' => (isRtl(l) ? 'rtl' : 'ltr');

/** Flatten a nested catalogue to dotted keys — used by the parity lint and the lookup below. */
export function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

const flat = { en: flatten(en), ur: flatten(ur) } as const;

/** Minimal lookup with {name} interpolation; falls back to English, then the key (so gaps are visible, not blank). */
export function t(locale: Locale, key: string, vars: Record<string, string | number> = {}): string {
  const s = flat[locale][key] ?? flat.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Roman-Urdu search synonyms (CLAUDE.md §2.2 #10) — seed list; grows with real usage. */
export const ROMAN_URDU_SYNONYMS: Record<string, string[]> = {
  fees: ['fees', 'fee', 'fees kab tak', 'challan', 'voucher', 'فیس'],
  result: ['result', 'nataij', 'natija', 'نتیجہ', 'نتائج'],
  attendance: ['attendance', 'hazri', 'hazir', 'حاضری'],
  homework: ['homework', 'ghar ka kaam', 'diary', 'گھر کا کام'],
  bus: ['bus', 'van', 'gari', 'بس'],
};

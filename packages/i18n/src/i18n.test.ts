import { describe, expect, it } from 'vitest';
import { dirOf, flatten, messages, t } from './index';

describe('bilingual strings (CLAUDE.md §18 rule 11)', () => {
  const en = flatten(messages.en);
  const ur = flatten(messages.ur);
  it('every English key has an Urdu translation and vice versa', () => {
    expect(Object.keys(ur).sort()).toEqual(Object.keys(en).sort());
  });
  it('no Urdu value is empty or a copy of the English text', () => {
    for (const [k, v] of Object.entries(ur)) {
      expect(v.trim(), k).not.toBe('');
      expect(v, `${k} looks untranslated`).not.toBe(en[k]);
    }
  });
  it('placeholders match between languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en)) expect(ph(ur[k]!), k).toEqual(ph(en[k]!));
  });
  it('lookup, interpolation and fallback', () => {
    expect(t('en', 'common.save')).toBe('Save');
    expect(t('ur', 'common.save')).toBe('محفوظ کریں');
    expect(t('en', 'missing.key')).toBe('missing.key');
    expect(dirOf('ur')).toBe('rtl');
  });
});

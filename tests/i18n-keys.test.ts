import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flatten } from '../packages/i18n/src';
import en from '../packages/i18n/src/messages/en.json';
import ur from '../packages/i18n/src/messages/ur.json';

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    if (['node_modules', '.next', '.expo'].includes(f)) return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

// every literal key passed to tr('…') / t(locale, '…') in the web and mobile source
const KEY = /\b(?:tr|t)\(\s*(?:(?:await\s+)?[A-Za-z_.]+(?:\(\))?\s*,\s*)?'([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)'/g;

describe('translation keys used in source', () => {
  const used = new Map<string, string>();
  for (const f of [...files('apps/web/src'), ...files('apps/mobile/app'), ...files('apps/mobile/src')]) {
    for (const m of readFileSync(f, 'utf8').matchAll(KEY)) used.set(m[1]!, f);
  }
  const enKeys = flatten(en as never), urKeys = flatten(ur as never);

  it('finds a meaningful number of keys (the scanner is working)', () => {
    expect(used.size).toBeGreaterThan(100);
  });
  it('every key used in code exists in English and in Urdu', () => {
    const missing = [...used].filter(([k]) => !(k in enKeys) || !(k in urKeys)).map(([k, f]) => `${k}  (${f})`);
    expect(missing).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrast, cssVariables, textPairs, tokens, validateTenantAccent } from './tokens';

describe('Slate & Saffron', () => {
  it('every text/background pair meets WCAG AA (4.5:1)', () => {
    const failing = textPairs
      .map(([fg, bg]) => ({ fg, bg, ratio: contrast(tokens[fg], tokens[bg]) }))
      .filter((p) => p.ratio < 4.5)
      .map((p) => `${p.fg} on ${p.bg} = ${p.ratio.toFixed(2)}`);
    expect(failing).toEqual([]);
  });
  it('apps/web tokens.css is in sync with tokens.ts (run: npm run tokens -w @ilmora/ui)', () => {
    const css = readFileSync(fileURLToPath(new URL('../../../apps/web/src/app/tokens.css', import.meta.url)), 'utf8');
    expect(css).toBe(`:root {\n${cssVariables()}\n}\n`);
  });
  it('contrast maths is right (black on white = 21)', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });
  it('rejects unsafe tenant accents', () => {
    expect(validateTenantAccent('#FFB547', '#1A1F24').ok).toBe(true);
    expect(validateTenantAccent('#10151A', '#000000').ok).toBe(false); // vanishes into the slate
    expect(validateTenantAccent('#FFFF00', '#FFFFFF').ok).toBe(false); // unreadable button text
    expect(validateTenantAccent('red', '#000000').ok).toBe(false);
  });
});

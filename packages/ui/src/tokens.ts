// "Slate & Saffron" design tokens (CLAUDE.md §5.2). tokens.css is generated from this by `cssVariables()`;
// a test fails if the committed CSS drifts, and another checks WCAG AA for every text/background pair.

export const tokens = {
  bg: '#23303A',
  surface1: '#2C3B47',
  surface2: '#364756',
  paper: '#F4F1E8',
  paperInk: '#1E252B',
  paperRule: '#C9D6E3',
  paperMargin: '#E57373',
  lineSlate: '#46596A',
  linePaper: '#D9D2C3',
  ink: '#F4F6F8',
  ink2: '#C5D0DA',
  ink3: '#9AAAB8',
  accent: '#FFB547',
  accentText: '#1A1F24',
  accent2: '#4FD1A5',
  accent3: '#6CB8FF',
  warn: '#F59E0B',
  // DECISION: brief says #FF6B6B, which is 4.15:1 on --surface-1 (fails AA). #FF7B7B is the closest value that passes (4.59:1).
  danger: '#FF7B7B',
} as const;

export type TokenName = keyof typeof tokens;

/** Text-on-background pairs that must meet WCAG 2.2 AA (4.5:1 for body text). */
export const textPairs: ReadonlyArray<readonly [fg: TokenName, bg: TokenName]> = [
  ['ink', 'bg'], ['ink', 'surface1'], ['ink', 'surface2'],
  ['ink2', 'bg'], ['ink2', 'surface1'], ['ink2', 'surface2'],
  ['ink3', 'bg'], ['ink3', 'surface1'],
  ['accentText', 'accent'],
  ['paperInk', 'paper'],
  ['accent', 'bg'], ['accent', 'surface1'],
  ['accent2', 'bg'], ['accent2', 'surface1'],
  ['accent3', 'bg'], ['accent3', 'surface1'],
  ['warn', 'bg'], ['warn', 'surface1'],
  ['danger', 'bg'], ['danger', 'surface1'],
];

const kebab = (s: string) => s.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);

export function cssVariables(t: Record<string, string> = tokens): string {
  return Object.entries(t).map(([k, v]) => `  --${kebab(k)}: ${v};`).join('\n');
}

// ---- WCAG contrast -------------------------------------------------------------------------------------------
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Per-tenant theming may only override accent colours; unsafe combinations are rejected on save (CLAUDE.md §5.2). */
export function validateTenantAccent(accent: string, accentText: string): { ok: true } | { ok: false; reason: string } {
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (!hex.test(accent) || !hex.test(accentText)) return { ok: false, reason: 'Colours must be 6-digit hex values' };
  if (contrast(accentText, accent) < 4.5) return { ok: false, reason: 'Button text on this colour is not readable (needs 4.5:1)' };
  if (contrast(accent, tokens.bg) < 3) return { ok: false, reason: 'This colour is too dark against the slate background (needs 3:1)' };
  return { ok: true };
}

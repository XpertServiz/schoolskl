// Regenerates apps/web/src/app/tokens.css from packages/ui/src/tokens.ts (Node ≥ 22 strips TS types natively).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cssVariables } from '../src/tokens.ts';

const out = fileURLToPath(new URL('../../../apps/web/src/app/tokens.css', import.meta.url));
writeFileSync(out, `:root {\n${cssVariables()}\n}\n`);
console.log('wrote', out);

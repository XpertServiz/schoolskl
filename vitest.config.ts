import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // each DB test file boots its own in-memory Postgres (PGlite); one per CPU ran a 12-core dev machine out of memory
    maxWorkers: 4,
  },
});

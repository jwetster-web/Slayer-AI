import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/perf/**/*.test.ts'], environment: 'node', pool: 'forks', testTimeout: 1800000, hookTimeout: 1800000 },
});

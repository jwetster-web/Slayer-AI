import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});

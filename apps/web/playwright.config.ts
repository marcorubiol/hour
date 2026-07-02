import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PW_PORT ?? 4173);
const BASE_URL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests',
  // Only *.spec.ts is Playwright's. Default testMatch also swallows
  // *.test.ts — i.e. the vitest RLS suite under tests/rls/, whose
  // @vitest/expect clashes with Playwright's expect at collection time.
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Escape hatch: point PW_CHROMIUM at any Chromium/Chrome-for-Testing
    // binary (e.g. another ms-playwright cache revision) to run without
    // `pnpm test:install` downloading this exact revision first.
    launchOptions: process.env.PW_CHROMIUM
      ? { executablePath: process.env.PW_CHROMIUM }
      : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: `vite preview --port ${PORT}`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});

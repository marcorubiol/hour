import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

/**
 * Where the shared signed-in session lands. One login per run instead of
 * ~14 — see tests/auth.setup.ts. `.playwright/` is already gitignored.
 */
export const STORAGE_STATE = '.playwright/auth.json';

// Keep the canonical test credentials in one place. Explicit shell values
// still win because loadEnvFile does not overwrite existing environment vars.
if (existsSync('.env.test')) loadEnvFile('.env.test');
// Machine-local overrides (gitignored, no secrets) — e.g. PW_CHROMIUM when
// the pinned chromium revision is unrecoverable in this machine's cache.
if (existsSync('.env.test.local')) loadEnvFile('.env.test.local');

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
  /**
   * ONE WORKER, BECAUSE THERE IS ONE WORKSPACE.
   *
   * This suite does not run against a fixture database: it signs into the
   * LIVE `playwright` workspace and mutates it — creates gigs, edits dates,
   * deletes them, and drives one Yjs Durable Object. `fullyParallel` over
   * shared mutable state is a claim of isolation that is simply not true,
   * and it showed: measured 2026-08-11 against the deployed runtime, four
   * parallel runs failed ONE test each and never the same one
   * (`date-edit` twice, then `collab`), while `--workers=1` came back
   * **55/55** twice in a row.
   *
   * A release gate that cries wolf once per run is worse than a slow one:
   * every red has to be triaged by hand, and the day one of them is real it
   * will look like the others. 2.9 minutes instead of 35 seconds is the
   * price of a green that means something.
   *
   * `fullyParallel` stays true on purpose — it is what keeps the ORDER
   * honest (no test may rely on another's leftovers, and the serial
   * describes still declare their own chains). Only the concurrency goes.
   */
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Timezone rule: timeslot entry resolves to the workspace's home zone
    // when no venue is linked. Pin the browser zone to the seed
    // workspace's so time assertions are deterministic on any runner.
    timezoneId: 'Europe/Madrid',
    // Escape hatch: point PW_CHROMIUM at any Chromium/Chrome-for-Testing
    // binary (e.g. another ms-playwright cache revision) to run without
    // `pnpm test:install` downloading this exact revision first.
    launchOptions: process.env.PW_CHROMIUM
      ? { executablePath: process.env.PW_CHROMIUM }
      : {},
  },
  projects: [
    // One login for the whole run — see tests/auth.setup.ts for why (the
    // suite used to trip the /api/auth/login rate limit with ~14 logins
    // from one IP).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
      // auth-session drives sign-in/refresh/logout itself: it must start
      // signed out, so it runs in its own project below.
      testIgnore: /auth-session\.spec\.ts/,
    },
    {
      name: 'auth',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /auth-session\.spec\.ts/,
    },
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

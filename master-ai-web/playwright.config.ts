import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the real app. Start everything first with `pnpm dev`
 * (API :3000, worker, web :5173, offline LLM mode), then run `pnpm e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /layout\.spec/ },
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
      testMatch: /layout\.spec/,
    },
    // The main path and the can't-start note in Firefox and WebKit (Safari) too; everything else runs in Chromium.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /(browsers|fallback)\.spec/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /(browsers|fallback)\.spec/ },
  ],
});

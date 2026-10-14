import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Integration specs: the real services on a real Postgres, with row-level
 * security on. They use `onehuman_test`, beside the dev database on the same
 * server (`pnpm infra:up`), created fresh for every run: the owner migrates it
 * and the services connect as onehuman_app, as in production.
 * Run with `pnpm test:integration`.
 */
const env = resolve(import.meta.dirname, '.env');
if (existsSync(env)) process.loadEnvFile(env);
const testDatabase = (url: string) => Object.assign(new URL(url), { pathname: '/onehuman_test' }).toString();
const admin = process.env.DATABASE_URL ?? 'postgres://onehuman:onehuman@localhost:5432/onehuman';
// For __tests__/integration/global-setup.ts, which runs in this process.
process.env.INTEGRATION_ADMIN_URL = admin;
process.env.INTEGRATION_OWNER_URL = testDatabase(admin);

export default defineConfig({
  // Nest's dependency injection reads constructor types: legacy decorators with metadata, as `nest build` emits.
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: {
    include: ['__tests__/integration/**/*.spec.ts'],
    globalSetup: ['__tests__/integration/global-setup.ts'],
    // One database: files run one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // `pnpm test:integration --coverage`: what the specs reach in src/, in coverage/integration/.
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'html'], reportsDirectory: '../coverage/integration' },
    env: {
      DATABASE_URL: testDatabase(admin),
      APP_DATABASE_URL: testDatabase(process.env.APP_DATABASE_URL ?? 'postgres://onehuman_app:onehuman_app@localhost:5432/onehuman'),
      LLM_OFFLINE: 'always',
      JWT_SECRET: 'integration-test-secret-at-least-32-chars',
      TEMPORAL_TASK_QUEUE: 'onehuman-integration',
    },
  },
});

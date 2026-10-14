import { defineConfig } from 'vitest/config';

/**
 * Only for `pnpm coverage`: every package's unit tests in one run, with one
 * coverage report (coverage/index.html). `pnpm turbo run test` still runs each
 * package with its own config. The backend's integration specs are separate
 * (`pnpm test:integration`).
 */
export default defineConfig({
  test: {
    projects: [
      'packages/agent-kit',
      'packages/policy',
      'packages/schemas',
      'packages/sdk',
      'packages/ui',
      'master-ai-backend/vitest.config.mts',
      'master-ai-web/vite.config.ts',
      'master-ai-mobile',
      'evals',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**', 'master-ai-backend/src/**', 'master-ai-web/src/**', 'master-ai-mobile/src/**', 'evals/src/**'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/unit/**/*.test.ts'],
    // config.ts validates the environment on import; CI's unit-test job has no .env.
    env: { JWT_SECRET: 'unit-test-secret-at-least-32-characters' },
  },
});

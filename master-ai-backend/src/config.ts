import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().default('postgres://onehuman:onehuman@localhost:5432/onehuman'),
  APP_DATABASE_URL: z.string().default('postgres://onehuman_app:onehuman_app@localhost:5432/onehuman'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('default'),
  TEMPORAL_TASK_QUEUE: z.string().default('onehuman-agents'),
  NATS_URL: z.string().default('nats://localhost:4222'),
  PACKS_DIR: z.string().default('../packs'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_AUTH_TOKEN: z.string().optional(),
  LLM_OFFLINE: z.enum(['auto', 'always', 'never']).default('auto'),
  LLM_MODEL_FRONTIER: z.string().default('claude-opus-5-5'),
  LLM_MODEL_STANDARD: z.string().default('claude-sonnet-5-5'),
  LLM_MODEL_SMALL: z.string().default('claude-haiku-5-5'),
  USD_INR_RATE: z.coerce.number().positive().default(88),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with readable errors instead of a half-working server.
  console.error('Invalid environment:\n' + parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
const env = parsed.data;

export const config = {
  ...env,
  packsDir: resolve(process.cwd(), env.PACKS_DIR),
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  llmOffline:
    env.LLM_OFFLINE === 'always' ||
    (env.LLM_OFFLINE === 'auto' && !env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN),
  models: {
    frontier: env.LLM_MODEL_FRONTIER,
    standard: env.LLM_MODEL_STANDARD,
    small: env.LLM_MODEL_SMALL,
  },
};

export type AppConfig = typeof config;

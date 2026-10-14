import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { HealthController } from '../../src/health.controller';

const controller = (query: () => Promise<unknown>) =>
  new HealthController({ mode: 'offline', provider: 'anthropic' } as never, { list: () => [1, 2] } as never, { pool: { query } } as never);

describe('GET /health/ready', () => {
  it('is ready when the database answers', async () => {
    await expect(controller(async () => ({ rows: [{ '?column?': 1 }] })).ready()).resolves.toEqual({ ok: true, database: 'up' });
  });

  it('answers 503 when the database does not, so a load balancer stops sending traffic', async () => {
    await expect(controller(async () => Promise.reject(new Error('connect ETIMEDOUT'))).ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("doesn't wait forever on a database that hangs", async () => {
    const started = Date.now();
    await expect(controller(() => new Promise(() => {})).ready(50)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

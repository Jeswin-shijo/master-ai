import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from './common/auth';
import { DbService } from './db/db.service';
import { LlmService } from './llm/llm.service';
import { PackRegistry } from './packs/registry.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly llm: LlmService,
    private readonly packs: PackRegistry,
    private readonly db: DbService,
  ) {}

  /** Liveness: the process is up. */
  @Public()
  @Get()
  health() {
    return { ok: true, llm: this.llm.mode, provider: this.llm.provider, packs: this.packs.list().length };
  }

  /** Readiness: the database answers within a few seconds, else 503 so a load balancer holds traffic. */
  @Public()
  @Get('ready')
  async ready(timeoutMs = 3_000) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
    });
    try {
      await Promise.race([this.db.pool.query('select 1'), timeout]);
      return { ok: true, database: 'up' };
    } catch {
      throw new ServiceUnavailableException('The database is not reachable');
    } finally {
      clearTimeout(timer);
    }
  }
}

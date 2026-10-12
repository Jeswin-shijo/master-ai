import { Controller, Get } from '@nestjs/common';
import { Public } from './common/auth';
import { LlmService } from './llm/llm.service';
import { PackRegistry } from './packs/registry.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly llm: LlmService,
    private readonly packs: PackRegistry,
  ) {}

  @Public()
  @Get()
  health() {
    return { ok: true, llm: this.llm.mode, packs: this.packs.list().length };
  }
}

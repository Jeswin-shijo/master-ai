import { Injectable, Logger } from '@nestjs/common';
import {
  MODEL_STAGE_SCHEMAS,
  MODEL_STAGE_TIERS,
  modelStageJsonSchema,
  stageSystemPrompt,
  stageUserPrompt,
  type ModelStage,
  type ModelStageOutput,
  type StageUserInput,
} from '@onehuman/agent-kit';
import { LlmService } from '../llm/llm.service';
import type { CaseContext } from './case-context';

/**
 * One structured-output call per model stage. The system prompt (role,
 * lifecycle, examples) is stable and cached; the case goes in the user turn.
 * An invalid answer gets one repair attempt; after that the stage uses the
 * rules alone. In offline mode there is no call at all.
 */
@Injectable()
export class StageModel {
  private readonly logger = new Logger(StageModel.name);

  constructor(private readonly llm: LlmService) {}

  async ask<S extends ModelStage>(stage: S, ctx: CaseContext, input: StageUserInput): Promise<{ output: ModelStageOutput<S> | null }> {
    if (this.llm.mode === 'offline') return { output: null };
    const schema = MODEL_STAGE_SCHEMAS[stage];
    const system = stageSystemPrompt(stage, { orgName: ctx.tenant.name, packName: ctx.pack.name, lc: ctx.lc });
    const base = stageUserPrompt(stage, input);
    let user = base;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.llm.complete({
          tenantId: ctx.tenant.id,
          purpose: 'case_stage',
          tier: MODEL_STAGE_TIERS[stage],
          fallbackTier: 'small',
          dataClass: 'confidential',
          system,
          user,
          jsonSchema: modelStageJsonSchema(stage),
          effort: 'low',
          maxTokens: 4000,
          offline: () => ({}),
        });
        const parsed = schema.safeParse(result.json);
        if (parsed.success) return { output: parsed.data as ModelStageOutput<S> };
        const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        user = `${base}\n\nYour last answer did not match the format (${issues}). Answer again.`;
      } catch (err) {
        this.logger.warn(`Stage ${stage} model call failed for ${ctx.caseRow.code}: ${(err as Error).message}`);
        break;
      }
    }
    return { output: null };
  }
}

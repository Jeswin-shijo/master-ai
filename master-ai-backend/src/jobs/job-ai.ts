import { Logger } from '@nestjs/common';
import { aiOutputJsonSchema, aiOutputSchema } from '@onehuman/agent-kit';
import type { AiStepDef, PackAgent } from '@onehuman/schemas';
import type { LlmService } from '../llm/llm.service';

const logger = new Logger('JobAi');

export interface JobAiRequest {
  tenantId: string;
  goalId: string;
  taskId: string;
  agent: PackAgent;
  step: AiStepDef;
  prompt: { system: string; user: string };
  /** The company's "mask personal data" setting; the gateway masks by default. */
  redactPii?: boolean;
}

/**
 * One structured call for a job's AI step, read into the step's typed fields.
 * An answer that does not fit gets one repair round; after that, or when the
 * call fails or there is no model, the answer is null and the engine uses the
 * step's offline output.
 */
export async function askJobAi(
  llm: Pick<LlmService, 'mode' | 'complete'>,
  req: JobAiRequest,
): Promise<{ output: Record<string, unknown> | null; tokens: number; costInr: number }> {
  let tokens = 0;
  let costInr = 0;
  if (llm.mode === 'offline') return { output: null, tokens, costInr };
  const { step, agent } = req;
  const schema = aiOutputSchema(step.output, step.grounded);
  const jsonSchema = aiOutputJsonSchema(step.output, step.grounded);
  const base = req.prompt.user;
  let user = base;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await llm.complete({
        tenantId: req.tenantId,
        goalId: req.goalId,
        taskId: req.taskId,
        purpose: 'job_step',
        tier: agent.model.tier,
        fallbackTier: agent.model.fallback,
        dataClass: agent.model.data_class,
        ...(req.redactPii !== undefined && { redactPii: req.redactPii }),
        system: req.prompt.system,
        user,
        jsonSchema,
        effort: 'low',
        maxTokens: 4000,
        offline: () => ({}),
      });
      tokens += result.tokens;
      costInr += result.costInr;
      const parsed = schema.safeParse(result.json);
      if (parsed.success) return { output: parsed.data, tokens, costInr };
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || 'answer'}: ${i.message}`)
        .join('; ');
      user = `${base}\n\nYour last answer did not match the format (${issues}). Answer again.`;
    } catch (err) {
      logger.warn(`Job step ${step.as} model call failed: ${(err as Error).message}`);
      break;
    }
  }
  return { output: null, tokens, costInr };
}

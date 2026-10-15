import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';

const logger = new Logger('UnderstandReply');

/**
 * Asks the model what one reply on a call says, in a fixed shape. An answer
 * that does not fit gets one repair round; then null, and the call's script
 * reads the reply itself. Offline there is no model call at all. The result
 * is only ever read by a script: it never writes anything.
 */
export async function understandReply<T>(llm: LlmService, req: { tenantId: string; system: string; user: string; schema: z.ZodType<T> }): Promise<T | null> {
  if (llm.mode === 'offline') return null;
  const jsonSchema = z.toJSONSchema(req.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  let user = req.user;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await llm.complete({
        tenantId: req.tenantId,
        purpose: 'call',
        tier: 'standard',
        fallbackTier: 'small',
        dataClass: 'internal',
        system: req.system,
        user,
        jsonSchema,
        effort: 'low',
        maxTokens: 800,
        offline: () => ({}),
      });
      const parsed = req.schema.safeParse(result.json);
      if (parsed.success) return parsed.data;
      const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      user = `${req.user}\n\nYour last answer did not match the format (${issues}). Answer again.`;
    } catch (err) {
      logger.warn(`Model could not read a call reply: ${(err as Error).message}`);
      return null;
    }
  }
  return null;
}

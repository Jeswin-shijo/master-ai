import type { AiStepDef, JobCard, JobDef, JobRunState, ReadStepDef } from '@onehuman/schemas';
import { aiOfflineOutput } from './ai';
import { runCheck, type JobScope } from './checks';
import { jobAiPrompt } from './prompt';
import { fillTemplate } from './template';
import type { EffectiveEscalation } from './words';

/** What the engine cannot do itself: the backend supplies these. The engine never calls a tool. */
export interface JobEffects {
  read(step: ReadStepDef, scope: JobScope): Promise<unknown>;
  /** One model call; null when there is no valid answer (the offline output is used then). */
  ai(
    step: AiStepDef,
    prompt: { system: string; user: string },
    scope: JobScope,
  ): Promise<Record<string, unknown> | null>;
  seen(key: string): Promise<boolean>;
}

export interface JobContext {
  orgName: string;
  agent: { name: string; job: JobCard };
  escalations: EffectiveEscalation[];
  trigger: unknown;
  today: string;
}

export type JobAdvance =
  | { kind: 'act'; stepIndex: number; as: string; tool: string; args: Record<string, unknown> }
  | { kind: 'done'; summary: string; flags: string[] }
  | {
      kind: 'stop';
      outcome: 'stop' | 'person';
      reason: string;
      escalation?: { set: EffectiveEscalation; words: string[] };
    };

export function startJobState(): JobRunState {
  return { next: 0, results: {}, flags: [] };
}

/** Stores an act's result and moves past it. */
export function recordActResult(state: JobRunState, as: string, result: unknown): JobRunState {
  return { next: state.next + 1, results: { ...state.results, [as]: result }, flags: [...state.flags] };
}

/** `item.dueDate` becomes `due date`. */
function plain(path: string): string {
  const last = path.split('.').pop() ?? path;
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Runs steps from `state.next` until an act or the end. Pure given its effects: the script decides,
 * the AI only reads and drafts, and the act's arguments come from the template, never from AI fields.
 */
export async function advanceJob(
  job: JobDef,
  ctx: JobContext,
  state: JobRunState,
  effects: JobEffects,
): Promise<{ state: JobRunState; next: JobAdvance }> {
  let results: Record<string, unknown> = { ...state.results };
  const flags = [...state.flags];
  const at = (next: number): JobRunState => ({ next, results: { ...results }, flags: [...flags] });
  const scope = (): JobScope => ({ trigger: ctx.trigger, today: ctx.today, ...results });

  for (let i = state.next; i < job.steps.length; i++) {
    const step = job.steps[i]!;

    if (step.read) {
      results = { ...results, [step.read.as]: await effects.read(step.read, scope()) };
    } else if (step.ai) {
      const ai = step.ai;
      const data: Record<string, unknown> = {};
      for (const name of ai.data) data[name] = results[name];
      const prompt = jobAiPrompt({
        orgName: ctx.orgName,
        agentName: ctx.agent.name,
        mission: ctx.agent.job.mission,
        never: ctx.agent.job.never,
        escalateLabels: ctx.escalations.map((e) => e.label),
        step: ai,
        data,
      });
      const answer = (await effects.ai(ai, prompt, scope())) ?? aiOfflineOutput(ai, scope());
      results = { ...results, [ai.as]: answer };
      if (answer.needs_person === true) {
        const why = answer.needs_person_reason;
        return {
          state: at(i),
          next: {
            kind: 'stop',
            outcome: 'person',
            reason: typeof why === 'string' && why !== '' ? why : 'The assistant could not prepare this',
          },
        };
      }
    } else if (step.check) {
      const out = await runCheck(step.check, scope(), { escalations: ctx.escalations, seen: effects.seen });
      if (out.ok) {
        if (step.check.as && out.value !== undefined) results = { ...results, [step.check.as]: out.value };
      } else if (step.check.on_fail === 'flag') {
        flags.push(out.message);
      } else {
        return {
          state: at(i),
          next: {
            kind: 'stop',
            outcome: step.check.on_fail,
            reason: out.message,
            ...(out.escalation ? { escalation: out.escalation } : {}),
          },
        };
      }
    } else if (step.act) {
      const filled = fillTemplate(step.act.args, scope());
      if (filled.missing.length > 0) {
        return {
          state: at(i),
          next: {
            kind: 'stop',
            outcome: 'person',
            reason: `Missing ${filled.missing.map(plain).join(', ')} for ${step.act.as}`,
          },
        };
      }
      return {
        state: at(i),
        next: {
          kind: 'act',
          stepIndex: i,
          as: step.act.as,
          tool: step.act.tool,
          args: filled.value as Record<string, unknown>,
        },
      };
    }
  }

  const summary = `${job.name} finished${flags.length ? `; ${flags.join('; ')}` : ''}`;
  return { state: at(job.steps.length), next: { kind: 'done', summary, flags } };
}

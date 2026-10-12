import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { CallOutcome, CallStage, TranscriptLine } from '@onehuman/schemas';
import { LlmService } from '../llm/llm.service';
import { defaultDue, parseDue, speakable } from './time';

export interface CallContext {
  tenantId: string;
  goalId: string;
  taskId: string;
  companyName: string;
  ownerName: string;
  staff: { name: string; title: string };
  stage: CallStage;
  task: { title: string; instructions: string; dueAt: Date | null };
  transcript: TranscriptLine[];
  /** When the next call will be, for the AI to mention ("I'll call you Thursday at 3 pm"). */
  nextCallAt?: Date | null;
}

export interface TurnResult {
  say: string;
  end: boolean;
  outcome: CallOutcome | null;
  dueAt: Date | null;
  notes: string | null;
}

const TurnSchema = z.strictObject({
  say: z.string(),
  end_call: z.boolean(),
  outcome: z.enum(['accepted', 'declined', 'on_track', 'blocked', 'needs_more_time', 'done', 'not_done', 'unclear']).nullable(),
  due_at: z.string().nullable(),
  notes: z.string().nullable(),
});
const TURN_JSON_SCHEMA = (() => {
  const s = z.toJSONSchema(TurnSchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
})();

const STAGE_GOALS: Record<CallStage, string> = {
  assign:
    'Explain the task clearly, check they can take it on, and agree a deadline. Outcome: accepted (with due_at) or declined (with the reason in notes).',
  follow_up:
    'Check progress before the deadline. Outcome: on_track, done, blocked (reason in notes) or needs_more_time (new due_at).',
  confirm:
    'Confirm the work is finished and capture what was done in notes. Outcome: done or not_done (reason in notes).',
  checkin: 'Not used: check-in calls run on the CheckinEngine.',
};

const MAX_PERSON_TURNS = 3;

/**
 * Runs phone conversations with the people in charge, one turn at a time.
 * The same engine serves the simulator and real telephony providers: a
 * provider only turns speech into text and text back into speech.
 */
@Injectable()
export class CallEngine {
  private readonly logger = new Logger(CallEngine.name);

  constructor(private readonly llm: LlmService) {}

  /** What the AI says when the person picks up. */
  opening(ctx: CallContext): string {
    const first = ctx.staff.name.split(' ')[0];
    const due = ctx.task.dueAt ? speakable(ctx.task.dueAt) : null;
    switch (ctx.stage) {
      case 'assign': {
        const ask = ctx.task.instructions.trim().replace(/[.!?]?$/, '.');
        return `Hi ${first}, this is the AI assistant at ${ctx.companyName}, calling for ${ctx.ownerName}. We need your help with this: ${ask} Can you take it on, and by when can it be done?`;
      }
      case 'follow_up':
        return `Hi ${first}, it's the ${ctx.companyName} assistant again. Quick check on "${ctx.task.title}"${due ? `, due ${due}` : ''}. How is it going?`;
      case 'confirm':
        return `Hi ${first}, the ${ctx.companyName} assistant here. Is "${ctx.task.title}" done? Please tell me briefly what was done.`;
      case 'checkin':
        throw new Error('Check-in calls use the CheckinEngine');
    }
  }

  /** The person said something; decide the AI's reply and whether the call is done. */
  async turn(ctx: CallContext, personText: string): Promise<TurnResult> {
    if (this.llm.mode === 'online') {
      try {
        return await this.turnWithModel(ctx, personText);
      } catch (err) {
        this.logger.warn(`Model turn failed, using scripted turn: ${(err as Error).message}`);
      }
    }
    return scriptedTurn(ctx, personText);
  }

  private async turnWithModel(ctx: CallContext, personText: string): Promise<TurnResult> {
    const transcript = [...ctx.transcript, { speaker: 'person' as const, text: personText, at: new Date().toISOString() }]
      .map((l) => `${l.speaker === 'ai' ? 'AI' : ctx.staff.name}: ${l.text}`)
      .join('\n');
    const personTurns = ctx.transcript.filter((l) => l.speaker === 'person').length + 1;
    const result = await this.llm.complete({
      tenantId: ctx.tenantId,
      goalId: ctx.goalId,
      taskId: ctx.taskId,
      purpose: 'call',
      tier: 'standard',
      fallbackTier: 'small',
      dataClass: 'internal',
      system: `You are the AI operations assistant of ${ctx.companyName}, on a phone call with ${ctx.staff.name} (${ctx.staff.title}), a member of the team, on behalf of ${ctx.ownerName}.
Speak like a polite, efficient colleague in Indian English. One or two short sentences per turn: this is spoken aloud.
Stay on this call's purpose. Never promise money, approvals or anything beyond the task. If they raise something else, say you'll pass it to ${ctx.ownerName}.
End the call (end_call true, with a short goodbye in "say") as soon as the outcome is clear, or after ${MAX_PERSON_TURNS} replies from them at most (outcome "unclear" if still unclear).
due_at is an ISO 8601 date-time in India time (+05:30), only when they state or change a deadline. Today is ${new Date().toISOString()}.`,
      user: `Call stage: ${ctx.stage}. Purpose: ${STAGE_GOALS[ctx.stage]}
Task: ${ctx.task.title}
Details: ${ctx.task.instructions}
Current deadline: ${ctx.task.dueAt ? ctx.task.dueAt.toISOString() : 'none agreed yet'}
${ctx.nextCallAt ? `If they accept, mention you'll call again around ${speakable(ctx.nextCallAt)}.` : ''}
This is reply ${personTurns} of at most ${MAX_PERSON_TURNS}.

Conversation so far:
${transcript}

Reply with your next line.`,
      jsonSchema: TURN_JSON_SCHEMA,
      effort: 'low',
      maxTokens: 2000,
      offline: () => ({}),
    });
    const parsed = TurnSchema.parse(result.json);
    const dueAt = parsed.due_at ? new Date(parsed.due_at) : null;
    return {
      say: parsed.say,
      end: parsed.end_call || personTurns >= MAX_PERSON_TURNS,
      outcome: parsed.outcome,
      dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
      notes: parsed.notes,
    };
  }

  /** One-line summary for the call log and the agent. */
  summarize(ctx: CallContext, outcome: CallOutcome, dueAt: Date | null, notes: string | null): string {
    const who = ctx.staff.name.split(' ')[0];
    switch (outcome) {
      case 'accepted':
        return `${who} accepted${dueAt ? `, due ${speakable(dueAt)}` : ''}.`;
      case 'declined':
        return `${who} declined${notes ? `: ${notes}` : '.'}`;
      case 'on_track':
        return `${who} says it's on track.`;
      case 'blocked':
        return `${who} is blocked${notes ? `: ${notes}` : '.'}`;
      case 'needs_more_time':
        return `${who} needs more time${dueAt ? `, now due ${speakable(dueAt)}` : ''}.`;
      case 'done':
        return `${who} confirmed it's done${notes ? `: ${notes}` : '.'}`;
      case 'not_done':
        return `${who} says it's not done${notes ? `: ${notes}` : '.'}`;
      case 'no_answer':
        return `${who} didn't answer.`;
      default:
        return `Couldn't get a clear answer from ${who}.`;
    }
  }
}

const DECLINE = /\b(no|not able|can't|cannot|won't|unable|busy|sorry|not possible|on leave)\b/;
const POSITIVE = /\b(yes|yeah|sure|ok|okay|fine|will do|i can|i'll|no problem|done|on it)\b/;
const DONE = /\b(done|finished|completed|complete|sorted|delivered)\b/;
const BLOCKED = /\b(problem|issue|stuck|blocked|delay|delayed|need help|waiting for|can't|cannot)\b/;
const MORE_TIME = /\b(more time|extend|extension|push it|postpone|later than)\b/;

/** Deterministic conversation used offline and as a fallback. */
export function scriptedTurn(ctx: CallContext, personText: string, now: Date = new Date()): TurnResult {
  const t = personText.toLowerCase();
  const first = ctx.staff.name.split(' ')[0];
  const personTurns = ctx.transcript.filter((l) => l.speaker === 'person').length + 1;
  const lastTry = personTurns >= 2;
  const nextCall = ctx.nextCallAt ? ` I'll call you ${speakable(ctx.nextCallAt)} to check in.` : '';

  switch (ctx.stage) {
    case 'assign': {
      const declined = DECLINE.test(t) && !/\bno problem\b/.test(t);
      const due = parseDue(personText, now);
      if (declined) {
        return { say: `Understood, ${first}. I'll let ${ctx.ownerName} know. Thank you.`, end: true, outcome: 'declined', dueAt: null, notes: personText };
      }
      if (POSITIVE.test(t) || due) {
        const agreed = due ?? ctx.task.dueAt ?? defaultDue(now);
        return {
          say: `Thank you, ${first}. I've noted it will be done by ${speakable(agreed)}.${nextCall} Have a good day.`,
          end: true,
          outcome: 'accepted',
          dueAt: agreed,
          notes: null,
        };
      }
      if (!lastTry) return { say: 'Sorry, could you confirm whether you can take this on, and by when?', end: false, outcome: null, dueAt: null, notes: null };
      return { say: `No problem, I'll check with ${ctx.ownerName}. Thank you.`, end: true, outcome: 'unclear', dueAt: null, notes: personText };
    }
    case 'follow_up': {
      if (DONE.test(t) && !/\bnot\b/.test(t)) {
        return { say: `That's great, ${first}. I'll mark it done. Thank you!`, end: true, outcome: 'done', dueAt: null, notes: personText };
      }
      const due = parseDue(personText, now);
      if (MORE_TIME.test(t) || (due && ctx.task.dueAt && due > ctx.task.dueAt)) {
        const agreed = due ?? new Date((ctx.task.dueAt ?? now).getTime() + 86_400_000);
        return { say: `Okay, I'll update the deadline to ${speakable(agreed)}. Thanks, ${first}.`, end: true, outcome: 'needs_more_time', dueAt: agreed, notes: personText };
      }
      if (BLOCKED.test(t)) {
        return { say: `Thanks for telling me, ${first}. I'll get ${ctx.ownerName} to help with that.`, end: true, outcome: 'blocked', dueAt: null, notes: personText };
      }
      return { say: `Good to hear. I'll call again near the deadline to confirm. Thanks, ${first}.`, end: true, outcome: 'on_track', dueAt: null, notes: null };
    }
    case 'confirm': {
      const notDone = /\b(not yet|not done|no|haven't|didn't|pending|still)\b/.test(t) && !DONE.test(t.replace(/not done/g, ''));
      if (!notDone && (DONE.test(t) || /\byes\b/.test(t))) {
        return { say: `Wonderful, thank you ${first}. I'll let ${ctx.ownerName} know it's done.`, end: true, outcome: 'done', dueAt: null, notes: personText };
      }
      if (notDone || lastTry) {
        return { say: `Okay, thanks for letting me know, ${first}. I'll update ${ctx.ownerName}.`, end: true, outcome: 'not_done', dueAt: null, notes: personText };
      }
      return { say: 'Sorry, is it finished? Just a yes or no and a few words is fine.', end: false, outcome: null, dueAt: null, notes: null };
    }
    case 'checkin':
      throw new Error('Check-in calls use the CheckinEngine');
  }
}

/** A cooperative simulated team member, used when the simulator runs in auto mode. */
export function simulatedReply(ctx: CallContext): string {
  switch (ctx.stage) {
    case 'assign':
      return 'Yes, I can take care of that. I will have it done by tomorrow 5 pm.';
    case 'follow_up':
      return "It's going well, I'm about halfway there. On track.";
    case 'confirm':
      return "Yes, it's done. Everything is in order.";
    case 'checkin':
      throw new Error('Check-in calls use the CheckinEngine');
  }
}

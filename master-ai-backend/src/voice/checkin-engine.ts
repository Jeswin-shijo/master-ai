import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { CheckinValue, RoutineQuestion, TranscriptLine } from '@onehuman/schemas';
import { LlmService } from '../llm/llm.service';

/**
 * Check-in calls: the AI phones a person in charge for a routine (e.g. the
 * daily work report), asks its questions one at a time, understands the
 * answers and fills in the day's entry. Offline it follows a script; with a
 * model it handles natural answers, several at once, and follow-up questions.
 */

export interface CheckinContext {
  tenantId: string;
  companyName: string;
  ownerName: string;
  staff: { name: string; title: string };
  routine: { name: string; questions: RoutineQuestion[] };
  /** Answers collected so far on this call (or earlier today). */
  values: Record<string, CheckinValue>;
  /** How often each question has been asked again on this call. */
  retries: Record<string, number>;
  transcript: TranscriptLine[];
}

export interface CheckinTurn {
  say: string;
  end: boolean;
  values: Record<string, CheckinValue>;
  retries: Record<string, number>;
  /** The person asked to be called back later. */
  callBack: boolean;
}

/** Saying no / none / nothing to a "problems" question means there is nothing to report. */
const NOTHING = /^(no|nope|none|nothing|nil|not really|no problems?|no issues?|all (good|fine|ok(ay)?)|everything('?s| is) (fine|ok(ay)?|good)|we have enough|nothing (is )?(short|stuck|pending|delayed))\b/i;
const CALL_BACK = /\b(call (me )?(back|later)|busy (now|right now)|can'?t talk|driving|in a meeting|not a good time)\b/i;
const MAX_PERSON_TURNS = 12;

@Injectable()
export class CheckinEngine {
  private readonly logger = new Logger(CheckinEngine.name);

  constructor(private readonly llm: LlmService) {}

  opening(ctx: CheckinContext): string {
    const first = ctx.staff.name.split(' ')[0];
    const next = nextQuestion(ctx.routine.questions, ctx.values);
    const intro = `Hi ${first}, this is the AI assistant at ${ctx.companyName}, calling for your ${ctx.routine.name.toLowerCase()}. It takes a minute.`;
    return next ? `${intro} ${next.ask}` : `${intro} I already have everything for today, thank you!`;
  }

  async turn(ctx: CheckinContext, personText: string): Promise<CheckinTurn> {
    if (this.llm.mode === 'online') {
      try {
        return await this.turnWithModel(ctx, personText);
      } catch (err) {
        this.logger.warn(`Model check-in turn failed, using the script: ${(err as Error).message}`);
      }
    }
    return scriptedCheckinTurn(ctx, personText);
  }

  private async turnWithModel(ctx: CheckinContext, personText: string): Promise<CheckinTurn> {
    const transcript = [...ctx.transcript, { speaker: 'person' as const, text: personText, at: new Date().toISOString() }]
      .map((l) => `${l.speaker === 'ai' ? 'AI' : ctx.staff.name}: ${l.text}`)
      .join('\n');
    const questions = ctx.routine.questions
      .map((q) => `- ${q.key} (${q.type}${q.options ? `: ${q.options.join(' / ')}` : ''}${q.required ? ', required' : ', optional'}): "${q.ask}"${q.key in ctx.values ? ` → already answered: ${JSON.stringify(ctx.values[q.key])}` : ''}`)
      .join('\n');
    const result = await this.llm.complete({
      tenantId: ctx.tenantId,
      purpose: 'call',
      tier: 'standard',
      fallbackTier: 'small',
      dataClass: 'internal',
      system: `You are the AI assistant of ${ctx.companyName}, on a short phone call with ${ctx.staff.name} (${ctx.staff.title}) to collect their ${ctx.routine.name.toLowerCase()} for ${ctx.ownerName}.
Speak like a polite, efficient colleague in Indian English. Short sentences: this is spoken aloud.
Ask the unanswered questions one at a time, in order. Record every answer you hear in "answers", even several from one reply.
For "problems" questions, an answer like "no", "nothing" or "all good" is the value "none".
If an answer is unclear, ask once more. If they are busy, set call_back and end politely.
When all required questions are answered, briefly repeat the key facts, thank them and end the call.`,
      user: `Questions:\n${questions}\n\nConversation so far:\n${transcript}\n\nReply with your next line and the answers you heard in their last reply.`,
      jsonSchema: TURN_JSON_SCHEMA,
      effort: 'low',
      maxTokens: 2000,
      offline: () => ({}),
    });
    const parsed = TurnSchema.parse(result.json);
    const values = { ...ctx.values };
    for (const a of parsed.answers) {
      const q = ctx.routine.questions.find((x) => x.key === a.key);
      if (!q) continue;
      const v = parseAnswer(q, a.value);
      values[q.key] = v.ok ? v.value : a.value;
    }
    const personTurns = ctx.transcript.filter((l) => l.speaker === 'person').length + 1;
    return { say: parsed.say, end: parsed.end_call || parsed.call_back || personTurns >= MAX_PERSON_TURNS, values, retries: ctx.retries, callBack: parsed.call_back };
  }
}

const TurnSchema = z.strictObject({
  say: z.string(),
  end_call: z.boolean(),
  call_back: z.boolean(),
  answers: z.array(z.strictObject({ key: z.string(), value: z.string() })),
});
const TURN_JSON_SCHEMA = (() => {
  const s = z.toJSONSchema(TurnSchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
})();

/** The next question still to ask (only required ones when `requiredOnly`). */
export function nextQuestion(questions: RoutineQuestion[], values: Record<string, CheckinValue>, requiredOnly = false): RoutineQuestion | undefined {
  return questions.find((q) => !(q.key in values) && (!requiredOnly || q.required));
}

/** Deterministic conversation used offline and as a fallback: one question per turn. */
export function scriptedCheckinTurn(ctx: CheckinContext, personText: string): CheckinTurn {
  const first = ctx.staff.name.split(' ')[0];
  const values = { ...ctx.values };
  const retries = { ...ctx.retries };
  if (CALL_BACK.test(personText)) {
    return { say: `No problem, ${first}. I'll call you back a little later. Thank you.`, end: true, values, retries, callBack: true };
  }
  const q = nextQuestion(ctx.routine.questions, values);
  if (!q) return { say: closing(ctx, values), end: true, values, retries, callBack: false };

  const parsed = parseAnswer(q, personText);
  if (!parsed.ok) {
    retries[q.key] = (retries[q.key] ?? 0) + 1;
    if (retries[q.key]! < 2) return { say: reask(q), end: false, values, retries, callBack: false };
    values[q.key] = q.type === 'text' ? personText.trim() : null;
  } else {
    values[q.key] = parsed.value;
  }

  const next = nextQuestion(ctx.routine.questions, values);
  if (!next) return { say: closing(ctx, values), end: true, values, retries, callBack: false };
  return { say: `${acknowledge(q, values[q.key] ?? null, ctx.ownerName)} ${next.ask}`, end: false, values, retries, callBack: false };
}

/** Understand a spoken answer for one question. */
export function parseAnswer(q: RoutineQuestion, text: string): { ok: true; value: CheckinValue } | { ok: false } {
  const t = text.trim();
  const lower = t.toLowerCase();
  switch (q.type) {
    case 'number': {
      const n = numberIn(lower);
      return n === null ? { ok: false } : { ok: true, value: n };
    }
    case 'percent': {
      const n0 = numberIn(lower);
      if (n0 === null) {
        // Words before numbers: "half done" is 50, not done.
        if (/\b(almost|nearly) (done|finished|complete)\b/.test(lower)) return { ok: true, value: 90 };
        if (/\bhalf\b/.test(lower)) return { ok: true, value: 50 };
        if (/\bjust (started|begun)\b/.test(lower)) return { ok: true, value: 10 };
        if (/\b(done|complete|completed|finished)\b/.test(lower) && !/\bnot\b/.test(lower)) return { ok: true, value: 100 };
      }
      const n = n0;
      return n === null || n < 0 || n > 100 ? { ok: false } : { ok: true, value: n };
    }
    case 'yes_no':
      if (/\b(yes|yeah|yep|haan|ha|sure|correct|right)\b/.test(lower)) return { ok: true, value: true };
      if (/\b(no|nope|nahi|not)\b/.test(lower)) return { ok: true, value: false };
      return { ok: false };
    case 'choice': {
      const option = q.options?.find((o) => lower.includes(o.toLowerCase()));
      return option ? { ok: true, value: option } : { ok: false };
    }
    default:
      if (!t) return { ok: false };
      if (q.flag && NOTHING.test(lower)) return { ok: true, value: 'none' };
      return { ok: true, value: t.replace(/^(yes|yeah|well|so|okay|ok)[,.!]?\s+/i, '').replace(/^\w/, (c) => c.toUpperCase()) };
  }
}

/** Problems raised in the answers: "Running short: cement is low". */
export function flagsOf(questions: RoutineQuestion[], values: Record<string, CheckinValue>): string[] {
  return questions
    .filter((q) => q.flag)
    .flatMap((q) => {
      const v = values[q.key];
      if (v === undefined || v === null || v === '' || v === false || v === 'none') return [];
      return [`${q.label}: ${v === true ? 'yes' : String(v)}`];
    });
}

/** "12 people · 60% done · Running short: cement" for the call log. */
export function checkinSummary(questions: RoutineQuestion[], values: Record<string, CheckinValue>): string {
  const parts = questions.flatMap((q) => {
    const v = values[q.key];
    if (v === undefined || v === null || v === '' || v === 'none') return [];
    if (q.type === 'number') return [`${v}${q.unit ? ` ${q.unit}` : ''}`];
    if (q.type === 'percent') return [`${v}% done`];
    if (q.type === 'yes_no') return [`${q.label}: ${v ? 'yes' : 'no'}`];
    return q.flag ? [`${q.label}: ${String(v)}`] : [];
  });
  return parts.length ? parts.join(' · ') : 'Nothing to report.';
}

/** Likely replies for the simulator, for the question being asked. */
export function checkinSuggestions(questions: RoutineQuestion[], values: Record<string, CheckinValue>, staffName: string): string[] {
  const q = nextQuestion(questions, values);
  if (!q) return [];
  const sample = sampleAnswer(q, staffName);
  const other: Record<RoutineQuestion['type'], string[]> = {
    number: ['About 10', 'Twelve'],
    percent: ['About half done', 'Almost done'],
    yes_no: ['Yes', 'No'],
    choice: q.options?.slice(0, 2) ?? [],
    text: q.flag ? ['No, all good', 'Yes, we are short of cement'] : ['Same as planned for today'],
  };
  return [...new Set([sample, ...other[q.type], 'Can you call me later?'])].slice(0, 4);
}

/** A cooperative simulated person in charge, for the simulator's auto mode. */
export function simulatedCheckinReply(ctx: CheckinContext): string {
  const q = nextQuestion(ctx.routine.questions, ctx.values);
  return q ? sampleAnswer(q, ctx.staff.name) : 'Thank you.';
}

function sampleAnswer(q: RoutineQuestion, staffName: string): string {
  const h = [...staffName].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  const pick = <T>(xs: T[]) => xs[h % xs.length]!;
  switch (q.key) {
    case 'people':
      return `${8 + (h % 9)} people today.`;
    case 'workDone':
      return pick(['We finished the slab shuttering on the first floor.', 'Plastering is done in two rooms.', 'The electrical conduits are laid on level two.', 'We completed the client feedback changes and tested them.']);
    case 'progress':
      return `About ${40 + (h % 11) * 5} percent.`;
    case 'shortages':
      return h % 3 === 0 ? 'Yes, cement is running low, we need about fifty bags.' : 'No, we have enough of everything.';
    case 'problems':
      return h % 4 === 1 ? 'One supplier did not turn up today, so a job is running late.' : 'No problems.';
    case 'lowStock':
      return h % 3 === 0 ? 'Rice bags and cooking oil are running low.' : 'Nothing is running low.';
  }
  switch (q.type) {
    case 'number':
      return `${3 + (h % 10)}`;
    case 'percent':
      return `About ${50 + (h % 9) * 5} percent.`;
    case 'yes_no':
      return 'No.';
    case 'choice':
      return q.options?.[0] ?? 'Okay';
    default:
      return q.flag ? 'No, all good.' : 'Everything planned for today got done.';
  }
}

function reask(q: RoutineQuestion): string {
  switch (q.type) {
    case 'number':
      return `Sorry, I need a number for that. ${q.ask}`;
    case 'percent':
      return `Sorry, roughly what percent? ${q.ask}`;
    case 'yes_no':
      return `Sorry, just yes or no: ${q.ask}`;
    case 'choice':
      return `Sorry, is it ${q.options?.join(', or ')}?`;
    default:
      return `Sorry, could you say that again? ${q.ask}`;
  }
}

function acknowledge(q: RoutineQuestion, v: CheckinValue, ownerName: string): string {
  if (v === null) return 'Okay, moving on.';
  if (q.type === 'number') return `Got it, ${v}${q.unit ? ` ${q.unit}` : ''}.`;
  if (q.type === 'percent') return `Noted, ${v} percent.`;
  if (q.flag && v !== 'none' && v !== false) return `Thanks for telling me, I'll let ${ownerName} know.`;
  return 'Thanks.';
}

function closing(ctx: CheckinContext, values: Record<string, CheckinValue>): string {
  const first = ctx.staff.name.split(' ')[0];
  const summary = checkinSummary(ctx.routine.questions, values).replace(/ · /g, ', ');
  const flagged = flagsOf(ctx.routine.questions, values).length > 0;
  return `Thank you, ${first}. I've noted: ${summary.replace(/\.$/, '')}.${flagged ? ` I'll pass the problems to ${ctx.ownerName}.` : ''} Have a good evening.`;
}

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, dozen: 12, none: 0, nobody: 0,
};

/** "12", "twelve", "twenty five", "a dozen" → number. */
function numberIn(text: string): number | null {
  const digits = /(\d+(?:\.\d+)?)/.exec(text.replace(/,/g, ''));
  if (digits) return Number(digits[1]);
  let total: number | null = null;
  for (const w of text.split(/[^a-z]+/)) {
    const n = WORDS[w];
    if (n === undefined) continue;
    if (n === 100) total = (total || 1) * 100;
    else total = (total ?? 0) + n;
  }
  return total;
}

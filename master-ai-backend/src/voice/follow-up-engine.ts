import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { EntityField, TranscriptLine } from '@onehuman/schemas';
import { LlmService } from '../llm/llm.service';
import { BENIGN, matchOption, orList, sayDay, spokenAmount, spokenDate, spokenDateTime, spokenYesNo } from './spoken';
import { istDate, speakable } from './time';
import { understandReply } from './understand';

/**
 * Follow-up calls about an open list item. To an outside party, the AI first
 * makes sure it is speaking to the right people, then asks about the item and
 * records the answer as it was given: it never threatens, bargains, promises
 * or changes anything. To a team member it asks for the status and a new date,
 * which the caller applies. A model, when there is one, only says what a reply
 * contains; this script decides every line and every result.
 */

export type FollowUpResult =
  | { kind: 'settled'; said: string; proposed: Record<string, unknown> }
  | { kind: 'promise'; said: string; promiseOn: string }
  | { kind: 'dispute'; said: string }
  | { kind: 'wrong_number'; said: string }
  | { kind: 'do_not_call'; said: string }
  | { kind: 'status'; said: string; patch: Record<string, unknown> }
  | { kind: 'said'; said: string };

export interface FollowUpState {
  phase: 'identity' | 'ask' | 'reference' | 'done';
  retries: number;
  result: FollowUpResult | null;
  /** The call ended before the person said who they are, with nothing to note: it counts as a try, like an unanswered call. */
  unconfirmed?: boolean;
}

export function newFollowUpState(who: 'party' | 'staff'): FollowUpState {
  return { phase: who === 'party' ? 'identity' : 'ask', retries: 0, result: null };
}

export interface FollowUpContext {
  tenantId: string;
  companyName: string;
  who: 'party' | 'staff';
  /** The party's name, or the team member's. */
  name: string;
  /** What the item is, in words (`aboutText`). */
  about: string;
  /** Fields the call may propose (party) or change (staff). */
  findOut: EntityField[];
  state: FollowUpState;
  transcript: TranscriptLine[];
  now: Date;
}

export interface FollowUpTurn {
  say: string;
  end: boolean;
  callBack: boolean;
  state: FollowUpState;
}

/** What a model heard in one reply. Only the script acts on it, after checking each value. */
export interface FollowUpHeard {
  identity: 'yes' | 'no' | 'asking' | null;
  outcome: 'paid' | 'promise' | 'dispute' | 'do_not_call' | 'status' | 'call_back' | 'other' | null;
  promiseOn: string | null;
  reference: string | null;
  status: string | null;
  dueAt: string | null;
  amount: number | null;
}

const CALL_BACK = /\b(call (me )?(back|later)|busy (now|right now)|can'?t talk|driving|in a meeting|not a good time)\b/i;
/** "Don't call before 5" asks for another time, not for no calls at all. */
const NOT_NOW = /\b(?:don['’]?t|do not) (?:call|ring)(?: me| us)? (?:before|after|on|at|during|now|today|tonight|till|until|right now|in the)\b/i;
const DNC =
  /\b(?:don['’]?t (?:ever |keep )?(?:calling|call|ringing|ring|disturb)|do not (?:call|ring|disturb)|stop (?:calling|ringing|these calls|the calls)|never call|no more calls|remove (?:my|this|our) number|take (?:me|us|my number|this number|our number) off)\b/i;
const WHO = /\b(who|whom|which company|why are you calling|what(?:'?s| is) (?:this|it) (?:about|regarding))\b/i;
const WRONG = /\b(wrong (number|person)|no one (here )?by that name|you have the wrong|doesn'?t (work|live) here|no such (company|person)|not the right (person|number))\b/i;
/** A reply that is only "no" ("No.", "No no", "Nahi"): with WRONG, the only replies that make a wrong number. */
const BARE_NO = /^\s*(?:no|nope|nahi|nah)(?:[\s,.!]+(?:no|nope|nahi|nah))*[\s.!]*$/i;
/** "Speaking" only as the whole answer ("Yes, speaking"), never inside a question like "Who is speaking?". */
const IDENTITY_YES = /^\s*(?:yes|yeah|haan|ji|hello)?[\s,.!]*speaking\b|\b(this is (he|she|me|us|him|her)|that'?s (me|us)|it'?s (me|us))\b/i;
const DISPUTE =
  /\b(never (came|arrived|received|got|reached|delivered)|did ?n'?t (get|receive|order)|not (ours|our order)|wrong (amount|bill|item|goods|rate)|damaged|shortage|short (supply|supplied|delivered|delivery|sent|shipped|by)|(goods|items|quantity|stock|material|pieces|boxes) (were |was |is |are )?short|dispute|disagree|incorrect|mistake|overcharged|returned)\b/i;
const NOT_PAID = /\b(not (yet )?(paid|sent|received|done|cleared)|haven'?t (paid|sent|cleared)|didn'?t pay|unpaid|no money)\b/i;
const PAID = /\b(paid|already (sent|done|cleared|transferred)|transferred|cleared|settled|received|delivered|approved|confirmed|sent (it|the|back))\b/i;
const NOT_DONE = /\b(not (yet )?(done|finished|fixed|completed|resolved)|still (working|on it|pending)|working on it|in progress)\b/i;
const DONE = /\b(done|fixed|finished|completed|resolved|sorted|closed)\b/i;
/** A done-word with a hedge or a time still to come is not done: "almost done", "should be done", "done by 5 pm", "done in 2 days". */
const HEDGE = /\b(almost|nearly|should|hopefully|probably|by|in \d+ (?:days?|hours?)|pending|remaining|soon|tomorrow)\b/i;
const SETTLE_WORDS =
  'paid|pay|received|receive|done|cleared|clear|transferred|transfer|settled|settle|approved|approve|confirmed|confirm|delivered|deliver|released|release|fixed|fix|finished|finish|completed|complete|resolved|resolve|sorted';
/** A settle word negated just before it: "has not been paid", "haven't received the goods", "nothing is done", "isn't fixed". */
const NEGATED_SETTLE = new RegExp(`\\b(?:not|never|no|nothing|none|cannot|yet to|(?:is|are|was|were|has|have|had|did|do|does|wo|ca)n['’]?t)(?:\\s+\\w+){0,2}?\\s+(?:${SETTLE_WORDS})\\b`, 'i');
/** A settle word in the future: "will be paid", "I'll finish it", "going to clear". */
const FUTURE_SETTLE = new RegExp(`(?:\\b(?:will|shall|going to|gonna|yet to|about to)|['’]ll)(?:\\s+\\w+){0,2}?\\s+(?:be\\s+)?(?:${SETTLE_WORDS})\\b`, 'i');
const LATER = /\b(next (week|month)|in a (few|couple of) days|end of (the )?(week|month))\b/i;
const REF_WORD = /\b(?:utr|ref(?:erence)?|txn|transaction|cheque|receipt)\b/i;
const REF_FILLER = /^(?:no|number|num|id|is|was|its|it's|[:#.-])$/i;
const PHONE = /^(?:\+?91)?[6-9]\d{9}$/;
const PHONE_IN_TEXT = /(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/g;
const MONEY_NEAR = /₹|\brs\.?|\brupees?\b|\binr\b|\blakhs?\b|\bcrores?\b|\bthousand\b/i;
const SETTLED = ['paid', 'received', 'approved', 'confirmed', 'delivered', 'done', 'completed'];
const DONE_OPTIONS = ['resolved', 'fixed', 'done', 'completed', 'closed', 'returned', 'verified', 'issued'];
const PROGRESS_OPTIONS = ['in-progress', 'in progress', 'assigned', 'capa-open', 'inspection', 'open'];

const firstName = (name: string) => name.split(' ')[0];
const dayOk = (d: string | null, today: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && d >= today;

function partyQuestion(ctx: FollowUpContext): string {
  const paid = ctx.findOut.some((f) => f.type === 'enum' && f.options?.includes('paid'));
  if (paid) return 'Could you tell me when it will be paid?';
  if (ctx.findOut.length === 0) return 'Could you tell me when we can expect it?';
  return 'Could you tell me where this stands?';
}

function statusField(ctx: FollowUpContext): EntityField | undefined {
  return ctx.findOut.find((f) => f.type === 'enum' && /status/i.test(f.name)) ?? ctx.findOut.find((f) => f.type === 'enum');
}

function staffQuestion(ctx: FollowUpContext): string {
  if (statusField(ctx)) return "What's the status?";
  return ctx.findOut.some((f) => f.type === 'date' || f.type === 'datetime') ? 'When will it be done?' : "What's the latest?";
}

export function followUpOpening(ctx: FollowUpContext): string {
  if (ctx.who === 'party') return `Hello, this is an AI assistant calling from ${ctx.companyName}. Am I speaking with someone from ${ctx.name}?`;
  return `Hi ${firstName(ctx.name)}, this is the AI assistant at ${ctx.companyName}, about ${ctx.about}. ${staffQuestion(ctx)}`;
}

/** What a settled answer proposes: the status said (or the settled one the list has), true for yes/no fields, and an amount if one was said. */
function settledPatch(ctx: FollowUpContext, text: string, amount: number | null): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const f of ctx.findOut) {
    if (f.type === 'enum' && f.options) {
      const said = matchOption(f.options, text);
      const settled = SETTLED.find((o) => f.options!.includes(o));
      if (said && said !== 'unpaid') patch[f.name] = said;
      else if (settled && f === statusField(ctx)) patch[f.name] = settled;
    } else if (f.type === 'boolean') patch[f.name] = true;
    else if (f.type === 'money' && amount !== null) patch[f.name] = amount;
  }
  return patch;
}

/** The reference said after a reference word ("UTR number is 4455 6677" → 44556677), or a long number that is not a phone number or an amount. */
function referenceIn(text: string): { ref: string; start: number; end: number } | null {
  const m = REF_WORD.exec(text);
  if (m) {
    const words = /[A-Za-z0-9'’-]+|[^\sA-Za-z0-9'’-]/g;
    words.lastIndex = m.index + m[0].length;
    const parts: string[] = [];
    let end = words.lastIndex;
    for (let w = words.exec(text); w; w = words.exec(text)) {
      if (!parts.length && REF_FILLER.test(w[0])) continue;
      if (!/^[A-Za-z0-9-]+$/.test(w[0]) || !/\d/.test(w[0])) break;
      parts.push(w[0].toUpperCase());
      end = w.index + w[0].length;
    }
    const ref = parts.join('');
    if (ref.length >= 4 && ref.length <= 30) return { ref, start: m.index, end };
  }
  for (const n of text.matchAll(/\b[A-Za-z]{0,4}\d{6,}\b/g)) {
    const around = text.slice(Math.max(0, n.index - 12), n.index + n[0].length + 12);
    if (PHONE.test(n[0].replace(/^[A-Za-z]+/, '')) || MONEY_NEAR.test(around)) continue;
    return { ref: n[0].toUpperCase(), start: n.index, end: n.index + n[0].length };
  }
  return null;
}

/** A reference a model heard, kept only if it looks like one: 4–30 letters and digits with at least one digit. */
function heardRef(r: string | null | undefined): string | null {
  const x = r?.replace(/[\s-]/g, '').toUpperCase();
  return x && /^[A-Z0-9]{4,30}$/.test(x) && /\d/.test(x) ? x : null;
}

const notDoneIn = (t: string) => NOT_DONE.test(t) || NEGATED_SETTLE.test(t) || FUTURE_SETTLE.test(t);
/** A deadline a model heard, read as India wall-clock time: its day and time (6 pm when it gives none), whatever offset it carries. */
function indiaTime(raw: string | null | undefined): { day: string; at: string } | null {
  const m = raw ? /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(raw.trim()) : null;
  if (!m) return null;
  const at = new Date(`${m[1]}T${m[2] ?? '18:00'}:00+05:30`);
  return Number.isNaN(at.getTime()) ? null : { day: m[1]!, at: at.toISOString() };
}

/** A team member's reply that is not done yet: negated or future, hedged, or naming a day after today. */
const staffNotDone = (t: string, now: Date) => {
  const day = spokenDate(t, now);
  return notDoneIn(t) || HEDGE.test(t) || (day !== null && day > istDate(now));
};

/** The status a team member gave. A negated or future done-word means in progress; a call never sets an item back to new. */
function staffStatus(options: string[], text: string, notDone: boolean): string | null {
  const pick = (want: string[]) => want.find((o) => options.includes(o)) ?? null;
  const said = matchOption(options.filter((o) => o !== 'new' && !(notDone && DONE_OPTIONS.includes(o))), text);
  if (said) return said;
  if (notDone) return pick(PROGRESS_OPTIONS);
  if (DONE.test(text)) return pick(DONE_OPTIONS);
  return null;
}

export function followUpTurn(ctx: FollowUpContext, text: string, heard: FollowUpHeard | null = null): FollowUpTurn {
  const s: FollowUpState = { ...ctx.state };
  const today = istDate(ctx.now);
  const said = text.trim();
  const plain = text.replace(BENIGN, ' ');
  const say = (line: string): FollowUpTurn => ({ say: line, end: false, callBack: false, state: s });
  const end = (line: string, result: FollowUpResult | null, callBack = false): FollowUpTurn => {
    if (s.phase === 'identity' && !result) s.unconfirmed = true;
    s.phase = 'done';
    s.result = result;
    return { say: line, end: true, callBack, state: s };
  };
  const goodbye = `Thank you, I'll pass that on. Goodbye.`;

  const notNow = NOT_NOW.test(text);
  if (!notNow && (heard?.outcome === 'do_not_call' || DNC.test(text))) return end("Sorry for the trouble. We won't call this number again. Goodbye.", { kind: 'do_not_call', said });
  if (notNow || heard?.outcome === 'call_back' || CALL_BACK.test(text)) {
    return end(ctx.who === 'party' ? 'No problem, we will call another time. Goodbye.' : `No problem, ${firstName(ctx.name)}. I'll call you back a little later.`, null, true);
  }

  if (s.phase === 'identity') {
    // A wrong number blocks the number for good, so only the words say so: a wrong-number phrase, or a bare "no". A model's "no" alone never does.
    if (WRONG.test(text) || BARE_NO.test(text)) return end('Sorry to have troubled you. Goodbye.', { kind: 'wrong_number', said });
    if (heard?.identity === 'asking' || WHO.test(text) || /\?\s*$/.test(text)) {
      if (s.retries >= 2) return end('Sorry to have troubled you. Goodbye.', null);
      s.retries++;
      return say(`I'm an AI assistant calling from ${ctx.companyName} about an account with ${ctx.name}. Am I speaking with someone from ${ctx.name}?`);
    }
    const yes = heard?.identity === 'yes' || IDENTITY_YES.test(text) || spokenYesNo(text) === true;
    // "He is not available", "No, this is his wife": not the right person now, so no details, and another call another day.
    if (heard?.identity === 'no' || (!yes && spokenYesNo(text) === false)) return end('Sorry to have troubled you. We will call another time. Goodbye.', null, true);
    if (yes) {
      s.phase = 'ask';
      s.retries = 0;
      return say(`Thank you. It's about ${ctx.about}. ${partyQuestion(ctx)}`);
    }
    if (s.retries < 1) {
      s.retries++;
      return say(`Sorry, am I speaking with someone from ${ctx.name}?`);
    }
    return end("Sorry, I'll try another time. Goodbye.", null);
  }

  if (s.phase === 'reference') {
    const prev = s.result as Extract<FollowUpResult, { kind: 'settled' }>;
    const refField = ctx.findOut.find((f) => f.type === 'string');
    const ref = heardRef(heard?.reference) ?? referenceIn(text)?.ref ?? null;
    const proposed = ref && refField ? { ...prev.proposed, [refField.name]: ref } : prev.proposed;
    return end(`Thank you, I've noted it. Someone from ${ctx.companyName} will check it. Goodbye.`, { kind: 'settled', said: `${prev.said}. ${said}`, proposed });
  }

  if (ctx.who === 'staff') {
    const field = statusField(ctx);
    const dateField = ctx.findOut.find((f) => f.type === 'date' || f.type === 'datetime');
    const notDone = staffNotDone(plain, ctx.now);
    const heardStatus =
      heard?.status && field?.options?.includes(heard.status) && heard.status !== 'new' && !(notDone && DONE_OPTIONS.includes(heard.status)) ? heard.status : null;
    const status = heardStatus ?? (field?.options ? staffStatus(field.options, plain, notDone) : null);
    let due: string | null = null;
    if (dateField) {
      // The script's reading of the words wins; a model's deadline only fills in when the words give none.
      const scripted = dateField.type === 'date' ? spokenDate(text, ctx.now) : spokenDateTime(text, ctx.now);
      const modelDue = scripted ? null : indiaTime(heard?.dueAt);
      const raw = scripted ?? (modelDue && (dateField.type === 'date' ? modelDue.day : modelDue.at));
      const day = raw ? (dateField.type === 'date' ? raw.slice(0, 10) : istDate(new Date(raw))) : null;
      if (raw && day && day >= today) due = dateField.type === 'date' ? raw.slice(0, 10) : new Date(raw).toISOString();
    }
    const patch: Record<string, unknown> = { ...(status && field && { [field.name]: status }), ...(due && dateField && { [dateField.name]: due }) };
    if (Object.keys(patch).length) {
      const when = due && dateField ? `, due ${dateField.type === 'date' ? sayDay(due, ctx.now) : speakable(new Date(due))}` : '';
      return end(`Thanks, ${firstName(ctx.name)}. I've updated it${status ? ` to ${status.replace(/-/g, ' ')}` : ''}${when}.`, { kind: 'status', said, patch });
    }
    if (s.retries < 1) {
      s.retries++;
      return say(field?.options ? `Sorry, what's the status: ${orList(field.options.slice(0, 5))}?` : 'Sorry, when will it be done?');
    }
    return end(`Thanks, ${firstName(ctx.name)}. I'll pass that on.`, { kind: 'said', said });
  }

  // An outside party, about the item.
  if (heard?.outcome === 'dispute' || DISPUTE.test(text)) {
    return end(`I've noted that; someone from ${ctx.companyName} will call you back. Goodbye.`, { kind: 'dispute', said });
  }
  const found = referenceIn(text);
  const rest = found ? `${text.slice(0, found.start)} ${text.slice(found.end)}` : text;
  const day = spokenDate(rest, ctx.now);
  const notYet = NOT_PAID.test(plain) || NEGATED_SETTLE.test(plain) || FUTURE_SETTLE.test(plain) || LATER.test(plain) || (day !== null && day > today);
  if (!notYet && (heard?.outcome === 'paid' || PAID.test(plain))) {
    const amount = heard?.amount ?? spokenAmount(rest.replace(PHONE_IN_TEXT, ' '));
    const proposed = settledPatch(ctx, text, amount !== null && amount >= 1 ? amount : null);
    const refField = ctx.findOut.find((f) => f.type === 'string');
    const ref = heardRef(heard?.reference) ?? found?.ref ?? null;
    if (refField && ref) proposed[refField.name] = ref;
    if (refField && !ref) {
      s.phase = 'reference';
      s.result = { kind: 'settled', said, proposed };
      return say('Thank you. Do you have a payment reference, like a UTR number?');
    }
    return end(`Thank you, I've noted that. Someone from ${ctx.companyName} will check it. Goodbye.`, { kind: 'settled', said, proposed });
  }
  const promised = dayOk(heard?.promiseOn ?? null, today) ? heard!.promiseOn! : day;
  if (promised && promised >= today) return end(`Thank you, I've noted that for ${sayDay(promised, ctx.now)}. Goodbye.`, { kind: 'promise', said, promiseOn: promised });
  if (s.retries < 1) {
    s.retries++;
    return say('Sorry, roughly when can we expect it?');
  }
  return end(goodbye, { kind: 'said', said });
}

/** A cooperative person for the simulator's auto mode. */
export function simulatedFollowUpReply(ctx: FollowUpContext): string {
  if (ctx.who === 'staff') return 'It is in progress, I will finish it by tomorrow 5 pm.';
  if (ctx.state.phase === 'identity') return 'Yes, speaking.';
  if (ctx.state.phase === 'reference') return 'No reference yet.';
  return partyQuestion(ctx).includes('paid') ? 'We will pay it by Friday.' : 'I will confirm it by Friday.';
}

/** Likely replies for the simulator, for where the call is. */
export function followUpSuggestions(ctx: FollowUpContext): string[] {
  const s = ctx.state;
  if (s.phase === 'done') return [];
  if (ctx.who === 'staff') return ["It's in progress, done by tomorrow 5 pm", "It's done", 'Can you call me later?'];
  if (s.phase === 'identity') return ['Yes, speaking', 'Wrong number', 'Who is this?'];
  if (s.phase === 'reference') return ['UTR 445566', 'No reference'];
  return partyQuestion(ctx).includes('paid')
    ? ['We will pay on Friday', "It's already paid", 'The goods never came', "Don't call me again"]
    : ['I will confirm it by Friday', "It's done", 'There is a problem with it', "Don't call me again"];
}

const HeardSchema = z.strictObject({
  identity: z.enum(['yes', 'no', 'asking']).nullable(),
  outcome: z.enum(['paid', 'promise', 'dispute', 'do_not_call', 'status', 'call_back', 'other']).nullable(),
  promise_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  reference: z.string().max(60).nullable(),
  status: z.string().nullable(),
  due_at: z.string().nullable(),
  amount: z.number().nullable(),
});

@Injectable()
export class FollowUpEngine {
  constructor(private readonly llm: LlmService) {}

  opening(ctx: FollowUpContext): string {
    return followUpOpening(ctx);
  }

  async turn(ctx: FollowUpContext, text: string): Promise<FollowUpTurn> {
    return followUpTurn(ctx, text, await this.understand(ctx, text));
  }

  private async understand(ctx: FollowUpContext, text: string): Promise<FollowUpHeard | null> {
    const asked = ctx.transcript.filter((l) => l.speaker === 'ai').at(-1)?.text ?? '';
    const options = ctx.findOut.filter((f) => f.type === 'enum').map((f) => `${f.name}: ${f.options?.join(' / ')}`).join('; ');
    const heard = await understandReply(this.llm, {
      tenantId: ctx.tenantId,
      schema: HeardSchema,
      system: `You read one reply on a phone call. An AI assistant from ${ctx.companyName} is calling ${ctx.who === 'party' ? `someone at ${ctx.name}, an outside party,` : `${ctx.name}, a team member,`} about ${ctx.about}.
Report only what the reply says; never guess. Today is ${istDate(ctx.now)} (India).
identity: yes if they confirm they are ${ctx.name}, no if not, asking if they ask who is calling; else null.
outcome: paid (they say it is paid, received, approved or done), promise (they give a date), dispute (they disagree or say something went wrong), do_not_call, status (a team member gives a status), call_back, or other; null if the reply is only about identity.
promise_on: the promised day as YYYY-MM-DD. reference: a payment or transaction reference if said. status: one of ${options || 'none'} if said. due_at: a new deadline in India time as YYYY-MM-DDTHH:MM (no offset). amount: an amount in rupees if said.`,
      user: `The AI just said: "${asked}"\nThe reply: "${text}"`,
    });
    return heard && { identity: heard.identity, outcome: heard.outcome, promiseOn: heard.promise_on, reference: heard.reference, status: heard.status, dueAt: heard.due_at, amount: heard.amount };
  }
}

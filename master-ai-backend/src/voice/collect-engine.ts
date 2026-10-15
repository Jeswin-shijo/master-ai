import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { EntityField, TranscriptLine } from '@onehuman/schemas';
import { LlmService } from '../llm/llm.service';
import { askFor, cleanWords, lowerFirst, orList, parseField, readBack, spokenCount, spokenYesNo } from './spoken';
import { understandReply } from './understand';

/**
 * Collection calls: the AI phones the person who keeps a list (the billing
 * clerk, the helpdesk lead) and takes down today's items one field at a
 * time, reads each back, and saves it on a yes, so a dropped call keeps
 * every confirmed item. A script runs the call; with a model, the model only
 * says what a reply contains (several answers at once, yes or no), and the
 * script decides what happens.
 */

export interface CollectMatch {
  id: string;
  title: string;
}

export type SaveResult = { kind: 'saved'; id: string } | { kind: 'repeat'; id: string; differences: string[] } | { kind: 'invalid'; message: string };

export interface CollectDeps {
  /** Items of a record type whose title contains the words, best first. */
  lookup(entity: string, words: string): Promise<CollectMatch[]>;
  /** Saves a confirmed item; the service fills the routine's defaults and checks for repeats. */
  save(item: Record<string, unknown>): Promise<SaveResult>;
}

export interface CollectState {
  phase: 'count' | 'field' | 'pick' | 'confirm' | 'more' | 'done';
  /** How many they said there are; a hint only. */
  expected: number | null;
  /** The item being taken down. */
  item: Record<string, unknown>;
  /** Titles of the items its references point at, for the read-back. */
  titles: Record<string, string>;
  /** Optional fields they had no answer for, on this item. */
  skipped: string[];
  /** The field being asked: an index into the context's fields. */
  at: number;
  choices: CollectMatch[];
  /** The words said for the reference being matched, kept if nothing fits. */
  words: string | null;
  retries: number;
  /** Items finished on this call: saved, repeats, and ones left for the app. */
  done: number;
  saved: string[];
  differences: number;
}

export function newCollectState(): CollectState {
  return { phase: 'count', expected: null, item: {}, titles: {}, skipped: [], at: 0, choices: [], words: null, retries: 0, done: 0, saved: [], differences: 0 };
}

export interface CollectContext {
  tenantId: string;
  companyName: string;
  ownerName: string;
  staff: { name: string; title: string };
  /** "bills" and "bill". */
  listLabel: string;
  itemLabel: string;
  /** The fields it asks for, in order: the routine's ask, less its defaults. */
  fields: EntityField[];
  maxItems: number;
  state: CollectState;
  transcript: TranscriptLine[];
  now: Date;
}

export interface CollectTurn {
  say: string;
  end: boolean;
  callBack: boolean;
  state: CollectState;
}

/** What a model heard in one reply. Only the script acts on it. */
export interface CollectHeard {
  count: number | null;
  /** Field name → the words said for it. */
  values: Record<string, string>;
  answer: 'yes' | 'no' | null;
  noMore: boolean;
  callBack: boolean;
}

const CALL_BACK = /\b(call (me )?(back|later)|busy (now|right now)|can'?t talk|i['’]?m driving|i am driving|in a meeting|not a good time)\b/i;
const NO_MORE = /\b(that'?s (all|it|everything)|no more|nothing (else|more)|that is all|done for (today|now)|no others?)\b/i;
const SKIP = /\b(skip|don'?t know|not sure|no idea|not there|not given|leave it|none|nil)\b/i;
const OTHER = /\b(none|neither|other|different one)\b/i;
const ORDINALS: [string, number][] = [['first', 0], ['second', 1], ['third', 2], ['one', 0], ['two', 1], ['three', 2]];
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** One turn of the call: the reply, read by the script (helped by what a model heard, if anything). */
export async function collectTurn(ctx: CollectContext, text: string, deps: CollectDeps, heard: CollectHeard | null = null): Promise<CollectTurn> {
  const prev = ctx.state;
  const s: CollectState = { ...prev, item: { ...prev.item }, titles: { ...prev.titles }, skipped: [...prev.skipped], choices: [...prev.choices], saved: [...prev.saved] };
  const first = ctx.staff.name.split(' ')[0];
  const { fields, itemLabel: item } = ctx;
  const scripted = spokenYesNo(text);
  // An explicit "no" in the words always wins over what a model heard.
  const answer = scripted === false ? false : heard?.answer ? heard.answer === 'yes' : scripted;

  const say = (line: string): CollectTurn => ({ say: line.replace(/\s+/g, ' ').trim(), end: false, callBack: false, state: s });
  const end = (line: string, callBack = false): CollectTurn => {
    s.phase = 'done';
    return { say: line.replace(/\s+/g, ' ').trim(), end: true, callBack, state: s };
  };
  const close = () => end(closing(ctx, s));
  const resetItem = () => {
    s.item = {};
    s.titles = {};
    s.skipped = [];
    s.at = 0;
    s.retries = 0;
    s.choices = [];
    s.words = null;
  };
  const advance = (prefix = ''): CollectTurn => {
    s.retries = 0;
    const i = fields.findIndex((f) => !(f.name in s.item) && !s.skipped.includes(f.name));
    if (i < 0) {
      s.phase = 'confirm';
      return say(`${prefix} ${readBack(item, fields, s.item, s.titles, ctx.now)} Is that right?`);
    }
    s.at = i;
    s.phase = 'field';
    return say(`${prefix} ${askFor(fields[i]!)}`);
  };
  const afterItem = (line: string): CollectTurn => {
    resetItem();
    if (s.done >= ctx.maxItems) return end(`${line} That's all I can take on one call; please add the rest in the app. Thank you, ${first}.`);
    if (s.expected !== null && s.done >= s.expected) {
      s.phase = 'more';
      return say(`${line} That's ${s.done}. Any more ${ctx.listLabel}?`);
    }
    return advance(`${line} Next ${item}.`);
  };
  const skipOrRetry = (field: EntityField): CollectTurn => {
    if (!field.required && SKIP.test(text)) {
      s.skipped.push(field.name);
      return advance('Okay.');
    }
    if (s.retries < 1) {
      s.retries++;
      return say(`Sorry, I didn't catch that. ${askFor(field)}`);
    }
    if (!field.required) {
      s.skipped.push(field.name);
      return advance('Okay, moving on.');
    }
    s.done++;
    return afterItem(`I couldn't get the ${lowerFirst(field.label)}, so please add this ${item} in the app.`);
  };

  if (heard?.callBack || CALL_BACK.test(text)) return end(`No problem, ${first}. I'll call you back a little later.`, true);

  switch (s.phase) {
    case 'count': {
      const n = heard?.count ?? spokenCount(text);
      if (n === 0) return end(`Okay, no ${ctx.listLabel} today. Thank you, ${first}.`);
      if (n === null && s.retries < 1) {
        s.retries++;
        return say(`Sorry, how many ${ctx.listLabel} are there today?`);
      }
      s.expected = n;
      resetItem();
      return advance(`${n === null ? "Okay, let's start." : `${n}, got it.`} ${capitalize(item)} 1.`);
    }

    case 'field': {
      const field = fields[s.at]!;
      const fresh = Object.keys(s.item).length === 0 && s.skipped.length === 0;
      if (fresh && (heard?.noMore || NO_MORE.test(text))) return close();
      // A model may hear several answers in one reply: keep each that reads for its field.
      for (const [name, raw] of Object.entries(heard?.values ?? {})) {
        const f = fields.find((x) => x.name === name);
        if (!f || f.type === 'reference' || name === field.name || name in s.item) continue;
        const p = parseField(f, raw, ctx.now);
        if (p.ok) s.item[name] = p.value;
      }
      const raw = heard?.values[field.name] ?? text;
      if (field.type === 'reference') {
        const words = cleanWords(raw);
        if (!words || SKIP.test(words)) return skipOrRetry(field);
        const matches = (await deps.lookup(field.ref ?? '', words)).slice(0, 3);
        if (matches.length === 0) {
          s.item[field.name] = words;
          return advance(`I'll note ${words} as you said it.`);
        }
        s.choices = matches;
        s.words = words;
        s.phase = 'pick';
        s.retries = 0;
        return say(matches.length === 1 ? `${matches[0]!.title}, is that right?` : `Is it ${orList(matches.map((m) => m.title))}?`);
      }
      if ((field.type === 'string' || field.type === 'text') && SKIP.test(raw)) return skipOrRetry(field);
      const parsed = parseField(field, raw, ctx.now);
      if (parsed.ok) {
        s.item[field.name] = parsed.value;
        return advance();
      }
      return skipOrRetry(field);
    }

    case 'pick': {
      const field = fields[s.at]!;
      const t = norm(text);
      const named = s.choices.find((c) => t.includes(norm(c.title)));
      const ordinal = ORDINALS.find(([w]) => new RegExp(`\\b${w}\\b`).test(t));
      let chosen: CollectMatch | null | undefined;
      if (named) chosen = named;
      else if (s.choices.length === 1 && answer !== null) chosen = answer ? s.choices[0] : null;
      else if (s.choices.length > 1 && ordinal && s.choices[ordinal[1]]) chosen = s.choices[ordinal[1]];
      else if (answer === false || OTHER.test(text)) chosen = null;
      if (chosen === undefined) {
        if (s.retries < 1) {
          s.retries++;
          return say(s.choices.length === 1 ? `Sorry, is it ${s.choices[0]!.title}? Yes or no?` : `Sorry, which one: ${orList(s.choices.map((c) => c.title))}?`);
        }
        chosen = null;
      }
      if (chosen) {
        s.item[field.name] = chosen.id;
        s.titles[field.name] = chosen.title;
      } else {
        s.item[field.name] = s.words;
      }
      s.choices = [];
      s.words = null;
      return advance(chosen ? 'Got it.' : `I'll note ${String(s.item[field.name])} as you said it.`);
    }

    case 'confirm': {
      if (answer === null && s.retries < 1) {
        s.retries++;
        return say('Sorry, is that right? Yes or no?');
      }
      if (answer !== true) {
        resetItem();
        return advance("Let's take it again.");
      }
      const res = await deps.save({ ...s.item });
      s.done++;
      if (res.kind === 'saved') {
        s.saved.push(res.id);
        return afterItem('Saved.');
      }
      if (res.kind === 'repeat') {
        if (!res.differences.length) return afterItem(`That ${item} is already on the list.`);
        s.differences++;
        return afterItem(`That ${item} is already on the list, with a different ${orList(res.differences.map(lowerFirst))}. I've noted it for ${ctx.ownerName}.`);
      }
      return afterItem("I couldn't save that one, so please add it in the app.");
    }

    case 'more': {
      if (heard?.noMore || NO_MORE.test(text) || answer === false) return close();
      if (answer === true || /\b(one more|another)\b/i.test(text)) {
        s.expected = null;
        return advance(`Okay. ${capitalize(item)} ${s.done + 1}.`);
      }
      if (s.retries < 1) {
        s.retries++;
        return say(`Sorry, any more ${ctx.listLabel}? Yes or no?`);
      }
      return close();
    }

    default:
      return close();
  }
}

function closing(ctx: CollectContext, s: CollectState): string {
  const first = ctx.staff.name.split(' ')[0];
  const n = s.saved.length;
  const added = n === 0 ? `I haven't added any ${ctx.listLabel}` : `I've added ${n} ${n === 1 ? ctx.itemLabel : ctx.listLabel}`;
  const noted = s.differences ? `, and noted ${s.differences === 1 ? 'a difference' : `${s.differences} differences`} for ${ctx.ownerName}` : '';
  return `Thank you, ${first}. ${added}${noted}. Have a good evening.`;
}

/** "Added 3 bills · 1 difference noted" for the call log and the routine's day. */
export function collectSummary(state: CollectState, ctx: Pick<CollectContext, 'listLabel' | 'itemLabel'>): string {
  const n = state.saved.length;
  const parts = [`Added ${n} ${n === 1 ? ctx.itemLabel : ctx.listLabel}`];
  if (state.differences) parts.push(`${state.differences} difference${state.differences === 1 ? '' : 's'} noted`);
  return parts.join(' · ');
}

/** A cooperative clerk for the simulator's auto mode: two items, then that's all. */
export function simulatedCollectReply(ctx: CollectContext): string {
  const s = ctx.state;
  const n = s.done + 1;
  switch (s.phase) {
    case 'count':
      return 'Two';
    case 'pick':
      return 'Yes';
    case 'confirm':
      return 'Yes';
    case 'more':
      return "No, that's all";
    case 'field': {
      const f = ctx.fields[s.at]!;
      return sampleAnswer(f, n);
    }
    default:
      return 'Thank you';
  }
}

function sampleAnswer(f: EntityField, n: number): string {
  switch (f.type) {
    case 'enum':
      return f.options?.[0] ?? 'Not sure';
    case 'money':
      return n === 1 ? '48,260' : '12,500';
    case 'number':
    case 'integer':
      return String(n + 2);
    case 'date':
      return 'today';
    case 'datetime':
      return 'tomorrow 5 pm';
    case 'boolean':
      return 'Yes';
    case 'phone':
      return `98470 1234${n}`;
    case 'email':
      return 'accounts@example.com';
    case 'reference':
      return f.required ? 'Sharma and Sons' : 'Not sure';
    case 'text':
      return n === 1 ? 'Leaking tap near the main gate' : 'Two cement bags short';
    default:
      return /no\.?$|number|code/i.test(f.label) ? `S-${1040 + n}` : `Sample ${n}`;
  }
}

/** Likely replies for the simulator, for the question being asked. */
export function collectSuggestions(ctx: CollectContext): string[] {
  const s = ctx.state;
  switch (s.phase) {
    case 'count':
      return ['Two', 'None today', 'Can you call me later?'];
    case 'pick':
      return [...s.choices.map((c) => c.title), 'None of those'];
    case 'confirm':
      return ['Yes', 'No, that is wrong'];
    case 'more':
      return ["No, that's all", 'Yes, one more'];
    case 'field': {
      const f = ctx.fields[s.at];
      if (!f) return [];
      const fresh = Object.keys(s.item).length === 0 && s.skipped.length === 0;
      return [...new Set([sampleAnswer(f, s.done + 1), ...(f.required ? [] : ["Don't know"]), ...(fresh && s.done > 0 ? ["That's all"] : [])])];
    }
    default:
      return [];
  }
}

const HeardSchema = z.strictObject({
  count: z.number().int().min(0).max(500).nullable(),
  values: z.array(z.strictObject({ field: z.string(), value: z.string() })),
  answer: z.enum(['yes', 'no']).nullable(),
  no_more: z.boolean(),
  call_back: z.boolean(),
});

@Injectable()
export class CollectEngine {
  constructor(private readonly llm: LlmService) {}

  opening(ctx: CollectContext): string {
    const first = ctx.staff.name.split(' ')[0];
    return `Hi ${first}, this is the AI assistant at ${ctx.companyName}, calling for today's ${ctx.listLabel}. How many are there today?`;
  }

  async turn(ctx: CollectContext, text: string, deps: CollectDeps): Promise<CollectTurn> {
    return collectTurn(ctx, text, deps, await this.understand(ctx, text));
  }

  private async understand(ctx: CollectContext, text: string): Promise<CollectHeard | null> {
    const asked = ctx.transcript.filter((l) => l.speaker === 'ai').at(-1)?.text ?? '';
    const fields = ctx.fields.map((f) => `- ${f.name} (${f.type}${f.options ? `: ${f.options.join(' / ')}` : ''}): ${f.label}`).join('\n');
    const heard = await understandReply(this.llm, {
      tenantId: ctx.tenantId,
      schema: HeardSchema,
      system: `You read one reply on a phone call in which an AI assistant takes down today's ${ctx.listLabel} from ${ctx.staff.name}, one at a time.
Report only what the reply says; never guess or fill in.
values: the fields below the reply gives an answer for, with the words as said (do not convert amounts or dates).
answer: yes or no when the reply answers a yes-or-no question, else null.
count: how many ${ctx.listLabel} there are, if the reply says so, else null.
no_more: they say there are no more. call_back: they ask to be called later.`,
      user: `Fields:\n${fields}\n\nThe AI just said: "${asked}"\nThe reply: "${text}"`,
    });
    return heard && { count: heard.count, values: Object.fromEntries(heard.values.map((v) => [v.field, v.value])), answer: heard.answer, noMore: heard.no_more, callBack: heard.call_back };
  }
}

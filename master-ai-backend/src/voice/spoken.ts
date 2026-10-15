import type { EntityField } from '@onehuman/schemas';
import { addDaysTo, istDate, parseDue, speakable } from './time';

/**
 * Reading what people say on a call, the Indian way: amounts in lakhs and
 * "two sixty", dates like "20/10" (day first) and "last Monday", options
 * said without their dashes. Each reader returns null when it isn't sure, so
 * the call asks again instead of saving a guess.
 */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, k: 1_000, lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000, crore: 10_000_000, crores: 10_000_000,
};
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** What people say for each month: the full name or a standard abbreviation, as a whole word ("maybe" and "market" are not months). */
const MONTH_WORDS = ['jan|january', 'feb|february', 'mar|march', 'apr|april', 'may', 'jun|june', 'jul|july', 'aug|august', 'sept?|september', 'oct|october', 'nov|november', 'dec|december'].map((m) => `(?:${m})\\.?(?![a-z])`);
const MONTH_NAMES = MONTHS.map((m) => m[0]!.toUpperCase() + m.slice(1));
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

type Part = { n: number } | { scale: number };

const CORRECTION = /\b(sorry|no wait|i mean|correction)\b/;

/** How many separate numbers a reply holds: runs of number words or digits, split by other words ("sixty thousand, no sorry, sixty five" is two). */
function numberRuns(lower: string): number {
  let runs = 0;
  let inRun = false;
  for (const tok of lower.replace(/(\d),(?=\d)/g, '$1').match(/\d+(?:\.\d+)?|[a-z]+/g) ?? []) {
    const isNumber = /^\d/.test(tok) || tok in UNITS || tok in TENS || (tok in SCALES && tok !== 'k');
    if (isNumber && !inRun) runs++;
    inRun = isNumber || (inRun && tok === 'point');
  }
  return runs;
}

/** "48,260", "₹48260", "1.2 lakh", "forty-eight thousand two sixty", "one lakh twenty" (1,20,000), "two sixty" (260). */
export function spokenAmount(text: string): number | null {
  const lower = text.toLowerCase();
  if (/\b(half|quarter)\b/.test(lower)) return null;
  // A self-correction ("sixty thousand, no sorry, sixty five thousand") is asked again, not guessed.
  if (CORRECTION.test(lower) && numberRuns(lower) >= 2) return null;
  const tokens = lower.replace(/(\d),(?=\d)/g, '$1').match(/\d+(?:\.\d+)?|[a-z]+/g) ?? [];
  const parts: Part[] = [];
  // "two point five": digits after "point" are decimal places, read one by one.
  let decimal: { part: { n: number }; base: number; digits: string } | null = null;
  tokens.forEach((tok, i) => {
    if (decimal) {
      const d = /^\d+$/.test(tok) ? tok : tok in UNITS && UNITS[tok]! < 10 ? String(UNITS[tok]) : null;
      if (d !== null) {
        decimal.digits += d;
        decimal.part.n = decimal.base + Number(`0.${decimal.digits}`);
        return;
      }
      decimal = null;
    }
    if (tok === 'point') {
      const last = parts[parts.length - 1];
      if (last && 'n' in last) decimal = { part: last, base: last.n, digits: '' };
    } else if (/^\d/.test(tok)) parts.push({ n: Number(tok) });
    else if (tok in UNITS) parts.push({ n: UNITS[tok]! });
    else if (tok in TENS) parts.push({ n: TENS[tok]! });
    else if (tok in SCALES && (tok !== 'k' || parts.length > 0)) parts.push({ scale: SCALES[tok]! });
    else if ((tok === 'a' || tok === 'an') && (tokens[i + 1] ?? '') in SCALES) parts.push({ n: 1 });
  });
  // Join the numbers said as one: "forty eight" → 48, "two sixty" → 260. Two numbers that don't join: not sure, so ask again.
  const merged: Part[] = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if ('n' in p && prev && 'n' in prev) {
      const endsInTens = prev.n % 100 >= 20 && prev.n % 10 === 0 && Number.isInteger(prev.n);
      if (endsInTens && p.n < 10) prev.n += p.n;
      else if (prev.n >= 1 && prev.n < 10 && p.n >= 10 && p.n < 100) prev.n = prev.n * 100 + p.n;
      else return null;
      continue;
    }
    merged.push({ ...p });
  }
  if (!merged.some((p) => 'n' in p)) return null;
  let total = 0;
  let group = 0;
  let lastScale = Number.POSITIVE_INFINITY;
  for (const p of merged) {
    if ('n' in p) group += p.n;
    else if (p.scale === 100) group = (group || 1) * 100;
    else {
      total += (group || 1) * p.scale;
      lastScale = p.scale;
      group = 0;
    }
  }
  // "one lakh twenty" means 1,20,000: a small number after lakhs or crores counts in the next scale down.
  if (group > 0 && group < 100 && lastScale >= 100_000 && Number.isFinite(lastScale)) group *= lastScale / 100;
  return Math.round((total + group) * 100) / 100;
}

/** How many: "three", "12", "none" (0). */
export function spokenCount(text: string): number | null {
  // A correction ("No wait, five", "No, I mean five") is asked again, before the bare-no rule can read it as zero.
  if (CORRECTION.test(text.toLowerCase()) && (/^\s*no\b/i.test(text) || numberRuns(text.toLowerCase()) >= 2)) return null;
  const n = /^\s*no\s+one\b/i.test(text) ? null : spokenAmount(text);
  if (n !== null) return Math.round(n);
  // "No, there are five" counts 5 (above); a bare "No" or "None" is zero.
  return /^\s*(none|no(ne)?\s*\w*\s*today|nothing|zero|nil|no)\b/i.test(text) ? 0 : null;
}

function realDay(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** "20 October", "Oct 20th", "5 May": a month as a whole word, with its day. */
function monthDay(t: string, year: number): string | null {
  const month = MONTH_WORDS.findIndex((m) => new RegExp(`\\b${m}`).test(t));
  if (month < 0) return null;
  const name = MONTH_WORDS[month]!;
  const day = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${name}`).exec(t) ?? new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
  const y = /\b(20\d{2})\b/.exec(t);
  return day ? realDay(y ? Number(y[1]) : year, month + 1, Number(day[1])) : null;
}

/** A past-tense cue before a bare weekday: "Fixed it on Tuesday", "paid on Monday"; a future cue ("will be delivered on Tuesday") cancels it. */
const PAST_CUE = /\b(?:fixed|paid|done|did|was|were|sent|received|came|closed|finished|completed|cleared|delivered)\b|\b\w+ed\s+on\s*$/;
const FUTURE_CUE = /\b(?:will|shall|going to|gonna|should|would|must|to|told)\b|['’][ld]\b/;
/** Where a clause starts: after a comma, semicolon, full stop, "but" or "balance". */
const CLAUSE_BREAK = /[,;.]|\b(?:but|balance)\b/g;

/** A day, YYYY-MM-DD in India: "today", "yesterday", "20 October", "20/10" (day first), "on Friday", "last Monday", "in 3 days". */
export function spokenDate(text: string, now: Date = new Date()): string | null {
  const t = text.toLowerCase();
  const today = istDate(now);
  const year = Number(today.slice(0, 4));
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return realDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const relative = /\b(day before yesterday|day after tomorrow|yesterday|tomorrow|today|tonight|in \d{1,2} days?)\b/.test(t);
  // An explicit date beats "today" or "tomorrow" said in the same reply ("entered today, dated 12 October").
  const named = monthDay(t, year);
  if (named) return named;
  const numeric = /\b(\d{1,2})([/.-])(\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(t);
  // With a relative word, only "20/10" counts as a date, so "yesterday at 5.30" and "tomorrow between 10-12" are still the relative day.
  if (numeric && !(relative && numeric[2] !== '/')) {
    const y = numeric[4] ? (numeric[4].length === 2 ? 2000 + Number(numeric[4]) : Number(numeric[4])) : year;
    const day = realDay(y, Number(numeric[3]), Number(numeric[1]));
    if (day || !relative) return day;
  }
  if (/\bday before yesterday\b/.test(t)) return addDaysTo(today, -2);
  if (/\bday after tomorrow\b/.test(t)) return addDaysTo(today, 2);
  if (/\byesterday\b/.test(t)) return addDaysTo(today, -1);
  if (/\btomorrow\b/.test(t)) return addDaysTo(today, 1);
  if (/\b(today|tonight)\b/.test(t)) return today;
  const inDays = /\bin (\d{1,2}) days?\b/.exec(t);
  if (inDays) return addDaysTo(today, Number(inDays[1]));
  const wdMatch = WEEKDAYS.map((w) => new RegExp(`\\b${w}\\b`).exec(t)).find((m) => m);
  if (wdMatch) {
    const wd = WEEKDAYS.indexOf(wdMatch[0]);
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const upTo = t.slice(0, wdMatch.index);
    const before = upTo.slice([...upTo.matchAll(CLAUSE_BREAK)].reduce((at, m) => m.index + m[0].length, 0));
    const gone = /\blast\b/.test(t) || (PAST_CUE.test(before) && !FUTURE_CUE.test(before) && !/\bnext\b/.test(t));
    if (gone) return addDaysTo(today, -(((dow - wd + 7) % 7) || 7));
    return addDaysTo(today, ((wd - dow + 7) % 7) || 7);
  }
  return null;
}

/** A moment, as ISO: "tomorrow 5 pm"; a day alone means 6 pm India time. */
export function spokenDateTime(text: string, now: Date = new Date()): string | null {
  const due = parseDue(text, now);
  if (due) return due.toISOString();
  const day = spokenDate(text, now);
  return day ? new Date(`${day}T18:00:00+05:30`).toISOString() : null;
}

const UNSURE = /\b(not sure|don'?t know|no idea|maybe)\b/i;
export const BENIGN = /\b(no problem|no issues?|not a problem|no worries)\b/gi;
const NEGATION = /\b(no|nope|nahi|nah|not|wrong|incorrect)\b/i;
const YES = /\b(yes|yeah|yep|yup|haan|han|ha|theek hai|thik hai|sure|correct|right|ok(ay)?|speaking|that'?s me)\b/i;

export function spokenYesNo(text: string): boolean | null {
  if (UNSURE.test(text)) return null;
  const t = text.replace(BENIGN, ' ');
  if (NEGATION.test(t)) return false;
  return YES.test(t) ? true : null;
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/[-_]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** The option said: the whole option ("in progress" for in-progress), or a first word only one option has ("purchase"). */
export function matchOption(options: string[], text: string): string | null {
  const t = norm(text);
  // "Not credit note, debit note" is the debit note: an option directly after "not" is left out.
  options = options.filter((o) => !t.includes(` not${norm(o)}`));
  const whole = [...options].sort((a, b) => b.length - a.length).find((o) => t.includes(norm(o)));
  if (whole) return whole;
  const byFirst = options.filter((o) => {
    const first = norm(o).trim().split(' ')[0]!;
    return first.length >= 4 && t.includes(` ${first} `);
  });
  return byFirst.length === 1 ? byFirst[0]! : null;
}

/** What someone said, without "it's" and the full stop: "It's S-1042." → "S-1042". */
export function cleanWords(text: string): string {
  return text
    .trim()
    .replace(/^(it'?s|it is|that'?s|that is|the \w+(?: \w+)? is)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

export function orList(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}

/** "Due date" → "due date", but "GST amount" stays. */
export function lowerFirst(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How the AI asks for a field. */
export function askFor(f: EntityField): string {
  const label = lowerFirst(f.label);
  if (f.type === 'enum' && f.options?.length && f.options.length <= 6) return `What's the ${label}: ${orList(f.options)}?`;
  if (f.type === 'boolean') return `${f.label}: yes or no?`;
  if (f.type === 'reference') return `Which ${label}?`;
  return `What's the ${label}?`;
}

/** "today", "yesterday", "tomorrow", or "20 October" (with the year when it isn't this year). */
export function sayDay(day: string, now: Date): string {
  const today = istDate(now);
  if (day === today) return 'today';
  if (day === addDaysTo(today, -1)) return 'yesterday';
  if (day === addDaysTo(today, 1)) return 'tomorrow';
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTH_NAMES[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ''}`;
}

export function sayValue(f: EntityField, v: unknown, titles: Record<string, string>, now: Date): string {
  if (v === undefined || v === null || v === '') return 'not given';
  switch (f.type) {
    case 'money':
      return `₹${Number(v).toLocaleString('en-IN')}`;
    case 'date':
      return sayDay(String(v), now);
    case 'datetime':
      return speakable(new Date(String(v)));
    case 'boolean':
      return v === true ? 'yes' : 'no';
    case 'reference':
      return titles[f.name] ?? String(v);
    default:
      return String(v);
  }
}

/** "Bill: sales invoice, Sri Ganesh Traders, total ₹48,260, due date 20 October." */
export function readBack(itemLabel: string, fields: EntityField[], item: Record<string, unknown>, titles: Record<string, string>, now: Date): string {
  const parts = fields
    .filter((f) => item[f.name] !== undefined)
    .map((f) => (f.type === 'enum' || f.type === 'reference' ? sayValue(f, item[f.name], titles, now) : `${lowerFirst(f.label)} ${sayValue(f, item[f.name], titles, now)}`));
  return `${capitalize(itemLabel)}: ${parts.join(', ')}.`;
}

/** One spoken answer for one field. References are matched by the caller, against the records. */
export function parseField(f: EntityField, text: string, now: Date): { ok: true; value: unknown } | { ok: false } {
  const t = text.trim();
  switch (f.type) {
    case 'money':
    case 'number': {
      const n = spokenAmount(t);
      return n === null ? { ok: false } : { ok: true, value: n };
    }
    case 'integer': {
      const n = spokenAmount(t);
      return n === null ? { ok: false } : { ok: true, value: Math.round(n) };
    }
    case 'date': {
      const d = spokenDate(t, now);
      return d ? { ok: true, value: d } : { ok: false };
    }
    case 'datetime': {
      const d = spokenDateTime(t, now);
      return d ? { ok: true, value: d } : { ok: false };
    }
    case 'boolean': {
      const b = spokenYesNo(t);
      return b === null ? { ok: false } : { ok: true, value: b };
    }
    case 'enum': {
      const o = matchOption(f.options ?? [], t);
      return o ? { ok: true, value: o } : { ok: false };
    }
    case 'phone': {
      const digits = t.replace(/[^\d+]/g, '');
      const n = digits.replace(/\D/g, '').length;
      return n >= 8 && n <= 13 ? { ok: true, value: digits } : { ok: false };
    }
    case 'email': {
      const m = /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(t);
      return m ? { ok: true, value: m[0].toLowerCase() } : { ok: false };
    }
    default: {
      const v = cleanWords(t);
      return v ? { ok: true, value: v } : { ok: false };
    }
  }
}

/** What a follow-up call is about: "bill S-1042: bill date 12 October, total ₹48,260, due date 20 October". */
export function aboutText(itemLabel: string, fields: EntityField[], data: Record<string, unknown>, titles: Record<string, string>, now: Date): string {
  const given = fields.filter((f) => data[f.name] !== undefined && data[f.name] !== null && data[f.name] !== '');
  const [first, ...rest] = given;
  if (!first) return `a ${itemLabel}`;
  const head = `${itemLabel} ${sayValue(first, data[first.name], titles, now)}`;
  const tail = rest.map((f) => (f.type === 'enum' || f.type === 'reference' ? sayValue(f, data[f.name], titles, now) : `${lowerFirst(f.label)} ${sayValue(f, data[f.name], titles, now)}`));
  return tail.length ? `${head}: ${tail.join(', ')}` : head;
}

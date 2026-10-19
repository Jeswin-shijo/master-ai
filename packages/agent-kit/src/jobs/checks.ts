import type { JobCheck } from '@onehuman/schemas';
import { evalCalc } from './calc';
import { fillTemplate, resolvePath } from './template';
import { isValidGstin, isValidIfsc, isValidPan, isValidPincode } from './validators';
import { findEscalation, matchWords, type EffectiveEscalation } from './words';

/** Keys `trigger`, `today` and each step's `as`. */
export type JobScope = Record<string, unknown>;

export type CheckOutcome =
  | { ok: true; value?: unknown }
  | { ok: false; message: string; escalation?: { set: EffectiveEscalation; words: string[] } };

export type CheckContext = {
  escalations: EffectiveEscalation[];
  seen: (key: string) => Promise<boolean>;
};

/** `item.dueDate` becomes `due date`. */
function plain(path: string): string {
  const last = path.split('.').pop() ?? path;
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
}

const empty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.replace(/[₹,\s]/g, '');
    if (s !== '' && Number.isFinite(Number(s))) return Number(s);
  }
  return null;
}

const NUMBER = /(?<![\p{L}\p{N}])\d[\d,]*(?:\.\d+)?(?![\p{L}\p{N}])/gu;

function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.replace(/₹/g, ' ').matchAll(NUMBER)) {
    const n = Number(m[0].replace(/,+$/, '').replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function collectNumbers(v: unknown, into: Set<number>): void {
  if (typeof v === 'number') into.add(v);
  else if (typeof v === 'string') numbersIn(v).forEach((n) => into.add(n));
  else if (Array.isArray(v)) v.forEach((x) => collectNumbers(x, into));
  else if (v !== null && typeof v === 'object') Object.values(v).forEach((x) => collectNumbers(x, into));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

function deepContains(hay: unknown, needle: unknown): boolean {
  if (deepEqual(hay, needle)) return true;
  if (Array.isArray(hay)) return hay.some((x) => deepContains(x, needle));
  if (hay !== null && typeof hay === 'object') return Object.values(hay).some((x) => deepContains(x, needle));
  return false;
}

const dayNumber = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
};

/** Works out one check on the data so far. Never calls a model. */
export async function runCheck(check: JobCheck, scope: JobScope, ctx: CheckContext): Promise<CheckOutcome> {
  const fail = (detail?: string): CheckOutcome => ({
    ok: false,
    message: detail ? `${check.message} (${detail})` : check.message,
  });
  const missing = (paths: string[]): CheckOutcome => fail(`missing: ${paths.map(plain).join(', ')}`);
  const get = (path: string) => resolvePath(scope, path);
  const text = (spec: string): string | undefined => {
    const v = spec.includes('{{') ? fillTemplate(spec, scope).value : get(spec);
    return typeof v === 'string' ? v : v === undefined || v === null ? undefined : String(v);
  };

  if (check.escalate) {
    const filled = fillTemplate(check.escalate.text, scope).value;
    const hit = findEscalation(typeof filled === 'string' ? filled : JSON.stringify(filled), ctx.escalations);
    return hit ? { ok: false, message: check.message, escalation: hit } : { ok: true };
  }

  if (check.required) {
    const gone = check.required.fields.filter((p) => empty(get(p)));
    return gone.length ? missing(gone) : { ok: true };
  }

  if (check.in_data) {
    const { value, among } = check.in_data;
    const v = get(value);
    if (empty(v)) return missing([value]);
    const pool = get(among);
    if (pool === undefined || pool === null) return missing([among]);
    if (typeof v === 'string') {
      const have = new Set<number>();
      collectNumbers(pool, have);
      const stray = numbersIn(v).filter((n) => !have.has(n));
      return stray.length ? fail('a number here is not in the data') : { ok: true };
    }
    return deepContains(pool, v) ? { ok: true } : fail('not found in the data');
  }

  if (check.limit) {
    const { value, max, min, factor } = check.limit;
    const v = toNum(get(value));
    if (v === null) return missing([value]);
    const bound = max ?? min;
    const raw = typeof bound === 'string' ? get(bound) : bound;
    const b = toNum(raw);
    if (b === null) return missing([String(bound)]);
    const edge = b * (factor ?? 1);
    const ok = max !== undefined ? v <= edge : v >= edge;
    return ok ? { ok: true } : fail();
  }

  if (check.adds_up) {
    const { total, plus, tolerance = 1 } = check.adds_up;
    const minus = check.adds_up.minus ?? [];
    const paths = [total, ...plus, ...minus];
    const nums = paths.map((p) => toNum(get(p)));
    const gone = paths.filter((_p, i) => nums[i] === null);
    if (gone.length) return missing(gone);
    const t = nums[0]!;
    const sum = plus.reduce((s, _p, i) => s + nums[1 + i]!, 0) - minus.reduce((s, _p, i) => s + nums[1 + plus.length + i]!, 0);
    return Math.abs(t - sum) <= tolerance ? { ok: true } : fail();
  }

  if (check.within_days) {
    const { date, days } = check.within_days;
    const d = dayNumber(get(date));
    if (d === null) return missing([date]);
    const t = dayNumber(get('today'));
    if (t === null) return missing(['today']);
    const lo = Math.min(t, t + days);
    const hi = Math.max(t, t + days);
    return d >= lo && d <= hi ? { ok: true } : fail();
  }

  if (check.duplicate) {
    const { value, missing: gone } = fillTemplate(check.duplicate.key, scope);
    if (gone.length) return missing(gone);
    return (await ctx.seen(String(value))) ? fail() : { ok: true };
  }

  if (check.says_not) {
    const t = text(check.says_not.text);
    if (t === undefined) return missing([check.says_not.text]);
    return matchWords(t, check.says_not.phrases).length ? fail() : { ok: true };
  }

  if (check.valid) {
    const { value, as } = check.valid;
    const v = get(value);
    if (empty(v)) return missing([value]);
    const test = { gstin: isValidGstin, pan: isValidPan, ifsc: isValidIfsc, pincode: isValidPincode }[as];
    return typeof v === 'string' && test(v) ? { ok: true } : fail();
  }

  if (check.calc) {
    const r = evalCalc(check.calc.expr, get);
    if (r.ok) return { ok: true, value: r.value };
    return fail(r.reason.replace(/[\w]+(?:\.[\w]+)+/g, (p) => plain(p)));
  }

  return fail();
}

import type { EntityDef, EntityField } from '@onehuman/schemas';
import { pluralize, type ListCheck } from '@onehuman/agent-kit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** A real calendar day (YYYY-MM-DD): 2026-02-31 and 2026-99-99 are not. */
export function isDay(d: string): boolean {
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** The India-time calendar day of a date or date-time, or null when the value isn't one. */
export function dayOf(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v) || !isDay(v.slice(0, 10))) return null;
  if (v.length === 10) return v;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : new Date(at + IST_MS).toISOString().slice(0, 10);
}

/** "14 Oct 2026" */
export function dayText(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "2026-10-14 15:30", India time, or null when the value isn't a date-time. */
export function istStamp(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : new Date(at + IST_MS).toISOString().slice(0, 16).replace('T', ' ');
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const sumOf = (fields: EntityField[], data: Record<string, unknown>) => fields.reduce((n, f) => n + (asNumber(data[f.name]) ?? 0), 0);

/** A value the way a sentence shows it: rupees, a day in words, Yes / No, a reference by its title (never an id). */
export function shown(field: EntityField, v: unknown, titles?: Map<string, string>): string {
  if (v === undefined || v === null || v === '') return '—';
  switch (field.type) {
    case 'money': {
      const n = asNumber(v);
      return n === null ? String(v) : inr.format(n);
    }
    case 'number':
    case 'integer': {
      const n = asNumber(v);
      return n === null ? String(v) : plain.format(n);
    }
    case 'date':
    case 'datetime': {
      const d = dayOf(v);
      return d ? dayText(d) : String(v);
    }
    case 'boolean':
      return v === true ? 'Yes' : v === false ? 'No' : String(v);
    case 'reference':
      return typeof v === 'string' ? (titles?.get(v) ?? (isUuid(v) ? 'a removed item' : v)) : String(v);
    default:
      return String(v);
  }
}

/** The sentence for one problem on one item, e.g. "Total ₹48,260 doesn't equal Taxable value + GST amount (₹48,200)". */
export function problemMessage(check: ListCheck, data: Record<string, unknown>, today: string, entity: EntityDef): string {
  const why = check.why ? ` (${check.why})` : '';
  switch (check.kind) {
    case 'missing':
      return `${check.field.label} ${check.field.type === 'boolean' ? 'is not ticked' : 'is missing'}${why}`;
    case 'adds_up': {
      const expected = sumOf(check.plus, data) - sumOf(check.minus, data);
      const expr = [check.plus.map((f) => f.label).join(' + '), ...check.minus.map((f) => `− ${f.label}`)].filter(Boolean).join(' ');
      return `${check.field.label} ${shown(check.field, data[check.field.name])} doesn't equal ${expr} (${shown(check.field, expected)})${why}`;
    }
    case 'limit': {
      const first = check.fields[0]!;
      const above = check.max !== undefined;
      const bound = (above ? check.max : check.min)!;
      const label = check.fields.map((f) => f.label).join(' + ');
      if (first.type === 'date' && typeof bound !== 'number') {
        return `${label} ${shown(first, data[first.name])} is ${above ? 'after' : 'before'} ${bound.label} (${shown(bound, data[bound.name])})${why}`;
      }
      const limit =
        typeof bound === 'number'
          ? shown(first, bound)
          : `${check.factor !== 1 ? `${Math.round(check.factor * 100)}% of ` : ''}${bound.label} (${shown(first, (asNumber(data[bound.name]) ?? 0) * check.factor)})`;
      return `${label} ${shown(first, sumOf(check.fields, data))} is ${above ? 'more' : 'less'} than ${limit}${why}`;
    }
    case 'duplicate':
      return `Same ${check.fields.map((f) => f.label).join(', ')} as another ${entity.label.toLowerCase()}${why}`;
    case 'overdue': {
      const day = dayOf(data[check.field.name]) ?? today;
      const n = daysBetween(day, today);
      return `${check.field.label} was ${dayText(day)}, ${n === 0 ? 'today' : `${days(n)} ago`}${why}`;
    }
    case 'expiring': {
      const day = dayOf(data[check.field.name]) ?? today;
      const n = daysBetween(today, day);
      if (n > 0) return `${check.field.label} is in ${days(n)} (${dayText(day)})${why}`;
      if (n === 0) return `${check.field.label} is today${why}`;
      return `${check.field.label} passed on ${dayText(day)}, ${days(-n)} ago${why}`;
    }
    case 'ref': {
      const v = data[check.field.name];
      const target = check.target.label.toLowerCase();
      if (isUuid(v)) return `${check.field.label} points to a ${target} that was removed`;
      return `${check.field.label} "${String(v)}" isn't in your ${(check.target.plural_label ?? pluralize(check.target.label)).toLowerCase()}`;
    }
  }
}

/** A value as a spreadsheet cell: plain numbers, ISO days, India-time date-times, a reference's title. */
export function csvValue(field: Pick<EntityField, 'type'>, v: unknown, title?: string): string {
  if (v === undefined || v === null || v === '') return '';
  switch (field.type) {
    case 'reference':
      return title ?? (isUuid(v) ? '' : String(v));
    case 'money':
    case 'number':
    case 'integer':
      return asNumber(v)?.toString() ?? String(v);
    case 'date':
      return dayOf(v) ?? String(v);
    case 'datetime':
      return istStamp(v) ?? String(v);
    case 'boolean':
      return v === true ? 'Yes' : v === false ? 'No' : String(v);
    default:
      return String(v);
  }
}

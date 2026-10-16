import type { EntityField, FollowUpInfo, ItemSourceKind, ListItem, ListQueryParams, ListRange, ListShow, NoteKind } from '@onehuman/schemas';
import { formatInr } from '@onehuman/ui';

/*
 * How a list reads, the same on the web and the phone: the filters' names, a
 * page's query, and record values in words (rupees, dates, references by
 * title). Ids are never shown.
 */

export const RANGE_LABELS: Record<ListRange, string> = {
  today: 'Today',
  this_week: 'This week',
  this_month: 'This month',
  last_month: 'Last month',
  all: 'All time',
};
export const SHOW_LABELS: Record<ListShow | 'all', string> = { all: 'All', problems: 'Has problems', not_checked: 'Not checked', checked: 'Checked', new_notes: 'New from calls' };
export const SOURCE_LABELS: Record<ItemSourceKind, string> = { manual: 'By hand', call: 'Phone call', agent: 'AI agent', sample: 'Sample data' };
export const NOTE_LABELS: Record<NoteKind, string> = {
  said: 'Said on a call',
  promise: 'Promise',
  dispute: 'Dispute',
  wrong_number: 'Wrong number',
  difference: 'Different on a call',
  unreachable: "Couldn't call",
};

/** What a list page shows. `range: 'custom'` uses `from` and `to`. */
export interface ListView {
  range: ListRange | 'custom';
  from: string;
  to: string;
  q: string;
  filters: Record<string, string>;
  source: ItemSourceKind | '';
  show: ListShow | 'all';
  sort: string;
  page: number;
}

export function initialView(hasDate: boolean): ListView {
  return { range: hasDate ? 'this_month' : 'all', from: '', to: '', q: '', filters: {}, source: '', show: 'all', sort: '', page: 1 };
}

/** The API query for what the page shows. */
export function listParams(v: ListView): ListQueryParams {
  const filters = Object.fromEntries(Object.entries(v.filters).filter(([, x]) => x));
  const q = v.q.trim();
  return {
    ...(v.range === 'custom' ? (v.from && v.to ? { from: v.from, to: v.to } : { range: 'all' as const }) : { range: v.range }),
    ...(q ? { q } : {}),
    ...(v.source ? { source: v.source } : {}),
    ...(v.show !== 'all' ? { show: v.show } : {}),
    ...(v.sort ? { sort: v.sort } : {}),
    ...(v.page > 1 ? { page: v.page } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reference with no title to show: the words as typed, or "a removed item" for an id (ids are never shown). */
export function referenceText(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  return typeof v === 'string' && UUID.test(v) ? 'a removed item' : String(v);
}

/** "On · 3 to call about now · 1 waiting for you". */
export function followUpLine(f: FollowUpInfo): string {
  const parts = [f.enabled ? 'On' : 'Off', f.due ? `${f.due} to call about now` : 'nothing due now'];
  if (f.waiting) parts.push(`${f.waiting} waiting for you`);
  if (f.stopped) parts.push(`${f.stopped} stopped`);
  return parts.join(' · ');
}

/** "Fri, 16 Oct" for a YYYY-MM-DD day. */
export function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A record value as a list shows it: rupees for money, dates and times in
 * words (never raw ISO text), Yes/No, and a dash for nothing.
 * `timeZone` is for tests; a screen uses the viewer's own.
 */
export function recordCell(field: EntityField | undefined, value: unknown, timeZone?: string): string {
  if (field?.type === 'money' && typeof value === 'number') return formatInr(value);
  if ((field?.type === 'date' || field?.type === 'datetime') && typeof value === 'string') {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return value;
    // A plain date is a calendar day: read it in UTC so no time zone moves it.
    if (field.type === 'date' || DATE.test(value)) {
      return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: DATE.test(value) ? 'UTC' : timeZone });
    }
    return at.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone });
  }
  return formatValue(value);
}

/** A list item's field in words: a reference by the title of what it points at, anything else through `recordCell`. */
export function itemCell(field: EntityField, item: Pick<ListItem, 'data' | 'titles'>, timeZone?: string): string {
  const value = item.data[field.name];
  return field.type === 'reference' ? (item.titles[field.name] ?? referenceText(value)) : recordCell(field, value, timeZone);
}

/** A total or a sum: rupees for money, Indian digit groups otherwise. */
export function amountText(field: EntityField | undefined, n: number): string {
  return field?.type === 'money' ? formatInr(n) : n.toLocaleString('en-IN');
}

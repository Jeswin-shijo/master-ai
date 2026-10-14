import type { ItemSourceKind, ListQueryParams, ListRange, ListShow } from '@onehuman/schemas';

export const RANGE_LABELS: Record<ListRange, string> = {
  today: 'Today',
  this_week: 'This week',
  this_month: 'This month',
  last_month: 'Last month',
  all: 'All time',
};
export const SHOW_LABELS: Record<ListShow | 'all', string> = { all: 'All', problems: 'Has problems', not_checked: 'Not checked', checked: 'Checked' };
export const SOURCE_LABELS: Record<ItemSourceKind, string> = { manual: 'By hand', call: 'Phone call', agent: 'AI agent', sample: 'Sample data' };

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

/** Clicking a column header: ascending, then descending, then back to the list's own order. */
export function nextSort(current: string, field: string): string {
  if (current === `${field}:asc`) return `${field}:desc`;
  if (current === `${field}:desc`) return '';
  return `${field}:asc`;
}

export function sortMark(current: string, field: string): string {
  return current === `${field}:asc` ? ' ↑' : current === `${field}:desc` ? ' ↓' : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reference with no title to show: the words as typed, or "a removed item" for an id (ids are never shown). */
export function referenceText(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  return typeof v === 'string' && UUID.test(v) ? 'a removed item' : String(v);
}

/** "bills-2026-10-14.csv", dated in the viewer's own time. */
export function csvFileName(label: string, now = new Date()): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
  const day = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return `${slug}-${day}.csv`;
}

/** Excel reads a CSV as UTF-8 (₹, Indian names) only with a byte order mark, which fetch's text() drops. */
export function withBom(text: string): string {
  return text.startsWith('﻿') ? text : `﻿${text}`;
}

/** Hands the viewer a file made in the page; nothing goes in a URL but a local blob. */
export function saveText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([withBom(text)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

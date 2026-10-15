import { BadRequestException } from '@nestjs/common';
import type { EntityField } from '@onehuman/schemas';
import type { ResolvedRegister } from '@onehuman/agent-kit';
import { isDay } from './format';

export const PAGE_SIZE = 50;
export const RANGES = ['today', 'this_week', 'this_month', 'last_month', 'all'] as const;
export type RangeName = (typeof RANGES)[number];
const SOURCES = ['manual', 'call', 'agent', 'sample'] as const;
const SHOW = ['problems', 'not_checked', 'checked', 'new_notes'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ParsedListQuery {
  /** Inclusive India-time calendar days; null means no date limit. */
  dates: { from: string; to: string } | null;
  q: string | null;
  filters: { field: EntityField; value: string }[];
  source: (typeof SOURCES)[number] | null;
  show: (typeof SHOW)[number] | null;
  sort: { field: EntityField | null; dir: 'asc' | 'desc' };
  page: number;
}

/** The first and last day of a named range around `today` (YYYY-MM-DD, India time). Weeks start on Monday. */
export function rangeDays(range: RangeName, today: string): { from: string; to: string } | null {
  const d = new Date(`${today}T00:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case 'this_week': {
      const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
      return { from: iso(monday), to: iso(new Date(monday.getTime() + 6 * 86_400_000)) };
    }
    case 'this_month':
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
    case 'last_month':
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case 'all':
      return null;
  }
}

/**
 * Reads a list page's query string. Only this list's own fields and the known
 * options get through; everything else is refused, so nothing unchecked reaches SQL.
 */
export function parseListQuery(raw: Record<string, unknown>, reg: ResolvedRegister, today: string): ParsedListQuery {
  const one = (k: string) => {
    const v = raw[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const bad = (message: string) => new BadRequestException(message);

  let dates: ParsedListQuery['dates'];
  const from = one('from');
  const to = one('to');
  if (from || to) {
    const realDay = (d: string) => DAY.test(d) && isDay(d);
    if (!from || !to || !realDay(from) || !realDay(to) || from > to) throw bad('Give both dates as YYYY-MM-DD, the first on or before the second.');
    dates = { from, to };
  } else {
    const range = one('range') ?? (reg.dateField ? 'this_month' : 'all');
    if (!(RANGES as readonly string[]).includes(range)) throw bad(`Unknown range "${range}".`);
    dates = rangeDays(range as RangeName, today);
  }
  if (!reg.dateField) dates = null;

  const filters: ParsedListQuery['filters'] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('f.')) continue;
    const field = reg.filters.find((f) => f.name === key.slice(2));
    if (!field) throw bad(`"${key.slice(2)}" is not a filter of this list.`);
    if (typeof value !== 'string' || value === '') continue;
    if (field.type === 'enum' && !field.options?.includes(value)) throw bad(`"${value}" is not a choice for ${field.label}.`);
    if (field.type === 'boolean' && value !== 'true' && value !== 'false') throw bad(`${field.label} is true or false.`);
    filters.push({ field, value });
  }

  const source = one('source');
  if (source && !(SOURCES as readonly string[]).includes(source)) throw bad(`Unknown source "${source}".`);
  const show = one('show');
  if (show && !(SHOW as readonly string[]).includes(show)) throw bad(`Unknown show "${show}".`);

  let sort = reg.sort;
  const s = one('sort');
  if (s) {
    const [name, dir = 'asc'] = s.split(':');
    const field = reg.entity.fields.find((f) => f.name === name);
    if (!field || (dir !== 'asc' && dir !== 'desc')) throw bad(`Can't sort by "${s}".`);
    sort = { field, dir };
  }

  return {
    dates,
    q: one('q')?.slice(0, 200) ?? null,
    filters,
    source: (source as ParsedListQuery['source']) ?? null,
    show: (show as ParsedListQuery['show']) ?? null,
    sort,
    page: Math.max(1, Number.parseInt(one('page') ?? '1', 10) || 1),
  };
}

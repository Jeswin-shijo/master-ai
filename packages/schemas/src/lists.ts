import type { EntityDef } from './pack';

export type ItemSourceKind = 'manual' | 'call' | 'agent' | 'sample';
export type ListRange = 'today' | 'this_week' | 'this_month' | 'last_month' | 'all';
export type ListShow = 'problems' | 'not_checked' | 'checked';

/** What a list is: its record type and how it is shown. Field names refer to `entity.fields`. */
export interface ListMeta {
  id: string;
  label: string;
  main: boolean;
  explicit: boolean;
  entity: EntityDef;
  columns: string[];
  filters: string[];
  dateField: string | null;
  totals: string[];
  sort: { field: string | null; dir: 'asc' | 'desc' };
}

export interface ListCard {
  count: number;
  countLabel: string;
  sum: number | null;
  sumField: string | null;
  sumLabel: string | null;
  /** Items with a problem nobody has accepted. */
  problems: number;
  notChecked: number;
}

export interface ListSummary extends ListMeta {
  card: ListCard;
}

export interface ListsOverview {
  lists: ListSummary[];
  /** Sample items still in the company's lists. */
  samples: number;
}

export interface ListProblem {
  key: string;
  message: string;
  /** Someone checked the item knowing about this problem. */
  acknowledged: boolean;
  /** For a duplicate: the other item. */
  relatedId?: string;
}

export interface ItemSource {
  kind: ItemSourceKind;
  label: string;
  caseId?: string;
  caseCode?: string;
  callId?: string;
}

export interface ListItem {
  id: string;
  title: string;
  data: Record<string, unknown>;
  /** Titles of the items its reference fields point at, by field name. */
  titles: Record<string, string>;
  source: ItemSource;
  updated: { via: 'manual' | 'call' | 'agent' | 'system' | null; by: string | null; at: string };
  problems: ListProblem[];
  checked: { by: string; at: string; note: string | null } | null;
  createdAt: string;
}

export interface ListPage {
  list: ListMeta;
  items: ListItem[];
  total: number;
  /** Sums of the list's total fields over every matching item. */
  totals: Record<string, number>;
  /** Matching items left out only because they have no date, while a date range is on. */
  undated: number;
  page: number;
  pageSize: number;
}

export interface ListHistoryEntry {
  at: string;
  kind: 'created' | 'updated' | 'checked';
  who: string;
  changes: { field: string; label: string; from: string; to: string }[];
  note: string | null;
}

export interface ListItemDetail {
  list: ListMeta;
  item: ListItem;
  history: ListHistoryEntry[];
}

/** A list page's query: a named range or a from/to pair, filters as field → value. */
export interface ListQueryParams {
  range?: ListRange;
  from?: string;
  to?: string;
  q?: string;
  source?: ItemSourceKind;
  show?: ListShow;
  sort?: string;
  page?: number;
  filters?: Record<string, string>;
}

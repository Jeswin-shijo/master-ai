import { z } from 'zod';
import type { EntityDef } from './pack';

const note = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => v || undefined);

export const UpdateListItemInputSchema = z.object({ data: z.record(z.string(), z.unknown()), note });
export type UpdateListItemInput = z.input<typeof UpdateListItemInputSchema>;

export const CheckListItemInputSchema = z.object({ note });
export type CheckListItemInput = z.input<typeof CheckListItemInputSchema>;

export const BulkCheckInputSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) });

export const RemoveListItemInputSchema = z.object({ reason: z.string().trim().min(3, 'Say why it is being removed').max(500) });

export type ItemSourceKind = 'manual' | 'call' | 'agent' | 'sample';
export type ListRange = 'today' | 'this_week' | 'this_month' | 'last_month' | 'all';
export type ListShow = 'problems' | 'not_checked' | 'checked' | 'new_notes';

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
  /** Items with a note from a call the head hasn't seen. */
  newNotes: number;
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
  /** Notes from calls not yet applied or seen. */
  newNotes: number;
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

/** What a call left on an item: what was said (as said), and what it proposes. */
export type NoteKind = 'said' | 'promise' | 'dispute' | 'wrong_number' | 'difference' | 'unreachable';

export interface ListNote {
  id: string;
  kind: NoteKind;
  /** The party's or team member's name. */
  speaker: string;
  said: string;
  /** Changes it proposes, in words. Apply sets them. */
  proposed: { field: string; label: string; value: string }[];
  /** A promise's date, YYYY-MM-DD. */
  promiseOn: string | null;
  status: 'new' | 'applied' | 'dismissed';
  /** Who applied or dismissed it. */
  decidedBy: string | null;
  callId: string | null;
  at: string;
  /** Worked out on the server for the viewer: the note says a follow-up stopped, it is still stopped, and the viewer may start it again. */
  canCallAgain: boolean;
}

export interface ListItemDetail {
  list: ListMeta;
  item: ListItem;
  history: ListHistoryEntry[];
  notes: ListNote[];
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

/** One of a list's follow-up calls, with its switch and what it is doing. */
export interface FollowUpInfo {
  /** `<list>.<follow-up>`. */
  key: string;
  id: string;
  label: string;
  who: 'party' | 'staff';
  enabled: boolean;
  changedBy: string | null;
  changedAt: string | null;
  /** Only the owner switches calls to outside parties. */
  canSwitch: boolean;
  /** Items it would call about now. */
  due: number;
  /** Items waiting for you to act on what was said. */
  waiting: number;
  /** Items it has stopped calling about. */
  stopped: number;
}

export const SwitchFollowUpInputSchema = z.object({ enabled: z.boolean() });

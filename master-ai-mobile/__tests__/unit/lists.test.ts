import { describe, expect, it } from 'vitest';
import type { EntityDef, ListItem, ListMeta, ListNote, ListPage, ListSummary } from '@onehuman/schemas';
import {
  canSeeLists,
  cardCount,
  cardMarks,
  checkButton,
  checkedLine,
  historyWords,
  NEEDS_CONNECTION,
  newNotesTotal,
  NOTE_ACTION_LABELS,
  noSignalLine,
  noteActions,
  noteState,
  pageTotals,
  rowSummary,
  undatedLine,
} from '../../src/lib/lists';

const entity = {
  name: 'Bill',
  label: 'Bill',
  title_field: 'billNo',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'party', label: 'Party', type: 'reference', ref: 'Party', required: false },
    { name: 'total', label: 'Total', type: 'money', required: false },
    { name: 'dueDate', label: 'Due date', type: 'date', required: false },
    { name: 'paymentStatus', label: 'Payment', type: 'enum', options: ['unpaid', 'paid'], required: false },
  ],
} as EntityDef;
const list: ListMeta = {
  id: 'bills',
  label: 'Bills',
  main: true,
  explicit: true,
  entity,
  columns: ['billNo', 'party', 'total', 'paymentStatus'],
  filters: [],
  dateField: 'dueDate',
  totals: ['total'],
  sort: { field: 'dueDate', dir: 'asc' },
};
const card = (over: Partial<ListSummary['card']> = {}): ListSummary => ({
  ...list,
  card: { count: 12, countLabel: 'this month', sum: 482600, sumField: 'total', sumLabel: 'to collect', problems: 0, notChecked: 0, newNotes: 0, ...over },
});
const PARTY = '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11';
const item = (over: Partial<ListItem> = {}): ListItem => ({
  id: 'i1',
  title: 'S-1042',
  data: { billNo: 'S-1042', party: PARTY, total: 48260, paymentStatus: 'unpaid' },
  titles: { party: 'Sri Ganesh Traders' },
  source: { kind: 'manual', label: 'By hand' },
  updated: { via: null, by: null, at: '2026-10-16T05:00:00Z' },
  problems: [],
  checked: null,
  newNotes: 0,
  createdAt: '2026-10-16T05:00:00Z',
  ...over,
});
const page = (over: Partial<ListPage> = {}): ListPage => ({ list, items: [], total: 48, totals: { total: 1240000 }, undated: 0, page: 1, pageSize: 50, ...over });
const note = (over: Partial<ListNote> = {}): ListNote => ({
  id: 'n1',
  kind: 'said',
  speaker: 'Sri Ganesh Traders',
  said: "It's already paid",
  proposed: [{ field: 'paymentStatus', label: 'Payment', value: 'paid' }],
  promiseOn: null,
  status: 'new',
  decidedBy: null,
  callId: 'c1',
  at: '2026-10-16T05:00:00Z',
  canCallAgain: false,
  ...over,
});

describe('who sees the Lists tab', () => {
  it('is the owner and admins only', () => {
    expect([canSeeLists('owner'), canSeeLists('admin'), canSeeLists('member'), canSeeLists(undefined), canSeeLists(null)]).toEqual([true, true, false, false, false]);
  });
});

describe('the Lists tab', () => {
  it('badges the new notes from calls over every list', () => {
    expect(newNotesTotal({ lists: [card({ newNotes: 2 }), card({ newNotes: 0 }), card({ newNotes: 1 })], samples: 0 })).toBe(3);
    expect(newNotesTotal(undefined)).toBe(0);
  });

  it("shows each card's count and sum in words", () => {
    expect(cardCount(card())).toBe('12 this month · ₹4,82,600 to collect');
    expect(cardCount(card({ sum: null, sumField: null, sumLabel: null, countLabel: 'in all' }))).toBe('12 in all');
  });

  it('marks only what needs looking at', () => {
    expect(cardMarks(card({ problems: 3, notChecked: 5, newNotes: 2 }))).toBe('3 with problems · 5 not checked · 2 new from calls');
    expect(cardMarks(card({ notChecked: 1 }))).toBe('1 not checked');
    expect(cardMarks(card())).toBeNull();
  });
});

describe('a list', () => {
  it("totals what matches, as the web's list footer does", () => {
    expect(pageTotals(page())).toBe('48 bills · Total ₹12,40,000');
    expect(pageTotals(page({ total: 1, totals: { total: 500 } }))).toBe('1 bill · Total ₹500');
  });

  it('keeps acronyms in the label as written', () => {
    const emis = { ...list, label: 'EMIs and repayments' };
    expect(pageTotals(page({ list: emis }))).toBe('48 EMIs and repayments · Total ₹12,40,000');
    const kyc = { ...list, entity: { ...entity, fields: entity.fields.map((f) => (f.name === 'dueDate' ? { ...f, label: 'KYC date' } : f)) } } as ListMeta;
    expect(undatedLine(page({ list: kyc, undated: 1 }))).toBe("1 item has no KYC date and isn't shown.");
  });

  it('reads a missing total as 0', () => {
    expect(pageTotals(page({ totals: {} }))).toBe('48 bills · Total ₹0');
  });

  it('says nothing about undated items on a list with no date field', () => {
    expect(undatedLine(page({ list: { ...list, dateField: null }, undated: 3 }))).toBeNull();
  });

  it('takes the first text field as the title when the entity names none', () => {
    const untitled = { ...list, entity: { ...entity, title_field: undefined } } as ListMeta;
    expect(rowSummary(untitled, item())).toBe('Sri Ganesh Traders · ₹48,260');
  });

  it("sums up a row with the list's next two columns, in words", () => {
    expect(rowSummary(list, item())).toBe('Sri Ganesh Traders · ₹48,260');
  });

  it('never shows the id a reference holds, and leaves out empty values', () => {
    expect(rowSummary(list, item({ titles: {} }))).toBe('a removed item · ₹48,260');
    expect(rowSummary(list, item({ data: { billNo: 'S-1', total: 100 }, titles: {} }))).toBe('₹100');
  });

  it('says how many items a date range leaves out for want of a date', () => {
    expect(undatedLine(page({ undated: 2 }))).toBe("2 items have no due date and aren't shown.");
    expect(undatedLine(page({ undated: 1 }))).toBe("1 item has no due date and isn't shown.");
    expect(undatedLine(page())).toBeNull();
  });

  it('says what a bulk check did, and why items with problems were left', () => {
    expect(checkedLine({ checked: 4, skipped: 0 })).toBe('4 marked checked.');
    expect(checkedLine({ checked: 3, skipped: 1 })).toBe('3 marked checked. 1 has problems: open it to check it with a note.');
    expect(checkedLine({ checked: 0, skipped: 2 })).toBe('0 marked checked. 2 have problems: open each to check it with a note.');
  });
});

describe('an item', () => {
  it('asks for a note to check it while a problem is open, and offers nothing when it is checked already', () => {
    const open = [{ key: 'overdue', message: 'Overdue by 3 days', acknowledged: false }];
    expect(checkButton(item())).toEqual({ label: 'Mark checked', needsNote: false });
    expect(checkButton(item({ problems: open }))).toEqual({ label: 'Mark checked anyway', needsNote: true });
    expect(checkButton(item({ checked: { by: 'Asha Owner', at: '2026-10-16T05:00:00Z', note: null } }))).toBeNull();
    expect(checkButton(item({ problems: [{ ...open[0]!, acknowledged: true }], checked: { by: 'Asha Owner', at: '2026-10-16T05:00:00Z', note: 'Fine' } }))).toBeNull();
  });

  it("offers a note's buttons as the web does", () => {
    expect(noteActions(note())).toEqual(['apply', 'dismiss']);
    expect(noteActions(note({ proposed: [] }))).toEqual(['seen']);
    expect(noteActions(note({ kind: 'wrong_number', proposed: [], canCallAgain: true }))).toEqual(['seen', 'call-again']);
    expect(noteActions(note({ status: 'applied', decidedBy: 'Asha Owner' }))).toEqual([]);
    expect(noteActions(note({ status: 'dismissed', kind: 'unreachable', proposed: [], canCallAgain: true }))).toEqual(['call-again']);
  });

  it("says where a note stands", () => {
    expect(noteState(note())).toBe('New from a call');
    expect(noteState(note({ status: 'applied', decidedBy: 'Asha Owner' }))).toBe('Applied by Asha Owner');
    expect(noteState(note({ status: 'dismissed', decidedBy: null }))).toBe('Seen by someone');
  });

  it('says who saw a dismissed note', () => {
    expect(noteState(note({ status: 'dismissed', decidedBy: 'Asha Owner' }))).toBe('Seen by Asha Owner');
  });

  it('words the note buttons', () => {
    expect(NOTE_ACTION_LABELS).toEqual({ apply: 'Apply', dismiss: 'Dismiss', seen: 'Seen', 'call-again': 'Call again' });
    expect(NEEDS_CONNECTION).toBe('Needs a connection');
  });

  it('tells its history in words', () => {
    const e = { at: '2026-10-16T05:00:00Z', who: 'Asha Owner', changes: [], note: null };
    expect([historyWords({ ...e, kind: 'created' }), historyWords({ ...e, kind: 'updated' }), historyWords({ ...e, kind: 'checked' })]).toEqual([
      'Asha Owner added it',
      'Asha Owner changed it',
      'Asha Owner checked it',
    ]);
  });
});

describe('no signal', () => {
  it('says what the screen shows and when it was loaded', () => {
    expect(noSignalLine(true, Date.UTC(2026, 9, 16, 5, 12), 'Asia/Kolkata')).toMatch(/^No signal\. Showing what was loaded at 10:42\s?am\.$/i);
    expect(noSignalLine(true, 0)).toBe('No signal. Pull down to try again once you are back online.');
    expect(noSignalLine(false, Date.UTC(2026, 9, 16, 5, 12))).toBeNull();
  });
});

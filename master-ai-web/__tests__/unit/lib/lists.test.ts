import { describe, expect, it } from 'vitest';
import { csvFileName, dayLabel, followUpLine, NOTE_LABELS, initialView, listParams, nextSort, referenceText, withBom } from '../../../src/lib/lists';

describe('the list page state', () => {
  it('opens a dated list on this month, and an undated one on everything', () => {
    expect(listParams(initialView(true))).toEqual({ range: 'this_month' });
    expect(listParams(initialView(false))).toEqual({ range: 'all' });
  });

  it('sends what is set, and a custom range only when both days are picked', () => {
    const v = { ...initialView(true), range: 'custom' as const, from: '2026-09-01', to: '2026-09-30', q: '  S-10 ', filters: { billType: 'credit note', party: '' }, show: 'problems' as const, page: 2 };
    expect(listParams(v)).toEqual({ from: '2026-09-01', to: '2026-09-30', q: 'S-10', filters: { billType: 'credit note' }, show: 'problems', page: 2 });
    expect(listParams({ ...v, to: '' })).toMatchObject({ range: 'all' });
  });

  it('cycles a column through ascending, descending and off', () => {
    expect(nextSort('', 'total')).toBe('total:asc');
    expect(nextSort('total:asc', 'total')).toBe('total:desc');
    expect(nextSort('total:desc', 'total')).toBe('');
    expect(nextSort('total:desc', 'billNo')).toBe('billNo:asc');
  });
});

describe('the download', () => {
  it('names the file after the list and the day', () => {
    expect(csvFileName('Contractor bills', new Date(2026, 9, 14, 12))).toBe('contractor-bills-2026-10-14.csv');
  });

  it('puts back the byte order mark Excel needs, once', () => {
    expect(withBom('a,b')).toBe('﻿a,b');
    expect(withBom('﻿a,b')).toBe('﻿a,b');
  });
});

describe('referenceText', () => {
  it('never shows an id', () => {
    expect(referenceText('0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11')).toBe('a removed item');
    expect(referenceText('Ganesh traders')).toBe('Ganesh traders');
    expect(referenceText(null)).toBe('—');
  });
});

describe('follow-ups and call notes in words', () => {
  const f = { key: 'bills.unpaid-bills', id: 'unpaid-bills', label: 'Unpaid bills → the party', who: 'party' as const, enabled: true, changedBy: 'Asha', changedAt: '2026-10-15T05:00:00Z', canSwitch: true, due: 3, waiting: 1, stopped: 0 };

  it("says what a follow-up is doing", () => {
    expect(followUpLine(f)).toBe('On · 3 to call about now · 1 waiting for you');
    expect(followUpLine({ ...f, enabled: false, due: 0, waiting: 0, stopped: 2 })).toBe('Off · nothing due now · 2 stopped');
  });

  it('names every kind of note', () => {
    expect(NOTE_LABELS).toEqual({
      said: 'Said on a call',
      promise: 'Promise',
      dispute: 'Dispute',
      wrong_number: 'Wrong number',
      difference: 'Different on a call',
      unreachable: "Couldn't call",
    });
  });

  it('shows a promised day the way people say it', () => {
    expect(dayLabel('2026-10-16')).toBe('Fri, 16 Oct');
  });
});

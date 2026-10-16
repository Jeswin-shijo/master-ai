import { describe, expect, it } from 'vitest';
import type { EntityField, ListItem } from '@onehuman/schemas';
import { amountText, ApiError, createClient, dayLabel, followUpLine, initialView, itemCell, listParams, listQuery, NOTE_LABELS, recordCell, referenceText } from '../src/index';

describe('listQuery', () => {
  it('writes only what is set, with filters as f.<field>', () => {
    expect(listQuery({ range: 'all', q: '50% off', page: 2, filters: { billType: 'sales invoice', party: '' } })).toBe('?range=all&q=50%25%20off&page=2&f.billType=sales%20invoice');
    expect(listQuery({ page: 1 })).toBe('');
    expect(listQuery()).toBe('');
  });
});

describe('api.lists', () => {
  function client(reply: (url: string) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = createClient({
      baseUrl: 'http://api.test',
      getToken: () => 'token-1',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return reply(String(url));
      },
    });
    return { api, calls };
  }

  it('downloads CSV as text with the session header, never a token in the URL, and without the page', async () => {
    const { api, calls } = client(() => new Response('﻿Bill no.,Total\r\nS-1,100\r\n', { status: 200 }));
    expect((await api.lists.exportCsv('bills', { range: 'all', page: 3 })).csv).toBe('Bill no.,Total\r\nS-1,100\r\n');
    expect(calls[0]!.url).toBe('http://api.test/lists/bills/export?range=all');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('says when the download was cut at the limit, and when it was not', async () => {
    const cut = client(() => new Response('a\r\n', { status: 200, headers: { 'X-Export-Truncated': '1', 'X-Export-Limit': '10000' } }));
    expect(await cut.api.lists.exportCsv('bills')).toEqual({ csv: 'a\r\n', truncated: true, limit: 10000 });
    const whole = client(() => new Response('a\r\n', { status: 200 }));
    expect(await whole.api.lists.exportCsv('bills')).toEqual({ csv: 'a\r\n', truncated: false, limit: null });
  });

  it('turns a refused download into an ApiError with the reason', async () => {
    const { api } = client(() => new Response(JSON.stringify({ message: 'Only the owner and admins can do this' }), { status: 403 }));
    await expect(api.lists.exportCsv('bills')).rejects.toEqual(expect.objectContaining({ status: 403, message: 'Only the owner and admins can do this' }));
    await expect(api.lists.exportCsv('bills')).rejects.toBeInstanceOf(ApiError);
  });

  it('sends a removal reason in a POST body', async () => {
    const { api, calls } = client(() => new Response('{"removed":true}', { status: 200 }));
    await api.lists.remove('bills', 'item-1', 'Entered twice');
    expect(calls[0]).toMatchObject({ url: 'http://api.test/lists/bills/items/item-1/remove', init: { method: 'POST', body: '{"reason":"Entered twice"}' } });
  });
});

const field = (type: EntityField['type'], name = 'f') => ({ name, label: 'F', type }) as EntityField;

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

  it('says what a follow-up is doing', () => {
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

describe('recordCell (a record value in words)', () => {
  it('writes money in rupees', () => {
    expect(recordCell(field('money'), 25000)).toBe('₹25,000');
  });

  it('writes dates and times the way people read them, never as raw ISO text', () => {
    expect(recordCell(field('date'), '2026-10-14')).toBe('14 Oct 2026');
    const at = recordCell(field('datetime'), '2026-10-14T04:30:00Z', 'Asia/Kolkata');
    expect(at).toMatch(/^14 Oct 2026, 10:00\s?am$/i);
    expect(at).not.toContain('T04:30');
  });

  it('says Yes or No, and a dash for nothing', () => {
    expect(recordCell(field('boolean'), true)).toBe('Yes');
    expect(recordCell(field('boolean'), false)).toBe('No');
    expect(recordCell(field('string'), '')).toBe('—');
    expect(recordCell(undefined, null)).toBe('—');
  });

  it('leaves text, enum values, numbers and anything it cannot read as a date as they are', () => {
    expect(recordCell(field('string'), 'Conveyor 3B')).toBe('Conveyor 3B');
    expect(recordCell(field('enum'), 'part-paid')).toBe('part-paid');
    expect(recordCell(field('integer'), 42)).toBe('42');
    expect(recordCell(field('date'), 'next Tuesday')).toBe('next Tuesday');
  });
});

describe('itemCell (a list item field in words)', () => {
  const item = (data: Record<string, unknown>, titles: Record<string, string> = {}): Pick<ListItem, 'data' | 'titles'> => ({ data, titles });

  it('shows a reference by the title of what it points at', () => {
    expect(itemCell(field('reference', 'party'), item({ party: '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11' }, { party: 'Sri Ganesh Traders' }))).toBe('Sri Ganesh Traders');
  });

  it('shows a reference with no title as typed, or as "a removed item", never as an id', () => {
    expect(itemCell(field('reference', 'party'), item({ party: '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11' }))).toBe('a removed item');
    expect(itemCell(field('reference', 'party'), item({ party: 'Nobody Known' }))).toBe('Nobody Known');
    expect(itemCell(field('reference', 'party'), item({}))).toBe('—');
  });

  it('reads every other field through recordCell', () => {
    expect(itemCell(field('money', 'total'), item({ total: 48260 }))).toBe('₹48,260');
  });
});

describe('amountText (a total in words)', () => {
  it('writes money in rupees and other numbers in Indian digit groups', () => {
    expect(amountText(field('money'), 1240000)).toBe('₹12,40,000');
    expect(amountText(field('integer'), 1240000)).toBe('12,40,000');
    expect(amountText(undefined, 5)).toBe('5');
  });
});

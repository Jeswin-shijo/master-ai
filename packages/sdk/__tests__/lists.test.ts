import { describe, expect, it } from 'vitest';
import { ApiError, createClient, listQuery } from '../src/index';

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

import { describe, expect, it } from 'vitest';
import type { EntityDef } from '@onehuman/schemas';
import { partyAlert } from '../../../src/follow-ups/alerts';

const Bill = {
  name: 'Bill',
  label: 'Bill',
  title_field: 'billNo',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'party', label: 'Party', type: 'reference', ref: 'Party', required: false },
    { name: 'paymentStatus', label: 'Payment', type: 'enum', options: ['unpaid', 'part-paid', 'paid'], required: false },
    { name: 'paymentRef', label: 'Payment ref', type: 'string', required: false },
    { name: 'status', label: 'Status', type: 'enum', options: ['open', 'delivered'], required: false },
  ],
} as EntityDef;
const PARTY = '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11';
const ITEM = '7f0c2a10-3b7e-4d5e-9c11-5a2b3c4d5e6f';
const about = (over: Partial<Parameters<typeof partyAlert>[1]> = {}) => ({
  listId: 'bills',
  itemId: ITEM,
  entity: Bill,
  data: { billNo: 'S-1042', party: PARTY } as Record<string, unknown>,
  contactName: 'Sri Ganesh Traders' as string | null,
  ...over,
});
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/i;

describe('the push for a party answer that needs the head', () => {
  it('says a bill is paid, in their words, and opens the item', () => {
    expect(partyAlert({ kind: 'settled', said: "It's already paid. UTR 445566", proposed: { paymentStatus: 'paid', paymentRef: '445566' } }, about())).toEqual({
      title: 'Sri Ganesh Traders says bill S-1042 is paid',
      body: '"It\'s already paid. UTR 445566" Tap to apply or dismiss.',
      data: { listId: 'bills', itemId: ITEM },
    });
  });

  it('names what was settled, or says settled when there is nothing to apply', () => {
    expect(partyAlert({ kind: 'settled', said: 'Goods reached', proposed: { status: 'delivered' } }, about())?.title).toBe('Sri Ganesh Traders says bill S-1042 is delivered');
    expect(partyAlert({ kind: 'settled', said: 'All cleared', proposed: {} }, about())).toMatchObject({ title: 'Sri Ganesh Traders says bill S-1042 is settled', body: '"All cleared"' });
  });

  it('says what the proposed enum value is, not that it is settled, for a part payment', () => {
    expect(partyAlert({ kind: 'settled', said: 'Sent half', proposed: { paymentStatus: 'part-paid' } }, about())?.title).toBe('Sri Ganesh Traders says bill S-1042 is part paid');
    expect(partyAlert({ kind: 'settled', said: 'Ref 445566', proposed: { paymentRef: '445566' } }, about())?.title).toBe('Sri Ganesh Traders says bill S-1042 is settled');
  });

  it('says a dispute and a wrong number', () => {
    expect(partyAlert({ kind: 'dispute', said: 'The goods never came' }, about())).toMatchObject({ title: 'Sri Ganesh Traders disputes bill S-1042', body: '"The goods never came"' });
    expect(partyAlert({ kind: 'wrong_number', said: 'Wrong number' }, about())).toMatchObject({
      title: 'Wrong number for Sri Ganesh Traders',
      body: "The number called about bill S-1042 isn't theirs. Correct it on the web, then tap Call again on the note.",
    });
  });

  it('sends nothing for answers that need no decision', () => {
    expect(partyAlert({ kind: 'promise', said: 'Friday', promiseOn: '2026-10-16' }, about())).toBeNull();
    expect(partyAlert({ kind: 'do_not_call', said: "Don't call again" }, about())).toBeNull();
    expect(partyAlert({ kind: 'status', said: 'Done', patch: { status: 'done' } }, about())).toBeNull();
    expect(partyAlert({ kind: 'said', said: 'Call my brother' }, about())).toBeNull();
  });

  it('reads well without a contact name or an item title, and never shows an id', () => {
    const plain = about({ contactName: '  ', data: { party: PARTY } });
    const settled = partyAlert({ kind: 'settled', said: 'Paid', proposed: { paymentStatus: 'paid' } }, plain)!;
    expect(settled.title).toBe('Your contact says the bill is paid');
    expect(partyAlert({ kind: 'wrong_number', said: 'Wrong number' }, about({ contactName: null }))!.title).toBe('Wrong number for your contact');
    expect(`${settled.title} ${settled.body}`).not.toMatch(UUID);
  });

  it('keeps a long answer short enough for a phone', () => {
    const said = `It was paid ${'last week through the bank '.repeat(10)}`;
    const { body } = partyAlert({ kind: 'dispute', said }, about())!;
    expect(body.length).toBeLessThanOrEqual(122);
    expect(body).toMatch(/…"$/);
  });
});

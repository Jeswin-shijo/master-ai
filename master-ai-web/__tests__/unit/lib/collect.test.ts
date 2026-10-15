import { describe, expect, it } from 'vitest';
import type { EntityDef, Routine } from '@onehuman/schemas';
import { collectDefaults, collectedText } from '../../../src/lib/collect';

const Bill: EntityDef = {
  name: 'Bill',
  label: 'Bill',
  fields: [
    { name: 'billDate', label: 'Bill date', type: 'date', required: false },
    { name: 'raisedAt', label: 'Raised at', type: 'datetime', required: false },
    { name: 'paymentStatus', label: 'Payment', type: 'enum', options: ['unpaid', 'paid'], required: false },
  ],
};

describe('collection routines in the app', () => {
  it("fills a routine's defaults: today in India, now, or the fixed value", () => {
    const now = new Date('2026-10-15T20:00:00Z'); // already the 16th in India
    expect(collectDefaults({ billDate: 'today', raisedAt: 'now', paymentStatus: 'unpaid' }, Bill, now)).toEqual({
      billDate: '2026-10-16',
      raisedAt: '2026-10-15T20:00:00.000Z',
      paymentStatus: 'unpaid',
    });
  });

  it('says what a day of collecting added', () => {
    const routine = { collect: { listLabel: 'Bills', itemLabel: 'bill' } } as Routine;
    expect(collectedText(routine, { items: 1, differences: 0 })).toBe('1 bill added');
    expect(collectedText(routine, { items: 3, differences: 2 })).toBe('3 bills added · 2 differences noted');
    expect(collectedText(routine, {})).toBe('No bills added');
  });
});

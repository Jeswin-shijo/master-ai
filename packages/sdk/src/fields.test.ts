import { describe, expect, it } from 'vitest';
import { readableFields } from './fields';

describe('readableFields', () => {
  it('shows a refund the way a person reads it, without ids or currency codes', () => {
    expect(
      readableFields({ amount: 12000, currency: 'INR', recipient: 'Asha Menon', reason: 'Trip cancelled', recordRef: 'fee2aa2f-e558-43e3-a123-a0c532bb301d' }),
    ).toEqual([
      { label: 'Amount', value: '₹12,000' },
      { label: 'To', value: 'Asha Menon' },
      { label: 'Reason', value: 'Trip cancelled' },
    ]);
  });

  it('flattens changes and formats dates in India time', () => {
    const fields = readableFields({ entity: 'Booking', id: 'fee2aa2f-e558-43e3-a123-a0c532bb301d', patch: { status: 'cancelled' }, start: '2026-10-13T04:30:00.000Z' });
    expect(fields.slice(0, 2)).toEqual([
      { label: 'Record type', value: 'Booking' },
      { label: 'Changes', value: 'Status: cancelled' },
    ]);
    // 10:00 IST; exact punctuation depends on the ICU version.
    expect(fields[2]).toMatchObject({ label: 'When', value: expect.stringMatching(/^Tue, 13 Oct,? 2026,? 10:00 am$/i) });
  });
});

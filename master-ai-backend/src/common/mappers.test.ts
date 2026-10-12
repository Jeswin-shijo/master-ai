import { describe, expect, it } from 'vitest';
import { describeAction } from './mappers';

describe('approval summaries', () => {
  it('reads money actions plainly', () => {
    expect(describeAction('refund.issue', { amount: 12000, recipient: 'Asha Menon', reason: 'trip cancelled' })).toBe(
      'Refund ₹12,000 to Asha Menon (trip cancelled)',
    );
  });

  it('turns pack tools into verb + object with the record title', () => {
    expect(describeAction('booking.cancel', { entity: 'Booking', id: 'b1' }, { label: 'Booking', title: 'Rahul Nair' })).toBe(
      'Cancel booking for Rahul Nair',
    );
    expect(describeAction('enquiry.mark_contacted', { entity: 'Enquiry', id: 'e1' }, { label: 'Enquiry' })).toBe('Mark contacted enquiry');
  });

  it('uses sector labels for generic updates', () => {
    expect(describeAction('records.update', { entity: 'Booking', id: 'b1', patch: { status: 'confirmed' } }, { label: 'Appointment', title: 'Priya' })).toBe(
      'Update appointment for Priya → confirmed',
    );
  });
});

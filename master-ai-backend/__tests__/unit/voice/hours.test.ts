import { describe, expect, it } from 'vitest';
import { narrowHours, withinHours } from '../../../src/voice/time';

const ist = (iso: string) => new Date(`${iso}+05:30`);
const partyHours = { days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '18:00' };

describe('calling hours for outside parties', () => {
  it("narrows the company's hours by a follow-up's own window", () => {
    expect(narrowHours(partyHours, { start: '08:00', end: '19:00' })).toEqual(partyHours);
    expect(narrowHours(partyHours, { start: '12:00', end: '20:00' })).toEqual({ days: partyHours.days, start: '12:00', end: '18:00' });
    expect(narrowHours(partyHours, null)).toEqual(partyHours);
  });

  it('calls only on the days and inside the hours, and never outside 9:00–21:00', () => {
    expect(withinHours(ist('2026-10-15T11:30:00'), partyHours)).toBe(true); // Thursday
    expect(withinHours(ist('2026-10-15T09:45:00'), partyHours)).toBe(false);
    expect(withinHours(ist('2026-10-15T18:00:00'), partyHours)).toBe(false);
    expect(withinHours(ist('2026-10-18T11:30:00'), partyHours)).toBe(false); // Sunday
    const wide = { days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '23:00' };
    expect(withinHours(ist('2026-10-15T08:30:00'), wide)).toBe(false);
    expect(withinHours(ist('2026-10-15T21:15:00'), wide)).toBe(false);
  });

  it("keeps a lender's recovery calls inside 8:00–19:00 even when the company calls later", () => {
    const lender = narrowHours({ days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '20:00' }, { start: '08:00', end: '19:00' });
    expect(withinHours(ist('2026-10-15T18:30:00'), lender)).toBe(true);
    expect(withinHours(ist('2026-10-15T19:30:00'), lender)).toBe(false);
    expect(withinHours(ist('2026-10-15T08:30:00'), lender)).toBe(false);
  });
});

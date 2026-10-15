import { describe, expect, it } from 'vitest';
import type { staff } from '../../../src/db/schema';
import { matchStaff, phoneKey } from '../../../src/follow-ups/targets';

const person = (name: string, status: 'active' | 'inactive' = 'active') => ({ id: name, name, status }) as typeof staff.$inferSelect;

describe('who a follow-up calls', () => {
  it('keys a phone number by its last ten digits', () => {
    expect(phoneKey('+91 98470 11111')).toBe('9847011111');
    expect(phoneKey('098470-11111')).toBe('9847011111');
  });

  it('finds a team member by full name, or by a first name only one active person has', () => {
    const team = [person('Anil Kumar'), person('Anil Menon', 'inactive'), person('Ravi Kumar'), person('Ravi Shankar')];
    expect(matchStaff(team, 'anil kumar ')?.id).toBe('Anil Kumar');
    expect(matchStaff(team, 'Anil')?.id).toBe('Anil Kumar');
    expect(matchStaff(team, 'Ravi')).toBeNull();
    expect(matchStaff(team, 'Nobody')).toBeNull();
    expect(matchStaff(team, '')).toBeNull();
  });
});

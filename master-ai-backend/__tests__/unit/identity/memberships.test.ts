import { describe, expect, it } from 'vitest';
import { pickMembership, toCompanies } from '../../../src/identity/memberships';

const rows = [
  { tenant_id: 't-old', tenant_name: 'Kerala Trails', principal_id: 'p1', role: 'owner' },
  { tenant_id: 't-plant', tenant_name: 'Kochi Thermal', principal_id: 'p2', role: 'member' },
];

describe('people in several companies', () => {
  it('lists every company they belong to', () => {
    expect(toCompanies(rows)).toEqual([
      { id: 't-old', name: 'Kerala Trails', role: 'owner' },
      { id: 't-plant', name: 'Kochi Thermal', role: 'member' },
    ]);
  });

  it('opens the company asked for, or the first one', () => {
    expect(pickMembership(rows, 't-plant')?.principal_id).toBe('p2');
    expect(pickMembership(rows)?.principal_id).toBe('p1');
  });

  it('never opens a company they are not in', () => {
    expect(pickMembership(rows, 't-elsewhere')).toBeNull();
    expect(pickMembership([], undefined)).toBeNull();
  });
});

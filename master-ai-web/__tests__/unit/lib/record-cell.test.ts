import { describe, expect, it } from 'vitest';
import type { EntityField } from '@onehuman/schemas';
import { recordCell } from '../../../src/lib/record-cell';

const field = (type: EntityField['type']) => ({ name: 'f', label: 'F', type }) as EntityField;

describe('recordCell (how a record value reads in the Records table)', () => {
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

  it('leaves text, numbers and anything it cannot read as a date as they are', () => {
    expect(recordCell(field('string'), 'Conveyor 3B')).toBe('Conveyor 3B');
    expect(recordCell(field('integer'), 42)).toBe('42');
    expect(recordCell(field('date'), 'next Tuesday')).toBe('next Tuesday');
  });
});

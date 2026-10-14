import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/canonical';
import { StageKeySchema } from '../src/lifecycle';
import { AUTONOMY_LEVELS, ORG_TYPES, PRIORITY_IDS, SECTOR_IDS, SECTORS, STAGE_KEYS } from '../src/values';

describe('the plain values the apps show', () => {
  it('has the 8 stages in the order every request runs them', () => {
    expect(STAGE_KEYS).toEqual(['request', 'review', 'classify', 'assign', 'approve', 'execute', 'close', 'report']);
    expect(StageKeySchema.options).toEqual([...STAGE_KEYS]);
  });

  it('offers five sectors at sign-up, each with three ready-made organization types', () => {
    expect(SECTORS.map((s) => s.id)).toEqual([...SECTOR_IDS]);
    for (const sector of SECTOR_IDS) expect(ORG_TYPES.filter((t) => t.sector === sector), sector).toHaveLength(3);
    expect(new Set(ORG_TYPES.map((t) => t.id)).size).toBe(ORG_TYPES.length);
  });

  it('ranks priorities P1 (most urgent) to P4', () => {
    expect(PRIORITY_IDS).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('runs levels 1 to 3 without asking, asks at 4 and forbids 5', () => {
    expect(Object.entries(AUTONOMY_LEVELS).map(([level, l]) => [Number(level), l.runsWithoutApproval])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, false],
      [5, false],
    ]);
  });
});

describe('canonicalJson (audit hashes and approval signatures)', () => {
  it('writes the same object the same way whatever order its keys came in', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('leaves out undefined fields and writes dates as ISO strings', () => {
    expect(canonicalJson({ a: undefined, at: new Date('2026-10-14T10:00:00Z') })).toBe('{"at":"2026-10-14T10:00:00.000Z"}');
  });
});

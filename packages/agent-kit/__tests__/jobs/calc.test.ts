import { describe, expect, it } from 'vitest';
import { evalCalc } from '../../src/jobs';

const v = (o: Record<string, unknown>) => (p: string) => o[p];

describe('evalCalc', () => {
  it('works out a sum with names and brackets', () => {
    expect(evalCalc('avg * (lead + buffer) - stock', v({ avg: 4, lead: 5, buffer: 2, stock: 10 }))).toEqual({ ok: true, value: 18 });
  });
  it('refuses division by zero', () => {
    expect(evalCalc('a / b', v({ a: 1, b: 0 }))).toEqual({ ok: false, reason: 'Division by zero' });
  });
  it('names a missing value', () => {
    expect(evalCalc('a + b', v({ a: 1, b: null }))).toEqual({ ok: false, reason: 'b is missing or not a number' });
  });
  it('reads money strings', () => {
    expect(evalCalc('price', v({ price: '₹1,200' }))).toEqual({ ok: true, value: 1200 });
  });
  it('rejects anything else', () => {
    expect(evalCalc('process.exit(1)', v({})).ok).toBe(false);
    expect(evalCalc('a; b', v({ a: 1, b: 2 }))).toEqual({ ok: false, reason: 'Not a sum this check can work out' });
  });
  it('handles unary minus and rounding', () => {
    expect(evalCalc('-a + 2', v({ a: 1 }))).toEqual({ ok: true, value: 1 });
    expect(evalCalc('1/3', v({}))).toEqual({ ok: true, value: 0.33 });
  });
  it('resolves dotted names', () => {
    expect(evalCalc('item.qty * 2', v({ 'item.qty': 3 }))).toEqual({ ok: true, value: 6 });
  });
});

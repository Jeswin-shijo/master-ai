import { describe, expect, it } from 'vitest';
import { isValidGstin, isValidIfsc, isValidPan, isValidPincode } from '../../src/jobs';

describe('validators', () => {
  it('checks GSTIN with its check digit', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('07AAACI1681G1ZG')).toBe(false);
    expect(isValidGstin('27aapfu0939f1zv')).toBe(true);
    expect(isValidGstin(' 27AAPFU0939F1ZV ')).toBe(true);
  });
  it('checks PAN', () => {
    expect(isValidPan('AAPFU0939F')).toBe(true);
    expect(isValidPan('AAPXU0939F')).toBe(false);
  });
  it('checks IFSC', () => {
    expect(isValidIfsc('SBIN0001234')).toBe(true);
    expect(isValidIfsc('SBIN1001234')).toBe(false);
  });
  it('checks PIN code', () => {
    expect(isValidPincode('560001')).toBe(true);
    expect(isValidPincode('011001')).toBe(false);
  });
});

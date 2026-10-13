import { describe, expect, it } from 'vitest';
import { LifecycleSchema } from '@onehuman/schemas';
import { matchIndustry, mergeLifecycles, parsePack } from './index';

/** Fixes found while writing the sector content (Plan 2). */

describe('worked examples follow the pack that defines the case type', () => {
  const sector = LifecycleSchema.parse({
    categories: [
      { id: 'payment', name: 'Payment', keywords: ['payment', 'release funds', 'transfer'], priority: 'P3', department: 'Finance', approval: { required: 'always', role: 'owner' } },
      { id: 'complaint', name: 'Complaint', keywords: ['complaint', 'grievance', 'unhappy'], priority: 'P2', department: 'Grievance' },
    ],
    examples: [
      { request: 'Release ₹38,000 to the printer', category: 'payment', priority: 'P3', approval: true },
      { request: 'Pay the electricity bill of ₹6,450', category: 'payment', priority: 'P3', approval: true },
      { request: 'A donor is unhappy with the receipt delay', category: 'complaint', priority: 'P2', approval: false },
    ],
  });
  const org = LifecycleSchema.parse({
    categories: [
      { id: 'payment', name: 'Fund use', keywords: ['payment', 'release funds', 'vendor bill'], priority: 'P3', department: 'Finance', approval: { required: 'above_amount', role: 'owner', amount_inr: 50000 } },
    ],
    examples: [
      { request: 'Release ₹80,000 to the training partner', category: 'payment', priority: 'P3', approval: true },
      { request: 'Pay the ₹12,000 hall rent for the camp', category: 'payment', priority: 'P3', approval: false },
    ],
  });

  it('drops the parent examples of a case type the child redefines', () => {
    const lc = mergeLifecycles([sector, org]);
    expect(lc.examples.filter((e) => e.category === 'payment').map((e) => e.request)).toEqual([
      'Release ₹80,000 to the training partner',
      'Pay the ₹12,000 hall rent for the camp',
    ]);
  });

  it('keeps the parent examples of case types the child leaves alone', () => {
    const lc = mergeLifecycles([sector, org]);
    expect(lc.examples.filter((e) => e.category === 'complaint')).toHaveLength(1);
  });
});

describe('signup matching keeps numbers', () => {
  const ngo = parsePack({ id: 'ngo-test', version: '1.0.0', name: 'NGO', description: 'x', match: { keywords: ['section 8 company', 'ngo'] } });
  const transport = parsePack({ id: 'transport-test', version: '1.0.0', name: 'Transport', description: 'x', match: { keywords: ['transport company'] } });

  it('matches a keyword with a single digit', () => {
    expect(matchIndustry('Section 8 company running schools', [ngo, transport])?.pack.id).toBe('ngo-test');
  });

  it('does not match a different number', () => {
    expect(matchIndustry('Section 25 company running schools', [ngo, transport])).toBeNull();
  });

  it('still matches text that contains other numbers', () => {
    expect(matchIndustry('Transport company with 40 trucks', [ngo, transport])?.pack.id).toBe('transport-test');
  });
});

import { describe, expect, it } from 'vitest';
import { extractAmountInr, extractEmail, extractPhone, hasDate, hasDetail, phraseIn } from '../src/index';

describe('extractAmountInr', () => {
  it.each([
    ['I need a personal loan of Rs 1.5 lakh', 150000],
    ['Refund ₹45,000 to the customer', 45000],
    ['quote is 1,50,000 rupees', 150000],
    ['LAP case for Rs 45 lakh against their shop', 4500000],
    ['project worth 2 crore', 20000000],
    ['EMI Rs. 4,250 bounced', 4250],
    ['INR 12000 advance', 12000],
    ['budget around 50k', 50000],
    ['about 5 thousand rupees', 5000],
  ])('reads %s', (text, amount) => {
    expect(extractAmountInr(text)).toBe(amount);
  });

  it('ignores numbers that are not money', () => {
    expect(extractAmountInr('Loan LN-20931 is 97 days overdue; vibration 11 mm/s since 05-10-2026')).toBeNull();
    expect(extractAmountInr('Send 15 kg of bolts to bay 4')).toBeNull();
  });

  it('takes the largest amount', () => {
    expect(extractAmountInr('My EMI Rs 4,250 bounced, and I want a top-up of ₹1.5 lakh')).toBe(150000);
  });
});

describe('dates and contacts', () => {
  it.each(['due 05-10-2026', 'by 2026-10-20', 'on 28 September', 'Sept 28th', 'tomorrow morning', 'next Monday'])('finds a date in %s', (text) => {
    expect(hasDate(text)).toBe(true);
  });
  it('finds no date in plain text', () => expect(hasDate('the pump is vibrating')).toBe(false));
  it('finds Indian phone numbers and emails', () => {
    expect(extractPhone('call me on +91 98450 12345 today')).toBe('+91 98450 12345');
    expect(extractPhone('my number is 9845012345')).toBe('9845012345');
    expect(extractEmail('write to asha.k@example.in please')).toBe('asha.k@example.in');
    expect(extractPhone('order 12345')).toBeNull();
  });
});

describe('phraseIn and hasDetail', () => {
  it('matches whole words and simple plurals', () => {
    expect(phraseIn('Two pumps are vibrating', 'pump')).toBe(true);
    expect(phraseIn('EMI bounced again', 'emi bounced')).toBe(true);
    expect(phraseIn('pumpkin delivery', 'pump')).toBe(false);
  });

  it('checks required details by kind', () => {
    expect(hasDetail({ key: 'amount', label: 'Loan amount', kind: 'amount' }, 'need a loan')).toBe(false);
    expect(hasDetail({ key: 'amount', label: 'Loan amount', kind: 'amount' }, 'need a loan', undefined, 200000)).toBe(true);
    expect(hasDetail({ key: 'contact', label: 'Phone or email', kind: 'contact' }, 'help', { name: 'Asha', phone: '9845012345' })).toBe(true);
    expect(hasDetail({ key: 'asset', label: 'Which equipment', kind: 'keywords', keywords: ['pump', 'boiler'] }, 'boiler B trip')).toBe(true);
  });
});

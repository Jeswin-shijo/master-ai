import { describe, expect, it } from 'vitest';
import type { EntityField } from '@onehuman/schemas';
import { askFor, matchOption, parseField, readBack, spokenAmount, spokenCount, spokenDate, spokenDateTime, spokenYesNo } from '../../../src/voice/spoken';
import { addDaysTo } from '../../../src/voice/time';

// 15 October 2026, 5:30 pm in India (a Thursday).
const now = new Date('2026-10-15T12:00:00Z');

describe('spoken amounts', () => {
  it.each([
    ['48,260', 48260],
    ['₹48260', 48260],
    ["it's 7,360 rupees", 7360],
    ['forty-eight thousand two sixty', 48260],
    ['two sixty', 260],
    ['two sixty eight', 268],
    ['two hundred sixty', 260],
    ['one lakh twenty', 120000],
    ['one lakh twenty thousand', 120000],
    ['1.2 lakh', 120000],
    ['a lakh', 100000],
    ['5 crore', 50000000],
    ['twelve', 12],
    ['two point five lakh', 250000],
    ['1 point 2 lakh', 120000],
    ['forty point five', 40.5],
  ])('reads %s as %d', (text, value) => {
    expect(spokenAmount(text)).toBe(value);
  });

  it('finds no amount in words without numbers, and keeps only the first of two numbers', () => {
    expect(spokenAmount('not sure')).toBeNull();
    expect(spokenAmount('3 bills, 48260')).toBeNull();
    expect(spokenAmount('ten fifty')).toBeNull();
    expect(spokenAmount('one and a half lakh')).toBeNull();
  });

  it('reads a count, with none as zero', () => {
    expect(spokenCount('None today')).toBe(0);
    expect(spokenCount('three')).toBe(3);
    expect(spokenCount('a few')).toBeNull();
  });
});

describe('spoken dates', () => {
  it.each([
    ['today', '2026-10-15'],
    ['yesterday', '2026-10-14'],
    ['tomorrow', '2026-10-16'],
    ['day after tomorrow', '2026-10-17'],
    ['20 October', '2026-10-20'],
    ['the 20th of Oct', '2026-10-20'],
    ['October 20th', '2026-10-20'],
    ['20/10', '2026-10-20'],
    ['20-10-2026', '2026-10-20'],
    ['2026-11-02', '2026-11-02'],
    ['on Friday', '2026-10-16'],
    ['last Monday', '2026-10-12'],
    ['in 3 days', '2026-10-18'],
  ])('reads %s as %s', (text, day) => {
    expect(spokenDate(text, now)).toBe(day);
  });

  it('refuses a date that does not exist, and words with no date', () => {
    expect(spokenDate('31/02', now)).toBeNull();
    expect(spokenDate('soon', now)).toBeNull();
  });

  it('reads a date-time, with 6 pm India time when only a day is said', () => {
    expect(spokenDateTime('tomorrow 5 pm', now)).toBe('2026-10-16T11:30:00.000Z');
    expect(spokenDateTime('20 October', now)).toBe('2026-10-20T12:30:00.000Z');
  });

  it('adds days to an India date', () => {
    expect(addDaysTo('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysTo('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('yes, no and choices', () => {
  it('hears yes and no', () => {
    expect(spokenYesNo('Yes, that is right')).toBe(true);
    expect(spokenYesNo('Haan')).toBe(true);
    expect(spokenYesNo('Yes no problem')).toBe(true);
    expect(spokenYesNo('No, the total is wrong')).toBe(false);
    expect(spokenYesNo('not right')).toBe(false);
    expect(spokenYesNo('maybe')).toBeNull();
    expect(spokenYesNo('Ok but the total is wrong')).toBe(false);
    expect(spokenYesNo('Sure, no')).toBe(false);
    expect(spokenYesNo('Not sure')).toBeNull();
  });

  it('matches options with or without dashes, and by a unique first word', () => {
    const options = ['sales invoice', 'purchase bill', 'credit note', 'debit note'];
    expect(matchOption(options, "It's a sales invoice")).toBe('sales invoice');
    expect(matchOption(options, 'purchase')).toBe('purchase bill');
    expect(matchOption(['new', 'in-progress', 'resolved'], 'in progress')).toBe('in-progress');
    expect(matchOption(options, 'a receipt')).toBeNull();
  });
});

describe('questions and read-back', () => {
  const billType: EntityField = { name: 'billType', label: 'Bill type', type: 'enum', options: ['sales invoice', 'purchase bill'], required: true };
  const gst: EntityField = { name: 'gstAmount', label: 'GST amount', type: 'money', required: false };
  const party: EntityField = { name: 'party', label: 'Party', type: 'reference', ref: 'Party', required: false };
  const due: EntityField = { name: 'dueDate', label: 'Due date', type: 'date', required: false };

  it('asks for a field by its label and type', () => {
    expect(askFor(billType)).toBe("What's the bill type: sales invoice or purchase bill?");
    expect(askFor(gst)).toBe("What's the GST amount?");
    expect(askFor(party)).toBe('Which party?');
  });

  it('reads an item back in words', () => {
    const line = readBack('bill', [billType, party, gst, due], { billType: 'sales invoice', party: 'p1', gstAmount: 120000, dueDate: '2026-10-16' }, { party: 'Sri Ganesh Traders' }, now);
    expect(line).toBe('Bill: sales invoice, Sri Ganesh Traders, GST amount ₹1,20,000, due date tomorrow.');
  });

  it('reads a phone number and an e-mail, and refuses a number in words', () => {
    expect(parseField({ name: 'phone', label: 'Phone', type: 'phone', required: false }, '98470 12345', now)).toEqual({ ok: true, value: '9847012345' });
    expect(parseField({ name: 'email', label: 'E-mail', type: 'email', required: false }, 'it is Ravi@Example.com', now)).toEqual({ ok: true, value: 'ravi@example.com' });
    expect(parseField(gst, 'not sure', now)).toEqual({ ok: false });
  });
});

describe('leftover gaps in what people say', () => {
  it('reads a month only as a whole word or a standard abbreviation', () => {
    expect(spokenDate('maybe 5', now)).toBeNull();
    expect(spokenDate('market 12', now)).toBeNull();
    expect(spokenDate('5 May', now)).toBe('2026-05-05');
    expect(spokenDate('20 October', now)).toBe('2026-10-20');
    expect(spokenDate('Oct 20', now)).toBe('2026-10-20');
    expect(spokenDate('5 sept.', now)).toBe('2026-09-05');
  });

  it('lets an explicit date beat today or tomorrow in the same reply', () => {
    expect(spokenDate('entered today, dated 12 October', now)).toBe('2026-10-12');
    expect(spokenDate('today', now)).toBe('2026-10-15');
    expect(spokenDate('yesterday at 5.30', now)).toBe('2026-10-14');
  });

  it('reads a bare weekday after a past-tense cue as the one just gone', () => {
    expect(spokenDate('Fixed it on Tuesday', now)).toBe('2026-10-13');
    expect(spokenDate('The client paid on Monday', now)).toBe('2026-10-12');
    expect(spokenDate('We will pay on Tuesday', now)).toBe('2026-10-20');
    expect(spokenDate('It will be delivered on Tuesday', now)).toBe('2026-10-20');
    expect(spokenDate('next Friday', now)).toBe('2026-10-16');
  });

  it('reads this morning, this afternoon and this evening as today, even when it has passed', () => {
    expect(spokenDateTime('Fixed it this morning', now)).toBe('2026-10-15T04:30:00.000Z');
    expect(spokenDateTime('this evening', now)).toBe('2026-10-15T12:30:00.000Z');
  });

  it('asks again after a self-correction', () => {
    expect(spokenAmount('sixty thousand, no sorry, sixty five thousand')).toBeNull();
    expect(spokenAmount('five, I mean six')).toBeNull();
    expect(spokenAmount('sixty five thousand')).toBe(65000);
  });

  it('reads a count after a leading no, and a bare no as zero', () => {
    expect(spokenCount('No, there are five')).toBe(5);
    expect(spokenCount('No')).toBe(0);
    expect(spokenCount('None')).toBe(0);
    expect(spokenCount('No one today')).toBe(0);
  });

  it('reads Indian yes phrasings, with negations still winning', () => {
    for (const t of ['theek hai', 'Thik hai', 'haan ji']) expect(spokenYesNo(t)).toBe(true);
    expect(spokenYesNo('theek hai, but wrong')).toBe(false);
  });

  it('picks Y from "not X, Y"', () => {
    expect(matchOption(['credit note', 'debit note'], 'not credit note, debit note')).toBe('debit note');
    expect(matchOption(['credit note', 'debit note'], 'credit note')).toBe('credit note');
  });

  it('reads a phone number only up to 13 digits', () => {
    const phone: EntityField = { name: 'phone', label: 'Phone', type: 'phone', required: false };
    expect(parseField(phone, '+91 98470 12345', now)).toEqual({ ok: true, value: '+919847012345' });
    expect(parseField(phone, '9847012345 9847012345', now)).toEqual({ ok: false });
  });
});

describe('fix round 1', () => {
  it('asks a count again after a spoken correction, and reads a lone number after "sorry" normally', () => {
    for (const t of ['No wait, five', 'No, I mean five', 'No, sorry, there are five']) expect(spokenCount(t)).toBeNull();
    expect(spokenAmount('Sorry sir, 5000')).toBe(5000);
    expect(spokenAmount('I mean it, 5000')).toBe(5000);
    expect(spokenAmount('sixty thousand, no sorry, sixty five thousand')).toBeNull();
  });

  it('keeps a past-weekday cue inside the weekday\'s own clause', () => {
    expect(spokenDate('Half paid, balance on Friday', now)).toBe('2026-10-16');
    expect(spokenDate("it'd be done on Friday", now)).toBe('2026-10-16');
    expect(spokenDate('I was told to pay on Monday', now)).toBe('2026-10-19');
    expect(spokenDate('Fixed it on Tuesday', now)).toBe('2026-10-13');
    expect(spokenDate('paid on Monday', now)).toBe('2026-10-12');
  });

  it('does not read a range as a date when a relative day is said', () => {
    expect(spokenDate('tomorrow between 10-12', now)).toBe('2026-10-16');
    expect(spokenDate('12-10', now)).toBe('2026-10-12');
  });

  it('does not take a bare "ji" as yes', () => {
    expect(spokenYesNo('ji, who is this?')).toBeNull();
    expect(spokenYesNo('ji haan')).toBe(true);
    expect(spokenYesNo('haan ji')).toBe(true);
    expect(spokenYesNo('theek hai')).toBe(true);
  });
});

describe('fix round 2: only "to <verb>" and "\'d <verb>" are future', () => {
  it.each([
    ['paid to Ramesh on Monday', '2026-10-12'],
    ['sent to Kaveri on Monday', '2026-10-12'],
    ['delivered to us on Tuesday', '2026-10-13'],
    ["I'd paid on Monday", '2026-10-12'],
    ['I was told to pay on Monday', '2026-10-19'],
    ["it'd be done on Friday", '2026-10-16'],
  ])('reads %s as %s', (text, day) => {
    expect(spokenDate(text, now)).toBe(day);
  });
});

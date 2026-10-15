import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityField } from '@onehuman/schemas';
import {
  followUpOpening,
  followUpSuggestions,
  followUpTurn,
  newFollowUpState,
  simulatedFollowUpReply,
  type FollowUpContext,
  type FollowUpHeard,
} from '../../../src/voice/follow-up-engine';
import { aboutText } from '../../../src/voice/spoken';

const now = new Date('2026-10-15T06:00:00Z'); // 11:30 am in India, a Thursday
const paymentStatus: EntityField = { name: 'paymentStatus', label: 'Payment', type: 'enum', options: ['unpaid', 'part-paid', 'paid', 'cancelled'], required: false };
const paymentRef: EntityField = { name: 'paymentRef', label: 'Payment ref', type: 'string', required: false };
const party: FollowUpContext = {
  tenantId: 't1',
  companyName: 'Metro Traders',
  who: 'party',
  name: 'Sri Ganesh Traders',
  about: 'bill S-1042: total ₹48,260, due date 20 October',
  findOut: [paymentStatus, paymentRef],
  state: newFollowUpState('party'),
  transcript: [],
  now,
};
const status: EntityField = { name: 'status', label: 'Status', type: 'enum', options: ['new', 'assigned', 'in-progress', 'waiting-for-client', 'resolved', 'closed', 'reopened'], required: false };
const dueBy: EntityField = { name: 'dueBy', label: 'Due by', type: 'datetime', required: false };
const staff: FollowUpContext = { ...party, companyName: 'Infotech', who: 'staff', name: 'Anil Kumar', about: 'ticket T-221: Acme, printer not working', findOut: [status, dueBy], state: newFollowUpState('staff') };

async function talk(ctx: FollowUpContext, replies: string[], heard: (FollowUpHeard | null)[] = []) {
  let state = ctx.state;
  const said: string[] = [];
  let last = { end: false, callBack: false };
  for (const [i, reply] of replies.entries()) {
    const turn = followUpTurn({ ...ctx, state }, reply, heard[i] ?? null);
    said.push(turn.say);
    state = turn.state;
    last = turn;
  }
  return { said, state, result: state.result, ...last };
}

describe('a follow-up call to an outside party', () => {
  it('asks who it is speaking to before it says anything about the item', () => {
    const opening = followUpOpening(party);
    expect(opening).toBe('Hello, this is an AI assistant calling from Metro Traders. Am I speaking with someone from Sri Ganesh Traders?');
    expect(opening).not.toMatch(/S-1042|48,260/);
  });

  it('says who it is again when asked, still without the details', async () => {
    const { said, state } = await talk(party, ['Who is this?']);
    expect(said[0]).toBe("I'm an AI assistant calling from Metro Traders about an account with Sri Ganesh Traders. Am I speaking with someone from Sri Ganesh Traders?");
    expect(state.phase).toBe('identity');
  });

  it('gives the details once the person says yes, and asks when it will be paid', async () => {
    const { said } = await talk(party, ['Yes, speaking']);
    expect(said[0]).toBe("Thank you. It's about bill S-1042: total ₹48,260, due date 20 October. Could you tell me when it will be paid?");
  });

  it('apologises on a wrong number or a no', async () => {
    for (const reply of ['Wrong number', 'No']) {
      const { said, result, end } = await talk(party, [reply]);
      expect(said[0]).toBe('Sorry to have troubled you. Goodbye.');
      expect(result).toEqual({ kind: 'wrong_number', said: reply });
      expect(end).toBe(true);
    }
  });

  it('records a promised date', async () => {
    const { said, result, end } = await talk(party, ['Yes', 'We will pay it tomorrow']);
    expect(result).toEqual({ kind: 'promise', said: 'We will pay it tomorrow', promiseOn: '2026-10-16' });
    expect(said[1]).toBe("Thank you, I've noted that for tomorrow. Goodbye.");
    expect(end).toBe(true);
  });

  it('proposes paid, and asks for a reference when they have one to give', async () => {
    const asked = await talk(party, ['Yes', "It's already paid", 'UTR 445566']);
    expect(asked.said[1]).toBe('Thank you. Do you have a payment reference, like a UTR number?');
    expect(asked.said[2]).toBe("Thank you, I've noted it. Someone from Metro Traders will check it. Goodbye.");
    expect(asked.result).toEqual({ kind: 'settled', said: "It's already paid. UTR 445566", proposed: { paymentStatus: 'paid', paymentRef: '445566' } });
    const given = await talk(party, ['Yes', 'Paid yesterday, UTR 778899']);
    expect(given.result).toEqual({ kind: 'settled', said: 'Paid yesterday, UTR 778899', proposed: { paymentStatus: 'paid', paymentRef: '778899' } });
    expect(given.end).toBe(true);
  });

  it('notes a dispute and promises only that someone will call back', async () => {
    const { said, result } = await talk(party, ['Yes', 'The goods never came']);
    expect(result).toEqual({ kind: 'dispute', said: 'The goods never came' });
    expect(said[1]).toBe("I've noted that; someone from Metro Traders will call you back. Goodbye.");
  });

  it("stops calling a number that asks, whenever they ask", async () => {
    for (const replies of [["Don't call me again"], ['Yes', 'Stop calling this number']]) {
      const { said, result } = await talk(party, replies);
      expect(result?.kind).toBe('do_not_call');
      expect(said.at(-1)).toBe("Sorry for the trouble. We won't call this number again. Goodbye.");
    }
  });

  it('asks once more, then notes what was said', async () => {
    const { said, result } = await talk(party, ['Yes', 'Hmm', 'I will check with my boss']);
    expect(said[1]).toBe('Sorry, roughly when can we expect it?');
    expect(result).toEqual({ kind: 'said', said: 'I will check with my boss' });
    expect(said[2]).toBe("Thank you, I'll pass that on. Goodbye.");
  });

  it('ends politely when asked to call back', async () => {
    const { end, callBack, result } = await talk(party, ['Yes', 'I am driving, call me later']);
    expect({ end, callBack, result }).toEqual({ end: true, callBack: true, result: null });
  });

  it('uses what a model heard, but never a promise in the past', async () => {
    const heard = (over: Partial<FollowUpHeard>): FollowUpHeard => ({ identity: null, outcome: null, promiseOn: null, reference: null, status: null, dueAt: null, amount: null, ...over });
    const future = await talk({ ...party, state: { ...newFollowUpState('party'), phase: 'ask' } }, ['Next Tuesday, I think'], [heard({ outcome: 'promise', promiseOn: '2026-10-20' })]);
    expect(future.result).toEqual({ kind: 'promise', said: 'Next Tuesday, I think', promiseOn: '2026-10-20' });
    const past = await talk({ ...party, state: { ...newFollowUpState('party'), phase: 'ask' } }, ['hmm'], [heard({ outcome: 'promise', promiseOn: '2026-10-01' })]);
    expect(past.result).toBeNull();
    expect(past.said[0]).toBe('Sorry, roughly when can we expect it?');
  });
});

describe('a follow-up call to a team member', () => {
  it('goes straight to the item and asks for the status', () => {
    expect(followUpOpening(staff)).toBe("Hi Anil, this is the AI assistant at Infotech, about ticket T-221: Acme, printer not working. What's the status?");
  });

  it('matches the status and a new date, and updates the item', async () => {
    const { said, result, end } = await talk(staff, ["It's in progress, done by tomorrow 5 pm"]);
    expect(result).toEqual({ kind: 'status', said: "It's in progress, done by tomorrow 5 pm", patch: { status: 'in-progress', dueBy: '2026-10-16T11:30:00.000Z' } });
    expect(said[0]).toMatch(/^Thanks, Anil\. I've updated it to in progress, due .+\.$/);
    expect(end).toBe(true);
  });

  it('understands done, fixed and waiting in everyday words', async () => {
    expect((await talk(staff, ["It's fixed"])).result).toMatchObject({ patch: { status: 'resolved' } });
    expect((await talk(staff, ['Waiting for the client'])).result).toMatchObject({ patch: { status: 'waiting-for-client' } });
    expect((await talk(staff, ['Not done yet, still working on it'])).result).toMatchObject({ patch: { status: 'in-progress' } });
  });

  it('notes an answer it cannot match after asking once more', async () => {
    const { said, result } = await talk(staff, ['The printer is from Canon', 'Ask Ravi']);
    expect(said[0]).toBe("Sorry, what's the status: new, assigned, in-progress, waiting-for-client or resolved?");
    expect(result).toEqual({ kind: 'said', said: 'Ask Ravi' });
  });
});

describe('the item in words, the simulator and suggestions', () => {
  it('says what the item is about', () => {
    const fields: EntityField[] = [
      { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
      { name: 'total', label: 'Total', type: 'money', required: false },
      { name: 'dueDate', label: 'Due date', type: 'date', required: false },
    ];
    expect(aboutText('bill', fields, { billNo: 'S-1042', total: 48260, dueDate: '2026-10-20' }, {}, now)).toBe('bill S-1042: total ₹48,260, due date 20 October');
  });

  it('plays a cooperative party and a cooperative engineer', async () => {
    const p = await talk(party, [simulatedFollowUpReply(party), simulatedFollowUpReply({ ...party, state: { ...newFollowUpState('party'), phase: 'ask' } })]);
    expect(p.result).toMatchObject({ kind: 'promise' });
    const s = await talk(staff, [simulatedFollowUpReply(staff)]);
    expect(s.result).toMatchObject({ kind: 'status', patch: { status: 'in-progress' } });
  });

  it('suggests replies for where the call is', () => {
    expect(followUpSuggestions(party)).toEqual(['Yes, speaking', 'Wrong number', 'Who is this?']);
    expect(followUpSuggestions({ ...party, state: { ...newFollowUpState('party'), phase: 'ask' } })).toEqual(['We will pay on Friday', "It's already paid", 'The goods never came', "Don't call me again"]);
    expect(followUpSuggestions(staff)).toEqual(["It's in progress, done by tomorrow 5 pm", "It's done", 'Can you call me later?']);
  });
});

describe('replies that must not turn into the wrong result', () => {
  const heard = (over: Partial<FollowUpHeard>): FollowUpHeard => ({ identity: null, outcome: null, promiseOn: null, reference: null, status: null, dueAt: null, amount: null, ...over });
  const ask: FollowUpContext = { ...party, state: { ...newFollowUpState('party'), phase: 'ask' } };
  const refPhase: FollowUpContext = { ...party, state: { phase: 'reference', retries: 0, result: { kind: 'settled', said: "It's paid", proposed: { paymentStatus: 'paid' } } } };

  it.each(["It isn't fixed yet", "It isn't resolved yet", 'Nothing is done', 'It will be fixed tomorrow', 'I will get it done by tomorrow 5 pm'])(
    'a team member saying "%s" is in progress, not resolved',
    async (reply) => {
      expect((await talk(staff, [reply])).result).toMatchObject({ kind: 'status', patch: { status: 'in-progress' } });
    },
  );

  it.each(['Done by tomorrow', 'Done by evening', 'Should be done today', 'Hopefully done tomorrow', 'I am on it, done by 5 pm', 'Done in 2 days', 'Almost done', 'Nearly done', 'Done, only testing pending'])(
    'a team member saying "%s" is still in progress: done later or hedged is not done',
    async (reply) => {
      const { result } = await talk(staff, [reply]);
      expect(result?.kind).toBe('status');
      expect((result as { patch: Record<string, unknown> }).patch.status).toBe('in-progress');
    },
  );

  it.each(["It's done", "It's fixed", 'Resolved', 'Fixed yesterday', 'I fixed it'])('a team member saying "%s" is resolved', async (reply) => {
    const { result } = await talk(staff, [reply]);
    expect(result?.kind).toBe('status');
    expect((result as { patch: Record<string, unknown> }).patch.status).toBe('resolved');
  });

  describe('a deadline a model heard', () => {
    // A server runs in UTC; this machine may be in India, where an offset-less time already reads as India time.
    let tz: string | undefined;
    beforeAll(() => {
      tz = process.env.TZ;
      process.env.TZ = 'UTC';
    });
    afterAll(() => {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    });

    it('is read as India time when the words give none', async () => {
      const { result } = await talk(staff, ['It will take some time'], [heard({ dueAt: '2026-10-16T17:00:00' })]);
      expect((result as { patch: Record<string, unknown> }).patch.dueBy).toBe(new Date('2026-10-16T17:00:00+05:30').toISOString());
    });

    it("gives way to the script's reading of the words", async () => {
      const { result } = await talk(staff, ["It's in progress, done by tomorrow 5 pm"], [heard({ dueAt: '2026-10-16T17:00:00Z' })]);
      expect((result as { patch: Record<string, unknown> }).patch.dueBy).toBe(new Date('2026-10-16T17:00:00+05:30').toISOString());
    });
  });

  it('reads no status from "going over" or "a new part"', async () => {
    expect((await talk(staff, ['I am going over to the client site'])).said[0]).toMatch(/^Sorry, what's the status/);
    expect((await talk(staff, ['A new part is needed'])).said[0]).toMatch(/^Sorry, what's the status/);
  });

  it('lets the words "not fixed" beat a model that heard resolved', async () => {
    expect((await talk(staff, ['Not fixed yet'], [heard({ status: 'resolved' })])).result).toMatchObject({ patch: { status: 'in-progress' } });
  });

  it.each([
    ['It will be paid by Friday', '2026-10-16'],
    ['Payment is approved, will be released Friday', '2026-10-16'],
    ['We are short of cash, will pay Friday', '2026-10-16'],
  ])('reads "%s" as a promise', async (reply, day) => {
    expect((await talk(ask, [reply])).result).toEqual({ kind: 'promise', said: reply, promiseOn: day });
  });

  it.each(['It has not been paid', "We haven't received the goods yet", 'We have received the goods, payment next week', 'Nothing is paid'])(
    'does not read "%s" as paid',
    async (reply) => {
      const { said, result } = await talk(ask, [reply]);
      expect(result?.kind).not.toBe('settled');
      expect(said[0]).not.toMatch(/payment reference/);
    },
  );

  it('lets the words "not paid" beat a model that heard paid', async () => {
    expect((await talk(ask, ['It has not been paid'], [heard({ outcome: 'paid' })])).result?.kind).not.toBe('settled');
  });

  it.each(['Who is speaking?', 'Who is this speaking?', 'Speaking to whom?'])('explains before any detail when asked "%s"', async (reply) => {
    const { said, state } = await talk(party, [reply]);
    expect(said[0]).toBe("I'm an AI assistant calling from Metro Traders about an account with Sri Ganesh Traders. Am I speaking with someone from Sri Ganesh Traders?");
    expect(state.phase).toBe('identity');
  });

  it('ends without details when told it is the wrong person', async () => {
    const { said, result } = await talk(party, ['You are speaking to the wrong person']);
    expect(result?.kind).toBe('wrong_number');
    expect(said[0]).not.toMatch(/S-1042/);
  });

  it.each(['He is not available', 'No, he is out', 'No, he is not here', 'No, this is his wife', 'Not the right time', 'No no, tell me'])(
    'ends "%s" politely as a call-back, not a wrong number, and says nothing about the item',
    async (reply) => {
      const { said, result, callBack, end } = await talk(party, [reply]);
      expect({ result, callBack, end }).toEqual({ result: null, callBack: true, end: true });
      expect(said[0]).not.toMatch(/S-1042/);
    },
  );

  it('treats "don\'t call before 5" as a call-back, not a do-not-call', async () => {
    const { result, callBack, end } = await talk(ask, ["Please don't call before 5, call after"]);
    expect(result?.kind).not.toBe('do_not_call');
    expect(callBack).toBe(true);
    expect(end).toBe(true);
  });

  it.each(["Don't keep calling me", 'Stop these calls', 'No more calls please', 'Take me off your list'])('stops calling on "%s"', async (reply) => {
    expect((await talk(ask, [reply])).result?.kind).toBe('do_not_call');
  });

  it.each([
    ['UTR number 445566', '445566'],
    ['UTR number is 4455 6677', '44556677'],
    ['Reference no. A1B2C3', 'A1B2C3'],
  ])('takes the reference from "%s"', async (reply, ref) => {
    expect((await talk(refPhase, [reply])).result).toMatchObject({ kind: 'settled', proposed: { paymentStatus: 'paid', paymentRef: ref } });
  });

  it.each(['Reference not available', 'No reference yet'])('takes no reference from "%s"', async (reply) => {
    const { result } = await talk(refPhase, [reply]);
    expect(result).toMatchObject({ kind: 'settled', proposed: { paymentStatus: 'paid' } });
    expect((result as { proposed: Record<string, unknown> }).proposed.paymentRef).toBeUndefined();
  });

  it('asks for the reference when the only number is a phone number or an amount', async () => {
    for (const reply of ['Already paid, call my accountant on 9876543210', 'Paid 120000 rupees']) {
      expect((await talk(ask, [reply])).said[0]).toBe('Thank you. Do you have a payment reference, like a UTR number?');
    }
  });
});

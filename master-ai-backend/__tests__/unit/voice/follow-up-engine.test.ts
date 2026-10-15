import { describe, expect, it } from 'vitest';
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

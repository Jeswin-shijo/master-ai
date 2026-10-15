import { describe, expect, it } from 'vitest';
import type { EntityField } from '@onehuman/schemas';
import {
  collectSuggestions,
  collectTurn,
  newCollectState,
  simulatedCollectReply,
  type CollectContext,
  type CollectDeps,
  type CollectHeard,
  type CollectMatch,
  type SaveResult,
} from '../../../src/voice/collect-engine';

const now = new Date('2026-10-15T12:00:00Z');
const billNo: EntityField = { name: 'billNo', label: 'Bill no.', type: 'string', required: true };
const billType: EntityField = { name: 'billType', label: 'Bill type', type: 'enum', options: ['sales invoice', 'purchase bill', 'credit note', 'debit note'], required: true };
const party: EntityField = { name: 'party', label: 'Party', type: 'reference', ref: 'Party', required: false };
const total: EntityField = { name: 'total', label: 'Total', type: 'money', required: false };
const dueDate: EntityField = { name: 'dueDate', label: 'Due date', type: 'date', required: false };

const base: CollectContext = {
  tenantId: 't1',
  companyName: 'Metro Traders',
  ownerName: 'Asha',
  staff: { name: 'Ravi Kumar', title: 'Billing clerk' },
  listLabel: 'bills',
  itemLabel: 'bill',
  fields: [billNo, billType, party, total, dueDate],
  maxItems: 15,
  state: newCollectState(),
  transcript: [],
  now,
};

function fakeDeps(matches: Record<string, CollectMatch[]> = {}, results: SaveResult[] = []) {
  const saved: Record<string, unknown>[] = [];
  const deps: CollectDeps = {
    lookup: async (_entity, words) => matches[words.toLowerCase()] ?? [],
    save: async (item) => {
      saved.push(item);
      return results.shift() ?? { kind: 'saved', id: `r${saved.length}` };
    },
  };
  return { deps, saved };
}

/** Plays a call: each reply is one turn; returns what the AI said and where it ended. */
async function talk(replies: string[], deps: CollectDeps, ctx: Partial<CollectContext> = {}, heard: (CollectHeard | null)[] = []) {
  let state = ctx.state ?? newCollectState();
  const said: string[] = [];
  let last = { end: false, callBack: false };
  for (const [i, reply] of replies.entries()) {
    const turn = await collectTurn({ ...base, ...ctx, state }, reply, deps, heard[i] ?? null);
    said.push(turn.say);
    state = turn.state;
    last = turn;
  }
  return { said, state, ...last };
}

describe('the collection call', () => {
  it('asks the count, then each field in order, reads the item back and saves it on yes', async () => {
    const { deps, saved } = fakeDeps({ ganesh: [{ id: 'p1', title: 'Sri Ganesh Traders' }] });
    const { said, state } = await talk(['Two', 'S-1042', 'sales invoice', 'Ganesh', 'yes', 'forty-eight thousand two sixty', '20/10', 'yes'], deps);
    expect(said).toEqual([
      "2, got it. Bill 1. What's the bill no.?",
      "What's the bill type: sales invoice, purchase bill, credit note or debit note?",
      'Which party?',
      'Sri Ganesh Traders, is that right?',
      "Got it. What's the total?",
      "What's the due date?",
      'Bill: bill no. S-1042, sales invoice, Sri Ganesh Traders, total ₹48,260, due date 20 October. Is that right?',
      "Saved. Next bill. What's the bill no.?",
    ]);
    expect(saved).toEqual([{ billNo: 'S-1042', billType: 'sales invoice', party: 'p1', total: 48260, dueDate: '2026-10-20' }]);
    expect(state).toMatchObject({ saved: ['r1'], done: 1, phase: 'field' });
  });

  it('keeps the words for a party nobody matches, and reads out up to three to choose from', async () => {
    const { deps, saved } = fakeDeps({ sri: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, title: `Sri ${n} Traders` })) });
    const first = await talk(['One', 'S-1', 'sales invoice', 'Nobody Known', '100', 'skip', 'yes'], deps);
    expect(first.said[3]).toBe("I'll note Nobody Known as you said it. What's the total?");
    expect(saved[0]).toMatchObject({ party: 'Nobody Known' });
    const second = await talk(['One', 'S-2', 'sales invoice', 'Sri', 'the second one'], deps);
    expect(second.said[3]).toBe('Is it Sri 1 Traders, Sri 2 Traders or Sri 3 Traders?');
    expect(second.state.item).toMatchObject({ party: 'p2' });
    expect(second.state.titles).toEqual({ party: 'Sri 2 Traders' });
  });

  it('takes the item again from the start when the read-back is wrong', async () => {
    const { deps, saved } = fakeDeps();
    const { said, state } = await talk(['One', 'S-9', 'credit note', 'none', '500', 'skip', 'No, the total is wrong'], deps);
    expect(said.at(-1)).toBe("Let's take it again. What's the bill no.?");
    expect(saved).toEqual([]);
    expect(state.item).toEqual({});
  });

  it('notes a repeat with different details instead of saving it again', async () => {
    const { deps } = fakeDeps({}, [{ kind: 'repeat', id: 'old', differences: ['Total'] }]);
    const { said, state } = await talk(['One', 'S-1042', 'sales invoice', 'nobody', '48600', 'skip', 'yes', "that's all"], deps);
    expect(said[6]).toBe("That bill is already on the list, with a different total. I've noted it for Asha. That's 1. Any more bills?");
    expect(said[7]).toBe("Thank you, Ravi. I haven't added any bills, and noted a difference for Asha. Have a good evening.");
    expect(state).toMatchObject({ saved: [], differences: 1, phase: 'done' });
  });

  it('stops at the item limit', async () => {
    const { deps } = fakeDeps();
    const { said, end } = await talk(['Five', 'S-1', 'sales invoice', 'nobody', '100', 'skip', 'yes'], deps, { maxItems: 1 });
    expect(said.at(-1)).toBe("Saved. That's all I can take on one call; please add the rest in the app. Thank you, Ravi.");
    expect(end).toBe(true);
  });

  it('ends at once when there are none today, or when asked to call back', async () => {
    const none = await talk(['None today'], fakeDeps().deps);
    expect(none).toMatchObject({ end: true, callBack: false, said: ['Okay, no bills today. Thank you, Ravi.'] });
    const busy = await talk(['Two', 'I am driving, call me later'], fakeDeps().deps);
    expect(busy).toMatchObject({ end: true, callBack: true });
    expect(busy.said.at(-1)).toBe("No problem, Ravi. I'll call you back a little later.");
  });

  it("closes when they say that's all at the start of an item", async () => {
    const { deps } = fakeDeps();
    const { said, end } = await talk(['One', 'S-1', 'sales invoice', 'nobody', '100', 'skip', 'yes', 'yes', "No, that's all"], deps);
    expect(said[6]).toBe("Saved. That's 1. Any more bills?");
    expect(said[7]).toBe("Okay. Bill 2. What's the bill no.?");
    expect(said[8]).toBe("Thank you, Ravi. I've added 1 bill. Have a good evening.");
    expect(end).toBe(true);
  });

  it('asks twice, then skips an optional field and leaves an item with no required answer for the app', async () => {
    const { deps, saved } = fakeDeps();
    const optional = await talk(['One', 'S-1', 'sales invoice', 'nobody', 'hmm', 'still hmm'], deps);
    expect(optional.said.slice(4)).toEqual(["Sorry, I didn't catch that. What's the total?", "Okay, moving on. What's the due date?"]);
    const required = await talk(['Two', 'S-2', 'a receipt', 'a voucher'], deps);
    expect(required.said.at(-1)).toBe("I couldn't get the bill type, so please add this bill in the app. Next bill. What's the bill no.?");
    expect(saved).toEqual([]);
  });

  it('with a model, takes several answers from one reply', async () => {
    const { deps } = fakeDeps();
    const heard: CollectHeard = { count: null, values: { billNo: 'S-7', total: 'one lakh twenty' }, answer: null, noMore: false, callBack: false };
    const turn = await collectTurn({ ...base, state: { ...newCollectState(), phase: 'field' } }, 'S-7, total one lakh twenty', deps, heard);
    expect(turn.state.item).toEqual({ billNo: 'S-7', total: 120000 });
    expect(turn.say).toBe("What's the bill type: sales invoice, purchase bill, credit note or debit note?");
  });
});

describe('the simulator', () => {
  it('answers like a cooperative clerk until the item is saved, then says that is all', async () => {
    const { deps, saved } = fakeDeps();
    let state = newCollectState();
    for (let i = 0; i < 30 && state.phase !== 'done'; i++) {
      const reply = simulatedCollectReply({ ...base, state });
      state = (await collectTurn({ ...base, state }, reply, deps)).state;
    }
    expect(state.phase).toBe('done');
    expect(saved.length).toBeGreaterThanOrEqual(1);
    expect(saved[0]).toMatchObject({ billType: 'sales invoice' });
  });

  it('suggests replies for the question being asked', () => {
    expect(collectSuggestions({ ...base, state: newCollectState() })).toEqual(['Two', 'None today', 'Can you call me later?']);
    const confirm = { ...newCollectState(), phase: 'confirm' as const };
    expect(collectSuggestions({ ...base, state: confirm })).toEqual(['Yes', 'No, that is wrong']);
  });
});

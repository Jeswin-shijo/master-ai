import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { EscalationSetSchema, PackAgentSchema, type PackAgent, type ResolvedPack } from '@onehuman/schemas';
import { editJobCard, jobCardView, PACK_SET_KEPT } from '../../../src/agents/job-card';

const shared = EscalationSetSchema.parse({ id: 'emergency', label: 'Emergencies', for: 'customer_facing', alert: 'safety-officer', reply: 'Please call 112 now.', words: ['fire', 'gas leak'] });
const desk = PackAgentSchema.parse({
  role: 'front-desk',
  name: 'Front desk',
  description: 'Answers customers.',
  tools: ['records.search', 'message.send', 'refund.issue'],
  job: {
    mission: 'Answer every customer enquiry.',
    customer_facing: true,
    never: ['Refunds'],
    forbid: ['refund.issue'],
    escalate: [{ id: 'allergy', label: 'Allergies', words: ['allergy', 'peanut'] }],
  },
});
const pack = { agents: [desk], escalations: [shared] } as Pick<ResolvedPack, 'agents' | 'escalations'>;
const agent = (spec: PackAgent = desk) => ({ role: 'front-desk', spec });
const asShown = () => jobCardView(agent(), pack)!.escalations.map(({ id, label, words }) => ({ id, label, words }));

describe('the job card owners read', () => {
  it('gives the tools it may use, the ones it never may, and marks what came with the pack', () => {
    expect(jobCardView(agent(), pack)).toEqual({
      mission: 'Answer every customer enquiry.',
      may: ['records.search', 'message.send'],
      never: ['Refunds'],
      customerFacing: true,
      escalations: [
        { id: 'emergency', label: 'Emergencies', words: ['fire', 'gas leak'], reply: 'Please call 112 now.', alert: 'safety-officer', inherited: true, fromPack: true, packWords: ['fire', 'gas leak'] },
        { id: 'allergy', label: 'Allergies', words: ['allergy', 'peanut'], reply: null, alert: 'owner', inherited: false, fromPack: true, packWords: ['allergy', 'peanut'] },
      ],
      forbidden: ['refund.issue'],
      trialDays: 14,
    });
  });

  it('is null for an agent with no card of its own or from its pack', () => {
    const bare = PackAgentSchema.parse({ ...desk, job: undefined });
    expect(jobCardView(agent(bare), { agents: [bare], escalations: [shared] })).toBeNull();
  });
});

describe("an owner's edit", () => {
  it('compares sets by what they say, not by how the stored card orders its keys', () => {
    // Read back from jsonb: keys in jsonb's order, not the order the edit builds them in.
    const stored = JSON.parse(
      '{"role":"front-desk","name":"Front desk","description":"Answers customers.","tools":["records.search"],"job":{"never":["Refunds"],"forbid":[],"metrics":[],"mission":"Answer every customer enquiry.","escalate":[{"id":"emergency","alert":"safety-officer","label":"Emergencies","reply":"Please call 112 now.","words":["fire","gas leak","sparking"]},{"id":"allergy","alert":"owner","label":"Allergies","words":["allergy","peanut"]}],"trial_days":14,"customer_facing":true}}',
    ) as PackAgent;
    const shown = jobCardView(agent(stored), pack)!;
    expect(shown.escalations.find((s) => s.id === 'emergency')).toMatchObject({ words: ['fire', 'gas leak', 'sparking'], packWords: ['fire', 'gas leak'] });
    const sets = shown.escalations.map(({ id, label, words, alert, reply }) => ({ id, label, words, alert, ...(reply && { reply }) }));
    expect(editJobCard(agent(stored), pack, { mission: shown.mission, never: shown.never, escalate: sets }).changed).toEqual([]);
    expect(editJobCard(agent(stored), pack, { mission: 'Answer every enquiry.', escalate: sets }).changed).toEqual(['mission']);
  });

  it('counts pack words however they are written, and keeps them as the owner wrote them', () => {
    const sets = asShown().map((s) => (s.id === 'emergency' ? { ...s, words: ['FIRE ', 'Gas Leak', 'sparking', 'sparking'] } : s));
    const { card } = editJobCard(agent(), pack, { escalate: sets });
    expect(card.escalate).toEqual([
      { id: 'emergency', label: 'Emergencies', words: ['FIRE', 'Gas Leak', 'sparking'], alert: 'safety-officer', reply: 'Please call 112 now.' },
      { id: 'allergy', label: 'Allergies', words: ['allergy', 'peanut'], alert: 'owner' },
    ]);
  });

  it("refuses to shorten or drop an agent's own pack set, and two sets with one id", () => {
    expect(() => editJobCard(agent(), pack, { escalate: asShown().map((s) => (s.id === 'allergy' ? { ...s, words: ['allergy'] } : s)) })).toThrow(PACK_SET_KEPT);
    expect(() => editJobCard(agent(), pack, { escalate: asShown().filter((s) => s.id !== 'allergy') })).toThrow(BadRequestException);
    expect(() => editJobCard(agent(), pack, { escalate: [...asShown(), { id: 'allergy', label: 'Again', words: ['nuts'] }] })).toThrow('Two word sets have the same id');
  });

  it('may move an alert or change a reply, and an inherited set left as it came is not stored', () => {
    const moved = editJobCard(agent(), pack, { escalate: asShown().map((s) => (s.id === 'emergency' ? { ...s, alert: 'owner', reply: 'Call 112.' } : s)) });
    expect(moved.card.escalate[0]).toEqual({ id: 'emergency', label: 'Emergencies', words: ['fire', 'gas leak'], alert: 'owner', reply: 'Call 112.' });
    const same = editJobCard(agent(), pack, { escalate: asShown() });
    expect(same.card.escalate.map((s) => s.id)).toEqual(['allergy']);
    expect(same.changed).toEqual([]);
  });

  it('starts a card from a mission for an agent that had none, and needs the mission to', () => {
    const bare = PackAgentSchema.parse({ ...desk, job: undefined });
    const none = { agents: [bare], escalations: [] };
    expect(() => editJobCard(agent(bare), none, { never: ['Refunds'] })).toThrow('This agent has no job card yet');
    const made = editJobCard(agent(bare), none, { mission: 'Answer every customer enquiry.', never: ['Refunds'] });
    expect(made.card).toMatchObject({ mission: 'Answer every customer enquiry.', never: ['Refunds'], escalate: [], customer_facing: false });
    expect(made.changed).toEqual(['mission', 'never']);
  });
});

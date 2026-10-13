import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Pack } from '@onehuman/schemas';
import { composeOfflinePack, fromWireName, parsePack, resolvePack, toolsForAgent } from '@onehuman/agent-kit';
import { offlineAgentStep, offlinePlan } from './offline';

const PACKS = join(__dirname, '../../../packs');
const registry = new Map<string, Pack>();
for (const dir of readdirSync(PACKS)) {
  const file = join(PACKS, dir, 'pack.yaml');
  if (existsSync(file)) {
    const pack = parsePack(parse(readFileSync(file, 'utf8')));
    registry.set(pack.id, pack);
  }
}
const travel = resolvePack(registry.get('travel-agency')!, (id) => registry.get(id));

describe('offline planner', () => {
  it('picks the workflow whose name fits the goal', () => {
    const plan = offlinePlan('Refund ₹12,000 to Asha Menon because her Munnar trip was cancelled', travel);
    expect(plan.rationale).toMatch(/Refund request/);
    expect(plan.tasks.map((t) => t.agentRole)).toEqual(['booking-coordinator']);
  });

  it('keeps workflow dependencies', () => {
    const plan = offlinePlan('Follow up on all overdue enquiries this week', travel);
    expect(plan.tasks.map((t) => t.key)).toEqual(['find-overdue', 'send-follow-ups']);
    expect(plan.tasks[1]!.dependsOn).toEqual(['find-overdue']);
  });

  it('never plans goal work for the case coordinator', () => {
    for (const goal of ['Close the case for Ravi once the result is verified', 'Proceed with the case and close it', 'Zzzz qqqq']) {
      expect(offlinePlan(goal, travel).tasks.map((t) => t.agentRole)).not.toContain('case-coordinator');
    }
  });

  it('falls back to the best-fitting agent when no workflow matches', () => {
    const plan = offlinePlan('Zzzz qqqq', travel);
    expect(plan.tasks).toHaveLength(1);
  });

  it("uses the case type's workflow when one is given", () => {
    const plan = offlinePlan('Zzzz qqqq', travel, 'disruption-response');
    const wf = travel.workflows.find((w) => w.id === 'disruption-response')!;
    expect(plan.rationale).toContain(wf.name);
    expect(plan.tasks.map((t) => t.key)).toEqual(wf.steps.map((s) => s.key));
  });

  it('ignores a preferred workflow the workspace does not have', () => {
    expect(offlinePlan('Zzzz qqqq', travel, 'no-such-workflow')).toEqual(offlinePlan('Zzzz qqqq', travel));
  });

  it('plans for a generated pack too', () => {
    const clinic = resolvePack(composeOfflinePack('Dental clinic'), (id) => registry.get(id), 'generated');
    const plan = offlinePlan('Book a cleaning appointment for Rahul Nair tomorrow', clinic);
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.tasks.every((t) => clinic.agents.some((a) => a.role === t.agentRole))).toBe(true);
  });
});

describe('offline agent', () => {
  const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
  const tools = toolsForAgent(travel, coordinator.tools);
  const base = {
    goalText: 'Refund ₹12,000 to Asha Menon because her Munnar trip was cancelled',
    taskTitle: 'Check the request and refund',
    taskDescription: 'Find the booking and issue the refund.',
    pack: travel,
    tools,
  };

  it('looks before it acts', () => {
    const out = offlineAgentStep({ ...base, history: [] });
    expect(fromWireName(out.toolCalls![0]!.name)).toMatch(/search/);
  });

  it('then proposes the action with details from the goal', () => {
    const out = offlineAgentStep({
      ...base,
      history: [{ tool: 'records.search', status: 'executed', args: {}, result: { count: 0, records: [] }, error: null }],
    });
    const call = out.toolCalls![0]!;
    expect(fromWireName(call.name)).toBe('refund.issue');
    expect(call.input).toMatchObject({ amount: 12000, recipient: 'Asha Menon', reason: 'her Munnar trip was cancelled' });
  });

  it('finishes and reports a rejection', () => {
    const out = offlineAgentStep({
      ...base,
      history: [
        { tool: 'records.search', status: 'executed', args: {}, result: { count: 0 }, error: null },
        { tool: 'refund.issue', status: 'rejected', args: {}, result: null, error: null, notes: 'Wait for supplier' },
      ],
    });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('task.finish');
    expect(String(out.toolCalls![0]!.input.summary)).toMatch(/^You said no to: refund .*\("Wait for supplier"\)\.$/);
  });
});

describe('offline planner: cancellations', () => {
  it('routes a cancellation to the cancel workflow, not the booking one', () => {
    const plan = offlinePlan('Cancel the booking for Rahul Nair, he is not travelling', travel);
    expect(plan.rationale).toMatch(/Cancel a booking/);
  });

  it('searches for the person named in the goal', () => {
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    const out = offlineAgentStep({
      goalText: 'Cancel the booking for Rahul Nair',
      taskTitle: 'Cancel the booking',
      taskDescription: "Find the customer's Booking record and cancel it.",
      pack: travel,
      tools: toolsForAgent(travel, coordinator.tools),
      history: [],
    });
    expect(out.toolCalls![0]!.input).toMatchObject({ entity: 'Booking', query: 'Rahul Nair' });
  });
});

describe('offline agent: no invented money', () => {
  it('does not propose a refund when no amount is known', () => {
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    const out = offlineAgentStep({
      goalText: 'Sort out a refund for Rahul Nair',
      taskTitle: 'Refund the customer',
      taskDescription: 'Issue the refund.',
      pack: travel,
      tools: toolsForAgent(travel, coordinator.tools).filter((t) => t.name === 'refund.issue'),
      history: [],
    });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('task.finish');
  });

  it('cancels when the task title says cancel', () => {
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    const out = offlineAgentStep({
      goalText: 'Cancel the booking for Rahul Nair, he is not travelling',
      taskTitle: 'Cancel the booking',
      taskDescription: "Find the customer's Booking record and cancel it. If they already paid, a refund can follow.",
      pack: travel,
      tools: toolsForAgent(travel, coordinator.tools),
      history: [{ tool: 'records.search', status: 'executed', args: {}, result: { count: 1, records: [{ id: 'b-1', customerName: 'Rahul Nair' }] }, error: null }],
    });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('booking.cancel');
    expect(out.toolCalls![0]!.input).toMatchObject({ id: 'b-1' });
  });
});

describe('offline agent: stays on task', () => {
  it('reports "not found" instead of falling back to a different action', () => {
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    const out = offlineAgentStep({
      goalText: 'Cancel the booking for Rahul Nair',
      taskTitle: 'Cancel the booking',
      taskDescription: 'If they already paid, a refund can follow.',
      pack: travel,
      tools: toolsForAgent(travel, coordinator.tools),
      history: [{ tool: 'records.search', status: 'executed', args: {}, result: { count: 0, records: [] }, error: null }],
    });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('task.finish');
    expect(String(out.toolCalls![0]!.input.summary)).toBe('Could not mark the booking as cancelled: nothing matching was found, so nothing was changed.');
  });

  it('takes search filters from the owner, not from instructions', () => {
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    const out = offlineAgentStep({
      goalText: 'Cancel the booking for Rahul Nair',
      taskTitle: 'Cancel the booking',
      taskDescription: 'If they already paid, a refund can follow.',
      pack: travel,
      tools: toolsForAgent(travel, coordinator.tools),
      history: [],
    });
    expect(out.toolCalls![0]!.input).not.toHaveProperty('filter');
  });
});

describe('offline agent: delegation', () => {
  const core = resolvePack(registry.get('core-business')!, (id) => registry.get(id));
  const coordinator = core.agents.find((a) => a.role === 'work-coordinator')!;
  const team = [
    { name: 'Ravi Kumar', title: 'Operations manager', responsibilities: ['hotels', 'inspections'] },
    { name: 'Meera Joseph', title: 'Accounts executive', responsibilities: ['payments', 'invoices'] },
  ];
  const base = {
    goalText: 'Collect the pending invoice payments from Sharma Traders by Friday',
    taskTitle: 'Delegate to the person in charge',
    taskDescription: 'Pick the team member in charge of this work and delegate it by phone.',
    pack: core,
    tools: toolsForAgent(core, coordinator.tools),
    team,
  };

  it('delegates straight away to the best-matching person, with the deadline', () => {
    const out = offlineAgentStep({ ...base, history: [] });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('staff.delegate');
    expect(out.toolCalls![0]!.input).toMatchObject({ assignee: 'Meera Joseph', task: base.goalText });
    expect(out.toolCalls![0]!.input.due).toBeTruthy();
  });

  it('finishes with what the person confirmed', () => {
    const out = offlineAgentStep({
      ...base,
      history: [{ tool: 'staff.delegate', status: 'executed', args: {}, result: { status: 'done', summary: "Meera confirmed it's done." }, error: null }],
    });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('task.finish');
    expect(String(out.toolCalls![0]!.input.summary)).toContain("Meera confirmed it's done");
  });
});

describe('offline agent: follow-ups on enquiries (construction)', () => {
  const construction = resolvePack(composeOfflinePack('Construction company'), (id) => registry.get(id), 'generated');
  const agent = construction.agents.find((a) => a.role === 'follow-up-agent')!;
  const enquiries = [
    { id: 'e-1', customerName: 'Priya Sharma', subject: 'Villa site visit', status: 'contacted' },
    { id: 'e-2', customerName: 'Arjun Rao', subject: 'Office fit-out', status: 'new' },
    { id: 'e-3', customerName: 'Neha Iyer', subject: 'Kitchen remodel', status: 'new' },
  ];
  const searched = { tool: 'records.search', status: 'executed', args: { entity: 'Enquiry' }, result: { entity: 'Enquiry', count: 3, records: enquiries }, error: null };
  const base = {
    goalText: 'Follow up on every enquiry that has been waiting more than two days',
    taskTitle: 'Follow up with clients',
    taskDescription: 'Contact each waiting enquiry and mark it as contacted.',
    pack: construction,
    tools: toolsForAgent(construction, agent.tools),
  };

  it('looks up the records the action changes, not the ones the title mentions', () => {
    const out = offlineAgentStep({ ...base, history: [] });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('records.search');
    expect(out.toolCalls![0]!.input).toMatchObject({ entity: 'Enquiry' });
  });

  it('acts on each waiting enquiry in turn, skipping ones already contacted', () => {
    const first = offlineAgentStep({ ...base, history: [searched] });
    expect(fromWireName(first.toolCalls![0]!.name)).toBe('enquiry.mark_contacted');
    expect(first.toolCalls![0]!.input).toMatchObject({ id: 'e-2' });

    const marked = (r: (typeof enquiries)[number]) => ({ tool: 'enquiry.mark_contacted', status: 'executed', args: { id: r.id }, result: { updated: true, id: r.id, entity: 'Enquiry', data: { ...r, status: 'contacted' } }, error: null });
    const second = offlineAgentStep({ ...base, history: [searched, marked(enquiries[1]!)] });
    expect(second.toolCalls![0]!.input).toMatchObject({ id: 'e-3' });

    const done = offlineAgentStep({ ...base, history: [searched, marked(enquiries[1]!), marked(enquiries[2]!)] });
    expect(fromWireName(done.toolCalls![0]!.name)).toBe('task.finish');
    expect(done.toolCalls![0]!.input.summary).toBe(
      'Marked Arjun Rao\'s enquiry ("Office fit-out") as contacted. Marked Neha Iyer\'s enquiry ("Kitchen remodel") as contacted.',
    );
  });

  it('never moves a record backwards (a quoted enquiry is past contacted)', () => {
    const quoted = { ...searched, result: { entity: 'Enquiry', count: 2, records: [{ ...enquiries[1]!, status: 'quoted' }, enquiries[2]!] } };
    const out = offlineAgentStep({ ...base, history: [quoted] });
    expect(out.toolCalls![0]!.input).toMatchObject({ id: 'e-3' });
  });

  it('only looks things up when the task says find, and reports what it found', () => {
    const find = { ...base, taskTitle: 'Find enquiries waiting on a reply' };
    expect(fromWireName(offlineAgentStep({ ...find, history: [] }).toolCalls![0]!.name)).toBe('records.search');
    const out = offlineAgentStep({ ...find, history: [searched] });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('task.finish');
    expect(out.toolCalls![0]!.input.summary).toMatch(/^Looked up enquiries and found 3\.\n• Priya Sharma — Villa site visit · contacted/);
  });
});

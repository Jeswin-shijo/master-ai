import { describe, expect, it } from 'vitest';
import type { PackInput } from '@onehuman/schemas';
import {
  applyPackUpdates,
  countPackUpdates,
  definePack,
  escalationsFor,
  jobById,
  jobsFor,
  packUpdates,
  requestJobsFor,
  resolvePack,
  validateJobs,
  validatePackRefs,
} from '../../src/index';

const set = (id: string, words: string[], extra: Record<string, unknown> = {}) => ({ id, label: id, words, ...extra });

function base(over: Record<string, unknown> = {}): PackInput {
  return {
    id: 'shop',
    version: '1.0.0',
    name: 'Shop',
    description: 'A shop',
    entities: [
      {
        name: 'Order',
        label: 'Order',
        fields: [
          { name: 'title', label: 'Title', type: 'string', required: true },
          { name: 'amount', label: 'Amount', type: 'money' },
          { name: 'due', label: 'Due', type: 'date' },
        ],
      },
    ],
    agents: [
      {
        role: 'front-desk',
        name: 'Front desk',
        description: 'Talks to customers',
        tools: ['records.search', 'payment.request', 'message.draft'],
        job: { mission: 'Answer customers', customer_facing: true, forbid: ['refund.issue'], escalate: [set('angry', ['furious', 'sue'], { alert: 'owner' })] },
      },
      { role: 'back-office', name: 'Back office', description: 'Does paperwork', tools: ['records.search', 'message.draft'] },
    ],
    escalations: [
      set('safety', ['fire', 'injury'], { for: 'all', alert: 'owner' }),
      set('angry', ['complaint', 'legal'], { for: 'customer_facing', alert: 'owner', reply: 'A person will call you.' }),
    ],
    ...over,
  } as PackInput;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const job = (steps: any[], over: Record<string, unknown> = {}) => ({
  id: 'bill',
  name: 'Bill',
  description: 'Bills',
  agent: 'front-desk',
  trigger: { manual: {} },
  steps,
  ...over,
});

const resolve = (input: PackInput) => resolvePack(definePack(input), () => undefined);

describe('resolvePack with job cards', () => {
  it('derives a forbid policy per job.forbid tool', () => {
    const p = resolve(base());
    expect(p.policies).toContainEqual(
      expect.objectContaining({ id: 'job-forbid-front-desk-refund-issue', action: 'refund.issue', agent: 'front-desk', forbid: true }),
    );
  });

  it('lets an explicit policy with the same id win', () => {
    const p = resolve(
      base({ policies: [{ id: 'job-forbid-front-desk-refund-issue', action: 'refund.issue', agent: 'front-desk', require_approval: true }] }),
    );
    const rules = p.policies.filter((r) => r.id === 'job-forbid-front-desk-refund-issue');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.forbid).toBeUndefined();
  });

  it('merges jobs and escalations by id down the extends chain', () => {
    const parent = definePack({ ...base(), id: 'parent', jobs: [job([{ read: { as: 'o', from: 'trigger' } }])] });
    const child = definePack({
      id: 'child', version: '1.0.0', name: 'Child', description: 'c', extends: ['parent'],
      jobs: [job([{ read: { as: 'o', from: 'trigger' } }], { name: 'Bill 2' })],
      escalations: [set('safety', ['flood'], { for: 'all' })],
    });
    const p = resolvePack(child, (id) => (id === 'parent' ? parent : undefined));
    expect(p.jobs).toHaveLength(1);
    expect(p.jobs[0]!.name).toBe('Bill 2');
    expect(p.escalations.find((e) => e.id === 'safety')!.words).toEqual(['flood']);
  });
});

describe('escalationsFor', () => {
  it('gives customer-facing agents the customer sets and every agent the all sets', () => {
    const p = resolve(base());
    expect(escalationsFor(p, 'front-desk').map((e) => e.id)).toEqual(['safety', 'angry']);
    expect(escalationsFor(p, 'back-office').map((e) => e.id)).toEqual(['safety']);
    expect(escalationsFor(p, 'nobody').map((e) => e.id)).toEqual(['safety']);
  });

  it('merges an own set into a shared one by id', () => {
    const p = resolve(base());
    const angry = escalationsFor(p, 'front-desk').find((e) => e.id === 'angry')!;
    expect(angry.words).toEqual(['complaint', 'legal', 'furious', 'sue']);
    expect(angry.inherited).toBe(true);
    expect(angry.fromPack).toBe(true);
    expect(angry.reply).toBe('A person will call you.');
  });

  it('keeps an own set that matches no shared one, not inherited', () => {
    const p = resolve(base({ escalations: [] }));
    const own = escalationsFor(p, 'front-desk');
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ id: 'angry', inherited: false, fromPack: true });
  });
});

describe('jobsFor and jobById', () => {
  it('finds jobs by agent and id', () => {
    const p = resolve(base({ jobs: [job([{ read: { as: 'o', from: 'trigger' } }])] }));
    expect(jobsFor(p, 'front-desk')).toHaveLength(1);
    expect(jobsFor(p, 'back-office')).toHaveLength(0);
    expect(jobById(p, 'bill')?.id).toBe('bill');
    expect(jobById(p, 'nope')).toBeUndefined();
  });

  it('finds the request jobs for a category and a point of the case, in pack order; any covers every category', () => {
    const steps = [{ read: { as: 'o', from: 'trigger' } }];
    const p = resolve(
      base({
        jobs: [
          job(steps, { id: 'late', trigger: { request: { categories: ['refund'] } } }),
          job(steps, { id: 'first-reply', trigger: { request: { categories: ['any'], at: 'arrival' } } }),
          job(steps, { id: 'refund-reply', trigger: { request: { categories: ['refund'], at: 'arrival' } } }),
          job(steps, { id: 'nightly', trigger: { schedule: { time: '21:00' } } }),
        ],
      }),
    );
    expect(requestJobsFor(p, 'refund', 'arrival').map((j) => j.id)).toEqual(['first-reply', 'refund-reply']);
    expect(requestJobsFor(p, 'billing', 'arrival').map((j) => j.id)).toEqual(['first-reply']);
    expect(requestJobsFor(p, null, 'arrival').map((j) => j.id)).toEqual(['first-reply']);
    expect(requestJobsFor(p, 'refund', 'execute').map((j) => j.id)).toEqual(['late']);
    expect(requestJobsFor(p, 'billing', 'execute')).toEqual([]);
  });
});

describe('validateJobs', () => {
  const aiThenAct = (args: Record<string, unknown>, tool = 'payment.request') =>
    resolve(
      base({
        jobs: [
          job([
            { read: { as: 'order', from: 'records', entity: 'Order' } },
            { ai: { as: 'draft', task: 'Work out the amount', output: [{ name: 'amount', type: 'money' }], data: ['order'] } },
            { act: { as: 'pay', tool, args } },
          ]),
        ],
      }),
    );

  it('accepts a valid job', () => {
    const p = aiThenAct({ amount: '{{order.amount}}', payer: 'x', purpose: 'y' });
    expect(validateJobs(p)).toEqual([]);
    expect(validatePackRefs(p).filter((m) => /job/.test(m))).toEqual([]);
  });

  it('refuses a money argument fed by an ai result', () => {
    const p = aiThenAct({ amount: '{{draft.amount}}', payer: 'x', purpose: 'y' });
    expect(validateJobs(p).join('\n')).toMatch(/money/);
    expect(validatePackRefs(p).join('\n')).toMatch(/money/);
  });

  it('refuses any argument of a money-moving tool fed by an ai result', () => {
    const p = aiThenAct({ amount: '{{order.amount}}', payer: '{{draft.name}}', purpose: 'y' });
    expect(validateJobs(p).join('\n')).toMatch(/money/);
  });

  it('refuses a money argument derived through a calc over an ai result', () => {
    const p = resolve(
      base({
        jobs: [
          job([
            { ai: { as: 'draft', task: 't', output: [{ name: 'n', type: 'number' }] } },
            { check: { on_fail: 'stop', message: 'm', as: 'total', calc: { expr: 'draft.n * 2' } } },
            { act: { as: 'pay', tool: 'payment.request', args: { amount: '{{total}}' } } },
          ]),
        ],
      }),
    );
    expect(validateJobs(p).join('\n')).toMatch(/money/);
  });

  it('refuses a money argument when an alias downgrades the risk', () => {
    const p = resolve(
      base({
        tools: [{ name: 'pay.link', description: 'd', uses: 'payment.request', risk: { moves_money: false } }],
        agents: [
          { role: 'front-desk', name: 'F', description: 'd', tools: ['pay.link', 'message.draft'], job: { mission: 'm' } },
        ],
        jobs: [
          job([
            { ai: { as: 'draft', task: 't', output: [{ name: 'who', type: 'text' }] } },
            { act: { as: 'pay', tool: 'pay.link', args: { payer: '{{draft.who}}', amount: '5' } } },
          ]),
        ],
      }),
    );
    expect(validateJobs(p).join('\n')).toMatch(/money/);
  });

  it('refuses money laundered through an act result', () => {
    const p = resolve(
      base({
        jobs: [
          job([
            { ai: { as: 'draft', task: 't', output: [{ name: 'x', type: 'text' }] } },
            { act: { as: 'm', tool: 'message.draft', args: { text: '{{draft.x}}' } } },
            { act: { as: 'pay', tool: 'payment.request', args: { amount: '{{m.text}}' } } },
          ]),
        ],
      }),
    );
    expect(validateJobs(p).join('\n')).toMatch(/money/);
  });

  it('refuses spaced, nested and array amount references', () => {
    const run = (args: Record<string, unknown>) =>
      validateJobs(
        resolve(
          base({
            jobs: [
              job([
                { ai: { as: 'draft', task: 't', output: [{ name: 'amount', type: 'money' }] } },
                { act: { as: 'a', tool: 'message.draft', args } },
              ]),
            ],
          }),
        ),
      ).join('\n');
    expect(run({ amount: '{{ draft.amount }}' })).toMatch(/money/);
    expect(run({ lines: { amount: '{{draft.amount}}' } })).toMatch(/money/);
    expect(run({ lines: [{ amount: '{{draft.amount}}' }] })).toMatch(/money/);
  });

  it('accepts an amount from a record the AI only picked', () => {
    const p = resolve(
      base({
        jobs: [
          job([
            { ai: { as: 'draft', task: 't', output: [{ name: 'id', type: 'text' }] } },
            { read: { as: 'rec', from: 'records', entity: 'Order', query: '{{draft.id}}' } },
            { act: { as: 'pay', tool: 'payment.request', args: { amount: '{{rec.total}}', payer: 'x', purpose: 'y' } } },
          ]),
        ],
      }),
    );
    expect(validateJobs(p).filter((m) => /money/.test(m))).toEqual([]);
  });

  it('accepts a money argument from a read result', () => {
    const p = aiThenAct({ amount: '{{order.amount}}', payer: '{{order.title}}', purpose: 'y' });
    expect(validateJobs(p).filter((m) => /money/.test(m))).toEqual([]);
  });

  it('refuses a template that points at a later step', () => {
    const p = resolve(
      base({
        jobs: [
          job([
            { act: { as: 'a', tool: 'message.draft', args: { text: '{{later.text}}' } } },
            { read: { as: 'later', from: 'trigger' } },
          ]),
        ],
      }),
    );
    expect(validateJobs(p).join('\n')).toMatch(/later/);
  });

  it('allows trigger and today in templates', () => {
    const p = resolve(
      base({ jobs: [job([{ act: { as: 'a', tool: 'message.draft', args: { text: '{{trigger.text}} {{today}}' } } }])] }),
    );
    expect(validateJobs(p)).toEqual([]);
  });

  it('refuses an act tool the agent does not hold', () => {
    const p = resolve(base({ jobs: [job([{ act: { as: 'a', tool: 'schedule.create', args: {} } }])] }));
    expect(validateJobs(p).join('\n')).toMatch(/bill.*schedule\.create/);
  });

  it('refuses a forbidden act tool', () => {
    const input = base();
    (input.agents![0] as { tools: string[] }).tools.push('refund.issue');
    const p = resolve({ ...input, jobs: [job([{ act: { as: 'a', tool: 'refund.issue', args: {} } }])] } as PackInput);
    expect(validateJobs(p).join('\n')).toMatch(/forbid/);
  });

  it('refuses an unknown agent, a card-less agent, unknown entity and list, and duplicate names', () => {
    expect(validateJobs(resolve(base({ jobs: [job([{ read: { as: 'o', from: 'trigger' } }], { agent: 'ghost' })] })))).not.toEqual([]);
    expect(validateJobs(resolve(base({ jobs: [job([{ read: { as: 'o', from: 'trigger' } }], { agent: 'back-office' })] }))).join()).toMatch(/job card/);
    expect(validateJobs(resolve(base({ jobs: [job([{ read: { as: 'o', from: 'records', entity: 'Nope' } }])] }))).join()).toMatch(/Nope/);
    expect(validateJobs(resolve(base({ jobs: [job([{ read: { as: 'o', from: 'list', list: 'nope' } }])] }))).join()).toMatch(/nope/);
    expect(
      validateJobs(resolve(base({ jobs: [job([{ read: { as: 'o', from: 'trigger' } }, { read: { as: 'o', from: 'trigger' } }])] }))).join(),
    ).toMatch(/twice|unique|duplicate/);
  });

  it('checks triggers: request categories, record entity, list due field', () => {
    const steps = [{ read: { as: 'o', from: 'trigger' } }];
    expect(validateJobs(resolve(base({ jobs: [job(steps, { trigger: { request: { categories: ['zzz'] } } })] }))).join()).toMatch(/zzz/);
    expect(validateJobs(resolve(base({ jobs: [job(steps, { trigger: { record: { entity: 'Nope' } } })] }))).join()).toMatch(/Nope/);
    expect(validateJobs(resolve(base({ jobs: [job(steps, { trigger: { list: { list: 'order', due: { overdue: { date: 'nope' } } } } })] }))).join()).toMatch(/nope/);
    expect(validateJobs(resolve(base({ jobs: [job(steps, { trigger: { list: { list: 'order', due: { overdue: { date: 'due' } } } } })] })))).toEqual([]);
  });

  it('accepts the special request category any, alone or beside real ones', () => {
    const steps = [{ read: { as: 'o', from: 'trigger' } }];
    const p = (categories: string[], at: 'arrival' | 'execute') => resolve(base({ jobs: [job(steps, { trigger: { request: { categories, at } } })] }));
    expect(validateJobs(p(['any'], 'arrival'))).toEqual([]);
    expect(validateJobs(p(['any'], 'execute'))).toEqual([]);
    expect(validateJobs(p(['any', 'zzz'], 'arrival')).join()).toMatch(/zzz/);
  });

  it('refuses an escalate check that only flags: it must hand to a person or stop', () => {
    const escalate = (on_fail: string) => [{ check: { on_fail, message: 'm', escalate: { text: '{{trigger.text}}' } } }];
    expect(validateJobs(resolve(base({ jobs: [job(escalate('flag'))] }))).join()).toMatch(/escalate check must hand to a person or stop/);
    expect(validateJobs(resolve(base({ jobs: [job(escalate('person'))] })))).toEqual([]);
    expect(validateJobs(resolve(base({ jobs: [job(escalate('stop'))] })))).toEqual([]);
  });

  it('needs an escalation set for an escalate check', () => {
    const steps = [{ check: { on_fail: 'person', message: 'm', escalate: { text: '{{trigger.text}}' } } }];
    const none = resolve(base({ escalations: [], agents: [{ role: 'front-desk', name: 'F', description: 'd', tools: ['message.draft'], job: { mission: 'm' } }], jobs: [job(steps)] }));
    expect(validateJobs(none).join()).toMatch(/escalat/);
    expect(validateJobs(resolve(base({ jobs: [job(steps)] })))).toEqual([]);
  });

  it('refuses ai data naming a later or unknown result', () => {
    const p = resolve(
      base({ jobs: [job([{ ai: { as: 'd', task: 't', output: [{ name: 'x', type: 'text' }], data: ['ghost'] } }])] }),
    );
    expect(validateJobs(p).join()).toMatch(/ghost/);
  });
});

describe('packUpdates for jobs', () => {
  const installedInput = (): PackInput => {
    const b = base();
    (b.agents![0] as { job?: unknown }).job = undefined;
    return { ...b, escalations: [set('safety', ['fire'], { for: 'all' })] } as PackInput;
  };
  const withJob = (extra: unknown[] = []) =>
    base({
      jobs: [job([{ read: { as: 'o', from: 'trigger' } }]), ...extra],
    });

  it('offers new jobs, sets and missing job cards as updates, and never replaces an installed card', () => {
    const installed = resolve(installedInput());
    const latest = resolve(withJob());
    const u = packUpdates(installed, latest);
    expect(u.jobs!.map((j) => j.id)).toEqual(['bill']);
    expect(u.escalations!.map((e) => e.id)).toEqual(['angry']);
    expect(u.jobCards!.map((c) => c.role)).toEqual(['front-desk']);
    expect(countPackUpdates(u)).toBeGreaterThanOrEqual(3);
    const applied = applyPackUpdates(installed, u);
    expect(applied.agents.find((a) => a.role === 'front-desk')!.job?.mission).toBe('Answer customers');
    expect(applied.jobs).toHaveLength(1);
    expect(applied.escalations).toHaveLength(2);
    expect(validatePackRefs(applied).filter((m) => /job|escalat/.test(m))).toEqual([]);

    // The installed card is never replaced.
    const again = packUpdates(applied, resolve(withJob()));
    expect(again.jobCards).toEqual([]);
    const edited = resolve(withJob());
    const custom = { ...applied, agents: applied.agents.map((a) => (a.role === 'front-desk' ? { ...a, job: { ...a.job!, mission: 'Mine' } } : a)) };
    expect(packUpdates(custom, edited).jobCards).toEqual([]);
  });

  it('leaves out a job whose agent will not exist or that fails validation', () => {
    const installed = resolve(installedInput());
    const bad = job([{ act: { as: 'a', tool: 'schedule.create', args: {} } }], { id: 'bad' });
    const ghost = job([{ read: { as: 'o', from: 'trigger' } }], { id: 'ghost', agent: 'ghost' });
    const latest = resolve(base({ jobs: [bad, ghost] }));
    expect(packUpdates(installed, latest).jobs).toEqual([]);
  });

  it('tolerates old updates with the new fields missing', () => {
    const installed = resolve(base());
    const u = packUpdates(installed, installed);
    const old = { ...u, escalations: undefined, jobs: undefined, jobCards: undefined };
    expect(countPackUpdates(old)).toBe(0);
    expect(applyPackUpdates(installed, old).jobs).toEqual([]);
  });
});

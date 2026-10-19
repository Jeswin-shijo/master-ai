import { describe, expect, it } from 'vitest';
import type { AiStepDef, OutputField } from '@onehuman/schemas';
import { aiOfflineOutput, aiOutputJsonSchema, aiOutputSchema } from '../../src/jobs';

const fields: OutputField[] = [
  { name: 'reply', type: 'text', required: true },
  { name: 'amount', type: 'money', required: false },
  { name: 'kind', type: 'choice', options: ['a', 'b'], required: false },
  { name: 'tags', type: 'list', required: false },
];
const ok = { reply: 'hi', amount: null, kind: null, tags: [], needs_person: false, needs_person_reason: null };

describe('aiOutputSchema', () => {
  it('rejects null for a required text field', () => {
    expect(aiOutputSchema(fields, false).safeParse({ ...ok, reply: null }).success).toBe(false);
    expect(aiOutputSchema(fields, false).safeParse(ok).success).toBe(true);
  });
  it('always requires needs_person', () => {
    const { needs_person: _n, ...rest } = ok;
    expect(aiOutputSchema(fields, false).safeParse(rest).success).toBe(false);
  });
  it('is strict about choices and extra keys', () => {
    expect(aiOutputSchema(fields, false).safeParse({ ...ok, kind: 'z' }).success).toBe(false);
    expect(aiOutputSchema(fields, false).safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
  it('grounded adds sources', () => {
    expect(aiOutputSchema(fields, true).safeParse(ok).success).toBe(false);
    expect(aiOutputSchema(fields, true).safeParse({ ...ok, sources: ['p1'] }).success).toBe(true);
  });
  it('json schema has no $schema', () => {
    const s = aiOutputJsonSchema(fields, true);
    expect(s).not.toHaveProperty('$schema');
    expect(s).toHaveProperty('properties');
  });
});

const step = (over: Partial<AiStepDef>): AiStepDef => ({
  as: 'draft',
  task: 't',
  output: [{ name: 'reply', type: 'text', required: false }, { name: 'note', type: 'text', required: false }],
  data: [],
  grounded: false,
  customer: false,
  ...over,
});

describe('aiOfflineOutput', () => {
  it('fills from the offline templates', () => {
    const out = aiOfflineOutput(step({ offline: { reply: 'Thanks {{trigger.name}}' } }), { trigger: { name: 'Ravi' } });
    expect(out).toMatchObject({ reply: 'Thanks Ravi', note: null, needs_person: false });
  });
  it('asks for a person without templates', () => {
    expect(aiOfflineOutput(step({}), {})).toMatchObject({
      reply: null,
      note: null,
      needs_person: true,
      needs_person_reason: 'No AI model is available for this step',
    });
  });
});

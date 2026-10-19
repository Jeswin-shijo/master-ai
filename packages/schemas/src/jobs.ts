import { z } from 'zod';
import { ConditionsSchema, DueRuleSchema, SlugSchema, ToolNameSchema } from './common';

/**
 * Job cards and jobs. A job card says what an agent is for and where it stops;
 * a job is a script of steps (read, ask the AI, check, act) that a trigger
 * starts. Keys are snake_case because packs are authored as YAML.
 */

const camelName = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'camelCase name');
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

/** Words that make an agent stop and hand over to a person, and what happens then. */
export const EscalationSetSchema = z.strictObject({
  id: SlugSchema,
  label: z.string().min(1),
  words: z.array(z.string().min(1)).min(1),
  /** What the agent says to the customer before handing over. */
  reply: z.string().min(1).optional(),
  /** Who is alerted: `owner` or a role name. */
  alert: z.string().min(1).default('owner'),
  /** Applies only to customer-facing agents, or to all. */
  for: z.enum(['customer_facing', 'all']).optional(),
});
export type EscalationSet = z.infer<typeof EscalationSetSchema>;

/** What an agent is for, what it never does and when it stops and asks. */
export const JobCardSchema = z.strictObject({
  mission: z.string().min(1).max(300),
  never: z.array(z.string().min(1)).default([]),
  customer_facing: z.boolean().default(false),
  escalate: z.array(EscalationSetSchema).default([]),
  /** Tools the agent may not use, whatever its pack gives it. */
  forbid: z.array(ToolNameSchema).default([]),
  /** Days of trial runs before the agent works on its own. */
  trial_days: z.number().int().min(1).max(90).default(14),
  metrics: z.array(z.string().min(1)).default([]),
});
export type JobCard = z.infer<typeof JobCardSchema>;

/** One thing the AI step hands back. */
export const OutputFieldSchema = z
  .strictObject({
    name: camelName,
    type: z.enum(['text', 'number', 'money', 'date', 'yes_no', 'choice', 'list']),
    options: z.array(z.string().min(1)).min(1).optional(),
    required: z.boolean().default(false),
    describe: z.string().min(1).optional(),
  })
  .refine((f) => f.type !== 'choice' || (f.options !== undefined && f.options.length > 0), {
    message: 'a choice field needs options',
    path: ['options'],
  });
export type OutputField = z.infer<typeof OutputFieldSchema>;

const exactlyOne = (keys: readonly string[]) => (o: Record<string, unknown>) =>
  keys.filter((k) => o[k] !== undefined).length === 1;

const TRIGGER_KINDS = ['request', 'schedule', 'list', 'record', 'manual'] as const;

/** What starts a job. Exactly one of the five kinds. */
export const JobTriggerSchema = z
  .strictObject({
    request: z
      .strictObject({
        categories: z.array(SlugSchema).min(1),
        at: z.enum(['arrival', 'execute']).default('execute'),
      })
      .optional(),
    schedule: z
      .strictObject({
        /** 0 = Sunday … 6 = Saturday. */
        days: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5, 6]),
        time: HHMM,
      })
      .optional(),
    list: z
      .strictObject({
        list: SlugSchema,
        due: DueRuleSchema,
        when: ConditionsSchema.optional(),
      })
      .optional(),
    record: z
      .strictObject({
        entity: z.string().min(1),
        on: z.enum(['created', 'updated', 'either']).default('either'),
        when: ConditionsSchema.optional(),
      })
      .optional(),
    manual: z
      .strictObject({
        /** The label of the text box the person types into. */
        input: z.string().min(1).optional(),
      })
      .optional(),
  })
  .refine(exactlyOne(TRIGGER_KINDS), 'a trigger has exactly one of request, schedule, list, record or manual');
export type JobTrigger = z.infer<typeof JobTriggerSchema>;
export type JobTriggerKind = (typeof TRIGGER_KINDS)[number];

const ReadStepBodySchema = z.strictObject({
  as: camelName,
  from: z.enum(['trigger', 'records', 'list', 'knowledge']),
  entity: z.string().min(1).optional(),
  list: SlugSchema.optional(),
  query: z.string().min(1).optional(),
  when: ConditionsSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type ReadStepDef = z.infer<typeof ReadStepBodySchema>;

const AiStepBodySchema = z.strictObject({
  as: camelName,
  task: z.string().min(1),
  output: z.array(OutputFieldSchema).min(1),
  /** Names of earlier results the AI may see. */
  data: z.array(z.string().min(1)).default([]),
  grounded: z.boolean().default(false),
  words_max: z.number().int().positive().optional(),
  /** The text goes to a customer, so the card's customer rules apply. */
  customer: z.boolean().default(false),
  /** What the offline strategy answers, by output field name. */
  offline: z.record(z.string(), z.string()).optional(),
});
export type AiStepDef = z.infer<typeof AiStepBodySchema>;

const ActStepBodySchema = z.strictObject({
  as: camelName,
  tool: ToolNameSchema,
  args: z.record(z.string(), z.unknown()),
});
export type ActStepDef = z.infer<typeof ActStepBodySchema>;

const numOrRef = z.union([z.number(), z.string()]);

const CHECK_KINDS = [
  'escalate',
  'required',
  'in_data',
  'limit',
  'adds_up',
  'within_days',
  'duplicate',
  'says_not',
  'valid',
  'calc',
] as const;

/** A fixed check on a job's data. The app works it out, never a model. */
export const JobCheckSchema = z
  .strictObject({
    on_fail: z.enum(['stop', 'person', 'flag']),
    message: z.string().min(1),
    as: camelName.optional(),
    escalate: z.strictObject({ text: z.string().min(1) }).optional(),
    required: z.strictObject({ fields: z.array(z.string().min(1)).min(1) }).optional(),
    in_data: z.strictObject({ value: z.string().min(1), among: z.string().min(1) }).optional(),
    limit: z
      .strictObject({
        value: z.string().min(1),
        max: numOrRef.optional(),
        min: numOrRef.optional(),
        factor: z.number().default(1),
      })
      .refine((l) => (l.max === undefined) !== (l.min === undefined), 'a limit needs exactly one of max or min')
      .optional(),
    adds_up: z
      .strictObject({
        total: z.string().min(1),
        plus: z.array(z.string().min(1)),
        minus: z.array(z.string().min(1)).default([]),
        tolerance: z.number().nonnegative().default(1),
      })
      .optional(),
    within_days: z.strictObject({ date: z.string().min(1), days: z.number().int() }).optional(),
    duplicate: z.strictObject({ key: z.string().min(1) }).optional(),
    says_not: z.strictObject({ text: z.string().min(1), phrases: z.array(z.string().min(1)).min(1) }).optional(),
    valid: z
      .strictObject({ value: z.string().min(1), as: z.enum(['gstin', 'pan', 'ifsc', 'pincode']) })
      .optional(),
    calc: z.strictObject({ expr: z.string().min(1) }).optional(),
  })
  .refine(exactlyOne(CHECK_KINDS), 'a check has exactly one of ' + CHECK_KINDS.join(', '))
  .refine((c) => c.calc === undefined || c.as !== undefined, {
    message: 'a calc check needs as, the name its result is kept under',
    path: ['as'],
  });
export type JobCheck = z.infer<typeof JobCheckSchema>;

const STEP_KINDS = ['read', 'ai', 'check', 'act'] as const;

/** One step of a job. Exactly one of read, ai, check or act. */
export const JobStepSchema = z
  .strictObject({
    read: ReadStepBodySchema.optional(),
    ai: AiStepBodySchema.optional(),
    check: JobCheckSchema.optional(),
    act: ActStepBodySchema.optional(),
  })
  .refine(exactlyOne(STEP_KINDS), 'a step has exactly one of read, ai, check or act');
export type JobStep = z.infer<typeof JobStepSchema>;

export const JobDefSchema = z.strictObject({
  id: SlugSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  /** The agent role that runs it. */
  agent: SlugSchema,
  trigger: JobTriggerSchema,
  daily_cap: z.number().int().min(1).max(500).default(50),
  steps: z.array(JobStepSchema).min(1),
});
export type JobDef = z.infer<typeof JobDefSchema>;
export type JobInput = z.input<typeof JobDefSchema>;

/** Where a running job is: the next step, what each step produced, and what it flagged. */
export const JobRunStateSchema = z.strictObject({
  next: z.number().int().min(0),
  results: z.record(z.string(), z.unknown()),
  flags: z.array(z.string()),
});
export type JobRunState = z.infer<typeof JobRunStateSchema>;

export type JobRunStatus = 'running' | 'done' | 'stopped' | 'needs_person' | 'failed';

import { z } from 'zod';
import { PRIORITY_IDS, SECTOR_IDS, STAGE_KEYS } from './values';

export { ORG_TYPES, PRIORITY_IDS, SECTOR_IDS, SECTORS, STAGE_KEYS } from './values';

/**
 * The case lifecycle: the 8 stages every request runs through, named in each
 * organization's own words by its pack. See the design spec,
 * docs/superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md.
 */

export const StageKeySchema = z.enum(STAGE_KEYS);
export type StageKey = z.infer<typeof StageKeySchema>;

export const SectorIdSchema = z.enum(SECTOR_IDS);
export type SectorId = z.infer<typeof SectorIdSchema>;

export const PriorityIdSchema = z.enum(PRIORITY_IDS);
export type PriorityId = z.infer<typeof PriorityIdSchema>;

export const CaseRiskSchema = z.enum(['low', 'medium', 'high']);
export type CaseRisk = z.infer<typeof CaseRiskSchema>;

export const CaseSourceSchema = z.enum(['owner', 'staff', 'customer', 'system', 'partner']);
export type CaseSource = z.infer<typeof CaseSourceSchema>;

const IdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase letters, digits and dashes, starting with a letter');

export const LifecycleStageSchema = z.strictObject({
  name: z.string().min(1).max(48),
  description: z.string().min(1).optional(),
  checks: z.array(z.string().min(1)).optional(),
});

export const LifecyclePrioritySchema = z.strictObject({
  id: PriorityIdSchema,
  name: z.string().min(1),
  respond_within_hours: z.number().positive(),
  resolve_within_hours: z.number().positive(),
});
export type LifecyclePriority = z.infer<typeof LifecyclePrioritySchema>;

export const LifecycleRoleSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1),
  approves: z.string().min(1),
});
export type LifecycleRole = z.infer<typeof LifecycleRoleSchema>;

/** Something review must find in the request, e.g. the amount or which machine. */
export const RequiredDetailSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/, 'camelCase key'),
    label: z.string().min(1),
    kind: z.enum(['amount', 'date', 'phone', 'email', 'contact', 'keywords']),
    keywords: z.array(z.string().min(1)).optional(),
  })
  .refine((d) => d.kind !== 'keywords' || (d.keywords?.length ?? 0) > 0, 'kind "keywords" needs keywords');
export type RequiredDetail = z.infer<typeof RequiredDetailSchema>;

export const NotEligibleRuleSchema = z
  .strictObject({
    keywords: z.array(z.string().min(1)).default([]),
    amount_above_inr: z.number().positive().optional(),
    reason: z.string().min(1),
  })
  .refine((r) => r.keywords.length > 0 || r.amount_above_inr !== undefined, 'a not-eligible rule needs keywords or amount_above_inr');
export type NotEligibleRule = z.infer<typeof NotEligibleRuleSchema>;

export const CaseApprovalRuleSchema = z
  .strictObject({
    required: z.enum(['always', 'above_amount', 'high_risk_or_p1', 'never']),
    role: IdSchema.optional(),
    amount_inr: z.number().positive().optional(),
  })
  .refine((r) => r.required === 'never' || !!r.role, 'approval needs a role unless required is never')
  .refine((r) => r.required !== 'above_amount' || r.amount_inr !== undefined, 'above_amount needs amount_inr');

export const CaseSignoffRuleSchema = z
  .strictObject({ required: z.boolean(), role: IdSchema.optional() })
  .refine((r) => !r.required || !!r.role, 'a required sign-off needs a role');

export const CaseCategorySchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  priority: PriorityIdSchema,
  risk: CaseRiskSchema.default('medium'),
  department: z.string().min(1),
  required_details: z.array(RequiredDetailSchema).default([]),
  required_checks: z.array(z.string().min(1)).default([]),
  not_eligible: z.array(NotEligibleRuleSchema).default([]),
  approval: CaseApprovalRuleSchema.default({ required: 'never' }),
  signoff: CaseSignoffRuleSchema.default({ required: false }),
  /** Pack workflow that runs in stage 6; the planner chooses when unset. */
  workflow: IdSchema.optional(),
  execution: z.enum(['team', 'agents', 'both']).default('agents'),
});
export type CaseCategory = z.infer<typeof CaseCategorySchema>;

/** A solved example for stage prompts. Never copied from an eval suite. */
export const LifecycleExampleSchema = z.strictObject({
  request: z.string().min(1),
  category: IdSchema,
  priority: PriorityIdSchema,
  approval: z.boolean(),
});
export type LifecycleExample = z.infer<typeof LifecycleExampleSchema>;

export const CaseLabelSchema = z.strictObject({
  label: z.string().min(1),
  plural: z.string().min(1),
  prefix: z.string().regex(/^[A-Z]{2,4}$/, '2-4 capital letters'),
});
export type CaseLabel = z.infer<typeof CaseLabelSchema>;

/** As authored in a pack: any part may be left out and inherited. */
export const LifecycleSchema = z.strictObject({
  case: CaseLabelSchema.optional(),
  stages: z
    .strictObject({
      request: LifecycleStageSchema.optional(),
      review: LifecycleStageSchema.optional(),
      classify: LifecycleStageSchema.optional(),
      assign: LifecycleStageSchema.optional(),
      approve: LifecycleStageSchema.optional(),
      execute: LifecycleStageSchema.optional(),
      close: LifecycleStageSchema.optional(),
      report: LifecycleStageSchema.optional(),
    })
    .default({}),
  priorities: z.array(LifecyclePrioritySchema).default([]),
  roles: z.array(LifecycleRoleSchema).default([]),
  /** Words that make any request P1 (fire, injury, outage...). Replaces the inherited list when set. */
  urgent_keywords: z.array(z.string().min(1)).optional(),
  categories: z.array(CaseCategorySchema).default([]),
  /** Category used when no keyword matches. */
  fallback_category: IdSchema.optional(),
  examples: z.array(LifecycleExampleSchema).default([]),
});
export type Lifecycle = z.infer<typeof LifecycleSchema>;

export interface ResolvedStage {
  key: StageKey;
  name: string;
  description: string;
  checks: string[];
}

/** A lifecycle with `extends` flattened: always 8 stages (in order) and P1–P4. */
export interface ResolvedLifecycle {
  case: CaseLabel;
  stages: ResolvedStage[];
  priorities: LifecyclePriority[];
  roles: LifecycleRole[];
  urgent_keywords: string[];
  categories: CaseCategory[];
  fallback_category?: string;
  examples: LifecycleExample[];
}

/** Narrows a policy rule to cases with this context. Compiled to Cedar. */
export const PolicyWhenSchema = z.strictObject({
  category: z.array(z.string().min(1)).min(1).optional(),
  priority: z.array(PriorityIdSchema).min(1).optional(),
  risk: z.array(CaseRiskSchema).min(1).optional(),
  source: z.array(CaseSourceSchema).min(1).optional(),
});
export type PolicyWhen = z.infer<typeof PolicyWhenSchema>;

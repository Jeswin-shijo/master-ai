# Plan 1 — Lifecycle foundations (shared packages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the shared packages about sectors, the 8-stage case lifecycle and stage gates. Later plans then build the engine, content and UI on top of tested, deterministic building blocks.

**Architecture:**
- **Schemas:** `@onehuman/schemas` gains the lifecycle, sector and case-file schemas.
- **Agent-kit:** `@onehuman/agent-kit` resolves lifecycles down the pack `extends` chain, derives gate policies from category rules, defines the two gate tools and the Case coordinator agent, and ships pure offline stage strategies (request, review, classify, assign, verify, report) with Indian amount and date extractors.
- **Policy:** `@onehuman/policy` compiles the new `when` conditions to Cedar and evaluates gates on case context.
- **Evals:** a new workspace package, `@onehuman/evals`, scores packs against YAML test sets using the offline strategies and the real policy engine.

No backend tables or UI change in this plan beyond keeping them compiling.

**Tech stack:** TypeScript 5.9, Zod 4, Vitest 5, Cedar (`@cedar-policy/cedar-wasm`), `yaml`, pnpm workspaces + Turborepo.

**Spec:** [docs/superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md](../specs/2026-10-12-org-types-and-case-lifecycle-design.md). Read sections 1, 2 ("Stage gates are policy decisions") and 4 ("The Case coordinator", "Evals") before starting.

## Global Constraints

- Every check must stay green: `pnpm turbo run build typecheck test`.
- Shared packages are consumed from `dist/`. After changing `packages/*`, run `pnpm build:packages` before typechecking the apps.
- Stage keys, in order: `request, review, classify, assign, approve, execute, close, report`.
- Sector ids: `energy-heavy-industry, trade-logistics-tourism, finance-development, technology-innovation, public-services`.
- Priorities are exactly `P1`–`P4`. Risk is `low | medium | high`. Sources are `owner | staff | customer | system | partner`.
- The generic stage names are, verbatim: "Request / Event Created", "Admin Review & Validation", "Classification & Priority", "Assignment", "Approval Gate", "Execution & Monitoring", "Verification & Closure", "Reporting & Continuous Improvement".
- Agents never decide permissions. Gates are Cedar decisions on `case.proceed` (stage 5) and `case.close` (stage 7). Only the `case-coordinator` agent may hold these tools.
- Earned autonomy never applies to gates.
- Evaluation fails closed, as today.
- Owners never see tool names, ids or JSON. Text that offline strategies produce is plain sentences.
- Money is Indian rupees. Amounts in text use Indian formats ("₹1.5 lakh", "1,50,000", "2 crore").
- Eval requests never appear in a pack's `lifecycle.examples` (checked from Plan 2, once packs carry examples).

## Deviations from the spec (decided while planning)

1. **Generic names live in code.** The generic lifecycle is the constant `GENERIC_LIFECYCLE` in agent-kit, the root layer every merge starts from, rather than YAML in `core-business`. Same names, one source of truth. `core-business` adds the Case coordinator agent.
2. **Review rules are lists.**
   - `not_eligible_when` becomes `not_eligible: [{ keywords, amount_above_inr?, reason }]`.
   - `required_details` entries are objects `{ key, label, kind: amount|date|phone|email|contact|keywords, keywords? }`, so offline review can test them.
3. **Derived policy ids use dashes** (`lifecycle-<category>-approve`, `-approve-p1`, `-approve-high-risk`, `-signoff`), because `PolicyRule.id` is a slug.
4. **Gate tools are marked as moving money** (`movesMoney: true`, `spendsMoney: false`). The amount then reaches Cedar's `require_approval_above` and counts in risk scoring, without touching an agent's money budget.

## Review Focus

These five inputs aren't covered by any happy-path test and are the most likely to hurt a real user. Each line names the test that pins it, in the task that owns the code.

1. **Amounts that aren't money:** IDs, dates and measurements ("LN-20931", "05-10-2026", "11 mm/s", "97 days") must not become amounts, or a ₹20,931 "loan" could trigger the wrong gate. Pinned in Task 5, `extract.test.ts` "ignores numbers that are not money".
2. **Several amounts in one request** ("EMI Rs 4,250 … loan of ₹1.5 lakh"): the gate must see the larger one, the conservative choice. Pinned in Task 5, "takes the largest amount".
3. **No category matches:** a request matching no keyword must still be classified (fallback category), never throw. Pinned in Task 6, "falls back when nothing matches".
4. **A work agent given a gate tool:** pack validation must refuse it, or an agent could approve its own case. Pinned in Task 2, "refuses gate tools for any role but the case coordinator".
5. **A lifecycle role referenced but not defined, or a category pointing at a missing workflow:** validation must name the problem. A missing approver role would otherwise route approvals to nobody. Pinned in Task 4, "names missing roles and workflows".

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/schemas/src/lifecycle.ts` (new) | Stage keys, sectors, priorities, lifecycle pack schema, `ResolvedLifecycle`, `PolicyWhen` |
| `packages/schemas/src/case.ts` (new) | Case-file part schemas (one per stage) and `CaseFile` |
| `packages/schemas/src/pack.ts` | `sector`, `lifecycle` on `PackSchema`; `when` on `PolicyRuleSchema`; `ResolvedPack.lifecycle`; `PackUpdates.lifecycle` |
| `packages/schemas/src/index.ts` | Export the two new files |
| `packages/agent-kit/src/catalog.ts` | `case.proceed`, `case.close`, `control: 'gate'`, `GATE_TOOLS`, `CASE_COORDINATOR_ROLE` |
| `packages/agent-kit/src/lifecycle/generic.ts` (new) | `GENERIC_LIFECYCLE` |
| `packages/agent-kit/src/lifecycle/resolve.ts` (new) | `mergeLifecycles`, `lifecycleOf`, `lifecyclePolicies`, `validateLifecycle` |
| `packages/agent-kit/src/lifecycle/extract.ts` (new) | `normalizeText`, `phraseIn`, `extractAmountInr`, `hasDate`, `extractPhone`, `extractEmail`, `hasDetail` |
| `packages/agent-kit/src/lifecycle/offline.ts` (new) | `offlineRequest`, `matchCategory`, `offlineReview`, `offlineClassify`, `offlineAssign`, `offlineVerify`, `offlineReport` |
| `packages/agent-kit/src/lifecycle/index.ts` (new) | Re-exports |
| `packages/agent-kit/src/pack.ts` | `resolvePack` merges lifecycles and adds derived policies; validation; lifecycle pack updates; `emptyPackUpdates` |
| `packages/agent-kit/src/index.ts` | `export * from './lifecycle'` |
| `packages/agent-kit/src/*.test.ts` (new: `lifecycle.test.ts`, `gates.test.ts`, `extract.test.ts`, `offline-stages.test.ts`) | Tests |
| `packages/policy/src/cedar.ts`, `engine.ts` | `when` → Cedar; case context; gates ignore earned autonomy |
| `packages/policy/src/gates.test.ts` (new) | Gate decisions |
| `packs/core-business/pack.yaml` | `case-coordinator` agent; version 1.1.0 |
| `evals/package.json`, `evals/tsconfig.json`, `evals/src/runner.ts`, `evals/src/runner.test.ts`, `evals/src/suites.test.ts`, `evals/suites/core-business.yaml`, `evals/README.md` | Evals package |
| `pnpm-workspace.yaml`, `package.json` | Add `evals` workspace and the `pnpm evals` script |
| `master-ai-backend/src/tenancy/onboarding.service.ts` | Use `emptyPackUpdates()`; describe lifecycle updates |
| `master-ai-web/src/components/pack-updates.tsx` | Show the lifecycle line in the update banner |

---

### Task 1: Lifecycle, sector and case-file schemas

**Files:**
- Create: `packages/schemas/src/lifecycle.ts`
- Create: `packages/schemas/src/case.ts`
- Modify: `packages/schemas/src/pack.ts` (imports, `PolicyRuleSchema`, `PackSchema`, `ResolvedPack`, `PackUpdates`)
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/agent-kit/src/pack.ts` (keep `resolvePack` compiling with the new `ResolvedPack` type)
- Test: `packages/agent-kit/src/lifecycle.test.ts` (schemas has no test runner; agent-kit tests parse packs)

**Interfaces:**
- Produces:
  - **Constants:** `STAGE_KEYS`, `SECTOR_IDS`, `SECTORS`, `PRIORITY_IDS`.
  - **Schemas:** `StageKeySchema`, `SectorIdSchema`, `PriorityIdSchema`, `CaseRiskSchema`, `CaseSourceSchema`, `LifecycleSchema`, `CaseCategorySchema`, `RequiredDetailSchema`, `PolicyWhenSchema`, `CaseFileSchema`, plus one part schema per stage (`RequestPartSchema` … `ReportPartSchema`), collected in `STAGE_PART_SCHEMAS`.
  - **Types:** `StageKey`, `SectorId`, `PriorityId`, `CaseRisk`, `CaseSource`, `Lifecycle`, `ResolvedLifecycle`, `ResolvedStage`, `CaseCategory`, `LifecycleRole`, `LifecyclePriority`, `LifecycleExample`, `RequiredDetail`, `CaseLabel`, `PolicyWhen`, `Requester`, `CaseFile`, `RequestPart`, `ReviewPart`, `ClassifyPart`, `AssignPart`, `ApprovePart`, `ExecutePart`, `ClosePart`, `ReportPart`.
  - **Pack additions:** `Pack.sector?: SectorId`, `Pack.lifecycle?: Lifecycle`, `ResolvedPack.lifecycle?: ResolvedLifecycle`, `PolicyRule.when?: PolicyWhen`, `PackUpdates.lifecycle: { whole: ResolvedLifecycle | null; categories: CaseCategory[]; roles: LifecycleRole[] }`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-kit/src/lifecycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CaseFileSchema, LifecycleSchema, PackSchema, PolicyRuleSchema, SECTORS, STAGE_KEYS } from '@onehuman/schemas';

const category = {
  id: 'breakdown',
  name: 'Breakdown repair',
  keywords: ['breakdown', 'vibration'],
  priority: 'P1',
  department: 'Maintenance',
  approval: { required: 'high_risk_or_p1', role: 'safety-officer' },
  signoff: { required: true, role: 'maintenance-head' },
};

describe('lifecycle schemas', () => {
  it('lists eight stages and five sectors in order', () => {
    expect(STAGE_KEYS).toEqual(['request', 'review', 'classify', 'assign', 'approve', 'execute', 'close', 'report']);
    expect(SECTORS.map((s) => s.name)).toEqual([
      'Energy & Heavy Industry',
      'Trade, Logistics & Tourism',
      'Finance & Development',
      'Technology & Innovation',
      'Essential Public & Service',
    ]);
  });

  it('parses a partial lifecycle and fills defaults', () => {
    const lc = LifecycleSchema.parse({
      case: { label: 'Work order', plural: 'Work orders', prefix: 'WO' },
      stages: { approve: { name: 'Safety (HSE) approval' } },
      categories: [category],
    });
    expect(lc.categories[0]!.risk).toBe('medium');
    expect(lc.categories[0]!.required_details).toEqual([]);
    expect(lc.priorities).toEqual([]);
  });

  it('rejects a bad case prefix, an approval without a role and above_amount without an amount', () => {
    expect(() => LifecycleSchema.parse({ case: { label: 'X', plural: 'Xs', prefix: 'wo' } })).toThrow();
    expect(() => LifecycleSchema.parse({ categories: [{ ...category, approval: { required: 'always' } }] })).toThrow(/role/);
    expect(() =>
      LifecycleSchema.parse({ categories: [{ ...category, approval: { required: 'above_amount', role: 'owner' } }] }),
    ).toThrow(/amount_inr/);
  });

  it('accepts sector and lifecycle on a pack, and `when` on a policy rule', () => {
    const pack = PackSchema.parse({
      id: 'power-plant',
      version: '1.0.0',
      name: 'Power plant',
      description: 'Generation and distribution',
      sector: 'energy-heavy-industry',
      lifecycle: { categories: [category] },
    });
    expect(pack.sector).toBe('energy-heavy-industry');
    const rule = PolicyRuleSchema.parse({
      action: 'case.proceed',
      require_approval: true,
      approver: 'safety-officer',
      when: { category: ['breakdown'], priority: ['P1'] },
    });
    expect(rule.when?.priority).toEqual(['P1']);
  });

  it('validates a case file part by part', () => {
    const file = CaseFileSchema.parse({
      classify: {
        category: 'breakdown',
        categoryName: 'Breakdown repair',
        priority: 'P1',
        risk: 'high',
        department: 'Maintenance',
        amountInr: null,
        respondBy: '2026-10-13T07:12:00.000Z',
        resolveBy: '2026-10-13T10:12:00.000Z',
        reasons: ['Matched “vibration”'],
      },
    });
    expect(file.classify?.priority).toBe('P1');
    expect(() => CaseFileSchema.parse({ classify: { category: 'x' } })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/lifecycle.test.ts`
Expected: FAIL. The imports `CaseFileSchema`, `LifecycleSchema`, `SECTORS` and `STAGE_KEYS` are undefined, so the module fails to load.

- [ ] **Step 3: Create `packages/schemas/src/lifecycle.ts`**

```ts
import { z } from 'zod';

/**
 * The case lifecycle: the 8 stages every request runs through, named in each
 * organization's own words by its pack. See the design spec,
 * docs/superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md.
 */

export const STAGE_KEYS = ['request', 'review', 'classify', 'assign', 'approve', 'execute', 'close', 'report'] as const;
export const StageKeySchema = z.enum(STAGE_KEYS);
export type StageKey = z.infer<typeof StageKeySchema>;

export const SECTOR_IDS = [
  'energy-heavy-industry',
  'trade-logistics-tourism',
  'finance-development',
  'technology-innovation',
  'public-services',
] as const;
export const SectorIdSchema = z.enum(SECTOR_IDS);
export type SectorId = z.infer<typeof SectorIdSchema>;

/** The five sectors shown at signup, in order. */
export const SECTORS: readonly { id: SectorId; name: string; examples: string }[] = [
  { id: 'energy-heavy-industry', name: 'Energy & Heavy Industry', examples: 'Power plants, manufacturing, construction' },
  { id: 'trade-logistics-tourism', name: 'Trade, Logistics & Tourism', examples: 'Logistics, wholesale & retail, travel' },
  { id: 'finance-development', name: 'Finance & Development', examples: 'Lenders, accounting firms, NGOs' },
  { id: 'technology-innovation', name: 'Technology & Innovation', examples: 'Software, IT services, digital agencies' },
  { id: 'public-services', name: 'Essential Public & Service', examples: 'Hospitals, schools, citizen services' },
];

export const PRIORITY_IDS = ['P1', 'P2', 'P3', 'P4'] as const;
export const PriorityIdSchema = z.enum(PRIORITY_IDS);
export type PriorityId = z.infer<typeof PriorityIdSchema>;

export const CaseRiskSchema = z.enum(['low', 'medium', 'high']);
export type CaseRisk = z.infer<typeof CaseRiskSchema>;

export const CaseSourceSchema = z.enum(['owner', 'staff', 'customer', 'system', 'partner']);
export type CaseSource = z.infer<typeof CaseSourceSchema>;

const IdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase letters, digits and dashes, starting with a letter');

export const LifecycleStageSchema = z.object({
  name: z.string().min(1).max(48),
  description: z.string().min(1).optional(),
  checks: z.array(z.string().min(1)).optional(),
});

export const LifecyclePrioritySchema = z.object({
  id: PriorityIdSchema,
  name: z.string().min(1),
  respond_within_hours: z.number().positive(),
  resolve_within_hours: z.number().positive(),
});
export type LifecyclePriority = z.infer<typeof LifecyclePrioritySchema>;

export const LifecycleRoleSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  approves: z.string().min(1),
});
export type LifecycleRole = z.infer<typeof LifecycleRoleSchema>;

/** Something review must find in the request, e.g. the amount or which machine. */
export const RequiredDetailSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/, 'camelCase key'),
    label: z.string().min(1),
    kind: z.enum(['amount', 'date', 'phone', 'email', 'contact', 'keywords']),
    keywords: z.array(z.string().min(1)).optional(),
  })
  .refine((d) => d.kind !== 'keywords' || (d.keywords?.length ?? 0) > 0, 'kind "keywords" needs keywords');
export type RequiredDetail = z.infer<typeof RequiredDetailSchema>;

export const NotEligibleRuleSchema = z
  .object({
    keywords: z.array(z.string().min(1)).default([]),
    amount_above_inr: z.number().positive().optional(),
    reason: z.string().min(1),
  })
  .refine((r) => r.keywords.length > 0 || r.amount_above_inr !== undefined, 'a not-eligible rule needs keywords or amount_above_inr');
export type NotEligibleRule = z.infer<typeof NotEligibleRuleSchema>;

export const CaseApprovalRuleSchema = z
  .object({
    required: z.enum(['always', 'above_amount', 'high_risk_or_p1', 'never']),
    role: IdSchema.optional(),
    amount_inr: z.number().positive().optional(),
  })
  .refine((r) => r.required === 'never' || !!r.role, 'approval needs a role unless required is never')
  .refine((r) => r.required !== 'above_amount' || r.amount_inr !== undefined, 'above_amount needs amount_inr');

export const CaseSignoffRuleSchema = z
  .object({ required: z.boolean(), role: IdSchema.optional() })
  .refine((r) => !r.required || !!r.role, 'a required sign-off needs a role');

export const CaseCategorySchema = z.object({
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
export const LifecycleExampleSchema = z.object({
  request: z.string().min(1),
  category: IdSchema,
  priority: PriorityIdSchema,
  approval: z.boolean(),
});
export type LifecycleExample = z.infer<typeof LifecycleExampleSchema>;

export const CaseLabelSchema = z.object({
  label: z.string().min(1),
  plural: z.string().min(1),
  prefix: z.string().regex(/^[A-Z]{2,4}$/, '2-4 capital letters'),
});
export type CaseLabel = z.infer<typeof CaseLabelSchema>;

/** As authored in a pack: any part may be left out and inherited. */
export const LifecycleSchema = z.object({
  case: CaseLabelSchema.optional(),
  stages: z
    .object({
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
  /** Words that make any request P1 (fire, injury, outage...). */
  urgent_keywords: z.array(z.string().min(1)).default([]),
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
export const PolicyWhenSchema = z.object({
  category: z.array(z.string().min(1)).min(1).optional(),
  priority: z.array(PriorityIdSchema).min(1).optional(),
  risk: z.array(CaseRiskSchema).min(1).optional(),
  source: z.array(CaseSourceSchema).min(1).optional(),
});
export type PolicyWhen = z.infer<typeof PolicyWhenSchema>;
```

- [ ] **Step 4: Create `packages/schemas/src/case.ts`**

```ts
import { z } from 'zod';
import { CaseRiskSchema, CaseSourceSchema, PriorityIdSchema, StageKeySchema } from './lifecycle';

/**
 * The case file: each stage reads it and adds its own part. Every part is
 * validated with its schema before it is stored.
 */

export const RequesterSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
});
export type Requester = z.infer<typeof RequesterSchema>;

export const RequestPartSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1),
  requester: RequesterSchema,
  source: CaseSourceSchema,
  receivedAt: z.string(),
  /** The requester's own words. Untrusted for customer, system and partner sources. */
  text: z.string().min(1),
});
export type RequestPart = z.infer<typeof RequestPartSchema>;

export const ReviewPartSchema = z.object({
  outcome: z.enum(['complete', 'needs_info', 'not_eligible']),
  provisionalCategory: z.string().nullable(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), note: z.string().optional() })),
  missing: z.array(z.object({ key: z.string(), label: z.string() })),
  /** Checks a person must confirm (they cannot be read from the request). */
  toConfirm: z.array(z.string()),
  reason: z.string().optional(),
});
export type ReviewPart = z.infer<typeof ReviewPartSchema>;

export const ClassifyPartSchema = z.object({
  category: z.string().min(1),
  categoryName: z.string().min(1),
  priority: PriorityIdSchema,
  risk: CaseRiskSchema,
  department: z.string().min(1),
  amountInr: z.number().nonnegative().nullable(),
  respondBy: z.string(),
  resolveBy: z.string(),
  reasons: z.array(z.string()),
});
export type ClassifyPart = z.infer<typeof ClassifyPartSchema>;

export const AssignPartSchema = z.object({
  assignee: z.object({ staffId: z.string().optional(), name: z.string(), title: z.string().optional() }).nullable(),
  team: z.string().min(1),
  deadline: z.string(),
  reason: z.string().min(1),
});
export type AssignPart = z.infer<typeof AssignPartSchema>;

export const ApprovePartSchema = z.object({
  required: z.boolean(),
  rule: z.string().optional(),
  approverRole: z.string().optional(),
  decision: z.enum(['approved', 'rejected', 'expired', 'not_required', 'blocked']),
  decidedBy: z.string().optional(),
  notes: z.string().optional(),
  approvalId: z.string().optional(),
});
export type ApprovePart = z.infer<typeof ApprovePartSchema>;

export const ExecutePartSchema = z.object({
  goalId: z.string(),
  workflow: z.string().optional(),
  status: z.string(),
  summary: z.string(),
  costInr: z.number().nonnegative(),
  evidence: z.array(z.string()),
});
export type ExecutePart = z.infer<typeof ExecutePartSchema>;

export const ClosePartSchema = z.object({
  verified: z.boolean(),
  findings: z.array(z.string()),
  signoff: z.object({
    required: z.boolean(),
    role: z.string().optional(),
    decision: z.enum(['approved', 'rejected', 'expired', 'not_required']).optional(),
    by: z.string().optional(),
  }),
  outcome: z.enum(['resolved', 'not_resolved']),
});
export type ClosePart = z.infer<typeof ClosePartSchema>;

export const ReportPartSchema = z.object({
  text: z.string().min(1),
  slaMet: z.boolean().nullable(),
  minutesPerStage: z.array(z.object({ stage: StageKeySchema, minutes: z.number().nonnegative() })),
  recurring: z.object({ count: z.number().int().positive(), note: z.string() }).nullable(),
});
export type ReportPart = z.infer<typeof ReportPartSchema>;

export const CaseFileSchema = z.object({
  request: RequestPartSchema.optional(),
  review: ReviewPartSchema.optional(),
  classify: ClassifyPartSchema.optional(),
  assign: AssignPartSchema.optional(),
  approve: ApprovePartSchema.optional(),
  execute: ExecutePartSchema.optional(),
  close: ClosePartSchema.optional(),
  report: ReportPartSchema.optional(),
});
export type CaseFile = z.infer<typeof CaseFileSchema>;

/** Which schema validates which stage's output. */
export const STAGE_PART_SCHEMAS = {
  request: RequestPartSchema,
  review: ReviewPartSchema,
  classify: ClassifyPartSchema,
  assign: AssignPartSchema,
  approve: ApprovePartSchema,
  execute: ExecutePartSchema,
  close: ClosePartSchema,
  report: ReportPartSchema,
} as const;
```

- [ ] **Step 5: Wire the new schemas into `pack.ts` and `index.ts`**

In `packages/schemas/src/pack.ts`, change the import line at the top to:

```ts
import { z } from 'zod';
import { AgentClearanceSchema, DataClassSchema, ModelTierSchema } from './autonomy';
import {
  LifecycleSchema,
  PolicyWhenSchema,
  SectorIdSchema,
  type CaseCategory,
  type LifecycleRole,
  type ResolvedLifecycle,
} from './lifecycle';
```

In `PolicyRuleSchema`, add the `when` key after `reason`:

```ts
    reason: z.string().optional(),
    /** Only for case gates: narrows the rule to cases in these categories, priorities, risks or sources. */
    when: PolicyWhenSchema.optional(),
  })
```

In `PackSchema`, add two keys after `kind`:

```ts
  kind: z.enum(['base', 'industry']).default('industry'),
  /** Sector this pack belongs to (inherited when unset). */
  sector: SectorIdSchema.optional(),
  /** The 8-stage case lifecycle, partial; merged down the `extends` chain. */
  lifecycle: LifecycleSchema.optional(),
```

Replace the `ResolvedPack` type and `PackUpdates` interface with:

```ts
/** A pack with `extends` flattened. This is what a workspace runs. */
export type ResolvedPack = Omit<Pack, 'lifecycle'> & {
  /** Pack ids from the most basic ancestor to this pack. */
  lineage: string[];
  source: PackSource;
  /** Missing on workspaces installed before lifecycles existed; read it with `lifecycleOf()`. */
  lifecycle?: ResolvedLifecycle;
};

export type PackSource = 'registry' | 'generated' | 'forked';

/** What the current base packs add to an installed workspace. Additions only. */
export interface PackUpdates {
  agents: Pack['agents'];
  tools: Pack['tools'];
  workflows: Pack['workflows'];
  routines: Pack['routines'];
  policies: Pack['policies'];
  kpis: Pack['kpis'];
  /** The whole lifecycle for workspaces installed before lifecycles, otherwise new categories and roles. */
  lifecycle: { whole: ResolvedLifecycle | null; categories: CaseCategory[]; roles: LifecycleRole[] };
}
```

In `packages/schemas/src/index.ts`, add two lines:

```ts
export * from './lifecycle';
export * from './case';
```

- [ ] **Step 6: Keep `resolvePack` compiling**

`ResolvedPack.lifecycle` is now a resolved lifecycle, so `resolvePack` must not copy the pack's raw one. In `packages/agent-kit/src/pack.ts`, inside `resolvePack`, replace the `const merged: Pack = { ...pack, entities: [], …` line with:

```ts
  const { lifecycle: _ownLifecycle, ...ownPack } = pack;
  const merged: Omit<Pack, 'lifecycle'> = { ...ownPack, entities: [], agents: [], tools: [], workflows: [], routines: [], policies: [], kpis: [], connectors: [], labels: {} };
```

In `packUpdates`, add to the returned object (Task 4 replaces this with the real logic):

```ts
    lifecycle: { whole: null, categories: [], roles: [] },
```

In `master-ai-backend/src/tenancy/onboarding.service.ts`, line 158, add the same key to the empty literal:

```ts
    return latest ? packUpdates(installed, latest) : { agents: [], tools: [], workflows: [], routines: [], policies: [], kpis: [], lifecycle: { whole: null, categories: [], roles: [] } };
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @onehuman/schemas build && pnpm --filter @onehuman/agent-kit exec vitest run src/lifecycle.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 8: Run the full checks**

Run: `pnpm turbo run build typecheck test`
Expected: all tasks successful.

- [ ] **Step 9: Commit**

```bash
git add packages/schemas/src packages/agent-kit/src/lifecycle.test.ts packages/agent-kit/src/pack.ts master-ai-backend/src/tenancy/onboarding.service.ts
git commit -m "feat(schemas): lifecycle, sector and case-file schemas"
```

---

### Task 2: Gate tools and the Case coordinator agent

**Files:**
- Modify: `packages/agent-kit/src/catalog.ts`
- Modify: `packages/agent-kit/src/pack.ts` (`validatePackRefs`)
- Modify: `packs/core-business/pack.yaml`
- Test: `packages/agent-kit/src/gates.test.ts` (new)

**Interfaces:**
- Consumes: `ResolvedPack` (Task 1).
- Produces:
  - `CatalogTool.control?: 'handoff' | 'delegate' | 'gate'`.
  - Catalog tools `case.proceed` and `case.close`, with input `{ caseId: string; category: string; priority: PriorityId; risk: CaseRisk; amount?: number; summary: string }`.
  - `GATE_TOOLS: readonly ['case.proceed', 'case.close']` and `CASE_COORDINATOR_ROLE = 'case-coordinator'`.
  - The `case-coordinator` agent in every resolved pack.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-kit/src/gates.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { ResolvedPack } from '@onehuman/schemas';
import { amountOf, CASE_COORDINATOR_ROLE, GATE_TOOLS, parsePack, prepareArgs, resolvePack, resolveTool, validatePackRefs } from './index';

const core = parsePack(parse(readFileSync(join(__dirname, '../../../packs/core-business/pack.yaml'), 'utf8')));
const resolved = resolvePack(core, () => undefined);

describe('gate tools', () => {
  it('are catalog tools marked as gates', () => {
    for (const name of GATE_TOOLS) {
      const tool = resolveTool(resolved, name)!;
      expect(tool.primitive.control).toBe('gate');
      expect(tool.baseLevel).toBe(3);
    }
  });

  it('carry the case amount to the policy engine', () => {
    const tool = resolveTool(resolved, 'case.proceed')!;
    const args = { caseId: 'c1', category: 'breakdown', priority: 'P1', risk: 'high', amount: 45000, summary: 'Repair pump B' };
    expect(prepareArgs(tool, args).ok).toBe(true);
    expect(amountOf(tool, args)).toBe(45000);
    expect(amountOf(tool, { ...args, amount: undefined })).toBeNull();
  });

  it('belong to the case coordinator in core-business', () => {
    const coordinator = resolved.agents.find((a) => a.role === CASE_COORDINATOR_ROLE)!;
    expect(coordinator.tools).toEqual(expect.arrayContaining([...GATE_TOOLS]));
    expect(validatePackRefs(resolved)).toEqual([]);
  });

  it('refuses gate tools for any role but the case coordinator', () => {
    const rogue: ResolvedPack = {
      ...resolved,
      agents: [...resolved.agents, { ...resolved.agents[0]!, role: 'sneaky-agent', tools: ['records.search', 'case.proceed'] }],
    };
    expect(validatePackRefs(rogue)).toContain('agent sneaky-agent: case.proceed is reserved for the case coordinator');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/gates.test.ts`
Expected: FAIL. `GATE_TOOLS` and `CASE_COORDINATOR_ROLE` aren't exported.

- [ ] **Step 3: Add the gate tools to `packages/agent-kit/src/catalog.ts`**

Change the `control` field of `CatalogTool`:

```ts
  /**
   * Runtime control: `handoff` ends the task for a human; `delegate` hands the
   * work to a team member and runs the phone-call cadence (assign → follow up →
   * confirm) before the agent continues; `gate` is a case stage gate (stage 5
   * or 7), decided by the policy engine and never called by work agents.
   */
  control?: 'handoff' | 'delegate' | 'gate';
```

Above `TOOL_CATALOG`, add:

```ts
/** Gate tools are held only by this agent role. */
export const CASE_COORDINATOR_ROLE = 'case-coordinator';
export const GATE_TOOLS = ['case.proceed', 'case.close'] as const;

const gateInput = z.object({
  caseId: z.string().min(1),
  category: z.string().min(1),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  risk: z.enum(['low', 'medium', 'high']),
  amount: z.number().nonnegative().optional().describe('Money at stake in rupees, if any'),
  summary: z.string().min(1),
});

/** Gates commit the organization to work (and often money) but move nothing themselves. */
const gateRisk: ToolRisk = {
  category: 'write',
  reversible: true,
  externalReach: false,
  movesMoney: true,
  spendsMoney: false,
  sensitivity: 'internal',
};
```

Append these two entries at the end of the `TOOL_CATALOG` array, after `human.handoff`:

```ts
  {
    name: 'case.proceed',
    description: 'Let a case pass its approval gate and move into the work.',
    input: gateInput,
    baseLevel: 3,
    risk: gateRisk,
    control: 'gate',
  },
  {
    name: 'case.close',
    description: 'Close a case once its result is verified.',
    input: gateInput,
    baseLevel: 3,
    risk: gateRisk,
    control: 'gate',
  },
```

- [ ] **Step 4: Refuse gate tools in `validatePackRefs`**

In `packages/agent-kit/src/pack.ts`, add `CASE_COORDINATOR_ROLE` to the catalog import:

```ts
import { CASE_COORDINATOR_ROLE, getCatalogTool } from './catalog';
```

Inside `validatePackRefs`, replace the `for (const agent of pack.agents)` loop with:

```ts
  for (const agent of pack.agents) {
    for (const tool of agent.tools) {
      if (!toolExists(tool)) issues.push(`agent ${agent.role}: unknown tool ${tool}`);
      else if (agent.role !== CASE_COORDINATOR_ROLE && resolveToolControl(pack, tool) === 'gate') {
        issues.push(`agent ${agent.role}: ${tool} is reserved for the case coordinator`);
      }
    }
  }
```

Add this helper below `validatePackRefs`:

```ts
/** A tool's runtime control, looking through pack aliases to the primitive. */
function resolveToolControl(pack: ResolvedPack, name: string): string | undefined {
  const alias = pack.tools.find((t) => t.name === name);
  return getCatalogTool(alias ? alias.uses : name)?.control;
}
```

- [ ] **Step 5: Add the Case coordinator to `packs/core-business/pack.yaml`**

Change `version: 1.0.0` to `version: 1.1.0`. Append this agent to the `agents:` list, after `work-coordinator`:

```yaml
  - role: case-coordinator
    name: Case coordinator
    description: Takes in every request and moves it through its stages. It checks the details, sets the priority, finds the person in charge, asks for approval when the rules require it, checks the result and writes the report.
    instructions: Follow the stage you are given. Use the organization's own words for its work. Never approve anything yourself; approvals come from people.
    autonomy: 3
    tools: [case.proceed, case.close, records.search, knowledge.search]
    model: { tier: small, fallback: standard, data_class: internal }
    budgets: { tokens_per_task: 60000, money_per_task_inr: 0, max_steps: 10 }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run`
Expected: PASS, including `gates.test.ts` (4 tests). The existing `pack.test.ts` keeps passing, because every pack extends `core-business`.

- [ ] **Step 7: Run the full checks**

Run: `pnpm turbo run build typecheck test`
Expected: all successful. The backend only branches on `'handoff'` and `'delegate'`, so the new control value compiles.

- [ ] **Step 8: Commit**

```bash
git add packages/agent-kit/src packs/core-business/pack.yaml
git commit -m "feat(agent-kit): case gate tools and the case coordinator agent"
```

---

### Task 3: Cedar `when` conditions and case context

**Files:**
- Modify: `packages/policy/src/cedar.ts` (`compileRules`)
- Modify: `packages/policy/src/engine.ts` (`PolicyRequest`, `decide`, `authorize`)
- Test: `packages/policy/src/gates.test.ts` (new)

**Interfaces:**
- Consumes: `PolicyRule.when` (Task 1), `case.proceed` / `case.close` (Task 2).
- Produces:
  - `PolicyRequest.caseContext?: { category: string; priority: PriorityId; risk: CaseRisk; source: CaseSource } | null`.
  - Cedar context keys `caseCategory`, `casePriority`, `caseRisk` and `caseSource`, which are empty strings when there is no case.
  - Gate requests ignore `override`.

- [ ] **Step 1: Write the failing test**

Create `packages/policy/src/gates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PolicyRule, ResolvedPack } from '@onehuman/schemas';
import { resolveTool } from '@onehuman/agent-kit';
import { PolicyEngine, type PolicyAgent, type PolicyRequest } from './engine';

const pack = {
  id: 'gates', version: '1.0.0', name: 'Gates', description: 'Gate tests', kind: 'industry', extends: [], labels: {},
  entities: [], agents: [], tools: [], workflows: [], routines: [], policies: [], kpis: [], connectors: [],
  lineage: ['gates'], source: 'registry',
} satisfies ResolvedPack;

const rules: PolicyRule[] = [
  { id: 'lifecycle-breakdown-approve-p1', action: 'case.proceed', approver: 'safety-officer', require_approval: true, when: { category: ['breakdown'], priority: ['P1'] }, reason: 'Breakdown repair: P1 needs the safety officer' },
  { id: 'lifecycle-business-loan-approve', action: 'case.proceed', approver: 'credit-committee', require_approval_above: { amount: 500000, currency: 'INR' }, when: { category: ['business-loan'] } },
  { id: 'lifecycle-breakdown-signoff', action: 'case.close', approver: 'maintenance-head', require_approval: true, when: { category: ['breakdown'] } },
  { id: 'lifecycle-customer-guard', action: 'case.proceed', approver: 'owner', require_approval: true, when: { source: ['customer'], risk: ['high'] } },
];
const engine = new PolicyEngine({ version: 1, packRules: rules });

const coordinator: PolicyAgent = {
  id: 'coordinator', role: 'case-coordinator', status: 'active', autonomy: 3,
  tools: ['case.proceed', 'case.close', 'records.search'], dataClass: 'internal', moneyBudgetInr: 0,
};

function gate(tool: 'case.proceed' | 'case.close', ctx: NonNullable<PolicyRequest['caseContext']>, amount?: number, extra: Partial<PolicyRequest> = {}) {
  return engine.decide({
    tool: resolveTool(pack, tool)!,
    args: { caseId: 'c1', category: ctx.category, priority: ctx.priority, risk: ctx.risk, summary: 's', ...(amount !== undefined && { amount }) },
    agent: coordinator,
    workspace: { id: 'ws', status: 'active' },
    tenant: { id: 't', status: 'active' },
    trackRecord: { approved: 0, rejected: 0, edited: 0 },
    caseContext: ctx,
    ...extra,
  });
}

const breakdownP1 = { category: 'breakdown', priority: 'P1', risk: 'high', source: 'system' } as const;

describe('case gates', () => {
  it('routes a P1 breakdown to the safety officer', () => {
    const d = gate('case.proceed', breakdownP1);
    expect(d.level).toBe(4);
    expect(d.approver).toBe('safety-officer');
    expect(d.reasons).toContain('Breakdown repair: P1 needs the safety officer');
  });

  it('lets a P3 breakdown through without approval', () => {
    expect(gate('case.proceed', { ...breakdownP1, priority: 'P3', risk: 'medium' }).level).toBe(3);
  });

  it('decides amount rules on the case amount', () => {
    const loan = { category: 'business-loan', priority: 'P3', risk: 'medium', source: 'partner' } as const;
    expect(gate('case.proceed', loan, 300000).level).toBe(3);
    const big = gate('case.proceed', loan, 4500000);
    expect(big.level).toBe(4);
    expect(big.approver).toBe('credit-committee');
    expect(gate('case.proceed', loan).level).toBe(3);
  });

  it('asks for sign-off with case.close', () => {
    const d = gate('case.close', breakdownP1);
    expect(d.level).toBe(4);
    expect(d.approver).toBe('maintenance-head');
  });

  it('matches on source and risk', () => {
    const d = gate('case.proceed', { category: 'general', priority: 'P3', risk: 'high', source: 'customer' });
    expect(d.level).toBe(4);
    expect(d.approver).toBe('owner');
  });

  it('never lets earned autonomy lift a gate', () => {
    expect(gate('case.proceed', breakdownP1, undefined, { override: { level: 3 } }).level).toBe(4);
  });

  it('does not match case rules for ordinary actions', () => {
    const agent: PolicyAgent = { ...coordinator, role: 'ops', tools: ['records.search'] };
    const d = engine.decide({
      tool: resolveTool(pack, 'records.search')!, args: { entity: 'X' }, agent,
      workspace: { id: 'ws', status: 'active' }, tenant: { id: 't', status: 'active' },
      trackRecord: { approved: 0, rejected: 0, edited: 0 },
    });
    expect(d.level).toBe(1);
  });

  it('blocks gates on the kill switch', () => {
    expect(gate('case.proceed', breakdownP1, undefined, { tenant: { id: 't', status: 'paused' } }).level).toBe(5);
  });

  it('writes readable Cedar for when conditions', () => {
    expect(engine.cedarText).toContain('["breakdown"].contains(context.caseCategory)');
    expect(engine.cedarText).toContain('["P1"].contains(context.casePriority)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onehuman/agent-kit build && pnpm --filter @onehuman/policy exec vitest run src/gates.test.ts`
Expected: FAIL. `caseContext` isn't a known `PolicyRequest` field (a type error at compile time), the P3 and `when` cases come out wrong, and the Cedar text has no `contains`.

- [ ] **Step 3: Compile `when` in `packages/policy/src/cedar.ts`**

In `compileRules`, after the line `if (rule.agent) conditions.push(…)`, add:

```ts
    if (rule.when?.category) conditions.push(`${cedarSet(rule.when.category)}.contains(context.caseCategory)`);
    if (rule.when?.priority) conditions.push(`${cedarSet(rule.when.priority)}.contains(context.casePriority)`);
    if (rule.when?.risk) conditions.push(`${cedarSet(rule.when.risk)}.contains(context.caseRisk)`);
    if (rule.when?.source) conditions.push(`${cedarSet(rule.when.source)}.contains(context.caseSource)`);
```

At the bottom of the file, add:

```ts
function cedarSet(items: readonly string[]): string {
  return `[${items.map(cedarString).join(', ')}]`;
}
```

- [ ] **Step 4: Pass case context in `packages/policy/src/engine.ts`**

Change the schemas import to:

```ts
import type { AutonomyLevel, CaseRisk, CaseSource, DataClass, PolicyDecision, PolicyRule, PriorityId, RiskFactor } from '@onehuman/schemas';
```

Add to `PolicyRequest`, after `untrustedOrigin`:

```ts
  /** Set for case gates (case.proceed / case.close): what `when` rules match on. */
  caseContext?: { category: string; priority: PriorityId; risk: CaseRisk; source: CaseSource } | null;
```

In `decide`, replace the earned-autonomy block (the `if (req.override && …)` lines) with:

```ts
    // Earned autonomy lifts blanket approval rules for actions, never for case gates.
    const override = req.tool.primitive.control === 'gate' ? null : req.override;
    if (override && override.level < level) {
      level = Math.max(override.level, 1) as AutonomyLevel;
      reasons.push(`Earned autonomy: owner lowered ${req.tool.name} to Level ${override.level}`);
    }
```

Change the two `this.authorize(...)` calls in `decide` to pass the effective override:

```ts
    const invoke = this.authorize(INVOKE, req, amount, !!override);
    …
    const unattended = this.authorize(INVOKE_UNATTENDED, req, amount, !!override);
```

The first call happens before `override` is declared. Move the `const override = …` line to just after `const reasons: string[] = [];`, and keep the `if (override && …)` block where the old one was.

Change the `authorize` signature and its context:

```ts
  private authorize(
    action: string,
    req: PolicyRequest,
    amount: number | null,
    overridden: boolean,
  ): { decision: 'allow' | 'deny'; reasons: string[]; approver?: string } {
```

In the `context` object, replace `overridden: !!req.override,` with `overridden,` and add after `tenantStatus`:

```ts
        caseCategory: req.caseContext?.category ?? '',
        casePriority: req.caseContext?.priority ?? '',
        caseRisk: req.caseContext?.risk ?? '',
        caseSource: req.caseContext?.source ?? '',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @onehuman/policy exec vitest run`
Expected: PASS. `gates.test.ts` has 9 tests, and `engine.test.ts` stays green; the earned-autonomy test still lifts `booking.confirm`.

- [ ] **Step 6: Run the full checks**

Run: `pnpm turbo run build typecheck test`
Expected: all successful.

- [ ] **Step 7: Commit**

```bash
git add packages/policy/src
git commit -m "feat(policy): case gates with when-conditions on category, priority, risk and source"
```

---

### Task 4: Lifecycle resolution, derived policies, validation and updates

**Files:**
- Create: `packages/agent-kit/src/lifecycle/generic.ts`
- Create: `packages/agent-kit/src/lifecycle/resolve.ts`
- Create: `packages/agent-kit/src/lifecycle/index.ts`
- Modify: `packages/agent-kit/src/index.ts`
- Modify: `packages/agent-kit/src/pack.ts` (`resolvePack`, `validatePackRefs`, `packUpdates`, `countPackUpdates`, `applyPackUpdates`, new `emptyPackUpdates`)
- Modify: `master-ai-backend/src/tenancy/onboarding.service.ts` (`updatesFor`, `describeUpdates`)
- Modify: `master-ai-web/src/components/pack-updates.tsx`
- Test: `packages/agent-kit/src/lifecycle.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 types; `CASE_COORDINATOR_ROLE` (Task 2).
- Produces:
  - `GENERIC_LIFECYCLE: ResolvedLifecycle`.
  - `mergeLifecycles(parts: Lifecycle[]): ResolvedLifecycle`.
  - `lifecycleOf(pack: ResolvedPack): ResolvedLifecycle`.
  - `lifecyclePolicies(lc: ResolvedLifecycle): PolicyRule[]`.
  - `validateLifecycle(lc: ResolvedLifecycle, pack: ResolvedPack): string[]`.
  - `emptyPackUpdates(): PackUpdates`.
  - `resolvePack` now always sets `lifecycle` and `sector`, the latter inherited from the nearest pack in the chain.

- [ ] **Step 1: Write the failing tests**

Add these tests to `packages/agent-kit/src/lifecycle.test.ts`. Merge the import lines into the import block at the top of the file (`it`, `describe` and `expect` are already imported):

```ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Pack, ResolvedPack } from '@onehuman/schemas';
import {
  applyPackUpdates,
  countPackUpdates,
  emptyPackUpdates,
  GENERIC_LIFECYCLE,
  lifecycleOf,
  lifecyclePolicies,
  mergeLifecycles,
  packUpdates,
  parsePack,
  resolvePack,
  validatePackRefs,
} from './index';

const PACKS_DIR = join(__dirname, '../../../packs');
const registry = new Map<string, Pack>();
for (const dir of readdirSync(PACKS_DIR)) {
  const file = join(PACKS_DIR, dir, 'pack.yaml');
  if (existsSync(file)) {
    const p = parsePack(parse(readFileSync(file, 'utf8')));
    registry.set(p.id, p);
  }
}
const lookup = (id: string) => registry.get(id);

const plant = parsePack({
  id: 'plant-test', version: '1.0.0', name: 'Plant', description: 'Test plant', extends: ['core-business'],
  sector: 'energy-heavy-industry',
  workflows: [{ id: 'fix-it', name: 'Fix it', description: 'Fix it', steps: [{ key: 'fix', title: 'Fix', agent: 'work-coordinator', instructions: 'Fix it' }] }],
  lifecycle: {
    case: { label: 'Work order', plural: 'Work orders', prefix: 'WO' },
    stages: { approve: { name: 'Safety (HSE) approval' }, close: { name: 'Inspection & handover', checks: ['Area cleaned'] } },
    roles: [{ id: 'safety-officer', name: 'Safety officer', approves: 'Hot work permits' }, { id: 'maintenance-head', name: 'Maintenance head', approves: 'Repairs' }],
    urgent_keywords: ['fire'],
    categories: [
      { id: 'breakdown', name: 'Breakdown repair', keywords: ['breakdown', 'vibration'], priority: 'P1', risk: 'high', department: 'Maintenance', workflow: 'fix-it',
        approval: { required: 'high_risk_or_p1', role: 'safety-officer' }, signoff: { required: true, role: 'maintenance-head' } },
      { id: 'spares', name: 'Spares purchase', keywords: ['spares', 'purchase'], priority: 'P4', department: 'Stores',
        approval: { required: 'above_amount', role: 'owner', amount_inr: 50000 } },
    ],
  },
});

describe('lifecycle resolution', () => {
  it('starts from the generic lifecycle', () => {
    expect(GENERIC_LIFECYCLE.stages.map((s) => s.name)).toEqual([
      'Request / Event Created', 'Admin Review & Validation', 'Classification & Priority', 'Assignment',
      'Approval Gate', 'Execution & Monitoring', 'Verification & Closure', 'Reporting & Continuous Improvement',
    ]);
    expect(mergeLifecycles([])).toEqual(GENERIC_LIFECYCLE);
  });

  it('gives every registry pack a complete lifecycle', () => {
    for (const p of registry.values()) {
      const lc = resolvePack(p, lookup).lifecycle!;
      expect(lc.stages).toHaveLength(8);
      expect(lc.priorities.map((x) => x.id)).toEqual(['P1', 'P2', 'P3', 'P4']);
      expect(lc.roles.some((r) => r.id === 'owner')).toBe(true);
    }
  });

  it('overrides stage names per stage and keeps inherited descriptions', () => {
    const lc = resolvePack(plant, lookup).lifecycle!;
    expect(lc.case.prefix).toBe('WO');
    const approve = lc.stages.find((s) => s.key === 'approve')!;
    expect(approve.name).toBe('Safety (HSE) approval');
    expect(approve.description).toBe(GENERIC_LIFECYCLE.stages[4]!.description);
    expect(lc.stages.find((s) => s.key === 'close')!.checks).toEqual(['Area cleaned']);
    expect(lc.stages.find((s) => s.key === 'request')!.name).toBe('Request / Event Created');
    expect(lc.categories.map((c) => c.id)).toEqual(['general', 'breakdown', 'spares']);
  });

  it('inherits the sector', () => {
    const child = parsePack({ id: 'child', version: '1.0.0', name: 'Child', description: 'c', extends: ['plant-test'] });
    registry.set('plant-test', plant);
    expect(resolvePack(child, lookup).sector).toBe('energy-heavy-industry');
    registry.delete('plant-test');
  });

  it('derives gate policies from category rules', () => {
    const lc = resolvePack(plant, lookup).lifecycle!;
    const rules = lifecyclePolicies(lc);
    expect(rules.map((r) => r.id)).toEqual([
      'lifecycle-breakdown-approve-p1', 'lifecycle-breakdown-approve-high-risk', 'lifecycle-breakdown-signoff', 'lifecycle-spares-approve',
    ]);
    expect(rules[0]).toMatchObject({ action: 'case.proceed', approver: 'safety-officer', require_approval: true, when: { category: ['breakdown'], priority: ['P1'] } });
    expect(rules[2]).toMatchObject({ action: 'case.close', approver: 'maintenance-head' });
    expect(rules[3]).toMatchObject({ require_approval_above: { amount: 50000, currency: 'INR' } });
    expect(rules[0]!.reason).toBe('Breakdown repair: P1 cases need approval by the safety officer');
  });

  it('adds derived policies when resolving and validates cleanly', () => {
    const resolved = resolvePack(plant, lookup);
    expect(resolved.policies.some((p) => p.id === 'lifecycle-breakdown-signoff')).toBe(true);
    expect(validatePackRefs(resolved)).toEqual([]);
  });

  it('names missing roles and workflows', () => {
    const resolved = resolvePack(plant, lookup);
    const broken: ResolvedPack = {
      ...resolved,
      lifecycle: {
        ...resolved.lifecycle!,
        categories: resolved.lifecycle!.categories.map((c) => (c.id === 'breakdown' ? { ...c, workflow: 'nope', approval: { required: 'always' as const, role: 'ghost' } } : c)),
      },
    };
    expect(validatePackRefs(broken)).toEqual(expect.arrayContaining([
      'lifecycle category breakdown: unknown workflow nope',
      'lifecycle category breakdown: unknown approval role ghost',
    ]));
  });

  it('reads a generic lifecycle from workspaces installed before lifecycles', () => {
    const { lifecycle: _drop, ...old } = resolvePack(registry.get('travel-agency')!, lookup);
    expect(lifecycleOf(old as ResolvedPack)).toEqual(GENERIC_LIFECYCLE);
  });

  it('offers the lifecycle and the coordinator to older workspaces, and only adds', () => {
    const latest = resolvePack(registry.get('travel-agency')!, lookup);
    const { lifecycle: _drop, ...rest } = latest;
    const old = { ...rest, agents: rest.agents.filter((a) => a.role !== 'case-coordinator') } as ResolvedPack;
    const updates = packUpdates(old, latest);
    expect(updates.lifecycle.whole).toEqual(latest.lifecycle);
    expect(updates.agents.map((a) => a.role)).toContain('case-coordinator');
    expect(countPackUpdates(updates)).toBeGreaterThan(1);
    const applied = applyPackUpdates(old, updates);
    expect(applied.lifecycle).toEqual(latest.lifecycle);
    expect(validatePackRefs(applied)).toEqual([]);
    expect(countPackUpdates(packUpdates(applied, latest))).toBe(0);
    expect(countPackUpdates(emptyPackUpdates())).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/lifecycle.test.ts`
Expected: FAIL. `GENERIC_LIFECYCLE`, `mergeLifecycles`, `lifecycleOf`, `lifecyclePolicies` and `emptyPackUpdates` aren't exported.

- [ ] **Step 3: Create `packages/agent-kit/src/lifecycle/generic.ts`**

```ts
import type { ResolvedLifecycle } from '@onehuman/schemas';

/**
 * The root layer of every lifecycle: the product owner's generic stage names,
 * P1–P4 defaults, the owner role and a catch-all category. Sector and
 * organization packs rename stages and add categories on top.
 */
export const GENERIC_LIFECYCLE: ResolvedLifecycle = {
  case: { label: 'Case', plural: 'Cases', prefix: 'CS' },
  stages: [
    { key: 'request', name: 'Request / Event Created', description: 'Takes in a request from a user, customer, employee, system alert or external partner.', checks: [] },
    { key: 'review', name: 'Admin Review & Validation', description: 'Checks the details, documents, eligibility and completeness.', checks: [] },
    { key: 'classify', name: 'Classification & Priority', description: 'Sets the category, urgency, risk, response time and department.', checks: [] },
    { key: 'assign', name: 'Assignment', description: 'Names the person or team in charge and the deadline.', checks: [] },
    { key: 'approve', name: 'Approval Gate', description: 'An authorised person approves when the rules require it.', checks: [] },
    { key: 'execute', name: 'Execution & Monitoring', description: 'Does the work and tracks progress, cost, evidence and deadlines.', checks: [] },
    { key: 'close', name: 'Verification & Closure', description: 'Confirms the outcome and gets the final sign-off when required.', checks: [] },
    { key: 'report', name: 'Reporting & Continuous Improvement', description: 'Reports the result, the time taken and any problem that keeps coming back.', checks: [] },
  ],
  priorities: [
    { id: 'P1', name: 'Critical', respond_within_hours: 1, resolve_within_hours: 4 },
    { id: 'P2', name: 'High', respond_within_hours: 4, resolve_within_hours: 24 },
    { id: 'P3', name: 'Normal', respond_within_hours: 24, resolve_within_hours: 72 },
    { id: 'P4', name: 'Low', respond_within_hours: 72, resolve_within_hours: 168 },
  ],
  roles: [{ id: 'owner', name: 'Owner', approves: 'Anything the rules send to the owner' }],
  urgent_keywords: ['emergency', 'fire', 'injury', 'injured', 'accident', 'explosion', 'gas leak', 'outage', 'theft', 'fraud'],
  categories: [
    {
      id: 'general',
      name: 'General request',
      // Deliberately rare: unmatched requests reach this category as the fallback, so common
      // words here would steal requests from real categories.
      keywords: ['general request'],
      priority: 'P3',
      risk: 'low',
      department: 'Operations',
      required_details: [],
      required_checks: [],
      not_eligible: [],
      approval: { required: 'never' },
      signoff: { required: false },
      execution: 'agents',
    },
  ],
  fallback_category: 'general',
  examples: [],
};
```

- [ ] **Step 4: Create `packages/agent-kit/src/lifecycle/resolve.ts`**

```ts
import {
  PRIORITY_IDS,
  STAGE_KEYS,
  type CaseCategory,
  type Lifecycle,
  type LifecycleExample,
  type LifecyclePriority,
  type LifecycleRole,
  type PolicyRule,
  type ResolvedLifecycle,
  type ResolvedPack,
  type ResolvedStage,
  type StageKey,
} from '@onehuman/schemas';
import { CASE_COORDINATOR_ROLE } from '../catalog';
import { GENERIC_LIFECYCLE } from './generic';

/** Merge lifecycle parts from the most basic pack to the most specific; later parts win. */
export function mergeLifecycles(parts: Lifecycle[]): ResolvedLifecycle {
  const stages = new Map<StageKey, ResolvedStage>(GENERIC_LIFECYCLE.stages.map((s) => [s.key, s]));
  const priorities = new Map<string, LifecyclePriority>(GENERIC_LIFECYCLE.priorities.map((p) => [p.id, p]));
  const roles = new Map<string, LifecycleRole>(GENERIC_LIFECYCLE.roles.map((r) => [r.id, r]));
  const categories = new Map<string, CaseCategory>(GENERIC_LIFECYCLE.categories.map((c) => [c.id, c]));
  const urgent = new Set(GENERIC_LIFECYCLE.urgent_keywords);
  const examples: LifecycleExample[] = [...GENERIC_LIFECYCLE.examples];
  let caseLabel = GENERIC_LIFECYCLE.case;
  let fallback = GENERIC_LIFECYCLE.fallback_category;

  for (const part of parts) {
    if (part.case) caseLabel = part.case;
    for (const key of STAGE_KEYS) {
      const own = part.stages[key];
      if (!own) continue;
      const prev = stages.get(key)!;
      stages.set(key, { key, name: own.name, description: own.description ?? prev.description, checks: own.checks ?? prev.checks });
    }
    part.priorities.forEach((p) => priorities.set(p.id, p));
    part.roles.forEach((r) => roles.set(r.id, r));
    part.categories.forEach((c) => categories.set(c.id, c));
    part.urgent_keywords.forEach((k) => urgent.add(k));
    examples.push(...part.examples);
    if (part.fallback_category) fallback = part.fallback_category;
  }

  return {
    case: caseLabel,
    stages: STAGE_KEYS.map((k) => stages.get(k)!),
    priorities: PRIORITY_IDS.map((id) => priorities.get(id)!),
    roles: [...roles.values()],
    urgent_keywords: [...urgent],
    categories: [...categories.values()],
    fallback_category: fallback,
    examples,
  };
}

/** The lifecycle a workspace runs. Older snapshots without one get the generic lifecycle. */
export function lifecycleOf(pack: ResolvedPack): ResolvedLifecycle {
  return pack.lifecycle ?? GENERIC_LIFECYCLE;
}

/**
 * Category approval and sign-off rules, as ordinary pack policies on the gate
 * tools. They show in the policy viewer and compile to Cedar like any rule.
 */
export function lifecyclePolicies(lc: ResolvedLifecycle): PolicyRule[] {
  const roleName = (id: string) => (lc.roles.find((r) => r.id === id)?.name ?? id).toLowerCase();
  const rules: PolicyRule[] = [];
  for (const c of lc.categories) {
    const role = c.approval.role ?? 'owner';
    const base = { action: 'case.proceed', approver: role } as const;
    switch (c.approval.required) {
      case 'always':
        rules.push({ ...base, id: `lifecycle-${c.id}-approve`, require_approval: true, when: { category: [c.id] }, reason: `${c.name} needs approval by the ${roleName(role)}` });
        break;
      case 'above_amount':
        rules.push({
          ...base,
          id: `lifecycle-${c.id}-approve`,
          require_approval_above: { amount: c.approval.amount_inr!, currency: 'INR' },
          when: { category: [c.id] },
          reason: `${c.name} above ₹${c.approval.amount_inr!.toLocaleString('en-IN')} needs approval by the ${roleName(role)}`,
        });
        break;
      case 'high_risk_or_p1':
        rules.push(
          { ...base, id: `lifecycle-${c.id}-approve-p1`, require_approval: true, when: { category: [c.id], priority: ['P1'] }, reason: `${c.name}: P1 cases need approval by the ${roleName(role)}` },
          { ...base, id: `lifecycle-${c.id}-approve-high-risk`, require_approval: true, when: { category: [c.id], risk: ['high'] }, reason: `${c.name}: high-risk cases need approval by the ${roleName(role)}` },
        );
        break;
      case 'never':
        break;
    }
    if (c.signoff.required) {
      const signer = c.signoff.role!;
      rules.push({ id: `lifecycle-${c.id}-signoff`, action: 'case.close', approver: signer, require_approval: true, when: { category: [c.id] }, reason: `${c.name} needs final sign-off by the ${roleName(signer)}` });
    }
  }
  return rules;
}

/** Cross-reference checks for a resolved lifecycle. */
export function validateLifecycle(lc: ResolvedLifecycle, pack: ResolvedPack): string[] {
  const issues: string[] = [];
  const roles = new Set(lc.roles.map((r) => r.id));
  const workflows = new Set(pack.workflows.map((w) => w.id));
  const categories = new Set(lc.categories.map((c) => c.id));

  if (lc.stages.length !== 8) issues.push('lifecycle: needs exactly 8 stages');
  if (!roles.has('owner')) issues.push('lifecycle: the owner role is missing');
  if (lc.categories.length === 0) issues.push('lifecycle: needs at least one category');
  if (lc.fallback_category && !categories.has(lc.fallback_category)) issues.push(`lifecycle: unknown fallback category ${lc.fallback_category}`);
  for (const c of lc.categories) {
    if (c.workflow && !workflows.has(c.workflow)) issues.push(`lifecycle category ${c.id}: unknown workflow ${c.workflow}`);
    if (c.approval.role && !roles.has(c.approval.role)) issues.push(`lifecycle category ${c.id}: unknown approval role ${c.approval.role}`);
    if (c.signoff.role && !roles.has(c.signoff.role)) issues.push(`lifecycle category ${c.id}: unknown sign-off role ${c.signoff.role}`);
  }
  for (const ex of lc.examples) {
    if (!categories.has(ex.category)) issues.push(`lifecycle example "${ex.request.slice(0, 40)}": unknown category ${ex.category}`);
  }
  if (!pack.agents.some((a) => a.role === CASE_COORDINATOR_ROLE)) issues.push('lifecycle: the case-coordinator agent is missing');
  return issues;
}
```

- [ ] **Step 5: Create `packages/agent-kit/src/lifecycle/index.ts` and export it**

```ts
export * from './generic';
export * from './resolve';
```

In `packages/agent-kit/src/index.ts`, add:

```ts
export * from './lifecycle';
```

- [ ] **Step 6: Merge lifecycles in `resolvePack`**

In `packages/agent-kit/src/pack.ts`, add an import:

```ts
import { lifecyclePolicies, mergeLifecycles, validateLifecycle } from './lifecycle/resolve';
```

In `resolvePack`, after the `for (const p of chain)` loop and before `merged.entities = …`, add:

```ts
  const lifecycle = mergeLifecycles(chain.flatMap((p) => (p.lifecycle ? [p.lifecycle] : [])));
  // Derived gate policies; an explicit pack policy with the same id wins.
  for (const rule of lifecyclePolicies(lifecycle)) {
    if (!policies.has(policyKey(rule))) policies.set(policyKey(rule), rule);
  }
  merged.sector = [...chain].reverse().find((p) => p.sector)?.sector;
```

Change the `return` of `resolvePack` to:

```ts
  return applyLabels({ ...merged, lifecycle, lineage: chain.map((p) => p.id), source });
```

- [ ] **Step 7: Validate lifecycles and policy `when` in `validatePackRefs`**

In `validatePackRefs`, replace the `for (const rule of pack.policies)` loop with:

```ts
  const categoryIds = new Set((pack.lifecycle?.categories ?? []).map((c) => c.id));
  for (const rule of pack.policies) {
    if (rule.action !== '*' && !toolExists(rule.action)) issues.push(`policy on unknown tool ${rule.action}`);
    if (rule.agent && !roles.has(rule.agent)) issues.push(`policy on unknown agent role ${rule.agent}`);
    for (const id of rule.when?.category ?? []) {
      if (!categoryIds.has(id)) issues.push(`policy ${rule.id ?? rule.action}: unknown lifecycle category ${id}`);
    }
  }
  if (pack.lifecycle) issues.push(...validateLifecycle(pack.lifecycle, pack));
```

- [ ] **Step 8: Lifecycle pack updates**

In `packages/agent-kit/src/pack.ts`, replace the body of `packUpdates` from `return {` to the end of the function with:

```ts
  const workflows = missing(latest.workflows, installed.workflows, (w) => w.id).filter((w) => w.steps.every((s) => roles.has(s.agent)));
  const workflowIds = new Set([...installed.workflows, ...workflows].map((w) => w.id));

  let lifecycle: PackUpdates['lifecycle'] = { whole: null, categories: [], roles: [] };
  if (latest.lifecycle && !installed.lifecycle) {
    lifecycle = { whole: latest.lifecycle, categories: [], roles: [] };
  } else if (latest.lifecycle && installed.lifecycle) {
    lifecycle = {
      whole: null,
      categories: missing(latest.lifecycle.categories, installed.lifecycle.categories, (c) => c.id).filter((c) => !c.workflow || workflowIds.has(c.workflow)),
      roles: missing(latest.lifecycle.roles, installed.lifecycle.roles, (r) => r.id),
    };
  }
  const categoryIds = new Set([
    ...(lifecycle.whole?.categories ?? installed.lifecycle?.categories ?? []),
    ...lifecycle.categories,
  ].map((c) => c.id));

  return {
    agents,
    tools,
    workflows,
    routines: missing(latest.routines ?? [], installed.routines ?? [], (r) => r.id),
    policies: missing(latest.policies, installed.policies, policyKey).filter(
      (r) => (!r.agent || roles.has(r.agent)) && (r.when?.category ?? []).every((id) => categoryIds.has(id)),
    ),
    kpis: missing(latest.kpis, installed.kpis, (k) => k.id).filter((k) => k.source?.type !== 'records_count' || entities.has(k.source.entity)),
    lifecycle,
  };
}

export function emptyPackUpdates(): PackUpdates {
  return { agents: [], tools: [], workflows: [], routines: [], policies: [], kpis: [], lifecycle: { whole: null, categories: [], roles: [] } };
}
```

Replace `countPackUpdates` and `applyPackUpdates` with:

```ts
export function countPackUpdates(u: PackUpdates): number {
  return (
    u.agents.length + u.tools.length + u.workflows.length + u.routines.length + u.policies.length + u.kpis.length +
    (u.lifecycle.whole ? 1 : 0) + u.lifecycle.categories.length + u.lifecycle.roles.length
  );
}

export function applyPackUpdates(installed: ResolvedPack, u: PackUpdates): ResolvedPack {
  const lifecycle = u.lifecycle.whole
    ? u.lifecycle.whole
    : installed.lifecycle && {
        ...installed.lifecycle,
        categories: [...installed.lifecycle.categories, ...u.lifecycle.categories],
        roles: [...installed.lifecycle.roles, ...u.lifecycle.roles],
      };
  return {
    ...installed,
    agents: [...installed.agents, ...u.agents],
    tools: [...installed.tools, ...u.tools],
    workflows: [...installed.workflows, ...u.workflows],
    routines: [...(installed.routines ?? []), ...u.routines],
    policies: [...installed.policies, ...u.policies],
    kpis: [...installed.kpis, ...u.kpis],
    ...(lifecycle && { lifecycle }),
  };
}
```

- [ ] **Step 9: Use the new helpers in the backend and the web banner**

In `master-ai-backend/src/tenancy/onboarding.service.ts`:
- Add `emptyPackUpdates` to the `@onehuman/agent-kit` import.
- Replace the `updatesFor` return line with `return latest ? packUpdates(installed, latest) : emptyPackUpdates();`.
- In `describeUpdates`, add the first entry of `parts`:

```ts
    u.lifecycle.whole ? '8-stage case lifecycle' : '',
    ...u.lifecycle.categories.map((c) => `${c.name} (case type)`),
```

In `master-ai-web/src/components/pack-updates.tsx`, replace the `extras` and the early `return null` lines with:

```tsx
  const extras = u.tools.length + u.policies.length + u.kpis.length + (u.lifecycle?.categories.length ?? 0) + (u.lifecycle?.roles.length ?? 0);
  const routines = u.routines ?? [];
  const lifecycle = u.lifecycle?.whole ?? null;
  if (u.agents.length + u.workflows.length + routines.length + extras + (lifecycle ? 1 : 0) === 0) return null;
```

Inside the `<ul>`, before the agents list, add:

```tsx
            {lifecycle && (
              <li><span className="font-medium text-fg">8-stage case lifecycle</span> <span className="text-fg-muted">· every request runs from {lifecycle.stages[0]!.name} to {lifecycle.stages[7]!.name}</span></li>
            )}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run`
Expected: PASS. The `lifecycle.test.ts` resolution tests pass, and `pack.test.ts` stays green.

- [ ] **Step 11: Run the full checks**

Run: `pnpm turbo run build typecheck test`
Expected: all successful.

- [ ] **Step 12: Commit**

```bash
git add packages/agent-kit/src master-ai-backend/src/tenancy/onboarding.service.ts master-ai-web/src/components/pack-updates.tsx
git commit -m "feat(agent-kit): resolve lifecycles, derive gate policies, offer lifecycles as pack updates"
```

---

### Task 5: Extractors for amounts, dates and contacts

**Files:**
- Create: `packages/agent-kit/src/lifecycle/extract.ts`
- Modify: `packages/agent-kit/src/lifecycle/index.ts`
- Test: `packages/agent-kit/src/extract.test.ts` (new)

**Interfaces:**
- Consumes: `RequiredDetail`, `Requester` (Task 1).
- Produces:
  - `normalizeText(text: string): string`
  - `phraseIn(text: string, phrase: string): boolean`
  - `extractAmountInr(text: string): number | null`
  - `hasDate(text: string): boolean`
  - `extractPhone(text: string): string | null`
  - `extractEmail(text: string): string | null`
  - `hasDetail(detail: RequiredDetail, text: string, requester?: Requester, amountInr?: number | null): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-kit/src/extract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractAmountInr, extractEmail, extractPhone, hasDate, hasDetail, phraseIn } from './index';

describe('extractAmountInr', () => {
  it.each([
    ['I need a personal loan of Rs 1.5 lakh', 150000],
    ['Refund ₹45,000 to the customer', 45000],
    ['quote is 1,50,000 rupees', 150000],
    ['LAP case for Rs 45 lakh against their shop', 4500000],
    ['project worth 2 crore', 20000000],
    ['EMI Rs. 4,250 bounced', 4250],
    ['INR 12000 advance', 12000],
    ['budget around 50k', 50000],
    ['about 5 thousand rupees', 5000],
  ])('reads %s', (text, amount) => {
    expect(extractAmountInr(text)).toBe(amount);
  });

  it('ignores numbers that are not money', () => {
    expect(extractAmountInr('Loan LN-20931 is 97 days overdue; vibration 11 mm/s since 05-10-2026')).toBeNull();
    expect(extractAmountInr('Send 15 kg of bolts to bay 4')).toBeNull();
  });

  it('takes the largest amount', () => {
    expect(extractAmountInr('My EMI Rs 4,250 bounced, and I want a top-up of ₹1.5 lakh')).toBe(150000);
  });
});

describe('dates and contacts', () => {
  it.each(['due 05-10-2026', 'by 2026-10-20', 'on 28 September', 'Sept 28th', 'tomorrow morning', 'next Monday'])('finds a date in %s', (text) => {
    expect(hasDate(text)).toBe(true);
  });
  it('finds no date in plain text', () => expect(hasDate('the pump is vibrating')).toBe(false));
  it('finds Indian phone numbers and emails', () => {
    expect(extractPhone('call me on +91 98450 12345 today')).toBe('+91 98450 12345');
    expect(extractPhone('my number is 9845012345')).toBe('9845012345');
    expect(extractEmail('write to asha.k@example.in please')).toBe('asha.k@example.in');
    expect(extractPhone('order 12345')).toBeNull();
  });
});

describe('phraseIn and hasDetail', () => {
  it('matches whole words and simple plurals', () => {
    expect(phraseIn('Two pumps are vibrating', 'pump')).toBe(true);
    expect(phraseIn('EMI bounced again', 'emi bounced')).toBe(true);
    expect(phraseIn('pumpkin delivery', 'pump')).toBe(false);
  });

  it('checks required details by kind', () => {
    expect(hasDetail({ key: 'amount', label: 'Loan amount', kind: 'amount' }, 'need a loan')).toBe(false);
    expect(hasDetail({ key: 'amount', label: 'Loan amount', kind: 'amount' }, 'need a loan', undefined, 200000)).toBe(true);
    expect(hasDetail({ key: 'contact', label: 'Phone or email', kind: 'contact' }, 'help', { name: 'Asha', phone: '9845012345' })).toBe(true);
    expect(hasDetail({ key: 'asset', label: 'Which equipment', kind: 'keywords', keywords: ['pump', 'boiler'] }, 'boiler B trip')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/extract.test.ts`
Expected: FAIL. `extractAmountInr` and the other helpers aren't exported.

- [ ] **Step 3: Create `packages/agent-kit/src/lifecycle/extract.ts`**

```ts
import type { RequiredDetail, Requester } from '@onehuman/schemas';

/** Lowercase, keep letters, digits and spaces, collapse whitespace. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stem(t: string): string {
  if (t.endsWith('ies') && t.length > 4) return `${t.slice(0, -3)}y`;
  if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) return t.slice(0, -1);
  return t;
}

function stemmed(text: string): string {
  return normalizeText(text).split(' ').filter(Boolean).map(stem).join(' ');
}

/** True when the phrase appears as whole words (plurals folded) in the text. */
export function phraseIn(text: string, phrase: string): boolean {
  const p = stemmed(phrase);
  return p.length > 0 && ` ${stemmed(text)} `.includes(` ${p} `);
}

const MAGNITUDE: Record<string, number> = { lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7, cr: 1e7, thousand: 1e3, k: 1e3 };
const NUM = String.raw`(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?`;
const MAG = String.raw`(lakhs?|lacs?|crores?|cr|thousand|k)\b`;
const AMOUNT_PATTERNS = [
  // ₹45,000 · Rs 1.5 lakh · INR 12000
  new RegExp(String.raw`(?:₹|\brs\.?|\binr)\s*${NUM}(?:\s*${MAG})?`, 'gi'),
  // 1.5 lakh · 2 crore · 50k · 5 thousand (rupees)
  new RegExp(String.raw`\b${NUM}\s*${MAG}`, 'gi'),
  // 500 rupees · 4000 rs
  new RegExp(String.raw`\b${NUM}\s*(?:rupees?|rs\b\.?|inr\b)`, 'gi'),
];

/**
 * The largest rupee amount in the text, or null. Only numbers marked as money
 * (₹, Rs, INR, rupees) or with a size word (lakh, crore, thousand, k) count,
 * so ids, dates and measurements never become amounts.
 */
export function extractAmountInr(text: string): number | null {
  let best: number | null = null;
  for (const pattern of AMOUNT_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const whole = Number(m[1]!.replace(/,/g, ''));
      const value = m[2] ? Number(`${whole}.${m[2]}`) : whole;
      const mag = m[3] ? MAGNITUDE[m[3].toLowerCase()] ?? 1 : 1;
      const amount = Math.round(value * mag);
      if (Number.isFinite(amount) && amount > 0 && (best === null || amount > best)) best = amount;
    }
  }
  return best;
}

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DATE_PATTERNS = [
  /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}\b`, 'i'),
  new RegExp(String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?\b`, 'i'),
  /\b(?:today|tonight|tomorrow|yesterday|next week|this week|next month)\b/i,
  /\b(?:next |this |on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
];

export function hasDate(text: string): boolean {
  return DATE_PATTERNS.some((p) => p.test(text));
}

export function extractPhone(text: string): string | null {
  const indian = text.match(/(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/);
  if (indian) return indian[0];
  const general = text.match(/\+\d{1,3}[\d\s-]{8,14}\d/);
  return general ? general[0] : null;
}

export function extractEmail(text: string): string | null {
  return text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? null;
}

/** Does the request carry this required detail? */
export function hasDetail(detail: RequiredDetail, text: string, requester?: Requester, amountInr?: number | null): boolean {
  switch (detail.kind) {
    case 'amount':
      return (amountInr ?? null) !== null || extractAmountInr(text) !== null;
    case 'date':
      return hasDate(text);
    case 'phone':
      return !!requester?.phone || extractPhone(text) !== null;
    case 'email':
      return !!requester?.email || extractEmail(text) !== null;
    case 'contact':
      return !!requester?.phone || !!requester?.email || extractPhone(text) !== null || extractEmail(text) !== null;
    case 'keywords':
      return (detail.keywords ?? []).some((k) => phraseIn(text, k));
  }
}
```

Append to `packages/agent-kit/src/lifecycle/index.ts`:

```ts
export * from './extract';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/extract.test.ts`
Expected: PASS. If a single case fails, fix the regex for that case rather than loosening the "not money" test.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-kit/src/lifecycle packages/agent-kit/src/extract.test.ts
git commit -m "feat(agent-kit): rupee amount, date and contact extractors for offline review"
```

---

### Task 6: Offline stage strategies

**Files:**
- Create: `packages/agent-kit/src/lifecycle/offline.ts`
- Modify: `packages/agent-kit/src/lifecycle/index.ts`
- Test: `packages/agent-kit/src/offline-stages.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 part types; `phraseIn`, `extractAmountInr`, `hasDetail` (Task 5); `GENERIC_LIFECYCLE` (Task 4).
- Produces:
  - `offlineRequest(input: { text: string; requester: Requester; source: CaseSource; receivedAt: string; title?: string }): RequestPart`
  - `matchCategory(lc: ResolvedLifecycle, text: string): { category: CaseCategory; matched: string[]; score: number } | null`
  - `offlineReview(lc: ResolvedLifecycle, request: RequestPart, amountInr?: number | null): ReviewPart`
  - `offlineClassify(lc: ResolvedLifecycle, request: RequestPart, now: Date, amountInr?: number | null): ClassifyPart`
  - `TeamMember = { id: string; name: string; title: string; responsibilities: string[] }`
  - `offlineAssign(lc: ResolvedLifecycle, classify: ClassifyPart, team: TeamMember[]): AssignPart`
  - `offlineVerify(input: { goalStatus: string; escalatedTasks: number; summary: string }): Pick<ClosePart, 'verified' | 'findings' | 'outcome'>`
  - `offlineReport(input: ReportInput): ReportPart`, where `ReportInput = { caseLabel: string; number: string; title: string; categoryName?: string; outcome: string; stages: { key: StageKey; name: string; status: string; startedAt?: string | null; completedAt?: string | null }[]; createdAt: string; resolveBy?: string | null; closedAt: string; sameCategoryLast30Days: number }`
- **Category matching rule** (documented for pack authors in Plan 2): each matched keyword scores its word count. The highest total wins; ties go to the more urgent priority, then to the earlier category in the pack. No match falls back to `fallback_category`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-kit/src/offline-stages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ResolvedLifecycle } from '@onehuman/schemas';
import { mergeLifecycles, matchCategory, offlineAssign, offlineClassify, offlineReport, offlineRequest, offlineReview, offlineVerify } from './index';

const lc: ResolvedLifecycle = mergeLifecycles([
  {
    case: { label: 'Work order', plural: 'Work orders', prefix: 'WO' },
    stages: {},
    priorities: [],
    roles: [{ id: 'safety-officer', name: 'Safety officer', approves: 'Permits' }],
    urgent_keywords: ['smoke'],
    categories: [
      { id: 'breakdown', name: 'Breakdown repair', keywords: ['breakdown', 'vibration', 'not working', 'tripped'], priority: 'P2', risk: 'high', department: 'Maintenance',
        required_details: [{ key: 'asset', label: 'Which equipment', kind: 'keywords', keywords: ['pump', 'boiler', 'turbine', 'conveyor'] }],
        required_checks: ['Isolation confirmed'], not_eligible: [], approval: { required: 'high_risk_or_p1', role: 'safety-officer' }, signoff: { required: false }, execution: 'team' },
      { id: 'spares', name: 'Spares purchase', keywords: ['spares', 'purchase', 'buy'], priority: 'P4', risk: 'low', department: 'Stores',
        required_details: [{ key: 'amount', label: 'Estimated cost', kind: 'amount' }], required_checks: [],
        not_eligible: [{ keywords: ['personal use'], reason: 'Company money cannot buy things for personal use.' }, { keywords: [], amount_above_inr: 5000000, reason: 'Purchases above ₹50 lakh go through a tender.' }],
        approval: { required: 'above_amount', role: 'owner', amount_inr: 50000 }, signoff: { required: false }, execution: 'agents' },
    ],
    examples: [],
  },
]);

const request = (text: string) =>
  offlineRequest({ text, requester: { name: 'Control room' }, source: 'system', receivedAt: '2026-10-13T06:12:00.000Z' });

describe('offline stages', () => {
  it('writes a short title and keeps the full text', () => {
    const r = request('Boiler feed pump B vibrating above limit. Vibration is 11 mm/s and rising since the night shift started, please send someone before it trips the unit.');
    expect(r.title).toBe('Boiler feed pump B vibrating above limit.');
    expect(r.text).toContain('night shift');
  });

  it('matches the category with the strongest keywords', () => {
    expect(matchCategory(lc, 'Pump B vibration, now not working')!.category.id).toBe('breakdown');
    expect(matchCategory(lc, 'please buy spares for the conveyor')!.category.id).toBe('spares');
  });

  it('falls back when nothing matches', () => {
    expect(matchCategory(lc, 'Canteen menu feedback')).toBeNull();
    const c = offlineClassify(lc, request('Canteen menu feedback'), new Date('2026-10-13T06:12:00Z'));
    expect(c.category).toBe('general');
    expect(c.reasons[0]).toMatch(/No category matched/);
  });

  it('asks for missing details', () => {
    const review = offlineReview(lc, request('Strong vibration near bay 4, please check'));
    expect(review.outcome).toBe('needs_info');
    expect(review.missing).toEqual([{ key: 'asset', label: 'Which equipment' }]);
    expect(review.toConfirm).toEqual(['Isolation confirmed']);
  });

  it('marks requests that are not eligible', () => {
    const personal = offlineReview(lc, request('Please purchase a TV for personal use, about ₹40,000'));
    expect(personal.outcome).toBe('not_eligible');
    expect(personal.reason).toBe('Company money cannot buy things for personal use.');
    const huge = offlineReview(lc, request('Purchase new turbine spares worth 6 crore'));
    expect(huge.outcome).toBe('not_eligible');
  });

  it('passes complete requests', () => {
    expect(offlineReview(lc, request('Boiler feed pump B vibration above limit')).outcome).toBe('complete');
  });

  it('sets priority, risk, department and deadlines', () => {
    const c = offlineClassify(lc, request('Boiler feed pump B vibration above limit'), new Date('2026-10-13T06:12:00Z'));
    expect(c).toMatchObject({ category: 'breakdown', categoryName: 'Breakdown repair', priority: 'P2', risk: 'high', department: 'Maintenance', amountInr: null });
    expect(c.respondBy).toBe('2026-10-13T10:12:00.000Z');
    expect(c.resolveBy).toBe('2026-10-14T06:12:00.000Z');
  });

  it('raises urgent requests to P1 and high risk', () => {
    const c = offlineClassify(lc, request('Smoke coming from conveyor 3 motor, breakdown'), new Date('2026-10-13T06:12:00Z'));
    expect(c.priority).toBe('P1');
    expect(c.risk).toBe('high');
    expect(c.reasons.join(' ')).toMatch(/smoke/);
  });

  it('uses a given amount before extracting one', () => {
    expect(offlineClassify(lc, request('buy spares'), new Date(), 75000).amountInr).toBe(75000);
    expect(offlineClassify(lc, request('buy spares for ₹1.2 lakh'), new Date()).amountInr).toBe(120000);
  });

  it('assigns the best-placed person, or the department when nobody fits', () => {
    const c = offlineClassify(lc, request('Boiler feed pump vibration'), new Date('2026-10-13T06:12:00Z'));
    const team = [
      { id: 's1', name: 'Ravi Kumar', title: 'Mechanical supervisor', responsibilities: ['maintenance', 'pumps', 'breakdown repairs'] },
      { id: 's2', name: 'Meera Iyer', title: 'Stores officer', responsibilities: ['spares', 'purchase'] },
    ];
    const a = offlineAssign(lc, c, team);
    expect(a.assignee).toEqual({ staffId: 's1', name: 'Ravi Kumar', title: 'Mechanical supervisor' });
    expect(a.deadline).toBe(c.resolveBy);
    const stores = [team[1]!, { id: 's3', name: 'Joseph D', title: 'Accounts clerk', responsibilities: ['billing'] }];
    const none = offlineAssign(lc, c, stores);
    expect(none.assignee).toBeNull();
    expect(none.team).toBe('Maintenance');
    expect(none.reason).toBe('Nobody on the team covers maintenance yet, so it is with the Maintenance team.');
    const solo = offlineAssign(lc, c, [{ id: 's9', name: 'Owner', title: 'Owner', responsibilities: [] }]);
    expect(solo.assignee?.name).toBe('Owner');
  });

  it('verifies from the work outcome', () => {
    expect(offlineVerify({ goalStatus: 'completed', escalatedTasks: 0, summary: 'Replaced the bearing.' })).toEqual({ verified: true, findings: ['Replaced the bearing.'], outcome: 'resolved' });
    expect(offlineVerify({ goalStatus: 'partially_completed', escalatedTasks: 1, summary: 'Bearing on order.' }).outcome).toBe('not_resolved');
  });

  it('reports time per stage, the SLA and recurring problems', () => {
    const report = offlineReport({
      caseLabel: 'Work order', number: 'WO-0042', title: 'Boiler feed pump B vibrating above limit', categoryName: 'Breakdown repair', outcome: 'resolved',
      createdAt: '2026-10-13T06:12:00.000Z', resolveBy: '2026-10-13T10:12:00.000Z', closedAt: '2026-10-13T09:32:00.000Z', sameCategoryLast30Days: 3,
      stages: [
        { key: 'request', name: 'Work order raised', status: 'done', startedAt: '2026-10-13T06:12:00.000Z', completedAt: '2026-10-13T06:12:30.000Z' },
        { key: 'execute', name: 'Work under permit', status: 'done', startedAt: '2026-10-13T07:00:00.000Z', completedAt: '2026-10-13T09:20:00.000Z' },
        { key: 'approve', name: 'Safety (HSE) approval', status: 'skipped' },
      ],
    });
    expect(report.slaMet).toBe(true);
    expect(report.minutesPerStage).toEqual([{ stage: 'request', minutes: 1 }, { stage: 'execute', minutes: 140 }]);
    expect(report.recurring).toEqual({ count: 3, note: '3 breakdown repairs in the last 30 days. Worth looking for a root cause.' });
    expect(report.text).toBe('WO-0042 Boiler feed pump B vibrating above limit was resolved in 3 h 20 min, inside its 4 h target. 3 breakdown repairs in the last 30 days. Worth looking for a root cause.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/offline-stages.test.ts`
Expected: FAIL. `offlineRequest` and the other strategies aren't exported.

- [ ] **Step 3: Create `packages/agent-kit/src/lifecycle/offline.ts`**

```ts
import type {
  AssignPart,
  CaseCategory,
  CaseRisk,
  CaseSource,
  ClassifyPart,
  ClosePart,
  PriorityId,
  ReportPart,
  RequestPart,
  Requester,
  ResolvedLifecycle,
  ReviewPart,
  StageKey,
} from '@onehuman/schemas';
import { extractAmountInr, hasDetail, normalizeText, phraseIn } from './extract';

/**
 * Deterministic stand-ins for the stage model calls. They run when no model
 * key is set, in tests and in evals, under the same output contracts.
 */

const PRIORITY_RANK: Record<PriorityId, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`;
}

export function offlineRequest(input: { text: string; requester: Requester; source: CaseSource; receivedAt: string; title?: string }): RequestPart {
  const clean = input.text.replace(/\s+/g, ' ').trim();
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return {
    title: input.title?.trim() || truncateWords(firstSentence, 80),
    summary: truncateWords(clean, 400),
    requester: input.requester,
    source: input.source,
    receivedAt: input.receivedAt,
    text: input.text,
  };
}

/** Best category by keyword strength; null when no keyword matches. */
export function matchCategory(lc: ResolvedLifecycle, text: string): { category: CaseCategory; matched: string[]; score: number } | null {
  let best: { category: CaseCategory; matched: string[]; score: number } | null = null;
  // Pack order breaks the final tie: an earlier category is only replaced by a strictly better one.
  for (const category of lc.categories) {
    const matched = category.keywords.filter((k) => phraseIn(text, k));
    const score = matched.reduce((sum, k) => sum + normalizeText(k).split(' ').length, 0);
    if (score === 0) continue;
    const better =
      best === null ||
      score > best.score ||
      (score === best.score && PRIORITY_RANK[category.priority] < PRIORITY_RANK[best.category.priority]);
    if (better) best = { category, matched, score };
  }
  return best;
}

function categoryOrFallback(lc: ResolvedLifecycle, text: string): { category: CaseCategory; matched: string[] } {
  const hit = matchCategory(lc, text);
  if (hit) return hit;
  const fallback = lc.categories.find((c) => c.id === lc.fallback_category) ?? lc.categories[0]!;
  return { category: fallback, matched: [] };
}

export function offlineReview(lc: ResolvedLifecycle, request: RequestPart, amountInr?: number | null): ReviewPart {
  const { category } = categoryOrFallback(lc, request.text);
  const amount = amountInr ?? extractAmountInr(request.text);

  for (const rule of category.not_eligible) {
    const byWord = rule.keywords.some((k) => phraseIn(request.text, k));
    const byAmount = rule.amount_above_inr !== undefined && amount !== null && amount > rule.amount_above_inr;
    if (byWord || byAmount) {
      return { outcome: 'not_eligible', provisionalCategory: category.id, checks: [], missing: [], toConfirm: [], reason: rule.reason };
    }
  }

  const checks = category.required_details.map((d) => ({ name: d.label, ok: hasDetail(d, request.text, request.requester, amount) }));
  const missing = category.required_details.filter((_, i) => !checks[i]!.ok).map((d) => ({ key: d.key, label: d.label }));
  return {
    outcome: missing.length ? 'needs_info' : 'complete',
    provisionalCategory: category.id,
    checks,
    missing,
    toConfirm: category.required_checks,
    ...(missing.length ? { reason: `Missing: ${missing.map((m) => m.label.toLowerCase()).join(', ')}.` } : {}),
  };
}

const RISK_RANK: Record<CaseRisk, number> = { low: 0, medium: 1, high: 2 };

export function offlineClassify(lc: ResolvedLifecycle, request: RequestPart, now: Date, amountInr?: number | null): ClassifyPart {
  const { category, matched } = categoryOrFallback(lc, request.text);
  const reasons = [
    matched.length
      ? `Matched ${matched.map((m) => `“${m}”`).join(', ')}, so it is a ${category.name.toLowerCase()}.`
      : `No category matched, so it is a ${category.name.toLowerCase()}.`,
  ];

  let priority: PriorityId = category.priority;
  let risk: CaseRisk = category.risk;
  const urgent = lc.urgent_keywords.filter((k) => phraseIn(request.text, k));
  if (urgent.length) {
    if (priority !== 'P1') reasons.push(`Raised to P1 because it mentions ${urgent.map((u) => `“${u}”`).join(', ')}.`);
    priority = 'P1';
    if (RISK_RANK[risk] < RISK_RANK.high) risk = 'high';
  }

  const p = lc.priorities.find((x) => x.id === priority)!;
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  return {
    category: category.id,
    categoryName: category.name,
    priority,
    risk,
    department: category.department,
    amountInr: amountInr ?? extractAmountInr(request.text),
    respondBy: at(p.respond_within_hours),
    resolveBy: at(p.resolve_within_hours),
    reasons,
  };
}

export interface TeamMember {
  id: string;
  name: string;
  title: string;
  responsibilities: string[];
}

export function offlineAssign(lc: ResolvedLifecycle, classify: ClassifyPart, team: TeamMember[]): AssignPart {
  const category = lc.categories.find((c) => c.id === classify.category);
  const topic = [classify.categoryName, classify.department, ...(category?.keywords ?? [])].join(' ');
  const deadline = classify.resolveBy;

  if (team.length === 1) {
    const only = team[0]!;
    return { assignee: { staffId: only.id, name: only.name, title: only.title }, team: classify.department, deadline, reason: `${only.name} is the only person on the team.` };
  }
  let best: { member: TeamMember; score: number } | null = null;
  for (const member of team) {
    const words = [member.title, ...member.responsibilities].join(' ');
    const score = normalizeText(words).split(' ').filter((w) => w.length > 2 && phraseIn(topic, w)).length;
    if (score > 0 && (!best || score > best.score)) best = { member, score };
  }
  if (!best) {
    return {
      assignee: null,
      team: classify.department,
      deadline,
      reason: `Nobody on the team covers ${classify.department.toLowerCase()} yet, so it is with the ${classify.department} team.`,
    };
  }
  const m = best.member;
  return { assignee: { staffId: m.id, name: m.name, title: m.title }, team: classify.department, deadline, reason: `${m.name} (${m.title}) is in charge of ${classify.department.toLowerCase()}.` };
}

export function offlineVerify(input: { goalStatus: string; escalatedTasks: number; summary: string }): Pick<ClosePart, 'verified' | 'findings' | 'outcome'> {
  const verified = input.goalStatus === 'completed' && input.escalatedTasks === 0;
  return { verified, findings: [input.summary], outcome: verified ? 'resolved' : 'not_resolved' };
}

export interface ReportInput {
  caseLabel: string;
  number: string;
  title: string;
  categoryName?: string;
  outcome: string;
  stages: { key: StageKey; name: string; status: string; startedAt?: string | null; completedAt?: string | null }[];
  createdAt: string;
  resolveBy?: string | null;
  closedAt: string;
  sameCategoryLast30Days: number;
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

export function offlineReport(input: ReportInput): ReportPart {
  const minutesPerStage = input.stages
    .filter((s) => s.startedAt && s.completedAt)
    .map((s) => ({ stage: s.key, minutes: Math.round((Date.parse(s.completedAt!) - Date.parse(s.startedAt!)) / 60_000) }));
  const total = Math.round((Date.parse(input.closedAt) - Date.parse(input.createdAt)) / 60_000);
  const slaMet = input.resolveBy ? Date.parse(input.closedAt) <= Date.parse(input.resolveBy) : null;
  const target = input.resolveBy ? Math.round((Date.parse(input.resolveBy) - Date.parse(input.createdAt)) / 60_000) : null;

  const recurring =
    input.categoryName && input.sameCategoryLast30Days >= 3
      ? { count: input.sameCategoryLast30Days, note: `${input.sameCategoryLast30Days} ${input.categoryName.toLowerCase()}s in the last 30 days. Worth looking for a root cause.` }
      : null;

  const sla = slaMet === null ? '' : slaMet ? `, inside its ${duration(target!)} target` : `, past its ${duration(target!)} target`;
  const text = `${input.number} ${input.title} was ${input.outcome} in ${duration(total)}${sla}.${recurring ? ` ${recurring.note}` : ''}`;
  return { text, slaMet, minutesPerStage, recurring };
}
```

Append to `packages/agent-kit/src/lifecycle/index.ts`:

```ts
export * from './offline';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/offline-stages.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the full checks**

Run: `pnpm turbo run build typecheck test`
Expected: all successful.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-kit/src/lifecycle packages/agent-kit/src/offline-stages.test.ts
git commit -m "feat(agent-kit): offline stage strategies for request, review, classify, assign, verify and report"
```

---

### Task 7: The evals package and `pnpm evals`

**Files:**
- Create: `evals/package.json`, `evals/tsconfig.json`
- Create: `evals/src/runner.ts`, `evals/src/runner.test.ts`, `evals/src/suites.test.ts`
- Create: `evals/suites/core-business.yaml`
- Modify: `evals/README.md`, `pnpm-workspace.yaml`, `package.json` (root `evals` script)

**Interfaces:**
- Consumes:
  - `parsePack`, `resolvePack`, `resolveTool`, `offlineRequest`, `offlineReview`, `offlineClassify`, `extractAmountInr`, `CASE_COORDINATOR_ROLE` (agent-kit).
  - `PolicyEngine` (policy).
- Produces:
  - `loadPackRegistry(dir: string): Map<string, Pack>`
  - `EvalSuiteSchema`
  - `runSuite(pack: ResolvedPack, suite: EvalSuite, now?: Date): Scorecard`, with `Scorecard = { pack: string; total: number; stages: Record<'category' | 'priority' | 'review' | 'approval' | 'signoff', { correct: number; total: number }>; failures: { caseId: string; stage: string; expected: string; got: string }[] }`
  - `THRESHOLDS`
  - `pnpm evals`
- Plan 2 adds one suite per organization type to `evals/suites/`, and they're picked up automatically.

- [ ] **Step 1: Register the package**

In `pnpm-workspace.yaml`, add `- evals` to `packages:`:

```yaml
packages:
  - master-ai-backend
  - master-ai-web
  - master-ai-mobile
  - packages/*
  - evals
```

Create `evals/package.json`:

```json
{
  "name": "@onehuman/evals",
  "version": "0.1.0",
  "private": true,
  "description": "Scored test sets for industry packs: offline stage strategies plus the real policy engine",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@onehuman/agent-kit": "workspace:*",
    "@onehuman/policy": "workspace:*",
    "@onehuman/schemas": "workspace:*",
    "yaml": "^2.8.1",
    "zod": "^4.3.3"
  },
  "devDependencies": {
    "@types/node": "^24.19.2",
    "typescript": "~5.9.3",
    "vitest": "^5.0.3"
  }
}
```

These ranges are the ones `packages/agent-kit` and `packages/policy` already use, so no new versions enter the lockfile.

Create `evals/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src"]
}
```

It mirrors `packages/policy/tsconfig.json`, without `outDir` and `rootDir` because nothing is emitted.

Add to the root `package.json` `scripts`:

```json
    "evals": "pnpm --filter @onehuman/evals test",
```

Run: `pnpm install`
Expected: the lockfile updates with the new workspace package only, with no new external versions.

- [ ] **Step 2: Write the failing runner test**

Create `evals/src/runner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePack, resolvePack } from '@onehuman/agent-kit';
import { EvalSuiteSchema, loadPackRegistry, runSuite } from './runner';

const registry = loadPackRegistry(new URL('../../packs', import.meta.url).pathname);
const plant = parsePack({
  id: 'plant-eval', version: '1.0.0', name: 'Plant', description: 'Eval fixture', extends: ['core-business'],
  lifecycle: {
    roles: [{ id: 'safety-officer', name: 'Safety officer', approves: 'Permits' }, { id: 'maintenance-head', name: 'Maintenance head', approves: 'Repairs' }],
    categories: [
      { id: 'breakdown', name: 'Breakdown repair', keywords: ['breakdown', 'vibration', 'tripped'], priority: 'P1', risk: 'high', department: 'Maintenance',
        required_details: [{ key: 'asset', label: 'Which equipment', kind: 'keywords', keywords: ['pump', 'boiler'] }],
        approval: { required: 'high_risk_or_p1', role: 'safety-officer' }, signoff: { required: true, role: 'maintenance-head' } },
      { id: 'spares', name: 'Spares purchase', keywords: ['spares', 'purchase'], priority: 'P4', risk: 'low', department: 'Stores',
        approval: { required: 'above_amount', role: 'owner', amount_inr: 50000 } },
    ],
  },
});
registry.set(plant.id, plant);
const pack = resolvePack(plant, (id) => registry.get(id));

const suite = EvalSuiteSchema.parse({
  pack: 'plant-eval',
  cases: [
    { id: 'pump', request: 'Boiler feed pump B vibration above limit', source: 'system',
      expect: { category: 'breakdown', priority: 'P1', review: 'complete', approval: { required: true, role: 'safety-officer' }, signoff: { required: true, role: 'maintenance-head' } } },
    { id: 'vague', request: 'Something tripped near bay 4', source: 'staff',
      expect: { category: 'breakdown', priority: 'P1', review: 'needs_info' } },
    { id: 'cheap-spares', request: 'Purchase spares worth ₹20,000', source: 'staff',
      expect: { category: 'spares', priority: 'P4', review: 'complete', approval: { required: false }, signoff: { required: false } } },
    { id: 'big-spares', request: 'Purchase spares', amount_inr: 120000, source: 'owner',
      expect: { category: 'spares', priority: 'P4', review: 'complete', approval: { required: true, role: 'owner' }, signoff: { required: false } } },
  ],
});

describe('eval runner', () => {
  it('scores every stage and records no failures on a correct pack', () => {
    const card = runSuite(pack, suite, new Date('2026-10-13T06:00:00Z'));
    expect(card.total).toBe(4);
    expect(card.failures).toEqual([]);
    expect(card.stages.category).toEqual({ correct: 4, total: 4 });
    expect(card.stages.approval).toEqual({ correct: 3, total: 3 });
  });

  it('reports what went wrong', () => {
    const wrong = EvalSuiteSchema.parse({ ...suite, cases: [{ ...suite.cases[0]!, expect: { ...suite.cases[0]!.expect, priority: 'P3' } }] });
    const card = runSuite(pack, wrong);
    expect(card.failures).toEqual([{ caseId: 'pump', stage: 'priority', expected: 'P3', got: 'P1' }]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @onehuman/evals exec vitest run src/runner.test.ts`
Expected: FAIL. The module `./runner` can't be found.

- [ ] **Step 4: Create `evals/src/runner.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { CaseSourceSchema, PriorityIdSchema, type Pack, type ResolvedPack } from '@onehuman/schemas';
import {
  CASE_COORDINATOR_ROLE,
  extractAmountInr,
  lifecycleOf,
  offlineClassify,
  offlineRequest,
  offlineReview,
  parsePack,
  resolveTool,
} from '@onehuman/agent-kit';
import { PolicyEngine } from '@onehuman/policy';

/** Minimum share of correct answers per stage; gates are rules, so they must be exact. */
export const THRESHOLDS = { category: 0.9, priority: 0.9, review: 0.8, approval: 1, signoff: 1 } as const;
type StageName = keyof typeof THRESHOLDS;

const GateExpectSchema = z.object({ required: z.boolean(), role: z.string().optional() });

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  request: z.string().min(1),
  source: CaseSourceSchema,
  amount_inr: z.number().positive().optional(),
  expect: z.object({
    category: z.string().min(1),
    priority: PriorityIdSchema,
    review: z.enum(['complete', 'needs_info', 'not_eligible']),
    approval: GateExpectSchema.optional(),
    signoff: GateExpectSchema.optional(),
  }),
  why: z.string().optional(),
});
export const EvalSuiteSchema = z.object({ pack: z.string().min(1), cases: z.array(EvalCaseSchema).min(1) });
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;

export interface Scorecard {
  pack: string;
  total: number;
  stages: Record<StageName, { correct: number; total: number }>;
  failures: { caseId: string; stage: string; expected: string; got: string }[];
}

export function loadPackRegistry(dir: string): Map<string, Pack> {
  const registry = new Map<string, Pack>();
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry, 'pack.yaml');
    if (!existsSync(file)) continue;
    const pack = parsePack(parse(readFileSync(file, 'utf8')));
    registry.set(pack.id, pack);
  }
  return registry;
}

export function loadSuites(dir: string): EvalSuite[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => EvalSuiteSchema.parse(parse(readFileSync(join(dir, f), 'utf8'))));
}

/** Score one suite: offline stages for category, priority and review; the real policy engine for gates. */
export function runSuite(pack: ResolvedPack, suite: EvalSuite, now = new Date('2026-01-01T09:00:00Z')): Scorecard {
  const lc = lifecycleOf(pack);
  const engine = new PolicyEngine({ version: 1, packRules: pack.policies });
  const coordinator = pack.agents.find((a) => a.role === CASE_COORDINATOR_ROLE);
  if (!coordinator) throw new Error(`Pack ${pack.id} has no ${CASE_COORDINATOR_ROLE} agent`);

  const card: Scorecard = {
    pack: pack.id,
    total: suite.cases.length,
    stages: { category: { correct: 0, total: 0 }, priority: { correct: 0, total: 0 }, review: { correct: 0, total: 0 }, approval: { correct: 0, total: 0 }, signoff: { correct: 0, total: 0 } },
    failures: [],
  };
  const score = (caseId: string, stage: StageName, expected: string, got: string) => {
    card.stages[stage].total++;
    if (expected === got) card.stages[stage].correct++;
    else card.failures.push({ caseId, stage, expected, got });
  };

  const gate = (tool: 'case.proceed' | 'case.close', c: z.infer<typeof EvalCaseSchema>, amount: number | null) => {
    const category = lc.categories.find((x) => x.id === c.expect.category);
    const risk = c.expect.priority === 'P1' ? 'high' : (category?.risk ?? 'medium');
    const decision = engine.decide({
      tool: resolveTool(pack, tool)!,
      args: { caseId: c.id, category: c.expect.category, priority: c.expect.priority, risk, summary: c.request, ...(amount !== null && { amount }) },
      agent: {
        id: 'eval-coordinator',
        role: coordinator.role,
        status: 'active',
        autonomy: coordinator.autonomy as 1 | 2 | 3 | 4,
        tools: coordinator.tools,
        dataClass: coordinator.model.data_class,
        moneyBudgetInr: coordinator.budgets.money_per_task_inr,
      },
      workspace: { id: 'eval', status: 'active' },
      tenant: { id: 'eval', status: 'active' },
      trackRecord: { approved: 0, rejected: 0, edited: 0 },
      caseContext: { category: c.expect.category, priority: c.expect.priority, risk, source: c.source },
    });
    return decision.level === 4 ? `required by ${decision.approver}` : decision.level === 5 ? 'blocked' : 'not required';
  };

  for (const c of suite.cases) {
    const request = offlineRequest({ text: c.request, requester: { name: 'Eval' }, source: c.source, receivedAt: now.toISOString() });
    const amount = c.amount_inr ?? extractAmountInr(c.request);
    const review = offlineReview(lc, request, amount);
    const classify = offlineClassify(lc, request, now, amount);
    score(c.id, 'review', c.expect.review, review.outcome);
    score(c.id, 'category', c.expect.category, classify.category);
    score(c.id, 'priority', c.expect.priority, classify.priority);

    // Gates are scored given the expected category and priority, so a
    // classification miss does not hide (or excuse) a rule mistake.
    if (c.expect.review === 'complete') {
      const fmt = (g?: { required: boolean; role?: string }) => (!g ? undefined : g.required ? `required by ${g.role ?? 'owner'}` : 'not required');
      const approval = fmt(c.expect.approval);
      if (approval) score(c.id, 'approval', approval, gate('case.proceed', c, amount));
      const signoff = fmt(c.expect.signoff);
      if (signoff) score(c.id, 'signoff', signoff, gate('case.close', c, amount));
    }
  }
  return card;
}

export function formatScorecard(card: Scorecard): string {
  const pct = (s: { correct: number; total: number }) => (s.total ? `${Math.round((100 * s.correct) / s.total)}% (${s.correct}/${s.total})` : 'n/a');
  const lines = [`${card.pack}: ${card.total} cases`, ...Object.entries(card.stages).map(([k, v]) => `  ${k.padEnd(9)} ${pct(v)}`)];
  for (const f of card.failures) lines.push(`  ✗ ${f.caseId} ${f.stage}: expected ${f.expected}, got ${f.got}`);
  return lines.join('\n');
}
```

- [ ] **Step 5: Run the runner test to verify it passes**

Run: `pnpm --filter @onehuman/evals exec vitest run src/runner.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Add the suites test and the first suite**

Create `evals/suites/core-business.yaml`:

```yaml
# Generic lifecycle (every organization starts here). Organization suites come with their packs.
pack: core-business
cases:
  - id: statement
    request: Please send me last month's statement, I need it for the bank.
    source: customer
    expect: { category: general, priority: P3, review: complete, approval: { required: false }, signoff: { required: false } }
  - id: fire
    request: There is a small fire in the store room near the generator.
    source: staff
    expect: { category: general, priority: P1, review: complete, approval: { required: false }, signoff: { required: false } }
    why: "fire" is an urgent keyword, so the request becomes P1.
  - id: feedback
    request: Canteen food has been cold all week.
    source: staff
    expect: { category: general, priority: P3, review: complete }
  - id: injury
    request: A worker was injured while unloading the truck, needs help now.
    source: staff
    expect: { category: general, priority: P1, review: complete }
  - id: big-amount
    request: Please help us pay the supplier ₹3 lakh this week.
    source: owner
    expect: { category: general, priority: P3, review: complete, approval: { required: false } }
    why: The generic lifecycle has no amount rule, and ₹3 lakh alone stays under the owner-approval risk band.
```

Create `evals/src/suites.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolvePack } from '@onehuman/agent-kit';
import { formatScorecard, loadPackRegistry, loadSuites, runSuite, THRESHOLDS } from './runner';

const registry = loadPackRegistry(new URL('../../packs', import.meta.url).pathname);
const suites = loadSuites(new URL('../suites', import.meta.url).pathname);

describe('pack eval suites', () => {
  it('has at least one suite', () => expect(suites.length).toBeGreaterThan(0));

  it.each(suites.map((s) => [s.pack, s] as const))('%s meets the thresholds', (packId, suite) => {
    const pack = registry.get(packId);
    expect(pack, `suite refers to unknown pack ${packId}`).toBeDefined();
    const card = runSuite(resolvePack(pack!, (id) => registry.get(id)), suite);
    console.log(formatScorecard(card));
    for (const [stage, min] of Object.entries(THRESHOLDS)) {
      const s = card.stages[stage as keyof typeof THRESHOLDS];
      if (s.total === 0) continue;
      expect(s.correct / s.total, `${packId} ${stage}\n${formatScorecard(card)}`).toBeGreaterThanOrEqual(min);
    }
  });
});
```

- [ ] **Step 7: Run all evals**

Run: `pnpm evals`
Expected: PASS. The console shows `core-business: 5 cases` with 100% on every stage that has cases. If `big-amount` comes out "required by owner", the risk band moved: recompute with `scoreRisk` and fix the expectation's `why`, rather than the engine.

- [ ] **Step 8: Update `evals/README.md`**

Replace the file with:

```markdown
# Evals

Scored test sets for industry packs. Each suite in `suites/<pack-id>.yaml` lists realistic requests with the expected category, priority, review outcome, approval (and approver role) and sign-off.

- `pnpm evals` scores every suite offline: the offline stage strategies from `@onehuman/agent-kit` plus the real Cedar policy engine for gates. It runs in CI and fails below these thresholds: category 90%, priority 90%, review 80%, gates 100%.
- Gates are scored given the expected category and priority, so they test the rules, not the classifier.
- Live model scoring (`pnpm evals:live`) arrives with the backend stage service (Plan 3).
- Never copy an eval request into a pack's `lifecycle.examples`. Examples teach the model; evals test it.

When an answer is wrong, fix the pack (keywords, required details, rules) or its examples, and the score shows the gain.
```

- [ ] **Step 9: Run the full checks**

Run: `pnpm turbo run build typecheck test`
Expected: all successful, including `@onehuman/evals#test`.

- [ ] **Step 10: Commit**

```bash
git add evals pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "feat(evals): scored pack test sets with offline stages and real policy gates"
```

---

## Roadmap: the plans after this one

Each plan gets its own document, written when the previous one is merged, so it's based on the real code.

| Plan | Scope | Ends with |
|---|---|---|
| **2 · Sector content** | Expert check of the 15 research drafts (`.superpowers/research/`), plus municipal research. Then: 5 `packs/sector-*/pack.yaml` base packs; 15 org-type packs with lifecycle, entities, agents, aliases, workflows, KPIs, routines and playbooks; `travel-agency` upgraded; one eval suite per type; `composeOfflinePack(industry, sector)` with `other_org_types`; a pack authoring guide | `pnpm evals` green on 16 suites at the thresholds |
| **3 · Case engine** | Migrations: cases, case_stages, workspace_counters, goals.case_id, generalized approval_requests, principals.approver_roles, invites, intake_keys, staff.principal_id, tenants.sector/org_type, plus RLS. Then: `CasesService`, `CaseStagesService` (model + offline), `caseWorkflow`/`stageWorkflow`, gate approvals and signals, signup and onboarding with sector, intake (form + API), kill switch, `CaseReport`, realtime events, `pnpm evals:live`; smoke test extended per sector | `pnpm smoke` green with every new check |
| **4 · Roles and invites** | Invite links, accepting them, approver roles on the Team page API, "who may decide" rules, the *Mine* inbox, `pushToRole` | Smoke: a role holder approves, a non-holder gets 403 |
| **5 · Web: Glow** | `@onehuman/ui` tokens and fonts; shell; signup wizard; install preview; Home; Cases list; Case page canvas (React Flow); approvals inbox; Team with roles and invites; Settings → Requests; restyle every page; Playwright e2e | Playwright suite green at desktop and phone widths |
| **6 · Mobile: Glow** | Tokens and fonts; tabs (Cases, Approvals, Calls, Pulse, Settings); case detail; approval screen; `expo-linear-gradient` | Checked on the Android emulator |
| **7 · Final pass** | ADR 0009 and 0010, README, `CLAUDE.md` rules, the full end-to-end run across every sector, plus the live-model run when a key is set | Everything green; the user reviews |

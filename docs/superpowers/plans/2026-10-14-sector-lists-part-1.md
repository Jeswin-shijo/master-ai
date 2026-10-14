# Sector Lists, Part 1 (Lists and Checking): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner and admins get a **Lists** page with each organization type's own lists (bills, tickets, site issues…). Each list has filters, date ranges and totals. Every item shows how it came in, problems found by fixed checks, edits with history, and a "checked" mark. A CSV can be downloaded.

**Architecture:**
- **Pack format.** Packs gain `registers:` (lists) with columns, filters, totals, a card, and checks from a fixed set of six kinds. `@onehuman/agent-kit` resolves them (`registersOf`) and validates them (`validateRegisters`). Every record type without a register gets a default list.
- **Database.** The backend stores how each record came in and whether a person checked it, as new `records` columns.
- **Checks in SQL.** A new `lists` module compiles each list's checks to SQL. They're evaluated when the list is read: a `flagged` CTE adds one boolean column per check.
- **Writes.** Every change goes through `RecordsService`, which now audits updates.
- **Web.** Lists replaces the Records page.

**Tech Stack:**
- Zod 4 in `@onehuman/schemas`;
- Drizzle ORM (`sql` templates) on Postgres with row-level security;
- NestJS 11;
- React 19 + TanStack Query + React Router (web);
- Vitest 4 (unit and integration) and Playwright (browser).

**Spec:** [docs/superpowers/specs/2026-10-14-sector-lists-design.md](../specs/2026-10-14-sector-lists-design.md). Part 1 covers sections 1–3, the part-1 rows of sections 6–9, Appendix A (lists and checks only; collections and follow-ups are part 2) and Appendix B.

## Global Constraints

**Database and audit**
- Every tenant-scoped query runs inside `DbService.tenant(tenantId, tx => …)`. Row-level security is on, and the app role (`onehuman_app`) cannot bypass it.
- Every state change appends an audit event in the same transaction (`AuditService.append(tx, …)`).

**What people see**
- Owners never see ids, tool names or JSON. References show the referenced item's title, and a value that is an id of a removed item reads "a … that was removed".
- Only people mark items checked. Add no catalog tool, alias or agent path that sets `checked_*`.
- Checks are evaluated by the app (SQL compiled from the pack), never by a model.

**Web conventions**
- Colours come from `@onehuman/ui` token classes (`bg-surface`, `text-fg-muted`, `text-danger`, …), never raw Tailwind colours.
- The browser takes run-time values only from `@onehuman/schemas/plain`, and types from `@onehuman/schemas` with `import type`.
- Web pages are lazy routes in `master-ai-web/src/main.tsx`. `__tests__/unit/bundle.test.ts` checks that every file in `src/routes/` is imported lazily.
- The session token never goes in a URL. The CSV is fetched with the `Authorization` header and saved from a Blob.

**Tests and packages**
- Tests live in one `__tests__/` folder per app or package, never next to code. Apps use `__tests__/unit/` (mirroring `src/`), `__tests__/integration/` (backend) and `__tests__/e2e/`. Packages mirror `src/` directly.
- Shared packages are consumed from `dist/`. After changing `packages/*`, run `pnpm build:packages` before running backend or web tests.
- Pack YAML is validated by `packages/agent-kit/__tests__/pack.test.ts`. Quote YAML strings that contain `: ` or start with a special character.

**Repository rules**
- No new dependencies.
- Commits use the repository's git identity (already configured) and end with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Work on the branch `sector-lists` (already created). Never push or merge without the user's say-so.

## Review Focus

These inputs and conditions aren't exercised by the spec's own examples, but they're the most likely to hurt a real user. Each has a test in the task named in brackets.

1. **A stored value that isn't a valid number or date** (old data, data a model wrote, `"abc"` in a money field, `"2026-13-45"` in a date) must never break a list. The value counts as blank for checks, totals and sorting. [Task 8: `lists.spec.ts` "malformed values"]
2. **A workspace saved before lists existed** (no `registers` key in its pack snapshot) still opens Lists, with a default list per record type. [Task 8: "old snapshot"]
3. **Search text containing `%`, `_` or quotes** matches literally, not as a SQL pattern. [Task 8: "search is literal"]
4. **Bulk "mark checked" given ids from another list or another company** ignores them silently. It never checks them and never errors. [Task 9: "bulk check ignores ids it doesn't own"]
5. **"Today" near midnight India time.** The date ranges and the overdue and expiring checks use the India date (UTC+5:30), not the server's UTC date. [Task 7: `rangeDays` tests and `istDate`-driven clock; Task 8: overdue test built from `istDate()`]

---

## File structure

**`packages/schemas/src/`**
- `pack.ts` (modify): `ConditionSchema`, `CheckSchema`, `RegisterSchema`, `PackSchema.registers`, and `PackUpdates` gains `entities`, `fields` and `registers`.
- `lists.ts` (create): the Lists API types (`ListSummary`, `ListPage`, `ListItem`, `ListItemDetail`, …) and the input schemas (`UpdateListItemInputSchema`, …).
- `events.ts` (modify): adds `record.updated`, `record.checked`, `record.removed`, `record.samples_removed` and their summaries.
- `index.ts` (modify): exports `lists.ts`.

**`packages/agent-kit/src/`**
- `registers.ts` (create): `registersOf`, `validateRegisters`, `checkKeys`, `defaultRegisterId` and `titleOf`, plus the `ResolvedRegister` and `ListCheck` types.
- `pack.ts` (modify): merges registers down `extends`; `validatePackRefs` calls `validateRegisters`; `packUpdates`, `applyPackUpdates`, `countPackUpdates`, `emptyPackUpdates` and `normalizeSnapshot` handle the new additions.
- `match.ts` (modify): `composeOfflinePack` gets `registers: []`.
- `index.ts` (modify): exports `registers.ts`.

**`packs/*/pack.yaml`** (modify, 15 types): `registers:` blocks, four new entities, and new optional fields.

**`master-ai-backend/`**
- `src/db/schema.ts` (modify): the new `records` columns.
- Migrations:
  - `drizzle/0012_record_lists.sql`, generated;
  - `drizzle/0013_record_lists_backfill.sql`, custom: the `try_*` functions and the backfill.
- `src/records/records.service.ts` (modify):
  - `create` takes a source;
  - `update` is audited and takes a change description;
  - `seedSamples` fills references, in order;
  - `createFromApi` takes the role.
- `src/records/records.controller.ts` (modify): passes the role.
- `src/connectors/connectors.service.ts` (modify): agent source and change.
- `src/common/auth.ts` (modify): exports `MANAGERS_ONLY`.
- `src/lists/` (create):

  | File | What it holds |
  |---|---|
  | `query.ts` | `parseListQuery` and `rangeDays` |
  | `format.ts` | `problemMessage`, `shown` and `csvValue` |
  | `csv.ts` | `toCsv` |
  | `sql.ts` | the check compiler and the query pieces |
  | `lists.service.ts` | the service |
  | `lists.controller.ts` | the controller |

- `src/app.module.ts` (modify): registers `ListsController` and `ListsService`.
- `src/packs/registry.service.ts` (modify): `latestFor` resets `registers`.
- `src/packs/generator.service.ts` (modify): `main_lists` → registers (`mainListRegisters`).
- `src/tenancy/onboarding.service.ts` (modify): `describeUpdates` and the `pack.updated` payload mention the new additions.
- `scripts/sectors.mts` (modify): every list opens; main lists match the pack.
- Tests:
  - `__tests__/unit/lists/{query,format,csv}.test.ts`
  - `__tests__/unit/records/samples.test.ts`
  - `__tests__/unit/packs/main-lists.test.ts`
  - `__tests__/integration/{record-sources,lists,lists-writes,sector-lists}.spec.ts`

**`packages/sdk/src/client.ts`** (modify): `lists.*` methods, `listQuery()` and `requestText()`. Test: `packages/sdk/__tests__/lists.test.ts`.

**`master-ai-web/`**
- `src/lib/nav.ts` (modify): adds Lists under Cases and removes Records.
- `src/lib/lists.ts` (create): range and show labels, `listParams`, `csvFileName`, `withBom` and `saveText`.
- `src/lib/record-values.ts` (create): `formValue` and `dataValue` (form ↔ stored values, datetimes in local time).
- `src/lib/realtime.ts` (modify): refreshes lists on `record.*` events.
- `src/components/record-form.tsx` (create): the schema-driven form (create and edit), taken out of `routes/records.tsx`.
- `src/components/list-item-panel.tsx` (create): the item drawer.
- `src/components/pack-updates.tsx` (modify): shows new record types, fields and lists.
- `src/routes/lists.tsx` (create): the overview.
- `src/routes/list.tsx` (create): one list.
- `src/routes/records.tsx` (delete).
- `src/main.tsx` (modify): the routes, and `/records` redirects to `/lists`.
- Tests:
  - `__tests__/unit/lib/{lists,record-values,nav}.test.ts`
  - `__tests__/e2e/lists.spec.ts` (create)
  - `__tests__/e2e/features.spec.ts` (drop the Records test)

**Docs**
- `docs/adr/0012-lists-and-checks.md`
- `docs/adr/README.md`
- `README.md`
- `CLAUDE.md`
- `docs/testing.md`
- `docs/known-gaps.md`

---

### Task 1: The pack format for lists and checks

**Files:**
- Modify: `packages/schemas/src/pack.ts` (add the schemas just before `export const PackSchema`, and add `registers` to `PackSchema`)
- Modify: `packages/schemas/src/events.ts` (`AUDIT_EVENT_TYPES` and `summarizeEvent`)
- Test: `packages/schemas/__tests__/pack.test.ts` (create)

**Interfaces:**
- Produces:
  - `ConditionSchema`, `ConditionsSchema`, `CheckSchema` and `RegisterSchema`;
  - the types `Condition`, `Conditions`, `Check` and `Register`;
  - `Pack.registers: Register[]` (default `[]`);
  - the audit types `record.updated`, `record.checked`, `record.removed` and `record.samples_removed`.

  The audit payloads carry `{ entity, label, title, … }`.

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/__tests__/pack.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeEvent } from '../src/events';
import { CheckSchema, PackSchema, RegisterSchema } from '../src/pack';

describe('lists in a pack (registers)', () => {
  it('fills in the defaults', () => {
    expect(RegisterSchema.parse({ id: 'bills', entity: 'Bill' })).toEqual({ id: 'bills', entity: 'Bill', main: true, checks: [] });
  });

  it('reads every kind of check, with its defaults', () => {
    const checks = [
      { missing: ['party'] },
      { adds_up: { field: 'total', plus: ['taxableValue', 'gstAmount'] } },
      { limit: { fields: ['outstanding'], max: 'creditLimit' } },
      { limit: { fields: ['amount'], max: 2000 }, when: { mode: ['cash'] }, why: 'no 80G above ₹2,000 in cash' },
      { duplicate: ['billNo', 'party'] },
      { overdue: { date: 'dueDate' }, when: { paymentStatus: ['unpaid'] } },
      { expiring: { date: 'insuranceValidUntil', days: 30 } },
    ].map((c) => CheckSchema.parse(c));
    expect(checks[1]).toEqual({ adds_up: { field: 'total', plus: ['taxableValue', 'gstAmount'], minus: [], tolerance: 1 } });
    expect(checks[2]).toEqual({ limit: { fields: ['outstanding'], max: 'creditLimit', factor: 1 } });
    expect(checks[3]).toMatchObject({ when: { mode: ['cash'] }, why: 'no 80G above ₹2,000 in cash' });
    expect(checks[5]).toEqual({ overdue: { date: 'dueDate', grace_days: 0 }, when: { paymentStatus: ['unpaid'] } });
  });

  it('takes conditions as values, above / below, filled or blank', () => {
    const when = { a: ['x', 1, true], b: { above: 0 }, c: { below: 5 }, d: 'filled', e: 'blank' };
    expect(CheckSchema.parse({ missing: ['f'], when }).when).toEqual(when);
  });

  it('refuses a limit with both max and min, or neither', () => {
    expect(CheckSchema.safeParse({ limit: { fields: ['a'], max: 1, min: 0 } }).success).toBe(false);
    expect(CheckSchema.safeParse({ limit: { fields: ['a'] } }).success).toBe(false);
  });

  it('refuses unknown keys, so a typo in a pack fails its test instead of being ignored', () => {
    expect(RegisterSchema.safeParse({ id: 'bills', entity: 'Bill', colums: ['x'] }).success).toBe(false);
    expect(CheckSchema.safeParse({ overdue: { date: 'dueDate', grace: 2 } }).success).toBe(false);
    expect(CheckSchema.safeParse({ missing: ['a'], wen: { a: ['x'] } }).success).toBe(false);
  });

  it('gives a pack no lists unless it names some', () => {
    expect(PackSchema.parse({ id: 'p', version: '1.0.0', name: 'P', description: 'P' }).registers).toEqual([]);
  });
});

describe('audit summaries for list changes', () => {
  it('says what happened in words', () => {
    expect(summarizeEvent('record.updated', { label: 'Bill', title: 'S-1042' })).toBe('Bill S-1042 changed');
    expect(summarizeEvent('record.checked', { label: 'Bill', title: 'S-1042' })).toBe('Bill S-1042 checked');
    expect(summarizeEvent('record.removed', { label: 'Bill', title: 'S-1042', reason: 'entered twice' })).toBe('Bill S-1042 removed: entered twice');
    expect(summarizeEvent('record.samples_removed', { count: 12 })).toBe('Removed 12 sample items');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @onehuman/schemas test -- pack`
Expected: FAIL. The imports `CheckSchema` and `RegisterSchema` don't exist yet, and the TypeScript compile in vitest reports them as `undefined`.

- [ ] **Step 3: Add the schemas**

In `packages/schemas/src/pack.ts`, insert this block just above `export const PackSchema = z.object({`:

```ts
/** A field condition: one of these values, a number above or below, or filled / blank. */
export const ConditionSchema = z.union([
  z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
  z.strictObject({ above: z.number() }),
  z.strictObject({ below: z.number() }),
  z.enum(['filled', 'blank']),
]);
export type Condition = z.infer<typeof ConditionSchema>;
export const ConditionsSchema = z.record(z.string(), ConditionSchema);
export type Conditions = z.infer<typeof ConditionsSchema>;

const checkExtras = {
  /** Only check items that meet these conditions. */
  when: ConditionsSchema.optional(),
  /** The rule behind the check, added to its message: "e-way bill needed above ₹50,000". */
  why: z.string().min(1).optional(),
};

/**
 * One of the fixed kinds of check a list runs on every item. The app works
 * them out (in SQL, when a list is read), never a model.
 */
export const CheckSchema = z.union([
  z.strictObject({ missing: z.array(z.string()).min(1), ...checkExtras }),
  z.strictObject({
    adds_up: z.strictObject({
      field: z.string(),
      plus: z.array(z.string()).default([]),
      minus: z.array(z.string()).default([]),
      tolerance: z.number().nonnegative().default(1),
    }),
    ...checkExtras,
  }),
  z.strictObject({
    limit: z
      .strictObject({
        fields: z.array(z.string()).min(1),
        max: z.union([z.string(), z.number()]).optional(),
        min: z.union([z.string(), z.number()]).optional(),
        factor: z.number().positive().default(1),
      })
      .refine((l) => (l.max === undefined) !== (l.min === undefined), 'a limit needs exactly one of max or min'),
    ...checkExtras,
  }),
  z.strictObject({ duplicate: z.array(z.string()).min(1), ...checkExtras }),
  z.strictObject({ overdue: z.strictObject({ date: z.string(), grace_days: z.number().int().nonnegative().default(0) }), ...checkExtras }),
  z.strictObject({ expiring: z.strictObject({ date: z.string(), days: z.number().int().positive() }), ...checkExtras }),
]);
export type Check = z.infer<typeof CheckSchema>;

/** A list the head of the organization sees: one record type, with its columns, filters, totals and checks. */
export const RegisterSchema = z.strictObject({
  id: SlugSchema,
  entity: z.string(),
  label: z.string().min(1).optional(),
  /** A card on the Lists page; false lists it under "Other lists". */
  main: z.boolean().default(true),
  columns: z.array(z.string()).min(1).optional(),
  filters: z.array(z.string()).optional(),
  /** The date the list's date range filters on. */
  date_field: z.string().optional(),
  sort: z.strictObject({ field: z.string(), dir: z.enum(['asc', 'desc']).default('desc') }).optional(),
  totals: z.array(z.string()).optional(),
  card: z
    .strictObject({
      count: z.strictObject({ when: ConditionsSchema.optional(), label: z.string().min(1) }).optional(),
      sum: z.strictObject({ field: z.string(), when: ConditionsSchema.optional(), label: z.string().min(1) }).optional(),
    })
    .optional(),
  checks: z.array(CheckSchema).default([]),
});
export type Register = z.infer<typeof RegisterSchema>;
```

In `PackSchema`, directly after the `routines: …` line, add:

```ts
  /** The lists the head sees, over the pack's entities. Every entity without one gets a default list. */
  registers: z.array(RegisterSchema).default([]),
```

- [ ] **Step 4: Add the audit event types**

In `packages/schemas/src/events.ts`, change `'record.created',` in `AUDIT_EVENT_TYPES` to:

```ts
  'record.created',
  'record.updated',
  'record.checked',
  'record.removed',
  'record.samples_removed',
```

In `summarizeEvent`, add these cases before `default:`:

```ts
    case 'record.updated':
      return `${p.label ?? 'Item'} ${p.title ?? ''} changed`.replace(/\s+/g, ' ');
    case 'record.checked':
      return `${p.label ?? 'Item'} ${p.title ?? ''} checked`.replace(/\s+/g, ' ');
    case 'record.removed':
      return `${p.label ?? 'Item'} ${p.title ?? ''} removed${p.reason ? `: ${p.reason}` : ''}`.replace(/\s+/g, ' ');
    case 'record.samples_removed':
      return `Removed ${p.count ?? 0} sample items`;
```

- [ ] **Step 5: Run the tests, typecheck and build**

Run: `pnpm --filter @onehuman/schemas test && pnpm --filter @onehuman/schemas typecheck && pnpm --filter @onehuman/schemas build`
Expected: all schemas tests PASS (the new `pack.test.ts` included), no type errors, and the build writes `dist/`.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/pack.ts packages/schemas/src/events.ts packages/schemas/__tests__/pack.test.ts
git commit -m "feat(schemas): lists (registers) and the six kinds of check in the pack format

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Resolving and validating lists in the agent kit

**Files:**
- Create: `packages/agent-kit/src/registers.ts`
- Modify: `packages/agent-kit/src/pack.ts`:
  - `resolvePack` merges `registers` by id;
  - `validatePackRefs` calls `validateRegisters`;
  - `normalizeSnapshot` fills `registers`.
- Modify: `packages/agent-kit/src/match.ts` (`composeOfflinePack` returns `registers: []`)
- Modify: `packages/agent-kit/src/index.ts` (`export * from './registers';`)
- Modify: `packages/policy/__tests__/gates.test.ts` and `packages/policy/__tests__/engine.test.ts`. Their pack fixtures gain `registers: []`, because `ResolvedPack` now requires it.
- Test: `packages/agent-kit/__tests__/registers.test.ts` (create)

**Interfaces:**
- Consumes (from Task 1): `Register`, `Check`, `Conditions` and `RegisterSchema`.
- Produces:

  ```ts
  export type ListCheck =
    | (CheckBase & { kind: 'missing'; field: EntityField })
    | (CheckBase & { kind: 'adds_up'; field: EntityField; plus: EntityField[]; minus: EntityField[]; tolerance: number })
    | (CheckBase & { kind: 'limit'; fields: EntityField[]; max?: EntityField | number; min?: EntityField | number; factor: number })
    | (CheckBase & { kind: 'duplicate'; fields: EntityField[] })
    | (CheckBase & { kind: 'overdue'; field: EntityField; graceDays: number })
    | (CheckBase & { kind: 'expiring'; field: EntityField; days: number })
    | (CheckBase & { kind: 'ref'; field: EntityField; target: EntityDef });
  // CheckBase = { key: string; when?: Conditions; why?: string }
  export interface ResolvedRegister { id; label; main; explicit; entity: EntityDef; columns: EntityField[]; filters: EntityField[];
    dateField: EntityField | null; sort: { field: EntityField | null; dir: 'asc' | 'desc' }; totals: EntityField[]; card: Register['card']; checks: ListCheck[] }
  export function registersOf(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[] }): ResolvedRegister[];
  export function validateRegisters(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[] }): string[];
  export function checkKeys(check: Check): string[];
  export function defaultRegisterId(entityName: string): string;
  export function titleOf(entity: EntityDef, data: Record<string, unknown>): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/agent-kit/__tests__/registers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityDef, Register } from '@onehuman/schemas';
import { checkKeys, defaultRegisterId, normalizeSnapshot, parsePack, registersOf, resolvePack, titleOf, validatePackRefs, validateRegisters } from '../src/index';

const Party: EntityDef = {
  name: 'Party', label: 'Party', title_field: 'name',
  fields: [
    { name: 'name', label: 'Name', type: 'string', required: true },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
    { name: 'creditLimit', label: 'Credit limit', type: 'money', required: false },
    { name: 'outstanding', label: 'Outstanding', type: 'money', required: false },
  ],
};
const Bill: EntityDef = {
  name: 'Bill', label: 'Bill', title_field: 'billNo', list_columns: ['billNo', 'party', 'total'],
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'billType', label: 'Type', type: 'enum', required: true, options: ['sales invoice', 'purchase bill'] },
    { name: 'party', label: 'Party', type: 'reference', required: false, ref: 'Party' },
    { name: 'billDate', label: 'Bill date', type: 'date', required: false },
    { name: 'taxableValue', label: 'Taxable value', type: 'money', required: false },
    { name: 'gstAmount', label: 'GST amount', type: 'money', required: false },
    { name: 'total', label: 'Total', type: 'money', required: false },
    { name: 'dueDate', label: 'Due date', type: 'date', required: false },
    { name: 'paid', label: 'Paid', type: 'boolean', required: false },
  ],
};
const CashlessRequest: EntityDef = {
  name: 'CashlessRequest', label: 'Cashless request',
  fields: [
    { name: 'sentAt', label: 'Sent at', type: 'datetime', required: false },
    { name: 'amountAsked', label: 'Amount asked', type: 'money', required: false },
  ],
};
const bills: Register = {
  id: 'bills', entity: 'Bill', label: 'Bills', main: true, date_field: 'billDate', totals: ['total'],
  checks: [
    { missing: ['party', 'billDate'] },
    { adds_up: { field: 'total', plus: ['taxableValue', 'gstAmount'], minus: [], tolerance: 1 } },
    { overdue: { date: 'dueDate', grace_days: 0 }, when: { paid: [false] } },
  ],
};
const pack = { entities: [Party, Bill, CashlessRequest], registers: [bills] };

describe('registersOf', () => {
  const lists = registersOf(pack);
  const byId = (id: string) => lists.find((l) => l.id === id)!;

  it("puts the pack's lists first, then a default list for every record type no list covers", () => {
    expect(lists.map((l) => [l.id, l.main, l.explicit])).toEqual([
      ['bills', true, true],
      ['party', false, false],
      ['cashless-request', false, false],
    ]);
  });

  it('gives a default list sensible columns, date, sort, totals and label', () => {
    const party = byId('party');
    expect(party.label).toBe('Parties');
    expect(party.columns.map((f) => f.name)).toEqual(['name', 'phone', 'creditLimit', 'outstanding']);
    expect(party.dateField).toBeNull();
    expect(party.totals.map((f) => f.name)).toEqual(['creditLimit', 'outstanding']);
    const cashless = byId('cashless-request');
    expect(cashless.dateField?.name).toBe('sentAt');
    expect(cashless.sort).toEqual({ field: cashless.dateField, dir: 'desc' });
  });

  it("uses the entity's list columns, and its choice, yes/no and reference fields as filters, when a list names none", () => {
    const b = byId('bills');
    expect(b.columns.map((f) => f.name)).toEqual(['billNo', 'party', 'total']);
    expect(b.filters.map((f) => f.name)).toEqual(['billType', 'party', 'paid']);
  });

  it('turns checks into one problem per missing field, plus a check that references point at real items', () => {
    expect(byId('bills').checks.map((c) => c.key)).toEqual(['missing:party', 'missing:billDate', 'adds_up:total', 'overdue:dueDate', 'ref:party']);
    expect(byId('party').checks).toEqual([]);
  });

  it('skips what a stored snapshot no longer has instead of failing', () => {
    const old = registersOf({
      entities: [Party],
      registers: [bills, { ...bills, id: 'party-list', entity: 'Party', columns: ['name', 'gone'], checks: [{ missing: ['gone'] }] }],
    });
    expect(old.map((l) => l.id)).toEqual(['party-list']);
    expect(old[0]!.columns.map((f) => f.name)).toEqual(['name']);
    expect(old[0]!.checks).toEqual([]);
  });
});

describe('checkKeys, defaultRegisterId, titleOf', () => {
  it('keys checks by kind and fields', () => {
    expect(checkKeys({ limit: { fields: ['a', 'b'], max: 'c', factor: 1 } })).toEqual(['limit:a+b<=c']);
    expect(checkKeys({ limit: { fields: ['stock'], min: 10, factor: 1 } })).toEqual(['limit:stock>=10']);
    expect(checkKeys({ duplicate: ['billNo', 'party'] })).toEqual(['duplicate:billNo,party']);
    expect(checkKeys({ missing: ['a', 'b'] })).toEqual(['missing:a', 'missing:b']);
  });

  it('names default lists in kebab case', () => {
    expect(defaultRegisterId('CashlessRequest')).toBe('cashless-request');
    expect(defaultRegisterId('Bill')).toBe('bill');
  });

  it('titles an item by its title field, else its first text field, else the record type', () => {
    expect(titleOf(Bill, { billNo: 'S-1' })).toBe('S-1');
    expect(titleOf(CashlessRequest, {})).toBe('Cashless request');
  });
});

describe('validateRegisters', () => {
  const issues = (change: object) =>
    validateRegisters({ entities: [Party, Bill], registers: [{ ...bills, checks: [], ...change } as Register] });

  it('accepts a valid list', () => {
    expect(validateRegisters(pack)).toEqual([]);
  });

  it.each([
    [{ entity: 'Nope' }, 'register bills: unknown entity Nope'],
    [{ columns: ['nope'] }, 'register bills: column nope is not a field of Bill'],
    [{ filters: ['billNo'] }, 'register bills: filter billNo must be enum or boolean or reference, not string'],
    [{ date_field: 'total' }, 'register bills: date_field total must be date or datetime, not money'],
    [{ totals: ['billNo'] }, 'register bills: total billNo must be money or number or integer, not string'],
    [{ id: 'party' }, 'register party: the id is taken by the default list of another record type'],
    [{ card: { sum: { field: 'total', when: { billType: ['refund'] }, label: 'x' } } }, 'register bills card sum: refund is not an option of billType'],
    [{ checks: [{ missing: ['party'] }, { missing: ['party'] }] }, 'register bills: two checks share the key missing:party'],
    [{ checks: [{ adds_up: { field: 'total', plus: ['billNo'], minus: [], tolerance: 1 } }] }, 'register bills: adds_up billNo must be money or number or integer, not string'],
    [{ checks: [{ overdue: { date: 'total', grace_days: 0 } }] }, 'register bills: overdue total must be date or datetime, not money'],
    [{ checks: [{ missing: ['total'], when: { billNo: { above: 3 } } }] }, 'register bills check missing:total: above and below need a number field, billNo is string'],
    [{ checks: [{ missing: ['total'], when: { paid: ['yes'] } }] }, 'register bills check missing:total: paid takes true or false'],
    [
      { checks: [{ limit: { fields: ['billDate', 'dueDate'], max: 'dueDate', factor: 1 } }] },
      'register bills check limit:billDate+dueDate<=dueDate: a date limit compares one date field with another date field',
    ],
  ])('reports %j', (change, message) => {
    expect(issues(change)).toContain(message);
  });
});

describe('packs and lists', () => {
  it('merges lists down the extends chain by id, the child winning', () => {
    const base = parsePack({ id: 'base', version: '1.0.0', name: 'Base', description: 'Base', kind: 'base', entities: [Bill, Party], registers: [{ id: 'bills', entity: 'Bill', label: 'Bills' }] });
    const child = parsePack({
      id: 'child', version: '1.0.0', name: 'Child', description: 'Child', extends: ['base'],
      registers: [{ id: 'bills', entity: 'Bill', label: 'Invoices' }, { id: 'parties', entity: 'Party' }],
    });
    const resolved = resolvePack(child, (id) => (id === 'base' ? base : undefined));
    expect(resolved.registers.map((r) => [r.id, r.label])).toEqual([['bills', 'Invoices'], ['parties', undefined]]);
  });

  it('reports list problems with the rest of the pack', () => {
    const p = parsePack({ id: 'p', version: '1.0.0', name: 'P', description: 'P', entities: [Bill, Party], registers: [{ id: 'bills', entity: 'Bill', columns: ['nope'] }] });
    expect(validatePackRefs(resolvePack(p, () => undefined))).toContain('register bills: column nope is not a field of Bill');
  });

  it('reads an old snapshot with no lists as having none', () => {
    const { registers: _gone, ...old } = resolvePack(parsePack({ id: 'p', version: '1.0.0', name: 'P', description: 'P', entities: [Party] }), () => undefined);
    expect(normalizeSnapshot(old as never).registers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @onehuman/agent-kit test -- registers`
Expected: FAIL. `registersOf` (and the other new exports) is not exported from `../src/index`.

- [ ] **Step 3: Write `registers.ts`**

Create `packages/agent-kit/src/registers.ts`:

```ts
import type { Check, Conditions, EntityDef, EntityField, FieldType, Register, ResolvedPack } from '@onehuman/schemas';
import { pluralize } from './pack';

const NUMBERS: FieldType[] = ['money', 'number', 'integer'];
const DATES: FieldType[] = ['date', 'datetime'];
const FILTERABLE: FieldType[] = ['enum', 'boolean', 'reference'];

interface CheckBase {
  /** Tells this problem apart from the others, stable when the pack reorders its checks. */
  key: string;
  when?: Conditions;
  why?: string;
}

/** One problem a list looks for: a pack check (one per field for `missing`), or the built-in check that a reference points at a real item. */
export type ListCheck =
  | (CheckBase & { kind: 'missing'; field: EntityField })
  | (CheckBase & { kind: 'adds_up'; field: EntityField; plus: EntityField[]; minus: EntityField[]; tolerance: number })
  | (CheckBase & { kind: 'limit'; fields: EntityField[]; max?: EntityField | number; min?: EntityField | number; factor: number })
  | (CheckBase & { kind: 'duplicate'; fields: EntityField[] })
  | (CheckBase & { kind: 'overdue'; field: EntityField; graceDays: number })
  | (CheckBase & { kind: 'expiring'; field: EntityField; days: number })
  | (CheckBase & { kind: 'ref'; field: EntityField; target: EntityDef });

export interface ResolvedRegister {
  id: string;
  label: string;
  /** A card on the Lists page; the rest are under "Other lists". */
  main: boolean;
  /** Defined by the pack; false for a record type's default list. */
  explicit: boolean;
  entity: EntityDef;
  columns: EntityField[];
  filters: EntityField[];
  dateField: EntityField | null;
  /** A null field sorts by last change. */
  sort: { field: EntityField | null; dir: 'asc' | 'desc' };
  totals: EntityField[];
  card: Register['card'];
  checks: ListCheck[];
}

/** The id of a record type's default list: CashlessRequest → cashless-request. */
export function defaultRegisterId(entityName: string): string {
  return entityName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** An item's title: its title field, else its first text field, else the record type's name. */
export function titleOf(entity: EntityDef, data: Record<string, unknown>): string {
  const name = entity.title_field ?? entity.fields.find((f) => f.type === 'string')?.name;
  const value = name ? data[name] : undefined;
  return value === undefined || value === null || value === '' ? entity.label : String(value);
}

/** Keys that tell a check's problems apart: kind and fields. */
export function checkKeys(check: Check): string[] {
  if ('missing' in check) return check.missing.map((f) => `missing:${f}`);
  if ('adds_up' in check) return [`adds_up:${check.adds_up.field}`];
  if ('limit' in check) {
    const l = check.limit;
    return [`limit:${l.fields.join('+')}${l.max !== undefined ? `<=${l.max}` : `>=${l.min}`}`];
  }
  if ('duplicate' in check) return [`duplicate:${check.duplicate.join(',')}`];
  if ('overdue' in check) return [`overdue:${check.overdue.date}`];
  return [`expiring:${check.expiring.date}`];
}

/**
 * Every list a workspace has: the pack's registers, then a default list for
 * each record type no register covers. Lenient on purpose: a field a stored
 * snapshot no longer has is left out rather than failing (validateRegisters
 * reports it when a pack is checked).
 */
export function registersOf(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[] }): ResolvedRegister[] {
  const out: ResolvedRegister[] = [];
  const covered = new Set<string>();
  for (const r of pack.registers ?? []) {
    const entity = pack.entities.find((e) => e.name === r.entity);
    if (!entity) continue;
    covered.add(entity.name);
    out.push(resolveRegister(r, entity, pack.entities, true));
  }
  for (const e of pack.entities) {
    if (covered.has(e.name)) continue;
    out.push(resolveRegister({ id: defaultRegisterId(e.name), entity: e.name, main: false, checks: [] }, e, pack.entities, false));
  }
  return out;
}

function resolveRegister(r: Register, entity: EntityDef, entities: EntityDef[], explicit: boolean): ResolvedRegister {
  const byName = (name: string) => entity.fields.find((f) => f.name === name);
  const pick = (names: string[]) => names.map(byName).filter((f): f is EntityField => !!f);
  const dateField =
    r.date_field !== undefined ? (byName(r.date_field) ?? null) : explicit ? null : (entity.fields.find((f) => DATES.includes(f.type)) ?? null);
  return {
    id: r.id,
    label: r.label ?? entity.plural_label ?? pluralize(entity.label),
    main: r.main,
    explicit,
    entity,
    columns: pick(r.columns ?? entity.list_columns ?? entity.fields.slice(0, 5).map((f) => f.name)),
    filters: r.filters ? pick(r.filters) : entity.fields.filter((f) => FILTERABLE.includes(f.type)).slice(0, 4),
    dateField,
    sort: { field: r.sort ? (byName(r.sort.field) ?? null) : dateField, dir: r.sort?.dir ?? 'desc' },
    totals: r.totals ? pick(r.totals) : explicit ? [] : entity.fields.filter((f) => f.type === 'money'),
    card: r.card,
    checks: expandChecks(r.checks, entity, entities),
  };
}

function expandChecks(checks: Check[], entity: EntityDef, entities: EntityDef[]): ListCheck[] {
  const byName = (name: string) => entity.fields.find((f) => f.name === name);
  const all = (names: string[]) => {
    const found = names.map(byName);
    return found.every(Boolean) ? (found as EntityField[]) : null;
  };
  const out: ListCheck[] = [];
  for (const c of checks) {
    const extras = { ...(c.when && { when: c.when }), ...(c.why && { why: c.why }) };
    const key = checkKeys(c)[0]!;
    if ('missing' in c) {
      for (const name of c.missing) {
        const field = byName(name);
        if (field) out.push({ kind: 'missing', key: `missing:${name}`, field, ...extras });
      }
    } else if ('adds_up' in c) {
      const field = byName(c.adds_up.field);
      const plus = all(c.adds_up.plus);
      const minus = all(c.adds_up.minus);
      if (field && plus && minus) out.push({ kind: 'adds_up', key, field, plus, minus, tolerance: c.adds_up.tolerance, ...extras });
    } else if ('limit' in c) {
      const fields = all(c.limit.fields);
      const bound = (b: string | number | undefined) => (typeof b === 'string' ? byName(b) : b);
      const max = bound(c.limit.max);
      const min = bound(c.limit.min);
      if (fields && (max !== undefined || min !== undefined)) {
        out.push({ kind: 'limit', key, fields, ...(max !== undefined && { max }), ...(min !== undefined && { min }), factor: c.limit.factor, ...extras });
      }
    } else if ('duplicate' in c) {
      const fields = all(c.duplicate);
      if (fields) out.push({ kind: 'duplicate', key, fields, ...extras });
    } else if ('overdue' in c) {
      const field = byName(c.overdue.date);
      if (field) out.push({ kind: 'overdue', key, field, graceDays: c.overdue.grace_days, ...extras });
    } else {
      const field = byName(c.expiring.date);
      if (field) out.push({ kind: 'expiring', key, field, days: c.expiring.days, ...extras });
    }
  }
  for (const field of entity.fields) {
    const target = field.type === 'reference' && field.ref ? entities.find((e) => e.name === field.ref) : undefined;
    if (target) out.push({ kind: 'ref', key: `ref:${field.name}`, field, target });
  }
  return out;
}

/** What is wrong with a pack's lists, in words, for the pack tests and the generator's repair round. */
export function validateRegisters(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[] }): string[] {
  const issues: string[] = [];
  const registers = pack.registers ?? [];
  const covered = new Set(registers.map((r) => r.entity));
  const defaultIds = new Set(pack.entities.filter((e) => !covered.has(e.name)).map((e) => defaultRegisterId(e.name)));
  const ids = new Set<string>();
  for (const r of registers) {
    const at = `register ${r.id}`;
    if (ids.has(r.id)) issues.push(`${at}: duplicate id`);
    ids.add(r.id);
    if (defaultIds.has(r.id)) issues.push(`${at}: the id is taken by the default list of another record type`);
    const entity = pack.entities.find((e) => e.name === r.entity);
    if (!entity) {
      issues.push(`${at}: unknown entity ${r.entity}`);
      continue;
    }
    const need = (name: string | undefined, role: string, types?: FieldType[]) => {
      if (name === undefined) return;
      const f = entity.fields.find((x) => x.name === name);
      if (!f) issues.push(`${at}: ${role} ${name} is not a field of ${entity.name}`);
      else if (types && !types.includes(f.type)) issues.push(`${at}: ${role} ${name} must be ${types.join(' or ')}, not ${f.type}`);
    };
    r.columns?.forEach((n) => need(n, 'column'));
    r.filters?.forEach((n) => need(n, 'filter', FILTERABLE));
    need(r.date_field, 'date_field', DATES);
    need(r.sort?.field, 'sort');
    r.totals?.forEach((n) => need(n, 'total', NUMBERS));
    need(r.card?.sum?.field, 'card sum', NUMBERS);
    conditionIssues(entity, r.card?.count?.when, `${at} card count`, issues);
    conditionIssues(entity, r.card?.sum?.when, `${at} card sum`, issues);
    const keys = new Set<string>();
    for (const c of r.checks) {
      const where = `${at} check ${checkKeys(c)[0]}`;
      for (const key of checkKeys(c)) {
        if (keys.has(key)) issues.push(`${at}: two checks share the key ${key}`);
        keys.add(key);
      }
      conditionIssues(entity, c.when, where, issues);
      if ('missing' in c) c.missing.forEach((n) => need(n, 'missing'));
      else if ('adds_up' in c) [c.adds_up.field, ...c.adds_up.plus, ...c.adds_up.minus].forEach((n) => need(n, 'adds_up', NUMBERS));
      else if ('limit' in c) limitIssues(entity, c.limit, where, issues);
      else if ('duplicate' in c) c.duplicate.forEach((n) => need(n, 'duplicate'));
      else if ('overdue' in c) need(c.overdue.date, 'overdue', DATES);
      else need(c.expiring.date, 'expiring', DATES);
    }
  }
  return issues;
}

type LimitDef = Extract<Check, { limit: unknown }>['limit'];

function limitIssues(entity: EntityDef, l: LimitDef, where: string, issues: string[]) {
  const field = (n: string) => entity.fields.find((f) => f.name === n);
  const bound = l.max ?? l.min;
  const fields = l.fields.map((n) => ({ n, f: field(n) }));
  for (const { n, f } of fields) if (!f) issues.push(`${where}: ${n} is not a field of ${entity.name}`);
  if (typeof bound === 'string' && !field(bound)) {
    issues.push(`${where}: ${bound} is not a field of ${entity.name}`);
    return;
  }
  if (fields.some((x) => x.f?.type === 'date')) {
    if (fields.length !== 1 || typeof bound !== 'string' || field(bound)!.type !== 'date') {
      issues.push(`${where}: a date limit compares one date field with another date field`);
    }
    return;
  }
  for (const { n, f } of fields) if (f && !NUMBERS.includes(f.type)) issues.push(`${where}: ${n} must be a number, money or integer field`);
  if (typeof bound === 'string' && !NUMBERS.includes(field(bound)!.type)) issues.push(`${where}: ${bound} must be a number, money or integer field`);
}

function conditionIssues(entity: EntityDef, when: Conditions | undefined, where: string, issues: string[]) {
  for (const [name, cond] of Object.entries(when ?? {})) {
    const f = entity.fields.find((x) => x.name === name);
    if (!f) {
      issues.push(`${where}: condition on ${name}, which is not a field of ${entity.name}`);
      continue;
    }
    if (Array.isArray(cond)) {
      if (f.type === 'enum') for (const v of cond) if (!f.options?.includes(String(v))) issues.push(`${where}: ${String(v)} is not an option of ${name}`);
      if (f.type === 'boolean' && cond.some((v) => typeof v !== 'boolean')) issues.push(`${where}: ${name} takes true or false`);
    } else if (typeof cond === 'object' && !NUMBERS.includes(f.type)) {
      issues.push(`${where}: above and below need a number field, ${name} is ${f.type}`);
    }
  }
}
```

- [ ] **Step 4: Wire it into packs**

In `packages/agent-kit/src/index.ts`, add `export * from './registers';`.

In `packages/agent-kit/src/pack.ts`:
- **Imports:** add `type Register` to the `@onehuman/schemas` import, and add `import { validateRegisters } from './registers';`.
- **`resolvePack`'s `merged` initialiser:** add `registers: []` to the object, after `routines: []`.
- **The map:** after `const routines = new Map…`, add `const registers = new Map<string, Register>();`.
- **The `for (const p of chain)` loop:** add `(p.registers ?? []).forEach((r) => registers.set(r.id, r));`.
- **After `merged.routines = …`:** add `merged.registers = [...registers.values()];`.
- **The end of `validatePackRefs`, just before `return issues;`:** add `issues.push(...validateRegisters(pack));`.
- **`normalizeSnapshot`'s returned object:** add `registers: pack.registers ?? [],`.

In `packages/agent-kit/src/match.ts`, `composeOfflinePack`'s returned object, add `registers: [],` after `routines: [],`.

In `packages/policy/__tests__/gates.test.ts`, add `registers: [],` to the `pack` fixture, after `routines: [],`. In `packages/policy/__tests__/engine.test.ts`, add `registers: [],` after `routines: [],` in its pack fixture.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @onehuman/agent-kit test && pnpm --filter @onehuman/agent-kit typecheck && pnpm --filter @onehuman/policy test && pnpm --filter @onehuman/policy typecheck`
Expected: all PASS. Every existing pack still validates, because no pack declares `registers` yet. If `typecheck` reports `Property 'registers' is missing` in any other test fixture, add `registers: []` to that fixture the same way.

- [ ] **Step 6: Build and commit**

```bash
pnpm --filter @onehuman/agent-kit build
git add packages/agent-kit packages/policy/__tests__
git commit -m "feat(agent-kit): resolve and validate lists, with default lists for every record type

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The update banner can add record types, optional fields and lists

**Files:**
- Modify: `packages/schemas/src/pack.ts` (`PackUpdates` gains `entities`, `fields` and `registers`)
- Modify: `packages/agent-kit/src/pack.ts` (`packUpdates`, `applyPackUpdates`, `emptyPackUpdates` and `countPackUpdates`)
- Modify: `master-ai-backend/src/packs/registry.service.ts` (`latestFor`)
- Modify: `master-ai-backend/src/tenancy/onboarding.service.ts` (`describeUpdates` and the `pack.updated` payload)
- Modify: `packages/agent-kit/__tests__/pack.test.ts` (one existing assertion changes meaning)
- Test: `packages/agent-kit/__tests__/list-updates.test.ts` (create)

**Interfaces:**
- Consumes: `validateRegisters` (Task 2).
- Produces: the shape below, and `applyPackUpdates`, which appends new fields to matching entities, then new entities, then new registers.

  ```ts
  interface PackUpdates {
    /* existing keys */
    entities: EntityDef[];
    fields: { entity: string; fields: EntityField[] }[];
    registers: Register[];
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/agent-kit/__tests__/list-updates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityDef } from '@onehuman/schemas';
import { applyPackUpdates, countPackUpdates, packUpdates, parsePack, resolvePack, validatePackRefs } from '../src/index';

const Ticket: EntityDef = {
  name: 'Ticket', label: 'Ticket',
  fields: [
    { name: 'summary', label: 'Summary', type: 'string', required: true },
    { name: 'dueBy', label: 'Due by', type: 'datetime', required: false },
  ],
};
const Asset = (extra: EntityDef['fields']): EntityDef => ({
  name: 'Asset', label: 'Asset', fields: [{ name: 'assetTag', label: 'Asset tag', type: 'string', required: true }, ...extra],
});
const make = (entities: EntityDef[], registers: unknown[]) =>
  resolvePack(parsePack({ id: 'it', version: '1.0.0', name: 'IT', description: 'IT', entities, registers }), () => undefined);

const latest = make(
  [
    Asset([
      { name: 'warrantyEndsOn', label: 'Warranty ends on', type: 'date', required: false },
      { name: 'owner', label: 'Owner', type: 'string', required: true },
    ]),
    Ticket,
  ],
  [
    { id: 'tickets', entity: 'Ticket', checks: [{ overdue: { date: 'dueBy' } }] },
    { id: 'assets', entity: 'Asset', checks: [{ expiring: { date: 'warrantyEndsOn', days: 30 } }] },
    { id: 'owned-assets', entity: 'Asset', columns: ['owner'] },
  ],
);
const installed = make([Asset([])], []);

describe('pack updates for lists', () => {
  const u = packUpdates(installed, latest);

  it('offers new record types, new optional fields and new lists', () => {
    expect(u.entities.map((e) => e.name)).toEqual(['Ticket']);
    expect(u.fields).toEqual([{ entity: 'Asset', fields: [expect.objectContaining({ name: 'warrantyEndsOn' })] }]);
    expect(u.registers.map((r) => r.id)).toEqual(['tickets', 'assets']);
  });

  it('never adds a required field, and leaves out a list that needs one', () => {
    expect(u.fields[0]!.fields.map((f) => f.name)).not.toContain('owner');
    expect(u.registers.map((r) => r.id)).not.toContain('owned-assets');
  });

  it('applies cleanly and only once', () => {
    const next = applyPackUpdates(installed, u);
    expect(validatePackRefs(next)).toEqual([]);
    expect(next.entities.find((e) => e.name === 'Asset')!.fields.map((f) => f.name)).toEqual(['assetTag', 'warrantyEndsOn']);
    expect(countPackUpdates(u)).toBe(4);
    expect(countPackUpdates(packUpdates(next, latest))).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @onehuman/agent-kit test -- list-updates`
Expected: FAIL. `u.entities` is `undefined` (TypeError: Cannot read properties of undefined).

- [ ] **Step 3: Extend `PackUpdates`**

In `packages/schemas/src/pack.ts`, add these to `interface PackUpdates`, after `playbooks`:

```ts
  /** Record types the workspace doesn't have yet. */
  entities: EntityDef[];
  /** New optional fields on record types it has. A required field is never added: items saved before would stop validating. */
  fields: { entity: string; fields: EntityField[] }[];
  /** Lists it doesn't have yet, each valid against the updated record types. */
  registers: Register[];
```

- [ ] **Step 4: Compute and apply them**

In `packages/agent-kit/src/pack.ts`:
- **Doc comment above `packUpdates`:** replace the sentence "Entities are left out because they shape stored records, and anything" with "New record types and new optional fields are added, never changed ones, and anything".
- **Start of `packUpdates`:** replace the line `const entities = new Set(installed.entities.map((e) => e.name));` with:

```ts
  // New record types, and new optional fields on the ones the workspace has.
  const newEntities = missing(latest.entities, installed.entities, (e) => e.name);
  const fields = installed.entities.flatMap((mine) => {
    const have = new Set(mine.fields.map((f) => f.name));
    const extra = (latest.entities.find((e) => e.name === mine.name)?.fields ?? []).filter((f) => !have.has(f.name) && !f.required);
    return extra.length ? [{ entity: mine.name, fields: extra }] : [];
  });
  const nextEntities = withAdditions(installed.entities, newEntities, fields);
  const entities = new Set(nextEntities.map((e) => e.name));
  const registers = missing(latest.registers ?? [], installed.registers ?? [], (r) => r.id).filter(
    (r) => validateRegisters({ entities: nextEntities, registers: [r] }).length === 0,
  );
```

In the object `packUpdates` returns, add `entities: newEntities, fields, registers,` after `playbooks: …,`.

Add this helper below `packUpdates`:

```ts
/** Record types with new fields appended, then the new record types. */
function withAdditions(entities: EntityDef[], added: EntityDef[], fields: PackUpdates['fields']): EntityDef[] {
  return [
    ...entities.map((e) => {
      const extra = fields.find((x) => x.entity === e.name)?.fields;
      return extra ? { ...e, fields: [...e.fields, ...extra] } : e;
    }),
    ...added,
  ];
}
```

Change `emptyPackUpdates` to return `{ agents: [], tools: [], workflows: [], routines: [], policies: [], kpis: [], playbooks: [], entities: [], fields: [], registers: [], lifecycle: { whole: null, categories: [], roles: [] } }`.

In `countPackUpdates`, add `+ (u.entities ?? []).length + (u.fields ?? []).reduce((n, x) => n + x.fields.length, 0) + (u.registers ?? []).length` to the sum. The `?? []` covers a cached answer from before these keys existed.

In `applyPackUpdates`'s returned object, add:

```ts
    entities: withAdditions(installed.entities, u.entities ?? [], u.fields ?? []),
    registers: [...(installed.registers ?? []), ...(u.registers ?? [])],
```

- [ ] **Step 5: Update the existing test whose meaning changed**

In `packages/agent-kit/__tests__/pack.test.ts`, test `'drops additions that would point at something the workspace lacks'`:
- **Replace** the line `expect(updates.tools.every((t) => typeof t.with?.entity !== 'string')).toBe(true);`
- **With:**

```ts
    // The record types come back with the update, so tools pinned to them can come too.
    expect(updates.entities.map((e) => e.name).sort()).toEqual(latest.entities.map((e) => e.name).sort());
```

- [ ] **Step 6: The backend side**

In `master-ai-backend/src/packs/registry.service.ts`, `latestFor`, change the `empty` object to `{ entities: [], agents: [], tools: [], workflows: [], policies: [], kpis: [], connectors: [], registers: [] }`.

In `master-ai-backend/src/tenancy/onboarding.service.ts`:
- In `describeUpdates`, add to `parts`, after the workflows line:

```ts
    ...u.registers.map((r) => `${r.label ?? r.entity} (list)`),
    u.entities.length ? `${u.entities.length} new kind${u.entities.length === 1 ? '' : 's'} of record` : '',
    u.fields.length ? `${u.fields.reduce((n, x) => n + x.fields.length, 0)} new field(s)` : '',
```

- In `applyUpdates`, add to the `pack.updated` payload:

```ts
          entities: updates.entities.map((e) => e.name),
          registers: updates.registers.map((r) => r.id),
          fields: updates.fields.reduce((n, x) => n + x.fields.length, 0),
```

- [ ] **Step 7: Run everything this touches**

Run: `pnpm --filter @onehuman/schemas build && pnpm --filter @onehuman/agent-kit test && pnpm --filter @onehuman/agent-kit typecheck && pnpm --filter @onehuman/agent-kit build && pnpm --filter @onehuman/backend typecheck`
Expected: all PASS. The new `list-updates` tests PASS and the existing pack-update tests still pass.

- [ ] **Step 8: Commit**

```bash
git add packages/schemas/src/pack.ts packages/agent-kit master-ai-backend/src/packs/registry.service.ts master-ai-backend/src/tenancy/onboarding.service.ts
git commit -m "feat(packs): the update banner adds new record types, optional fields and lists

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Each organization type's lists, the new record types and fields

**Files:**
- Modify: `packs/{wholesale-retail,logistics,travel-agency,it-services,software-saas,digital-agency,construction,power-plant,manufacturing-plant,hospital,education,municipal,lender,accounting-firm,ngo}/pack.yaml`
- Test: `packages/agent-kit/__tests__/pack.test.ts` (append a describe block)

**Interfaces:**
- Consumes: the register format (Task 1) and `registersOf` / `validatePackRefs` (Task 2).
- Produces:
  - **Register ids** used by later tasks and tests: `bills`, `orders`, `parties`, `products` (wholesale), and the main-list ids in the test below.
  - **New entities:** `Ticket` (it-services and software-saas), `SiteIssue` and `ContractorBill` (construction).
  - **New optional fields:** travel `Booking.supplier` and `supplierPhone`, hospital `CashlessRequest.tpaPhone`, lender `Repayment.borrowerName` and `borrowerPhone`, manufacturing `QualityIssue.foundOn` and `owner`, and NGO `Grant.programmeLead`.

**Where things go in each `pack.yaml`:**
- **New entities:** insert them as items of the `entities:` list, just above the top-level `tools:` line. In every pack, `tools:` directly follows `entities:`.
- **New fields:** add them where each step says.
- **The `registers:` block:** append it at the end of the file as a new top-level key.

YAML indentation matches the existing files: list items under `entities:` start with two spaces (`  - name:`), and fields with six (`      - {`).

- [ ] **Step 1: Write the failing test**

Append to `packages/agent-kit/__tests__/pack.test.ts`. Also add `registersOf` to the `../src/index` import, and add `import { ORG_TYPES } from '@onehuman/schemas';`.

```ts
describe('lists of each organization type', () => {
  const MAIN_LISTS: Record<string, string[]> = {
    'wholesale-retail': ['bills', 'orders', 'parties', 'products'],
    logistics: ['shipments', 'claims', 'trucks', 'drivers'],
    'travel-agency': ['bookings', 'trips', 'suppliers'],
    'it-services': ['tickets', 'incidents', 'assets', 'contracts'],
    'software-saas': ['tickets', 'incidents', 'releases', 'payments'],
    'digital-agency': ['deliverables', 'invoices', 'scopes'],
    construction: ['site-issues', 'contractor-bills', 'units', 'workers', 'contractors'],
    'power-plant': ['work-permits', 'outages', 'equipment', 'incidents'],
    'manufacturing-plant': ['production-orders', 'quality-issues', 'machines', 'safety-incidents'],
    hospital: ['visits', 'cashless-requests', 'appointments', 'incidents'],
    education: ['fee-accounts', 'enrolments', 'students', 'assets'],
    municipal: ['service-applications', 'properties', 'trade-licences'],
    lender: ['repayments', 'loans', 'collateral'],
    'accounting-firm': ['filings', 'tax-notices', 'signed-reports'],
    ngo: ['vouchers', 'donations', 'grants', 'beneficiaries'],
  };

  it('covers every ready-made organization type', () => {
    expect(Object.keys(MAIN_LISTS).sort()).toEqual(ORG_TYPES.map((t) => t.id).sort());
  });

  it.each(Object.entries(MAIN_LISTS))('%s has its main lists', (id, lists) => {
    const resolved = resolvePack(registry.get(id)!, lookup);
    expect(registersOf(resolved).filter((r) => r.main).map((r) => r.id)).toEqual(lists);
  });

  it('adds the record types and fields the lists need, all optional on types companies already have', () => {
    const entity = (pack: string, name: string) => resolvePack(registry.get(pack)!, lookup).entities.find((e) => e.name === name);
    const names = (pack: string, name: string) => entity(pack, name)?.fields.map((f) => f.name) ?? [];
    expect(names('it-services', 'Ticket')).toEqual(expect.arrayContaining(['ticketNo', 'clientName', 'summary', 'priority', 'assignedTo', 'dueBy', 'status']));
    expect(names('software-saas', 'Ticket')).toEqual(expect.arrayContaining(['account', 'severity', 'fixVersion', 'reportedAt']));
    expect(names('construction', 'SiteIssue')).toEqual(expect.arrayContaining(['project', 'contractor', 'engineer', 'dueBy', 'raisedOn']));
    expect(names('construction', 'ContractorBill')).toEqual(expect.arrayContaining(['thisBill', 'retention', 'tds', 'otherDeductions', 'netPayable', 'receivedOn']));
    const added: [string, string, string[]][] = [
      ['travel-agency', 'Booking', ['supplier', 'supplierPhone']],
      ['hospital', 'CashlessRequest', ['tpaPhone']],
      ['lender', 'Repayment', ['borrowerName', 'borrowerPhone']],
      ['manufacturing-plant', 'QualityIssue', ['foundOn', 'owner']],
      ['ngo', 'Grant', ['programmeLead']],
    ];
    for (const [pack, name, fields] of added) {
      for (const field of fields) expect(entity(pack, name)!.fields.find((f) => f.name === field), `${pack} ${name}.${field}`).toMatchObject({ required: false });
    }
    // Other types that book things keep the plain Booking.
    expect(names('hospital', 'Booking')).not.toContain('supplier');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @onehuman/agent-kit test -- pack`
Expected: FAIL. `wholesale-retail has its main lists` gets `[]` (no registers yet), and the new-entity assertions fail.

- [ ] **Step 3: Wholesale & retail**

Append to `packs/wholesale-retail/pack.yaml`:

```yaml

registers:
  - id: bills
    entity: Bill
    label: Bills
    columns: [billNo, billType, party, billDate, total, paymentStatus, dueDate]
    filters: [billType, paymentStatus, party]
    date_field: billDate
    totals: [taxableValue, gstAmount, total]
    card: { sum: { field: total, when: { paymentStatus: [unpaid, part-paid] }, label: unpaid } }
    checks:
      - missing: [party, billDate, total]
      - adds_up: { field: total, plus: [taxableValue, gstAmount] }
      - duplicate: [billType, billNo, party]
      - overdue: { date: dueDate }
        when: { paymentStatus: [unpaid, part-paid] }
  - id: orders
    entity: Order
    label: Orders
    columns: [orderNo, orderType, customerName, amount, status, paymentStatus, neededBy]
    filters: [orderType, status, paymentStatus]
    date_field: orderedAt
    totals: [amount]
    card: { count: { when: { status: [new, confirmed, on-hold, packed, shipped] }, label: open } }
    checks:
      - missing: [customerName, items]
      - overdue: { date: neededBy }
        when: { status: [new, confirmed, on-hold, packed, shipped] }
  - id: parties
    entity: Party
    label: Parties
    columns: [name, partyType, city, phone, outstanding, creditLimit]
    filters: [partyType, onHold]
    totals: [outstanding]
    card: { sum: { field: outstanding, label: outstanding } }
    checks:
      - missing: [phone]
      - limit: { fields: [outstanding], max: creditLimit }
  - id: products
    entity: Product
    label: Items
    columns: [name, sku, stock, reorderLevel, price, nearestExpiry]
    filters: [active]
    checks:
      - limit: { fields: [stock], min: reorderLevel }
      - expiring: { date: nearestExpiry, days: 30 }
```

- [ ] **Step 4: Logistics**

Append to `packs/logistics/pack.yaml`:

```yaml

registers:
  - id: shipments
    entity: Shipment
    label: Shipments
    columns: [lrNumber, consigneeName, fromCity, toCity, freight, promisedDelivery, status]
    filters: [status, loadType, paymentTerms]
    date_field: bookingDate
    totals: [freight, declaredValue]
    card: { count: { when: { status: [loaded, in-transit] }, label: on the road } }
    checks:
      - missing: [consigneePhone, truckNumber]
      - missing: [ewayBillNumber]
        when: { declaredValue: { above: 50000 } }
        why: "e-way bill needed above ₹50,000"
      - duplicate: [lrNumber]
      - overdue: { date: promisedDelivery }
        when: { status: [booked, loaded, in-transit] }
      - expiring: { date: ewayBillValidUntil, days: 1 }
        when: { status: [loaded, in-transit] }
  - id: claims
    entity: Claim
    label: Claims
    columns: [claimNumber, lrNumber, claimType, claimAmount, settledAmount, status]
    filters: [claimType, status]
    date_field: noticeDate
    totals: [claimAmount, settledAmount]
    card: { sum: { field: claimAmount, when: { status: [received, survey, offer-made] }, label: open } }
    checks:
      - limit: { fields: [settledAmount], max: claimAmount }
      - limit: { fields: [claimAmount], max: declaredValue }
      - duplicate: [claimNumber]
  - id: trucks
    entity: Truck
    label: Trucks
    columns: [truckNumber, ownership, ownerName, permitValidUntil, insuranceValidUntil, status]
    filters: [ownership, status]
    checks:
      - expiring: { date: permitValidUntil, days: 30 }
      - expiring: { date: fitnessValidUntil, days: 30 }
      - expiring: { date: insuranceValidUntil, days: 30 }
      - expiring: { date: pucValidUntil, days: 30 }
  - id: drivers
    entity: Driver
    label: Drivers
    columns: [name, phone, licenceValidUntil, currentTruck, status]
    filters: [status, hazardousEndorsement]
    checks:
      - expiring: { date: licenceValidUntil, days: 30 }
      - missing: [idChecked]
```

- [ ] **Step 5: Travel agency**

In `packs/travel-agency/pack.yaml`, insert the redeclared `Booking` just above `tools:`, below the `Supplier` entity. A child pack's entity replaces the base one with the same name, so every bookings-base field is repeated:

```yaml
  - name: Booking
    label: Booking
    description: A traveller's booking of a package or service, and the supplier who confirms it.
    title_field: customerName
    list_columns: [customerName, service, date, supplier, status, paymentStatus, amount]
    fields:
      - { name: customerName, label: Customer name, type: string, required: true }
      - { name: phone, label: Phone, type: phone }
      - { name: email, label: Email, type: email }
      - { name: service, label: Service, type: string, required: true }
      - { name: date, label: Date, type: date, required: true }
      - { name: time, label: Time, type: string }
      - { name: partySize, label: People, type: integer }
      - { name: amount, label: Amount, type: money }
      - name: status
        label: Status
        type: enum
        required: true
        options: [requested, held, confirmed, cancelled, completed]
      - name: paymentStatus
        label: Payment
        type: enum
        options: [unpaid, requested, paid, refunded]
      - { name: notes, label: Notes, type: text }
      - { name: supplier, label: Supplier, type: string }
      - { name: supplierPhone, label: Supplier phone, type: phone }

```

Append:

```yaml

registers:
  - id: bookings
    entity: Booking
    label: Bookings
    columns: [customerName, service, date, supplier, amount, status, paymentStatus]
    filters: [status, paymentStatus]
    date_field: date
    totals: [amount]
    card: { sum: { field: amount, when: { paymentStatus: [unpaid, requested] }, label: unpaid } }
    checks:
      - missing: [phone]
      - overdue: { date: date }
        when: { status: [requested, held] }
        why: travel date passed and still not confirmed
  - id: trips
    entity: Trip
    label: Trips
    columns: [travellerName, destination, startDate, endDate, travellers, budget, status]
    filters: [status]
    date_field: startDate
    totals: [budget]
    card: { count: { when: { status: [booked, travelling] }, label: booked or travelling } }
    checks:
      - limit: { fields: [endDate], min: startDate }
  - id: suppliers
    entity: Supplier
    label: Suppliers
    columns: [name, type, city, phone, rating]
    filters: [type]
    checks:
      - missing: [phone]
```

- [ ] **Step 6: IT services**

In `packs/it-services/pack.yaml`, insert just above `tools:`:

```yaml
  - name: Ticket
    label: Ticket
    description: A task, fault, bug, service or access request from a client.
    title_field: summary
    list_columns: [ticketNo, clientName, summary, priority, assignedTo, status]
    fields:
      - { name: ticketNo, label: Ticket no., type: string }
      - { name: clientName, label: Client, type: string, required: true }
      - { name: raisedBy, label: Raised by, type: string }
      - name: kind
        label: Kind
        type: enum
        options: [fault, service-request, access-request, bug, change, task]
      - { name: summary, label: Summary, type: string, required: true }
      - { name: details, label: Details, type: text }
      - { name: priority, label: Priority, type: enum, options: [P1, P2, P3, P4] }
      - { name: assetTag, label: Asset tag, type: string }
      - { name: assignedTo, label: Assigned to, type: string }
      - { name: raisedAt, label: Raised at, type: datetime }
      - { name: dueBy, label: Due by, type: datetime }
      - { name: resolvedAt, label: Resolved at, type: datetime }
      - { name: resolution, label: Resolution, type: text }
      - name: status
        label: Status
        type: enum
        options: [new, assigned, in-progress, waiting-for-client, resolved, closed, reopened]

```

Append:

```yaml

registers:
  - id: tickets
    entity: Ticket
    label: Tickets
    columns: [ticketNo, clientName, summary, kind, priority, assignedTo, dueBy, status]
    filters: [kind, priority, status]
    date_field: raisedAt
    card: { count: { when: { status: [new, assigned, in-progress, waiting-for-client, reopened] }, label: open } }
    checks:
      - missing: [clientName, assignedTo]
      - overdue: { date: dueBy }
        when: { status: [new, assigned, in-progress, waiting-for-client, reopened] }
      - duplicate: [ticketNo]
  - id: incidents
    entity: Incident
    label: Incidents
    columns: [title, clientName, kind, noticedAt, usersAffected, status]
    filters: [kind, status, personalDataInvolved]
    date_field: noticedAt
    card: { count: { when: { status: [open, contained] }, label: open } }
    checks:
      - missing: [certInReportedAt]
        when: { kind: [security, data-breach] }
        why: CERT-In must be told within 6 hours
      - missing: [clientToldAt]
      - missing: [rootCause]
        when: { status: [rca-sent, closed] }
  - id: assets
    entity: Asset
    label: Assets
    columns: [assetTag, clientName, deviceType, usedBy, coveredBy, warrantyEndsOn, status]
    filters: [deviceType, coveredBy, status]
    checks:
      - expiring: { date: warrantyEndsOn, days: 30 }
        when: { status: [in-use, in-repair, standby] }
      - missing: [wipeCertificate]
        when: { status: [retired, recycled] }
  - id: contracts
    entity: Contract
    label: Contracts
    columns: [clientName, contractNumber, contractType, endsOn, monthlyFee, status]
    filters: [contractType, status]
    date_field: startsOn
    totals: [monthlyFee]
    card:
      count: { when: { status: [active] }, label: active }
      sum: { field: monthlyFee, when: { status: [active] }, label: a month }
    checks:
      - expiring: { date: endsOn, days: 45 }
        when: { status: [active, renewal-due] }
```

- [ ] **Step 7: Software / SaaS**

In `packs/software-saas/pack.yaml`, insert just above `tools:`:

```yaml
  - name: Ticket
    label: Ticket
    description: A bug, a support question or a feature request from a customer.
    title_field: summary
    list_columns: [ticketNo, account, summary, severity, assignedTo, status]
    fields:
      - { name: ticketNo, label: Ticket no., type: string }
      - { name: account, label: Customer account, type: string, required: true }
      - { name: reportedBy, label: Reported by, type: string }
      - name: kind
        label: Kind
        type: enum
        options: [bug, support-question, feature-request, billing, data-request]
      - { name: summary, label: Summary, type: string, required: true }
      - { name: details, label: Details, type: text }
      - { name: severity, label: Severity, type: enum, options: [P1, P2, P3, P4] }
      - { name: assignedTo, label: Assigned to, type: string }
      - { name: reportedAt, label: Reported at, type: datetime }
      - { name: dueBy, label: Due by, type: datetime }
      - { name: fixVersion, label: Fixed in version, type: string }
      - { name: resolvedAt, label: Resolved at, type: datetime }
      - name: status
        label: Status
        type: enum
        options: [new, triaged, in-progress, waiting-for-customer, fixed, released, closed, wont-fix]

```

Append:

```yaml

registers:
  - id: tickets
    entity: Ticket
    label: Tickets
    columns: [ticketNo, account, summary, kind, severity, assignedTo, dueBy, status]
    filters: [kind, severity, status]
    date_field: reportedAt
    card: { count: { when: { status: [new, triaged, in-progress, waiting-for-customer] }, label: open } }
    checks:
      - missing: [account, assignedTo]
      - overdue: { date: dueBy }
        when: { status: [new, triaged, in-progress, waiting-for-customer] }
      - duplicate: [ticketNo]
  - id: incidents
    entity: Incident
    label: Incidents
    columns: [title, kind, severity, startedAt, customersAffected, status]
    filters: [kind, severity, status]
    date_field: startedAt
    card: { count: { when: { status: [open, contained] }, label: open } }
    checks:
      - missing: [certInReportedAt]
        when: { kind: [security, data-leak] }
        why: CERT-In must be told within 6 hours
      - missing: [rootCause]
        when: { status: [resolved, review-done] }
  - id: releases
    entity: Release
    label: Releases
    columns: [version, changeType, plannedAt, approvedBy, status, outcome]
    filters: [changeType, status, outcome]
    date_field: plannedAt
    card: { count: { when: { status: [planned, approved] }, label: coming up } }
    checks:
      - missing: [rollbackPlan, approvedBy]
        when: { status: [approved, released] }
      - missing: [customersToldOn]
        when: { downtimeExpectedMinutes: { above: 0 } }
  - id: payments
    entity: Payment
    label: Payments
    columns: [invoiceNumber, account, invoiceDate, amount, status, paidOn]
    filters: [status, mode]
    date_field: invoiceDate
    totals: [amount, gstAmount]
    card: { sum: { field: amount, when: { status: [due, failed] }, label: due } }
    checks:
      - duplicate: [invoiceNumber]
      - overdue: { date: invoiceDate, grace_days: 15 }
        when: { status: [due, failed] }
        why: unpaid 15 days after the invoice
```

- [ ] **Step 8: Digital agency**

Append to `packs/digital-agency/pack.yaml`:

```yaml

registers:
  - id: deliverables
    entity: Deliverable
    label: Deliverables
    columns: [jobNumber, client, title, kind, dueDate, roundsUsed, status]
    filters: [kind, status]
    date_field: dueDate
    totals: [hoursEstimated, hoursSpent]
    card: { count: { when: { status: [in-progress, internal-review, with-client, changes-asked, on-hold] }, label: open } }
    checks:
      - overdue: { date: dueDate }
        when: { status: [in-progress, internal-review, with-client, changes-asked, on-hold] }
      - limit: { fields: [roundsUsed], max: roundsIncluded }
      - limit: { fields: [hoursSpent], max: hoursEstimated }
      - missing: [clientApprovedBy]
        when: { status: [cleared-to-publish, live] }
  - id: invoices
    entity: Invoice
    label: Invoices
    columns: [invoiceNumber, client, invoiceDate, amount, dueDate, status]
    filters: [status]
    date_field: invoiceDate
    totals: [amount, gst, tdsDeducted]
    card: { sum: { field: amount, when: { status: [sent, part-paid, overdue] }, label: unpaid } }
    checks:
      - duplicate: [invoiceNumber]
      - overdue: { date: dueDate }
        when: { status: [sent, part-paid, overdue] }
  - id: scopes
    entity: Scope
    label: Scopes
    columns: [scopeNumber, client, kind, fee, startDate, endDate, status]
    filters: [kind, status]
    date_field: startDate
    totals: [fee]
    card: { count: { when: { status: [active] }, label: active } }
    checks:
      - missing: [clientApprovedOn]
        when: { status: [approved, active] }
```

- [ ] **Step 9: Construction**

In `packs/construction/pack.yaml`, insert just above `tools:`:

```yaml
  - name: SiteIssue
    label: Site issue
    description: A snag, material shortage, delay, safety or quality problem on site.
    title_field: description
    list_columns: [issueNo, project, location, kind, contractor, dueBy, status]
    fields:
      - { name: issueNo, label: Issue no., type: string }
      - { name: project, label: Project, type: string, required: true }
      - { name: location, label: "Where (tower, floor, unit)", type: string }
      - name: kind
        label: Kind
        type: enum
        options: [snag, material-shortage, delay, safety, quality, labour, design-query, other]
      - { name: description, label: What is wrong, type: text, required: true }
      - { name: raisedBy, label: Raised by, type: string }
      - { name: raisedOn, label: Raised on, type: date }
      - { name: contractor, label: Contractor fixing it, type: reference, ref: Contractor }
      - { name: engineer, label: Our engineer, type: string }
      - { name: dueBy, label: Fix by, type: date }
      - { name: costImpact, label: Cost impact, type: money }
      - { name: delayDays, label: Days of delay, type: integer }
      - { name: closedOn, label: Closed on, type: date }
      - name: status
        label: Status
        type: enum
        options: [open, in-progress, fixed, verified, closed]
  - name: ContractorBill
    label: Contractor bill
    description: "A contractor's running-account (RA) bill, from measurement to payment."
    title_field: billNo
    list_columns: [billNo, contractor, project, raBillNumber, thisBill, netPayable, status]
    fields:
      - { name: billNo, label: Bill no., type: string }
      - { name: contractor, label: Contractor, type: reference, ref: Contractor, required: true }
      - { name: project, label: Project, type: string, required: true }
      - { name: workOrderNo, label: Work order no., type: string }
      - { name: period, label: Period, type: string }
      - { name: raBillNumber, label: RA bill no., type: integer }
      - { name: receivedOn, label: Received on, type: date }
      - { name: workOrderValue, label: Work order value, type: money }
      - { name: previouslyBilled, label: Billed before, type: money }
      - { name: thisBill, label: This bill, type: money, required: true }
      - { name: retention, label: Retention, type: money }
      - { name: tds, label: TDS, type: money }
      - { name: otherDeductions, label: Other deductions, type: money }
      - { name: netPayable, label: Net payable, type: money }
      - { name: measuredBy, label: Measured by, type: string }
      - { name: certifiedBy, label: Certified by, type: string }
      - { name: certifiedOn, label: Certified on, type: date }
      - { name: dueDate, label: Due date, type: date }
      - { name: paidOn, label: Paid on, type: date }
      - { name: paymentRef, label: UTR / cheque no., type: string }
      - name: status
        label: Status
        type: enum
        options: [received, measuring, certified, approved, part-paid, paid, disputed, rejected]

```

Append:

```yaml

registers:
  - id: site-issues
    entity: SiteIssue
    label: Site issues
    columns: [issueNo, project, location, kind, contractor, dueBy, status]
    filters: [kind, status, contractor]
    date_field: raisedOn
    totals: [costImpact]
    card: { count: { when: { status: [open, in-progress] }, label: open } }
    checks:
      - missing: [engineer]
      - overdue: { date: dueBy }
        when: { status: [open, in-progress] }
  - id: contractor-bills
    entity: ContractorBill
    label: Contractor bills
    columns: [billNo, contractor, project, raBillNumber, thisBill, netPayable, status]
    filters: [status, contractor]
    date_field: receivedOn
    totals: [thisBill, retention, tds, netPayable]
    card: { sum: { field: netPayable, when: { status: [received, measuring, certified, approved, part-paid, disputed] }, label: to pay } }
    checks:
      - adds_up: { field: netPayable, plus: [thisBill], minus: [retention, tds, otherDeductions] }
      - limit: { fields: [previouslyBilled, thisBill], max: workOrderValue }
      - duplicate: [contractor, project, raBillNumber]
      - overdue: { date: dueDate }
        when: { status: [certified, approved, part-paid] }
  - id: units
    entity: Unit
    label: Units
    columns: [unitNumber, tower, project, buyerName, possessionDate, openSnags, status]
    filters: [status, duesCleared]
    date_field: agreementDate
    card: { count: { when: { status: [booked, agreement-signed] }, label: booked } }
    checks:
      - overdue: { date: possessionDate }
        when: { status: [booked, agreement-signed, ready-for-possession] }
        why: possession date passed
      - missing: [buyerMobile]
        when: { status: [booked, agreement-signed] }
  - id: workers
    entity: Worker
    label: Workers
    columns: [fullName, trade, contractor, mobile, bocwNumber, status]
    filters: [trade, status]
    card: { count: { when: { status: [working] }, label: working } }
    checks:
      - missing: [bocwNumber]
        when: { status: [working] }
        why: BOCW registration
      - expiring: { date: healthCheckDueOn, days: 15 }
        when: { status: [working] }
  - id: contractors
    entity: Contractor
    label: Contractors
    columns: [name, kind, work, phone, licenceValidTill, retentionHeld]
    filters: [kind, rating]
    totals: [retentionHeld, securityDeposit]
    card: { sum: { field: retentionHeld, label: retention held } }
    checks:
      - expiring: { date: licenceValidTill, days: 30 }
      - missing: [labourLicenceNo]
        when: { kind: [labour-contractor] }
```

- [ ] **Step 10: Power plant**

Append to `packs/power-plant/pack.yaml`:

```yaml

registers:
  - id: work-permits
    entity: WorkPermit
    label: Work permits
    columns: [permitNo, permitType, equipment, receivedBy, crewCount, validTill, status]
    filters: [permitType, status]
    date_field: validTill
    card: { count: { when: { status: [issued] }, label: open } }
    checks:
      - overdue: { date: validTill }
        when: { status: [issued] }
        why: time over but not returned
      - missing: [gasTestOk]
        when: { permitType: [confined-space] }
      - missing: [earthsFixed]
        when: { permitType: [electrical, line-clear] }
      - duplicate: [permitNo]
  - id: outages
    entity: Outage
    label: Outages
    columns: [element, outageType, plannedStart, plannedEnd, consumersAffected, status]
    filters: [outageType, status]
    date_field: plannedStart
    totals: [consumersAffected]
    card: { count: { when: { status: [in-progress] }, label: in progress } }
    checks:
      - overdue: { date: plannedEnd }
        when: { status: [in-progress] }
      - missing: [noticeSent]
        when: { consumersAffected: { above: 0 } }
      - missing: [ldcCode]
        when: { status: [approved, in-progress] }
  - id: equipment
    entity: Equipment
    label: Equipment
    columns: [tag, name, kind, criticality, nextMaintenance, status]
    filters: [kind, criticality, status]
    card: { count: { when: { status: [forced-outage] }, label: forced out } }
    checks:
      - overdue: { date: nextMaintenance }
        when: { status: [in-service, standby] }
  - id: incidents
    entity: Incident
    label: Incidents
    columns: [occurredAt, place, kind, personName, formASentAt, status]
    filters: [kind, personType, status]
    date_field: occurredAt
    card: { count: { when: { status: [open, reported, investigating] }, label: open } }
    checks:
      - missing: [formASentAt]
        when: { kind: [fatal, non-fatal, dangerous-occurrence] }
        why: accident report to the Electrical Inspector
```

- [ ] **Step 11: Manufacturing plant**

In `packs/manufacturing-plant/pack.yaml`, entity `QualityIssue`, add right after the line `      - { name: cost, label: "Cost (scrap, rework, sorting)", type: money }`:

```yaml
      - { name: foundOn, label: Found on, type: date }
      - { name: owner, label: Who is handling it, type: string }
```

Append:

```yaml

registers:
  - id: production-orders
    entity: ProductionOrder
    label: Production orders
    columns: [orderNo, customer, partNo, quantity, producedQty, dueDate, status]
    filters: [status]
    date_field: dueDate
    totals: [quantity, producedQty, rejectedQty, orderValue]
    card: { count: { when: { status: [released, running] }, label: running } }
    checks:
      - overdue: { date: dueDate }
        when: { status: [planned, released, running, on-hold] }
      - limit: { fields: [rejectedQty], max: producedQty }
      - duplicate: [orderNo]
  - id: quality-issues
    entity: QualityIssue
    label: Quality issues
    columns: [partNo, lotNo, defect, foundAt, disposition, owner, status]
    filters: [foundAt, disposition, status]
    date_field: foundOn
    totals: [qtyAffected, cost]
    card: { count: { when: { status: [open, contained, capa-open] }, label: open } }
    checks:
      - overdue: { date: capaDue }
        when: { status: [open, contained, capa-open] }
      - missing: [decidedBy]
        when: { disposition: [use-as-is-concession] }
      - missing: [rootCause]
        when: { status: [closed] }
  - id: machines
    entity: Machine
    label: Machines
    columns: [code, name, line, criticality, nextPmDue, status]
    filters: [criticality, status]
    card: { count: { when: { status: [stopped] }, label: stopped } }
    checks:
      - overdue: { date: nextPmDue }
        when: { status: [running, standby] }
      - overdue: { date: statutoryTestDue }
  - id: safety-incidents
    entity: SafetyIncident
    label: Safety incidents
    columns: [occurredAt, location, type, personName, daysLost, status]
    filters: [type, status, reportable]
    date_field: occurredAt
    totals: [daysLost]
    card: { count: { when: { status: [open, investigating, actions-open] }, label: open } }
    checks:
      - missing: [noticeSentAt]
        when: { reportable: [true] }
        why: Factories Act notice
      - missing: [esiReportSentAt]
        when: { daysLost: { above: 0 } }
```

- [ ] **Step 12: Hospital**

In `packs/hospital/pack.yaml`, entity `CashlessRequest`, add right after `      - { name: insurerOrTpa, label: Insurer or TPA, type: string }`:

```yaml
      - { name: tpaPhone, label: TPA phone, type: phone }
```

Append:

```yaml

registers:
  - id: visits
    entity: Visit
    label: Visits
    columns: [visitNumber, patientName, visitType, department, payer, finalBill, status]
    filters: [visitType, payer, status]
    date_field: arrivedAt
    totals: [estimate, advancePaid, finalBill]
    card: { sum: { field: finalBill, label: billed } }
    checks:
      - missing: [finalBill]
        when: { status: [discharge-ordered, left] }
      - limit: { fields: [advancePaid], max: finalBill }
        why: refund due
      - missing: [consentSigned]
        when: { visitType: [day-care, admission] }
      - missing: [summaryGiven]
        when: { status: [left] }
      - duplicate: [visitNumber]
  - id: cashless-requests
    entity: CashlessRequest
    label: Cashless requests
    columns: [patientName, visitNumber, insurerOrTpa, requestType, amountAsked, amountApproved, status]
    filters: [payer, requestType, status]
    date_field: sentAt
    totals: [amountAsked, amountApproved]
    card: { sum: { field: amountAsked, when: { status: [sent, query] }, label: waiting } }
    checks:
      - limit: { fields: [amountApproved], max: amountAsked }
      - overdue: { date: sentAt, grace_days: 1 }
        when: { status: [query] }
        why: query open for over a day
  - id: appointments
    entity: Booking
    label: Appointments
    columns: [customerName, service, date, time, status, paymentStatus]
    filters: [status, paymentStatus]
    date_field: date
    totals: [amount]
    card: { count: { when: { status: [requested, held, confirmed] }, label: coming up } }
    checks:
      - overdue: { date: date }
        when: { status: [requested, held] }
  - id: incidents
    entity: Incident
    label: Incidents
    columns: [summary, occurredAt, incidentType, harm, familyTold, status]
    filters: [incidentType, harm, status]
    date_field: occurredAt
    card: { count: { when: { status: [reported, under-review, actions-agreed] }, label: open } }
    checks:
      - missing: [familyTold]
        when: { harm: [moderate, severe, death] }
      - missing: [rootCause]
        when: { status: [actions-agreed, closed] }
```

- [ ] **Step 13: Education**

Append to `packs/education/pack.yaml`:

```yaml

registers:
  - id: fee-accounts
    entity: FeeAccount
    label: Fee accounts
    columns: [studentName, admissionNumber, academicYear, totalFee, paid, due, nextDueDate]
    filters: []
    date_field: nextDueDate
    totals: [totalFee, concession, paid, due]
    card: { sum: { field: due, label: due } }
    checks:
      - adds_up: { field: due, plus: [totalFee], minus: [concession, paid] }
      - overdue: { date: nextDueDate }
        when: { due: { above: 0 } }
      - limit: { fields: [concession], max: totalFee }
      - missing: [concessionReason]
        when: { concession: { above: 0 } }
  - id: enrolments
    entity: Booking
    label: Enrolments
    columns: [customerName, service, date, amount, status, paymentStatus]
    filters: [status, paymentStatus]
    date_field: date
    totals: [amount]
    checks:
      - missing: [phone]
  - id: students
    entity: Customer
    label: Students
    columns: [name, admissionNumber, classSection, parentName, phone, attendancePercent, status]
    filters: [seatType, status]
    date_field: admittedOn
    card: { count: { when: { status: [studying] }, label: studying } }
    checks:
      - missing: [parentName, phone]
      - limit: { fields: [attendancePercent], min: 75 }
        when: { status: [studying] }
        why: attendance below 75%
  - id: assets
    entity: Asset
    label: Assets
    columns: [assetName, assetType, location, fitnessUntil, insuranceUntil, status]
    filters: [assetType, status]
    card: { count: { when: { status: [under-repair, off-road] }, label: out of use } }
    checks:
      - expiring: { date: fitnessUntil, days: 30 }
      - expiring: { date: insuranceUntil, days: 30 }
      - expiring: { date: permitUntil, days: 30 }
      - expiring: { date: amcUntil, days: 30 }
      - missing: [gpsWorking, cctvWorking, attendantOnBoard]
        when: { assetType: [bus, van] }
        why: school transport safety rules
  - id: staff-members
    entity: StaffMember
    label: Staff members
    main: false
    columns: [fullName, employeeId, role, mobile, policeVerified, safetyTrained]
    filters: [role]
    checks:
      - missing: [policeVerified, safetyTrained]
```

- [ ] **Step 14: Municipal**

Append to `packs/municipal/pack.yaml`:

```yaml

registers:
  - id: service-applications
    entity: ServiceApplication
    label: Service applications
    columns: [applicationNo, service, applicant, ward, dueBy, designatedOfficer, status]
    filters: [status]
    date_field: receivedOn
    totals: [fee]
    card: { count: { when: { status: [received, papers-pending, inspection, sanctioned] }, label: open } }
    checks:
      - overdue: { date: dueBy }
        when: { status: [received, papers-pending, inspection, sanctioned] }
        why: Right to Services deadline
      - missing: [designatedOfficer]
      - duplicate: [applicationNo]
  - id: properties
    entity: Property
    label: Properties
    columns: [propertyId, ownerName, ward, usage, annualTax, arrears, lastPaidOn]
    filters: [usage]
    totals: [annualTax, arrears]
    card: { sum: { field: arrears, label: arrears } }
    checks:
      - overdue: { date: lastPaidOn, grace_days: 365 }
        when: { arrears: { above: 0 } }
        why: not paid for over a year
  - id: trade-licences
    entity: TradeLicence
    label: Trade licences
    columns: [licenceNo, tradeName, holder, ward, validTill, status]
    filters: [status]
    date_field: validTill
    totals: [fee]
    card: { count: { when: { status: [active] }, label: active } }
    checks:
      - expiring: { date: validTill, days: 30 }
        when: { status: [active] }
```

- [ ] **Step 15: Lender**

In `packs/lender/pack.yaml`, in the `Repayment` entity (the block that starts with `  - name: Repayment`), add right after its `loanNumber` field line:

```yaml
      - { name: borrowerName, label: Borrower name, type: string }
      - { name: borrowerPhone, label: Borrower phone, type: phone }
```

Append:

```yaml

registers:
  - id: repayments
    entity: Repayment
    label: Repayments
    columns: [loanNumber, borrowerName, dueDate, amountDue, amountPaid, status, promiseToPayOn]
    filters: [status, mode]
    date_field: dueDate
    totals: [amountDue, amountPaid, penalCharge]
    card: { sum: { field: amountDue, when: { status: [due, bounced, part-paid, promised] }, label: outstanding } }
    checks:
      - limit: { fields: [amountPaid], max: amountDue }
      - overdue: { date: dueDate }
        when: { status: [due, bounced, part-paid] }
      - overdue: { date: promiseToPayOn }
        when: { status: [promised] }
        why: promise date passed
      - missing: [receiptNumber]
        when: { mode: [cash], status: [paid, part-paid] }
  - id: loans
    entity: Loan
    label: Loans
    columns: [loanNumber, borrowerName, product, amountSanctioned, principalOutstanding, bucket, status]
    filters: [product, bucket, status]
    date_field: disbursedOn
    totals: [amountSanctioned, principalOutstanding]
    card: { sum: { field: principalOutstanding, label: outstanding } }
    checks:
      - limit: { fields: [amountSanctioned], max: amountAsked }
      - missing: [sanctionedBy]
        when: { status: [sanctioned, disbursed] }
      - duplicate: [loanNumber]
  - id: collateral
    entity: Collateral
    label: Collateral
    columns: [loanNumber, securityType, value, valuedOn, packetNumber, status]
    filters: [securityType, status]
    date_field: valuedOn
    totals: [value]
    card: { sum: { field: value, when: { status: [held] }, label: held } }
    checks:
      - missing: [chargeRegistered, originalsKeptAt]
        when: { securityType: [property] }
      - missing: [packetNumber]
        when: { securityType: [gold] }
```

- [ ] **Step 16: Accounting firm**

Append to `packs/accounting-firm/pack.yaml`:

```yaml

registers:
  - id: filings
    entity: Filing
    label: Filings
    columns: [client, filingType, period, dueDate, preparedBy, status]
    filters: [filingType, status]
    date_field: dueDate
    totals: [taxPayable, lateFeeInterest]
    card: { count: { when: { status: [not-started, waiting-for-client, prepared, in-review, client-approval] }, label: open } }
    checks:
      - overdue: { date: dueDate }
        when: { status: [not-started, waiting-for-client, prepared, in-review, client-approval] }
      - overdue: { date: internalDeadline }
        when: { status: [not-started, waiting-for-client, prepared, in-review, client-approval] }
      - missing: [reviewedBy, acknowledgementNo]
        when: { status: [filed, verified, closed] }
  - id: tax-notices
    entity: TaxNotice
    label: Tax notices
    columns: [client, authority, noticeType, noticeDate, replyDueDate, amountInDispute, status]
    filters: [authority, status]
    date_field: noticeDate
    totals: [amountInDispute]
    card: { count: { when: { status: [received, drafting, partner-review] }, label: to reply } }
    checks:
      - expiring: { date: replyDueDate, days: 7 }
        when: { status: [received, drafting, partner-review] }
      - missing: [verified]
        why: check the notice is genuine
      - duplicate: [referenceNo]
  - id: signed-reports
    entity: SignedReport
    label: Signed reports
    columns: [client, documentType, signingPartner, signedOn, udin, acceptedOnPortal]
    filters: [documentType]
    date_field: signedOn
    checks:
      - missing: [udin]
        when: { signedOn: filled }
        why: UDIN within 60 days of signing
```

- [ ] **Step 17: NGO**

In `packs/ngo/pack.yaml`, entity `Grant`, add right after `      - { name: donorName, label: Donor or funder, type: string, required: true }`:

```yaml
      - { name: programmeLead, label: Programme lead, type: string }
```

Append:

```yaml

registers:
  - id: vouchers
    entity: Voucher
    label: Vouchers
    columns: [voucherNumber, grantCode, payee, amount, mode, status, paidOn]
    filters: [mode, paidFrom, status]
    totals: [amount, tdsDeducted]
    card: { sum: { field: amount, when: { status: [paid] }, label: paid out } }
    checks:
      - missing: [approvedBy]
        when: { status: [approved, paid] }
      - limit: { fields: [quotations], min: 3 }
        when: { amount: { above: 25000 } }
        why: "three quotations above ₹25,000"
      - duplicate: [voucherNumber]
  - id: donations
    entity: Donation
    label: Donations
    columns: [receiptNumber, donorName, amount, mode, receivedOn, certificateSentOn]
    filters: [mode, isForeignSource]
    date_field: receivedOn
    totals: [amount]
    card: { sum: { field: amount, label: received } }
    checks:
      - missing: [panOrId, certificateSentOn]
      - limit: { fields: [amount], max: 2000 }
        when: { mode: [cash] }
        why: "cash donations above ₹2,000 get no 80G deduction"
      - duplicate: [receiptNumber]
  - id: grants
    entity: Grant
    label: Grants
    columns: [grantCode, donorName, amountAgreed, receivedToDate, spentToDate, nextReportDue, status]
    filters: [donorType, status]
    date_field: startDate
    totals: [amountAgreed, receivedToDate, spentToDate]
    card: { sum: { field: amountAgreed, when: { status: [active] }, label: active } }
    checks:
      - limit: { fields: [spentToDate], max: receivedToDate }
      - limit: { fields: [adminSpent], max: receivedToDate, factor: 0.2 }
        when: { isForeign: [true] }
        why: "FCRA: admin costs up to 20%"
      - expiring: { date: nextReportDue, days: 15 }
        when: { status: [signed, active, closing] }
  - id: beneficiaries
    entity: Beneficiary
    label: Beneficiaries
    columns: [fullName, village, programme, status, lastVisitOn]
    filters: [gender, status]
    card: { count: { when: { status: [served] }, label: served } }
    checks:
      - missing: [consentOn]
```

- [ ] **Step 18: Run the pack tests**

Run: `pnpm --filter @onehuman/agent-kit test`
Expected: PASS. This includes `'%s resolves with valid cross-references'` for every pack. Any register mistake shows up there as `register <id>: …`; fix the YAML the message names.

Run: `pnpm --filter @onehuman/backend test -- generator && pnpm --filter @onehuman/evals test`
Expected: PASS. These also parse every pack.

- [ ] **Step 19: Commit**

```bash
git add packs packages/agent-kit/__tests__/pack.test.ts
git commit -m "feat(packs): lists and checks for all 15 organization types, tickets, site issues and contractor bills

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Record how items came in and who checked them (migration)

**Files:**
- Modify: `master-ai-backend/src/db/schema.ts` (the `records` table)
- Create (generated): `master-ai-backend/drizzle/0012_record_lists.sql` and its `meta/` snapshot
- Create (custom): `master-ai-backend/drizzle/0013_record_lists_backfill.sql`
- Test: `master-ai-backend/__tests__/integration/record-sources.spec.ts` (create)

**Interfaces:**
- Produces: new `records` columns, exposed by Drizzle as:

  | Column | Type |
  |---|---|
  | `source` | `'manual' \| 'call' \| 'agent' \| 'sample'` |
  | `sourceRef` | `string \| null` |
  | `updatedBy` | `string \| null` |
  | `updatedVia` | `'manual' \| 'call' \| 'agent' \| 'system' \| null` |
  | `updatedRef` | `string \| null` |
  | `checkedBy` | `string \| null` |
  | `checkedAt` | `Date \| null` |
  | `checkNote` | `string \| null` |
  | `checkedProblems` | `string[]` |

  It also adds the SQL functions `try_numeric(text)`, `try_date(text)` and `try_timestamptz(text)`, which return null instead of raising.

- [ ] **Step 1: Write the failing test**

Create `master-ai-backend/__tests__/integration/record-sources.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;

beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
});
afterAll(() => h.close());

describe('reading numbers and dates out of records', () => {
  it('turns anything that is not a valid number or date into null instead of failing', async () => {
    const { rows } = await h.owner.query(`
      select try_numeric('48260') as n, try_numeric('abc') as bad_n, try_numeric('NaN') as nan, try_numeric('') as empty,
             try_date('2026-10-14') as d, try_date('2026-13-45') as bad_d, try_date('soon') as word,
             try_timestamptz('2026-10-14T10:00:00Z') as t, try_timestamptz('2026-10-14T99:00:00Z') as bad_t`);
    expect(rows[0]).toMatchObject({ n: '48260', bad_n: null, nan: null, empty: null, bad_d: null, word: null, bad_t: null });
    expect(rows[0].d).not.toBeNull();
    expect(rows[0].t).not.toBeNull();
  });

  it('lets the app role use them', async () => {
    const { rows } = await h.owner.query(`
      select bool_and(has_function_privilege('onehuman_app', f, 'EXECUTE')) as ok
      from unnest(array['try_numeric(text)', 'try_date(text)', 'try_timestamptz(text)']) f`);
    expect(rows[0].ok).toBe(true);
  });
});

describe('the backfill for items saved before this', () => {
  it('marks the sample items seeded at install as samples', async () => {
    await h.owner.query(`update records set source = 'manual' where tenant_id = $1`, [a.tenantId]);
    const sql = readFileSync(new URL('../../drizzle/0013_record_lists_backfill.sql', import.meta.url), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint').filter((s) => /^\s*(--.*\n\s*)*UPDATE/i.test(s))) {
      await h.owner.query(statement);
    }
    const { rows } = await h.owner.query(`select distinct source from records where tenant_id = $1`, [a.tenantId]);
    expect(rows).toEqual([{ source: 'sample' }]);
  });

  it('starts every item as not checked, with nothing acknowledged', async () => {
    const { rows } = await h.owner.query(
      `select count(*)::int as n from records where tenant_id = $1 and (checked_at is not null or checked_problems <> '{}')`,
      [a.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm infra:up` (if Postgres isn't running), then `pnpm test:integration -- record-sources`
Expected: FAIL with `function try_numeric(unknown) does not exist`.

- [ ] **Step 3: Add the columns**

In `master-ai-backend/src/db/schema.ts`, in the `records` table, add after `createdBy: uuid('created_by'),`:

```ts
    /** How the item came in: typed by a person, from a phone call, by an AI agent, or sample data. */
    source: text('source', { enum: ['manual', 'call', 'agent', 'sample'] }).notNull().default('manual'),
    /** The call (call) or tool call (agent) that added it. */
    sourceRef: uuid('source_ref'),
```

Add after `updatedAt: …`:

```ts
    updatedBy: uuid('updated_by'),
    /** How it was last changed; null when it hasn't changed since lists began recording it. */
    updatedVia: text('updated_via', { enum: ['manual', 'call', 'agent', 'system'] }),
    updatedRef: uuid('updated_ref'),
    /** An owner or admin agreed with the item. Anyone else's later change clears it. */
    checkedBy: uuid('checked_by'),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    checkNote: text('check_note'),
    /** Keys of the problems the person who checked it saw and accepted (agent-kit `checkKeys`). */
    checkedProblems: text('checked_problems').array().notNull().default(sql`'{}'::text[]`),
```

Change the table's index list to:

```ts
  (t) => [index('records_entity_idx').on(t.tenantId, t.workspaceId, t.entity), index('records_source_idx').on(t.tenantId, t.workspaceId, t.entity, t.source)],
```

- [ ] **Step 4: Generate the migration, then add the custom one**

Run: `pnpm --filter @onehuman/backend db:generate --name record_lists`
Expected: `drizzle/0012_record_lists.sql` adds the nine columns and `records_source_idx`. Open it and check it has nothing else.

Run: `pnpm --filter @onehuman/backend exec drizzle-kit generate --custom --name record_lists_backfill`
Expected: an empty `drizzle/0013_record_lists_backfill.sql`, plus a journal entry. Write into it:

```sql
-- Values read from a record's JSON for list checks, totals and sorting. Anything that is not a
-- valid number or date reads as null (blank), so one bad value can never break a list.
CREATE OR REPLACE FUNCTION try_numeric(v text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF v IS NULL OR v !~ '^\s*-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$' THEN RETURN NULL; END IF;
  RETURN v::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION try_date(v text) RETURNS date
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
BEGIN
  IF v IS NULL OR v !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN left(v, 10)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION try_timestamptz(v text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
BEGIN
  IF v IS NULL OR v !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN v::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION try_numeric(text), try_date(text), try_timestamptz(text) TO onehuman_app;
--> statement-breakpoint
-- How items saved before this came in. Sample items were seeded in the install transaction,
-- so they share the workspace's created_at (now() is the transaction's start time).
UPDATE records r SET source = 'sample' FROM workspaces w WHERE w.id = r.workspace_id AND r.created_at = w.created_at;
--> statement-breakpoint
-- Items an AI agent added say so in the audit trail.
UPDATE records r SET source = 'agent'
  FROM audit_events e
  WHERE e.ref_id = r.id AND e.type = 'record.created' AND e.actor_kind = 'agent' AND r.source = 'manual';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test:integration -- record-sources`
Expected: PASS. The harness's global setup migrates a fresh `onehuman_test` database, so 0012 and 0013 are applied.

Run: `pnpm test:integration -- tenant-isolation`
Expected: PASS (no new table).

Run: `pnpm --filter @onehuman/backend typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add master-ai-backend/src/db/schema.ts master-ai-backend/drizzle master-ai-backend/__tests__/integration/record-sources.spec.ts
git commit -m "feat(db): records say how they came in and who checked them; safe number and date reads

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Every way an item is saved records how, and edits are audited

**Files:**
- Modify: `master-ai-backend/src/records/records.service.ts`
- Modify: `master-ai-backend/src/records/records.controller.ts` (passes `s.role`)
- Modify: `master-ai-backend/src/connectors/connectors.service.ts` (`records.create` and `records.update`)
- Test: `master-ai-backend/__tests__/unit/records/samples.test.ts` (create)
- Test: `master-ai-backend/__tests__/integration/record-sources.spec.ts` (append)

**Interfaces:**
- Consumes: the Task 5 columns and `titleOf` (agent-kit, Task 2).
- Produces:

  ```ts
  export interface RecordSource { kind: 'manual' | 'call' | 'agent' | 'sample'; ref?: string | null; checkedBy?: string | null }
  export interface RecordChange { actor: Actor; via: 'manual' | 'call' | 'agent' | 'system'; ref?: string | null; note?: string | null; checkedBy?: string | null }
  RecordsService.create(tx, tenantId, ws, entityName, data, actor, source?: RecordSource): Promise<typeof records.$inferSelect>
  RecordsService.update(tx, tenantId, ws, entityName, id, patch, change: RecordChange): Promise<typeof records.$inferSelect>
  RecordsService.createFromApi(tenantId, principalId, role: HumanRole, entityName, data): Promise<PackRecord>
  export function changedFields(entity: EntityDef, before: Record<string, unknown>, after: Record<string, unknown>): { field: string; from: unknown; to: unknown }[]
  export function seedOrder(entities: EntityDef[]): EntityDef[]
  export function sampleRecord(entity: EntityDef, i: number, ref?: (entityName: string) => string | undefined): Record<string, unknown>
  ```

  Audit payloads:
  - `record.created`: `{ entity, label, title, source }`
  - `record.updated`: `{ entity, label, title, changes, note?, via }`

- [ ] **Step 1: Write the failing unit test**

Create `master-ai-backend/__tests__/unit/records/samples.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityDef } from '@onehuman/schemas';
import { entityValidator } from '@onehuman/agent-kit';
import { changedFields, sampleRecord, seedOrder } from '../../../src/records/records.service';

const Contractor: EntityDef = { name: 'Contractor', label: 'Contractor', title_field: 'name', fields: [{ name: 'name', label: 'Name', type: 'string', required: true }] };
const ContractorBill: EntityDef = {
  name: 'ContractorBill', label: 'Contractor bill',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: false },
    { name: 'contractor', label: 'Contractor', type: 'reference', ref: 'Contractor', required: true },
    { name: 'thisBill', label: 'This bill', type: 'money', required: true },
    { name: 'note', label: 'Note', type: 'text', required: false },
  ],
};
const A: EntityDef = { name: 'A', label: 'A', fields: [{ name: 'b', label: 'B', type: 'reference', ref: 'B', required: false }] };
const B: EntityDef = { name: 'B', label: 'B', fields: [{ name: 'a', label: 'A', type: 'reference', ref: 'A', required: false }] };

describe('sample data', () => {
  it('seeds a record type before the ones that point at it', () => {
    expect(seedOrder([ContractorBill, Contractor]).map((e) => e.name)).toEqual(['Contractor', 'ContractorBill']);
  });

  it('still seeds record types that point at each other, each once', () => {
    expect(seedOrder([A, B]).map((e) => e.name).sort()).toEqual(['A', 'B']);
  });

  it('fills a reference with a sample item of that type, and the result validates', () => {
    const data = sampleRecord(ContractorBill, 0, (name) => (name === 'Contractor' ? 'contractor-1' : undefined));
    expect(data.contractor).toBe('contractor-1');
    expect(entityValidator(ContractorBill).safeParse(data).success).toBe(true);
  });
});

describe('changedFields', () => {
  it('lists only the fields whose value changed, treating blank and missing alike', () => {
    expect(changedFields(ContractorBill, { billNo: 'A', thisBill: 5, note: '' }, { billNo: 'A', thisBill: 6 })).toEqual([{ field: 'thisBill', from: 5, to: 6 }]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @onehuman/backend test -- samples`
Expected: FAIL. `changedFields`, `sampleRecord` and `seedOrder` are not exported.

- [ ] **Step 3: Change `RecordsService`**

In `master-ai-backend/src/records/records.service.ts`:

**Imports:**
- add `HumanRole` and `EntityDef` (if not already) to the `@onehuman/schemas` type import;
- add `titleOf` to the `@onehuman/agent-kit` import.

**New types:** add these exports above the class:

```ts
export type RecordSourceKind = 'manual' | 'call' | 'agent' | 'sample';

/** How an item comes in. An owner or admin who adds it has checked it. */
export interface RecordSource {
  kind: RecordSourceKind;
  /** The call or tool call that added it. */
  ref?: string | null;
  checkedBy?: string | null;
}

/** Who changes an item and how. An owner or admin who changes it has checked it; anyone else's change clears the check. */
export interface RecordChange {
  actor: Actor;
  via: 'manual' | 'call' | 'agent' | 'system';
  ref?: string | null;
  note?: string | null;
  checkedBy?: string | null;
}
```

**`create`:** replace it with:

```ts
  async create(
    tx: Tx,
    tenantId: string,
    ws: { id: string; pack: ResolvedPack },
    entityName: string,
    data: Record<string, unknown>,
    actor: Actor,
    source: RecordSource = { kind: 'manual' },
  ) {
    const entity = this.entityOf(ws.pack, entityName);
    const clean = this.validate(entity, data);
    const [row] = await tx
      .insert(records)
      .values({
        tenantId,
        workspaceId: ws.id,
        entity: entity.name,
        data: clean,
        createdBy: actor.id,
        source: source.kind,
        sourceRef: source.ref ?? null,
        ...(source.checkedBy && { checkedBy: source.checkedBy, checkedAt: new Date() }),
      })
      .returning();
    await this.audit.append(tx, tenantId, {
      type: 'record.created',
      actor,
      refId: row!.id,
      payload: { entity: entity.name, label: entity.label, title: titleOf(entity, clean), source: source.kind },
    });
    return row!;
  }
```

**`update`:** replace it with:

```ts
  async update(
    tx: Tx,
    tenantId: string,
    ws: { id: string; pack: ResolvedPack },
    entityName: string,
    id: string,
    patch: Record<string, unknown>,
    change: RecordChange,
  ) {
    const entity = this.entityOf(ws.pack, entityName);
    const [current] = await tx
      .select()
      .from(records)
      .where(and(eq(records.id, id), eq(records.workspaceId, ws.id), eq(records.entity, entity.name)))
      .for('update');
    if (!current) throw new NotFoundException(`${entity.label} not found`);
    const merged = this.validate(entity, { ...current.data, ...patch });
    const changes = changedFields(entity, current.data, merged);
    if (changes.length === 0) return current;
    const [row] = await tx
      .update(records)
      .set({
        data: merged,
        updatedAt: new Date(),
        updatedBy: change.actor.kind === 'human' ? change.actor.id : null,
        updatedVia: change.via,
        updatedRef: change.ref ?? null,
        checkedBy: change.checkedBy ?? null,
        checkedAt: change.checkedBy ? new Date() : null,
        checkNote: null,
        checkedProblems: [],
      })
      .where(eq(records.id, id))
      .returning();
    await this.audit.append(tx, tenantId, {
      type: 'record.updated',
      actor: change.actor,
      refId: id,
      payload: { entity: entity.name, label: entity.label, title: titleOf(entity, merged), changes, via: change.via, ...(change.note && { note: change.note }) },
    });
    return row!;
  }
```

**`createFromApi`:** replace it with:

```ts
  async createFromApi(tenantId: string, principalId: string, role: HumanRole, entityName: string, data: Record<string, unknown>): Promise<PackRecord> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.activeWorkspace(tx);
      const manager = role === 'owner' || role === 'admin';
      const row = await this.create(tx, tenantId, ws, entityName, data, { id: principalId, kind: 'human' }, { kind: 'manual', checkedBy: manager ? principalId : null });
      return toRecord(row);
    });
  }
```

**`seedSamples`:** replace it with:

```ts
  /** A few realistic items per record type so a new company can try things straight away. References point at sample items. */
  async seedSamples(tx: Tx, tenantId: string, ws: { id: string; pack: ResolvedPack }, actor: Actor) {
    const made = new Map<string, string[]>();
    for (const entity of seedOrder(ws.pack.entities)) {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const ref = (name: string) => made.get(name)?.[i % 3];
        const row = await this.create(tx, tenantId, ws, entity.name, sampleRecord(entity, i, ref), actor, { kind: 'sample' });
        ids.push(row.id);
      }
      made.set(entity.name, ids);
    }
  }
```

**Module-level helpers:** add these below `toRecord`:

```ts
/** Fields whose value differs, with the old and new values (null for none). Blank and missing count as the same. */
export function changedFields(entity: EntityDef, before: Record<string, unknown>, after: Record<string, unknown>) {
  const norm = (v: unknown) => JSON.stringify(v === undefined || v === '' ? null : v);
  return entity.fields
    .filter((f) => norm(before[f.name]) !== norm(after[f.name]))
    .map((f) => ({ field: f.name, from: before[f.name] ?? null, to: after[f.name] ?? null }));
}

/** Record types in an order where each comes after the ones its references point at (a cycle is broken anywhere). */
export function seedOrder(entities: EntityDef[]): EntityDef[] {
  const names = new Set(entities.map((e) => e.name));
  const done = new Set<string>();
  const out: EntityDef[] = [];
  let left = [...entities];
  while (left.length) {
    const ready = left.filter((e) =>
      e.fields.every((f) => f.type !== 'reference' || !f.ref || f.ref === e.name || !names.has(f.ref) || done.has(f.ref)),
    );
    for (const e of ready.length ? ready : [left[0]!]) {
      out.push(e);
      done.add(e.name);
    }
    left = left.filter((e) => !done.has(e.name));
  }
  return out;
}
```

**`sampleRecord`:**
- Change its signature to `export function sampleRecord(entity: EntityDef, i: number, ref: (entityName: string) => string | undefined = () => undefined): Record<string, unknown>`.
- Add a `case` before `default:` in its `switch (f.type)`:

```ts
      case 'reference':
        out[f.name] = (f.ref && ref(f.ref)) ?? null;
        break;
```

- [ ] **Step 4: Pass the role, and say when an agent did it**

In `master-ai-backend/src/records/records.controller.ts`, change the create call to `return this.records.createFromApi(s.tenantId, s.principalId, s.role, entity, body.data);`.

In `master-ai-backend/src/connectors/connectors.service.ts`, replace the `records.create` and `records.update` cases with:

```ts
      case 'records.create': {
        const row = await this.records.create(tx, tenantId, workspace, String(args.entity), args.data as Record<string, unknown>, ctx.actor, {
          kind: 'agent',
          ref: UUID.test(ctx.toolCallId) ? ctx.toolCallId : null,
        });
        return { created: true, id: row.id, entity: row.entity, data: row.data };
      }
      case 'records.update': {
        const row = await this.records.update(tx, tenantId, workspace, String(args.entity), String(args.id), (args.patch ?? {}) as Record<string, unknown>, {
          actor: ctx.actor,
          via: 'agent',
          ref: UUID.test(ctx.toolCallId) ? ctx.toolCallId : null,
        });
        return { updated: true, id: row.id, entity: row.entity, data: row.data };
      }
```

Add this near the top of the file:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

- [ ] **Step 5: Run the unit test**

Run: `pnpm --filter @onehuman/backend test -- samples`
Expected: PASS.

- [ ] **Step 6: Write the integration tests for each way in**

Append to `master-ai-backend/__tests__/integration/record-sources.spec.ts`. Add imports `randomUUID` from `node:crypto`, `eq` from `drizzle-orm`, `resolveTool` from `@onehuman/agent-kit`, and the backend's `DbService`, `records`, `auditEvents`, `ConnectorsService` and `RecordsService`:

```ts
describe('how each item came in', () => {
  const rows = (tenantId: string) => h.get(DbService).tenant(tenantId, (tx) => tx.select().from(records));

  it('marks seeded items as samples, not checked, with references pointing at sample items', async () => {
    const all = await rows(a.tenantId);
    expect(new Set(all.map((r) => r.source))).toEqual(new Set(['sample']));
    expect(all.every((r) => r.checkedAt === null)).toBe(true);
    const bill = all.find((r) => r.entity === 'Bill')!;
    expect(all.some((r) => r.entity === 'Party' && r.id === bill.data.party)).toBe(true);
  });

  it("checks the owner's own items, not a member's", async () => {
    const svc = h.get(RecordsService);
    const mine = await svc.createFromApi(a.tenantId, a.session.principalId, 'owner', 'Party', { name: 'Owner Traders', partyType: 'retailer' });
    const theirs = await svc.createFromApi(a.tenantId, a.session.principalId, 'member', 'Party', { name: 'Member Traders', partyType: 'retailer' });
    const all = await rows(a.tenantId);
    expect(all.find((r) => r.id === mine.id)).toMatchObject({ source: 'manual', createdBy: a.session.principalId, checkedBy: a.session.principalId });
    expect(all.find((r) => r.id === theirs.id)).toMatchObject({ source: 'manual', checkedBy: null, checkedAt: null });
  });

  it("says an AI agent added or changed an item; an agent's change clears the check and is audited with the old and new values", async () => {
    const db = h.get(DbService);
    const connectors = h.get(ConnectorsService);
    const toolCallId = randomUUID();
    const owner = await h.get(RecordsService).createFromApi(a.tenantId, a.session.principalId, 'owner', 'Party', { name: 'Checked Traders', partyType: 'retailer', city: 'Kochi' });
    const result = await db.tenant(a.tenantId, async (tx) => {
      const ws = await h.get(RecordsService).activeWorkspace(tx);
      const ctx = { tx, tenantId: a.tenantId, workspace: ws, toolCallId, actor: { id: null, kind: 'agent' as const } };
      const created = (await connectors.execute(ctx, resolveTool(ws.pack, 'records.create')!, { entity: 'Party', data: { name: 'Agent Traders', partyType: 'retailer' } })) as { id: string };
      await connectors.execute(ctx, resolveTool(ws.pack, 'records.update')!, { entity: 'Party', id: owner.id, patch: { city: 'Pune' } });
      return created;
    });
    const all = await rows(a.tenantId);
    expect(all.find((r) => r.id === result.id)).toMatchObject({ source: 'agent', sourceRef: toolCallId, checkedAt: null });
    expect(all.find((r) => r.id === owner.id)).toMatchObject({ updatedVia: 'agent', updatedRef: toolCallId, checkedBy: null, checkedAt: null });
    const [event] = await db.tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.refId, owner.id)).then((e) => e.filter((x) => x.type === 'record.updated')));
    expect(event!.payload).toMatchObject({ entity: 'Party', title: 'Checked Traders', via: 'agent', changes: [{ field: 'city', from: 'Kochi', to: 'Pune' }] });
  });

  it('records nothing when an update changes nothing', async () => {
    const db = h.get(DbService);
    const owner = await h.get(RecordsService).createFromApi(a.tenantId, a.session.principalId, 'owner', 'Party', { name: 'Same Traders', partyType: 'retailer' });
    await db.tenant(a.tenantId, async (tx) => {
      const ws = await h.get(RecordsService).activeWorkspace(tx);
      await h.get(RecordsService).update(tx, a.tenantId, ws, 'Party', owner.id, { name: 'Same Traders' }, { actor: { id: null, kind: 'agent' }, via: 'agent' });
    });
    const events = await db.tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.refId, owner.id)));
    expect(events.map((e) => e.type)).toEqual(['record.created']);
    expect((await rows(a.tenantId)).find((r) => r.id === owner.id)!.checkedBy).toBe(a.session.principalId);
  });
});
```

- [ ] **Step 7: Run them**

Run: `pnpm test:integration -- record-sources`
Expected: PASS.

Run: `pnpm --filter @onehuman/backend typecheck && pnpm --filter @onehuman/backend test`
Expected: PASS. Any other caller of `RecordsService.update` or `createFromApi` would now fail typecheck; `grep -rn "records.update\|createFromApi" master-ai-backend/src` should show only the two callers changed here.

- [ ] **Step 8: Commit**

```bash
git add master-ai-backend/src/records master-ai-backend/src/connectors/connectors.service.ts master-ai-backend/__tests__/unit/records master-ai-backend/__tests__/integration/record-sources.spec.ts
git commit -m "feat(records): every item says how it came in; edits are audited and clear or set the check

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Reading a list's query, wording its problems, writing CSV

**Files:**
- Create: `master-ai-backend/src/lists/query.ts`, `master-ai-backend/src/lists/format.ts`, `master-ai-backend/src/lists/csv.ts`
- Test: `master-ai-backend/__tests__/unit/lists/query.test.ts`, `…/format.test.ts`, `…/csv.test.ts` (create)

**Interfaces:**
- Consumes: `ResolvedRegister`, `ListCheck`, `registersOf` and `pluralize` (agent-kit).
- Produces:

  ```ts
  // query.ts
  export const PAGE_SIZE = 50;
  export const RANGES: readonly ['today', 'this_week', 'this_month', 'last_month', 'all'];
  export type RangeName = (typeof RANGES)[number];
  export interface ParsedListQuery { dates: { from: string; to: string } | null; q: string | null; filters: { field: EntityField; value: string }[];
    source: 'manual' | 'call' | 'agent' | 'sample' | null; show: 'problems' | 'not_checked' | 'checked' | null; sort: { field: EntityField | null; dir: 'asc' | 'desc' }; page: number }
  export function rangeDays(range: RangeName, today: string): { from: string; to: string } | null;
  export function parseListQuery(raw: Record<string, unknown>, reg: ResolvedRegister, today: string): ParsedListQuery; // throws BadRequestException
  // format.ts
  export function isUuid(v: unknown): v is string;
  export function asNumber(v: unknown): number | null;
  export function dayOf(v: unknown): string | null;        // India-time calendar day
  export function dayText(day: string): string;            // "14 Oct 2026"
  export function istStamp(v: unknown): string | null;     // "2026-10-14 15:30"
  export function shown(field: EntityField, v: unknown, titles?: Map<string, string>): string;
  export function problemMessage(check: ListCheck, data: Record<string, unknown>, today: string, entity: EntityDef): string;
  export function csvValue(field: Pick<EntityField, 'type'>, v: unknown, title?: string): string;
  // csv.ts
  export function csvCell(v: string): string;
  export function toCsv(rows: string[][]): string;
  ```

- [ ] **Step 1: Write the failing tests**

Create `master-ai-backend/__tests__/unit/lists/query.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityDef } from '@onehuman/schemas';
import { registersOf } from '@onehuman/agent-kit';
import { parseListQuery, rangeDays } from '../../../src/lists/query';

const Bill: EntityDef = {
  name: 'Bill', label: 'Bill',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'billType', label: 'Type', type: 'enum', required: true, options: ['sales invoice', 'credit note'] },
    { name: 'paid', label: 'Paid', type: 'boolean', required: false },
    { name: 'billDate', label: 'Bill date', type: 'date', required: false },
    { name: 'total', label: 'Total', type: 'money', required: false },
  ],
};
const Party: EntityDef = { name: 'Party', label: 'Party', fields: [{ name: 'name', label: 'Name', type: 'string', required: true }] };
const [bills, party] = registersOf({ entities: [Bill, Party], registers: [{ id: 'bills', entity: 'Bill', main: true, date_field: 'billDate', checks: [] }] });

describe('rangeDays (India calendar days)', () => {
  it.each([
    ['today', { from: '2026-10-14', to: '2026-10-14' }],
    ['this_week', { from: '2026-10-12', to: '2026-10-18' }],
    ['this_month', { from: '2026-10-01', to: '2026-10-31' }],
    ['last_month', { from: '2026-09-01', to: '2026-09-30' }],
    ['all', null],
  ] as const)('%s around Wednesday 14 Oct 2026', (range, want) => {
    expect(rangeDays(range, '2026-10-14')).toEqual(want);
  });

  it('crosses a year, and starts a week on Monday even on a Sunday', () => {
    expect(rangeDays('last_month', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(rangeDays('this_week', '2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });
});

describe('parseListQuery', () => {
  it('opens a dated list on this month, and a list without a date on everything', () => {
    expect(parseListQuery({}, bills!, '2026-10-14').dates).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(parseListQuery({ range: 'this_month' }, party!, '2026-10-14').dates).toBeNull();
  });

  it('takes a custom range of two days', () => {
    expect(parseListQuery({ from: '2026-09-01', to: '2026-09-15' }, bills!, '2026-10-14').dates).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(() => parseListQuery({ from: '2026-09-15', to: '2026-09-01' }, bills!, '2026-10-14')).toThrow(/YYYY-MM-DD/);
    expect(() => parseListQuery({ from: '2026-09-15' }, bills!, '2026-10-14')).toThrow(/YYYY-MM-DD/);
  });

  it("takes only this list's filters and their choices", () => {
    const q = parseListQuery({ 'f.billType': 'credit note', 'f.paid': 'true', range: 'all' }, bills!, '2026-10-14');
    expect(q.filters.map((f) => [f.field.name, f.value])).toEqual([['billType', 'credit note'], ['paid', 'true']]);
    expect(() => parseListQuery({ 'f.total': '5' }, bills!, '2026-10-14')).toThrow(/not a filter/);
    expect(() => parseListQuery({ 'f.billType': 'refund' }, bills!, '2026-10-14')).toThrow(/not a choice/);
    expect(() => parseListQuery({ 'f.paid': 'maybe' }, bills!, '2026-10-14')).toThrow(/true or false/);
  });

  it('reads sort, page, search, source and show, refusing anything else', () => {
    const q = parseListQuery({ sort: 'total:asc', page: '3', q: '  S-10  ', source: 'agent', show: 'problems' }, bills!, '2026-10-14');
    expect(q).toMatchObject({ page: 3, q: 'S-10', source: 'agent', show: 'problems' });
    expect([q.sort.field?.name, q.sort.dir]).toEqual(['total', 'asc']);
    expect(parseListQuery({ page: 'x' }, bills!, '2026-10-14').page).toBe(1);
    expect(() => parseListQuery({ sort: 'nope:asc' }, bills!, '2026-10-14')).toThrow(/sort/);
    expect(() => parseListQuery({ source: 'email' }, bills!, '2026-10-14')).toThrow(/source/);
    expect(() => parseListQuery({ show: 'everything' }, bills!, '2026-10-14')).toThrow(/show/);
    expect(() => parseListQuery({ range: 'forever' }, bills!, '2026-10-14')).toThrow(/range/);
  });
});
```

Create `master-ai-backend/__tests__/unit/lists/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityDef } from '@onehuman/schemas';
import { registersOf } from '@onehuman/agent-kit';
import { csvValue, dayOf, istStamp, problemMessage, shown } from '../../../src/lists/format';

const Party: EntityDef = { name: 'Party', label: 'Party', plural_label: 'Parties', title_field: 'name', fields: [{ name: 'name', label: 'Name', type: 'string', required: true }] };
const f = (name: string, label: string, type: EntityDef['fields'][number]['type'], extra = {}) => ({ name, label, type, required: false, ...extra });
const Thing: EntityDef = {
  name: 'Thing', label: 'Thing',
  fields: [
    f('billNo', 'Bill no.', 'string'), f('party', 'Party', 'reference', { ref: 'Party' }), f('consent', 'Consent', 'boolean'),
    f('taxableValue', 'Taxable value', 'money'), f('gstAmount', 'GST amount', 'money'), f('discount', 'Discount', 'money'), f('total', 'Total', 'money'),
    f('stock', 'Stock in hand', 'integer'), f('reorderLevel', 'Reorder level', 'integer'), f('amount', 'Amount', 'money'),
    f('adminSpent', 'Admin spent', 'money'), f('receivedToDate', 'Received to date', 'money'),
    f('startDate', 'Start date', 'date'), f('endDate', 'End date', 'date'), f('dueDate', 'Due date', 'date'), f('validTill', 'Valid till', 'date'),
  ],
};
const reg = registersOf({
  entities: [Thing, Party],
  registers: [{
    id: 'things', entity: 'Thing', main: true,
    checks: [
      { missing: ['party', 'consent'] },
      { adds_up: { field: 'total', plus: ['taxableValue', 'gstAmount'], minus: ['discount'], tolerance: 1 } },
      { limit: { fields: ['stock'], min: 'reorderLevel', factor: 1 } },
      { limit: { fields: ['amount'], max: 2000, factor: 1 }, why: 'no 80G above ₹2,000 in cash' },
      { limit: { fields: ['adminSpent'], max: 'receivedToDate', factor: 0.2 } },
      { limit: { fields: ['endDate'], min: 'startDate', factor: 1 } },
      { duplicate: ['billNo', 'party'] },
      { overdue: { date: 'dueDate', grace_days: 0 } },
      { expiring: { date: 'validTill', days: 30 } },
    ],
  }],
})[0]!;
const msg = (key: string, data: Record<string, unknown>) => problemMessage(reg.checks.find((c) => c.key === key)!, data, '2026-10-14', Thing);

describe('problemMessage', () => {
  it.each([
    ['missing:party', {}, 'Party is missing'],
    ['missing:consent', {}, 'Consent is not ticked'],
    ['adds_up:total', { total: 48260, taxableValue: 40840, gstAmount: 7360 }, "Total ₹48,260 doesn't equal Taxable value + GST amount − Discount (₹48,200)"],
    ['limit:stock>=reorderLevel', { stock: 4, reorderLevel: 10 }, 'Stock in hand 4 is less than Reorder level (10)'],
    ['limit:amount<=2000', { amount: 5000 }, 'Amount ₹5,000 is more than ₹2,000 (no 80G above ₹2,000 in cash)'],
    ['limit:adminSpent<=receivedToDate', { adminSpent: 300000, receivedToDate: 1000000 }, 'Admin spent ₹3,00,000 is more than 20% of Received to date (₹2,00,000)'],
    ['limit:endDate>=startDate', { endDate: '2026-10-01', startDate: '2026-10-05' }, 'End date 1 Oct 2026 is before Start date (5 Oct 2026)'],
    ['duplicate:billNo,party', {}, 'Same Bill no., Party as another thing'],
    ['overdue:dueDate', { dueDate: '2026-10-11' }, 'Due date was 11 Oct 2026, 3 days ago'],
    ['overdue:dueDate', { dueDate: '2026-10-14' }, 'Due date was 14 Oct 2026, today'],
    ['expiring:validTill', { validTill: '2026-10-26' }, 'Valid till is in 12 days (26 Oct 2026)'],
    ['expiring:validTill', { validTill: '2026-10-14' }, 'Valid till is today'],
    ['expiring:validTill', { validTill: '2026-10-02' }, 'Valid till passed on 2 Oct 2026, 12 days ago'],
    ['ref:party', { party: 'Ganesh traders' }, `Party "Ganesh traders" isn't in your parties`],
    ['ref:party', { party: '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11' }, 'Party points to a party that was removed'],
  ])('%s with %j', (key, data, want) => {
    expect(msg(key, data)).toBe(want);
  });
});

describe('values in words and in CSV', () => {
  it('reads the India-time day of a date-time, and nothing from what is not a date', () => {
    expect(dayOf('2026-10-14T20:00:00Z')).toBe('2026-10-15');
    expect(dayOf('2026-10-14')).toBe('2026-10-14');
    expect(dayOf('2026-13-45')).toBeNull();
    expect(dayOf('soon')).toBeNull();
    expect(istStamp('2026-10-14T20:00:00Z')).toBe('2026-10-15 01:30');
  });

  it('shows a reference by its title, and never an id', () => {
    const party = Thing.fields.find((x) => x.name === 'party')!;
    expect(shown(party, 'p1', new Map([['p1', 'Sri Ganesh Traders']]))).toBe('Sri Ganesh Traders');
    expect(shown(party, '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11', new Map())).toBe('a removed item');
    expect(shown(Thing.fields.find((x) => x.name === 'total')!, 48260)).toBe('₹48,260');
    expect(shown(Thing.fields.find((x) => x.name === 'total')!, null)).toBe('—');
  });

  it('writes plain values for a spreadsheet', () => {
    expect(csvValue({ type: 'money' }, 48260)).toBe('48260');
    expect(csvValue({ type: 'date' }, '2026-10-14')).toBe('2026-10-14');
    expect(csvValue({ type: 'datetime' }, '2026-10-14T20:00:00Z')).toBe('2026-10-15 01:30');
    expect(csvValue({ type: 'boolean' }, false)).toBe('No');
    expect(csvValue({ type: 'reference' }, 'p1', 'Sri Ganesh Traders')).toBe('Sri Ganesh Traders');
    expect(csvValue({ type: 'reference' }, '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11')).toBe('');
    expect(csvValue({ type: 'string' }, null)).toBe('');
  });
});
```

Create `master-ai-backend/__tests__/unit/lists/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../../src/lists/csv';

describe('CSV for Excel', () => {
  it('starts with a byte order mark and ends lines with CRLF', () => {
    expect(toCsv([['Name', 'Total'], ['Sri Ganesh, Kochi', '48260']])).toBe('﻿Name,Total\r\n"Sri Ganesh, Kochi",48260\r\n');
  });

  it('keeps a cell from becoming a formula when the file is opened', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+91 98470 12345')).toBe("'+91 98470 12345");
    expect(csvCell('-500')).toBe("'-500");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('plain')).toBe('plain');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @onehuman/backend test -- lists`
Expected: FAIL. `../../../src/lists/query` and the other two modules can't be found.

- [ ] **Step 3: Write `query.ts`**

Create `master-ai-backend/src/lists/query.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import type { EntityField } from '@onehuman/schemas';
import type { ResolvedRegister } from '@onehuman/agent-kit';

export const PAGE_SIZE = 50;
export const RANGES = ['today', 'this_week', 'this_month', 'last_month', 'all'] as const;
export type RangeName = (typeof RANGES)[number];
const SOURCES = ['manual', 'call', 'agent', 'sample'] as const;
const SHOW = ['problems', 'not_checked', 'checked'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ParsedListQuery {
  /** Inclusive India-time calendar days; null means no date limit. */
  dates: { from: string; to: string } | null;
  q: string | null;
  filters: { field: EntityField; value: string }[];
  source: (typeof SOURCES)[number] | null;
  show: (typeof SHOW)[number] | null;
  sort: { field: EntityField | null; dir: 'asc' | 'desc' };
  page: number;
}

/** The first and last day of a named range around `today` (YYYY-MM-DD, India time). Weeks start on Monday. */
export function rangeDays(range: RangeName, today: string): { from: string; to: string } | null {
  const d = new Date(`${today}T00:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case 'this_week': {
      const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
      return { from: iso(monday), to: iso(new Date(monday.getTime() + 6 * 86_400_000)) };
    }
    case 'this_month':
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
    case 'last_month':
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case 'all':
      return null;
  }
}

/**
 * Reads a list page's query string. Only this list's own fields and the known
 * options get through; everything else is refused, so nothing unchecked reaches SQL.
 */
export function parseListQuery(raw: Record<string, unknown>, reg: ResolvedRegister, today: string): ParsedListQuery {
  const one = (k: string) => {
    const v = raw[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const bad = (message: string) => new BadRequestException(message);

  let dates: ParsedListQuery['dates'];
  const from = one('from');
  const to = one('to');
  if (from || to) {
    if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) throw bad('Give both dates as YYYY-MM-DD, the first on or before the second.');
    dates = { from, to };
  } else {
    const range = one('range') ?? (reg.dateField ? 'this_month' : 'all');
    if (!(RANGES as readonly string[]).includes(range)) throw bad(`Unknown range "${range}".`);
    dates = rangeDays(range as RangeName, today);
  }
  if (!reg.dateField) dates = null;

  const filters: ParsedListQuery['filters'] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('f.')) continue;
    const field = reg.filters.find((f) => f.name === key.slice(2));
    if (!field) throw bad(`"${key.slice(2)}" is not a filter of this list.`);
    if (typeof value !== 'string' || value === '') continue;
    if (field.type === 'enum' && !field.options?.includes(value)) throw bad(`"${value}" is not a choice for ${field.label}.`);
    if (field.type === 'boolean' && value !== 'true' && value !== 'false') throw bad(`${field.label} is true or false.`);
    filters.push({ field, value });
  }

  const source = one('source');
  if (source && !(SOURCES as readonly string[]).includes(source)) throw bad(`Unknown source "${source}".`);
  const show = one('show');
  if (show && !(SHOW as readonly string[]).includes(show)) throw bad(`Unknown show "${show}".`);

  let sort = reg.sort;
  const s = one('sort');
  if (s) {
    const [name, dir = 'asc'] = s.split(':');
    const field = reg.entity.fields.find((f) => f.name === name);
    if (!field || (dir !== 'asc' && dir !== 'desc')) throw bad(`Can't sort by "${s}".`);
    sort = { field, dir };
  }

  return {
    dates,
    q: one('q')?.slice(0, 200) ?? null,
    filters,
    source: (source as ParsedListQuery['source']) ?? null,
    show: (show as ParsedListQuery['show']) ?? null,
    sort,
    page: Math.max(1, Number.parseInt(one('page') ?? '1', 10) || 1),
  };
}
```

- [ ] **Step 4: Write `format.ts`**

Create `master-ai-backend/src/lists/format.ts`:

```ts
import type { EntityDef, EntityField } from '@onehuman/schemas';
import { pluralize, type ListCheck } from '@onehuman/agent-kit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** The India-time calendar day of a date or date-time, or null when the value isn't one. */
export function dayOf(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  if (v.length === 10) return Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? null : v;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : new Date(at + IST_MS).toISOString().slice(0, 10);
}

/** "14 Oct 2026" */
export function dayText(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "2026-10-14 15:30", India time, or null when the value isn't a date-time. */
export function istStamp(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : new Date(at + IST_MS).toISOString().slice(0, 16).replace('T', ' ');
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const sumOf = (fields: EntityField[], data: Record<string, unknown>) => fields.reduce((n, f) => n + (asNumber(data[f.name]) ?? 0), 0);

/** A value the way a sentence shows it: rupees, a day in words, Yes / No, a reference by its title (never an id). */
export function shown(field: EntityField, v: unknown, titles?: Map<string, string>): string {
  if (v === undefined || v === null || v === '') return '—';
  switch (field.type) {
    case 'money': {
      const n = asNumber(v);
      return n === null ? String(v) : inr.format(n);
    }
    case 'number':
    case 'integer': {
      const n = asNumber(v);
      return n === null ? String(v) : plain.format(n);
    }
    case 'date':
    case 'datetime': {
      const d = dayOf(v);
      return d ? dayText(d) : String(v);
    }
    case 'boolean':
      return v === true ? 'Yes' : v === false ? 'No' : String(v);
    case 'reference':
      return typeof v === 'string' ? (titles?.get(v) ?? (isUuid(v) ? 'a removed item' : v)) : String(v);
    default:
      return String(v);
  }
}

/** The sentence for one problem on one item, e.g. "Total ₹48,260 doesn't equal Taxable value + GST amount (₹48,200)". */
export function problemMessage(check: ListCheck, data: Record<string, unknown>, today: string, entity: EntityDef): string {
  const why = check.why ? ` (${check.why})` : '';
  switch (check.kind) {
    case 'missing':
      return `${check.field.label} ${check.field.type === 'boolean' ? 'is not ticked' : 'is missing'}${why}`;
    case 'adds_up': {
      const expected = sumOf(check.plus, data) - sumOf(check.minus, data);
      const expr = [check.plus.map((f) => f.label).join(' + '), ...check.minus.map((f) => `− ${f.label}`)].filter(Boolean).join(' ');
      return `${check.field.label} ${shown(check.field, data[check.field.name])} doesn't equal ${expr} (${shown(check.field, expected)})${why}`;
    }
    case 'limit': {
      const first = check.fields[0]!;
      const above = check.max !== undefined;
      const bound = (above ? check.max : check.min)!;
      const label = check.fields.map((f) => f.label).join(' + ');
      if (first.type === 'date' && typeof bound !== 'number') {
        return `${label} ${shown(first, data[first.name])} is ${above ? 'after' : 'before'} ${bound.label} (${shown(bound, data[bound.name])})${why}`;
      }
      const limit =
        typeof bound === 'number'
          ? shown(first, bound)
          : `${check.factor !== 1 ? `${Math.round(check.factor * 100)}% of ` : ''}${bound.label} (${shown(first, (asNumber(data[bound.name]) ?? 0) * check.factor)})`;
      return `${label} ${shown(first, sumOf(check.fields, data))} is ${above ? 'more' : 'less'} than ${limit}${why}`;
    }
    case 'duplicate':
      return `Same ${check.fields.map((f) => f.label).join(', ')} as another ${entity.label.toLowerCase()}${why}`;
    case 'overdue': {
      const day = dayOf(data[check.field.name]) ?? today;
      const n = daysBetween(day, today);
      return `${check.field.label} was ${dayText(day)}, ${n === 0 ? 'today' : `${days(n)} ago`}${why}`;
    }
    case 'expiring': {
      const day = dayOf(data[check.field.name]) ?? today;
      const n = daysBetween(today, day);
      if (n > 0) return `${check.field.label} is in ${days(n)} (${dayText(day)})${why}`;
      if (n === 0) return `${check.field.label} is today${why}`;
      return `${check.field.label} passed on ${dayText(day)}, ${days(-n)} ago${why}`;
    }
    case 'ref': {
      const v = data[check.field.name];
      const target = check.target.label.toLowerCase();
      if (isUuid(v)) return `${check.field.label} points to a ${target} that was removed`;
      return `${check.field.label} "${String(v)}" isn't in your ${(check.target.plural_label ?? pluralize(check.target.label)).toLowerCase()}`;
    }
  }
}

/** A value as a spreadsheet cell: plain numbers, ISO days, India-time date-times, a reference's title. */
export function csvValue(field: Pick<EntityField, 'type'>, v: unknown, title?: string): string {
  if (v === undefined || v === null || v === '') return '';
  switch (field.type) {
    case 'reference':
      return title ?? (isUuid(v) ? '' : String(v));
    case 'money':
    case 'number':
    case 'integer':
      return asNumber(v)?.toString() ?? String(v);
    case 'date':
      return dayOf(v) ?? String(v);
    case 'datetime':
      return istStamp(v) ?? String(v);
    case 'boolean':
      return v === true ? 'Yes' : v === false ? 'No' : String(v);
    default:
      return String(v);
  }
}
```

- [ ] **Step 5: Write `csv.ts`**

Create `master-ai-backend/src/lists/csv.ts`:

```ts
/** Cells a spreadsheet would run as a formula start with one of these; a leading ' keeps them as text. */
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v: string): string {
  const safe = FORMULA.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV that Excel opens as UTF-8 (₹ and Indian names intact): a byte order mark, then CRLF lines. */
export function toCsv(rows: string[][]): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @onehuman/backend test -- lists`
Expected: PASS (query, format and csv).

Run: `pnpm --filter @onehuman/backend typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add master-ai-backend/src/lists master-ai-backend/__tests__/unit/lists
git commit -m "feat(lists): read a list's query, word each problem, write CSV safely

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The list engine: checks in SQL, cards, pages, items and CSV

**Files:**
- Create: `packages/schemas/src/lists.ts` (the API types); modify `packages/schemas/src/index.ts` (`export * from './lists';`)
- Create: `master-ai-backend/src/lists/sql.ts`, `master-ai-backend/src/lists/lists.service.ts`, `master-ai-backend/src/lists/lists.controller.ts`
- Modify: `master-ai-backend/src/common/auth.ts` (`export const MANAGERS_ONLY`)
- Modify: `master-ai-backend/src/app.module.ts` (add `ListsController` to `controllers` and `ListsService` to `providers`, under "Data and connectors")
- Test: `master-ai-backend/__tests__/integration/lists.spec.ts` (create)

**Interfaces:**
- Consumes:
  - `registersOf`, `normalizeSnapshot`, `titleOf` and `ResolvedRegister` (agent-kit);
  - `parseListQuery`, `rangeDays`, `PAGE_SIZE`, `problemMessage`, `shown`, `csvValue`, `istStamp`, `isUuid` and `toCsv` (Task 7);
  - `RecordsService.activeWorkspace` (existing);
  - the Task 5 columns.
- Produces (`@onehuman/schemas`): `ListMeta`, `ListCard`, `ListSummary`, `ListsOverview`, `ListProblem`, `ItemSource`, `ListItem`, `ListPage`, `ListHistoryEntry`, `ListItemDetail`, `ListQueryParams`, `ListRange`, `ListShow` and `ItemSourceKind` (code in Step 3).
- Produces (`ListsService`):

  ```ts
  overview(tenantId): Promise<ListsOverview>
  page(tenantId, listId, raw: Record<string, unknown>): Promise<ListPage>
  item(tenantId, listId, itemId): Promise<ListItemDetail>
  exportCsv(tenantId, listId, raw): Promise<string>
  ```

  The private helpers `workspace`, `register`, `clock`, `one` and `decorate` are reused by Task 9.
- Produces (endpoints, class-level `@ManagersOnly()`): `GET /lists`, `GET /lists/:id`, `GET /lists/:id/export` (`text/csv`) and `GET /lists/:id/items/:itemId`.

**Departure from the spec:** spec §9 asks for unit tests of the compiler's SQL for each check kind. Instead, `lists.spec.ts` runs every kind against real rows on Postgres. That tests what the checks find, not the SQL text, which would break on every harmless rewrite.

- [ ] **Step 1: Write the failing integration spec**

Create `master-ai-backend/__tests__/integration/lists.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MANAGERS_ONLY } from '../../src/common/auth';
import { DbService } from '../../src/db/db.service';
import { ListsController } from '../../src/lists/lists.controller';
import { ListsService } from '../../src/lists/lists.service';
import { rangeDays } from '../../src/lists/query';
import { RecordsService } from '../../src/records/records.service';
import { istDate } from '../../src/voice/time';
import { boot, newOrg, type Harness, type Org } from './harness';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
let h: Harness;
let a: Org;
let lists: ListsService;
let partyId: string;
const today = istDate();
const day = (offset: number) => istDate(new Date(Date.now() + offset * 86_400_000));

beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
  lists = h.get(ListsService);
  partyId = (await lists.page(a.tenantId, 'parties', { range: 'all' })).items[0]!.id;
});
afterAll(() => h.close());

/** Adds an item the way an AI agent would, so nobody has checked it. */
async function add(entity: string, data: Record<string, unknown>): Promise<string> {
  return h.get(DbService).tenant(a.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    const ws = await svc.activeWorkspace(tx);
    return (await svc.create(tx, a.tenantId, ws, entity, data, { id: null, kind: 'agent' }, { kind: 'agent' })).id;
  });
}
const problems = async (list: string, id: string) => (await lists.item(a.tenantId, list, id)).item.problems;
const keys = async (list: string, id: string) => (await problems(list, id)).map((p) => p.key);
const bill = (billNo: string, extra: Record<string, unknown> = {}) => ({ billNo, billType: 'sales invoice', party: partyId, billDate: today, total: 100, ...extra });

describe('who sees lists', () => {
  it('is the owner and admins only', () => {
    expect(Reflect.getMetadata(MANAGERS_ONLY, ListsController)).toBe(true);
  });
});

describe('the Lists page', () => {
  it("shows the organization type's main lists as cards, with what each card counts", async () => {
    const o = await lists.overview(a.tenantId);
    expect(o.lists.filter((l) => l.main).map((l) => l.id)).toEqual(['bills', 'orders', 'parties', 'products']);
    const bills = o.lists.find((l) => l.id === 'bills')!;
    expect(bills.card).toMatchObject({ countLabel: 'this month', sumField: 'total', sumLabel: 'unpaid' });
    expect(bills.card.notChecked).toBeGreaterThan(0);
    expect(o.lists.filter((l) => !l.main).map((l) => l.id)).toEqual(expect.arrayContaining(['customer', 'enquiry']));
    expect(o.samples).toBeGreaterThan(0);
  });

  it('opens Lists for a company saved before lists existed, with a default list per record type', async () => {
    const old = await newOrg(h, 'wholesale-retail');
    await h.owner.query(`update workspaces set pack = pack - 'registers' where id = $1`, [old.workspaceId]);
    const o = await lists.overview(old.tenantId);
    expect(o.lists.every((l) => !l.explicit)).toBe(true);
    expect(o.lists.map((l) => l.id)).toEqual(expect.arrayContaining(['bill', 'party', 'product', 'order']));
  });
});

describe('checks', () => {
  it('finds a bill whose total does not add up, and not one with a part missing', async () => {
    const bad = await add('Bill', bill('A-1', { taxableValue: 40840, gstAmount: 7360, total: 48260 }));
    const partial = await add('Bill', bill('A-2', { gstAmount: 7360, total: 48260 }));
    expect(await problems('bills', bad)).toContainEqual({ key: 'adds_up:total', message: "Total ₹48,260 doesn't equal Taxable value + GST amount (₹48,200)", acknowledged: false });
    expect(await keys('bills', partial)).not.toContain('adds_up:total');
  });

  it('finds missing details, and a party that is not in Parties', async () => {
    const noParty = await add('Bill', { billNo: 'A-3', billType: 'sales invoice', billDate: today, total: 100 });
    const unknown = await add('Bill', bill('A-4', { party: 'Ganesh traders' }));
    expect(await keys('bills', noParty)).toContain('missing:party');
    expect(await problems('bills', unknown)).toContainEqual(expect.objectContaining({ key: 'ref:party', message: `Party "Ganesh traders" isn't in your parties` }));
  });

  it('flags both copies of a duplicate and links each to the other', async () => {
    const one = await add('Bill', bill('D-1'));
    const two = await add('Bill', bill('D-1'));
    const credit = await add('Bill', bill('D-1', { billType: 'credit note' }));
    const dup = async (id: string) => (await problems('bills', id)).find((p) => p.key === 'duplicate:billType,billNo,party');
    expect((await dup(one))?.relatedId).toBe(two);
    expect((await dup(two))?.relatedId).toBe(one);
    expect(await dup(credit)).toBeUndefined();
  });

  it('finds an unpaid bill past its due date, counted in India days', async () => {
    const late = await add('Bill', bill('O-1', { dueDate: day(-3), paymentStatus: 'unpaid' }));
    const paid = await add('Bill', bill('O-2', { dueDate: day(-3), paymentStatus: 'paid' }));
    expect((await problems('bills', late)).find((p) => p.key === 'overdue:dueDate')?.message).toMatch(/, 3 days ago$/);
    expect(await keys('bills', paid)).not.toContain('overdue:dueDate');
  });

  it('finds a party over its credit limit, and stock below its reorder level', async () => {
    const over = await add('Party', { name: 'Over Ltd', partyType: 'retailer', phone: '+91 98470 00000', creditLimit: 50000, outstanding: 60000 });
    const under = await add('Party', { name: 'Under Ltd', partyType: 'retailer', phone: '+91 98470 00001', creditLimit: 50000, outstanding: 10000 });
    expect(await keys('parties', over)).toContain('limit:outstanding<=creditLimit');
    expect(await keys('parties', under)).not.toContain('limit:outstanding<=creditLimit');
    const low = await add('Product', { name: 'Low stock item', stock: 4, reorderLevel: 10 });
    expect((await problems('products', low)).map((p) => p.message)).toContain('Stock in hand 4 is less than Reorder level (10)');
  });

  it('finds stock that expires within 30 days or has already expired, and not stock that expires later', async () => {
    const soon = await add('Product', { name: 'Soon', nearestExpiry: day(12) });
    const gone = await add('Product', { name: 'Gone', nearestExpiry: day(-12) });
    const later = await add('Product', { name: 'Later', nearestExpiry: day(60) });
    expect((await problems('products', soon)).map((p) => p.message)).toContainEqual(expect.stringMatching(/is in 12 days/));
    expect((await problems('products', gone)).map((p) => p.message)).toContainEqual(expect.stringMatching(/passed on .*, 12 days ago/));
    expect(await keys('products', later)).not.toContain('expiring:nearestExpiry');
  });

  it('treats a stored value that is not a number or a date as blank, so the list still opens', async () => {
    const id = await add('Bill', bill('M-1', { dueDate: day(5) }));
    await h.owner.query(`update records set data = data || '{"total":"abc","dueDate":"2026-13-45"}'::jsonb where id = $1`, [id]);
    const page = await lists.page(a.tenantId, 'bills', { range: 'all', q: 'M-1', sort: 'total:asc' });
    expect(page.items.map((i) => i.id)).toEqual([id]);
    expect(page.totals.total).toBe(0);
    expect(page.items[0]!.problems.map((p) => p.key)).not.toContain('overdue:dueDate');
  });
});

describe('a list page', () => {
  it('totals every matching item, not only the page shown', async () => {
    for (let i = 0; i < 60; i++) await add('Bill', bill(`PG-${i}`));
    const first = await lists.page(a.tenantId, 'bills', { range: 'all', q: 'PG-' });
    expect(first).toMatchObject({ total: 60, page: 1, pageSize: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.totals.total).toBe(6000);
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: 'PG-', page: '2' })).items).toHaveLength(10);
  });

  it('filters by date range, choice and how it came in, and counts items with no date', async () => {
    const lastMonth = rangeDays('last_month', today)!.from;
    await add('Bill', bill('RG-1'));
    await add('Bill', bill('RG-2', { billDate: lastMonth }));
    await add('Bill', bill('RG-3', { billDate: undefined }));
    const page = (raw: Record<string, string>) => lists.page(a.tenantId, 'bills', { q: 'RG-', ...raw });
    const opened = await page({});
    expect(opened.items.map((i) => i.data.billNo)).toEqual(['RG-1']);
    expect(opened.undated).toBe(1);
    expect((await page({ range: 'last_month' })).items.map((i) => i.data.billNo)).toEqual(['RG-2']);
    expect((await page({ range: 'all' })).total).toBe(3);
    expect((await page({ from: lastMonth, to: today })).total).toBe(2);
    expect((await page({ range: 'all', 'f.billType': 'credit note' })).total).toBe(0);
    expect((await page({ range: 'all', source: 'agent' })).total).toBe(3);
    expect((await page({ range: 'all', source: 'manual' })).total).toBe(0);
  });

  it('searches for the text as typed, so % and _ are not wildcards', async () => {
    await add('Bill', bill('50%_OFF'));
    await add('Bill', bill('50XYOFF'));
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: '50%_' })).items.map((i) => i.data.billNo)).toEqual(['50%_OFF']);
  });

  it('says how each item came in, and shows references by their title', async () => {
    const sample = (await lists.page(a.tenantId, 'parties', { range: 'all', source: 'sample' })).items[0]!;
    expect(sample.source).toEqual({ kind: 'sample', label: 'Sample data' });
    const id = await add('Bill', bill('T-1'));
    const { item, history } = await lists.item(a.tenantId, 'bills', id);
    expect(item.source).toEqual({ kind: 'agent', label: 'AI agent' });
    expect(item.titles.party).toBe((await lists.page(a.tenantId, 'parties', { range: 'all' })).items.find((p) => p.id === partyId)!.title);
    expect(history.map((e) => [e.kind, e.who])).toEqual([['created', 'AI agent']]);
  });

  it("never shows another company's items", async () => {
    const other = await newOrg(h, 'wholesale-retail');
    const id = await add('Bill', bill('ISO-1'));
    expect((await lists.page(other.tenantId, 'bills', { range: 'all', q: 'ISO-1' })).total).toBe(0);
    await expect(lists.item(other.tenantId, 'bills', id)).rejects.toThrow(/not found/i);
  });

  it('downloads the filtered list as CSV, with titles and never ids', async () => {
    const partyTitle = (await lists.page(a.tenantId, 'parties', { range: 'all' })).items.find((p) => p.id === partyId)!.title;
    const csv = await lists.exportCsv(a.tenantId, 'bills', { range: 'all', q: 'A-1' });
    expect(csv.startsWith('﻿Bill no.,Type,Party,Bill date')).toBe(true);
    expect(csv).toContain(`A-1,sales invoice,${partyTitle},`);
    expect(csv).not.toMatch(UUID);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test:integration -- lists.spec`
Expected: FAIL. `../../src/lists/lists.service` and `lists.controller` can't be found, and `MANAGERS_ONLY` isn't exported.

- [ ] **Step 3: The API types**

Create `packages/schemas/src/lists.ts`:

```ts
import type { EntityDef } from './pack';

export type ItemSourceKind = 'manual' | 'call' | 'agent' | 'sample';
export type ListRange = 'today' | 'this_week' | 'this_month' | 'last_month' | 'all';
export type ListShow = 'problems' | 'not_checked' | 'checked';

/** What a list is: its record type and how it is shown. Field names refer to `entity.fields`. */
export interface ListMeta {
  id: string;
  label: string;
  main: boolean;
  explicit: boolean;
  entity: EntityDef;
  columns: string[];
  filters: string[];
  dateField: string | null;
  totals: string[];
  sort: { field: string | null; dir: 'asc' | 'desc' };
}

export interface ListCard {
  count: number;
  countLabel: string;
  sum: number | null;
  sumField: string | null;
  sumLabel: string | null;
  /** Items with a problem nobody has accepted. */
  problems: number;
  notChecked: number;
}

export interface ListSummary extends ListMeta {
  card: ListCard;
}

export interface ListsOverview {
  lists: ListSummary[];
  /** Sample items still in the company's lists. */
  samples: number;
}

export interface ListProblem {
  key: string;
  message: string;
  /** Someone checked the item knowing about this problem. */
  acknowledged: boolean;
  /** For a duplicate: the other item. */
  relatedId?: string;
}

export interface ItemSource {
  kind: ItemSourceKind;
  label: string;
  caseId?: string;
  caseCode?: string;
  callId?: string;
}

export interface ListItem {
  id: string;
  title: string;
  data: Record<string, unknown>;
  /** Titles of the items its reference fields point at, by field name. */
  titles: Record<string, string>;
  source: ItemSource;
  updated: { via: 'manual' | 'call' | 'agent' | 'system' | null; by: string | null; at: string };
  problems: ListProblem[];
  checked: { by: string; at: string; note: string | null } | null;
  createdAt: string;
}

export interface ListPage {
  list: ListMeta;
  items: ListItem[];
  total: number;
  /** Sums of the list's total fields over every matching item. */
  totals: Record<string, number>;
  /** Matching items left out only because they have no date, while a date range is on. */
  undated: number;
  page: number;
  pageSize: number;
}

export interface ListHistoryEntry {
  at: string;
  kind: 'created' | 'updated' | 'checked';
  who: string;
  changes: { field: string; label: string; from: string; to: string }[];
  note: string | null;
}

export interface ListItemDetail {
  list: ListMeta;
  item: ListItem;
  history: ListHistoryEntry[];
}

/** A list page's query: a named range or a from/to pair, filters as field → value. */
export interface ListQueryParams {
  range?: ListRange;
  from?: string;
  to?: string;
  q?: string;
  source?: ItemSourceKind;
  show?: ListShow;
  sort?: string;
  page?: number;
  filters?: Record<string, string>;
}
```

Add `export * from './lists';` to `packages/schemas/src/index.ts`. Then run `pnpm --filter @onehuman/schemas build`.

- [ ] **Step 4: The SQL pieces**

Create `master-ai-backend/src/lists/sql.ts`:

```ts
import { sql, type SQL } from 'drizzle-orm';
import type { Condition, Conditions, EntityDef, EntityField } from '@onehuman/schemas';
import type { ListCheck, ResolvedRegister } from '@onehuman/agent-kit';
import { rangeDays, type ParsedListQuery } from './query';

/** "Today" and "now" in India time, fixed once per request so every query agrees. */
export interface SqlClock {
  today: string;
  now: Date;
}

const NUMERIC = new Set(['money', 'number', 'integer']);

// Every expression reads the row as `r`: the records table inside the CTE, the CTE (`flagged r`) outside it.
const text = (f: string) => sql`(r.data->>${f})`;
const blank = (f: string) => sql`(coalesce(r.data->>${f}, '') = '')`;
const num = (f: string) => sql`try_numeric(r.data->>${f})`;

/** A date or date-time field as an India-time calendar day. */
export function dayExpr(field: EntityField): SQL {
  return field.type === 'datetime'
    ? sql`(try_timestamptz(r.data->>${field.name}) at time zone 'Asia/Kolkata')::date`
    : sql`try_date(r.data->>${field.name})`;
}

export function conditionSql(entity: EntityDef, when: Conditions | undefined): SQL {
  const parts = Object.entries(when ?? {}).map(([name, cond]) => sql`(${conditionPart(entity.fields.find((f) => f.name === name), name, cond)})`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

function conditionPart(field: EntityField | undefined, name: string, cond: Condition): SQL {
  if (cond === 'filled') return sql`not ${blank(name)}`;
  if (cond === 'blank') return blank(name);
  if (Array.isArray(cond)) {
    const numeric = !!field && NUMERIC.has(field.type);
    return sql.join(
      cond.map((v) => (numeric && typeof v === 'number' ? sql`${num(name)} = ${v}` : sql`${text(name)} = ${String(v)}`)),
      sql` or `,
    );
  }
  return 'above' in cond ? sql`${num(name)} > ${cond.above}` : sql`${num(name)} < ${cond.below}`;
}

type Duplicate = Extract<ListCheck, { kind: 'duplicate' }>;

/** Items the duplicate check compares: meeting its `when`, with every key field filled. */
function eligible(check: Duplicate, entity: EntityDef): SQL {
  return sql`(${conditionSql(entity, check.when)}) and ${sql.join(check.fields.map((f) => sql`not ${blank(f.name)}`), sql` and `)}`;
}

function duplicateWindow(check: Duplicate, entity: EntityDef): SQL {
  return sql`partition by (${eligible(check, entity)}), ${sql.join(check.fields.map((f) => text(f.name)), sql`, `)}`;
}

/** True when the check finds a problem on row `r`; null (no answer) counts as no problem. */
function problemCore(check: ListCheck, entity: EntityDef, clock: SqlClock): SQL {
  switch (check.kind) {
    case 'missing':
      return check.field.type === 'boolean' ? sql`coalesce(${text(check.field.name)}, '') <> 'true'` : blank(check.field.name);
    case 'adds_up': {
      const present = sql.join([check.field, ...check.plus].map((f) => sql`${num(f.name)} is not null`), sql` and `);
      const plus = check.plus.length ? sql.join(check.plus.map((f) => num(f.name)), sql` + `) : sql`0`;
      const minus = check.minus.map((f) => sql` - coalesce(${num(f.name)}, 0)`);
      return sql`${present} and abs(${num(check.field.name)} - (${plus}${sql.join(minus, sql``)})) > ${check.tolerance}`;
    }
    case 'limit': {
      const first = check.fields[0]!;
      const above = check.max !== undefined;
      const bound = (above ? check.max : check.min)!;
      const op = sql.raw(above ? '>' : '<');
      if (first.type === 'date' && typeof bound !== 'number') return sql`${dayExpr(first)} ${op} ${dayExpr(bound)}`;
      const total = sql.join(check.fields.map((f) => num(f.name)), sql` + `);
      const limit = typeof bound === 'number' ? sql`${bound}::numeric` : sql`(${num(bound.name)} * ${check.factor}::numeric)`;
      return sql`(${total}) ${op} ${limit}`;
    }
    case 'duplicate':
      return sql`(${eligible(check, entity)}) and count(*) over (${duplicateWindow(check, entity)}) > 1`;
    case 'overdue':
      return check.field.type === 'datetime'
        ? sql`try_timestamptz(r.data->>${check.field.name}) + make_interval(days => ${check.graceDays}::int) < ${clock.now.toISOString()}::timestamptz`
        : sql`try_date(r.data->>${check.field.name}) + ${check.graceDays}::int < ${clock.today}::date`;
    case 'expiring':
      return check.field.type === 'datetime'
        ? sql`try_timestamptz(r.data->>${check.field.name}) <= ${clock.now.toISOString()}::timestamptz + make_interval(days => ${check.days}::int)`
        : sql`try_date(r.data->>${check.field.name}) <= ${clock.today}::date + ${check.days}::int`;
    case 'ref':
      return sql`not ${blank(check.field.name)} and not exists (select 1 from records t where t.workspace_id = r.workspace_id and t.entity = ${check.target.name} and t.id::text = r.data->>${check.field.name})`;
  }
}

/**
 * `with flagged as (…)`: every item of the list, each with p<i> (check i found a
 * problem) and, for a duplicate check, d<i>_min / d<i>_max (ids among the copies).
 * Window functions see the whole record type, so a duplicate is found even when
 * the other copy is filtered out of the page.
 */
export function flaggedCte(reg: ResolvedRegister, workspaceId: string, clock: SqlClock): SQL {
  const cols: SQL[] = [];
  reg.checks.forEach((c, i) => {
    cols.push(sql`coalesce((${conditionSql(reg.entity, c.when)}) and (${problemCore(c, reg.entity, clock)}), false) as ${sql.raw(`p${i}`)}`);
    if (c.kind === 'duplicate') {
      cols.push(sql`min(r.id::text) over (${duplicateWindow(c, reg.entity)}) as ${sql.raw(`d${i}_min`)}`);
      cols.push(sql`max(r.id::text) over (${duplicateWindow(c, reg.entity)}) as ${sql.raw(`d${i}_max`)}`);
    }
  });
  const extra = cols.length ? sql`, ${sql.join(cols, sql`, `)}` : sql``;
  return sql`with flagged as (select r.*${extra} from records r where r.workspace_id = ${workspaceId} and r.entity = ${reg.entity.name})`;
}

/** `r.id` and the flag columns, to read from `flagged r`. */
export function flagSelect(reg: ResolvedRegister): SQL {
  const names = reg.checks.flatMap((c, i) => (c.kind === 'duplicate' ? [`p${i}`, `d${i}_min`, `d${i}_max`] : [`p${i}`]));
  return sql.raw(['r.id', ...names.map((n) => `r.${n}`)].join(', '));
}

/** True when the item has a problem nobody has accepted. */
export function openProblems(reg: ResolvedRegister): SQL {
  if (!reg.checks.length) return sql`false`;
  return sql`(${sql.join(
    reg.checks.map((c, i) => sql`(r.${sql.raw(`p${i}`)} and not (${c.key}::text = any(r.checked_problems)))`),
    sql` or `,
  )})`;
}

export function whereSql(reg: ResolvedRegister, q: ParsedListQuery): SQL {
  const parts: SQL[] = [];
  if (q.dates && reg.dateField) parts.push(sql`${dayExpr(reg.dateField)} between ${q.dates.from}::date and ${q.dates.to}::date`);
  // position(), not ILIKE: % and _ in what someone types are searched for, not wildcards.
  if (q.q) parts.push(sql`position(lower(${q.q}::text) in lower(r.data::text)) > 0`);
  for (const f of q.filters) parts.push(sql`r.data->>${f.field.name} = ${f.value}`);
  if (q.source) parts.push(sql`r.source = ${q.source}`);
  if (q.show === 'problems') parts.push(openProblems(reg));
  if (q.show === 'not_checked') parts.push(sql`r.checked_at is null`);
  if (q.show === 'checked') parts.push(sql`r.checked_at is not null`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

export function orderSql(sort: ParsedListQuery['sort']): SQL {
  const dir = sql.raw(sort.dir === 'asc' ? 'asc' : 'desc');
  const f = sort.field;
  if (!f) return sql`r.updated_at ${dir}, r.id`;
  const key = NUMERIC.has(f.type)
    ? num(f.name)
    : f.type === 'date'
      ? sql`try_date(r.data->>${f.name})`
      : f.type === 'datetime'
        ? sql`try_timestamptz(r.data->>${f.name})`
        : sql`lower(r.data->>${f.name})`;
  return sql`${key} ${dir} nulls last, r.updated_at desc, r.id`;
}

export function totalsSelect(reg: ResolvedRegister, where: SQL): SQL {
  const sums = reg.totals.map((f, i) => sql`, sum(${num(f.name)}) as ${sql.raw(`t${i}`)}`);
  return sql`select count(*)::int as total${sql.join(sums, sql``)} from flagged r where ${where}`;
}

/** The card: its count (its `when`, else this month, else all), its sum, problems nobody accepted, items not checked. */
export function cardSelect(reg: ResolvedRegister, clock: SqlClock): SQL {
  const month = rangeDays('this_month', clock.today)!;
  const counted = reg.card?.count
    ? conditionSql(reg.entity, reg.card.count.when)
    : reg.dateField
      ? sql`${dayExpr(reg.dateField)} between ${month.from}::date and ${month.to}::date`
      : sql`true`;
  const sum = reg.card?.sum ? sql`sum(${num(reg.card.sum.field)}) filter (where ${conditionSql(reg.entity, reg.card.sum.when)})` : sql`null::numeric`;
  return sql`select count(*) filter (where ${counted})::int as count, ${sum} as sum,
    count(*) filter (where ${openProblems(reg)})::int as problems, count(*) filter (where r.checked_at is null)::int as not_checked
    from flagged r`;
}
```

- [ ] **Step 5: The service (reading)**

Create `master-ai-backend/src/lists/lists.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type {
  ItemSource,
  ListCard,
  ListHistoryEntry,
  ListItem,
  ListItemDetail,
  ListMeta,
  ListPage,
  ListProblem,
  ListsOverview,
  ResolvedPack,
} from '@onehuman/schemas';
import { normalizeSnapshot, registersOf, titleOf, type ResolvedRegister } from '@onehuman/agent-kit';
import { AuditService } from '../audit/audit.service';
import { DbService, type Tx } from '../db/db.service';
import { auditEvents, cases, principals, records, toolCalls } from '../db/schema';
import { RecordsService } from '../records/records.service';
import { istDate } from '../voice/time';
import { toCsv } from './csv';
import { csvValue, isUuid, istStamp, problemMessage, shown } from './format';
import { PAGE_SIZE, parseListQuery } from './query';
import { cardSelect, dayExpr, flaggedCte, flagSelect, orderSql, totalsSelect, whereSql, type SqlClock } from './sql';

type RecordRow = typeof records.$inferSelect;
type FlagRow = { id: string } & Record<string, unknown>;
type CardRow = { count: number; sum: string | null; problems: number; not_checked: number };
type Workspace = { id: string; pack: ResolvedPack };
type Change = { field: string; from: unknown; to: unknown };
const EXPORT_LIMIT = 10_000;

const unique = <T>(xs: (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined))];

/**
 * The head's lists: each organization type's registers over its records. Checks
 * are compiled to SQL and worked out when a list is read, so they always match
 * today's date and the current pack. Only people mark items checked.
 */
@Injectable()
export class ListsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
  ) {}

  async overview(tenantId: string): Promise<ListsOverview> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const clock = this.clock();
      const lists = [];
      for (const reg of registersOf(ws.pack)) {
        const [row] = (await tx.execute<CardRow>(sql`${flaggedCte(reg, ws.id, clock)} ${cardSelect(reg, clock)}`)).rows;
        lists.push({ ...meta(reg), card: card(reg, row!) });
      }
      const [samples] = await tx.select({ n: count() }).from(records).where(and(eq(records.workspaceId, ws.id), eq(records.source, 'sample')));
      return { lists, samples: samples?.n ?? 0 };
    });
  }

  async page(tenantId: string, listId: string, raw: Record<string, unknown>): Promise<ListPage> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      const clock = this.clock();
      const q = parseListQuery(raw, reg, clock.today);
      const cte = flaggedCte(reg, ws.id, clock);
      const where = whereSql(reg, q);
      const flags = (
        await tx.execute<FlagRow>(sql`${cte} select ${flagSelect(reg)} from flagged r where ${where} order by ${orderSql(q.sort)} limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`)
      ).rows;
      const [t] = (await tx.execute<Record<string, unknown>>(sql`${cte} ${totalsSelect(reg, where)}`)).rows;
      let undated = 0;
      if (q.dates && reg.dateField) {
        const [u] = (await tx.execute<{ n: number }>(sql`${cte} select count(*)::int as n from flagged r where ${whereSql(reg, { ...q, dates: null })} and ${dayExpr(reg.dateField)} is null`)).rows;
        undated = Number(u?.n ?? 0);
      }
      return {
        list: meta(reg),
        items: await this.decorate(tx, ws, reg, flags, clock),
        total: Number(t?.total ?? 0),
        totals: Object.fromEntries(reg.totals.map((f, i) => [f.name, Number(t?.[`t${i}`] ?? 0)])),
        undated,
        page: q.page,
        pageSize: PAGE_SIZE,
      };
    });
  }

  async item(tenantId: string, listId: string, itemId: string): Promise<ListItemDetail> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      return { list: meta(reg), item: await this.one(tx, ws, reg, itemId), history: await this.history(tx, ws, reg, itemId) };
    });
  }

  async exportCsv(tenantId: string, listId: string, raw: Record<string, unknown>): Promise<string> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      const clock = this.clock();
      const q = parseListQuery(raw, reg, clock.today);
      const flags = (
        await tx.execute<FlagRow>(sql`${flaggedCte(reg, ws.id, clock)} select ${flagSelect(reg)} from flagged r where ${whereSql(reg, q)} order by ${orderSql(q.sort)} limit ${EXPORT_LIMIT}`)
      ).rows;
      const items = await this.decorate(tx, ws, reg, flags, clock);
      const fields = reg.entity.fields;
      return toCsv([
        [...fields.map((f) => f.label), 'Came in', 'Checked by', 'Checked on', 'Problems'],
        ...items.map((it) => [
          ...fields.map((f) => csvValue(f, it.data[f.name], it.titles[f.name])),
          it.source.label,
          it.checked?.by ?? '',
          it.checked ? (istStamp(it.checked.at) ?? '') : '',
          it.problems.map((p) => (p.acknowledged ? `${p.message} (seen)` : p.message)).join('; '),
        ]),
      ]);
    });
  }

  private async workspace(tx: Tx): Promise<Workspace> {
    const ws = await this.records.activeWorkspace(tx);
    return { id: ws.id, pack: normalizeSnapshot(ws.pack) };
  }

  private register(pack: ResolvedPack, id: string): ResolvedRegister {
    const reg = registersOf(pack).find((r) => r.id === id);
    if (!reg) throw new NotFoundException('List not found');
    return reg;
  }

  private clock(): SqlClock {
    const now = new Date();
    return { now, today: istDate(now) };
  }

  /** One item with its problems, or 404. */
  private async one(tx: Tx, ws: Workspace, reg: ResolvedRegister, id: string): Promise<ListItem> {
    if (!isUuid(id)) throw new NotFoundException('Item not found');
    const clock = this.clock();
    const flags = (await tx.execute<FlagRow>(sql`${flaggedCte(reg, ws.id, clock)} select ${flagSelect(reg)} from flagged r where r.id = ${id}::uuid`)).rows;
    const [item] = await this.decorate(tx, ws, reg, flags, clock);
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  /** Flag rows (in order) → items: names instead of ids, titles for references, problems in words. */
  private async decorate(tx: Tx, ws: Workspace, reg: ResolvedRegister, flags: FlagRow[], clock: SqlClock): Promise<ListItem[]> {
    if (!flags.length) return [];
    const rows = await tx.select().from(records).where(inArray(records.id, flags.map((f) => f.id)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const names = await this.names(tx, rows.flatMap((r) => [r.createdBy, r.updatedBy, r.checkedBy]));
    const agentRefs = unique(rows.filter((r) => r.source === 'agent').map((r) => r.sourceRef));
    const caseOf = new Map(
      agentRefs.length
        ? (
            await tx
              .select({ ref: toolCalls.id, caseId: cases.id, code: cases.code })
              .from(toolCalls)
              .innerJoin(cases, eq(cases.goalId, toolCalls.goalId))
              .where(inArray(toolCalls.id, agentRefs))
          ).map((c) => [c.ref, c] as const)
        : [],
    );
    const refFields = reg.entity.fields.filter((f) => f.type === 'reference');
    const titles = await this.titles(tx, ws.pack, rows.flatMap((r) => refFields.map((f) => r.data[f.name])));
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return flags.flatMap((flag) => {
      const r = byId.get(flag.id);
      if (!r) return [];
      return [
        {
          id: r.id,
          title: titleOf(reg.entity, r.data),
          data: r.data,
          titles: Object.fromEntries(
            refFields.flatMap((f) => {
              const v = r.data[f.name];
              return typeof v === 'string' && titles.has(v) ? [[f.name, titles.get(v)!]] : [];
            }),
          ),
          source: sourceOf(r, name(r.createdBy), r.sourceRef ? caseOf.get(r.sourceRef) : undefined),
          updated: { via: r.updatedVia, by: name(r.updatedBy), at: r.updatedAt.toISOString() },
          problems: problemsOf(reg, flag, r, clock.today),
          checked: r.checkedAt ? { by: name(r.checkedBy) ?? 'Someone', at: r.checkedAt.toISOString(), note: r.checkNote } : null,
          createdAt: r.createdAt.toISOString(),
        },
      ];
    });
  }

  private async names(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
    const want = unique(ids);
    if (!want.length) return new Map();
    const rows = await tx.select({ id: principals.id, name: principals.displayName }).from(principals).where(inArray(principals.id, want));
    return new Map(rows.map((p) => [p.id, p.name]));
  }

  /** Titles of the items these values point at, by id. */
  private async titles(tx: Tx, pack: ResolvedPack, values: unknown[]): Promise<Map<string, string>> {
    const ids = unique(values.filter(isUuid));
    if (!ids.length) return new Map();
    const rows = await tx.select({ id: records.id, entity: records.entity, data: records.data }).from(records).where(inArray(records.id, ids));
    return new Map(
      rows.map((t) => {
        const def = pack.entities.find((e) => e.name === t.entity);
        return [t.id, def ? titleOf(def, t.data) : t.entity] as const;
      }),
    );
  }

  /** The item's history from the audit trail, in words, references by title. */
  private async history(tx: Tx, ws: Workspace, reg: ResolvedRegister, itemId: string): Promise<ListHistoryEntry[]> {
    const events = await tx
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.refId, itemId), inArray(auditEvents.type, ['record.created', 'record.updated', 'record.checked'])))
      .orderBy(asc(auditEvents.seq));
    const names = await this.names(tx, events.filter((e) => e.actorKind === 'human').map((e) => e.actorId));
    const refNames = new Set(reg.entity.fields.filter((f) => f.type === 'reference').map((f) => f.name));
    const changes = events.flatMap((e) => (e.payload as { changes?: Change[] }).changes ?? []);
    const titles = await this.titles(tx, ws.pack, changes.filter((c) => refNames.has(c.field)).flatMap((c) => [c.from, c.to]));
    return events.map((e) => {
      const p = e.payload as { changes?: Change[]; note?: string };
      return {
        at: e.createdAt.toISOString(),
        kind: e.type.slice('record.'.length) as ListHistoryEntry['kind'],
        who: e.actorKind === 'agent' ? 'AI agent' : e.actorKind === 'system' ? 'ONEHUMAN OS' : (names.get(e.actorId ?? '') ?? 'Someone'),
        changes: (p.changes ?? []).map((c) => {
          const field = reg.entity.fields.find((f) => f.name === c.field);
          return {
            field: c.field,
            label: field?.label ?? c.field,
            from: field ? shown(field, c.from, titles) : String(c.from ?? '—'),
            to: field ? shown(field, c.to, titles) : String(c.to ?? '—'),
          };
        }),
        note: p.note ?? null,
      };
    });
  }
}

function meta(reg: ResolvedRegister): ListMeta {
  return {
    id: reg.id,
    label: reg.label,
    main: reg.main,
    explicit: reg.explicit,
    entity: reg.entity,
    columns: reg.columns.map((f) => f.name),
    filters: reg.filters.map((f) => f.name),
    dateField: reg.dateField?.name ?? null,
    totals: reg.totals.map((f) => f.name),
    sort: { field: reg.sort.field?.name ?? null, dir: reg.sort.dir },
  };
}

function card(reg: ResolvedRegister, row: CardRow): ListCard {
  return {
    count: Number(row.count ?? 0),
    countLabel: reg.card?.count?.label ?? (reg.dateField ? 'this month' : 'in all'),
    sum: reg.card?.sum ? Number(row.sum ?? 0) : null,
    sumField: reg.card?.sum?.field ?? null,
    sumLabel: reg.card?.sum?.label ?? null,
    problems: Number(row.problems ?? 0),
    notChecked: Number(row.not_checked ?? 0),
  };
}

function sourceOf(r: RecordRow, creator: string | null, c?: { caseId: string; code: string }): ItemSource {
  switch (r.source) {
    case 'sample':
      return { kind: 'sample', label: 'Sample data' };
    case 'agent':
      return c ? { kind: 'agent', label: `AI agent (${c.code})`, caseId: c.caseId, caseCode: c.code } : { kind: 'agent', label: 'AI agent' };
    case 'call':
      return { kind: 'call', label: 'Phone call', ...(r.sourceRef ? { callId: r.sourceRef } : {}) };
    default:
      return { kind: 'manual', label: creator ? `${creator}, by hand` : 'By hand' };
  }
}

function problemsOf(reg: ResolvedRegister, flag: FlagRow, r: RecordRow, today: string): ListProblem[] {
  return reg.checks.flatMap((c, i) => {
    if (flag[`p${i}`] !== true) return [];
    const problem: ListProblem = { key: c.key, message: problemMessage(c, r.data, today, reg.entity), acknowledged: r.checkedProblems.includes(c.key) };
    if (c.kind === 'duplicate') {
      const min = flag[`d${i}_min`] as string;
      problem.relatedId = min !== r.id ? min : (flag[`d${i}_max`] as string);
    }
    return [problem];
  });
}
```

- [ ] **Step 6: The controller, the access marker and the module**

In `master-ai-backend/src/common/auth.ts`, change `const MANAGERS_ONLY = …` to `export const MANAGERS_ONLY = …`.

Create `master-ai-backend/src/lists/lists.controller.ts`:

```ts
import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
import { ListsService } from './lists.service';

/** The head's lists. The owner and admins only. */
@ManagersOnly()
@Controller('lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  overview(@CurrentSession() s: Session) {
    return this.lists.overview(s.tenantId);
  }

  @Get(':id')
  page(@CurrentSession() s: Session, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.lists.page(s.tenantId, id, query);
  }

  /** The filtered list as CSV. The web app fetches it with the session header and saves it from a Blob. */
  @Get(':id/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment')
  @Header('Cache-Control', 'no-store')
  exportCsv(@CurrentSession() s: Session, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.lists.exportCsv(s.tenantId, id, query);
  }

  @Get(':id/items/:itemId')
  item(@CurrentSession() s: Session, @Param('id') id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.lists.item(s.tenantId, id, itemId);
  }
}
```

In `master-ai-backend/src/app.module.ts`:
- import `ListsController` from `./lists/lists.controller` and `ListsService` from `./lists/lists.service`;
- add `ListsController` after `RecordsController` in `controllers`;
- add `ListsService` after `RecordsService` in `providers`.

- [ ] **Step 7: Run the spec and the rest**

Run: `pnpm build:packages && pnpm test:integration -- lists.spec`
Expected: PASS, every test. If a SQL error appears, the message names the statement. The usual cause is a parameter whose type Postgres can't infer; cast it (`${x}::text`, `::int`, `::date`) as the existing lines do.

Run: `pnpm test:integration && pnpm --filter @onehuman/backend typecheck && pnpm --filter @onehuman/backend test`
Expected: PASS, the existing specs included.

- [ ] **Step 8: Commit**

```bash
git add packages/schemas/src/lists.ts packages/schemas/src/index.ts master-ai-backend/src/lists master-ai-backend/src/common/auth.ts master-ai-backend/src/app.module.ts master-ai-backend/__tests__/integration/lists.spec.ts
git commit -m "feat(lists): the head's lists with checks worked out in SQL, totals, pages, history and CSV

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Correcting, checking and removing items

**Files:**
- Modify: `packages/schemas/src/lists.ts` (input schemas)
- Modify: `master-ai-backend/src/lists/lists.service.ts` (`create`, `update`, `check`, `checkMany`, `remove`, `removeSamples`)
- Modify: `master-ai-backend/src/lists/lists.controller.ts` (the write endpoints)
- Test: `packages/schemas/__tests__/lists.test.ts` (create)
- Test: `master-ai-backend/__tests__/integration/lists-writes.spec.ts` (create)

**Interfaces:**
- Consumes:
  - `RecordsService.create` / `update` with `RecordSource` / `RecordChange` (Task 6);
  - `ListsService`'s private `workspace`, `register` and `one` (Task 8).
- Produces:

  ```ts
  export const UpdateListItemInputSchema   // { data: Record<string, unknown>; note?: string }
  export const CheckListItemInputSchema    // { note?: string }
  export const BulkCheckInputSchema        // { ids: string[] } 1–500 uuids
  export const RemoveListItemInputSchema   // { reason: string } 3–500 chars
  ListsService.create(session, listId, data): Promise<ListItem>
  ListsService.update(session, listId, itemId, { data, note? }): Promise<ListItem>
  ListsService.check(session, listId, itemId, { note? }): Promise<ListItem>        // 400 without a note when problems are open
  ListsService.checkMany(session, listId, ids): Promise<{ checked: number; skipped: number }>
  ListsService.remove(session, listId, itemId, { reason }): Promise<{ removed: true }>
  ListsService.removeSamples(session): Promise<{ removed: number }>
  ```

  Endpoints:
  - `POST /lists/:id/items`
  - `PATCH /lists/:id/items/:itemId`
  - `POST /lists/:id/items/:itemId/check`
  - `POST /lists/:id/items/:itemId/remove`
  - `POST /lists/:id/check`
  - `DELETE /lists/samples`

- [ ] **Step 1: Write the failing tests**

Create `packages/schemas/__tests__/lists.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BulkCheckInputSchema, CheckListItemInputSchema, RemoveListItemInputSchema, UpdateListItemInputSchema } from '../src/lists';

describe('list inputs', () => {
  it('needs a reason to remove an item', () => {
    expect(RemoveListItemInputSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(RemoveListItemInputSchema.parse({ reason: ' Entered twice ' }).reason).toBe('Entered twice');
  });

  it('checks up to 500 items by id at once', () => {
    expect(BulkCheckInputSchema.safeParse({ ids: ['not-an-id'] }).success).toBe(false);
    expect(BulkCheckInputSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(BulkCheckInputSchema.safeParse({ ids: Array.from({ length: 501 }, () => randomUUID()) }).success).toBe(false);
  });

  it('trims notes, and leaves out an empty one', () => {
    expect(UpdateListItemInputSchema.parse({ data: { total: 5 }, note: '  rounded  ' }).note).toBe('rounded');
    expect(CheckListItemInputSchema.parse({ note: '   ' }).note).toBeUndefined();
  });
});
```

Create `master-ai-backend/__tests__/integration/lists-writes.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../../src/db/db.service';
import { auditEvents } from '../../src/db/schema';
import { ListsService } from '../../src/lists/lists.service';
import { RecordsService } from '../../src/records/records.service';
import { istDate } from '../../src/voice/time';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;
let lists: ListsService;
let partyId: string;
const today = istDate();
const day = (offset: number) => istDate(new Date(Date.now() + offset * 86_400_000));

beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
  lists = h.get(ListsService);
  partyId = (await lists.page(a.tenantId, 'parties', { range: 'all' })).items[0]!.id;
});
afterAll(() => h.close());

async function add(entity: string, data: Record<string, unknown>): Promise<string> {
  return h.get(DbService).tenant(a.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    const ws = await svc.activeWorkspace(tx);
    return (await svc.create(tx, a.tenantId, ws, entity, data, { id: null, kind: 'agent' }, { kind: 'agent' })).id;
  });
}
const bill = (billNo: string, extra: Record<string, unknown> = {}) => ({ billNo, billType: 'sales invoice', party: partyId, billDate: today, total: 100, ...extra });

describe('adding and correcting', () => {
  it('adds an item the owner types as checked, by hand', async () => {
    const item = await lists.create(a.session, 'parties', { name: 'Typed Traders', partyType: 'retailer', phone: '+91 98470 11111' });
    expect(item.source).toEqual({ kind: 'manual', label: 'Asha Owner, by hand' });
    expect(item.checked?.by).toBe('Asha Owner');
  });

  it("checks the item an owner corrects, and keeps the old and new values in its history", async () => {
    const id = await add('Bill', bill('E-1', { taxableValue: 40840, gstAmount: 7360, total: 48260 }));
    const item = await lists.update(a.session, 'bills', id, { data: { taxableValue: 40900 }, note: 'Typed wrong' });
    expect(item.problems.map((p) => p.key)).not.toContain('adds_up:total');
    expect(item.checked?.by).toBe('Asha Owner');
    expect(item.updated).toMatchObject({ via: 'manual', by: 'Asha Owner' });
    const { history } = await lists.item(a.tenantId, 'bills', id);
    expect(history.map((e) => [e.kind, e.who])).toEqual([['created', 'AI agent'], ['updated', 'Asha Owner']]);
    expect(history[1]).toMatchObject({ note: 'Typed wrong', changes: [{ field: 'taxableValue', label: 'Taxable value', from: '₹40,840', to: '₹40,900' }] });
  });
});

describe('checking', () => {
  it('needs a note to check an item with problems, keeps the accepted problem, and still shows a new one later', async () => {
    const id = await add('Bill', bill('K-1', { taxableValue: 100, gstAmount: 18, total: 200, dueDate: day(5), paymentStatus: 'unpaid' }));
    await expect(lists.check(a.session, 'bills', id, {})).rejects.toThrow(/Add a note/);
    const checked = await lists.check(a.session, 'bills', id, { note: "Rounded on the party's request" });
    expect(checked.checked).toMatchObject({ by: 'Asha Owner', note: "Rounded on the party's request" });
    expect(checked.problems).toEqual([expect.objectContaining({ key: 'adds_up:total', acknowledged: true })]);
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: 'K-1', show: 'problems' })).total).toBe(0);
    // Days later the bill falls due, with nobody touching it.
    await h.owner.query(`update records set data = data || jsonb_build_object('dueDate', $2::text) where id = $1`, [id, day(-2)]);
    const later = (await lists.item(a.tenantId, 'bills', id)).item;
    expect(later.problems.map((p) => [p.key, p.acknowledged])).toEqual([['adds_up:total', true], ['overdue:dueDate', false]]);
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: 'K-1', show: 'problems' })).total).toBe(1);
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: 'K-1', show: 'checked' })).total).toBe(1);
  });

  it("checks only the items without problems, and ignores ids it doesn't own", async () => {
    const clean1 = await add('Party', { name: 'Bulk One', partyType: 'retailer', phone: '+91 98470 22222' });
    const clean2 = await add('Party', { name: 'Bulk Two', partyType: 'retailer', phone: '+91 98470 33333' });
    const bad = await add('Party', { name: 'Bulk Bad', partyType: 'retailer' });
    const other = await newOrg(h, 'wholesale-retail');
    const theirs = (await lists.page(other.tenantId, 'parties', { range: 'all' })).items[0]!.id;
    expect(await lists.checkMany(a.session, 'parties', [clean1, clean2, bad, theirs, randomUUID()])).toEqual({ checked: 2, skipped: 1 });
    expect((await lists.item(a.tenantId, 'parties', clean1)).item.checked?.by).toBe('Asha Owner');
    expect((await lists.item(a.tenantId, 'parties', bad)).item.checked).toBeNull();
    expect((await lists.item(other.tenantId, 'parties', theirs)).item.checked).toBeNull();
  });
});

describe('removing', () => {
  it('removes an item with a reason, keeping a full copy in the audit trail', async () => {
    const id = await add('Bill', bill('R-1', { total: 10 }));
    await lists.remove(a.session, 'bills', id, { reason: 'Entered twice' });
    await expect(lists.item(a.tenantId, 'bills', id)).rejects.toThrow(/not found/i);
    const events = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.refId, id)));
    expect(events.find((e) => e.type === 'record.removed')!.payload).toMatchObject({
      reason: 'Entered twice',
      title: 'R-1',
      data: expect.objectContaining({ billNo: 'R-1', total: 10 }),
    });
  });

  // Last: it removes the sample party the other tests' bills point at.
  it('removes the sample data and nothing else', async () => {
    const before = await lists.overview(a.tenantId);
    expect(before.samples).toBeGreaterThan(0);
    const kept = await add('Party', { name: 'Kept Traders', partyType: 'retailer' });
    expect(await lists.removeSamples(a.session)).toEqual({ removed: before.samples });
    expect((await lists.overview(a.tenantId)).samples).toBe(0);
    expect((await lists.item(a.tenantId, 'parties', kept)).item.id).toBe(kept);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @onehuman/schemas test -- lists && pnpm test:integration -- lists-writes`
Expected: FAIL. The input schemas aren't exported, and `lists.create` is not a function.

- [ ] **Step 3: The input schemas**

Add to the top of `packages/schemas/src/lists.ts` (keep the existing `import type { EntityDef }`):

```ts
import { z } from 'zod';

const note = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => v || undefined);

export const UpdateListItemInputSchema = z.object({ data: z.record(z.string(), z.unknown()), note });
export type UpdateListItemInput = z.input<typeof UpdateListItemInputSchema>;

export const CheckListItemInputSchema = z.object({ note });
export type CheckListItemInput = z.input<typeof CheckListItemInputSchema>;

export const BulkCheckInputSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) });

export const RemoveListItemInputSchema = z.object({ reason: z.string().trim().min(3, 'Say why it is being removed').max(500) });
```

Then run `pnpm --filter @onehuman/schemas build`.

- [ ] **Step 4: The service methods**

Add to `master-ai-backend/src/lists/lists.service.ts`:
- **Imports:** add `BadRequestException` to the `@nestjs/common` import, and add `import type { Session } from '../common/auth';`.
- **Module level:** add `const human = (s: Session) => ({ id: s.principalId, kind: 'human' as const });`.
- **Class:** add these methods, before `private async workspace`:

```ts
  /** An item an owner or admin types in; they have checked it. */
  async create(session: Session, listId: string, data: Record<string, unknown>): Promise<ListItem> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      const row = await this.records.create(tx, session.tenantId, ws, reg.entity.name, data, human(session), { kind: 'manual', checkedBy: session.principalId });
      return this.one(tx, ws, reg, row.id);
    });
  }

  /** A correction by an owner or admin: audited with the old and new values, and checked by them. */
  async update(session: Session, listId: string, itemId: string, input: { data: Record<string, unknown>; note?: string }): Promise<ListItem> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      await this.one(tx, ws, reg, itemId);
      await this.records.update(tx, session.tenantId, ws, reg.entity.name, itemId, input.data, {
        actor: human(session),
        via: 'manual',
        note: input.note ?? null,
        checkedBy: session.principalId,
      });
      return this.one(tx, ws, reg, itemId);
    });
  }

  /** Marks an item checked. With open problems it needs a note saying why it's right; those problems are then accepted. */
  async check(session: Session, listId: string, itemId: string, input: { note?: string }): Promise<ListItem> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      const item = await this.one(tx, ws, reg, itemId);
      const note = input.note?.trim() || null;
      if (item.problems.some((p) => !p.acknowledged) && !note) {
        throw new BadRequestException('This item has problems. Add a note saying why it is right as it is.');
      }
      await this.markChecked(tx, session, reg, item, note);
      return this.one(tx, ws, reg, itemId);
    });
  }

  /** Checks the given items that have no open problem; the rest are skipped. Ids from elsewhere are ignored. */
  async checkMany(session: Session, listId: string, ids: string[]): Promise<{ checked: number; skipped: number }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      const clock = this.clock();
      const wanted = ids.filter(isUuid);
      if (!wanted.length) return { checked: 0, skipped: 0 };
      const flags = (
        await tx.execute<FlagRow>(
          sql`${flaggedCte(reg, ws.id, clock)} select ${flagSelect(reg)} from flagged r where r.id in (${sql.join(wanted.map((id) => sql`${id}::uuid`), sql`, `)})`,
        )
      ).rows;
      let checked = 0;
      let skipped = 0;
      for (const item of await this.decorate(tx, ws, reg, flags, clock)) {
        if (item.problems.some((p) => !p.acknowledged)) {
          skipped++;
          continue;
        }
        checked++;
        if (!item.checked) await this.markChecked(tx, session, reg, item, null);
      }
      return { checked, skipped };
    });
  }

  /** Removes a wrong or duplicate item. The audit trail keeps a full copy and the reason. */
  async remove(session: Session, listId: string, itemId: string, input: { reason: string }): Promise<{ removed: true }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      if (!isUuid(itemId)) throw new NotFoundException('Item not found');
      const [row] = await tx
        .delete(records)
        .where(and(eq(records.id, itemId), eq(records.workspaceId, ws.id), eq(records.entity, reg.entity.name)))
        .returning();
      if (!row) throw new NotFoundException('Item not found');
      await this.audit.append(tx, session.tenantId, {
        type: 'record.removed',
        actor: human(session),
        refId: itemId,
        payload: { entity: reg.entity.name, label: reg.entity.label, title: titleOf(reg.entity, row.data), reason: input.reason, data: row.data },
      });
      return { removed: true };
    });
  }

  /** Deletes every sample item, once the company is using real data. */
  async removeSamples(session: Session): Promise<{ removed: number }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const gone = await tx
        .delete(records)
        .where(and(eq(records.workspaceId, ws.id), eq(records.source, 'sample')))
        .returning({ id: records.id });
      if (gone.length) {
        await this.audit.append(tx, session.tenantId, { type: 'record.samples_removed', actor: human(session), refId: ws.id, payload: { count: gone.length } });
      }
      return { removed: gone.length };
    });
  }

  private async markChecked(tx: Tx, session: Session, reg: ResolvedRegister, item: ListItem, note: string | null) {
    const accepted = item.problems.map((p) => p.key);
    await tx
      .update(records)
      .set({ checkedBy: session.principalId, checkedAt: new Date(), checkNote: note, checkedProblems: accepted })
      .where(eq(records.id, item.id));
    await this.audit.append(tx, session.tenantId, {
      type: 'record.checked',
      actor: human(session),
      refId: item.id,
      payload: { entity: reg.entity.name, label: reg.entity.label, title: item.title, accepted, ...(note && { note }) },
    });
  }
```

- [ ] **Step 5: The endpoints**

In `master-ai-backend/src/lists/lists.controller.ts`:
- add `Body`, `Delete`, `Patch` and `Post` to the `@nestjs/common` import;
- add `import type { z } from 'zod';`;
- import from `@onehuman/schemas`: `BulkCheckInputSchema`, `CheckListItemInputSchema`, `CreateRecordInputSchema`, `RemoveListItemInputSchema` and `UpdateListItemInputSchema`;
- add `import { ZodPipe } from '../common/zod';`.

Then add these methods to the class:

```ts
  @Delete('samples')
  removeSamples(@CurrentSession() s: Session) {
    return this.lists.removeSamples(s);
  }

  @Post(':id/items')
  create(@CurrentSession() s: Session, @Param('id') id: string, @Body(new ZodPipe(CreateRecordInputSchema)) body: z.output<typeof CreateRecordInputSchema>) {
    return this.lists.create(s, id, body.data);
  }

  @Patch(':id/items/:itemId')
  update(
    @CurrentSession() s: Session,
    @Param('id') id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodPipe(UpdateListItemInputSchema)) body: z.output<typeof UpdateListItemInputSchema>,
  ) {
    return this.lists.update(s, id, itemId, body);
  }

  @Post(':id/items/:itemId/check')
  check(
    @CurrentSession() s: Session,
    @Param('id') id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodPipe(CheckListItemInputSchema)) body: z.output<typeof CheckListItemInputSchema>,
  ) {
    return this.lists.check(s, id, itemId, body);
  }

  /** A POST, not a DELETE: the reason travels in the body, which a DELETE may lose on the way. */
  @Post(':id/items/:itemId/remove')
  remove(
    @CurrentSession() s: Session,
    @Param('id') id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodPipe(RemoveListItemInputSchema)) body: z.output<typeof RemoveListItemInputSchema>,
  ) {
    return this.lists.remove(s, id, itemId, body);
  }

  @Post(':id/check')
  checkMany(@CurrentSession() s: Session, @Param('id') id: string, @Body(new ZodPipe(BulkCheckInputSchema)) body: z.output<typeof BulkCheckInputSchema>) {
    return this.lists.checkMany(s, id, body.ids);
  }
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @onehuman/schemas test && pnpm test:integration -- lists`
Expected: PASS. This runs `lists.spec` and `lists-writes.spec`.

Run: `pnpm test:integration && pnpm --filter @onehuman/backend typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas master-ai-backend/src/lists master-ai-backend/__tests__/integration/lists-writes.spec.ts
git commit -m "feat(lists): correct, check (with a note when problems are open), bulk-check, remove and clear sample data

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The API client's list methods

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Test: `packages/sdk/__tests__/lists.test.ts` (create)

**Interfaces:**
- Consumes: the Task 8 and Task 9 types and endpoints.
- Produces:

  ```ts
  export function listQuery(p?: ListQueryParams): string; // "?range=all&f.billType=sales%20invoice"
  api.lists.overview(): Promise<ListsOverview>
  api.lists.page(id, query?): Promise<ListPage>
  api.lists.exportCsv(id, query?): Promise<string> // text without the BOM, which fetch drops
  api.lists.item(id, itemId): Promise<ListItemDetail>
  api.lists.create(id, data): Promise<ListItem>
  api.lists.update(id, itemId, input: UpdateListItemInput): Promise<ListItem>
  api.lists.check(id, itemId, input?: CheckListItemInput): Promise<ListItem>
  api.lists.checkMany(id, ids): Promise<{ checked: number; skipped: number }>
  api.lists.remove(id, itemId, reason): Promise<{ removed: true }>
  api.lists.removeSamples(): Promise<{ removed: number }>
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/__tests__/lists.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError, createClient, listQuery } from '../src/index';

describe('listQuery', () => {
  it('writes only what is set, with filters as f.<field>', () => {
    expect(listQuery({ range: 'all', q: '50% off', page: 2, filters: { billType: 'sales invoice', party: '' } })).toBe('?range=all&q=50%25%20off&page=2&f.billType=sales%20invoice');
    expect(listQuery({ page: 1 })).toBe('');
    expect(listQuery()).toBe('');
  });
});

describe('api.lists', () => {
  function client(reply: (url: string) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = createClient({
      baseUrl: 'http://api.test',
      getToken: () => 'token-1',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return reply(String(url));
      },
    });
    return { api, calls };
  }

  it('downloads CSV as text with the session header, never a token in the URL, and without the page', async () => {
    const { api, calls } = client(() => new Response('﻿Bill no.,Total\r\nS-1,100\r\n', { status: 200 }));
    expect(await api.lists.exportCsv('bills', { range: 'all', page: 3 })).toBe('Bill no.,Total\r\nS-1,100\r\n');
    expect(calls[0]!.url).toBe('http://api.test/lists/bills/export?range=all');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('turns a refused download into an ApiError with the reason', async () => {
    const { api } = client(() => new Response(JSON.stringify({ message: 'Only the owner and admins can do this' }), { status: 403 }));
    await expect(api.lists.exportCsv('bills')).rejects.toEqual(expect.objectContaining({ status: 403, message: 'Only the owner and admins can do this' }));
    await expect(api.lists.exportCsv('bills')).rejects.toBeInstanceOf(ApiError);
  });

  it('sends a removal reason in a POST body', async () => {
    const { api, calls } = client(() => new Response('{"removed":true}', { status: 200 }));
    await api.lists.remove('bills', 'item-1', 'Entered twice');
    expect(calls[0]).toMatchObject({ url: 'http://api.test/lists/bills/items/item-1/remove', init: { method: 'POST', body: '{"reason":"Entered twice"}' } });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @onehuman/sdk test -- lists`
Expected: FAIL. `listQuery` is not exported, and `api.lists` is undefined.

- [ ] **Step 3: Add the client code**

In `packages/sdk/src/client.ts`:
- add to the `import type { … } from '@onehuman/schemas'` list: `CheckListItemInput`, `ListItem`, `ListItemDetail`, `ListPage`, `ListQueryParams`, `ListsOverview` and `UpdateListItemInput`;
- above `export type ApiClient`, add:

```ts
/** The query string for a list page: only what is set, filters as `f.<field>`. */
export function listQuery(p: ListQueryParams = {}): string {
  const entries: [string, string][] = [];
  for (const key of ['range', 'from', 'to', 'q', 'source', 'show', 'sort'] as const) {
    const v = p[key];
    if (v) entries.push([key, v]);
  }
  if (p.page && p.page > 1) entries.push(['page', String(p.page)]);
  for (const [field, v] of Object.entries(p.filters ?? {})) if (v) entries.push([`f.${field}`, v]);
  return entries.length ? `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
}
```

Inside `createClient`, after `request`, add:

```ts
  /** A text answer (CSV). Same session header and errors as `request`. */
  async function requestText(path: string): Promise<string> {
    const token = await options.getToken?.();
    const res = await doFetch(`${baseUrl}${path}`, { method: 'GET', headers: { Accept: 'text/csv', ...(token && { Authorization: `Bearer ${token}` }) } });
    const text = await res.text();
    if (!res.ok) {
      const data: unknown = text ? safeJson(text) : null;
      const bodyMessage = data && typeof data === 'object' && 'message' in data ? formatMessage((data as { message: unknown }).message) : '';
      throw new ApiError(res.status, bodyMessage || res.statusText || `Request failed (${res.status})`, data);
    }
    return text;
  }
```

In the returned object, after `records: { … },`, add:

```ts
    lists: {
      overview: () => get<ListsOverview>('/lists'),
      page: (id: string, query: ListQueryParams = {}) => get<ListPage>(`/lists/${encodeURIComponent(id)}${listQuery(query)}`),
      /** The filtered list as CSV text. fetch drops the byte order mark; add it back before saving (Excel needs it). */
      exportCsv: (id: string, query: ListQueryParams = {}) => requestText(`/lists/${encodeURIComponent(id)}/export${listQuery({ ...query, page: undefined })}`),
      item: (id: string, itemId: string) => get<ListItemDetail>(`/lists/${encodeURIComponent(id)}/items/${itemId}`),
      create: (id: string, data: Record<string, unknown>) => post<ListItem>(`/lists/${encodeURIComponent(id)}/items`, { data }),
      update: (id: string, itemId: string, input: UpdateListItemInput) => patch<ListItem>(`/lists/${encodeURIComponent(id)}/items/${itemId}`, input),
      check: (id: string, itemId: string, input: CheckListItemInput = {}) => post<ListItem>(`/lists/${encodeURIComponent(id)}/items/${itemId}/check`, input),
      checkMany: (id: string, ids: string[]) => post<{ checked: number; skipped: number }>(`/lists/${encodeURIComponent(id)}/check`, { ids }),
      remove: (id: string, itemId: string, reason: string) => post<{ removed: true }>(`/lists/${encodeURIComponent(id)}/items/${itemId}/remove`, { reason }),
      removeSamples: () => del<{ removed: number }>('/lists/samples'),
    },
```

`packages/sdk/src/index.ts` already has `export * from './client';`, so `listQuery` is exported from the package root.

- [ ] **Step 4: Run the tests, typecheck and build**

Run: `pnpm --filter @onehuman/sdk test && pnpm --filter @onehuman/sdk typecheck && pnpm --filter @onehuman/sdk build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): list methods, with CSV fetched as text under the session header

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The Lists pages on the web

**Files:**
- Create: `master-ai-web/src/lib/lists.ts`, `master-ai-web/src/lib/record-values.ts`
- Create: `master-ai-web/src/components/record-form.tsx`, `master-ai-web/src/components/list-item-panel.tsx`
- Create: `master-ai-web/src/routes/lists.tsx`, `master-ai-web/src/routes/list.tsx`
- Delete: `master-ai-web/src/routes/records.tsx`
- Modify:
  - `master-ai-web/src/main.tsx` (routes);
  - `master-ai-web/src/lib/nav.ts` (Lists under Cases, no Records);
  - `master-ai-web/src/lib/realtime.ts` (refresh lists);
  - `master-ai-web/src/components/pack-updates.tsx` (new record types, fields and lists).
- Test: `master-ai-web/__tests__/unit/lib/lists.test.ts`, `master-ai-web/__tests__/unit/lib/record-values.test.ts` (create); `master-ai-web/__tests__/unit/lib/nav.test.ts` (modify)

**Interfaces:**
- Consumes:
  - `api.lists.*` and `listQuery` (Task 10);
  - the types `ListMeta`, `ListSummary`, `ListItem`, `ListQueryParams`, `ListRange`, `ListShow` and `ItemSourceKind` (Task 8);
  - the existing `api.records.list` (reference pickers) and `api.workspaces.list` (all entities).
- Produces:
  - **Routes:** `/lists` (`ListsPage`) and `/lists/:id` (`ListPage`, item drawer at `?item=<id>`). `/records` redirects to `/lists`.
  - **Exports:** `RecordForm` and `ReferenceSelect`, from `components/record-form.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `master-ai-web/__tests__/unit/lib/lists.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { csvFileName, initialView, listParams, nextSort, referenceText, withBom } from '../../../src/lib/lists';

describe('the list page state', () => {
  it('opens a dated list on this month, and an undated one on everything', () => {
    expect(listParams(initialView(true))).toEqual({ range: 'this_month' });
    expect(listParams(initialView(false))).toEqual({ range: 'all' });
  });

  it('sends what is set, and a custom range only when both days are picked', () => {
    const v = { ...initialView(true), range: 'custom' as const, from: '2026-09-01', to: '2026-09-30', q: '  S-10 ', filters: { billType: 'credit note', party: '' }, show: 'problems' as const, page: 2 };
    expect(listParams(v)).toEqual({ from: '2026-09-01', to: '2026-09-30', q: 'S-10', filters: { billType: 'credit note' }, show: 'problems', page: 2 });
    expect(listParams({ ...v, to: '' })).toMatchObject({ range: 'all' });
  });

  it('cycles a column through ascending, descending and off', () => {
    expect(nextSort('', 'total')).toBe('total:asc');
    expect(nextSort('total:asc', 'total')).toBe('total:desc');
    expect(nextSort('total:desc', 'total')).toBe('');
    expect(nextSort('total:desc', 'billNo')).toBe('billNo:asc');
  });
});

describe('the download', () => {
  it('names the file after the list and the day', () => {
    expect(csvFileName('Contractor bills', new Date(2026, 9, 14, 12))).toBe('contractor-bills-2026-10-14.csv');
  });

  it('puts back the byte order mark Excel needs, once', () => {
    expect(withBom('a,b')).toBe('﻿a,b');
    expect(withBom('﻿a,b')).toBe('﻿a,b');
  });
});

describe('referenceText', () => {
  it('never shows an id', () => {
    expect(referenceText('0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11')).toBe('a removed item');
    expect(referenceText('Ganesh traders')).toBe('Ganesh traders');
    expect(referenceText(null)).toBe('—');
  });
});
```

Create `master-ai-web/__tests__/unit/lib/record-values.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityField } from '@onehuman/schemas';
import { dataValue, formValue } from '../../../src/lib/record-values';

const field = (type: EntityField['type']): EntityField => ({ name: 'x', label: 'X', type, required: false });

describe('form values', () => {
  it('round-trips a date-time through the local-time input', () => {
    const iso = '2026-10-14T09:30:00.000Z';
    expect(dataValue(field('datetime'), formValue(field('datetime'), iso))).toBe(iso);
  });

  it('stores numbers as numbers, blanks as null and yes/no as booleans', () => {
    expect(dataValue(field('money'), '48260')).toBe(48260);
    expect(dataValue(field('string'), '')).toBeNull();
    expect(dataValue(field('boolean'), false)).toBe(false);
    expect(formValue(field('boolean'), undefined)).toBe(false);
    expect(formValue(field('date'), '2026-10-14')).toBe('2026-10-14');
    expect(formValue(field('money'), null)).toBe('');
  });
});
```

In `master-ai-web/__tests__/unit/lib/nav.test.ts`, change the owner/admin expectation's array to `['Lists', 'Workflows', 'Agents', 'Industry pack', 'Audit', 'Settings']`. Then add this test:

```ts
  it('puts Lists right under Cases, and has no Records page', () => {
    const owner = labels('owner');
    expect(owner.indexOf('Lists')).toBe(owner.indexOf('Cases') + 1);
    expect(owner).not.toContain('Records');
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @onehuman/web test -- lists record-values nav`
Expected: FAIL. `src/lib/lists` and `src/lib/record-values` don't exist, and the nav still has Records.

- [ ] **Step 3: The helpers**

Create `master-ai-web/src/lib/lists.ts`:

```ts
import type { ItemSourceKind, ListQueryParams, ListRange, ListShow } from '@onehuman/schemas';

export const RANGE_LABELS: Record<ListRange, string> = {
  today: 'Today',
  this_week: 'This week',
  this_month: 'This month',
  last_month: 'Last month',
  all: 'All time',
};
export const SHOW_LABELS: Record<ListShow | 'all', string> = { all: 'All', problems: 'Has problems', not_checked: 'Not checked', checked: 'Checked' };
export const SOURCE_LABELS: Record<ItemSourceKind, string> = { manual: 'By hand', call: 'Phone call', agent: 'AI agent', sample: 'Sample data' };

/** What a list page shows. `range: 'custom'` uses `from` and `to`. */
export interface ListView {
  range: ListRange | 'custom';
  from: string;
  to: string;
  q: string;
  filters: Record<string, string>;
  source: ItemSourceKind | '';
  show: ListShow | 'all';
  sort: string;
  page: number;
}

export function initialView(hasDate: boolean): ListView {
  return { range: hasDate ? 'this_month' : 'all', from: '', to: '', q: '', filters: {}, source: '', show: 'all', sort: '', page: 1 };
}

/** The API query for what the page shows. */
export function listParams(v: ListView): ListQueryParams {
  const filters = Object.fromEntries(Object.entries(v.filters).filter(([, x]) => x));
  const q = v.q.trim();
  return {
    ...(v.range === 'custom' ? (v.from && v.to ? { from: v.from, to: v.to } : { range: 'all' as const }) : { range: v.range }),
    ...(q ? { q } : {}),
    ...(v.source ? { source: v.source } : {}),
    ...(v.show !== 'all' ? { show: v.show } : {}),
    ...(v.sort ? { sort: v.sort } : {}),
    ...(v.page > 1 ? { page: v.page } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
  };
}

/** Clicking a column header: ascending, then descending, then back to the list's own order. */
export function nextSort(current: string, field: string): string {
  if (current === `${field}:asc`) return `${field}:desc`;
  if (current === `${field}:desc`) return '';
  return `${field}:asc`;
}

export function sortMark(current: string, field: string): string {
  return current === `${field}:asc` ? ' ↑' : current === `${field}:desc` ? ' ↓' : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reference with no title to show: the words as typed, or "a removed item" for an id (ids are never shown). */
export function referenceText(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  return typeof v === 'string' && UUID.test(v) ? 'a removed item' : String(v);
}

/** "bills-2026-10-14.csv", dated in the viewer's own time. */
export function csvFileName(label: string, now = new Date()): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
  const day = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return `${slug}-${day}.csv`;
}

/** Excel reads a CSV as UTF-8 (₹, Indian names) only with a byte order mark, which fetch's text() drops. */
export function withBom(text: string): string {
  return text.startsWith('﻿') ? text : `﻿${text}`;
}

/** Hands the viewer a file made in the page; nothing goes in a URL but a local blob. */
export function saveText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([withBom(text)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

Create `master-ai-web/src/lib/record-values.ts`:

```ts
import type { EntityField } from '@onehuman/schemas';

/** A stored value as a form input holds it: text for inputs, a boolean for checkboxes. Date-times show in the viewer's time. */
export function formValue(field: EntityField, v: unknown): string | boolean {
  if (field.type === 'boolean') return v === true;
  if (v === undefined || v === null) return '';
  if (field.type === 'datetime' && typeof v === 'string') {
    const at = new Date(v);
    if (Number.isNaN(at.getTime())) return '';
    return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
  if (field.type === 'date' && typeof v === 'string') return v.slice(0, 10);
  return String(v);
}

/** A form value as it is stored: numbers as numbers, date-times in UTC, blanks as null. */
export function dataValue(field: EntityField, raw: string | boolean | undefined): unknown {
  if (field.type === 'boolean') return raw === true;
  if (raw === undefined || raw === '' || raw === false) return null;
  const text = String(raw);
  if (field.type === 'money' || field.type === 'number' || field.type === 'integer') return Number(text);
  if (field.type === 'datetime') {
    const at = new Date(text);
    return Number.isNaN(at.getTime()) ? text : at.toISOString();
  }
  return text;
}
```

- [ ] **Step 4: Navigation, routes, live refresh**

In `master-ai-web/src/lib/nav.ts`:
- **Imports:** replace `Database` with `ListChecks`.
- **The Records line:** remove `{ to: '/records', label: 'Records', icon: Database, managersOnly: true },`.
- **After the Cases line**, add:

```ts
  { to: '/lists', label: 'Lists', icon: ListChecks, managersOnly: true },
```

In `master-ai-web/src/main.tsx`, replace the `records` route with:

```tsx
          { path: 'lists', lazy: () => import('@/routes/lists').then((m) => ({ Component: m.ListsPage })) },
          { path: 'lists/:id', lazy: () => import('@/routes/list').then((m) => ({ Component: m.ListPage })) },
          { path: 'records', element: <Navigate to="/lists" replace /> },
```

In `master-ai-web/src/lib/realtime.ts`, replace the line `if (area === 'record' || area === 'action') void queryClient.invalidateQueries({ queryKey: ['records'] });` with:

```ts
        if (area === 'record' || area === 'action') {
          for (const key of ['records', 'lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [key] });
        }
```

Delete `master-ai-web/src/routes/records.tsx`: `git rm master-ai-web/src/routes/records.tsx`.

- [ ] **Step 5: The form (create and edit)**

Create `master-ai-web/src/components/record-form.tsx`:

```tsx
import { useState, type SelectHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EntityDef, EntityField } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { referenceText } from '@/lib/lists';
import { dataValue, formValue } from '@/lib/record-values';
import { cn } from '@/lib/utils';

/** Pick an item of the record type a reference field points at, by its title. */
export function ReferenceSelect({
  field,
  entities,
  anyLabel = '—',
  currentTitle,
  ...props
}: { field: EntityField; entities: EntityDef[]; anyLabel?: string; currentTitle?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const target = entities.find((e) => e.name === field.ref);
  const items = useQuery({ queryKey: ['records', field.ref], queryFn: () => api.records.list(field.ref!), enabled: !!field.ref });
  const titleField = target?.title_field ?? target?.fields.find((f) => f.type === 'string')?.name;
  const options = (items.data ?? []).map((r) => ({ id: r.id, title: titleField && r.data[titleField] ? String(r.data[titleField]) : (target?.label ?? 'Item') }));
  const value = typeof props.value === 'string' ? props.value : '';
  return (
    <Select {...props}>
      <option value="">{anyLabel}</option>
      {value && !options.some((o) => o.id === value) && <option value={value}>{currentTitle ?? referenceText(value)}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.title}
        </option>
      ))}
    </Select>
  );
}

/**
 * Schema-driven form for one item, rendered from the pack's entity, so a new
 * organization type needs no app release. With `initial` it edits: blanks are
 * sent as null so a field can be cleared.
 */
export function RecordForm({
  entity,
  entities,
  initial,
  titles,
  submitLabel,
  withNote = false,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  entity: EntityDef;
  entities: EntityDef[];
  initial?: Record<string, unknown>;
  titles?: Record<string, string>;
  submitLabel: string;
  withNote?: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (data: Record<string, unknown>, note: string) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(entity.fields.map((f) => [f.name, formValue(f, initial?.[f.name])])));
  const [note, setNote] = useState('');
  const set = (name: string, v: string | boolean) => setValues((s) => ({ ...s, [name]: v }));

  const input = (f: EntityField) => {
    const id = `f-${f.name}`;
    const common = { id, required: f.required, value: String(values[f.name] ?? ''), onChange: (e: { target: { value: string } }) => set(f.name, e.target.value) };
    switch (f.type) {
      case 'enum':
        return (
          <Select {...common}>
            <option value="">—</option>
            {f.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        );
      case 'reference':
        return <ReferenceSelect {...common} field={f} entities={entities} currentTitle={titles?.[f.name]} />;
      case 'text':
        return <Textarea {...common} rows={2} />;
      case 'boolean':
        return <input id={id} type="checkbox" checked={values[f.name] === true} onChange={(e) => set(f.name, e.target.checked)} className="size-4 accent-[var(--oh-primary)]" />;
      default: {
        const type = { number: 'number', money: 'number', integer: 'number', date: 'date', datetime: 'datetime-local', email: 'email', phone: 'tel' }[f.type as string] ?? 'text';
        return <Input {...common} type={type} step={f.type === 'integer' ? 1 : 'any'} />;
      }
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data: Record<string, unknown> = {};
        for (const f of entity.fields) {
          const v = dataValue(f, values[f.name]);
          if (initial || v !== null) data[f.name] = v;
        }
        onSubmit(data, note.trim());
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {entity.fields.map((f) => (
          <div key={f.name} className={cn(f.type === 'text' && 'sm:col-span-2')}>
            <Field label={`${f.label}${f.required ? ' *' : ''}`} htmlFor={`f-${f.name}`} hint={f.description}>
              {input(f)}
            </Field>
          </div>
        ))}
      </div>
      {withNote && (
        <Field label="Why the change (optional)" htmlFor="f-change-note">
          <Input id="f-change-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 6: The item drawer**

Create `master-ai-web/src/components/list-item-panel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Pencil, Trash2, X } from 'lucide-react';
import type { EntityDef, ListMeta } from '@onehuman/schemas';
import { RecordForm } from '@/components/record-form';
import { Button } from '@/components/ui/button';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { referenceText } from '@/lib/lists';
import { recordCell } from '@/lib/record-cell';
import { timeAgo } from '@/lib/utils';

type Mode = 'view' | 'edit' | 'check' | 'remove';

/** One item: how it came in, its problems, its details and history. Correct it, check it or remove it. */
export function ListItemPanel({
  list,
  itemId,
  entities,
  onClose,
  onOpen,
}: {
  list: ListMeta;
  itemId: string;
  entities: EntityDef[];
  onClose: () => void;
  onOpen: (itemId: string) => void;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['list-item', list.id, itemId], queryFn: () => api.lists.item(list.id, itemId) });
  const [mode, setMode] = useState<Mode>('view');
  const [text, setText] = useState('');
  useEffect(() => {
    setMode('view');
    setText('');
  }, [itemId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const done = () => {
    setMode('view');
    setText('');
    for (const key of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const update = useMutation({
    mutationFn: (v: { data: Record<string, unknown>; note: string }) => api.lists.update(list.id, itemId, { data: v.data, ...(v.note ? { note: v.note } : {}) }),
    onSuccess: done,
  });
  const check = useMutation({ mutationFn: () => api.lists.check(list.id, itemId, text.trim() ? { note: text.trim() } : {}), onSuccess: done });
  const remove = useMutation({
    mutationFn: () => api.lists.remove(list.id, itemId, text.trim()),
    onSuccess: () => {
      done();
      onClose();
    },
  });

  const d = detail.data;
  const open = d?.item.problems.filter((p) => !p.acknowledged) ?? [];
  const seen = d?.item.problems.filter((p) => p.acknowledged) ?? [];

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-background/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside role="dialog" aria-modal="true" aria-labelledby="item-title" className="glass h-full w-full overflow-y-auto p-6 sm:max-w-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-fg-muted">{list.entity.label}</p>
            <h2 id="item-title" className="font-display text-2xl text-fg">
              {d?.item.title ?? '…'}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        {detail.isLoading && <Spinner />}
        {d && (
          <div className="mt-4 space-y-6">
            <p className="text-sm text-fg-body">
              Came in: <span className="text-fg">{d.item.source.label}</span>
              {' · '}
              {d.item.checked ? (
                <span className="text-success">
                  Checked by {d.item.checked.by}, {timeAgo(d.item.checked.at)}
                  {d.item.checked.note && <span className="text-fg-body"> — “{d.item.checked.note}”</span>}
                </span>
              ) : (
                <span className="text-fg-muted">Not checked</span>
              )}
            </p>

            {(open.length > 0 || seen.length > 0) && (
              <section aria-label="Problems" className="space-y-2">
                {open.map((p) => (
                  <p key={p.key} className="flex gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      {p.message}
                      {p.relatedId && (
                        <>
                          {' · '}
                          <button type="button" className="underline" onClick={() => onOpen(p.relatedId!)}>
                            open the other one
                          </button>
                        </>
                      )}
                    </span>
                  </p>
                ))}
                {seen.map((p) => (
                  <p key={p.key} className="flex gap-2 px-3 text-sm text-fg-muted">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{p.message} (seen)</span>
                  </p>
                ))}
              </section>
            )}

            {mode === 'view' && (
              <div className="flex flex-wrap gap-2">
                <Button variant="success" size="sm" loading={check.isPending} onClick={() => (open.length ? setMode('check') : check.mutate())}>
                  <CheckCircle2 /> Mark as checked
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setMode('edit')}>
                  <Pencil /> Edit
                </Button>
                <Button variant="danger" size="sm" onClick={() => setMode('remove')}>
                  <Trash2 /> Remove
                </Button>
              </div>
            )}
            {mode === 'check' && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  check.mutate();
                }}
              >
                <Field label="Why is it right as it is?" htmlFor="check-note">
                  <Textarea id="check-note" rows={2} value={text} onChange={(e) => setText(e.target.value)} required />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="success" loading={check.isPending}>
                    Mark as checked
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setMode('view')}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {mode === 'remove' && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  remove.mutate();
                }}
              >
                <Field label="Why remove it?" htmlFor="remove-reason" hint="The audit trail keeps a full copy.">
                  <Textarea id="remove-reason" rows={2} value={text} onChange={(e) => setText(e.target.value)} required minLength={3} />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" loading={remove.isPending}>
                    Remove
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setMode('view')}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {mode === 'edit' ? (
              <RecordForm
                entity={list.entity}
                entities={entities}
                initial={d.item.data}
                titles={d.item.titles}
                withNote
                submitLabel="Save changes"
                pending={update.isPending}
                error={update.error}
                onSubmit={(data, note) => update.mutate({ data, note })}
                onCancel={() => setMode('view')}
              />
            ) : (
              <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2 text-sm">
                {list.entity.fields.map((f) => (
                  <div key={f.name} className="contents">
                    <dt className="text-fg-muted">{f.label}</dt>
                    <dd className="break-words text-fg">
                      {f.type === 'reference' ? (d.item.titles[f.name] ?? referenceText(d.item.data[f.name])) : recordCell(f, d.item.data[f.name])}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <section aria-label="History">
              <h3 className="text-sm font-medium text-fg">History</h3>
              <ol className="mt-2 space-y-2 text-sm">
                {d.history.map((e, i) => (
                  <li key={i} className="text-fg-body">
                    <span className="text-fg">{e.who}</span> {e.kind === 'created' ? 'added it' : e.kind === 'checked' ? 'checked it' : 'changed it'}
                    {' · '}
                    <span className="text-fg-muted">{timeAgo(e.at)}</span>
                    {e.changes.length > 0 && (
                      <ul className="ml-4 list-disc text-fg-muted">
                        {e.changes.map((c) => (
                          <li key={c.field}>
                            {c.label}: {c.from} → {c.to}
                          </li>
                        ))}
                      </ul>
                    )}
                    {e.note && <p className="text-fg-muted">“{e.note}”</p>}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
        <ErrorNote error={detail.error ?? update.error ?? check.error ?? remove.error} className="mt-4" />
      </aside>
    </div>
  );
}
```

- [ ] **Step 7: The Lists overview page**

Create `master-ai-web/src/routes/lists.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ListChecks } from 'lucide-react';
import { Link } from 'react-router';
import type { ListSummary } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { formatInr } from '@/lib/utils';

function ListCard({ list }: { list: ListSummary }) {
  const sumField = list.card.sumField ? list.entity.fields.find((f) => f.name === list.card.sumField) : undefined;
  return (
    <Link to={`/lists/${list.id}`} className="glass block rounded-lg p-5 transition-colors hover:border-primary/50">
      <p className="font-display text-lg text-fg">{list.label}</p>
      <p className="mt-3 text-2xl font-semibold text-fg">
        {list.card.count} <span className="text-sm font-normal text-fg-muted">{list.card.countLabel}</span>
      </p>
      {list.card.sum !== null && (
        <p className="mt-1 text-sm text-fg-body">
          {sumField?.type === 'money' ? formatInr(list.card.sum) : list.card.sum.toLocaleString('en-IN')} {list.card.sumLabel}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {list.card.problems > 0 && (
          <Chip tone="danger">
            <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />
            {list.card.problems} with problems
          </Chip>
        )}
        {list.card.notChecked > 0 && <Chip tone="waiting">{list.card.notChecked} not checked</Chip>}
      </div>
    </Link>
  );
}

/** The head's view: each list the organization keeps, with what needs checking. */
export function ListsPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ['lists'], queryFn: api.lists.overview });
  const removeSamples = useMutation({
    mutationFn: api.lists.removeSamples,
    onSuccess: () => {
      for (const key of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  if (overview.isLoading) return <Spinner />;
  const lists = overview.data?.lists ?? [];
  const main = lists.filter((l) => l.main);
  const other = lists.filter((l) => !l.main);
  const samples = overview.data?.samples ?? 0;

  return (
    <div>
      <PageHeader
        lead="Your"
        title="lists."
        description="Everything your organization keeps track of, with totals. Problems are found for you: check each item, or correct it."
        action={
          samples > 0 && (
            <Button
              variant="secondary"
              loading={removeSamples.isPending}
              onClick={() => {
                if (window.confirm(`Remove all ${samples} sample items? Items your team or agents added stay.`)) removeSamples.mutate();
              }}
            >
              Remove sample data
            </Button>
          )
        }
      />
      {lists.length === 0 && (
        <EmptyState icon={<ListChecks />} title="No lists yet">
          Install an industry pack first.
        </EmptyState>
      )}
      {main.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {main.map((l) => (
            <ListCard key={l.id} list={l} />
          ))}
        </div>
      )}
      {other.length > 0 && (
        <section className="mt-10" aria-labelledby="other-lists">
          <h2 id="other-lists" className="text-sm font-medium text-fg-muted">
            Other lists
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {other.map((l) => (
              <li key={l.id}>
                <Link to={`/lists/${l.id}`} className="glass flex items-center justify-between rounded-md px-4 py-3 text-sm text-fg hover:text-accent">
                  <span>{l.label}</span>
                  <span className="text-fg-muted">
                    {l.card.count} {l.card.countLabel}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ErrorNote error={overview.error ?? removeSamples.error} className="mt-4" />
    </div>
  );
}
```

- [ ] **Step 8: One list's page**

Create `master-ai-web/src/routes/list.tsx`:

```tsx
import { useDeferredValue, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Plus, Search } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import type { EntityDef, EntityField, ItemSourceKind, ListItem, ListQueryParams, ListRange, ListShow } from '@onehuman/schemas';
import { ListItemPanel } from '@/components/list-item-panel';
import { RecordForm, ReferenceSelect } from '@/components/record-form';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import {
  csvFileName,
  initialView,
  listParams,
  nextSort,
  RANGE_LABELS,
  referenceText,
  saveText,
  SHOW_LABELS,
  sortMark,
  SOURCE_LABELS,
  type ListView,
} from '@/lib/lists';
import { recordCell } from '@/lib/record-cell';
import { usePageTitle } from '@/lib/title';
import { cn, formatInr } from '@/lib/utils';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const chip = (on: boolean) => cn('rounded-full border px-3 py-1 text-sm', on ? 'border-primary bg-primary-soft text-primary' : 'border-border text-fg-muted hover:text-fg');

function FilterControl({ field, entities, value, onChange }: { field: EntityField; entities: EntityDef[]; value: string; onChange: (v: string) => void }) {
  if (field.type === 'enum' && (field.options?.length ?? 0) <= 6) {
    return (
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={field.label}>
        <span className="mr-1 text-xs text-fg-muted">{field.label}</span>
        {['', ...(field.options ?? [])].map((o) => (
          <button key={o || 'all'} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={chip(value === o)}>
            {o ? capitalize(o) : 'All'}
          </button>
        ))}
      </div>
    );
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-xs text-fg-muted">{field.label}</span>
      {field.type === 'reference' ? (
        <ReferenceSelect field={field} entities={entities} anyLabel="Any" value={value} onChange={(e) => onChange(e.target.value)} className="w-auto" />
      ) : (
        <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto">
          <option value="">Any</option>
          {field.type === 'boolean' ? (
            <>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </>
          ) : (
            field.options?.map((o) => (
              <option key={o} value={o}>
                {capitalize(o)}
              </option>
            ))
          )}
        </Select>
      )}
    </label>
  );
}

function Status({ item }: { item: ListItem }) {
  const open = item.problems.filter((p) => !p.acknowledged);
  if (open.length) {
    return (
      <span className="inline-flex items-center gap-1 text-danger" title={open.map((p) => p.message).join('\n')}>
        <AlertTriangle className="size-4" aria-hidden />
        {open.length}
        <span className="sr-only"> problem{open.length === 1 ? '' : 's'}</span>
      </span>
    );
  }
  if (item.checked) {
    return (
      <span className="inline-flex text-success" title={`Checked by ${item.checked.by}`}>
        <CheckCircle2 className="size-4" aria-hidden />
        <span className="sr-only">Checked</span>
      </span>
    );
  }
  return <span className="text-xs text-fg-muted">Not checked</span>;
}

/** One list: filters, totals over every match, problems, bulk check, download, and the item drawer. */
export function ListPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const openItem = params.get('item');
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ['lists'], queryFn: api.lists.overview });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const meta = overview.data?.lists.find((l) => l.id === id);
  const entities = workspaces.data?.[0]?.pack.entities ?? [];
  const [view, setView] = useState<ListView | null>(null);
  const v = view ?? initialView(!!meta?.dateField);
  // Deferred as a string: a new object every render would make React re-render without end. Typing in search stays smooth.
  const queryKey = useDeferredValue(JSON.stringify(listParams(v)));
  const set = (patch: Partial<ListView>) => setView({ ...v, page: 1, ...patch });
  const page = useQuery({
    queryKey: ['list', id, queryKey],
    queryFn: () => api.lists.page(id, JSON.parse(queryKey) as ListQueryParams),
    enabled: !!meta,
    placeholderData: keepPreviousData,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  usePageTitle(meta?.label ?? 'Lists');

  const refresh = () => {
    for (const key of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.lists.create(id, data),
    onSuccess: () => {
      setAdding(false);
      refresh();
    },
  });
  const checkMany = useMutation({
    mutationFn: () => api.lists.checkMany(id, [...selected]),
    onSuccess: (r) => {
      setSelected(new Set());
      setNote(`Checked ${r.checked}${r.skipped ? `, skipped ${r.skipped} with problems` : ''}.`);
      refresh();
    },
  });
  const download = useMutation({ mutationFn: () => api.lists.exportCsv(id, listParams(v)), onSuccess: (text) => saveText(csvFileName(meta!.label), text) });
  const openOne = (itemId: string) =>
    setParams((p) => {
      p.set('item', itemId);
      return p;
    });

  if (overview.isLoading) return <Spinner />;
  if (!meta) return <EmptyState title="This list isn't here">It may belong to another kind of organization.</EmptyState>;

  const field = (name: string) => meta.entity.fields.find((f) => f.name === name)!;
  const columns = meta.columns.map(field);
  const items = page.data?.items ?? [];
  const singular = meta.entity.label.toLowerCase();
  const total = (f: EntityField, n: number) => (f.type === 'money' ? formatInr(n) : n.toLocaleString('en-IN'));

  return (
    <div>
      <PageHeader
        title={meta.label}
        description={meta.entity.description}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate()}>
              <Download /> Download
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus /> New {singular}
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {meta.dateField && (
              <Select aria-label="Date range" value={v.range} onChange={(e) => set({ range: e.target.value as ListView['range'] })} className="w-auto">
                {(Object.keys(RANGE_LABELS) as ListRange[]).map((r) => (
                  <option key={r} value={r}>
                    {RANGE_LABELS[r]}
                  </option>
                ))}
                <option value="custom">Pick dates…</option>
              </Select>
            )}
            {v.range === 'custom' && (
              <>
                <Input type="date" aria-label="From" value={v.from} onChange={(e) => set({ from: e.target.value })} className="w-auto" />
                <Input type="date" aria-label="To" value={v.to} onChange={(e) => set({ to: e.target.value })} className="w-auto" />
              </>
            )}
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-fg-muted" aria-hidden />
              <Input value={v.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search" aria-label="Search this list" className="pl-8" />
            </div>
            <Select aria-label="Came in" value={v.source} onChange={(e) => set({ source: e.target.value as ItemSourceKind | '' })} className="w-auto">
              <option value="">Came in any way</option>
              {(Object.keys(SOURCE_LABELS) as ItemSourceKind[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          {meta.filters.map((name) => (
            <FilterControl key={name} field={field(name)} entities={entities} value={v.filters[name] ?? ''} onChange={(value) => set({ filters: { ...v.filters, [name]: value } })} />
          ))}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
            {(Object.keys(SHOW_LABELS) as (ListShow | 'all')[]).map((s) => (
              <button key={s} type="button" aria-pressed={v.show === s} onClick={() => set({ show: s })} className={chip(v.show === s)}>
                {SHOW_LABELS[s]}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        {adding && (
          <CardBody className="border-b border-line-10">
            <RecordForm
              entity={meta.entity}
              entities={entities}
              submitLabel={`Save ${singular}`}
              pending={create.isPending}
              error={create.error}
              onSubmit={(data) => create.mutate(data)}
              onCancel={() => setAdding(false)}
            />
          </CardBody>
        )}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line-10 px-5 py-2.5 text-sm">
            <span>{selected.size} selected</span>
            <Button size="sm" variant="success" loading={checkMany.isPending} onClick={() => checkMany.mutate()}>
              <CheckCircle2 /> Mark as checked
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
        {note && (
          <p role="status" className="border-b border-line-10 px-5 py-2.5 text-sm text-fg-body">
            {note}
          </p>
        )}
        {page.isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title={`No ${meta.label.toLowerCase()} here`}>Try another date range, or clear the filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-fg-muted">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      checked={items.every((i) => selected.has(i.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                      className="size-4 accent-[var(--oh-primary)]"
                    />
                  </th>
                  {columns.map((c) => (
                    <th key={c.name} className="px-3 py-2 font-medium">
                      <button type="button" className="hover:text-fg" onClick={() => set({ sort: nextSort(v.sort, c.name) })}>
                        {c.label}
                        {sortMark(v.sort, c.name)}
                      </button>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Came in</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="sr-only">Checks</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-10">
                {items.map((item) => (
                  <tr key={item.id} className="cursor-pointer hover:bg-line-5" onClick={() => openOne(item.id)}>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.title}`}
                        checked={selected.has(item.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setSelected(next);
                        }}
                        className="size-4 accent-[var(--oh-primary)]"
                      />
                    </td>
                    {columns.map((c) => (
                      <td key={c.name} className="max-w-xs truncate px-3 py-2.5 text-fg">
                        {c.type === 'reference' ? (item.titles[c.name] ?? referenceText(item.data[c.name])) : recordCell(c, item.data[c.name])}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{item.source.label}</td>
                    <td className="px-3 py-2.5">
                      <Status item={item} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-10 px-5 py-3 text-sm">
            <span className="font-medium text-fg">
              {page.data.total} {page.data.total === 1 ? singular : meta.label.toLowerCase()}
            </span>
            {meta.totals.map((name) => (
              <span key={name} className="text-fg-body">
                {field(name).label} {total(field(name), page.data!.totals[name] ?? 0)}
              </span>
            ))}
            {page.data.undated > 0 && meta.dateField && (
              <button type="button" className="text-accent hover:underline" onClick={() => set({ range: 'all' })}>
                {page.data.undated} {page.data.undated === 1 ? 'has' : 'have'} no {field(meta.dateField).label.toLowerCase()}: show all time
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={v.page <= 1} onClick={() => setView({ ...v, page: v.page - 1 })}>
                Previous
              </Button>
              <span className="text-fg-muted">
                Page {v.page} of {Math.max(1, Math.ceil(page.data.total / page.data.pageSize))}
              </span>
              <Button size="sm" variant="ghost" disabled={v.page * page.data.pageSize >= page.data.total} onClick={() => setView({ ...v, page: v.page + 1 })}>
                Next
              </Button>
            </div>
          </div>
        )}
        <ErrorNote error={page.error ?? create.error ?? checkMany.error ?? download.error} className="m-5" />
      </Card>

      {openItem && (
        <ListItemPanel
          list={meta}
          itemId={openItem}
          entities={entities}
          onOpen={openOne}
          onClose={() =>
            setParams((p) => {
              p.delete('item');
              return p;
            })
          }
        />
      )}
    </div>
  );
}
```

- [ ] **Step 9: The update banner shows the new additions**

In `master-ai-web/src/components/pack-updates.tsx`:
- after `const routines = u.routines ?? [];`, add:

```tsx
  const registers = u.registers ?? [];
  const entities = u.entities ?? [];
  const fieldCount = (u.fields ?? []).reduce((n, x) => n + x.fields.length, 0);
```

- in the "nothing to show" check, add `+ registers.length + entities.length + fieldCount` to the sum;
- add `'lists'` to the list of query keys invalidated in `apply`'s `onSuccess`;
- add these items inside the `<ul>`, after the routines items:

```tsx
            {registers.map((r) => (
              <li key={r.id}><span className="font-medium text-fg">{r.label ?? r.entity}</span> <span className="text-fg-muted">· a list on the Lists page</span></li>
            ))}
            {entities.map((e) => (
              <li key={e.name}><span className="font-medium text-fg">{e.plural_label ?? e.label}</span> <span className="text-fg-muted">· a new kind of record</span></li>
            ))}
            {fieldCount > 0 && <li className="text-fg-muted">plus {fieldCount} new field{fieldCount === 1 ? '' : 's'} on records you have</li>}
```

- [ ] **Step 10: Run the web checks**

Run: `pnpm build:packages && pnpm --filter @onehuman/web test && pnpm --filter @onehuman/web typecheck && pnpm --filter @onehuman/web build`
Expected: PASS. This includes `bundle.test.ts`, which requires `import('@/routes/lists')` and `import('@/routes/list')` in `main.tsx` and only type imports from `@onehuman/schemas`.

- [ ] **Step 11: Commit**

```bash
git add master-ai-web
git commit -m "feat(web): Lists replaces Records: cards, filters, totals, problems, checking, edits with history, download

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Types described in the owner's own words name their main lists

**Files:**
- Modify: `master-ai-backend/src/packs/generator.service.ts`
- Test: `master-ai-backend/__tests__/unit/packs/main-lists.test.ts` (create)

**Interfaces:**
- Consumes: `defaultRegisterId` (agent-kit).
- Produces:
  - `export function mainListRegisters(ownEntities: string[], mainLists: string[]): { id: string; entity: string; main: true }[]`;
  - the model answer gains `main_lists: string[]`.

- [ ] **Step 1: Write the failing test**

Create `master-ai-backend/__tests__/unit/packs/main-lists.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mainListRegisters } from '../../../src/packs/generator.service';

describe("the model's main lists", () => {
  it("become lists of the pack's own record types, at most four, each once", () => {
    expect(mainListRegisters(['LabOrder', 'Sample', 'Invoice', 'Doctor', 'Bed'], ['LabOrder', 'Customer', 'LabOrder', 'Invoice', 'Sample', 'Doctor', 'Bed'])).toEqual([
      { id: 'lab-order', entity: 'LabOrder', main: true },
      { id: 'invoice', entity: 'Invoice', main: true },
      { id: 'sample', entity: 'Sample', main: true },
      { id: 'doctor', entity: 'Doctor', main: true },
    ]);
  });

  it('gives none when the model names none of its own', () => {
    expect(mainListRegisters(['LabOrder'], ['Customer'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @onehuman/backend test -- main-lists`
Expected: FAIL. `mainListRegisters` is not exported.

- [ ] **Step 3: Ask for main lists and map them**

In `master-ai-backend/src/packs/generator.service.ts`:
- **Imports:** add `defaultRegisterId` to the `@onehuman/agent-kit` import.
- **`GenPackSchema`:** right after the `entities: z.array(…),` entry, add:

```ts
  /** Up to four of this pack's own entity names the head most needs to see as lists (bills, tickets, site issues…). */
  main_lists: z.array(z.string()),
```

- **The `SYSTEM` prompt:** after the "- Entities: …" bullet, add this line:

```
- Main lists: in "main_lists", name up to 4 of your own entities (by name) that the head of the organization most needs to see as lists to check, for example bills, tickets or site issues.
```

- **`toPack`'s object:** after `entities: …,`, add:

```ts
      registers: mainListRegisters(g.entities.map((e) => e.name), g.main_lists),
```

- **Below `pickSetup`:** add:

```ts
/** The model's main lists → lists with default settings, for its own record types only, at most four. */
export function mainListRegisters(ownEntities: string[], mainLists: string[]): { id: string; entity: string; main: true }[] {
  const own = new Set(ownEntities);
  return [...new Set(mainLists)]
    .filter((name) => own.has(name))
    .slice(0, 4)
    .map((name) => ({ id: defaultRegisterId(name), entity: name, main: true as const }));
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @onehuman/backend test -- main-lists generator && pnpm --filter @onehuman/backend typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add master-ai-backend/src/packs/generator.service.ts master-ai-backend/__tests__/unit/packs/main-lists.test.ts
git commit -m "feat(packs): a pack the model writes names its main lists

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Every type's lists, older companies, and the browser journey

**Files:**
- Create: `master-ai-backend/__tests__/integration/sector-lists.spec.ts`
- Modify: `master-ai-backend/scripts/sectors.mts` (every list opens; the main lists match the pack)
- Create: `master-ai-web/__tests__/e2e/lists.spec.ts`
- Modify: `master-ai-web/__tests__/e2e/features.spec.ts` (remove the Records test and "and Records" from its header comment)

**Interfaces:**
- Consumes: everything above.
- Produces: tests only.

- [ ] **Step 1: The all-types integration spec**

Create `master-ai-backend/__tests__/integration/sector-lists.spec.ts`:

```ts
import { ORG_TYPES } from '@onehuman/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListsService } from '../../src/lists/lists.service';
import { OnboardingService } from '../../src/tenancy/onboarding.service';
import { boot, newOrg, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await boot();
});
afterAll(() => h.close());

describe.each(ORG_TYPES.map((t) => t.id))('%s', (orgType) => {
  it('opens every list with each view, sort and filter, and downloads it', async () => {
    const org = await newOrg(h, orgType);
    const lists = h.get(ListsService);
    const overview = await lists.overview(org.tenantId);
    expect(overview.lists.some((l) => l.main)).toBe(true);
    for (const l of overview.lists) {
      const all = await lists.page(org.tenantId, l.id, { range: 'all' });
      expect(all.total, `${l.id} has its sample items`).toBeGreaterThan(0);
      for (const show of ['problems', 'not_checked', 'checked']) await lists.page(org.tenantId, l.id, { range: 'all', show });
      for (const column of l.columns) await lists.page(org.tenantId, l.id, { range: 'all', sort: `${column}:desc` });
      for (const name of l.filters) {
        const field = l.entity.fields.find((f) => f.name === name)!;
        const value = field.type === 'enum' ? field.options![0]! : field.type === 'boolean' ? 'true' : String(all.items[0]!.data[name] ?? '');
        if (value) await lists.page(org.tenantId, l.id, { range: 'all', [`f.${name}`]: value });
      }
      if (l.dateField) await lists.page(org.tenantId, l.id, {});
      await lists.exportCsv(org.tenantId, l.id, { range: 'all' });
    }
  });
});

describe('a company set up before these lists', () => {
  it('gets the new record type and lists from the update banner, and they open', async () => {
    const org = await newOrg(h, 'it-services');
    await h.owner.query(
      `update workspaces set pack = jsonb_set(pack - 'registers', '{entities}',
         (select jsonb_agg(e) from jsonb_array_elements(pack->'entities') e where e->>'name' <> 'Ticket')) where id = $1`,
      [org.workspaceId],
    );
    const onboarding = h.get(OnboardingService);
    const updates = await onboarding.updates(org.tenantId, org.workspaceId);
    expect(updates.entities.map((e) => e.name)).toEqual(['Ticket']);
    expect(updates.registers.map((r) => r.id)).toEqual(expect.arrayContaining(['tickets', 'incidents', 'assets', 'contracts']));
    await onboarding.applyUpdates(org.session, org.workspaceId);
    const lists = h.get(ListsService);
    expect((await lists.overview(org.tenantId)).lists.filter((l) => l.main).map((l) => l.id)).toEqual(['tickets', 'incidents', 'assets', 'contracts']);
    await expect(lists.page(org.tenantId, 'tickets', { range: 'all' })).resolves.toMatchObject({ list: { id: 'tickets' } });
  });
});
```

Run: `pnpm test:integration -- sector-lists`
Expected: PASS for all 15 types and the update test. A failure names the type and list. A SQL error here means a check in that pack's YAML compiles to something Postgres refuses; fix the check, or the compiler in `sql.ts` (with a test in `lists.spec.ts` that reproduces it first).

- [ ] **Step 2: The end-to-end sector run checks the lists too**

In `master-ai-backend/scripts/sectors.mts`, add `import { registersOf } from '@onehuman/agent-kit';` to the imports. In `runOne`, directly after the line `log(\`${run.id}: installed\`, …);`, add:

```ts
    // Every list opens, and the type has exactly its pack's main lists.
    const lists = await owner.lists.overview();
    const wantMain = registersOf(org.ws.pack).filter((r) => r.main).map((r) => r.id);
    const gotMain = lists.lists.filter((l) => l.main).map((l) => l.id);
    if (gotMain.join() !== wantMain.join()) throw new Error(`main lists ${gotMain.join(', ') || 'none'}, expected ${wantMain.join(', ') || 'none'}`);
    for (const l of lists.lists) await owner.lists.page(l.id, { range: 'all' });
    log(`${run.id}: lists`, `${gotMain.join(', ') || 'default lists only'} (${lists.lists.length} open)`);
```

Run (with `LLM_OFFLINE=always pnpm dev` running in another terminal): `pnpm e2e:sectors --only wholesale-retail`
Expected: the run passes, and its log shows `wholesale-retail: lists  bills, orders, parties, products (6 open)`.

- [ ] **Step 3: The browser journey**

Create `master-ai-web/__tests__/e2e/lists.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { newOrganization, signInAs } from './helpers';

/** India's date, which "This month" uses. */
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

test('the head finds a bill that does not add up, accepts it with a note, corrects it and downloads the list', async ({ page }) => {
  const org = await newOrganization('wholesale-retail');
  const party = (await org.api.lists.page('parties', { range: 'all' })).items[0]!;
  await org.api.lists.create('bills', {
    billNo: 'E2E-1', billType: 'sales invoice', party: party.id, billDate: istToday(),
    taxableValue: 40840, gstAmount: 7360, total: 48260, paymentStatus: 'unpaid',
  });
  await signInAs(page, org);

  await page.goto('/lists');
  await page.getByRole('link', { name: /^Bills/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bills' })).toBeVisible();
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Has problems' }).click();
  await page.getByLabel('Search this list').fill('E2E-1');
  await page.getByRole('row', { name: /E2E-1/ }).click();

  const panel = page.getByRole('dialog');
  await expect(panel.getByText("Total ₹48,260 doesn't equal Taxable value + GST amount (₹48,200)")).toBeVisible();
  await panel.getByRole('button', { name: 'Mark as checked' }).click();
  await panel.getByLabel('Why is it right as it is?').fill("Rounded on the party's request");
  await panel.getByRole('button', { name: 'Mark as checked' }).click();
  await expect(panel.getByText(/Checked by Asha Owner/)).toBeVisible();
  await expect(panel.getByText(/\(seen\)$/)).toBeVisible();

  await panel.getByRole('button', { name: 'Edit' }).click();
  await panel.getByLabel('Taxable value').fill('40900');
  await panel.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByText(/doesn't equal/)).toHaveCount(0);
  await expect(panel.getByText('Taxable value: ₹40,840 → ₹40,900')).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByText(/^Total ₹/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const csv = readFileSync((await (await download).path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('E2E-1');
});
```

In `master-ai-web/__tests__/e2e/features.spec.ts`, delete the whole `test('Records search narrows the sample records to the ones that match', …)` block, and change the file's header comment to end "…Team with routines." instead of "…, and Records.".

Run (with `LLM_OFFLINE=always pnpm dev` running): `pnpm e2e -- lists pages features`
Expected: PASS on both the desktop and the 390px phone projects. `pages.spec.ts` now opens Lists from the menu: it needs a heading, the tab title `Lists · ONEHUMAN OS`, no ids and no tool names.

- [ ] **Step 4: Commit**

```bash
git add master-ai-backend/__tests__/integration/sector-lists.spec.ts master-ai-backend/scripts/sectors.mts master-ai-web/__tests__/e2e/lists.spec.ts master-ai-web/__tests__/e2e/features.spec.ts
git commit -m "test(lists): every organization type's lists, older companies via the update banner, and the head's journey in the browser

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: The decision record, the docs, and the whole suite

**Files:**
- Create: `docs/adr/0012-lists-and-checks.md`
- Modify:
  - `docs/adr/README.md` (table row);
  - `README.md` (the Decisions list, and "Records" → "Lists" in the features table);
  - `CLAUDE.md` (two rules);
  - `docs/testing.md` (specs);
  - `docs/known-gaps.md` (what part 1 leaves out).

**Interfaces:**
- Consumes: everything above.
- Produces: docs. `evals/__tests__/docs.test.ts` checks that every ADR is listed in both READMEs and that links resolve.

- [ ] **Step 1: Write the decision record**

Create `docs/adr/0012-lists-and-checks.md`:

```markdown
# 0012. Lists and checks

Date: 2026-10-14 · Status: accepted

## Context
The head of an organization had no way to see the records their kind of organization runs on (a wholesaler's bills, an IT company's tickets, a builder's site issues) as lists to recheck. Records showed one type at a time with a search, and had no filters, totals, history or checks. Nothing recorded how an item came in, and an AI agent's changes weren't audited. The next part adds AI calls that add and update items, which makes rechecking matter more. Design: [sector lists](../superpowers/specs/2026-10-14-sector-lists-design.md).

## Decision
- **Lists are pack data.** `registers:` in a pack names each organization type's lists over its entities: columns, filters, a main date, totals, a card and checks. Every entity without one gets a default list, so older workspaces and types described in the owner's own words have lists too. A pack the model writes names up to four main lists.
- **Six fixed kinds of check:** `missing`, `adds_up`, `limit`, `duplicate`, `overdue` and `expiring`, plus a built-in check that a reference points at a real item. The app compiles them to SQL (`master-ai-backend/src/lists/sql.ts`) and works them out whenever a list is read. A model never evaluates or clears one. A value that isn't a valid number or date reads as blank (`try_numeric`, `try_date`, `try_timestamptz`).
- **Records say how they came in** (`source`: manual, call, agent, sample) and how they were last changed. Every change goes through `RecordsService` and is audited with the old and new values, including an agent's `records.update`.
- **Only people mark items checked:**
  - an owner or admin who adds or edits an item has checked it;
  - anyone else's change clears the check;
  - checking an item with open problems needs a note, and those problems become accepted;
  - a problem that appears later still shows;
  - there is no tool for it.
- **Lists are for the owner and admins** (`@ManagersOnly()`), on the web first.

## Consequences
- A new organization type gets its lists by writing YAML; `pack.test.ts` checks every field a list or check names.
- Checks always match today's date and the current pack, with no nightly job. The cost is working them out on every read. That is fine at the sizes a company keeps; a materialised view is the way out if it ever isn't.
- The audit trail keeps old and new values, and a full copy of each removed item, so the personal details in records also live there.
- Lists in the phone app, role holders seeing their own list, and the AI's calls about items come in later parts.
```

In `docs/adr/README.md`, add after the 0011 row:

```
| [0012](0012-lists-and-checks.md) | Lists and checks | Each organization type's lists are pack data; six fixed checks worked out in SQL when read; only people mark items checked |
```

In `README.md`:
- **Decisions list:** after item 11, add `12. [Lists and checks](docs/adr/0012-lists-and-checks.md)`.
- **Features table, "Web app (Glow)" row:** replace `Records` with `Lists (each organization type's own lists, with totals, problems found for you, corrections and checking)`.

- [ ] **Step 2: The working rules**

In `CLAUDE.md`, under "Rules that are easy to break", add after the "Stage outputs are zod-validated…" bullet:

```markdown
- Lists are pack data (`registers:` in pack YAML, resolved by agent-kit `registersOf`, validated by `validateRegisters`). Their checks are a fixed set compiled to SQL in `master-ai-backend/src/lists/sql.ts` and worked out when a list is read. A model never evaluates or clears a check, and only people mark items checked; there is no tool for it ([ADR 0012](docs/adr/0012-lists-and-checks.md)).
- Every change to a record goes through `RecordsService.create` (with its `source`: manual, call, agent or sample) or `RecordsService.update` (with a `RecordChange`). They audit old and new values, and set or clear the check. Don't write `records` rows anywhere else.
```

- [ ] **Step 3: The testing doc and the known gaps**

In `docs/testing.md`:

1. In the commands table, the `pnpm test:integration` row: change "…the public form and intake API, and the stage service" to "…the public form and intake API, the stage service, and lists with their checks".

2. In the "Integration specs (backend)" table, add these rows:

   ```
   | `record-sources` | How every item came in (by hand, agent, sample) and who checked it; an agent's change clears the check and is audited with old and new values; the backfill; numbers and dates that aren't valid read as blank |
   | `lists` | Each kind of check against real rows (adds up, missing, not found, duplicate pair, overdue in India days, limits, expiring); totals over every match, not one page; date ranges, filters, search taken literally, how items came in; old snapshots; another company's items; CSV without ids |
   | `lists-writes` | Adding as the owner (checked), correcting (history with old and new values), checking with a note when problems are open, an accepted problem versus a new one, bulk checking that skips problems and ignores others' ids, removing with a copy kept, removing sample data |
   | `sector-lists` | All 15 types: every list opens with each view, sort and filter, and downloads; an older company gets new record types and lists from the update banner |
   ```

3. In the `pnpm e2e` paragraph:
   - change "`features.spec.ts` covers the kill switch, Knowledge, Team with an automatic check-in, and Records search." to "`features.spec.ts` covers the kill switch, Knowledge, and Team with an automatic check-in.";
   - add the sentence "`lists.spec.ts` is the head's journey: a bill that doesn't add up is found, accepted with a note, corrected (its history shows the old and new values) and the list downloaded as CSV."

In `docs/known-gaps.md`, add a section at the end:

```markdown
## Sector lists, part 1

- Lists are on the web only; the phone app gets them in a later part.
- A role holder (accounts, site engineer) can't yet see only their own list; lists are for the owner and admins.
- Reference pickers in the item form offer the 100 most recently changed items of that type.
- A CSV download holds at most 10,000 items.
- A CSV cell that starts with `=`, `+`, `-` or `@` gets a leading `'` so a spreadsheet can't run it, so phone numbers like `+91…` show that quote in Excel.
- Default lists (record types a pack gives no list) only check that references point at real items.
- A pack the model writes names its main lists but no checks.
- Part 2, the AI's calls (collecting items from staff, following up with staff and outside parties), is designed in the spec and not built yet.
```

- [ ] **Step 4: Run everything**

Run: `pnpm turbo run build typecheck test`
Expected: PASS everywhere, `evals` docs tests included.

Run: `pnpm test:integration`
Expected: PASS (all specs, the four new ones included).

With `LLM_OFFLINE=always pnpm dev` running, run: `pnpm e2e` and `pnpm e2e:sectors`
Expected: PASS. If `pnpm e2e:sectors` takes too long locally, run `--only wholesale-retail` and `--only it-services` and leave the full run to CI's e2e job.

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md README.md
git commit -m "docs: lists and checks (ADR 0012), working rules, tests and what part 1 leaves out

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


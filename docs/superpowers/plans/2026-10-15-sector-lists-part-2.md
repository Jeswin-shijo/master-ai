# Sector lists part 2 — the AI's calls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AI fills the head's lists by phoning people (collection routines) and follows up open items by phoning team members or, when the owner allows it, customers and suppliers, recording what outside parties say as notes the head applies or dismisses.

**Architecture:** Collection routines reuse the routine workflows (`routineRunWorkflow` → `checkinCallWorkflow`); `RoutinesService` hands collect routines to a new `CollectionService` driving a scripted `CollectEngine`. Follow-ups are pack data on registers (`follow_ups:`); a per-company Temporal Schedule runs a sweep every 30 minutes that picks one due item at a time (`FollowUpsService.pick`, the same overdue/expiring SQL the list checks use) and starts a `followUpCallWorkflow`, whose conversation is a scripted `FollowUpEngine`. A model, when configured, only *understands* replies (zod-parsed); the scripts decide every line and every effect. Party answers become `record_notes` (Apply / Dismiss by the head); staff status answers update the item through `RecordsService.update` with `via: 'call'`.

**Tech Stack:** NestJS 11, Drizzle ORM (Postgres, row-level security), Temporal (TypeScript SDK), zod 4, React 19 + TanStack Query (web), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-sector-lists-design.md` — sections 4–5, the part-2 rows of 6–10, and Appendix A's follow-ups and collections. Part 1 (`docs/superpowers/plans/2026-10-14-sector-lists-part-1.md`) is merged on main.

## Global Constraints

- Every tenant-scoped query runs inside `DbService.tenant(tenantId, tx => …)`; every new table gets row-level security (`tenant_isolation` policy, grants to `onehuman_app`), or `tenant-isolation.spec.ts` fails.
- Every state change appends an audit event in the same transaction (`AuditService.append(tx, …)`). New types: `followup.switched`, `note.created`, `note.applied`, `note.dismissed`, `do_not_call.added`.
- Every change to a record goes through `RecordsService.create` (source `call` with the call id for collected items) or `RecordsService.update` (a `RecordChange`; `via: 'call'` with the call id for staff answers). Never write `records` rows elsewhere.
- What an outside party says is never applied without the head: party calls only create notes. Staff status answers are applied at once (spec §5).
- A model's answer never writes a record, a note or a call row directly. It is parsed with a zod schema; anything that fails parsing or validation falls back to the script.
- Party follow-ups are switched on or off by the **owner** only, checked in the service. Staff follow-ups by the owner or an admin.
- Party calls only inside `TenantSettings.calls.partyHours` (default Mon–Sat 10:00–18:00) ∩ the legal 9:00–21:00 India window ∩ the follow-up's own `hours`. Staff calls inside the person's working hours. Only the simulator with `fastSchedule` skips hours.
- At most one follow-up call rings per company at a time; at most `TenantSettings.calls.followUpsPerDay` (default 30) follow-up calls per company per India day; the kill switch (company paused) stops them.
- New call purposes plug into `CallsService` by the call's link: `follow_up` → `FollowUpCallsService`, `checkin_id` → `RoutinesService`, otherwise `DelegationService`.
- Owners and their clients never see tool names, ids or JSON. Notes, follow-ups and call cards are in words.
- Colours come from `@onehuman/ui` token classes; web pages stay lazy routes; the browser imports run-time values only from `@onehuman/schemas/plain`.
- Tests live in each section's `__tests__/` (backend `unit/` mirrors `src/`, `integration/` for Postgres specs). Write the test first and watch it fail.
- Pack YAML: run `pnpm --filter @onehuman/agent-kit exec vitest run __tests__/pack.test.ts` after editing `packs/`.
- Shared packages are consumed from `dist/`: after changing `packages/*`, run `pnpm build:packages` before the backend or web typecheck.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Do not push.

## Review Focus

- **A real number called out of hours or twice the same day.** Twilio is the provider, `fastSchedule` is on, a party follow-up is due at 22:30 IST: no call. A sweep and a "Call now" run at the same moment: one call rings, not two (advisory lock + "one live follow-up call" check in `pick`).
- **Spoken amounts and dates misread into a saved item.** "one lakh twenty" must save 120000, "forty-eight thousand two sixty" 48260, "20/10" the 20th of October — and an answer that cannot be read must never save a wrong value (it is re-asked, then the item is left for the app if the field is required).
- **A party's words applied without the head.** Every party outcome (paid, promise, dispute, wrong number, anything else) creates a note or a do-not-call entry and nothing else; only `NotesService.apply` changes the record.
- **A stale or crashed call blocking every follow-up.** A `scheduled`/`ringing`/`in_progress` follow-up call older than 30 minutes no longer counts as "the one live call".
- **Items a follow-up keeps re-picking.** An item skipped for do-not-call, out-of-hours staff or a missing phone must not stop other due items from being picked (the candidate query reads up to 100 rows and skips; missing phones and unknown staff stop with a note so they leave the queue).

Each line has its test: Tasks 6, 9, 10 and 11 carry them.

## Rulings made while planning

These settle what the spec leaves open; reviewers should weigh them as decisions, not slips.

1. **"Couldn't reach after 3 tries" and "Couldn't find Anil in your team" are notes, not list problems.** Problems are SQL checks over an item's data; these are facts about calls. They are `record_notes` of kind `unreachable` (new kind), show under "New from calls", and their only action is Seen (Dismiss). Cost if wrong: they don't count in the card's problem figure.
2. **A collection entry stores counts, not ids:** `values: { items: n, differences: m }`. The items point at the call (`records.source_ref`), so ids are not lost, and `CheckinValue` stays a scalar. Cost if wrong: one join to list a call's items.
3. **Defaults added to Appendix A collections** so every required field is asked or defaulted (`validateCollects` enforces it) and collected items can be followed up: wholesale `paymentStatus: unpaid`; logistics asks `consignorName` and defaults `status: booked`; status defaults for travel and education `requested`, IT and SaaS tickets `new`, agency `in-progress`, construction issues `open` and bills `received`, power `issued`, manufacturing `open`, hospital `sent` (spec), municipal `received` (and asks `applicationNo`), lender `dueDate: today`, accounting `received`, NGO asks `receiptNumber`.
4. **The browser test applies a "paid" note**, not a promise: a promise has nothing to apply (spec §5: promise and dispute notes only have Seen). The promise path is covered in `follow-ups.spec.ts`.
5. **Manual collection** posts each item through `POST /records/:entity` (spec §4) with the defaults filled in the browser, then submits the entry as `{ items: n }`.
6. **Party calls ring once per sweep**; retries are the next due day (`every_days`), not minutes later. Unanswered and declined calls add a try; `max_tries` stops the follow-up with an `unreachable` note.
7. **A call that drops mid-way** keeps every confirmed item; a collection entry with at least one item counts as reported.
8. **Follow-up call stage** is `chase`, collection stage `collect` (new `CallStage` values); the phone simulator labels them "Follow-up on an item" and "Collecting items".
9. **Follow-up calls are routed by `calls.follow_up`**, not `record_id` as the spec says: `record_id` is set to null when the item is removed mid-call, and the call must still reach its service. Cost if wrong: none; both columns are set on every follow-up call.

## File structure

**Schemas and pack format**
- `packages/schemas/src/pack.ts` — `CollectSchema`, `ContactPathSchema`, `FollowUpSchema`, `RegisterSchema.follow_ups`, `RoutineTemplateSchema` (questions or collect), `PackUpdates.followUps`.
- `packages/schemas/src/domain.ts` — `CallSettings.partyHours/followUpsPerDay`, `CallStage`, `CallOutcome`, `CallRecord.contact/about`, `RoutineCollect`, `Routine.collect`, `RoutineTemplateInfo`.
- `packages/schemas/src/lists.ts` — notes (`ListNote`, `NoteKind`), `newNotes`, `new_notes`, `FollowUpInfo`, `SwitchFollowUpInputSchema`.
- `packages/schemas/src/api.ts`, `events.ts` — settings input; audit types.

**agent-kit**
- `packages/agent-kit/src/registers.ts` — `ResolvedPath`, `ResolvedFollowUp`, `resolvePath`, follow-up validation, `validateCollects`, `collectAsk`.
- `packages/agent-kit/src/pack.ts` — `packUpdates`/`applyPackUpdates`/`countPackUpdates` for follow-ups; collect routines only with their list.

**Pack content** — `packs/*/pack.yaml`: `follow_ups:` under registers, collection routines.

**Backend**
- `master-ai-backend/src/db/schema.ts` + `drizzle/0015_*.sql` (generated) + `drizzle/0016_calls_outside_rls.sql` (custom).
- `src/voice/spoken.ts` — spoken numbers, amounts, dates, options, question and read-back wording.
- `src/voice/collect-engine.ts` — the collection call (script + model understanding).
- `src/voice/follow-up-engine.ts` — the follow-up call (script + model understanding).
- `src/voice/time.ts` — `narrowHours`, `withinHours`, `addDaysTo`.
- `src/voice/call-record.ts`, `src/voice/calls.service.ts` — outside parties; routing by `record_id`.
- `src/notes/notes.service.ts`, `src/notes/notes.controller.ts` — create, apply, dismiss.
- `src/routines/collection.service.ts` — collection calls: context, lookup, save with repeats.
- `src/routines/routines.service.ts` — collect branches.
- `src/follow-ups/targets.ts` — who to call: phone and name paths, team matching, do-not-call keys.
- `src/follow-ups/follow-ups.service.ts` — switches, schedule, the due-item pick.
- `src/follow-ups/follow-up-calls.service.ts` — placing, the conversation, outcomes, attempts.
- `src/follow-ups/follow-ups.controller.ts`.
- `src/lists/sql.ts` (`dueSql`), `src/lists/lists.service.ts` (notes, labels, filter), `src/lists/query.ts`.
- `src/orchestration/{shared,workflows,activities,temporal.service}.ts` — sweep and call workflows, schedule.

**SDK** — `packages/sdk/src/client.ts`: `lists.followUps`, `followUps.switch/run`, `notes.apply/dismiss`.

**Web**
- `master-ai-web/src/components/follow-ups-panel.tsx`, `item-notes.tsx`, `collect-form.tsx`, `pick-people.tsx` (new).
- `master-ai-web/src/routes/list.tsx`, `components/list-item-panel.tsx`, `lib/lists.ts`, `routes/routines.tsx`, `routes/settings.tsx`, `components/phone-simulator.tsx`, `components/delegation-card.tsx`.

**Tests**
- Unit: `packages/schemas/__tests__/pack.test.ts`, `packages/agent-kit/__tests__/follow-ups.test.ts`, `master-ai-backend/__tests__/unit/voice/{spoken,collect-engine,follow-up-engine,time}.test.ts`, `__tests__/unit/follow-ups/targets.test.ts`, `__tests__/unit/lists/due-sql.test.ts`.
- Integration: `master-ai-backend/__tests__/integration/{calls-outside,notes,collection,follow-ups}.spec.ts`.
- Unit (web): `master-ai-web/__tests__/unit/lib/{lists,collect}.test.ts`.
- Browser: `master-ai-web/__tests__/e2e/list-calls.spec.ts`. Smoke: `master-ai-backend/scripts/smoke.ts`.

**Docs** — `docs/adr/0013-calls-to-outside-parties.md`, `CLAUDE.md`, `docs/production-readiness.md`, `docs/testing.md`, `docs/known-gaps.md`, `README.md`.

---
### Task 1: Pack format for collections and follow-ups, call settings, audit types

**Files:**
- Modify: `packages/schemas/src/pack.ts` (after `ConditionsSchema` ~line 272; `RoutineTemplateSchema` ~line 156; `RegisterSchema` ~line 314; `PackUpdates` ~line 389)
- Modify: `packages/schemas/src/domain.ts` (`CallSettings` ~line 70)
- Modify: `packages/schemas/src/api.ts` (`CallSettingsInputSchema` ~line 172)
- Modify: `packages/schemas/src/events.ts` (`AUDIT_EVENT_TYPES`, `summarizeEvent`)
- Modify: `master-ai-backend/src/common/mappers.ts:33` (`DEFAULT_TENANT_SETTINGS.calls`)
- Test: `packages/schemas/__tests__/pack.test.ts`, `packages/schemas/__tests__/api.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (all exported from `@onehuman/schemas`):
  - `CollectSchema`, `type Collect = { list: string; ask: string[]; defaults: Record<string, string | number | boolean>; max_items: number; who?: string }`
  - `ContactPathSchema`, `type ContactPath = { field } | { ref, field } | { lookup, match, value, field }` (all strings)
  - `FollowUpSchema`, `type FollowUp = { id; label; who: 'party' | 'staff'; due: { overdue: { date; grace_days } } | { expiring: { date; days } }; when?: Conditions; phone?: ContactPath; contact?: ContactPath; staff?: { field }; about: string[]; find_out: string[]; every_days?: number; max_tries: number; hours?: { start; end } }`
  - `Register.follow_ups?: FollowUp[]`; `RoutineTemplate.questions: RoutineQuestion[]` (default `[]`), `RoutineTemplate.collect?: Collect`
  - `PackUpdates.followUps?: { register: string; followUps: FollowUp[] }[]`
  - `CallSettings.partyHours: WorkingHours`, `CallSettings.followUpsPerDay: number`; `CallSettingsInputSchema` accepts both
  - audit types `followup.switched`, `note.created`, `note.applied`, `note.dismissed`, `do_not_call.added`

- [ ] **Step 1: Write the failing tests**

Append to `packages/schemas/__tests__/pack.test.ts` (extend the import from `../src/pack` with `FollowUpSchema, RoutineTemplateSchema`):

```ts
describe('collection routines', () => {
  const base = { id: 'todays-bills', name: "Today's bills", description: 'The AI calls for the day’s bills.' };

  it('takes collect instead of questions, with its defaults', () => {
    const t = RoutineTemplateSchema.parse({ ...base, collect: { list: 'bills', ask: ['billNo', 'total'] } });
    expect(t.questions).toEqual([]);
    expect(t.collect).toEqual({ list: 'bills', ask: ['billNo', 'total'], defaults: {}, max_items: 15 });
  });

  it('refuses both questions and collect, and neither', () => {
    const q = { key: 'people', label: 'People', ask: 'How many people?', type: 'number' };
    expect(RoutineTemplateSchema.safeParse({ ...base, questions: [q], collect: { list: 'bills', ask: ['billNo'] } }).success).toBe(false);
    expect(RoutineTemplateSchema.safeParse(base).success).toBe(false);
  });

  it('caps the items one call takes at 25', () => {
    expect(RoutineTemplateSchema.safeParse({ ...base, collect: { list: 'bills', ask: ['billNo'], max_items: 26 } }).success).toBe(false);
  });
});

describe('follow-ups on a list', () => {
  const party = {
    id: 'unpaid-bills',
    label: 'Unpaid bills → the party',
    who: 'party',
    due: { overdue: { date: 'dueDate' } },
    phone: { ref: 'party', field: 'phone' },
    contact: { ref: 'party', field: 'name' },
    about: ['billNo', 'total'],
  };

  it('fills in the defaults', () => {
    expect(FollowUpSchema.parse(party)).toMatchObject({ due: { overdue: { date: 'dueDate', grace_days: 0 } }, find_out: [], max_tries: 3 });
  });

  it('needs a phone and a contact to call a party, and a team field to call staff', () => {
    expect(FollowUpSchema.safeParse({ ...party, phone: undefined }).success).toBe(false);
    expect(FollowUpSchema.safeParse({ ...party, staff: { field: 'assignedTo' } }).success).toBe(false);
    const staff = { ...party, who: 'staff', phone: undefined, contact: undefined, staff: { field: 'assignedTo' } };
    expect(FollowUpSchema.safeParse(staff).success).toBe(true);
  });

  it('reads all three ways to find a phone', () => {
    for (const phone of [{ field: 'consigneePhone' }, { ref: 'party', field: 'phone' }, { lookup: 'Customer', match: 'name', value: 'client', field: 'phone' }]) {
      expect(FollowUpSchema.safeParse({ ...party, phone }).success).toBe(true);
    }
  });

  it('keeps follow-ups on a register', () => {
    const r = RegisterSchema.parse({ id: 'bills', entity: 'Bill', follow_ups: [party] });
    expect(r.follow_ups?.[0]?.id).toBe('unpaid-bills');
  });
});

describe('call audit events', () => {
  it('describes the new events in words', () => {
    expect(summarizeEvent('followup.switched', { label: 'Unpaid bills → the party', enabled: true })).toBe('Follow-up switched on: Unpaid bills → the party');
    expect(summarizeEvent('note.created', { speaker: 'Sri Ganesh Traders', title: 'S-1042' })).toBe('Note from a call with Sri Ganesh Traders on S-1042');
    expect(summarizeEvent('note.applied', { title: 'S-1042' })).toBe('Call note applied to S-1042');
    expect(summarizeEvent('note.dismissed', { title: 'S-1042' })).toBe('Call note seen on S-1042');
    expect(summarizeEvent('do_not_call.added', { name: 'Sri Ganesh Traders' })).toBe('Sri Ganesh Traders will not be called again');
  });
});
```

Append to `packages/schemas/__tests__/api.test.ts` (import `CallSettingsInputSchema` from `../src/api` if not already imported):

```ts
describe('call settings for outside parties', () => {
  it('takes calling hours for customers and suppliers and a daily cap', () => {
    const s = CallSettingsInputSchema.parse({ partyHours: { days: [1, 2, 3, 4, 5], start: '10:00', end: '17:00' }, followUpsPerDay: 20 });
    expect(s).toEqual({ partyHours: { days: [1, 2, 3, 4, 5], start: '10:00', end: '17:00' }, followUpsPerDay: 20 });
    expect(CallSettingsInputSchema.safeParse({ followUpsPerDay: 0 }).success).toBe(false);
    expect(CallSettingsInputSchema.safeParse({ followUpsPerDay: 201 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @onehuman/schemas exec vitest run __tests__/pack.test.ts __tests__/api.test.ts`
Expected: FAIL — `RoutineTemplateSchema`'s `questions` is required, `FollowUpSchema` is not exported, unknown event types, `partyHours` stripped.

- [ ] **Step 3: Implement the pack format**

In `packages/schemas/src/pack.ts`, replace `RoutineTemplateSchema` with:

```ts
/** A routine that adds items to a list instead of asking fixed questions, e.g. today's bills. */
export const CollectSchema = z.strictObject({
  /** The list (register id) the items go to. */
  list: SlugSchema,
  /** The fields the AI asks for, in this order. */
  ask: z.array(z.string()).min(1).max(12),
  /** Fields the AI fills itself: `today` (a date), `now` (a date-time) or a fixed value. */
  defaults: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Items one call takes before it asks for the rest in the app. */
  max_items: z.number().int().min(1).max(25).default(15),
  /** Who it calls, shown when the owner switches it on: "the billing clerk". */
  who: z.string().min(1).optional(),
});
export type Collect = z.infer<typeof CollectSchema>;

/** A repeating check-in the pack offers, e.g. a daily site report. The owner turns it on. */
export const RoutineTemplateSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    mode: z.enum(['manual', 'automatic']).default('automatic'),
    /** 0 = Sunday … 6 = Saturday. */
    days: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5, 6]),
    /** Local time (India), HH:MM: when the AI calls, or when manual updates are due. */
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('18:00'),
    questions: z.array(RoutineQuestionSchema).max(8).default([]),
    /** Instead of questions: the items it adds to a list. */
    collect: CollectSchema.optional(),
  })
  .refine((t) => (t.questions.length > 0) !== (t.collect !== undefined), 'a routine takes either questions or collect, not both');
export type RoutineTemplate = z.infer<typeof RoutineTemplateSchema>;
```

After `ConditionsSchema` / `Conditions` (before `checkExtras`), add:

```ts
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

/**
 * Where a call finds a phone number or a name: a field of the item, a field of
 * the item a reference points at, or a field of another record found by matching.
 */
export const ContactPathSchema = z.union([
  z.strictObject({ field: z.string() }),
  z.strictObject({ ref: z.string(), field: z.string() }),
  z.strictObject({ lookup: z.string(), match: z.string(), value: z.string(), field: z.string() }),
]);
export type ContactPath = z.infer<typeof ContactPathSchema>;

/** A follow-up call a list offers on its open items. Every follow-up starts off. */
export const FollowUpSchema = z
  .strictObject({
    id: SlugSchema,
    label: z.string().min(1),
    /** party: a customer, supplier or other outside party. staff: someone in the team. */
    who: z.enum(['party', 'staff']),
    /** When an item is due for a call: the same overdue or expiring rule a check uses. */
    due: z.union([
      z.strictObject({ overdue: z.strictObject({ date: z.string(), grace_days: z.number().int().nonnegative().default(0) }) }),
      z.strictObject({ expiring: z.strictObject({ date: z.string(), days: z.number().int().positive() }) }),
    ]),
    when: ConditionsSchema.optional(),
    phone: ContactPathSchema.optional(),
    /** The name the AI asks for before it says anything about the item. */
    contact: ContactPathSchema.optional(),
    /** Staff calls: the field holding a team member's name. */
    staff: z.strictObject({ field: z.string() }).optional(),
    /** Read out once the person is confirmed. */
    about: z.array(z.string()).min(1),
    /** What the call may propose (party) or change (staff). A promised date is always allowed. */
    find_out: z.array(z.string()).default([]),
    /** Days between calls about one item; 3 for parties and 1 for staff when unset. */
    every_days: z.number().int().min(1).max(30).optional(),
    max_tries: z.number().int().min(1).max(5).default(3),
    /** A narrower calling window, e.g. RBI's 08:00–19:00 for recovery calls. */
    hours: z.strictObject({ start: HHMM, end: HHMM }).optional(),
  })
  .refine(
    (f) => (f.who === 'party' ? !!f.phone && !!f.contact && !f.staff : !!f.staff && !f.phone && !f.contact),
    'a party follow-up needs phone and contact; a staff follow-up needs staff',
  );
export type FollowUp = z.infer<typeof FollowUpSchema>;
```

In `RegisterSchema`, after `checks`, add:

```ts
  /** Calls the AI can make about open items, each off until switched on. */
  follow_ups: z.array(FollowUpSchema).optional(),
```

In `interface PackUpdates`, after `registers`, add:

```ts
  /** New follow-ups on lists the workspace already has. */
  followUps?: { register: string; followUps: FollowUp[] }[];
```

- [ ] **Step 4: Implement settings and audit types**

In `packages/schemas/src/domain.ts`, add to `CallSettings`:

```ts
  /** When customers and suppliers may be called (always inside 9:00–21:00 India time). */
  partyHours: WorkingHours;
  /** Follow-up calls a company makes in one day, at most. */
  followUpsPerDay: number;
```

In `packages/schemas/src/api.ts`, add to `CallSettingsInputSchema`:

```ts
  partyHours: WorkingHoursSchema.optional(),
  followUpsPerDay: z.number().int().min(1).max(200).optional(),
```

(`WorkingHoursSchema` is declared above it in the same file.)

In `master-ai-backend/src/common/mappers.ts`, the calls defaults become:

```ts
  calls: {
    provider: 'simulator',
    simulatorMode: 'interactive',
    fastSchedule: true,
    maxAttempts: 3,
    retryMinutes: 15,
    partyHours: { days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '18:00' },
    followUpsPerDay: 30,
  },
```

In `packages/schemas/src/events.ts`, add after `'record.samples_removed',`:

```ts
  'followup.switched',
  'note.created',
  'note.applied',
  'note.dismissed',
  'do_not_call.added',
```

and in `summarizeEvent`, after the `record.samples_removed` case:

```ts
    case 'followup.switched':
      return `Follow-up switched ${p.enabled ? 'on' : 'off'}: ${p.label ?? ''}`;
    case 'note.created':
      return `Note from a call with ${p.speaker ?? 'someone'} on ${p.title ?? 'an item'}`;
    case 'note.applied':
      return `Call note applied to ${p.title ?? 'an item'}`;
    case 'note.dismissed':
      return `Call note seen on ${p.title ?? 'an item'}`;
    case 'do_not_call.added':
      return `${p.name ?? 'A number'} will not be called again`;
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @onehuman/schemas exec vitest run && pnpm build:packages && pnpm turbo run typecheck`
Expected: PASS. If a test fixture or web file builds a `CallSettings` literal, add the two new fields to it (TypeScript names the file).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas master-ai-backend/src/common/mappers.ts
git commit -m "feat(schemas): collection routines, follow-ups on lists and calling hours for outside parties

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: agent-kit resolves and validates follow-ups and collections, and offers them as updates

**Files:**
- Modify: `packages/agent-kit/src/registers.ts`
- Modify: `packages/agent-kit/src/pack.ts` (`packUpdates`, `emptyPackUpdates`, `countPackUpdates`, `applyPackUpdates`, `validatePackRefs`)
- Modify: `master-ai-backend/src/tenancy/onboarding.service.ts:190` (`describeUpdates`)
- Modify: `master-ai-backend/src/packs/generator.service.ts:274`
- Test: `packages/agent-kit/__tests__/follow-ups.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 `FollowUp`, `ContactPath`, `Collect`, `RoutineTemplate`, `PackUpdates.followUps`.
- Produces (exported from `@onehuman/agent-kit`):
  - `type ResolvedPath = { kind: 'field'; field: EntityField } | { kind: 'ref'; ref: EntityField; target: EntityDef; field: EntityField } | { kind: 'lookup'; target: EntityDef; match: EntityField; value: EntityField; field: EntityField }`
  - `interface ResolvedFollowUp { key: string /* "<list>.<id>" */; id; registerId; label; who: 'party' | 'staff'; due: Extract<ListCheck, { kind: 'overdue' | 'expiring' }>; when?: Conditions; phone: ResolvedPath | null; contact: ResolvedPath | null; staffField: EntityField | null; about: EntityField[]; findOut: EntityField[]; everyDays: number; maxTries: number; hours: { start: string; end: string } | null }`
  - `ResolvedRegister.followUps: ResolvedFollowUp[]`
  - `resolvePath(path: ContactPath, entity: EntityDef, entities: EntityDef[]): ResolvedPath | null`
  - `validateCollects(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[]; routines?: RoutineTemplate[] }): string[]`
  - `collectAsk(reg: ResolvedRegister, collect: Pick<Collect, 'ask' | 'defaults'>): EntityField[]` — the asked fields in order, less any defaulted.
  - `fittingRegisters` keeps a list minus follow-ups that no longer fit; `fittingRoutines(pack): RoutineTemplate[]` drops collections whose list or fields are gone.
  - `validateRegisters` also reports follow-up issues; `validatePackRefs` also reports `validateCollects` issues.

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-kit/__tests__/follow-ups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityDef, FollowUp, Register, ResolvedPack, RoutineTemplate } from '@onehuman/schemas';
import { applyPackUpdates, collectAsk, countPackUpdates, packUpdates, registersOf, validateCollects, validateRegisters } from '../src/index';

const Party: EntityDef = {
  name: 'Party',
  label: 'Party',
  fields: [
    { name: 'name', label: 'Name', type: 'string', required: true },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
  ],
};
const Bill: EntityDef = {
  name: 'Bill',
  label: 'Bill',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'party', label: 'Party', type: 'reference', ref: 'Party', required: false },
    { name: 'billDate', label: 'Bill date', type: 'date', required: false },
    { name: 'total', label: 'Total', type: 'money', required: false },
    { name: 'dueDate', label: 'Due date', type: 'date', required: false },
    { name: 'paymentStatus', label: 'Payment', type: 'enum', options: ['unpaid', 'paid'], required: false },
    { name: 'clerk', label: 'Clerk', type: 'string', required: false },
  ],
};
const unpaid: FollowUp = {
  id: 'unpaid-bills',
  label: 'Unpaid bills → the party',
  who: 'party',
  due: { overdue: { date: 'dueDate', grace_days: 2 } },
  when: { paymentStatus: ['unpaid'] },
  phone: { ref: 'party', field: 'phone' },
  contact: { ref: 'party', field: 'name' },
  about: ['billNo', 'total'],
  find_out: ['paymentStatus'],
  max_tries: 3,
};
const bills = (followUps: FollowUp[]): Register => ({ id: 'bills', entity: 'Bill', main: true, checks: [], follow_ups: followUps });
const pack = (registers: Register[], routines: RoutineTemplate[] = []) => ({ entities: [Party, Bill], registers, routines });

describe('follow-ups on a list', () => {
  it('resolves paths, the due rule and the defaults', () => {
    const [f] = registersOf(pack([bills([unpaid])])).find((r) => r.id === 'bills')!.followUps;
    expect(f).toMatchObject({ key: 'bills.unpaid-bills', who: 'party', everyDays: 3, maxTries: 3, hours: null });
    expect(f!.due).toMatchObject({ kind: 'overdue', graceDays: 2, field: { name: 'dueDate' } });
    expect(f!.phone).toMatchObject({ kind: 'ref', ref: { name: 'party' }, target: { name: 'Party' }, field: { name: 'phone' } });
    expect(f!.about.map((x) => x.name)).toEqual(['billNo', 'total']);
  });

  it('calls staff once a day unless told otherwise', () => {
    const staff: FollowUp = { ...unpaid, id: 'chase-clerk', who: 'staff', phone: undefined, contact: undefined, staff: { field: 'clerk' } };
    const [f] = registersOf(pack([bills([staff])])).find((r) => r.id === 'bills')!.followUps;
    expect(f).toMatchObject({ who: 'staff', everyDays: 1, staffField: { name: 'clerk' } });
  });

  it('reports every path that does not fit the record types', () => {
    const bad: FollowUp = {
      ...unpaid,
      due: { overdue: { date: 'total', grace_days: 0 } },
      when: { paymentStatus: ['lost'] },
      phone: { ref: 'billNo', field: 'phone' },
      contact: { lookup: 'Supplier', match: 'name', value: 'party', field: 'name' },
      about: ['nope'],
      find_out: ['missing'],
    };
    const issues = validateRegisters(pack([bills([bad, bad])]));
    expect(issues).toEqual(
      expect.arrayContaining([
        'register bills follow-up unpaid-bills: duplicate id',
        'register bills follow-up unpaid-bills: due total must be date or datetime, not money',
        'register bills follow-up unpaid-bills: lost is not an option of paymentStatus',
        'register bills follow-up unpaid-bills: phone billNo is not a reference field',
        'register bills follow-up unpaid-bills: contact looks up Supplier, which is not a record type',
        'register bills follow-up unpaid-bills: about nope is not a field of Bill',
        'register bills follow-up unpaid-bills: find_out missing is not a field of Bill',
      ]),
    );
  });

  it('needs the phone to end at a phone field', () => {
    const issues = validateRegisters(pack([bills([{ ...unpaid, phone: { ref: 'party', field: 'name' } }])]));
    expect(issues).toContain('register bills follow-up unpaid-bills: phone name must be a phone field, not string');
  });
});

describe('collection routines', () => {
  const todays: RoutineTemplate = {
    id: 'todays-bills',
    name: "Today's bills",
    description: 'Bills by phone',
    mode: 'automatic',
    days: [1, 2, 3, 4, 5, 6],
    time: '18:00',
    questions: [],
    collect: { list: 'bills', ask: ['billNo', 'party', 'total'], defaults: { billDate: 'today', paymentStatus: 'unpaid' }, max_items: 15 },
  };

  it('accepts a routine whose required fields are asked or defaulted', () => {
    expect(validateCollects(pack([bills([])], [todays]))).toEqual([]);
  });

  it('reports an unknown list, unknown fields, wrong defaults and a required field left out', () => {
    const wrong: RoutineTemplate = {
      ...todays,
      collect: { list: 'bills', ask: ['party', 'colour'], defaults: { billDate: 'now', paymentStatus: 'lost', party: 'x' }, max_items: 15 },
    };
    expect(validateCollects(pack([bills([])], [wrong, { ...todays, id: 'elsewhere', collect: { ...todays.collect!, list: 'orders' } }]))).toEqual([
      'routine todays-bills: ask colour is not a field of Bill',
      'routine todays-bills: now is for date-time fields, billDate is date',
      'routine todays-bills: lost is not an option of paymentStatus',
      'routine todays-bills: party is both asked and defaulted',
      'routine todays-bills: required field billNo is neither asked nor defaulted',
      'routine elsewhere: no list orders',
    ]);
  });

  it('asks the asked fields in order, less the defaulted ones', () => {
    const reg = registersOf(pack([bills([])])).find((r) => r.id === 'bills')!;
    expect(collectAsk(reg, { ask: ['total', 'billNo', 'billDate'], defaults: { billDate: 'today' } }).map((f) => f.name)).toEqual(['total', 'billNo']);
  });
});

describe('follow-ups as updates', () => {
  const resolved = (registers: Register[], routines: RoutineTemplate[] = []) =>
    ({ entities: [Party, Bill], registers, routines, agents: [], tools: [], workflows: [], policies: [], kpis: [], playbooks: [] }) as unknown as ResolvedPack;

  it('offers new follow-ups on lists the workspace has, and adds them without replacing', () => {
    const second: FollowUp = { ...unpaid, id: 'second' };
    const installed = resolved([bills([unpaid])]);
    const u = packUpdates(installed, resolved([bills([unpaid, second])]));
    expect(u.followUps).toEqual([{ register: 'bills', followUps: [second] }]);
    expect(countPackUpdates(u)).toBe(1);
    const next = applyPackUpdates(installed, u);
    expect(next.registers?.[0]?.follow_ups?.map((f) => f.id)).toEqual(['unpaid-bills', 'second']);
  });

  it('only offers a collection routine whose list the workspace will have', () => {
    const collect = { list: 'orders', ask: ['billNo'], defaults: {}, max_items: 15 };
    const r: RoutineTemplate = { id: 'orders-call', name: 'Orders', description: 'x', mode: 'automatic', days: [1], time: '18:00', questions: [], collect };
    expect(packUpdates(resolved([bills([])]), resolved([bills([])], [r])).routines).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run __tests__/follow-ups.test.ts`
Expected: FAIL — `collectAsk` and `validateCollects` are not exported; `followUps` is undefined.

- [ ] **Step 3: Resolve and validate follow-ups in `registers.ts`**

Change the import line to:

```ts
import type { Check, Collect, Conditions, ContactPath, EntityDef, EntityField, FieldType, FollowUp, Register, ResolvedPack, RoutineTemplate } from '@onehuman/schemas';
```

Add after the `ListCheck` type:

```ts
/** Where a call reads a phone number or a name, resolved against the pack's record types. */
export type ResolvedPath =
  | { kind: 'field'; field: EntityField }
  | { kind: 'ref'; ref: EntityField; target: EntityDef; field: EntityField }
  | { kind: 'lookup'; target: EntityDef; match: EntityField; value: EntityField; field: EntityField };

export interface ResolvedFollowUp {
  /** `<list>.<follow-up>`: unique in the workspace. Switches, attempts and calls use it. */
  key: string;
  id: string;
  registerId: string;
  label: string;
  who: 'party' | 'staff';
  /** When an item is due: the same overdue or expiring rule the list's checks use. */
  due: Extract<ListCheck, { kind: 'overdue' | 'expiring' }>;
  when?: Conditions;
  phone: ResolvedPath | null;
  contact: ResolvedPath | null;
  staffField: EntityField | null;
  about: EntityField[];
  findOut: EntityField[];
  everyDays: number;
  maxTries: number;
  hours: { start: string; end: string } | null;
}
```

Add `followUps: ResolvedFollowUp[];` to `ResolvedRegister` (after `checks`), and in `resolveRegister` add `followUps: resolveFollowUps(r, entity, entities),` after `checks`. Default lists pass no `follow_ups`, so they get `[]`.

Add these functions after `expandChecks`:

```ts
/** A path against the pack, or null when a part of it is missing (a stored snapshot may lack a field). */
export function resolvePath(p: ContactPath, entity: EntityDef, entities: EntityDef[]): ResolvedPath | null {
  const own = (n: string) => entity.fields.find((f) => f.name === n);
  if ('lookup' in p) {
    const target = entities.find((e) => e.name === p.lookup);
    const match = target?.fields.find((f) => f.name === p.match);
    const field = target?.fields.find((f) => f.name === p.field);
    const value = own(p.value);
    return target && match && field && value ? { kind: 'lookup', target, match, value, field } : null;
  }
  if ('ref' in p) {
    const ref = own(p.ref);
    const target = ref?.type === 'reference' ? entities.find((e) => e.name === ref.ref) : undefined;
    const field = target?.fields.find((f) => f.name === p.field);
    return ref && target && field ? { kind: 'ref', ref, target, field } : null;
  }
  const field = own(p.field);
  return field ? { kind: 'field', field } : null;
}

function resolveFollowUps(r: Register, entity: EntityDef, entities: EntityDef[]): ResolvedFollowUp[] {
  const own = (n: string) => entity.fields.find((f) => f.name === n);
  const pick = (names: string[]) => names.map(own).filter((f): f is EntityField => !!f);
  const out: ResolvedFollowUp[] = [];
  for (const f of r.follow_ups ?? []) {
    const key = `${r.id}.${f.id}`;
    const dueField = own('overdue' in f.due ? f.due.overdue.date : f.due.expiring.date);
    if (!dueField) continue;
    const due: ResolvedFollowUp['due'] =
      'overdue' in f.due
        ? { kind: 'overdue', key: `due:${key}`, field: dueField, graceDays: f.due.overdue.grace_days }
        : { kind: 'expiring', key: `due:${key}`, field: dueField, days: f.due.expiring.days };
    const phone = f.phone ? resolvePath(f.phone, entity, entities) : null;
    const contact = f.contact ? resolvePath(f.contact, entity, entities) : null;
    const staffField = f.staff ? (own(f.staff.field) ?? null) : null;
    if (f.who === 'party' ? !phone || !contact : !staffField) continue;
    out.push({
      key,
      id: f.id,
      registerId: r.id,
      label: f.label,
      who: f.who,
      due,
      ...(f.when && { when: f.when }),
      phone,
      contact,
      staffField,
      about: pick(f.about),
      findOut: pick(f.find_out),
      everyDays: f.every_days ?? (f.who === 'party' ? 3 : 1),
      maxTries: f.max_tries,
      hours: f.hours ?? null,
    });
  }
  return out;
}
```

In `validateRegisters`, at the end of the `for (const r of registers)` loop body (after the checks loop), add:

```ts
    const followUpIds = new Set<string>();
    for (const f of r.follow_ups ?? []) {
      const where = `${at} follow-up ${f.id}`;
      if (followUpIds.has(f.id)) issues.push(`${where}: duplicate id`);
      followUpIds.add(f.id);
      followUpIssues(entity, pack.entities, f, where, issues);
    }
```

and add after `conditionIssues`:

```ts
function followUpIssues(entity: EntityDef, entities: EntityDef[], f: FollowUp, where: string, issues: string[]) {
  const own = (n: string) => entity.fields.find((x) => x.name === n);
  const date = 'overdue' in f.due ? f.due.overdue.date : f.due.expiring.date;
  const d = own(date);
  if (!d) issues.push(`${where}: due ${date} is not a field of ${entity.name}`);
  else if (!DATES.includes(d.type)) issues.push(`${where}: due ${date} must be ${DATES.join(' or ')}, not ${d.type}`);
  conditionIssues(entity, f.when, where, issues);
  if (f.phone) pathIssues(f.phone, 'phone', entity, entities, where, issues, 'phone');
  if (f.contact) pathIssues(f.contact, 'contact', entity, entities, where, issues);
  if (f.staff && !own(f.staff.field)) issues.push(`${where}: staff ${f.staff.field} is not a field of ${entity.name}`);
  for (const n of f.about) if (!own(n)) issues.push(`${where}: about ${n} is not a field of ${entity.name}`);
  for (const n of f.find_out) if (!own(n)) issues.push(`${where}: find_out ${n} is not a field of ${entity.name}`);
}

function pathIssues(p: ContactPath, role: string, entity: EntityDef, entities: EntityDef[], where: string, issues: string[], type?: FieldType) {
  const own = (n: string) => entity.fields.find((x) => x.name === n);
  let target: EntityDef | undefined = entity;
  if ('lookup' in p) {
    target = entities.find((e) => e.name === p.lookup);
    if (!target) return issues.push(`${where}: ${role} looks up ${p.lookup}, which is not a record type`);
    if (!target.fields.some((x) => x.name === p.match)) issues.push(`${where}: ${role} matches ${p.match}, which is not a field of ${target.name}`);
    if (!own(p.value)) issues.push(`${where}: ${role} value ${p.value} is not a field of ${entity.name}`);
  } else if ('ref' in p) {
    const ref = own(p.ref);
    if (!ref) return issues.push(`${where}: ${role} ${p.ref} is not a field of ${entity.name}`);
    if (ref.type !== 'reference') return issues.push(`${where}: ${role} ${p.ref} is not a reference field`);
    target = entities.find((e) => e.name === ref.ref);
    if (!target) return issues.push(`${where}: ${role} ${p.ref} points at ${ref.ref ?? 'nothing'}, which is not a record type`);
  }
  const field = target.fields.find((x) => x.name === p.field);
  if (!field) issues.push(`${where}: ${role} ${p.field} is not a field of ${target.name}`);
  else if (type && field.type !== type) issues.push(`${where}: ${role} ${p.field} must be a ${type} field, not ${field.type}`);
}
```

Add after `fittingRegisters`:

```ts
/** The asked fields of a collection, in order, less any the routine fills itself. */
export function collectAsk(reg: ResolvedRegister, collect: Pick<Collect, 'ask' | 'defaults'>): EntityField[] {
  return collect.ask.filter((n) => !(n in collect.defaults)).flatMap((n) => reg.entity.fields.filter((f) => f.name === n));
}

/** What is wrong with a pack's collection routines: the list, the fields, the defaults, and required fields nobody fills. */
export function validateCollects(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[]; routines?: RoutineTemplate[] }): string[] {
  const issues: string[] = [];
  const lists = registersOf(pack);
  for (const t of pack.routines ?? []) {
    const c = t.collect;
    if (!c) continue;
    const at = `routine ${t.id}`;
    const reg = lists.find((l) => l.id === c.list);
    if (!reg) {
      issues.push(`${at}: no list ${c.list}`);
      continue;
    }
    const field = (n: string) => reg.entity.fields.find((f) => f.name === n);
    for (const n of c.ask) if (!field(n)) issues.push(`${at}: ask ${n} is not a field of ${reg.entity.name}`);
    for (const [n, v] of Object.entries(c.defaults)) {
      const f = field(n);
      if (!f) issues.push(`${at}: default ${n} is not a field of ${reg.entity.name}`);
      else if (v === 'today' && f.type !== 'date') issues.push(`${at}: today is for date fields, ${n} is ${f.type}`);
      else if (v === 'now' && f.type !== 'datetime') issues.push(`${at}: now is for date-time fields, ${n} is ${f.type}`);
      else if (f.type === 'enum' && !f.options?.includes(String(v))) issues.push(`${at}: ${String(v)} is not an option of ${n}`);
      if (c.ask.includes(n)) issues.push(`${at}: ${n} is both asked and defaulted`);
    }
    for (const f of reg.entity.fields) {
      if (f.required && !c.ask.includes(f.name) && !(f.name in c.defaults)) issues.push(`${at}: required field ${f.name} is neither asked nor defaulted`);
    }
  }
  return issues;
}
```

A pack a model designed inherits lists it cannot see (part 1's `fittingRegisters`). One broken follow-up must not cost the whole list, and a collection whose list was dropped must go too. Replace `fittingRegisters` with:

```ts
/**
 * The lists that fit the pack's record types, for a pack a model designed, which inherits
 * lists it cannot see. A follow-up that no longer fits is left out rather than the list.
 */
export function fittingRegisters(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[] }): Register[] {
  const fits = (r: Register) => validateRegisters({ entities: pack.entities, registers: [r] }).length === 0;
  return (pack.registers ?? []).flatMap((r) => {
    if (fits(r)) return [r];
    const kept = { ...r, follow_ups: (r.follow_ups ?? []).filter((f) => fits({ ...r, follow_ups: [f] })) };
    return fits(kept) ? [kept] : [];
  });
}

/** The routines whose collection (if any) still has its list and fields. */
export function fittingRoutines(pack: Pick<ResolvedPack, 'entities'> & { registers?: Register[]; routines?: RoutineTemplate[] }): RoutineTemplate[] {
  return (pack.routines ?? []).filter((t) => validateCollects({ ...pack, routines: [t] }).length === 0);
}
```

In `master-ai-backend/src/packs/generator.service.ts` (~line 274), replace

```ts
        const pack = { ...resolvedPack, registers: fittingRegisters(resolvedPack) };
```

with

```ts
        const fitted = { ...resolvedPack, registers: fittingRegisters(resolvedPack) };
        const pack = { ...fitted, routines: fittingRoutines(fitted) };
```

and add `fittingRoutines` to its `@onehuman/agent-kit` import. Add to `follow-ups.test.ts` (import `fittingRegisters, fittingRoutines`):

```ts
describe('lists and collections for a pack a model designed', () => {
  it('keeps a list without the follow-up that no longer fits, and drops a collection whose list is gone', () => {
    const broken: FollowUp = { ...unpaid, id: 'broken', phone: { field: 'nope' } };
    const kept = fittingRegisters({ entities: [Party, Bill], registers: [bills([unpaid, broken])] });
    expect(kept.map((r) => r.follow_ups?.map((f) => f.id))).toEqual([['unpaid-bills']]);
    const lost: RoutineTemplate = {
      id: 'orders-call', name: 'Orders', description: 'x', mode: 'automatic', days: [1], time: '18:00', questions: [],
      collect: { list: 'orders', ask: ['billNo'], defaults: {}, max_items: 15 },
    };
    expect(fittingRoutines({ entities: [Party, Bill], registers: kept, routines: [lost] })).toEqual([]);
  });
});
```

Add `master-ai-backend/src/packs/generator.service.ts` to this task's commit.

- [ ] **Step 4: Offer follow-ups and collection routines as updates in `pack.ts`**

Change the registers import to `import { registersOf, validateCollects, validateRegisters } from './registers';`.

In `packUpdates`, after the `registers` constant, add:

```ts
  // New follow-ups on lists the workspace has, each valid against the updated record types.
  const followUps = (installed.registers ?? []).flatMap((mine) => {
    const have = new Set((mine.follow_ups ?? []).map((f) => f.id));
    const theirs = (latest.registers ?? []).find((r) => r.id === mine.id)?.follow_ups ?? [];
    const added = theirs.filter(
      (f) => !have.has(f.id) && validateRegisters({ entities: nextEntities, registers: [{ ...mine, follow_ups: [...(mine.follow_ups ?? []), f] }] }).length === 0,
    );
    return added.length ? [{ register: mine.id, followUps: added }] : [];
  });
  const listIds = new Set(registersOf({ entities: nextEntities, registers: [...(installed.registers ?? []), ...registers] }).map((r) => r.id));
```

In the returned object, replace the `routines:` line with:

```ts
    routines: missing(latest.routines ?? [], installed.routines ?? [], (r) => r.id).filter((r) => !r.collect || listIds.has(r.collect.list)),
```

and add `followUps,` after `registers,`.

In `emptyPackUpdates`, add `followUps: []` after `registers: []`. In `countPackUpdates`, add `+ (u.followUps ?? []).reduce((n, x) => n + x.followUps.length, 0)` after the registers term. In `applyPackUpdates`, replace the `registers:` line with:

```ts
    registers: [...(installed.registers ?? []), ...(u.registers ?? [])].map((r) => {
      const extra = (u.followUps ?? []).find((x) => x.register === r.id)?.followUps;
      return extra ? { ...r, follow_ups: [...(r.follow_ups ?? []), ...extra] } : r;
    }),
```

In `validatePackRefs`, after `issues.push(...validateRegisters(pack));` add `issues.push(...validateCollects(pack));`.

In `master-ai-backend/src/tenancy/onboarding.service.ts` `describeUpdates`, after the registers line add:

```ts
    ...(u.followUps ?? []).flatMap((x) => x.followUps.map((f) => `${f.label} (follow-up)`)),
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run`
Expected: PASS, including the existing `pack.test.ts` (no pack has follow-ups or collections yet).

- [ ] **Step 6: Build and typecheck**

Run: `pnpm build:packages && pnpm turbo run typecheck`
Expected: PASS. Where a test fixture builds a `ResolvedRegister` literal, add `followUps: []`.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-kit master-ai-backend/src/tenancy/onboarding.service.ts master-ai-backend/src/packs/generator.service.ts
git commit -m "feat(agent-kit): follow-ups and collection routines are resolved, validated and offered as updates

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Follow-ups and collection routines for the 15 ready-made types

**Files:**
- Modify: `packs/{wholesale-retail,logistics,travel-agency,it-services,software-saas,digital-agency,construction,power-plant,manufacturing-plant,hospital,education,municipal,lender,accounting-firm,ngo}/pack.yaml`
- Test: `packages/agent-kit/__tests__/pack.test.ts`

**Interfaces:**
- Consumes: Task 1 YAML format; Task 2 `registersOf(...).followUps`, `validateCollects` (inside `validatePackRefs`).
- Produces: the follow-up keys and routine ids below; later tasks and tests use `bills.unpaid-bills`, `tickets.overdue-tickets` (it-services), `bookings.held-bookings`, and the routines `todays-bills`, `new-bookings`.

Where to put things: `follow_ups:` goes inside the named register, after its `checks:` list (same indent as `checks:`). Collection routines are appended to the pack's own top-level `routines:` list when the file has one (it-services, software-saas, digital-agency, manufacturing-plant, hospital, education, municipal, accounting-firm, ngo); otherwise add a top-level `routines:` key just before `registers:` (wholesale-retail, logistics, travel-agency, construction, power-plant, lender). Routines are merged by id with the inherited ones, so the inherited `daily-update` etc. stay.

- [ ] **Step 1: Write the failing test**

Append to `packages/agent-kit/__tests__/pack.test.ts`:

```ts
describe('calls in the ready-made types', () => {
  const expected: Record<string, { followUps: string[]; collections: string[] }> = {
    'wholesale-retail': { followUps: ['bills.unpaid-bills', 'orders.late-purchase-orders'], collections: ['todays-bills'] },
    logistics: { followUps: ['shipments.pod-not-received'], collections: ['todays-lrs'] },
    'travel-agency': { followUps: ['bookings.held-bookings'], collections: ['new-bookings'] },
    'it-services': { followUps: ['tickets.overdue-tickets'], collections: ['new-tickets'] },
    'software-saas': { followUps: ['payments.unpaid-invoices', 'tickets.overdue-tickets'], collections: ['new-tickets'] },
    'digital-agency': { followUps: ['invoices.unpaid-invoices'], collections: ['new-jobs'] },
    construction: { followUps: ['site-issues.open-site-issues'], collections: ['todays-site-issues', 'weekly-contractor-bills'] },
    'power-plant': { followUps: ['work-permits.permits-past-time'], collections: ['permits-issued-today'] },
    'manufacturing-plant': { followUps: ['quality-issues.open-quality-issues'], collections: ['quality-issues-today'] },
    hospital: { followUps: ['cashless-requests.cashless-queries'], collections: ['cashless-sent-today'] },
    education: { followUps: ['fee-accounts.fees-due'], collections: ['new-enrolments'] },
    municipal: { followUps: ['service-applications.overdue-applications'], collections: ['applications-today'] },
    lender: { followUps: ['repayments.broken-promises', 'repayments.missed-repayments'], collections: ['cash-collections'] },
    'accounting-firm': { followUps: ['filings.papers-not-sent'], collections: ['new-tax-notices'] },
    ngo: { followUps: ['grants.grant-reports-due'], collections: ['donations-today'] },
  };

  for (const [id, want] of Object.entries(expected)) {
    it(`${id} offers its follow-ups and collections, and they fit its record types`, () => {
      const pack = resolvePack(registry.get(id)!, lookup);
      expect(registersOf(pack).flatMap((r) => r.followUps.map((f) => f.key)).sort()).toEqual([...want.followUps].sort());
      expect(pack.routines.filter((r) => r.collect).map((r) => r.id).sort()).toEqual([...want.collections].sort());
      expect(validatePackRefs(pack).filter((i) => /follow-up|routine /.test(i))).toEqual([]);
    });
  }

  it("keeps the lender's calls inside RBI's recovery hours", () => {
    const lender = registersOf(resolvePack(registry.get('lender')!, lookup)).find((r) => r.id === 'repayments')!;
    expect(lender.followUps.map((f) => f.hours)).toEqual([{ start: '08:00', end: '19:00' }, { start: '08:00', end: '19:00' }]);
  });

  it('calls outside parties only through party follow-ups, and staff through a team field', () => {
    for (const id of Object.keys(expected)) {
      for (const f of registersOf(resolvePack(registry.get(id)!, lookup)).flatMap((r) => r.followUps)) {
        if (f.who === 'party') expect(f.phone?.field.type, `${f.key} phone`).toBe('phone');
        else expect(f.staffField, `${f.key} staff`).not.toBeNull();
      }
    }
  });
});
```

Also update the existing construction expectation in the `routines` describe (~line 112):

```ts
    expect(construction.routines.map((r) => r.id).sort()).toEqual(['daily-update', 'daily-work-report', 'todays-site-issues', 'weekly-contractor-bills']);
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run __tests__/pack.test.ts`
Expected: FAIL — no pack has follow-ups or collections.

- [ ] **Step 3: Wholesale & retail**

Under register `bills`:

```yaml
    follow_ups:
      - id: unpaid-bills
        label: Unpaid bills → the party
        who: party
        due: { overdue: { date: dueDate } }
        when: { billType: [sales invoice], paymentStatus: [unpaid, part-paid] }
        phone: { ref: party, field: phone }
        contact: { ref: party, field: name }
        about: [billNo, billDate, total, dueDate]
        find_out: [paymentStatus, paymentRef]
```

Under register `orders`:

```yaml
    follow_ups:
      - id: late-purchase-orders
        label: Late purchase orders → the supplier
        who: party
        due: { overdue: { date: neededBy } }
        when: { orderType: [purchase order], status: [confirmed, on-hold, shipped] }
        phone: { field: phone }
        contact: { field: customerName }
        about: [orderNo, items, neededBy]
        find_out: [status, neededBy]
```

New top-level key before `registers:`:

```yaml
routines:
  - id: todays-bills
    name: Today's bills
    description: The AI calls the person who makes bills each evening and adds the day's bills to the Bills list.
    days: [1, 2, 3, 4, 5, 6]
    time: '18:00'
    collect:
      list: bills
      ask: [billNo, billType, party, total, gstAmount, dueDate]
      defaults: { billDate: today, paymentStatus: unpaid }
      who: the billing clerk
```

- [ ] **Step 4: Logistics and travel agency**

Logistics, under `shipments`:

```yaml
    follow_ups:
      - id: pod-not-received
        label: POD not received → the consignee
        who: party
        due: { overdue: { date: deliveredAt, grace_days: 3 } }
        when: { status: [delivered], podReceived: [false] }
        phone: { field: consigneePhone }
        contact: { field: consigneeName }
        about: [lrNumber, deliveredAt]
        find_out: [podReceived, podRemarks]
```

Logistics, new top-level key before `registers:`:

```yaml
routines:
  - id: todays-lrs
    name: Today's LRs
    description: The AI calls the booking clerk each evening and adds the day's lorry receipts to the Shipments list.
    days: [1, 2, 3, 4, 5, 6]
    time: '19:00'
    collect:
      list: shipments
      ask: [lrNumber, consignorName, consigneeName, fromCity, toCity, packages, freight, paymentTerms, truckNumber]
      defaults: { bookingDate: today, status: booked }
      who: the booking clerk
```

Travel agency, under `bookings`:

```yaml
    follow_ups:
      - id: held-bookings
        label: Held bookings → the supplier
        who: party
        due: { expiring: { date: date, days: 7 } }
        when: { status: [held] }
        phone: { field: supplierPhone }
        contact: { field: supplier }
        about: [service, date, partySize]
        find_out: [status]
```

Travel agency, new top-level key before `registers:`:

```yaml
routines:
  - id: new-bookings
    name: New bookings
    description: The AI calls the sales desk each evening and adds the day's new bookings to the Bookings list.
    days: [1, 2, 3, 4, 5, 6]
    time: '19:00'
    collect:
      list: bookings
      ask: [customerName, phone, service, date, partySize, amount, supplier]
      defaults: { status: requested }
      who: the sales desk
```

- [ ] **Step 5: IT services, software / SaaS, digital agency**

IT services, under `tickets`:

```yaml
    follow_ups:
      - id: overdue-tickets
        label: Overdue tickets → the engineer
        who: staff
        due: { overdue: { date: dueBy } }
        when: { status: [new, assigned, in-progress, waiting-for-client, reopened] }
        staff: { field: assignedTo }
        about: [ticketNo, clientName, summary, dueBy]
        find_out: [status, dueBy]
```

IT services, appended to `routines:`:

```yaml
  - id: new-tickets
    name: New tickets
    description: The AI calls the helpdesk lead each evening and adds the tickets that came in by phone or WhatsApp to the Tickets list.
    days: [1, 2, 3, 4, 5, 6]
    time: '17:30'
    collect:
      list: tickets
      ask: [clientName, summary, kind, priority, raisedBy, assignedTo, dueBy]
      defaults: { raisedAt: now, status: new }
      who: the helpdesk lead
```

Software / SaaS, under `tickets`:

```yaml
    follow_ups:
      - id: overdue-tickets
        label: Overdue tickets → the engineer
        who: staff
        due: { overdue: { date: dueBy } }
        when: { status: [new, triaged, in-progress, waiting-for-customer] }
        staff: { field: assignedTo }
        about: [ticketNo, account, summary, dueBy]
        find_out: [status, dueBy]
```

Software / SaaS, under `payments`:

```yaml
    follow_ups:
      - id: unpaid-invoices
        label: Unpaid invoices → the customer
        who: party
        due: { overdue: { date: invoiceDate, grace_days: 15 } }
        when: { status: [due, failed] }
        phone: { lookup: CustomerAccount, match: companyName, value: account, field: phone }
        contact: { field: account }
        about: [invoiceNumber, invoiceDate, amount]
        find_out: [status, reference]
```

Software / SaaS, appended to `routines:`:

```yaml
  - id: new-tickets
    name: New tickets
    description: The AI calls the support lead each evening and adds the day's new tickets to the Tickets list.
    days: [1, 2, 3, 4, 5]
    time: '17:30'
    collect:
      list: tickets
      ask: [account, summary, kind, severity, reportedBy, assignedTo]
      defaults: { reportedAt: now, status: new }
      who: the support lead
```

Digital agency, under `invoices`:

```yaml
    follow_ups:
      - id: unpaid-invoices
        label: Unpaid invoices → the client
        who: party
        due: { overdue: { date: dueDate } }
        when: { status: [sent, part-paid, overdue] }
        phone: { lookup: Customer, match: name, value: client, field: phone }
        contact: { field: client }
        about: [invoiceNumber, invoiceDate, amount, dueDate]
        find_out: [status]
```

Digital agency, appended to `routines:`:

```yaml
  - id: new-jobs
    name: New jobs
    description: The AI calls the account manager each evening and adds the jobs clients asked for to the Deliverables list.
    days: [1, 2, 3, 4, 5, 6]
    time: '18:00'
    collect:
      list: deliverables
      ask: [client, title, kind, dueDate, hoursEstimated]
      defaults: { status: in-progress }
      who: the account manager
```

- [ ] **Step 6: Construction, power plant, manufacturing plant**

Construction, under `site-issues`:

```yaml
    follow_ups:
      - id: open-site-issues
        label: Open site issues → the contractor
        who: party
        due: { overdue: { date: dueBy } }
        when: { status: [open, in-progress] }
        phone: { ref: contractor, field: phone }
        contact: { ref: contractor, field: name }
        about: [issueNo, project, location, description, dueBy]
        find_out: [status, dueBy]
```

Construction, new top-level key before `registers:`:

```yaml
routines:
  - id: todays-site-issues
    name: Site issues
    description: The AI calls the site supervisor each evening and adds the day's snags, shortages and delays to the Site issues list.
    days: [1, 2, 3, 4, 5, 6]
    time: '18:00'
    collect:
      list: site-issues
      ask: [project, location, kind, description, contractor, engineer, dueBy]
      defaults: { raisedOn: today, status: open }
      who: the site supervisor
  - id: weekly-contractor-bills
    name: Contractor bills
    description: The AI calls the quantity surveyor on Saturday and adds the week's running-account bills to the Contractor bills list.
    days: [6]
    time: '17:00'
    collect:
      list: contractor-bills
      ask: [contractor, project, raBillNumber, thisBill, retention, tds, netPayable]
      defaults: { receivedOn: today, status: received }
      who: the QS
```

Power plant, under `work-permits`:

```yaml
    follow_ups:
      - id: permits-past-time
        label: Permits past their time → the permit holder
        who: staff
        due: { overdue: { date: validTill } }
        when: { status: [issued] }
        staff: { field: receivedBy }
        about: [permitNo, equipment, validTill]
        find_out: [status]
```

Power plant, new top-level key before `registers:`:

```yaml
routines:
  - id: permits-issued-today
    name: Permits issued today
    description: The AI calls the shift in-charge each night and adds the day's work permits to the Work permits list.
    days: [0, 1, 2, 3, 4, 5, 6]
    time: '20:00'
    collect:
      list: work-permits
      ask: [permitNo, permitType, equipment, receivedBy, crewCount, validTill]
      defaults: { status: issued }
      who: the shift in-charge
```

Manufacturing plant, under `quality-issues`:

```yaml
    follow_ups:
      - id: open-quality-issues
        label: Open quality issues → the owner
        who: staff
        due: { overdue: { date: capaDue } }
        when: { status: [open, contained, capa-open] }
        staff: { field: owner }
        about: [partNo, lotNo, defect, capaDue]
        find_out: [status, capaDue]
```

Manufacturing plant, appended to `routines:`:

```yaml
  - id: quality-issues-today
    name: Quality issues found today
    description: The AI calls the QC in-charge each evening and adds the defects found today to the Quality issues list.
    days: [1, 2, 3, 4, 5, 6]
    time: '18:30'
    collect:
      list: quality-issues
      ask: [partNo, lotNo, defect, qtyAffected, foundAt, owner]
      defaults: { foundOn: today, status: open }
      who: the QC in-charge
```

- [ ] **Step 7: Hospital, education, municipal**

Hospital, under `cashless-requests`:

```yaml
    follow_ups:
      - id: cashless-queries
        label: Cashless queries → the TPA
        who: party
        due: { overdue: { date: sentAt, grace_days: 1 } }
        when: { status: [query] }
        phone: { field: tpaPhone }
        contact: { field: insurerOrTpa }
        about: [visitNumber, packageCode, amountAsked]
        find_out: [status, amountApproved]
```

Hospital, appended to `routines:`:

```yaml
  - id: cashless-sent-today
    name: Cashless requests sent today
    description: The AI calls the TPA desk each evening and adds the day's pre-authorisation and claim requests to the Cashless requests list.
    days: [0, 1, 2, 3, 4, 5, 6]
    time: '19:00'
    collect:
      list: cashless-requests
      ask: [patientName, visitNumber, payer, insurerOrTpa, requestType, amountAsked]
      defaults: { sentAt: now, status: sent }
      who: the TPA desk
```

Education, under `fee-accounts`:

```yaml
    follow_ups:
      - id: fees-due
        label: Fees due → the parent
        who: party
        due: { overdue: { date: nextDueDate, grace_days: 7 } }
        when: { due: { above: 0 } }
        phone: { lookup: Customer, match: admissionNumber, value: admissionNumber, field: phone }
        contact: { lookup: Customer, match: admissionNumber, value: admissionNumber, field: parentName }
        about: [studentName, academicYear, due, nextDueDate]
        find_out: [paid]
```

Education, appended to `routines:`:

```yaml
  - id: new-enrolments
    name: New enrolments
    description: The AI calls the admissions office each evening and adds the day's enquiries and admissions to the Enrolments list.
    days: [1, 2, 3, 4, 5, 6]
    time: '17:00'
    collect:
      list: enrolments
      ask: [customerName, phone, service, date, amount]
      defaults: { status: requested }
      who: the admissions office
```

Municipal, under `service-applications`:

```yaml
    follow_ups:
      - id: overdue-applications
        label: Overdue applications → the officer
        who: staff
        due: { overdue: { date: dueBy } }
        when: { status: [received, papers-pending, inspection, sanctioned] }
        staff: { field: designatedOfficer }
        about: [applicationNo, service, applicant, dueBy]
        find_out: [status]
```

Municipal, appended to `routines:`:

```yaml
  - id: applications-today
    name: Applications received today
    description: The AI calls the counter clerk each evening and adds the day's applications to the Service applications list.
    days: [1, 2, 3, 4, 5, 6]
    time: '17:30'
    collect:
      list: service-applications
      ask: [applicationNo, service, applicant, phone, ward, designatedOfficer]
      defaults: { receivedOn: today, status: received }
      who: the counter clerk
```

- [ ] **Step 8: Lender, accounting firm, NGO**

Lender, under `repayments`:

```yaml
    follow_ups:
      - id: missed-repayments
        label: Missed repayments → the borrower
        who: party
        due: { overdue: { date: dueDate, grace_days: 1 } }
        when: { status: [due, bounced, part-paid] }
        phone: { field: borrowerPhone }
        contact: { field: borrowerName }
        about: [loanNumber, dueDate, amountDue]
        find_out: [status, amountPaid, mode]
        hours: { start: '08:00', end: '19:00' }
      - id: broken-promises
        label: Broken promises → the borrower
        who: party
        due: { overdue: { date: promiseToPayOn } }
        when: { status: [promised] }
        phone: { field: borrowerPhone }
        contact: { field: borrowerName }
        about: [loanNumber, dueDate, amountDue]
        find_out: [status, amountPaid, mode]
        hours: { start: '08:00', end: '19:00' }
```

Lender, new top-level key before `registers:`:

```yaml
routines:
  - id: cash-collections
    name: Cash collections
    description: The AI calls the field officer each evening and adds the day's cash collections to the Repayments list.
    days: [1, 2, 3, 4, 5, 6]
    time: '18:30'
    collect:
      list: repayments
      ask: [loanNumber, borrowerName, amountPaid, receiptNumber]
      defaults: { mode: cash, status: paid, paidAt: now, dueDate: today }
      who: the field officer
```

Accounting firm, under `filings` (the label is quoted because of its apostrophe):

```yaml
    follow_ups:
      - id: papers-not-sent
        label: "Papers the client hasn't sent → the client"
        who: party
        due: { expiring: { date: dueDate, days: 10 } }
        when: { status: [waiting-for-client] }
        phone: { lookup: Customer, match: name, value: client, field: phone }
        contact: { field: client }
        about: [filingType, period, dueDate]
```

Accounting firm, appended to `routines:`:

```yaml
  - id: new-tax-notices
    name: New tax notices
    description: The AI calls the office manager each evening and adds notices that came in today to the Tax notices list.
    days: [1, 2, 3, 4, 5]
    time: '17:30'
    collect:
      list: tax-notices
      ask: [client, authority, noticeType, period, noticeDate, replyDueDate, referenceNo]
      defaults: { status: received }
      who: the office manager
```

NGO, under `grants`:

```yaml
    follow_ups:
      - id: grant-reports-due
        label: Grant reports due → the programme lead
        who: staff
        due: { expiring: { date: nextReportDue, days: 15 } }
        when: { status: [signed, active, closing] }
        staff: { field: programmeLead }
        about: [grantCode, donorName, nextReportDue]
        find_out: [nextReportDue]
```

NGO, appended to `routines:`:

```yaml
  - id: donations-today
    name: Donations received today
    description: The AI calls accounts each evening and adds the day's donations to the Donations list.
    days: [1, 2, 3, 4, 5, 6]
    time: '18:00'
    collect:
      list: donations
      ask: [receiptNumber, donorName, amount, mode, panOrId, purpose]
      defaults: { receivedOn: today }
      who: accounts
```

- [ ] **Step 9: Run the pack tests**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run __tests__/pack.test.ts`
Expected: PASS. A failure names the pack and the path (`register bills follow-up unpaid-bills: …` or `routine todays-bills: …`): fix the YAML to match the record type, never the test.

- [ ] **Step 10: Run the backend's sector install spec**

Run: `pnpm build:packages && pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts sector-lists`
Expected: PASS — every type still installs and every list still runs.

- [ ] **Step 11: Commit**

```bash
git add packs packages/agent-kit/__tests__/pack.test.ts
git commit -m "feat(packs): follow-ups and collection routines for every ready-made organization type

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Calls to outside parties, notes, switches, attempts and do-not-call in the database

**Files:**
- Modify: `master-ai-backend/src/db/schema.ts` (`calls` ~line 659, `routines` ~line 593; new tables after `calls`)
- Create: `master-ai-backend/drizzle/0015_calls_outside_parties.sql` (generated), `master-ai-backend/drizzle/0016_calls_outside_rls.sql` (custom)
- Modify: `packages/schemas/src/domain.ts` (`CallStage`, `CallOutcome`, `CallRecord`, `Routine`; new `CallAbout`, `RoutineCollect`)
- Modify: `master-ai-backend/src/voice/call-record.ts`, `master-ai-backend/src/voice/calls.service.ts`, `master-ai-backend/src/routines/routines.service.ts` (`toRoutine`, `endUnanswered`, `suggestionsFor`), `master-ai-backend/src/voice/delegation.service.ts` (`c.staffId` reads)
- Modify: `master-ai-web/src/components/phone-simulator.tsx:16-23`, `master-ai-web/src/components/delegation-card.tsx:7`
- Test: `master-ai-backend/__tests__/integration/calls-outside.spec.ts` (new), `master-ai-backend/__tests__/unit/voice/call-record.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 schemas.
- Produces:
  - Drizzle tables `recordNotes`, `followUpSwitches`, `followUpAttempts`, `doNotCall`; `calls.staffId` nullable; `calls.contactName`, `calls.contactPhone`, `calls.recordId`, `calls.followUp`; `calls.extracted.about?: CallAbout`; `routines.collect: RoutineCollect | null`.
  - `type CallStage = 'assign' | 'follow_up' | 'confirm' | 'checkin' | 'collect' | 'chase'`
  - `CallOutcome` adds `'settled' | 'promised' | 'disputed' | 'wrong_number' | 'do_not_call' | 'updated' | 'noted'`
  - `interface CallAbout { listId: string; itemId: string; title: string }`
  - `CallRecord.staffId: string | null`, `CallRecord.contact: { name: string; phone: string } | null`, `CallRecord.about: CallAbout | null`
  - `interface RoutineCollect { list; entity; listLabel; itemLabel; ask: string[]; defaults: Record<string, string | number | boolean>; maxItems: number; who: string | null }`; `Routine.collect: RoutineCollect | null`
  - `toCall(c, person: StaffRow | null, title, suggestions?)`; `RoutinesService.suggestionsFor(tx, c, person: StaffRow | null)`.

- [ ] **Step 1: Write the failing tests**

Create `master-ai-backend/__tests__/unit/voice/call-record.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { calls, staff } from '../../../src/db/schema';
import { toCall } from '../../../src/voice/call-record';

const now = new Date('2026-10-15T10:00:00Z');
const call = (over: Partial<typeof calls.$inferSelect>): typeof calls.$inferSelect => ({
  id: 'c1', tenantId: 't1', delegationId: null, checkinId: null, staffId: null, contactName: null, contactPhone: null, recordId: null, followUp: null,
  stage: 'chase', attempt: 1, status: 'ringing', provider: 'simulator', providerCallId: null, scheduledFor: now, startedAt: null, endedAt: null,
  transcript: [], summary: null, outcome: null, extracted: {}, costInr: 0, createdAt: now, ...over,
});
const anil = { id: 's1', name: 'Anil Kumar', title: 'Engineer' } as typeof staff.$inferSelect;

describe('a call as the apps see it', () => {
  it('names the outside party and the item it is about', () => {
    const c = toCall(call({ contactName: 'Sri Ganesh Traders', contactPhone: '+919847011111', extracted: { about: { listId: 'bills', itemId: 'r1', title: 'S-1042' } } }), null, 'S-1042');
    expect(c).toMatchObject({ staffId: null, staffName: 'Sri Ganesh Traders', staffTitle: 'Outside party', contact: { name: 'Sri Ganesh Traders', phone: '+919847011111' }, about: { listId: 'bills', itemId: 'r1', title: 'S-1042' } });
  });

  it('keeps a team member as before, with no contact', () => {
    const c = toCall(call({ staffId: 's1', stage: 'checkin' }), anil, 'Daily update');
    expect(c).toMatchObject({ staffId: 's1', staffName: 'Anil Kumar', staffTitle: 'Engineer', contact: null, about: null, delegationTitle: 'Daily update' });
  });
});
```

Create `master-ai-backend/__tests__/integration/calls-outside.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../../src/db/db.service';
import { calls } from '../../src/db/schema';
import { CallsService } from '../../src/voice/calls.service';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;
beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
});
afterAll(() => h.close());

describe('calls to outside parties', () => {
  it('lists a call to a party with who it was to and what it was about', async () => {
    const itemId = randomUUID();
    const [row] = await h.get(DbService).tenant(a.tenantId, (tx) =>
      tx
        .insert(calls)
        .values({
          tenantId: a.tenantId,
          stage: 'chase',
          attempt: 1,
          status: 'completed',
          provider: 'simulator',
          contactName: 'Sri Ganesh Traders',
          contactPhone: '+91 98470 11111',
          followUp: 'bills.unpaid-bills',
          extracted: { about: { listId: 'bills', itemId, title: 'S-1042' } },
        })
        .returning(),
    );
    const listed = (await h.get(CallsService).list(a.tenantId)).find((c) => c.id === row!.id);
    expect(listed).toMatchObject({
      staffId: null,
      staffName: 'Sri Ganesh Traders',
      staffTitle: 'Outside party',
      contact: { name: 'Sri Ganesh Traders', phone: '+91 98470 11111' },
      about: { listId: 'bills', itemId, title: 'S-1042' },
      delegationTitle: 'S-1042',
    });
    expect((await h.get(CallsService).get(a.tenantId, row!.id)).staffName).toBe('Sri Ganesh Traders');
  });

  it('refuses a call with nobody to call', async () => {
    const err = await h
      .get(DbService)
      .tenant(a.tenantId, (tx) => tx.insert(calls).values({ tenantId: a.tenantId, stage: 'chase', attempt: 1, provider: 'simulator' }))
      .catch((e: unknown) => e as { constraint?: string; cause?: { constraint?: string } });
    expect(err?.cause?.constraint ?? err?.constraint).toBe('calls_who');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice/call-record.test.ts`
Expected: FAIL — `contactName` is not a column; `toCall` has no `contact`.

- [ ] **Step 3: Domain types**

In `packages/schemas/src/domain.ts`:

```ts
/** Delegation calls assign, follow up and confirm; check-in calls collect a routine's answers; collect calls add items to a list; chase calls follow up an open item. */
export type CallStage = 'assign' | 'follow_up' | 'confirm' | 'checkin' | 'collect' | 'chase';
```

Add to `CallOutcome` (after `'call_back'`):

```ts
  /** Follow-up calls: the party says it is paid, received or done (a note proposes it). */
  | 'settled'
  | 'promised'
  | 'disputed'
  | 'wrong_number'
  | 'do_not_call'
  /** Follow-up calls to staff: the item was updated from what they said. */
  | 'updated'
  /** Follow-up calls: what was said is noted for the head. */
  | 'noted'
```

Add before `CallRecord`:

```ts
/** The list item a follow-up call is about. */
export interface CallAbout {
  listId: string;
  itemId: string;
  title: string;
}
```

In `CallRecord`, change `staffId: string;` to `staffId: string | null;`, document `staffName`/`staffTitle` as "the team member's, or the outside party's name and `Outside party`", and add after `staffTitle`:

```ts
  /** Calls to customers and suppliers: who and on which number. */
  contact: { name: string; phone: string } | null;
  /** Follow-up calls: the item they are about. */
  about: CallAbout | null;
```

Add before `Routine`:

```ts
/** A collection routine: the list it adds to and what it asks, copied from the template when switched on. */
export interface RoutineCollect {
  list: string;
  entity: string;
  /** "Bills" and "bill", for the routine's cards and the call. */
  listLabel: string;
  itemLabel: string;
  ask: string[];
  defaults: Record<string, string | number | boolean>;
  maxItems: number;
  who: string | null;
}
```

and add `collect: RoutineCollect | null;` to `Routine` after `questions`.

- [ ] **Step 4: Drizzle schema**

In `master-ai-backend/src/db/schema.ts`, add `date` to the `drizzle-orm/pg-core` import and `CallAbout, RoutineCollect` to the `@onehuman/schemas` type import. In `routines`, after `questions`:

```ts
    /** Collection routines: the list they add to. Null for question routines. */
    collect: jsonb('collect').$type<RoutineCollect>(),
```

In `calls`, replace the `staffId` line and add the outside-party columns:

```ts
    /** The team member called; null for calls to outside parties. */
    staffId: uuid('staff_id').references(() => staff.id),
    /** Calls to customers and suppliers: who and on which number. */
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    /** Follow-up calls: the item, and the follow-up (`<list>.<id>`). */
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'set null' }),
    followUp: text('follow_up'),
```

extend the `extracted` type with `about?: CallAbout;`, and replace the table's index callback with:

```ts
  (t) => [
    index('calls_delegation_idx').on(t.delegationId),
    index('calls_checkin_idx').on(t.checkinId),
    index('calls_status_idx').on(t.tenantId, t.status),
    index('calls_record_idx').on(t.recordId),
    check('calls_who', sql`${t.staffId} is not null or ${t.contactPhone} is not null`),
  ],
```

After `calls`, add:

```ts
/** What someone said on a call about a list item, for the head to apply or dismiss. Never applied by itself. */
export const recordNotes = pgTable(
  'record_notes',
  {
    id: id(),
    tenantId: tenantId(),
    recordId: uuid('record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
    callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
    /** The follow-up (`<list>.<id>`) the call was for; null for collection calls. */
    followUp: text('follow_up'),
    kind: text('kind', { enum: ['said', 'promise', 'dispute', 'wrong_number', 'difference', 'unreachable'] }).notNull(),
    /** Who said it: the party's or the team member's name. */
    speaker: text('speaker').notNull(),
    said: text('said').notNull(),
    /** Field values the note proposes; Apply sets them. */
    proposed: jsonb('proposed').$type<Record<string, unknown>>().notNull().default({}),
    promiseOn: date('promise_on', { mode: 'string' }),
    status: text('status', { enum: ['new', 'applied', 'dismissed'] }).notNull().default('new'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('record_notes_record_idx').on(t.recordId), index('record_notes_status_idx').on(t.tenantId, t.status)],
);

/** Which follow-ups a company has switched on. Every follow-up starts off. */
export const followUpSwitches = pgTable(
  'follow_up_switches',
  {
    tenantId: tenantId(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    followUp: text('follow_up').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    changedBy: uuid('changed_by'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.workspaceId, t.followUp] })],
);

/** One item's follow-up: how often it rang, when it is due again, and whether it waits for the head or has stopped. */
export const followUpAttempts = pgTable(
  'follow_up_attempts',
  {
    id: id(),
    tenantId: tenantId(),
    recordId: uuid('record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
    followUp: text('follow_up').notNull(),
    /** Calls nobody answered since the last answered one. */
    tries: integer('tries').notNull().default(0),
    lastCallAt: timestamp('last_call_at', { withTimezone: true }),
    nextDueOn: date('next_due_on', { mode: 'string' }).notNull(),
    state: text('state', { enum: ['active', 'waiting_for_you', 'stopped'] }).notNull().default('active'),
  },
  (t) => [uniqueIndex('follow_up_attempts_item_idx').on(t.recordId, t.followUp), index('follow_up_attempts_tenant_idx').on(t.tenantId)],
);

/** Numbers the AI never calls again: the person asked, or it was a wrong number. */
export const doNotCall = pgTable(
  'do_not_call',
  {
    id: id(),
    tenantId: tenantId(),
    /** The number's last 10 digits. */
    phone: text('phone').notNull(),
    reason: text('reason', { enum: ['asked', 'wrong_number'] }).notNull(),
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'set null' }),
    callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('do_not_call_phone_idx').on(t.tenantId, t.phone)],
);
```

- [ ] **Step 5: Generate the migration and add row-level security**

Run (with `pnpm infra:up` done):

```bash
pnpm --filter @onehuman/backend db:generate --name=calls_outside_parties
pnpm --filter @onehuman/backend exec drizzle-kit generate --custom --name=calls_outside_rls
```

Expected: `drizzle/0015_calls_outside_parties.sql` (it drops `NOT NULL` on `calls.staff_id`, adds the four columns, the check `calls_who`, the four tables and their indexes) and an empty `drizzle/0016_calls_outside_rls.sql`. Read 0015: it must not drop or recreate any existing table. Fill 0016 with:

```sql
-- Notes, follow-up switches and attempts, and the do-not-call list get the same tenant isolation as everything else.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['record_notes', 'follow_up_switches', 'follow_up_attempts', 'do_not_call'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO onehuman_app', t);
  END LOOP;
END $$;
```

Run: `pnpm db:migrate`
Expected: both migrations apply.

- [ ] **Step 6: Calls as the apps see them**

Replace `master-ai-backend/src/voice/call-record.ts` with:

```ts
import type { CallRecord } from '@onehuman/schemas';
import type { calls, staff } from '../db/schema';

/** A call as the apps see it, whatever it was about: delegated work, a check-in or collection, or a follow-up to staff or an outside party. */
export function toCall(c: typeof calls.$inferSelect, person: typeof staff.$inferSelect | null, title: string, suggestions?: string[]): CallRecord {
  return {
    id: c.id,
    delegationId: c.delegationId,
    checkinId: c.checkinId,
    staffId: c.staffId,
    staffName: person?.name ?? c.contactName ?? 'Someone',
    staffTitle: person?.title ?? 'Outside party',
    contact: c.contactPhone ? { name: c.contactName ?? 'Someone', phone: c.contactPhone } : null,
    about: c.extracted.about ?? null,
    stage: c.stage,
    attempt: c.attempt,
    status: c.status,
    provider: c.provider,
    scheduledFor: c.scheduledFor.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSec: c.startedAt && c.endedAt ? Math.round((c.endedAt.getTime() - c.startedAt.getTime()) / 1000) : null,
    transcript: c.transcript,
    summary: c.summary,
    outcome: c.outcome,
    extracted: { dueAt: c.extracted.dueAt, notes: c.extracted.notes, values: c.extracted.values },
    delegationTitle: title,
    ...(suggestions?.length && { suggestions }),
    createdAt: c.createdAt.toISOString(),
  };
}
```

(`extracted` now passes only the fields `CallRecord` declares, so engine state never reaches the apps.)

In `master-ai-backend/src/voice/calls.service.ts`, in both `list` and `get`, change `.innerJoin(staff, eq(staff.id, calls.staffId))` to `.leftJoin(staff, eq(staff.id, calls.staffId))` and the title expression to `r.job ?? r.routine ?? r.c.extracted.about?.title ?? 'Call'`.

In `master-ai-backend/src/routines/routines.service.ts`:
- `suggestionsFor(tx: Tx, c: CallRow, person: StaffRow | null)`; inside, use `person?.name ?? ''`.
- `endUnanswered`: `eq(staff.id, c.staffId!)` (check-in calls always have a person).
- `toRoutine`: add `collect: r.collect ?? null,` after `questions`.

In `master-ai-backend/src/voice/delegation.service.ts`, where a call row's `staffId` is read (`eq(staff.id, c.staffId)`, ~line 262), use `c.staffId!` — delegation calls always have a person. Run the typecheck to find any other place.

In `master-ai-web/src/components/phone-simulator.tsx`:

```ts
const STAGE_LABEL: Record<CallStage, string> = {
  assign: 'Assigning work',
  follow_up: 'Follow-up',
  confirm: 'Confirming done',
  checkin: 'Daily check-in',
  collect: 'Collecting items',
  chase: 'Follow-up on an item',
};
```

and add `collect: [], chase: [],` to `QUICK_REPLIES` (their replies come from the call's `suggestions`). In `master-ai-web/src/components/delegation-card.tsx`, `STAGE_NAME` gains `collect: 'Collection', chase: 'Follow-up'`.

- [ ] **Step 7: Run the tests**

Run: `pnpm build:packages && pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice/call-record.test.ts && pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts calls-outside tenant-isolation`
Expected: PASS (tenant isolation covers the four new tables).

- [ ] **Step 8: Typecheck and the whole suite**

Run: `pnpm turbo run typecheck test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add master-ai-backend packages/schemas master-ai-web/src/components
git commit -m "feat(calls): calls to outside parties, call notes, follow-up switches and attempts, and a do-not-call list

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Call notes — create, apply, dismiss — and "New from calls" on the lists

**Files:**
- Create: `master-ai-backend/src/notes/notes.service.ts`, `master-ai-backend/src/notes/notes.controller.ts`
- Modify: `master-ai-backend/src/app.module.ts` (register both)
- Modify: `master-ai-backend/src/records/records.service.ts` (`update` audit payload carries `ref`)
- Modify: `master-ai-backend/src/lists/lists.service.ts`, `master-ai-backend/src/lists/sql.ts` (`whereSql`, `cardSelect`), `master-ai-backend/src/lists/query.ts` (`SHOW`)
- Modify: `packages/schemas/src/lists.ts`, `packages/sdk/src/client.ts`, `master-ai-web/src/lib/lists.ts` (`SHOW_LABELS`)
- Test: `master-ai-backend/__tests__/integration/notes.spec.ts` (new)

**Interfaces:**
- Consumes: Task 4 `recordNotes`, `followUpAttempts`, `calls.contactName`.
- Produces:
  - `type NoteKind = 'said' | 'promise' | 'dispute' | 'wrong_number' | 'difference' | 'unreachable'`
  - `interface ListNote { id; kind: NoteKind; speaker; said; proposed: { field; label; value }[]; promiseOn: string | null; status: 'new' | 'applied' | 'dismissed'; decidedBy: string | null; callId: string | null; at: string }`
  - `ListShow` adds `'new_notes'`; `ListCard.newNotes: number`; `ListItem.newNotes: number`; `ListItemDetail.notes: ListNote[]`
  - `interface NewNote { recordId: string; callId: string | null; followUp: string | null; kind: NoteKind; speaker: string; said: string; proposed?: Record<string, unknown>; promiseOn?: string | null }`
  - `NotesService.create(tx: Tx, tenantId: string, note: NewNote): Promise<string>` (inside the caller's transaction; audits `note.created`)
  - `NotesService.apply(session, noteId): Promise<{ applied: true }>`, `NotesService.dismiss(session, noteId): Promise<{ dismissed: true }>`
  - Routes `POST /notes/:id/apply`, `POST /notes/:id/dismiss` (owner and admins); SDK `api.notes.apply(id)`, `api.notes.dismiss(id)`
  - A call-made item's source label is `Call with <name>`; an item changed on a call has `updated.by = <name>` with `via: 'call'`.

- [ ] **Step 1: Write the failing spec**

Create `master-ai-backend/__tests__/integration/notes.spec.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateStaffInputSchema } from '@onehuman/schemas';
import { SYSTEM } from '../../src/audit/audit.service';
import { DbService } from '../../src/db/db.service';
import { auditEvents, calls, followUpAttempts, recordNotes, records } from '../../src/db/schema';
import { ListsService } from '../../src/lists/lists.service';
import { NotesService, type NewNote } from '../../src/notes/notes.service';
import { RecordsService } from '../../src/records/records.service';
import { TeamService } from '../../src/voice/team.service';
import { istDate } from '../../src/voice/time';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;
let b: Org;
let lists: ListsService;
let notes: NotesService;
let partyId: string;
const today = istDate();
const tomorrow = istDate(new Date(Date.now() + 86_400_000));

beforeAll(async () => {
  h = await boot();
  [a, b] = await Promise.all([newOrg(h, 'wholesale-retail'), newOrg(h, 'wholesale-retail')]);
  lists = h.get(ListsService);
  notes = h.get(NotesService);
  partyId = (await lists.page(a.tenantId, 'parties', { range: 'all' })).items[0]!.id;
});
afterAll(() => h.close());

async function bill(billNo: string, extra: Record<string, unknown> = {}): Promise<string> {
  return h.get(DbService).tenant(a.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    const ws = await svc.activeWorkspace(tx);
    const data = { billNo, billType: 'sales invoice', party: partyId, billDate: today, total: 100, paymentStatus: 'unpaid', ...extra };
    return (await svc.create(tx, a.tenantId, ws, 'Bill', data, SYSTEM, { kind: 'agent' })).id;
  });
}
const paidNote = (recordId: string, over: Partial<NewNote> = {}): NewNote => ({
  recordId,
  callId: null,
  followUp: 'bills.unpaid-bills',
  kind: 'said',
  speaker: 'Sri Ganesh Traders',
  said: "It's paid, UTR 4455",
  proposed: { paymentStatus: 'paid', paymentRef: 'UTR4455' },
  ...over,
});
const addNote = (n: NewNote) => h.get(DbService).tenant(a.tenantId, (tx) => notes.create(tx, a.tenantId, n));

describe('notes from calls on the lists', () => {
  it('shows a new note on the item, on its card and under New from calls', async () => {
    const id = await bill('N-1');
    await addNote(paidNote(id));
    const page = await lists.page(a.tenantId, 'bills', { range: 'all', show: 'new_notes' });
    expect(page.items.map((i) => i.id)).toContain(id);
    expect(page.items.find((i) => i.id === id)!.newNotes).toBe(1);
    const card = (await lists.overview(a.tenantId)).lists.find((l) => l.id === 'bills')!.card;
    expect(card.newNotes).toBeGreaterThanOrEqual(1);
    const { notes: shown } = await lists.item(a.tenantId, 'bills', id);
    expect(shown[0]).toMatchObject({ kind: 'said', speaker: 'Sri Ganesh Traders', said: "It's paid, UTR 4455", status: 'new', decidedBy: null });
    expect(shown[0]!.proposed).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'paymentStatus', value: 'paid' }), expect.objectContaining({ field: 'paymentRef', value: 'UTR4455' })]));
  });

  it('applies a note: sets its fields, checks the item, and keeps what was said in the history', async () => {
    const id = await bill('N-2');
    const noteId = await addNote(paidNote(id));
    await notes.apply(a.session, noteId);
    const { item, history, notes: shown } = await lists.item(a.tenantId, 'bills', id);
    expect(item.data).toMatchObject({ paymentStatus: 'paid', paymentRef: 'UTR4455' });
    expect(item.checked?.by).toBe('Asha Owner');
    expect(item.newNotes).toBe(0);
    expect(shown[0]).toMatchObject({ status: 'applied', decidedBy: 'Asha Owner' });
    expect(history.at(-1)).toMatchObject({ kind: 'updated', note: 'From the call: "It\'s paid, UTR 4455"' });
    const events = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.refId, id), eq(auditEvents.type, 'note.applied'))));
    expect(events).toHaveLength(1);
    await expect(notes.apply(a.session, noteId)).rejects.toThrow(/already/i);
  });

  it('only lets a note with nothing to apply be marked as seen', async () => {
    const id = await bill('N-3');
    const noteId = await addNote(paidNote(id, { kind: 'promise', said: 'We will pay on Friday', proposed: {}, promiseOn: tomorrow }));
    await expect(notes.apply(a.session, noteId)).rejects.toThrow(/nothing to apply/i);
    await notes.dismiss(a.session, noteId);
    const { item, notes: shown } = await lists.item(a.tenantId, 'bills', id);
    expect(shown[0]).toMatchObject({ kind: 'promise', promiseOn: tomorrow, status: 'dismissed' });
    expect(item.newNotes).toBe(0);
  });

  it('starts calling again tomorrow about an item that waited for the head', async () => {
    const id = await bill('N-4');
    await h.get(DbService).tenant(a.tenantId, (tx) =>
      tx.insert(followUpAttempts).values({ tenantId: a.tenantId, recordId: id, followUp: 'bills.unpaid-bills', nextDueOn: today, state: 'waiting_for_you' }),
    );
    const noteId = await addNote(paidNote(id, { kind: 'dispute', said: 'The goods never came', proposed: {} }));
    await notes.dismiss(a.session, noteId);
    const [attempt] = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(followUpAttempts).where(eq(followUpAttempts.recordId, id)));
    expect(attempt).toMatchObject({ state: 'active', nextDueOn: tomorrow });
  });

  it("never finds another company's note", async () => {
    const id = await bill('N-5');
    const noteId = await addNote(paidNote(id));
    await expect(notes.apply(b.session, noteId)).rejects.toThrow(/not found/i);
    const [still] = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(recordNotes).where(eq(recordNotes.id, noteId)));
    expect(still?.status).toBe('new');
  });
});

describe('items from calls', () => {
  it('says which call an item came from, and who an item was changed with on a call', async () => {
    const ravi = await h.get(TeamService).create(a.session, CreateStaffInputSchema.parse({ name: 'Ravi Kumar', phone: '+91 98470 00001', title: 'Billing clerk' }));
    const [call] = await h.get(DbService).tenant(a.tenantId, (tx) =>
      tx.insert(calls).values({ tenantId: a.tenantId, staffId: ravi.id, stage: 'collect', attempt: 1, status: 'completed', provider: 'simulator' }).returning(),
    );
    const id = await h.get(DbService).tenant(a.tenantId, async (tx) => {
      const svc = h.get(RecordsService);
      const ws = await svc.activeWorkspace(tx);
      const row = await svc.create(tx, a.tenantId, ws, 'Bill', { billNo: 'C-1', billType: 'sales invoice' }, SYSTEM, { kind: 'call', ref: call!.id });
      await svc.update(tx, a.tenantId, ws, 'Bill', row.id, { total: 500 }, { actor: SYSTEM, via: 'call', ref: call!.id });
      return row.id;
    });
    const { item } = await lists.item(a.tenantId, 'bills', id);
    expect(item.source).toMatchObject({ kind: 'call', label: 'Call with Ravi Kumar', callId: call!.id });
    expect(item.updated).toMatchObject({ via: 'call', by: 'Ravi Kumar' });
    const [row] = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(records).where(eq(records.id, id)));
    expect(row?.updatedRef).toBe(call!.id);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts notes`
Expected: FAIL — `../../src/notes/notes.service` does not exist.

- [ ] **Step 3: List types**

In `packages/schemas/src/lists.ts`:

```ts
export type ListShow = 'problems' | 'not_checked' | 'checked' | 'new_notes';
```

Add `newNotes: number;` to `ListCard` (after `notChecked`, documented "Items with a note from a call the head hasn't seen") and to `ListItem` (after `checked`, "Notes from calls not yet applied or seen"). Add before `ListItemDetail`:

```ts
/** What a call left on an item: what was said (as said), and what it proposes. */
export type NoteKind = 'said' | 'promise' | 'dispute' | 'wrong_number' | 'difference' | 'unreachable';

export interface ListNote {
  id: string;
  kind: NoteKind;
  /** The party's or team member's name. */
  speaker: string;
  said: string;
  /** Changes it proposes, in words. Apply sets them. */
  proposed: { field: string; label: string; value: string }[];
  /** A promise's date, YYYY-MM-DD. */
  promiseOn: string | null;
  status: 'new' | 'applied' | 'dismissed';
  /** Who applied or dismissed it. */
  decidedBy: string | null;
  callId: string | null;
  at: string;
}
```

and add `notes: ListNote[];` to `ListItemDetail`. In `master-ai-web/src/lib/lists.ts`, `SHOW_LABELS` gains `new_notes: 'New from calls'`.

- [ ] **Step 4: NotesService and its routes**

Create `master-ai-backend/src/notes/notes.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NoteKind } from '@onehuman/schemas';
import { normalizeSnapshot, titleOf } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { isUuid } from '../lists/format';
import { DbService, type Tx } from '../db/db.service';
import { followUpAttempts, recordNotes, records } from '../db/schema';
import { RecordsService } from '../records/records.service';
import { istDate } from '../voice/time';

export interface NewNote {
  recordId: string;
  callId: string | null;
  /** The follow-up (`<list>.<id>`) the call was for; null for collection calls. */
  followUp: string | null;
  kind: NoteKind;
  speaker: string;
  said: string;
  proposed?: Record<string, unknown>;
  promiseOn?: string | null;
}

type NoteRow = typeof recordNotes.$inferSelect;

/**
 * Notes calls leave on list items. What an outside party says is never applied
 * by itself: the head applies a note (its proposed fields go through
 * RecordsService.update) or dismisses it. Either way, a follow-up that was
 * waiting for the head starts again the next day.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
  ) {}

  /** Adds a note inside the caller's transaction. */
  async create(tx: Tx, tenantId: string, note: NewNote): Promise<string> {
    const [row] = await tx
      .insert(recordNotes)
      .values({
        tenantId,
        recordId: note.recordId,
        callId: note.callId,
        followUp: note.followUp,
        kind: note.kind,
        speaker: note.speaker,
        said: note.said,
        proposed: note.proposed ?? {},
        promiseOn: note.promiseOn ?? null,
      })
      .returning();
    await this.audit.append(tx, tenantId, {
      type: 'note.created',
      actor: SYSTEM,
      refId: note.recordId,
      payload: { noteId: row!.id, kind: note.kind, speaker: note.speaker, title: await this.title(tx, note.recordId) },
    });
    return row!.id;
  }

  async apply(session: Session, noteId: string): Promise<{ applied: true }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const { note, rec } = await this.open(tx, noteId);
      if (Object.keys(note.proposed).length === 0) throw new BadRequestException('This note has nothing to apply. Mark it as seen instead.');
      const ws = await this.records.activeWorkspace(tx);
      await this.records.update(tx, session.tenantId, ws, rec.entity, rec.id, note.proposed, {
        actor: { id: session.principalId, kind: 'human' },
        via: 'manual',
        ref: note.id,
        note: `From the call: "${note.said}"`,
        checkedBy: session.principalId,
      });
      await this.decide(tx, session, note, 'applied');
      return { applied: true as const };
    });
  }

  async dismiss(session: Session, noteId: string): Promise<{ dismissed: true }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const { note } = await this.open(tx, noteId);
      await this.decide(tx, session, note, 'dismissed');
      return { dismissed: true as const };
    });
  }

  private async open(tx: Tx, noteId: string): Promise<{ note: NoteRow; rec: typeof records.$inferSelect }> {
    if (!isUuid(noteId)) throw new NotFoundException('Note not found');
    const [row] = await tx.select({ note: recordNotes, rec: records }).from(recordNotes).innerJoin(records, eq(records.id, recordNotes.recordId)).where(eq(recordNotes.id, noteId)).for('update');
    if (!row) throw new NotFoundException('Note not found');
    if (row.note.status !== 'new') throw new ConflictException('This note was already handled');
    return row;
  }

  private async decide(tx: Tx, session: Session, note: NoteRow, status: 'applied' | 'dismissed') {
    await tx.update(recordNotes).set({ status, decidedBy: session.principalId, decidedAt: new Date() }).where(eq(recordNotes.id, note.id));
    if (note.followUp) {
      await tx
        .update(followUpAttempts)
        .set({ state: 'active', nextDueOn: istDate(new Date(Date.now() + 86_400_000)) })
        .where(and(eq(followUpAttempts.recordId, note.recordId), eq(followUpAttempts.followUp, note.followUp), eq(followUpAttempts.state, 'waiting_for_you')));
    }
    await this.audit.append(tx, session.tenantId, {
      type: status === 'applied' ? 'note.applied' : 'note.dismissed',
      actor: { id: session.principalId, kind: 'human' },
      refId: note.recordId,
      payload: { noteId: note.id, kind: note.kind, title: await this.title(tx, note.recordId) },
    });
  }

  private async title(tx: Tx, recordId: string): Promise<string> {
    const [rec] = await tx.select().from(records).where(eq(records.id, recordId));
    if (!rec) return 'an item';
    const ws = await this.records.activeWorkspace(tx);
    const entity = normalizeSnapshot(ws.pack).entities.find((e) => e.name === rec.entity);
    return entity ? titleOf(entity, rec.data) : rec.entity;
  }
}
```

Create `master-ai-backend/src/notes/notes.controller.ts`:

```ts
import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
import { NotesService } from './notes.service';

/** The head applies or dismisses what a call noted on an item. */
@ManagersOnly()
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post(':id/apply')
  apply(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.apply(s, id);
  }

  @Post(':id/dismiss')
  dismiss(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.dismiss(s, id);
  }
}
```

Register `NotesController` in `controllers` and `NotesService` in `providers` of `master-ai-backend/src/app.module.ts`.

In `RecordsService.update`, the audit payload gains the reference (the note's or call's id):

```ts
      payload: { entity: entity.name, label: entity.label, title: titleOf(entity, merged), changes, via: change.via, ...(change.ref && { ref: change.ref }), ...(change.note && { note: change.note }) },
```

- [ ] **Step 5: Notes, call names and the filter in the lists**

In `master-ai-backend/src/lists/query.ts`: `const SHOW = ['problems', 'not_checked', 'checked', 'new_notes'] as const;`.

In `master-ai-backend/src/lists/sql.ts`, add above `whereSql`:

```ts
/** The item has a note from a call that nobody has applied or seen. */
const hasNewNote = sql`exists (select 1 from record_notes n where n.record_id = r.id and n.status = 'new')`;
```

In `whereSql` add `if (q.show === 'new_notes') parts.push(hasNewNote);`, and in `cardSelect` add `, count(*) filter (where ${hasNewNote})::int as new_notes` after `not_checked`.

In `master-ai-backend/src/lists/lists.service.ts`:
- imports: add `desc` from `drizzle-orm`; `ListNote` from `@onehuman/schemas`; `calls, recordNotes, staff` from `../db/schema`.
- `type CardRow = { count: number; sum: string | null; problems: number; not_checked: number; new_notes: number };` and in `card()` add `newNotes: Number(row.new_notes ?? 0),`.
- `item()` returns `{ list: meta(reg), item: …, history: …, notes: await this.itemNotes(tx, ws, reg, itemId) }`.
- In `decorate`, before the `return flags.flatMap(...)`:

```ts
    const callNames = await this.callNames(
      tx,
      unique(rows.flatMap((r) => [r.source === 'call' ? r.sourceRef : null, r.updatedVia === 'call' ? r.updatedRef : null])),
    );
    const newNotes = await this.newNoteCounts(tx, rows.map((r) => r.id));
```

  and in the item object: `source: sourceOf(r, name(r.createdBy), r.sourceRef ? caseOf.get(r.sourceRef) : undefined, r.sourceRef ? callNames.get(r.sourceRef) : undefined),`, `updated: { via: r.updatedVia, by: r.updatedVia === 'call' ? (r.updatedRef ? (callNames.get(r.updatedRef) ?? null) : null) : name(r.updatedBy), at: r.updatedAt.toISOString() },` and `newNotes: newNotes.get(r.id) ?? 0,` after `checked`.
- New private helpers (after `titles`):

```ts
  /** Who each call was with: the team member, or the outside party. */
  private async callNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    const want = ids.filter(isUuid);
    if (!want.length) return new Map();
    const rows = await tx
      .select({ id: calls.id, person: staff.name, contact: calls.contactName })
      .from(calls)
      .leftJoin(staff, eq(staff.id, calls.staffId))
      .where(inArray(calls.id, want));
    return new Map(rows.flatMap((c) => (c.person ?? c.contact ? [[c.id, (c.person ?? c.contact)!] as const] : [])));
  }

  private async newNoteCounts(tx: Tx, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await tx
      .select({ id: recordNotes.recordId, n: count() })
      .from(recordNotes)
      .where(and(inArray(recordNotes.recordId, ids), eq(recordNotes.status, 'new')))
      .groupBy(recordNotes.recordId);
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  }

  /** An item's notes from calls, newest first, with what they propose in words. */
  private async itemNotes(tx: Tx, ws: Workspace, reg: ResolvedRegister, itemId: string): Promise<ListNote[]> {
    const rows = await tx.select().from(recordNotes).where(eq(recordNotes.recordId, itemId)).orderBy(desc(recordNotes.createdAt));
    const names = await this.names(tx, rows.map((n) => n.decidedBy));
    const titles = await this.titles(tx, ws.pack, rows.flatMap((n) => Object.values(n.proposed)));
    return rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      speaker: n.speaker,
      said: n.said,
      proposed: Object.entries(n.proposed).map(([field, value]) => {
        const f = reg.entity.fields.find((x) => x.name === field);
        return { field, label: f?.label ?? field, value: f ? shown(f, value, titles) : String(value) };
      }),
      promiseOn: n.promiseOn,
      status: n.status,
      decidedBy: n.decidedBy ? (names.get(n.decidedBy) ?? 'Someone') : null,
      callId: n.callId,
      at: n.createdAt.toISOString(),
    }));
  }
```

- `sourceOf` takes a fourth parameter `callWith?: string` and its `call` case becomes:

```ts
    case 'call':
      return { kind: 'call', label: callWith ? `Call with ${callWith}` : 'Phone call', ...(r.sourceRef ? { callId: r.sourceRef } : {}) };
```

In `packages/sdk/src/client.ts`, add after `lists`:

```ts
    notes: {
      /** Sets what a call note proposes on its item; the item becomes checked by you. */
      apply: (id: string) => post<{ applied: true }>(`/notes/${id}/apply`),
      dismiss: (id: string) => post<{ dismissed: true }>(`/notes/${id}/dismiss`),
    },
```

- [ ] **Step 6: Run the spec and the existing list specs**

Run: `pnpm build:packages && pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts notes lists record-sources`
Expected: PASS. (`record-sources.spec.ts` still sees `Phone call` for a call item whose call row does not exist.)

- [ ] **Step 7: Typecheck and test everything**

Run: `pnpm turbo run typecheck test`
Expected: PASS. Web fixtures that build a `ListItem` or `ListCard` need `newNotes: 0`; `ListItemDetail` fixtures need `notes: []`.

- [ ] **Step 8: Commit**

```bash
git add master-ai-backend packages/schemas packages/sdk master-ai-web/src/lib/lists.ts
git commit -m "feat(lists): notes from calls, which the head applies or dismisses, and New from calls

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Reading spoken answers, and the collection call (`CollectEngine`)

**Files:**
- Create: `master-ai-backend/src/voice/spoken.ts`, `master-ai-backend/src/voice/understand.ts`, `master-ai-backend/src/voice/collect-engine.ts`
- Modify: `master-ai-backend/src/voice/time.ts` (add `addDaysTo`), `master-ai-backend/src/app.module.ts` (provide `CollectEngine`)
- Modify: `master-ai-backend/src/db/schema.ts` (`calls.extracted.collect?: CollectState`)
- Test: `master-ai-backend/__tests__/unit/voice/spoken.test.ts`, `master-ai-backend/__tests__/unit/voice/collect-engine.test.ts` (new)

**Interfaces:**
- Consumes: `parseDue`, `speakable`, `istDate` from `voice/time.ts`; `LlmService`.
- Produces:
  - `voice/time.ts`: `addDaysTo(day: string, n: number): string` (YYYY-MM-DD arithmetic).
  - `voice/spoken.ts`: `spokenAmount(text): number | null`, `spokenCount(text): number | null`, `spokenDate(text, now?): string | null`, `spokenDateTime(text, now?): string | null` (ISO), `spokenYesNo(text): boolean | null`, `matchOption(options: string[], text): string | null`, `cleanWords(text): string`, `orList(xs: string[]): string`, `lowerFirst(label): string`, `askFor(field: EntityField): string`, `sayDay(day, now): string`, `sayValue(field, value, titles: Record<string, string>, now): string`, `readBack(itemLabel, fields, item, titles, now): string`, `parseField(field, text, now): { ok: true; value: unknown } | { ok: false }`.
  - `voice/understand.ts`: `understandReply<T>(llm: LlmService, req: { tenantId: string; system: string; user: string; schema: z.ZodType<T> }): Promise<T | null>` — one repair round; null offline or on failure.
  - `voice/collect-engine.ts`: `CollectState`, `newCollectState()`, `CollectContext`, `CollectTurn`, `CollectDeps`, `CollectMatch`, `SaveResult`, `CollectHeard`, `collectTurn(ctx, text, deps, heard?)`, `simulatedCollectReply(ctx): string`, `collectSuggestions(ctx): string[]`, `collectSummary(state, ctx): string`, and `@Injectable() class CollectEngine { opening(ctx): string; turn(ctx, text, deps): Promise<CollectTurn> }`.

- [ ] **Step 1: Write the failing tests for spoken answers**

Create `master-ai-backend/__tests__/unit/voice/spoken.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityField } from '@onehuman/schemas';
import { askFor, matchOption, parseField, readBack, spokenAmount, spokenCount, spokenDate, spokenDateTime, spokenYesNo } from '../../../src/voice/spoken';
import { addDaysTo } from '../../../src/voice/time';

// 15 October 2026, 5:30 pm in India (a Thursday).
const now = new Date('2026-10-15T12:00:00Z');

describe('spoken amounts', () => {
  it.each([
    ['48,260', 48260],
    ['₹48260', 48260],
    ["it's 7,360 rupees", 7360],
    ['forty-eight thousand two sixty', 48260],
    ['two sixty', 260],
    ['two sixty eight', 268],
    ['two hundred sixty', 260],
    ['one lakh twenty', 120000],
    ['one lakh twenty thousand', 120000],
    ['1.2 lakh', 120000],
    ['a lakh', 100000],
    ['5 crore', 50000000],
    ['twelve', 12],
  ])('reads %s as %d', (text, value) => {
    expect(spokenAmount(text)).toBe(value);
  });

  it('finds no amount in words without numbers, and keeps only the first of two numbers', () => {
    expect(spokenAmount('not sure')).toBeNull();
    expect(spokenAmount('3 bills, 48260')).toBe(3);
  });

  it('reads a count, with none as zero', () => {
    expect(spokenCount('None today')).toBe(0);
    expect(spokenCount('three')).toBe(3);
    expect(spokenCount('a few')).toBeNull();
  });
});

describe('spoken dates', () => {
  it.each([
    ['today', '2026-10-15'],
    ['yesterday', '2026-10-14'],
    ['tomorrow', '2026-10-16'],
    ['day after tomorrow', '2026-10-17'],
    ['20 October', '2026-10-20'],
    ['the 20th of Oct', '2026-10-20'],
    ['October 20th', '2026-10-20'],
    ['20/10', '2026-10-20'],
    ['20-10-2026', '2026-10-20'],
    ['2026-11-02', '2026-11-02'],
    ['on Friday', '2026-10-16'],
    ['last Monday', '2026-10-12'],
    ['in 3 days', '2026-10-18'],
  ])('reads %s as %s', (text, day) => {
    expect(spokenDate(text, now)).toBe(day);
  });

  it('refuses a date that does not exist, and words with no date', () => {
    expect(spokenDate('31/02', now)).toBeNull();
    expect(spokenDate('soon', now)).toBeNull();
  });

  it('reads a date-time, with 6 pm India time when only a day is said', () => {
    expect(spokenDateTime('tomorrow 5 pm', now)).toBe('2026-10-16T11:30:00.000Z');
    expect(spokenDateTime('20 October', now)).toBe('2026-10-20T12:30:00.000Z');
  });

  it('adds days to an India date', () => {
    expect(addDaysTo('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysTo('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('yes, no and choices', () => {
  it('hears yes and no', () => {
    expect(spokenYesNo('Yes, that is right')).toBe(true);
    expect(spokenYesNo('Haan')).toBe(true);
    expect(spokenYesNo('Yes no problem')).toBe(true);
    expect(spokenYesNo('No, the total is wrong')).toBe(false);
    expect(spokenYesNo('not right')).toBe(false);
    expect(spokenYesNo('maybe')).toBeNull();
  });

  it('matches options with or without dashes, and by a unique first word', () => {
    const options = ['sales invoice', 'purchase bill', 'credit note', 'debit note'];
    expect(matchOption(options, "It's a sales invoice")).toBe('sales invoice');
    expect(matchOption(options, 'purchase')).toBe('purchase bill');
    expect(matchOption(['new', 'in-progress', 'resolved'], 'in progress')).toBe('in-progress');
    expect(matchOption(options, 'a receipt')).toBeNull();
  });
});

describe('questions and read-back', () => {
  const billType: EntityField = { name: 'billType', label: 'Bill type', type: 'enum', options: ['sales invoice', 'purchase bill'], required: true };
  const gst: EntityField = { name: 'gstAmount', label: 'GST amount', type: 'money', required: false };
  const party: EntityField = { name: 'party', label: 'Party', type: 'reference', ref: 'Party', required: false };
  const due: EntityField = { name: 'dueDate', label: 'Due date', type: 'date', required: false };

  it('asks for a field by its label and type', () => {
    expect(askFor(billType)).toBe("What's the bill type: sales invoice or purchase bill?");
    expect(askFor(gst)).toBe("What's the GST amount?");
    expect(askFor(party)).toBe('Which party?');
  });

  it('reads an item back in words', () => {
    const line = readBack('bill', [billType, party, gst, due], { billType: 'sales invoice', party: 'p1', gstAmount: 120000, dueDate: '2026-10-16' }, { party: 'Sri Ganesh Traders' }, now);
    expect(line).toBe('Bill: sales invoice, Sri Ganesh Traders, GST amount ₹1,20,000, due date tomorrow.');
  });

  it('reads a phone number and an e-mail, and refuses a number in words', () => {
    expect(parseField({ name: 'phone', label: 'Phone', type: 'phone', required: false }, '98470 12345', now)).toEqual({ ok: true, value: '9847012345' });
    expect(parseField({ name: 'email', label: 'E-mail', type: 'email', required: false }, 'it is Ravi@Example.com', now)).toEqual({ ok: true, value: 'ravi@example.com' });
    expect(parseField(gst, 'not sure', now)).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice/spoken.test.ts`
Expected: FAIL — `../../../src/voice/spoken` does not exist.

- [ ] **Step 3: Implement `addDaysTo` and `spoken.ts`**

Append to `master-ai-backend/src/voice/time.ts`:

```ts
/** The India date `n` days after `day` (YYYY-MM-DD); negative goes back. */
export function addDaysTo(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
```

Create `master-ai-backend/src/voice/spoken.ts`:

```ts
import type { EntityField } from '@onehuman/schemas';
import { addDaysTo, istDate, parseDue, speakable } from './time';

/**
 * Reading what people say on a call, the Indian way: amounts in lakhs and
 * "two sixty", dates like "20/10" (day first) and "last Monday", options
 * said without their dashes. Each reader returns null when it isn't sure, so
 * the call asks again instead of saving a guess.
 */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, k: 1_000, lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000, crore: 10_000_000, crores: 10_000_000,
};
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_NAMES = MONTHS.map((m) => m[0]!.toUpperCase() + m.slice(1));
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

type Part = { n: number } | { scale: number };

/** "48,260", "₹48260", "1.2 lakh", "forty-eight thousand two sixty", "one lakh twenty" (1,20,000), "two sixty" (260). */
export function spokenAmount(text: string): number | null {
  const tokens = text.toLowerCase().replace(/(\d),(?=\d)/g, '$1').match(/\d+(?:\.\d+)?|[a-z]+/g) ?? [];
  const parts: Part[] = [];
  tokens.forEach((tok, i) => {
    if (/^\d/.test(tok)) parts.push({ n: Number(tok) });
    else if (tok in UNITS) parts.push({ n: UNITS[tok]! });
    else if (tok in TENS) parts.push({ n: TENS[tok]! });
    else if (tok in SCALES && (tok !== 'k' || parts.length > 0)) parts.push({ scale: SCALES[tok]! });
    else if ((tok === 'a' || tok === 'an') && (tokens[i + 1] ?? '') in SCALES) parts.push({ n: 1 });
  });
  // Join the numbers said as one: "forty eight" → 48, "two sixty" → 260. Two numbers that don't join: keep the first.
  const merged: Part[] = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if ('n' in p && prev && 'n' in prev) {
      const endsInTens = prev.n % 100 >= 20 && prev.n % 10 === 0 && Number.isInteger(prev.n);
      if (endsInTens && p.n < 10) prev.n += p.n;
      else if (prev.n >= 1 && prev.n < 10 && p.n >= 10 && p.n < 100) prev.n = prev.n * 100 + p.n;
      else break;
      continue;
    }
    merged.push({ ...p });
  }
  if (!merged.some((p) => 'n' in p)) return null;
  let total = 0;
  let group = 0;
  let lastScale = Number.POSITIVE_INFINITY;
  for (const p of merged) {
    if ('n' in p) group += p.n;
    else if (p.scale === 100) group = (group || 1) * 100;
    else {
      total += (group || 1) * p.scale;
      lastScale = p.scale;
      group = 0;
    }
  }
  // "one lakh twenty" means 1,20,000: a small number after lakhs or crores counts in the next scale down.
  if (group > 0 && group < 100 && lastScale >= 100_000 && Number.isFinite(lastScale)) group *= lastScale / 100;
  return Math.round((total + group) * 100) / 100;
}

/** How many: "three", "12", "none" (0). */
export function spokenCount(text: string): number | null {
  if (/^\s*(none|no(ne)?\s*\w*\s*today|nothing|zero|nil|no)\b/i.test(text)) return 0;
  const n = spokenAmount(text);
  return n === null ? null : Math.round(n);
}

function realDay(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** A day, YYYY-MM-DD in India: "today", "yesterday", "20 October", "20/10" (day first), "on Friday", "last Monday", "in 3 days". */
export function spokenDate(text: string, now: Date = new Date()): string | null {
  const t = text.toLowerCase();
  const today = istDate(now);
  const year = Number(today.slice(0, 4));
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return realDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (/\bday before yesterday\b/.test(t)) return addDaysTo(today, -2);
  if (/\bday after tomorrow\b/.test(t)) return addDaysTo(today, 2);
  if (/\byesterday\b/.test(t)) return addDaysTo(today, -1);
  if (/\btomorrow\b/.test(t)) return addDaysTo(today, 1);
  if (/\b(today|tonight)\b/.test(t)) return today;
  const inDays = /\bin (\d{1,2}) days?\b/.exec(t);
  if (inDays) return addDaysTo(today, Number(inDays[1]));
  const numeric = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(t);
  if (numeric) {
    const y = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : year;
    return realDay(y, Number(numeric[2]), Number(numeric[1]));
  }
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}[a-z]*\\b`).test(t));
  if (month >= 0) {
    const name = `${MONTHS[month]!.slice(0, 3)}[a-z]*`;
    const day = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${name}`).exec(t) ?? new RegExp(`${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
    const y = /\b(20\d{2})\b/.exec(t);
    if (day) return realDay(y ? Number(y[1]) : year, month + 1, Number(day[1]));
  }
  const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (wd >= 0) {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    if (/\blast\b/.test(t)) return addDaysTo(today, -(((dow - wd + 7) % 7) || 7));
    return addDaysTo(today, ((wd - dow + 7) % 7) || 7);
  }
  return null;
}

/** A moment, as ISO: "tomorrow 5 pm"; a day alone means 6 pm India time. */
export function spokenDateTime(text: string, now: Date = new Date()): string | null {
  const due = parseDue(text, now);
  if (due) return due.toISOString();
  const day = spokenDate(text, now);
  return day ? new Date(`${day}T18:00:00+05:30`).toISOString() : null;
}

const YES_FIRST = /^\s*(yes|yeah|yep|yup|haan|han|ha|sure|correct|right|ok(ay)?)\b/i;
const NO = /\b(no|nope|nahi|nah|not|wrong|incorrect)\b/i;
const YES = /\b(yes|yeah|yep|yup|haan|sure|correct|right|ok(ay)?|speaking|that'?s me)\b/i;

export function spokenYesNo(text: string): boolean | null {
  if (YES_FIRST.test(text)) return true;
  if (NO.test(text)) return false;
  if (YES.test(text)) return true;
  return null;
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/[-_]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** The option said: the whole option ("in progress" for in-progress), or a first word only one option has ("purchase"). */
export function matchOption(options: string[], text: string): string | null {
  const t = norm(text);
  const whole = [...options].sort((a, b) => b.length - a.length).find((o) => t.includes(norm(o)));
  if (whole) return whole;
  const byFirst = options.filter((o) => {
    const first = norm(o).trim().split(' ')[0]!;
    return first.length >= 4 && t.includes(` ${first} `);
  });
  return byFirst.length === 1 ? byFirst[0]! : null;
}

/** What someone said, without "it's" and the full stop: "It's S-1042." → "S-1042". */
export function cleanWords(text: string): string {
  return text
    .trim()
    .replace(/^(it'?s|it is|that'?s|that is|the \w+(?: \w+)? is)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

export function orList(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}

/** "Due date" → "due date", but "GST amount" stays. */
export function lowerFirst(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How the AI asks for a field. */
export function askFor(f: EntityField): string {
  const label = lowerFirst(f.label);
  if (f.type === 'enum' && f.options?.length && f.options.length <= 6) return `What's the ${label}: ${orList(f.options)}?`;
  if (f.type === 'boolean') return `${f.label}: yes or no?`;
  if (f.type === 'reference') return `Which ${label}?`;
  return `What's the ${label}?`;
}

/** "today", "yesterday", "tomorrow", or "20 October" (with the year when it isn't this year). */
export function sayDay(day: string, now: Date): string {
  const today = istDate(now);
  if (day === today) return 'today';
  if (day === addDaysTo(today, -1)) return 'yesterday';
  if (day === addDaysTo(today, 1)) return 'tomorrow';
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTH_NAMES[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ''}`;
}

export function sayValue(f: EntityField, v: unknown, titles: Record<string, string>, now: Date): string {
  if (v === undefined || v === null || v === '') return 'not given';
  switch (f.type) {
    case 'money':
      return `₹${Number(v).toLocaleString('en-IN')}`;
    case 'date':
      return sayDay(String(v), now);
    case 'datetime':
      return speakable(new Date(String(v)));
    case 'boolean':
      return v === true ? 'yes' : 'no';
    case 'reference':
      return titles[f.name] ?? String(v);
    default:
      return String(v);
  }
}

/** "Bill: sales invoice, Sri Ganesh Traders, total ₹48,260, due date 20 October." */
export function readBack(itemLabel: string, fields: EntityField[], item: Record<string, unknown>, titles: Record<string, string>, now: Date): string {
  const parts = fields
    .filter((f) => item[f.name] !== undefined)
    .map((f) => (f.type === 'enum' || f.type === 'reference' ? sayValue(f, item[f.name], titles, now) : `${lowerFirst(f.label)} ${sayValue(f, item[f.name], titles, now)}`));
  return `${capitalize(itemLabel)}: ${parts.join(', ')}.`;
}

/** One spoken answer for one field. References are matched by the caller, against the records. */
export function parseField(f: EntityField, text: string, now: Date): { ok: true; value: unknown } | { ok: false } {
  const t = text.trim();
  switch (f.type) {
    case 'money':
    case 'number': {
      const n = spokenAmount(t);
      return n === null ? { ok: false } : { ok: true, value: n };
    }
    case 'integer': {
      const n = spokenAmount(t);
      return n === null ? { ok: false } : { ok: true, value: Math.round(n) };
    }
    case 'date': {
      const d = spokenDate(t, now);
      return d ? { ok: true, value: d } : { ok: false };
    }
    case 'datetime': {
      const d = spokenDateTime(t, now);
      return d ? { ok: true, value: d } : { ok: false };
    }
    case 'boolean': {
      const b = spokenYesNo(t);
      return b === null ? { ok: false } : { ok: true, value: b };
    }
    case 'enum': {
      const o = matchOption(f.options ?? [], t);
      return o ? { ok: true, value: o } : { ok: false };
    }
    case 'phone': {
      const digits = t.replace(/[^\d+]/g, '');
      return digits.replace(/\D/g, '').length >= 8 ? { ok: true, value: digits } : { ok: false };
    }
    case 'email': {
      const m = /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(t);
      return m ? { ok: true, value: m[0].toLowerCase() } : { ok: false };
    }
    default: {
      const v = cleanWords(t);
      return v ? { ok: true, value: v } : { ok: false };
    }
  }
}
```

- [ ] **Step 4: Run the spoken tests**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice/spoken.test.ts`
Expected: PASS. If a case fails, fix the reader, not the expectation: each row is how people in India say it.

- [ ] **Step 5: Write the failing collection-call tests**

Create `master-ai-backend/__tests__/unit/voice/collect-engine.test.ts`:

```ts
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
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice/collect-engine.test.ts`
Expected: FAIL — `../../../src/voice/collect-engine` does not exist.

- [ ] **Step 7: Implement `understand.ts` and `collect-engine.ts`**

Create `master-ai-backend/src/voice/understand.ts`:

```ts
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';

const logger = new Logger('UnderstandReply');

/**
 * Asks the model what one reply on a call says, in a fixed shape. An answer
 * that does not fit gets one repair round; then null, and the call's script
 * reads the reply itself. Offline there is no model call at all. The result
 * is only ever read by a script: it never writes anything.
 */
export async function understandReply<T>(llm: LlmService, req: { tenantId: string; system: string; user: string; schema: z.ZodType<T> }): Promise<T | null> {
  if (llm.mode === 'offline') return null;
  const jsonSchema = z.toJSONSchema(req.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  let user = req.user;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await llm.complete({
        tenantId: req.tenantId,
        purpose: 'call',
        tier: 'standard',
        fallbackTier: 'small',
        dataClass: 'internal',
        system: req.system,
        user,
        jsonSchema,
        effort: 'low',
        maxTokens: 800,
        offline: () => ({}),
      });
      const parsed = req.schema.safeParse(result.json);
      if (parsed.success) return parsed.data;
      const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      user = `${req.user}\n\nYour last answer did not match the format (${issues}). Answer again.`;
    } catch (err) {
      logger.warn(`Model could not read a call reply: ${(err as Error).message}`);
      return null;
    }
  }
  return null;
}
```

Create `master-ai-backend/src/voice/collect-engine.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { EntityField, TranscriptLine } from '@onehuman/schemas';
import { LlmService } from '../llm/llm.service';
import { askFor, cleanWords, lowerFirst, orList, parseField, readBack, spokenCount, spokenYesNo } from './spoken';
import { understandReply } from './understand';

/**
 * Collection calls: the AI phones the person who keeps a list (the billing
 * clerk, the helpdesk lead) and takes down today's items one field at a
 * time, reads each back, and saves it on a yes, so a dropped call keeps
 * every confirmed item. A script runs the call; with a model, the model only
 * says what a reply contains (several answers at once, yes or no), and the
 * script decides what happens.
 */

export interface CollectMatch {
  id: string;
  title: string;
}

export type SaveResult = { kind: 'saved'; id: string } | { kind: 'repeat'; id: string; differences: string[] } | { kind: 'invalid'; message: string };

export interface CollectDeps {
  /** Items of a record type whose title contains the words, best first. */
  lookup(entity: string, words: string): Promise<CollectMatch[]>;
  /** Saves a confirmed item; the service fills the routine's defaults and checks for repeats. */
  save(item: Record<string, unknown>): Promise<SaveResult>;
}

export interface CollectState {
  phase: 'count' | 'field' | 'pick' | 'confirm' | 'more' | 'done';
  /** How many they said there are; a hint only. */
  expected: number | null;
  /** The item being taken down. */
  item: Record<string, unknown>;
  /** Titles of the items its references point at, for the read-back. */
  titles: Record<string, string>;
  /** Optional fields they had no answer for, on this item. */
  skipped: string[];
  /** The field being asked: an index into the context's fields. */
  at: number;
  choices: CollectMatch[];
  /** The words said for the reference being matched, kept if nothing fits. */
  words: string | null;
  retries: number;
  /** Items finished on this call: saved, repeats, and ones left for the app. */
  done: number;
  saved: string[];
  differences: number;
}

export function newCollectState(): CollectState {
  return { phase: 'count', expected: null, item: {}, titles: {}, skipped: [], at: 0, choices: [], words: null, retries: 0, done: 0, saved: [], differences: 0 };
}

export interface CollectContext {
  tenantId: string;
  companyName: string;
  ownerName: string;
  staff: { name: string; title: string };
  /** "bills" and "bill". */
  listLabel: string;
  itemLabel: string;
  /** The fields it asks for, in order: the routine's ask, less its defaults. */
  fields: EntityField[];
  maxItems: number;
  state: CollectState;
  transcript: TranscriptLine[];
  now: Date;
}

export interface CollectTurn {
  say: string;
  end: boolean;
  callBack: boolean;
  state: CollectState;
}

/** What a model heard in one reply. Only the script acts on it. */
export interface CollectHeard {
  count: number | null;
  /** Field name → the words said for it. */
  values: Record<string, string>;
  answer: 'yes' | 'no' | null;
  noMore: boolean;
  callBack: boolean;
}

const CALL_BACK = /\b(call (me )?(back|later)|busy (now|right now)|can'?t talk|driving|in a meeting|not a good time)\b/i;
const NO_MORE = /\b(that'?s (all|it|everything)|no more|nothing (else|more)|that is all|done for (today|now)|no others?)\b/i;
const SKIP = /\b(skip|don'?t know|not sure|no idea|not there|not given|leave it|none|nil)\b/i;
const OTHER = /\b(none|neither|other|different one)\b/i;
const ORDINALS: [string, number][] = [['first', 0], ['second', 1], ['third', 2], ['one', 0], ['two', 1], ['three', 2]];
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** One turn of the call: the reply, read by the script (helped by what a model heard, if anything). */
export async function collectTurn(ctx: CollectContext, text: string, deps: CollectDeps, heard: CollectHeard | null = null): Promise<CollectTurn> {
  const prev = ctx.state;
  const s: CollectState = { ...prev, item: { ...prev.item }, titles: { ...prev.titles }, skipped: [...prev.skipped], choices: [...prev.choices], saved: [...prev.saved] };
  const first = ctx.staff.name.split(' ')[0];
  const { fields, itemLabel: item } = ctx;
  const answer = heard?.answer ? heard.answer === 'yes' : spokenYesNo(text);

  const say = (line: string): CollectTurn => ({ say: line.replace(/\s+/g, ' ').trim(), end: false, callBack: false, state: s });
  const end = (line: string, callBack = false): CollectTurn => {
    s.phase = 'done';
    return { say: line.replace(/\s+/g, ' ').trim(), end: true, callBack, state: s };
  };
  const close = () => end(closing(ctx, s));
  const resetItem = () => {
    s.item = {};
    s.titles = {};
    s.skipped = [];
    s.at = 0;
    s.retries = 0;
    s.choices = [];
    s.words = null;
  };
  const advance = (prefix = ''): CollectTurn => {
    s.retries = 0;
    const i = fields.findIndex((f) => !(f.name in s.item) && !s.skipped.includes(f.name));
    if (i < 0) {
      s.phase = 'confirm';
      return say(`${prefix} ${readBack(item, fields, s.item, s.titles, ctx.now)} Is that right?`);
    }
    s.at = i;
    s.phase = 'field';
    return say(`${prefix} ${askFor(fields[i]!)}`);
  };
  const afterItem = (line: string): CollectTurn => {
    resetItem();
    if (s.done >= ctx.maxItems) return end(`${line} That's all I can take on one call; please add the rest in the app. Thank you, ${first}.`);
    if (s.expected !== null && s.done >= s.expected) {
      s.phase = 'more';
      return say(`${line} That's ${s.done}. Any more ${ctx.listLabel}?`);
    }
    return advance(`${line} Next ${item}.`);
  };
  const skipOrRetry = (field: EntityField): CollectTurn => {
    if (!field.required && SKIP.test(text)) {
      s.skipped.push(field.name);
      return advance('Okay.');
    }
    if (s.retries < 1) {
      s.retries++;
      return say(`Sorry, I didn't catch that. ${askFor(field)}`);
    }
    if (!field.required) {
      s.skipped.push(field.name);
      return advance('Okay, moving on.');
    }
    s.done++;
    return afterItem(`I couldn't get the ${lowerFirst(field.label)}, so please add this ${item} in the app.`);
  };

  if (heard?.callBack || CALL_BACK.test(text)) return end(`No problem, ${first}. I'll call you back a little later.`, true);

  switch (s.phase) {
    case 'count': {
      const n = heard?.count ?? spokenCount(text);
      if (n === 0) return end(`Okay, no ${ctx.listLabel} today. Thank you, ${first}.`);
      if (n === null && s.retries < 1) {
        s.retries++;
        return say(`Sorry, how many ${ctx.listLabel} are there today?`);
      }
      s.expected = n;
      resetItem();
      return advance(`${n === null ? "Okay, let's start." : `${n}, got it.`} ${capitalize(item)} 1.`);
    }

    case 'field': {
      const field = fields[s.at]!;
      const fresh = Object.keys(s.item).length === 0 && s.skipped.length === 0;
      if (fresh && (heard?.noMore || NO_MORE.test(text))) return close();
      // A model may hear several answers in one reply: keep each that reads for its field.
      for (const [name, raw] of Object.entries(heard?.values ?? {})) {
        const f = fields.find((x) => x.name === name);
        if (!f || f.type === 'reference' || name === field.name || name in s.item) continue;
        const p = parseField(f, raw, ctx.now);
        if (p.ok) s.item[name] = p.value;
      }
      const raw = heard?.values[field.name] ?? text;
      if (field.type === 'reference') {
        const words = cleanWords(raw);
        if (!words || SKIP.test(words)) return skipOrRetry(field);
        const matches = (await deps.lookup(field.ref ?? '', words)).slice(0, 3);
        if (matches.length === 0) {
          s.item[field.name] = words;
          return advance(`I'll note ${words} as you said it.`);
        }
        s.choices = matches;
        s.words = words;
        s.phase = 'pick';
        s.retries = 0;
        return say(matches.length === 1 ? `${matches[0]!.title}, is that right?` : `Is it ${orList(matches.map((m) => m.title))}?`);
      }
      const parsed = parseField(field, raw, ctx.now);
      if (parsed.ok) {
        s.item[field.name] = parsed.value;
        return advance();
      }
      return skipOrRetry(field);
    }

    case 'pick': {
      const field = fields[s.at]!;
      const t = norm(text);
      const named = s.choices.find((c) => t.includes(norm(c.title)));
      const ordinal = ORDINALS.find(([w]) => new RegExp(`\\b${w}\\b`).test(t));
      let chosen: CollectMatch | null | undefined;
      if (named) chosen = named;
      else if (s.choices.length === 1 && answer !== null) chosen = answer ? s.choices[0] : null;
      else if (s.choices.length > 1 && ordinal && s.choices[ordinal[1]]) chosen = s.choices[ordinal[1]];
      else if (answer === false || OTHER.test(text)) chosen = null;
      if (chosen === undefined) {
        if (s.retries < 1) {
          s.retries++;
          return say(s.choices.length === 1 ? `Sorry, is it ${s.choices[0]!.title}? Yes or no?` : `Sorry, which one: ${orList(s.choices.map((c) => c.title))}?`);
        }
        chosen = null;
      }
      if (chosen) {
        s.item[field.name] = chosen.id;
        s.titles[field.name] = chosen.title;
      } else {
        s.item[field.name] = s.words;
      }
      s.choices = [];
      s.words = null;
      return advance(chosen ? 'Got it.' : `I'll note ${String(s.item[field.name])} as you said it.`);
    }

    case 'confirm': {
      if (answer === null && s.retries < 1) {
        s.retries++;
        return say('Sorry, is that right? Yes or no?');
      }
      if (answer !== true) {
        resetItem();
        return advance("Let's take it again.");
      }
      const res = await deps.save({ ...s.item });
      s.done++;
      if (res.kind === 'saved') {
        s.saved.push(res.id);
        return afterItem('Saved.');
      }
      if (res.kind === 'repeat') {
        if (!res.differences.length) return afterItem(`That ${item} is already on the list.`);
        s.differences++;
        return afterItem(`That ${item} is already on the list, with a different ${orList(res.differences.map(lowerFirst))}. I've noted it for ${ctx.ownerName}.`);
      }
      return afterItem("I couldn't save that one, so please add it in the app.");
    }

    case 'more': {
      if (heard?.noMore || NO_MORE.test(text) || answer === false) return close();
      if (answer === true || /\b(one more|another)\b/i.test(text)) {
        s.expected = null;
        return advance(`Okay. ${capitalize(item)} ${s.done + 1}.`);
      }
      if (s.retries < 1) {
        s.retries++;
        return say(`Sorry, any more ${ctx.listLabel}? Yes or no?`);
      }
      return close();
    }

    default:
      return close();
  }
}

function closing(ctx: CollectContext, s: CollectState): string {
  const first = ctx.staff.name.split(' ')[0];
  const n = s.saved.length;
  const added = n === 0 ? `I haven't added any ${ctx.listLabel}` : `I've added ${n} ${n === 1 ? ctx.itemLabel : ctx.listLabel}`;
  const noted = s.differences ? `, and noted ${s.differences === 1 ? 'a difference' : `${s.differences} differences`} for ${ctx.ownerName}` : '';
  return `Thank you, ${first}. ${added}${noted}. Have a good evening.`;
}

/** "Added 3 bills · 1 difference noted" for the call log and the routine's day. */
export function collectSummary(state: CollectState, ctx: Pick<CollectContext, 'listLabel' | 'itemLabel'>): string {
  const n = state.saved.length;
  const parts = [`Added ${n} ${n === 1 ? ctx.itemLabel : ctx.listLabel}`];
  if (state.differences) parts.push(`${state.differences} difference${state.differences === 1 ? '' : 's'} noted`);
  return parts.join(' · ');
}

/** A cooperative clerk for the simulator's auto mode: two items, then that's all. */
export function simulatedCollectReply(ctx: CollectContext): string {
  const s = ctx.state;
  const n = s.done + 1;
  switch (s.phase) {
    case 'count':
      return 'Two';
    case 'pick':
      return 'Yes';
    case 'confirm':
      return 'Yes';
    case 'more':
      return "No, that's all";
    case 'field': {
      const f = ctx.fields[s.at]!;
      return sampleAnswer(f, n);
    }
    default:
      return 'Thank you';
  }
}

function sampleAnswer(f: EntityField, n: number): string {
  switch (f.type) {
    case 'enum':
      return f.options?.[0] ?? 'Not sure';
    case 'money':
      return n === 1 ? '48,260' : '12,500';
    case 'number':
    case 'integer':
      return String(n + 2);
    case 'date':
      return 'today';
    case 'datetime':
      return 'tomorrow 5 pm';
    case 'boolean':
      return 'Yes';
    case 'phone':
      return `98470 1234${n}`;
    case 'email':
      return 'accounts@example.com';
    case 'reference':
      return 'Not sure';
    case 'text':
      return n === 1 ? 'Leaking tap near the main gate' : 'Two cement bags short';
    default:
      return /no\.?$|number|code/i.test(f.label) ? `S-${1040 + n}` : `Sample ${n}`;
  }
}

/** Likely replies for the simulator, for the question being asked. */
export function collectSuggestions(ctx: CollectContext): string[] {
  const s = ctx.state;
  switch (s.phase) {
    case 'count':
      return ['Two', 'None today', 'Can you call me later?'];
    case 'pick':
      return [...s.choices.map((c) => c.title), 'None of those'];
    case 'confirm':
      return ['Yes', 'No, that is wrong'];
    case 'more':
      return ["No, that's all", 'Yes, one more'];
    case 'field': {
      const f = ctx.fields[s.at];
      if (!f) return [];
      const fresh = Object.keys(s.item).length === 0 && s.skipped.length === 0;
      return [...new Set([sampleAnswer(f, s.done + 1), ...(f.required ? [] : ["Don't know"]), ...(fresh && s.done > 0 ? ["That's all"] : [])])];
    }
    default:
      return [];
  }
}

const HeardSchema = z.strictObject({
  count: z.number().int().min(0).max(500).nullable(),
  values: z.array(z.strictObject({ field: z.string(), value: z.string() })),
  answer: z.enum(['yes', 'no']).nullable(),
  no_more: z.boolean(),
  call_back: z.boolean(),
});

@Injectable()
export class CollectEngine {
  constructor(private readonly llm: LlmService) {}

  opening(ctx: CollectContext): string {
    const first = ctx.staff.name.split(' ')[0];
    return `Hi ${first}, this is the AI assistant at ${ctx.companyName}, calling for today's ${ctx.listLabel}. How many are there today?`;
  }

  async turn(ctx: CollectContext, text: string, deps: CollectDeps): Promise<CollectTurn> {
    return collectTurn(ctx, text, deps, await this.understand(ctx, text));
  }

  private async understand(ctx: CollectContext, text: string): Promise<CollectHeard | null> {
    const asked = ctx.transcript.filter((l) => l.speaker === 'ai').at(-1)?.text ?? '';
    const fields = ctx.fields.map((f) => `- ${f.name} (${f.type}${f.options ? `: ${f.options.join(' / ')}` : ''}): ${f.label}`).join('\n');
    const heard = await understandReply(this.llm, {
      tenantId: ctx.tenantId,
      schema: HeardSchema,
      system: `You read one reply on a phone call in which an AI assistant takes down today's ${ctx.listLabel} from ${ctx.staff.name}, one at a time.
Report only what the reply says; never guess or fill in.
values: the fields below the reply gives an answer for, with the words as said (do not convert amounts or dates).
answer: yes or no when the reply answers a yes-or-no question, else null.
count: how many ${ctx.listLabel} there are, if the reply says so, else null.
no_more: they say there are no more. call_back: they ask to be called later.`,
      user: `Fields:\n${fields}\n\nThe AI just said: "${asked}"\nThe reply: "${text}"`,
    });
    return heard && { count: heard.count, values: Object.fromEntries(heard.values.map((v) => [v.field, v.value])), answer: heard.answer, noMore: heard.no_more, callBack: heard.call_back };
  }
}
```

In `master-ai-backend/src/db/schema.ts`, add `import type { CollectState } from '../voice/collect-engine';` and `collect?: CollectState;` to the `calls.extracted` type. Provide `CollectEngine` in `master-ai-backend/src/app.module.ts`.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice`
Expected: PASS (spoken, collect-engine, and the existing check-in and voice tests).

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm --filter @onehuman/backend typecheck`
Expected: PASS.

```bash
git add master-ai-backend
git commit -m "feat(voice): read spoken amounts and dates the Indian way, and a collection call that takes items down one by one

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Collection routines — switched on per person, run by phone or by hand

**Files:**
- Create: `master-ai-backend/src/routines/collection.service.ts`
- Modify: `master-ai-backend/src/routines/routines.service.ts` (`templates`, `create`, `submit`, `placeCall`, `answer`, `reply`, `endUnanswered`, `suggestionsFor`, `summarize`), `master-ai-backend/src/app.module.ts` (provide `CollectionService`)
- Modify: `packages/schemas/src/domain.ts` (`RoutineTemplateInfo`), `packages/sdk/src/client.ts` (`routines.templates` type)
- Test: `master-ai-backend/__tests__/integration/collection.spec.ts` (new)

**Interfaces:**
- Consumes: Task 2 `registersOf`, `collectAsk`; Task 4 `routines.collect`, `RoutineCollect`; Task 5 `NotesService.create`; Task 6 `CollectEngine`, `CollectState`, `newCollectState`, `collectSuggestions`, `collectSummary`, `simulatedCollectReply`, `sayValue`, `lowerFirst`.
- Produces:
  - `type RoutineTemplateInfo = RoutineTemplate & { inUse: boolean; listLabel: string | null; askLabels: string[] }` (`GET /routines/templates`)
  - `POST /routines` with a collection `templateId` requires `staffIds` (400 "Pick who the AI calls …" otherwise) and stores `collect: RoutineCollect`.
  - A collection entry's `values` are `{ items: number; differences: number }`; manual entries post `{ staffId, values: { items: n } }`.
  - `CollectionService.snapshot(pack, collect): RoutineCollect`, `context(tx, r, person, state, transcript): Promise<CollectContext>`, `opening(ctx)`, `turn(tenantId, callId, r, person, ctx, text)`, `simulate(tenantId, callId, r, person, ctx)`, `finish(tenantId, callId, transcript, state, how: 'ended' | 'call_back' | 'dropped')`, `suggestions(ctx)`; `defaultsFor(defaults, entity, now)` (exported function).

- [ ] **Step 1: Write the failing spec**

Create `master-ai-backend/__tests__/integration/collection.spec.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateStaffInputSchema } from '@onehuman/schemas';
import { SYSTEM } from '../../src/audit/audit.service';
import { DbService } from '../../src/db/db.service';
import { calls as callsTable } from '../../src/db/schema';
import { ListsService } from '../../src/lists/lists.service';
import { RecordsService } from '../../src/records/records.service';
import { RoutinesService } from '../../src/routines/routines.service';
import { TenancyService } from '../../src/tenancy/tenancy.service';
import { CallsService } from '../../src/voice/calls.service';
import { TeamService } from '../../src/voice/team.service';
import { istDate } from '../../src/voice/time';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;
let routines: RoutinesService;
let calls: CallsService;
let lists: ListsService;
let kaveriId: string;

beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
  routines = h.get(RoutinesService);
  calls = h.get(CallsService);
  lists = h.get(ListsService);
  kaveriId = await addRecord('Party', { name: 'Kaveri Spec Traders', partyType: 'retailer', phone: '+91 98470 22222' });
});
afterAll(() => h.close());

async function addRecord(entity: string, data: Record<string, unknown>): Promise<string> {
  return h.get(DbService).tenant(a.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    return (await svc.create(tx, a.tenantId, await svc.activeWorkspace(tx), entity, data, SYSTEM, { kind: 'agent' })).id;
  });
}

/** A billing clerk with today's bills routine switched on for them. */
async function clerk(name: string) {
  const person = await h.get(TeamService).create(a.session, CreateStaffInputSchema.parse({ name, phone: `+91 98470 ${Math.floor(10000 + Math.random() * 89999)}`, title: 'Billing clerk' }));
  const routine = await routines.create(a.session, { templateId: 'todays-bills', staffIds: [person.id] });
  return { person, routine };
}

/** Runs the routine now and answers the call in the simulator; returns the call id. */
async function ring(routineId: string): Promise<string> {
  const run = await routines.startRun(a.tenantId, routineId, 'manual');
  const placed = await routines.placeCall(a.tenantId, run.entryIds[0]!, 1);
  await calls.answer(a.tenantId, placed.callId!);
  return placed.callId!;
}
async function say(callId: string, replies: string[]) {
  for (const text of replies) await calls.reply(a.tenantId, callId, text);
}
const bills = async () => (await lists.page(a.tenantId, 'bills', { range: 'all' })).items;

describe('collection routines', () => {
  it('offers the template with its list and what it asks, and needs someone to call', async () => {
    const t = (await routines.templates(a.tenantId)).find((x) => x.id === 'todays-bills')!;
    expect(t).toMatchObject({ listLabel: 'Bills', collect: { list: 'bills', who: 'the billing clerk' } });
    expect(t.askLabels.length).toBe(6);
    await expect(routines.create(a.session, { templateId: 'todays-bills' })).rejects.toThrow(/Pick who the AI calls/);
  });

  it('adds the bills a clerk reads out, from the call and not checked, and counts them on the day', async () => {
    const { routine } = await clerk('Ravi Kumar');
    expect(routine.collect).toMatchObject({ list: 'bills', listLabel: 'Bills', itemLabel: 'bill', maxItems: 15 });
    const callId = await ring(routine.id);
    expect(await calls.get(a.tenantId, callId)).toMatchObject({ stage: 'collect', status: 'in_progress' });
    expect((await calls.get(a.tenantId, callId)).transcript[0]!.text).toMatch(/calling for today's bills/);
    await say(callId, ['Two', 'CS-1', 'sales invoice', 'Kaveri Spec', 'yes', '48,260', '7,360', 'skip', 'yes']);
    await say(callId, ['CS-2', 'purchase bill', 'nobody', '1 lakh 20', 'skip', 'skip', 'yes', "No, that's all"]);

    const items = (await bills()).filter((i) => ['CS-1', 'CS-2'].includes(String(i.data.billNo)));
    expect(items).toHaveLength(2);
    const one = items.find((i) => i.data.billNo === 'CS-1')!;
    expect(one.data).toMatchObject({ billType: 'sales invoice', party: kaveriId, total: 48260, gstAmount: 7360, billDate: istDate(), paymentStatus: 'unpaid' });
    expect(one.source).toMatchObject({ kind: 'call', label: 'Call with Ravi Kumar', callId });
    expect(one.checked).toBeNull();
    const two = items.find((i) => i.data.billNo === 'CS-2')!;
    expect(two.data).toMatchObject({ party: 'nobody', total: 120000 });
    expect(two.problems.map((p) => p.key)).toContain('ref:party');

    const day = await routines.day(a.tenantId, routine.id);
    expect(day.entries[0]).toMatchObject({ status: 'reported', source: 'call', values: { items: 2, differences: 0 } });
    expect(day.summary.totals).toEqual([{ key: 'items', label: 'Bills added', value: 2 }]);
    expect(await calls.get(a.tenantId, callId)).toMatchObject({ status: 'completed', outcome: 'reported', summary: 'Added 2 bills' });
  });

  it('keeps the bills confirmed before the line dropped', async () => {
    const { routine } = await clerk('Meena Iyer');
    const callId = await ring(routine.id);
    await say(callId, ['Two', 'CD-1', 'sales invoice', 'nobody', '100', 'skip', 'skip', 'yes', 'CD-2', 'sales invoice']);
    await routines.endUnanswered(a.tenantId, callId);
    const numbers = (await bills()).map((i) => i.data.billNo);
    expect(numbers).toContain('CD-1');
    expect(numbers).not.toContain('CD-2');
    expect((await routines.day(a.tenantId, routine.id)).entries[0]).toMatchObject({ status: 'reported', values: { items: 1, differences: 0 } });
    expect((await calls.get(a.tenantId, callId)).summary).toBe('Added 1 bill');
  });

  it('notes a difference on the bill already on the list instead of adding it again', async () => {
    const existing = await addRecord('Bill', { billNo: 'CR-1', billType: 'sales invoice', party: kaveriId, total: 48260 });
    const { routine } = await clerk('Arun Das');
    const callId = await ring(routine.id);
    await say(callId, ['One', 'CR-1', 'sales invoice', 'Kaveri Spec', 'yes', '48,600', 'skip', 'skip', 'yes', "that's all"]);
    expect((await bills()).filter((i) => i.data.billNo === 'CR-1')).toHaveLength(1);
    const { notes, item } = await lists.item(a.tenantId, 'bills', existing);
    expect(item.data.total).toBe(48260);
    expect(notes[0]).toMatchObject({ kind: 'difference', speaker: 'Arun Das', status: 'new' });
    expect(notes[0]!.said).toMatch(/^On the call on \d{1,2} \w{3}, Arun gave the total as ₹48,600$/);
    expect(notes[0]!.proposed).toEqual([expect.objectContaining({ field: 'total' })]);
    expect((await routines.day(a.tenantId, routine.id)).entries[0]!.values).toEqual({ items: 0, differences: 1 });
  });

  it('counts the bills added by hand in manual mode', async () => {
    const { person, routine } = await clerk('Divya Nair');
    const day = await routines.submit(a.session, routine.id, { staffId: person.id, values: { items: 3 } });
    expect(day.entries[0]).toMatchObject({ status: 'reported', source: 'manual', values: { items: 3, differences: 0 } });
  });

  it('lets the simulated clerk add bills when nobody answers in the app', async () => {
    await h.get(TenancyService).updateSettings(a.session, { calls: { simulatorMode: 'auto' } });
    try {
      const { routine } = await clerk('Sam Joseph');
      const run = await routines.startRun(a.tenantId, routine.id, 'manual');
      const placed = await routines.placeCall(a.tenantId, run.entryIds[0]!, 1);
      expect(placed.done).toBe(true);
      const made = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(callsTable).where(eq(callsTable.id, placed.callId!)));
      expect(made[0]).toMatchObject({ status: 'completed', outcome: 'reported' });
      expect((await routines.day(a.tenantId, routine.id)).entries[0]!.values.items).toBe(2);
    } finally {
      await h.get(TenancyService).updateSettings(a.session, { calls: { simulatorMode: 'interactive' } });
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts collection`
Expected: FAIL — templates have no `listLabel`; creating `todays-bills` stores no `collect`.

- [ ] **Step 3: The template type**

In `packages/schemas/src/domain.ts`, change the pack import to `import type { PackAgent, ResolvedPack, RoutineQuestion, RoutineTemplate } from './pack';` and add after `Routine`:

```ts
/** A routine the industry setup offers. Collection routines name their list and what they ask. */
export type RoutineTemplateInfo = RoutineTemplate & { inUse: boolean; listLabel: string | null; askLabels: string[] };
```

In `packages/sdk/src/client.ts`, `routines.templates: () => get<RoutineTemplateInfo[]>('/routines/templates'),` (import the type).

- [ ] **Step 4: `CollectionService`**

Create `master-ai-backend/src/routines/collection.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Collect, EntityDef, EntityField, ResolvedPack, RoutineCollect, TranscriptLine } from '@onehuman/schemas';
import { collectAsk, normalizeSnapshot, registersOf, titleOf, type ListCheck, type ResolvedRegister } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import { DbService, type Tx } from '../db/db.service';
import { calls, principals, records, routineEntries, routines, staff, tenants } from '../db/schema';
import { NotesService } from '../notes/notes.service';
import { RecordsService } from '../records/records.service';
import {
  CollectEngine,
  collectSuggestions,
  collectSummary,
  simulatedCollectReply,
  type CollectContext,
  type CollectMatch,
  type CollectState,
  type CollectTurn,
  type SaveResult,
} from '../voice/collect-engine';
import { lowerFirst, sayValue } from '../voice/spoken';
import { istDate } from '../voice/time';

type RoutineRow = typeof routines.$inferSelect;
type StaffRow = typeof staff.$inferSelect;

const line = (speaker: TranscriptLine['speaker'], text: string): TranscriptLine => ({ speaker, text, at: new Date().toISOString() });

/** A routine's defaults as values: `today` is the India date, `now` the moment. */
export function defaultsFor(defaults: Record<string, string | number | boolean>, entity: EntityDef, now: Date): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(defaults).map(([name, v]) => {
      const f = entity.fields.find((x) => x.name === name);
      if (v === 'today' && f?.type === 'date') return [name, istDate(now)];
      if (v === 'now' && f?.type === 'datetime') return [name, now.toISOString()];
      return [name, v];
    }),
  );
}

/** "On the call on 15 Oct, Ravi gave the total as ₹48,600 and the GST amount as ₹7,400". */
function differenceText(person: string, fields: EntityField[], item: Record<string, unknown>, now: Date): string {
  const day = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(now);
  const parts = fields.map((f) => `the ${lowerFirst(f.label)} as ${sayValue(f, item[f.name], {}, now)}`);
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `On the call on ${day}, ${person.split(' ')[0]} gave ${said}`;
}

/**
 * Collection routines: the AI takes down today's items for a list from the
 * person who keeps it. Each confirmed item is saved at once with source `call`
 * (not checked); one that repeats an item already on the list (its first
 * duplicate check) is not saved again, and different details become a
 * difference note for the head. The entry counts what the calls added.
 */
@Injectable()
export class CollectionService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
    private readonly notes: NotesService,
    private readonly engine: CollectEngine,
  ) {}

  /** What a collection routine keeps from its template: the list and what it asks, with the labels as they are now. */
  snapshot(pack: ResolvedPack, c: Collect): RoutineCollect {
    const reg = registersOf(normalizeSnapshot(pack)).find((l) => l.id === c.list);
    if (!reg) throw new BadRequestException(`This routine adds to a list your setup doesn't have (${c.list})`);
    return {
      list: reg.id,
      entity: reg.entity.name,
      listLabel: reg.label,
      itemLabel: lowerFirst(reg.entity.label),
      ask: c.ask,
      defaults: c.defaults,
      maxItems: c.max_items,
      who: c.who ?? null,
    };
  }

  async context(tx: Tx, r: RoutineRow, person: StaffRow, state: CollectState, transcript: TranscriptLine[]): Promise<CollectContext> {
    const reg = await this.register(tx, r);
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, r.tenantId));
    const [owner] = await tx
      .select({ name: principals.displayName })
      .from(principals)
      .where(and(eq(principals.kind, 'human'), eq(principals.role, 'owner')))
      .limit(1);
    return {
      tenantId: r.tenantId,
      companyName: tenant?.name ?? 'the company',
      ownerName: owner?.name ?? 'the owner',
      staff: { name: person.name, title: person.title },
      listLabel: lowerFirst(reg.label),
      itemLabel: lowerFirst(reg.entity.label),
      fields: collectAsk(reg, r.collect!),
      maxItems: r.collect!.maxItems,
      state,
      transcript,
      now: new Date(),
    };
  }

  opening(ctx: CollectContext): string {
    return this.engine.opening(ctx);
  }

  /** One reply: the engine's turn, with lookups and saves against this company's records. */
  turn(tenantId: string, callId: string, r: RoutineRow, person: StaffRow, ctx: CollectContext, text: string): Promise<CollectTurn> {
    return this.engine.turn(ctx, text, {
      lookup: (entity, words) => this.lookup(tenantId, entity, words),
      save: (item) => this.save(tenantId, callId, r, person, item),
    });
  }

  /** The simulator's auto mode: a cooperative clerk answers until the call ends. */
  async simulate(tenantId: string, callId: string, r: RoutineRow, person: StaffRow, ctx: CollectContext) {
    let transcript: TranscriptLine[] = [line('ai', this.opening(ctx))];
    let state = ctx.state;
    let callBack = false;
    await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript }).where(eq(calls.id, callId)));
    for (let i = 0; i < 80 && state.phase !== 'done'; i++) {
      const reply = simulatedCollectReply({ ...ctx, state, transcript });
      const res = await this.turn(tenantId, callId, r, person, { ...ctx, state, transcript }, reply);
      transcript = [...transcript, line('person', reply), line('ai', res.say)];
      state = res.state;
      callBack = res.callBack;
      if (res.end) break;
    }
    return { transcript, state, callBack };
  }

  /**
   * Saves what the call did. Items were saved as they were confirmed; the entry
   * is reported when the call ended normally, or dropped after at least one item.
   * A call-back leaves it open so the routine calls again.
   */
  async finish(tenantId: string, callId: string, transcript: TranscriptLine[], state: CollectState, how: 'ended' | 'call_back' | 'dropped') {
    await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId));
      if (!c?.checkinId || c.status === 'completed') return;
      const [row] = await tx
        .select({ e: routineEntries, r: routines, person: staff })
        .from(routineEntries)
        .innerJoin(routines, eq(routines.id, routineEntries.routineId))
        .innerJoin(staff, eq(staff.id, routineEntries.staffId))
        .where(eq(routineEntries.id, c.checkinId));
      if (!row?.r.collect) return;
      const { e, r, person } = row;
      const labels = { listLabel: lowerFirst(r.collect.listLabel), itemLabel: r.collect.itemLabel };
      const took = state.saved.length + state.differences > 0;
      const reported = how === 'ended' || (how === 'dropped' && took);
      const outcome = how === 'call_back' ? 'call_back' : reported ? 'reported' : 'unclear';
      const summary =
        how === 'call_back'
          ? `${person.name.split(' ')[0]} asked to be called back.${took ? ` ${collectSummary(state, labels)}.` : ''}`
          : reported
            ? collectSummary(state, labels)
            : 'The call ended before any item was taken down.';
      await tx
        .update(calls)
        .set({ status: 'completed', endedAt: new Date(), transcript, outcome, summary, extracted: { ...c.extracted, collect: state } })
        .where(eq(calls.id, callId));
      const values = { items: Number(e.values.items ?? 0) + state.saved.length, differences: Number(e.values.differences ?? 0) + state.differences };
      await tx
        .update(routineEntries)
        .set({ values, ...(reported && { status: 'reported' as const, source: 'call' as const }), updatedAt: new Date() })
        .where(eq(routineEntries.id, e.id));
      await this.audit.append(tx, tenantId, { type: 'call.completed', actor: SYSTEM, refId: callId, payload: { staffName: person.name, stage: 'collect', outcome, summary } });
      if (reported) {
        await this.audit.append(tx, tenantId, { type: 'checkin.reported', actor: SYSTEM, refId: r.id, payload: { name: r.name, staffName: person.name, source: 'call', flags: 0 } });
      }
    });
  }

  suggestions(ctx: CollectContext): string[] {
    return collectSuggestions(ctx);
  }

  private async register(tx: Tx, r: RoutineRow): Promise<ResolvedRegister> {
    const ws = await this.records.activeWorkspace(tx);
    const reg = registersOf(normalizeSnapshot(ws.pack)).find((l) => l.id === r.collect?.list);
    if (!reg) throw new Error(`Routine ${r.id}: list ${r.collect?.list} is not in the workspace`);
    return reg;
  }

  /** Items whose title contains the words, most recently changed first. */
  private async lookup(tenantId: string, entityName: string, words: string): Promise<CollectMatch[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.records.activeWorkspace(tx);
      const entity = normalizeSnapshot(ws.pack).entities.find((e) => e.name === entityName);
      const titleField = entity && (entity.title_field ?? entity.fields.find((f) => f.type === 'string')?.name);
      if (!entity || !titleField) return [];
      const rows = await tx
        .select({ id: records.id, data: records.data })
        .from(records)
        .where(
          and(
            eq(records.workspaceId, ws.id),
            eq(records.entity, entity.name),
            sql`position(lower(${words}) in lower(coalesce(${records.data}->>${titleField}, ''))) > 0`,
          ),
        )
        .orderBy(desc(records.updatedAt))
        .limit(4);
      return rows.map((x) => ({ id: x.id, title: titleOf(entity, x.data) }));
    });
  }

  private async save(tenantId: string, callId: string, r: RoutineRow, person: StaffRow, item: Record<string, unknown>): Promise<SaveResult> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.records.activeWorkspace(tx);
      const reg = await this.register(tx, r);
      const now = new Date();
      const data = { ...defaultsFor(r.collect!.defaults, reg.entity, now), ...item };
      try {
        this.records.validate(reg.entity, data);
      } catch (err) {
        return { kind: 'invalid', message: (err as Error).message };
      }
      const dup = reg.checks.find((c): c is Extract<ListCheck, { kind: 'duplicate' }> => c.kind === 'duplicate');
      if (dup && dup.fields.every((f) => data[f.name] !== undefined && data[f.name] !== null && data[f.name] !== '')) {
        const [existing] = await tx
          .select()
          .from(records)
          .where(and(eq(records.workspaceId, ws.id), eq(records.entity, reg.entity.name), ...dup.fields.map((f) => sql`${records.data}->>${f.name} = ${String(data[f.name])}`)))
          .limit(1);
        if (existing) {
          const differ = collectAsk(reg, r.collect!).filter((f) => item[f.name] !== undefined && String(existing.data[f.name] ?? '') !== String(item[f.name]));
          if (differ.length) {
            await this.notes.create(tx, tenantId, {
              recordId: existing.id,
              callId,
              followUp: null,
              kind: 'difference',
              speaker: person.name,
              said: differenceText(person.name, differ, item, now),
              proposed: Object.fromEntries(differ.map((f) => [f.name, item[f.name]])),
            });
          }
          return { kind: 'repeat', id: existing.id, differences: differ.map((f) => f.label) };
        }
      }
      const row = await this.records.create(tx, tenantId, ws, reg.entity.name, data, SYSTEM, { kind: 'call', ref: callId });
      return { kind: 'saved', id: row.id };
    });
  }
}
```

Also change `sampleAnswer`'s reference case in `collect-engine.ts` to `return f.required ? 'Sharma and Sons' : 'Not sure';` so the simulated clerk can finish an item whose reference is required (it is kept as said and the list's reference check flags it).

- [ ] **Step 5: Route collection routines through `CollectionService`**

In `master-ai-backend/src/routines/routines.service.ts`:

Imports: add `import type { RoutineTemplateInfo } from '@onehuman/schemas';` (to the existing type import), `import { collectAsk, normalizeSnapshot, registersOf } from '@onehuman/agent-kit';`, `import { CollectionService } from './collection.service';`, `import { newCollectState } from '../voice/collect-engine';`. Add `private readonly collection: CollectionService,` to the constructor.

`templates`:

```ts
  /** Routines the installed industry pack offers, and whether each is already switched on. */
  async templates(tenantId: string): Promise<RoutineTemplateInfo[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const pack = normalizeSnapshot(ws.pack);
      const lists = registersOf(pack);
      const used = new Set((await tx.select({ t: routines.templateId }).from(routines)).map((r) => r.t));
      return pack.routines.flatMap((t) => {
        if (!t.collect) return [{ ...t, inUse: used.has(t.id), listLabel: null, askLabels: [] }];
        const reg = lists.find((l) => l.id === t.collect!.list);
        return reg ? [{ ...t, inUse: used.has(t.id), listLabel: reg.label, askLabels: collectAsk(reg, t.collect).map((f) => f.label) }] : [];
      });
    });
  }
```

In `create`, replace the lines from `const questions = …` through the `throw` with:

```ts
      const collect = template?.collect ? this.collection.snapshot(ws.pack, template.collect) : null;
      const questions = collect ? [] : (input.questions ?? template?.questions);
      const name = input.name ?? template?.name;
      if (!name || (!collect && !questions?.length)) throw new BadRequestException('A routine needs a name and at least one question');
      if (collect && !input.staffIds?.length) throw new BadRequestException(`Pick who the AI calls for ${name}`);
```

and add `collect,` to the inserted values (after `questions`).

In `submit`, for a collection routine the entry is a count:

```ts
      const values = r.collect
        ? { items: Math.max(0, Math.round(Number(input.values.items) || 0)), differences: 0 }
        : cleanValues(r.questions, input.values as Record<string, CheckinValue>);
      const missing = r.collect ? [] : r.questions.filter((q) => q.required && (values[q.key] === undefined || values[q.key] === null || values[q.key] === ''));
```

(the rest of `submit` is unchanged; `flagsOf` of no questions is `[]`).

In `placeCall`, the insert becomes:

```ts
        .values({
          tenantId,
          checkinId: entryId,
          staffId: e.staffId,
          stage: r.collect ? 'collect' : 'checkin',
          attempt,
          status: 'ringing',
          provider: s.provider,
          extracted: r.collect ? { collect: newCollectState() } : { values: e.values },
        })
```

the audit payload's `stage` uses the same expression, and the transaction returns:

```ts
      return {
        callId: call!.id,
        phone: person.phone,
        r,
        person,
        ctx: r.collect ? null : await this.context(tx, r, person, e.values, {}, []),
        collect: r.collect ? await this.collection.context(tx, r, person, newCollectState(), []) : null,
      };
```

Destructure `const { callId, phone, ctx, collect, r, person } = placed;`. After `if (s.simulatorMode === 'interactive') return { callId, done: false };` add:

```ts
    if (collect) {
      const done = await this.collection.simulate(tenantId, callId, r, person, collect);
      await this.collection.finish(tenantId, callId, done.transcript, done.state, done.callBack ? 'call_back' : 'ended');
      return { callId, done: true };
    }
```

and use `ctx!` in the existing check-in simulation below it.

In `answer`, replace the context and opening lines with:

```ts
      const opening = r.collect
        ? this.collection.opening(await this.collection.context(tx, r, person, c.extracted.collect ?? newCollectState(), []))
        : this.engine.opening(await this.context(tx, r, person, c.extracted.values ?? e.values, {}, []));
      await tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript: [line('ai', opening)] }).where(eq(calls.id, call.id));
```

Replace `reply` with:

```ts
  async reply(tenantId: string, call: CallRow, text: string) {
    const { c, r, person } = await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, call.id));
      if (!c || c.status !== 'in_progress') throw new BadRequestException('Answer the call first');
      const { r, person } = await this.entry(tx, c.checkinId!);
      return { c, r, person };
    });
    if (r.collect) {
      const ctx = await this.db.tenant(tenantId, (tx) => this.collection.context(tx, r, person, c.extracted.collect ?? newCollectState(), c.transcript));
      const res = await this.collection.turn(tenantId, call.id, r, person, ctx, text);
      const transcript = [...c.transcript, line('person', text), line('ai', res.say)];
      if (res.end) {
        await this.collection.finish(tenantId, call.id, transcript, res.state, res.callBack ? 'call_back' : 'ended');
        await this.temporal.signalCheckin(c.checkinId!, { callId: call.id, event: 'ended' });
      } else {
        await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ transcript, extracted: { ...c.extracted, collect: res.state } }).where(eq(calls.id, call.id)));
      }
      return;
    }
    const ctx = await this.db.tenant(tenantId, (tx) => this.context(tx, r, person, c.extracted.values ?? {}, c.extracted.retries ?? {}, c.transcript));
    const res = await this.engine.turn(ctx, text);
    const transcript = [...c.transcript, line('person', text), line('ai', res.say)];
    if (res.end) {
      await this.finishCall(tenantId, call.id, transcript, res.values, res.callBack);
      await this.temporal.signalCheckin(c.checkinId!, { callId: call.id, event: 'ended' });
    } else {
      await this.db.tenant(tenantId, (tx) =>
        tx.update(calls).set({ transcript, extracted: { ...c.extracted, values: res.values, retries: res.retries } }).where(eq(calls.id, call.id)),
      );
    }
  }
```

In `endUnanswered`, the in-progress branch becomes:

```ts
    if (c.status === 'in_progress') {
      // Keep whatever was answered (or taken down) before the line dropped.
      if (c.stage === 'collect') await this.collection.finish(tenantId, callId, c.transcript, c.extracted.collect ?? newCollectState(), 'dropped');
      else await this.finishCall(tenantId, callId, c.transcript, c.extracted.values ?? {}, true);
      return;
    }
```

In `suggestionsFor`, after reading `row`:

```ts
    if (!row) return [];
    if (row.r.collect) return this.collection.suggestions(await this.collection.context(tx, row.r, person!, c.extracted.collect ?? newCollectState(), c.transcript));
    return checkinSuggestions(row.r.questions, c.extracted.values ?? {}, person?.name ?? '');
```

In `summarize`, collection routines total what was added:

```ts
  const totals = r.collect
    ? [{ key: 'items', label: `${r.collect.listLabel} added`, value: reported.reduce((n, e) => n + Number(e.values.items ?? 0), 0) }]
    : r.questions
        .filter((q) => q.type === 'number' || q.type === 'percent')
        .map((q) => {
          const nums = reported.map((e) => e.values[q.key]).filter((v): v is number => typeof v === 'number');
          const value = q.type === 'number' ? nums.reduce((a, b) => a + b, 0) : nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
          return { key: q.key, label: q.type === 'percent' ? `Average ${q.label.toLowerCase()}` : q.label, value, ...(q.type === 'percent' ? { unit: '%' } : q.unit ? { unit: q.unit } : {}) };
        });
```

(The question branch is the existing computation, moved under the condition.)

Provide `CollectionService` in `master-ai-backend/src/app.module.ts`.

- [ ] **Step 6: Run the spec and the routine tests**

Run: `pnpm build:packages && pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts collection && pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice`
Expected: PASS.

- [ ] **Step 7: Typecheck and test everything**

Run: `pnpm turbo run typecheck test`
Expected: PASS (web code that reads `routines.templates()` still typechecks: `RoutineTemplateInfo` extends what it had).

- [ ] **Step 8: Commit**

```bash
git add master-ai-backend packages/schemas packages/sdk
git commit -m "feat(routines): collection routines add today's items to a list by phone or by hand

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The follow-up call (`FollowUpEngine`)

**Files:**
- Create: `master-ai-backend/src/voice/follow-up-engine.ts`
- Modify: `master-ai-backend/src/voice/spoken.ts` (add `aboutText`), `master-ai-backend/src/db/schema.ts` (`calls.extracted.followUp?: FollowUpState`), `master-ai-backend/src/app.module.ts` (provide `FollowUpEngine`)
- Test: `master-ai-backend/__tests__/unit/voice/follow-up-engine.test.ts` (new)

**Interfaces:**
- Consumes: Task 6 `spokenDate`, `spokenDateTime`, `spokenAmount`, `spokenYesNo`, `matchOption`, `orList`, `sayDay`, `sayValue`, `lowerFirst`, `understandReply`; `speakable`, `istDate` from `voice/time.ts`.
- Produces:
  - `aboutText(itemLabel, fields, data, titles, now): string` — "bill S-1042: bill date 12 October, total ₹48,260, due date 20 October".
  - `FollowUpState { phase: 'identity' | 'ask' | 'reference' | 'done'; retries: number; result: FollowUpResult | null }`, `newFollowUpState(who)`
  - `FollowUpResult = { kind: 'settled'; said; proposed } | { kind: 'promise'; said; promiseOn } | { kind: 'dispute'; said } | { kind: 'wrong_number'; said } | { kind: 'do_not_call'; said } | { kind: 'status'; said; patch } | { kind: 'said'; said }`
  - `FollowUpContext { tenantId; companyName; who; name; about; findOut: EntityField[]; state; transcript; now }`, `FollowUpTurn { say; end; callBack; state }`, `FollowUpHeard`
  - `followUpTurn(ctx, text, heard?)`, `followUpOpening(ctx)`, `simulatedFollowUpReply(ctx)`, `followUpSuggestions(ctx)`, `@Injectable() class FollowUpEngine { opening(ctx); turn(ctx, text) }`

- [ ] **Step 1: Write the failing tests**

Create `master-ai-backend/__tests__/unit/voice/follow-up-engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice/follow-up-engine.test.ts`
Expected: FAIL — `../../../src/voice/follow-up-engine` does not exist.

- [ ] **Step 3: `aboutText` and the engine**

Append to `master-ai-backend/src/voice/spoken.ts`:

```ts
/** What a follow-up call is about: "bill S-1042: bill date 12 October, total ₹48,260, due date 20 October". */
export function aboutText(itemLabel: string, fields: EntityField[], data: Record<string, unknown>, titles: Record<string, string>, now: Date): string {
  const given = fields.filter((f) => data[f.name] !== undefined && data[f.name] !== null && data[f.name] !== '');
  const [first, ...rest] = given;
  if (!first) return `a ${itemLabel}`;
  const head = `${itemLabel} ${sayValue(first, data[first.name], titles, now)}`;
  const tail = rest.map((f) => (f.type === 'enum' || f.type === 'reference' ? sayValue(f, data[f.name], titles, now) : `${lowerFirst(f.label)} ${sayValue(f, data[f.name], titles, now)}`));
  return tail.length ? `${head}: ${tail.join(', ')}` : head;
}
```

Create `master-ai-backend/src/voice/follow-up-engine.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { EntityField, TranscriptLine } from '@onehuman/schemas';
import { LlmService } from '../llm/llm.service';
import { matchOption, orList, sayDay, spokenAmount, spokenDate, spokenDateTime, spokenYesNo } from './spoken';
import { istDate, speakable } from './time';
import { understandReply } from './understand';

/**
 * Follow-up calls about an open list item. To an outside party, the AI first
 * makes sure it is speaking to the right people, then asks about the item and
 * records the answer as it was given: it never threatens, bargains, promises
 * or changes anything. To a team member it asks for the status and a new date,
 * which the caller applies. A model, when there is one, only says what a reply
 * contains; this script decides every line and every result.
 */

export type FollowUpResult =
  | { kind: 'settled'; said: string; proposed: Record<string, unknown> }
  | { kind: 'promise'; said: string; promiseOn: string }
  | { kind: 'dispute'; said: string }
  | { kind: 'wrong_number'; said: string }
  | { kind: 'do_not_call'; said: string }
  | { kind: 'status'; said: string; patch: Record<string, unknown> }
  | { kind: 'said'; said: string };

export interface FollowUpState {
  phase: 'identity' | 'ask' | 'reference' | 'done';
  retries: number;
  result: FollowUpResult | null;
}

export function newFollowUpState(who: 'party' | 'staff'): FollowUpState {
  return { phase: who === 'party' ? 'identity' : 'ask', retries: 0, result: null };
}

export interface FollowUpContext {
  tenantId: string;
  companyName: string;
  who: 'party' | 'staff';
  /** The party's name, or the team member's. */
  name: string;
  /** What the item is, in words (`aboutText`). */
  about: string;
  /** Fields the call may propose (party) or change (staff). */
  findOut: EntityField[];
  state: FollowUpState;
  transcript: TranscriptLine[];
  now: Date;
}

export interface FollowUpTurn {
  say: string;
  end: boolean;
  callBack: boolean;
  state: FollowUpState;
}

/** What a model heard in one reply. Only the script acts on it, after checking each value. */
export interface FollowUpHeard {
  identity: 'yes' | 'no' | 'asking' | null;
  outcome: 'paid' | 'promise' | 'dispute' | 'do_not_call' | 'status' | 'call_back' | 'other' | null;
  promiseOn: string | null;
  reference: string | null;
  status: string | null;
  dueAt: string | null;
  amount: number | null;
}

const CALL_BACK = /\b(call (me )?(back|later)|busy (now|right now)|can'?t talk|driving|in a meeting|not a good time)\b/i;
const DNC = /\b(don'?t (ever )?call|do not call|stop calling|never call|remove (my|this) number)\b/i;
const WHO = /\b(who (is|'?s) (this|calling|it)|who are you|which company|what('?s| is) this about)\b/i;
const WRONG = /\b(wrong number|no one (here )?by that name|you have the wrong|doesn'?t (work|live) here|no such (company|person))\b/i;
const IDENTITY_YES = /\b(speaking|this is (he|she|me|us)|that'?s (me|us)|it'?s (me|us))\b/i;
const DISPUTE = /\b(never (came|arrived|received|got|reached|delivered)|did ?n'?t (get|receive|order)|not (ours|our order)|wrong (amount|bill|item|goods|rate)|damaged|short(age)?|dispute|disagree|incorrect|mistake|overcharged|returned)\b/i;
const NOT_PAID = /\b(not (yet )?(paid|sent|received|done|cleared)|haven'?t (paid|sent|cleared)|didn'?t pay|unpaid|no money)\b/i;
const PAID = /\b(paid|already (sent|done|cleared|transferred)|transferred|cleared|settled|received|delivered|approved|confirmed|sent (it|the|back))\b/i;
const NOT_DONE = /\b(not (yet )?(done|finished|fixed|completed|resolved)|still (working|on it|pending)|working on it|in progress)\b/i;
const DONE = /\b(done|fixed|finished|completed|resolved|sorted|closed|over|returned)\b/i;
const REF = /\b(?:utr|ref(?:erence)?|txn|transaction|cheque|receipt)\b\D{0,12}?([A-Z0-9][A-Z0-9-]{3,})/i;
const LONG_NUMBER = /\b([A-Z]{0,4}\d{6,})\b/i;
const SETTLED = ['paid', 'received', 'approved', 'confirmed', 'delivered', 'done', 'completed'];
const DONE_OPTIONS = ['resolved', 'fixed', 'done', 'completed', 'closed', 'returned', 'verified', 'issued'];
const PROGRESS_OPTIONS = ['in-progress', 'in progress', 'assigned', 'capa-open', 'inspection', 'open'];

const firstName = (name: string) => name.split(' ')[0];
const dayOk = (d: string | null, today: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && d >= today;

function partyQuestion(ctx: FollowUpContext): string {
  const paid = ctx.findOut.some((f) => f.type === 'enum' && f.options?.includes('paid'));
  if (paid) return 'Could you tell me when it will be paid?';
  if (ctx.findOut.length === 0) return 'Could you tell me when we can expect it?';
  return 'Could you tell me where this stands?';
}

function statusField(ctx: FollowUpContext): EntityField | undefined {
  return ctx.findOut.find((f) => f.type === 'enum' && /status/i.test(f.name)) ?? ctx.findOut.find((f) => f.type === 'enum');
}

function staffQuestion(ctx: FollowUpContext): string {
  if (statusField(ctx)) return "What's the status?";
  return ctx.findOut.some((f) => f.type === 'date' || f.type === 'datetime') ? 'When will it be done?' : "What's the latest?";
}

export function followUpOpening(ctx: FollowUpContext): string {
  if (ctx.who === 'party') return `Hello, this is an AI assistant calling from ${ctx.companyName}. Am I speaking with someone from ${ctx.name}?`;
  return `Hi ${firstName(ctx.name)}, this is the AI assistant at ${ctx.companyName}, about ${ctx.about}. ${staffQuestion(ctx)}`;
}

/** What a settled answer proposes: the status said (or the settled one the list has), true for yes/no fields, and an amount if one was said. */
function settledPatch(ctx: FollowUpContext, text: string, amount: number | null): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const f of ctx.findOut) {
    if (f.type === 'enum' && f.options) {
      const said = matchOption(f.options, text);
      const settled = SETTLED.find((o) => f.options!.includes(o));
      if (said && said !== 'unpaid') patch[f.name] = said;
      else if (settled && f === statusField(ctx)) patch[f.name] = settled;
    } else if (f.type === 'boolean') patch[f.name] = true;
    else if (f.type === 'money' && amount !== null) patch[f.name] = amount;
  }
  return patch;
}

function referenceIn(text: string): string | null {
  const m = REF.exec(text) ?? LONG_NUMBER.exec(text);
  return m ? m[1]!.toUpperCase() : null;
}

function staffStatus(options: string[], text: string): string | null {
  const pick = (want: string[]) => want.find((o) => options.includes(o)) ?? null;
  if (NOT_DONE.test(text)) return pick(PROGRESS_OPTIONS);
  const said = matchOption(options, text);
  if (said) return said;
  if (DONE.test(text)) return pick(DONE_OPTIONS);
  return null;
}

export function followUpTurn(ctx: FollowUpContext, text: string, heard: FollowUpHeard | null = null): FollowUpTurn {
  const s: FollowUpState = { ...ctx.state };
  const today = istDate(ctx.now);
  const said = text.trim();
  const say = (line: string): FollowUpTurn => ({ say: line, end: false, callBack: false, state: s });
  const end = (line: string, result: FollowUpResult | null, callBack = false): FollowUpTurn => {
    s.phase = 'done';
    s.result = result;
    return { say: line, end: true, callBack, state: s };
  };
  const goodbye = `Thank you, I'll pass that on. Goodbye.`;

  if (heard?.outcome === 'do_not_call' || DNC.test(text)) return end("Sorry for the trouble. We won't call this number again. Goodbye.", { kind: 'do_not_call', said });
  if (heard?.outcome === 'call_back' || CALL_BACK.test(text)) {
    return end(ctx.who === 'party' ? 'No problem, we will call another time. Goodbye.' : `No problem, ${firstName(ctx.name)}. I'll call you back a little later.`, null, true);
  }

  if (s.phase === 'identity') {
    const yes = heard?.identity === 'yes' || IDENTITY_YES.test(text) || spokenYesNo(text) === true;
    if (heard?.identity === 'asking' || (WHO.test(text) && !yes)) {
      if (s.retries >= 2) return end('Sorry to have troubled you. Goodbye.', null);
      s.retries++;
      return say(`I'm an AI assistant calling from ${ctx.companyName} about an account with ${ctx.name}. Am I speaking with someone from ${ctx.name}?`);
    }
    if (heard?.identity === 'no' || WRONG.test(text) || (!yes && spokenYesNo(text) === false)) return end('Sorry to have troubled you. Goodbye.', { kind: 'wrong_number', said });
    if (yes) {
      s.phase = 'ask';
      s.retries = 0;
      return say(`Thank you. It's about ${ctx.about}. ${partyQuestion(ctx)}`);
    }
    if (s.retries < 1) {
      s.retries++;
      return say(`Sorry, am I speaking with someone from ${ctx.name}?`);
    }
    return end("Sorry, I'll try another time. Goodbye.", null);
  }

  if (s.phase === 'reference') {
    const prev = s.result as Extract<FollowUpResult, { kind: 'settled' }>;
    const refField = ctx.findOut.find((f) => f.type === 'string');
    const ref = heard?.reference && /^[A-Za-z0-9 -]{3,40}$/.test(heard.reference) ? heard.reference.toUpperCase() : referenceIn(text);
    const proposed = ref && refField ? { ...prev.proposed, [refField.name]: ref } : prev.proposed;
    return end(`Thank you, I've noted it. Someone from ${ctx.companyName} will check it. Goodbye.`, { kind: 'settled', said: `${prev.said}. ${said}`, proposed });
  }

  if (ctx.who === 'staff') {
    const field = statusField(ctx);
    const dateField = ctx.findOut.find((f) => f.type === 'date' || f.type === 'datetime');
    const heardStatus = heard?.status && field?.options?.includes(heard.status) ? heard.status : null;
    const status = heardStatus ?? (field?.options ? staffStatus(field.options, text) : null);
    let due: string | null = null;
    if (dateField) {
      const heardDue = heard?.dueAt && !Number.isNaN(Date.parse(heard.dueAt)) ? heard.dueAt : null;
      const raw = heardDue ?? (dateField.type === 'date' ? spokenDate(text, ctx.now) : spokenDateTime(text, ctx.now));
      const day = raw ? (dateField.type === 'date' ? raw.slice(0, 10) : istDate(new Date(raw))) : null;
      if (raw && day && day >= today) due = dateField.type === 'date' ? raw.slice(0, 10) : new Date(raw).toISOString();
    }
    const patch: Record<string, unknown> = { ...(status && field && { [field.name]: status }), ...(due && dateField && { [dateField.name]: due }) };
    if (Object.keys(patch).length) {
      const when = due && dateField ? `, due ${dateField.type === 'date' ? sayDay(due, ctx.now) : speakable(new Date(due))}` : '';
      return end(`Thanks, ${firstName(ctx.name)}. I've updated it${status ? ` to ${status.replace(/-/g, ' ')}` : ''}${when}.`, { kind: 'status', said, patch });
    }
    if (s.retries < 1) {
      s.retries++;
      return say(field?.options ? `Sorry, what's the status: ${orList(field.options.slice(0, 5))}?` : 'Sorry, when will it be done?');
    }
    return end(`Thanks, ${firstName(ctx.name)}. I'll pass that on.`, { kind: 'said', said });
  }

  // An outside party, about the item.
  if (heard?.outcome === 'dispute' || DISPUTE.test(text)) {
    return end(`I've noted that; someone from ${ctx.companyName} will call you back. Goodbye.`, { kind: 'dispute', said });
  }
  if (heard?.outcome === 'paid' || (!NOT_PAID.test(text) && PAID.test(text))) {
    const amount = heard?.amount ?? spokenAmount(text.replace(REF, ' ').replace(LONG_NUMBER, ' '));
    const proposed = settledPatch(ctx, text, amount !== null && amount >= 1 ? amount : null);
    const refField = ctx.findOut.find((f) => f.type === 'string');
    const ref = heard?.reference && /^[A-Za-z0-9 -]{3,40}$/.test(heard.reference) ? heard.reference.toUpperCase() : referenceIn(text);
    if (refField && ref) proposed[refField.name] = ref;
    if (refField && !ref) {
      s.phase = 'reference';
      s.result = { kind: 'settled', said, proposed };
      return say('Thank you. Do you have a payment reference, like a UTR number?');
    }
    return end(`Thank you, I've noted that. Someone from ${ctx.companyName} will check it. Goodbye.`, { kind: 'settled', said, proposed });
  }
  const promised = dayOk(heard?.promiseOn ?? null, today) ? heard!.promiseOn! : spokenDate(text, ctx.now);
  if (promised && promised >= today) return end(`Thank you, I've noted that for ${sayDay(promised, ctx.now)}. Goodbye.`, { kind: 'promise', said, promiseOn: promised });
  if (s.retries < 1) {
    s.retries++;
    return say('Sorry, roughly when can we expect it?');
  }
  return end(goodbye, { kind: 'said', said });
}

/** A cooperative person for the simulator's auto mode. */
export function simulatedFollowUpReply(ctx: FollowUpContext): string {
  if (ctx.who === 'staff') return 'It is in progress, I will finish it by tomorrow 5 pm.';
  if (ctx.state.phase === 'identity') return 'Yes, speaking.';
  if (ctx.state.phase === 'reference') return 'No reference yet.';
  return partyQuestion(ctx).includes('paid') ? 'We will pay it by Friday.' : 'I will confirm it by Friday.';
}

/** Likely replies for the simulator, for where the call is. */
export function followUpSuggestions(ctx: FollowUpContext): string[] {
  const s = ctx.state;
  if (s.phase === 'done') return [];
  if (ctx.who === 'staff') return ["It's in progress, done by tomorrow 5 pm", "It's done", 'Can you call me later?'];
  if (s.phase === 'identity') return ['Yes, speaking', 'Wrong number', 'Who is this?'];
  if (s.phase === 'reference') return ['UTR 445566', 'No reference'];
  return partyQuestion(ctx).includes('paid')
    ? ['We will pay on Friday', "It's already paid", 'The goods never came', "Don't call me again"]
    : ['I will confirm it by Friday', "It's done", 'There is a problem with it', "Don't call me again"];
}

const HeardSchema = z.strictObject({
  identity: z.enum(['yes', 'no', 'asking']).nullable(),
  outcome: z.enum(['paid', 'promise', 'dispute', 'do_not_call', 'status', 'call_back', 'other']).nullable(),
  promise_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  reference: z.string().max(60).nullable(),
  status: z.string().nullable(),
  due_at: z.string().nullable(),
  amount: z.number().nullable(),
});

@Injectable()
export class FollowUpEngine {
  constructor(private readonly llm: LlmService) {}

  opening(ctx: FollowUpContext): string {
    return followUpOpening(ctx);
  }

  async turn(ctx: FollowUpContext, text: string): Promise<FollowUpTurn> {
    return followUpTurn(ctx, text, await this.understand(ctx, text));
  }

  private async understand(ctx: FollowUpContext, text: string): Promise<FollowUpHeard | null> {
    const asked = ctx.transcript.filter((l) => l.speaker === 'ai').at(-1)?.text ?? '';
    const options = ctx.findOut.filter((f) => f.type === 'enum').map((f) => `${f.name}: ${f.options?.join(' / ')}`).join('; ');
    const heard = await understandReply(this.llm, {
      tenantId: ctx.tenantId,
      schema: HeardSchema,
      system: `You read one reply on a phone call. An AI assistant from ${ctx.companyName} is calling ${ctx.who === 'party' ? `someone at ${ctx.name}, an outside party,` : `${ctx.name}, a team member,`} about ${ctx.about}.
Report only what the reply says; never guess. Today is ${istDate(ctx.now)} (India).
identity: yes if they confirm they are ${ctx.name}, no if not, asking if they ask who is calling; else null.
outcome: paid (they say it is paid, received, approved or done), promise (they give a date), dispute (they disagree or say something went wrong), do_not_call, status (a team member gives a status), call_back, or other; null if the reply is only about identity.
promise_on: the promised day as YYYY-MM-DD. reference: a payment or transaction reference if said. status: one of ${options || 'none'} if said. due_at: a new deadline as an ISO date-time. amount: an amount in rupees if said.`,
      user: `The AI just said: "${asked}"\nThe reply: "${text}"`,
    });
    return heard && { identity: heard.identity, outcome: heard.outcome, promiseOn: heard.promise_on, reference: heard.reference, status: heard.status, dueAt: heard.due_at, amount: heard.amount };
  }
}
```

In `master-ai-backend/src/db/schema.ts`, add `import type { FollowUpState } from '../voice/follow-up-engine';` and `followUp?: FollowUpState;` to the `calls.extracted` type. Provide `FollowUpEngine` in `master-ai-backend/src/app.module.ts`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @onehuman/backend typecheck`
Expected: PASS.

```bash
git add master-ai-backend
git commit -m "feat(voice): a follow-up call that confirms who it is speaking to and records what they say

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Calling hours, the due rule in SQL, and who a follow-up calls

**Files:**
- Modify: `master-ai-backend/src/voice/time.ts` (add `narrowHours`, `withinHours`)
- Modify: `master-ai-backend/src/lists/sql.ts` (add `dueSql`)
- Create: `master-ai-backend/src/follow-ups/targets.ts`
- Test: `master-ai-backend/__tests__/unit/voice/hours.test.ts`, `master-ai-backend/__tests__/unit/lists/due-sql.test.ts`, `master-ai-backend/__tests__/unit/follow-ups/targets.test.ts` (new)

**Interfaces:**
- Consumes: Task 2 `ResolvedFollowUp`, `ResolvedPath`; `conditionSql`, `problemCore` (private) in `sql.ts`.
- Produces:
  - `narrowHours(hours: WorkingHours, window: { start: string; end: string } | null): WorkingHours`
  - `withinHours(at: Date, hours: WorkingHours): boolean` — on one of the days, inside the hours and inside 9:00–21:00 India time.
  - `dueSql(f: ResolvedFollowUp, entity: EntityDef, clock: SqlClock): SQL` — reads the row as `r`.
  - `targets.ts`: `phoneKey(phone): string` (last 10 digits), `matchStaff(people: StaffRow[], name: string): StaffRow | null`, `readPath(tx, workspaceId, path: ResolvedPath, data): Promise<string | null>`, `contactName(tx, workspaceId, f: ResolvedFollowUp, data): Promise<string | null>`.

- [ ] **Step 1: Write the failing unit tests**

Create `master-ai-backend/__tests__/unit/voice/hours.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { narrowHours, withinHours } from '../../../src/voice/time';

const ist = (iso: string) => new Date(`${iso}+05:30`);
const partyHours = { days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '18:00' };

describe('calling hours for outside parties', () => {
  it("narrows the company's hours by a follow-up's own window", () => {
    expect(narrowHours(partyHours, { start: '08:00', end: '19:00' })).toEqual(partyHours);
    expect(narrowHours(partyHours, { start: '12:00', end: '20:00' })).toEqual({ days: partyHours.days, start: '12:00', end: '18:00' });
    expect(narrowHours(partyHours, null)).toEqual(partyHours);
  });

  it('calls only on the days and inside the hours, and never outside 9:00–21:00', () => {
    expect(withinHours(ist('2026-10-15T11:30:00'), partyHours)).toBe(true); // Thursday
    expect(withinHours(ist('2026-10-15T09:45:00'), partyHours)).toBe(false);
    expect(withinHours(ist('2026-10-15T18:00:00'), partyHours)).toBe(false);
    expect(withinHours(ist('2026-10-18T11:30:00'), partyHours)).toBe(false); // Sunday
    const wide = { days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '23:00' };
    expect(withinHours(ist('2026-10-15T08:30:00'), wide)).toBe(false);
    expect(withinHours(ist('2026-10-15T21:15:00'), wide)).toBe(false);
  });

  it("keeps a lender's recovery calls inside 8:00–19:00 even when the company calls later", () => {
    const lender = narrowHours({ days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '20:00' }, { start: '08:00', end: '19:00' });
    expect(withinHours(ist('2026-10-15T18:30:00'), lender)).toBe(true);
    expect(withinHours(ist('2026-10-15T19:30:00'), lender)).toBe(false);
    expect(withinHours(ist('2026-10-15T08:30:00'), lender)).toBe(false);
  });
});
```

Create `master-ai-backend/__tests__/unit/lists/due-sql.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { EntityDef } from '@onehuman/schemas';
import { registersOf } from '@onehuman/agent-kit';
import { dueSql } from '../../../src/lists/sql';

const Bill: EntityDef = {
  name: 'Bill',
  label: 'Bill',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'dueDate', label: 'Due date', type: 'date', required: false },
    { name: 'validTill', label: 'Valid till', type: 'datetime', required: false },
    { name: 'paymentStatus', label: 'Payment', type: 'enum', options: ['unpaid', 'paid'], required: false },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
  ],
};
const followUp = (due: object, when?: object) =>
  registersOf({
    entities: [Bill],
    registers: [{ id: 'bills', entity: 'Bill', main: true, checks: [], follow_ups: [{ id: 'f', label: 'F', who: 'party', due, when, phone: { field: 'phone' }, contact: { field: 'billNo' }, about: ['billNo'], find_out: [], max_tries: 3 } as never] }],
  })[0]!.followUps[0]!;
const clock = { today: '2026-10-15', now: new Date('2026-10-15T06:00:00Z') };
const compile = (f: ReturnType<typeof followUp>) => new PgDialect().sqlToQuery(dueSql(f, Bill, clock));

describe('which items a follow-up is due to call about', () => {
  it("uses the overdue rule and the follow-up's conditions, as the list's checks do", () => {
    const q = compile(followUp({ overdue: { date: 'dueDate', grace_days: 2 } }, { paymentStatus: ['unpaid'] }));
    expect(q.sql).toBe('(((r.data->>$1) = $2)) and coalesce((try_date(r.data->>$3) + $4::int < $5::date), false)');
    expect(q.params).toEqual(['paymentStatus', 'unpaid', 'dueDate', 2, '2026-10-15']);
  });

  it('uses the expiring rule on a date-time, in India time', () => {
    const q = compile(followUp({ expiring: { date: 'validTill', days: 7 } }));
    expect(q.sql).toBe('(true) and coalesce((try_timestamptz(r.data->>$1) <= $2::timestamptz + make_interval(days => $3::int)), false)');
    expect(q.params).toEqual(['validTill', '2026-10-15T06:00:00.000Z', 7]);
  });
});
```

Create `master-ai-backend/__tests__/unit/follow-ups/targets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { staff } from '../../../src/db/schema';
import { matchStaff, phoneKey } from '../../../src/follow-ups/targets';

const person = (name: string, status: 'active' | 'inactive' = 'active') => ({ id: name, name, status }) as typeof staff.$inferSelect;

describe('who a follow-up calls', () => {
  it('keys a phone number by its last ten digits', () => {
    expect(phoneKey('+91 98470 11111')).toBe('9847011111');
    expect(phoneKey('098470-11111')).toBe('9847011111');
  });

  it('finds a team member by full name, or by a first name only one active person has', () => {
    const team = [person('Anil Kumar'), person('Anil Menon', 'inactive'), person('Ravi Kumar'), person('Ravi Shankar')];
    expect(matchStaff(team, 'anil kumar ')?.id).toBe('Anil Kumar');
    expect(matchStaff(team, 'Anil')?.id).toBe('Anil Kumar');
    expect(matchStaff(team, 'Ravi')).toBeNull();
    expect(matchStaff(team, 'Nobody')).toBeNull();
    expect(matchStaff(team, '')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice/hours.test.ts __tests__/unit/lists/due-sql.test.ts __tests__/unit/follow-ups/targets.test.ts`
Expected: FAIL — `narrowHours`, `dueSql` and `targets.ts` do not exist.

- [ ] **Step 3: Implement**

Append to `master-ai-backend/src/voice/time.ts`:

```ts
/** Calling hours narrowed by a follow-up's own window (RBI's 08:00–19:00 for recovery calls): the later start, the earlier end. */
export function narrowHours(hours: WorkingHours, window: { start: string; end: string } | null): WorkingHours {
  if (!window) return hours;
  return { days: hours.days, start: window.start > hours.start ? window.start : hours.start, end: window.end < hours.end ? window.end : hours.end };
}

/** True when `at` falls on one of the days, inside the hours and inside 9:00–21:00 India time. */
export function withinHours(at: Date, hours: WorkingHours): boolean {
  const p = ist(at);
  if (!hours.days.includes(p.dow)) return false;
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    return h * 60 + m;
  };
  const now = p.hh * 60 + p.mm;
  return now >= Math.max(minutes(hours.start), LEGAL_START) && now < Math.min(minutes(hours.end), LEGAL_END);
}
```

In `master-ai-backend/src/lists/sql.ts`, import `type ResolvedFollowUp` from `@onehuman/agent-kit` and add after `cardSelect`:

```ts
/** Items a follow-up is due to call about: its conditions and its overdue or expiring rule, the same SQL the list's checks use. */
export function dueSql(f: ResolvedFollowUp, entity: EntityDef, clock: SqlClock): SQL {
  return sql`(${conditionSql(entity, f.when)}) and coalesce((${problemCore(f.due, entity, clock)}), false)`;
}
```

Create `master-ai-backend/src/follow-ups/targets.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import type { ResolvedFollowUp, ResolvedPath } from '@onehuman/agent-kit';
import type { Tx } from '../db/db.service';
import { records, staff } from '../db/schema';
import { isUuid } from '../lists/format';

type StaffRow = typeof staff.$inferSelect;

/** A phone number's last ten digits: how the do-not-call list knows a number however it was typed. */
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

/** The team member a name on an item means: the full name, else a first name only one active person has. */
export function matchStaff(people: StaffRow[], name: string): StaffRow | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const active = people.filter((p) => p.status === 'active');
  const full = active.filter((p) => p.name.trim().toLowerCase() === want);
  if (full.length === 1) return full[0]!;
  const firstOf = (s: string) => s.trim().toLowerCase().split(/\s+/)[0];
  const byFirst = active.filter((p) => firstOf(p.name) === firstOf(want));
  return byFirst.length === 1 ? byFirst[0]! : null;
}

const text = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));

/** The value at a path for an item: its own field, the field of the item a reference points at, or of the one record a lookup finds. */
export async function readPath(tx: Tx, workspaceId: string, path: ResolvedPath, data: Record<string, unknown>): Promise<string | null> {
  if (path.kind === 'field') return text(data[path.field.name]);
  if (path.kind === 'ref') {
    const id = data[path.ref.name];
    if (!isUuid(id)) return null;
    const [row] = await tx
      .select({ data: records.data })
      .from(records)
      .where(and(eq(records.id, id), eq(records.workspaceId, workspaceId), eq(records.entity, path.target.name)));
    return row ? text(row.data[path.field.name]) : null;
  }
  const value = text(data[path.value.name]);
  if (!value) return null;
  const rows = await tx
    .select({ data: records.data })
    .from(records)
    .where(and(eq(records.workspaceId, workspaceId), eq(records.entity, path.target.name), sql`lower(trim(${records.data}->>${path.match.name})) = lower(trim(${value}))`))
    .limit(2);
  return rows.length === 1 ? text(rows[0]!.data[path.field.name]) : null;
}

/** Who a party call asks for: the contact path's value, else the words a reference was given as. */
export async function contactName(tx: Tx, workspaceId: string, f: ResolvedFollowUp, data: Record<string, unknown>): Promise<string | null> {
  const name = f.contact ? await readPath(tx, workspaceId, f.contact, data) : null;
  if (name) return name;
  if (f.contact?.kind === 'ref') {
    const words = data[f.contact.ref.name];
    return typeof words === 'string' && words.trim() && !isUuid(words) ? words.trim() : null;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/voice/hours.test.ts __tests__/unit/lists __tests__/unit/follow-ups`
Expected: PASS. If the compiled SQL differs only in parentheses, check `conditionSql` and `problemCore` were reused unchanged and update the expected string to what they produce — the point of the test is that the follow-up and the list's check share one SQL.

- [ ] **Step 5: Commit**

```bash
git add master-ai-backend
git commit -m "feat(follow-ups): calling hours for outside parties, the due rule in SQL, and who a follow-up calls

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Follow-up switches, the sweep schedule, and picking the next item to call about

**Files:**
- Create: `master-ai-backend/src/follow-ups/follow-ups.service.ts`, `master-ai-backend/src/follow-ups/follow-ups.controller.ts`
- Modify: `master-ai-backend/src/orchestration/shared.ts` (`FollowUpSweepInput`, `FollowUpCallInput`), `master-ai-backend/src/orchestration/temporal.service.ts` (`syncFollowUpSchedule`, `startFollowUpSweep`), `master-ai-backend/src/app.module.ts`
- Modify: `packages/schemas/src/lists.ts` (`FollowUpInfo`, `SwitchFollowUpInputSchema`), `packages/sdk/src/client.ts` (`put`, `lists.followUps`, `followUps.switch`, `followUps.run`)
- Test: `master-ai-backend/__tests__/integration/follow-ups.spec.ts` (new)

**Interfaces:**
- Consumes: Task 4 tables; Task 5 `NotesService.create`; Task 9 `dueSql`, `withinHours`, `narrowHours`, `readPath`, `contactName`, `matchStaff`, `phoneKey`; `TenancyService.updateSettings`, `TenancyService.setTenantPaused`.
- Produces:
  - `interface FollowUpInfo { key; id; label; who: 'party' | 'staff'; enabled: boolean; changedBy: string | null; changedAt: string | null; canSwitch: boolean; due: number; waiting: number; stopped: number }`; `SwitchFollowUpInputSchema = z.object({ enabled: z.boolean() })`
  - `interface FollowUpSweepInput { tenantId: string; trigger: 'schedule' | 'manual' }`, `interface FollowUpCallInput { tenantId: string; callId: string }`
  - `TemporalService.syncFollowUpSchedule({ tenantId, active })`, `TemporalService.startFollowUpSweep(input: FollowUpSweepInput)`
  - `FollowUpsService.forList(session, listId): Promise<FollowUpInfo[]>`, `switch(session, key, enabled): Promise<FollowUpInfo>`, `runNow(session): Promise<{ ok: true }>`, `pick(tenantId): Promise<{ callId: string } | null>`
  - Routes (owner and admins): `GET /lists/:id/follow-ups`, `PUT /follow-ups/:key`, `POST /follow-ups/run`; SDK `api.lists.followUps(id)`, `api.followUps.switch(key, enabled)`, `api.followUps.run()`.
  - A picked item has a `follow_up_attempts` row (state `active`, `next_due_on` today) and a `calls` row (`stage: 'chase'`, `status: 'scheduled'`, `record_id`, `follow_up`, staff or contact name and phone, `extracted.about`).

- [ ] **Step 1: Write the failing spec**

Create `master-ai-backend/__tests__/integration/follow-ups.spec.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../../src/common/auth';
import { SYSTEM } from '../../src/audit/audit.service';
import { DbService } from '../../src/db/db.service';
import { auditEvents, calls, doNotCall, followUpAttempts, recordNotes } from '../../src/db/schema';
import { FollowUpsService } from '../../src/follow-ups/follow-ups.service';
import { phoneKey } from '../../src/follow-ups/targets';
import { ListsService } from '../../src/lists/lists.service';
import { NotesService } from '../../src/notes/notes.service';
import { RecordsService } from '../../src/records/records.service';
import { TenancyService } from '../../src/tenancy/tenancy.service';
import { istDate } from '../../src/voice/time';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;
let admin: Session;
let followUps: FollowUpsService;
let kaveri: string;
let blocked: string;
let noPhone: string;
const day = (offset: number) => istDate(new Date(Date.now() + offset * 86_400_000));
const UNPAID = 'bills.unpaid-bills';

beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
  admin = { ...a.session, role: 'admin' };
  followUps = h.get(FollowUpsService);
  await h.get(ListsService).removeSamples(a.session);
  kaveri = await add('Party', { name: 'Kaveri Spec Traders', partyType: 'retailer', phone: '+91 98470 22222' });
  blocked = await add('Party', { name: 'Blocked Traders', partyType: 'retailer', phone: '+91 98470 33333' });
  noPhone = await add('Party', { name: 'No Phone Traders', partyType: 'retailer' });
});
afterAll(() => h.close());

const db = () => h.get(DbService);
async function add(entity: string, data: Record<string, unknown>): Promise<string> {
  return db().tenant(a.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    return (await svc.create(tx, a.tenantId, await svc.activeWorkspace(tx), entity, data, SYSTEM, { kind: 'agent' })).id;
  });
}
const bill = (billNo: string, extra: Record<string, unknown> = {}) =>
  add('Bill', { billNo, billType: 'sales invoice', party: kaveri, billDate: day(-10), dueDate: day(-3), total: 1000, paymentStatus: 'unpaid', ...extra });

/** Stands in for the call workflow's end: the call is over and the item is due again tomorrow. */
async function done(callId: string) {
  await db().tenant(a.tenantId, async (tx) => {
    const [c] = await tx.update(calls).set({ status: 'completed' }).where(eq(calls.id, callId)).returning();
    await tx.update(followUpAttempts).set({ nextDueOn: day(1) }).where(and(eq(followUpAttempts.recordId, c!.recordId!), eq(followUpAttempts.followUp, c!.followUp!)));
  });
}
/** Every item the sweep would call about now, in order. */
async function pickAll(): Promise<string[]> {
  const ids: string[] = [];
  for (let next = await followUps.pick(a.tenantId); next; next = await followUps.pick(a.tenantId)) {
    const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, next!.callId)));
    ids.push(c!.recordId!);
    await done(next.callId);
  }
  return ids;
}

describe('switching follow-ups', () => {
  it('lets only the owner switch on calls to outside parties, and says who did', async () => {
    await expect(followUps.switch(admin, UNPAID, true)).rejects.toThrow(/Only the owner/);
    const on = await followUps.switch(a.session, UNPAID, true);
    expect(on).toMatchObject({ key: UNPAID, who: 'party', enabled: true, changedBy: 'Asha Owner', canSwitch: true });
    const forAdmin = (await followUps.forList(admin, 'bills')).find((f) => f.key === UNPAID)!;
    expect(forAdmin).toMatchObject({ enabled: true, canSwitch: false });
    const events = await db().tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.type, 'followup.switched')));
    expect(events.at(-1)?.payload).toMatchObject({ key: UNPAID, enabled: true });
  });

  it('keeps the sweep schedule in step: on while any follow-up is on', async () => {
    const syncs = () => h.temporal.filter((t) => t.method === 'syncFollowUpSchedule').map((t) => t.args[0]);
    expect(syncs().at(-1)).toEqual({ tenantId: a.tenantId, active: true });
    await followUps.switch(a.session, UNPAID, false);
    expect(syncs().at(-1)).toEqual({ tenantId: a.tenantId, active: false });
    await followUps.switch(a.session, UNPAID, true);
  });

  it('starts a sweep on "Call now"', async () => {
    await followUps.runNow(a.session);
    expect(h.temporal.at(-1)).toEqual({ method: 'startFollowUpSweep', args: [{ tenantId: a.tenantId, trigger: 'manual' }] });
  });
});

describe('picking what to call about', () => {
  it('picks due items one at a time, and skips do-not-call, not yet due, waiting and new-note items', async () => {
    const due1 = await bill('P-1');
    await bill('P-2', { dueDate: day(5) });
    await bill('P-3', { paymentStatus: 'paid' });
    const later = await bill('P-4');
    const waiting = await bill('P-5');
    const noted = await bill('P-6');
    await bill('P-7', { party: blocked });
    const due2 = await bill('P-8');
    await db().tenant(a.tenantId, async (tx) => {
      await tx.insert(followUpAttempts).values([
        { tenantId: a.tenantId, recordId: later, followUp: UNPAID, nextDueOn: day(1) },
        { tenantId: a.tenantId, recordId: waiting, followUp: UNPAID, nextDueOn: day(0), state: 'waiting_for_you' },
      ]);
      await h.get(NotesService).create(tx, a.tenantId, { recordId: noted, callId: null, followUp: UNPAID, kind: 'promise', speaker: 'Kaveri Spec Traders', said: 'Friday', promiseOn: day(2) });
      await tx.insert(doNotCall).values({ tenantId: a.tenantId, phone: phoneKey('+91 98470 33333'), reason: 'asked' });
    });

    const first = (await followUps.pick(a.tenantId))!;
    expect(await followUps.pick(a.tenantId)).toBeNull(); // one call at a time
    const [call] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, first.callId)));
    expect(call).toMatchObject({
      stage: 'chase',
      status: 'scheduled',
      attempt: 1,
      staffId: null,
      contactName: 'Kaveri Spec Traders',
      contactPhone: '+91 98470 22222',
      recordId: due1,
      followUp: UNPAID,
      extracted: { about: { listId: 'bills', itemId: due1, title: 'P-1' } },
    });
    await done(first.callId);
    expect(await pickAll()).toEqual([due2]);
  });

  it('stops an item with no phone number, with a note for the head', async () => {
    const id = await bill('NP-1', { party: noPhone });
    expect(await pickAll()).toEqual([]);
    const [attempt] = await db().tenant(a.tenantId, (tx) => tx.select().from(followUpAttempts).where(eq(followUpAttempts.recordId, id)));
    expect(attempt?.state).toBe('stopped');
    const [note] = await db().tenant(a.tenantId, (tx) => tx.select().from(recordNotes).where(eq(recordNotes.recordId, id)));
    expect(note).toMatchObject({ kind: 'unreachable', status: 'new', said: 'There is no phone number to call No Phone Traders about NP-1. Please add one or follow it up yourself.' });
  });

  it('calls nobody outside calling hours, past the daily cap, or while the company is paused', async () => {
    const tenancy = h.get(TenancyService);
    await bill('H-1');
    await tenancy.updateSettings(a.session, { calls: { fastSchedule: false, partyHours: { days: [1, 2, 3, 4, 5, 6], start: '00:00', end: '00:01' } } });
    expect(await followUps.pick(a.tenantId)).toBeNull();
    await tenancy.updateSettings(a.session, { calls: { fastSchedule: true } });

    const made = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.stage, 'chase')));
    await tenancy.updateSettings(a.session, { calls: { followUpsPerDay: made.length } });
    expect(await followUps.pick(a.tenantId)).toBeNull();
    await tenancy.updateSettings(a.session, { calls: { followUpsPerDay: 30 } });

    await tenancy.setTenantPaused(a.session, true);
    expect(await followUps.pick(a.tenantId)).toBeNull();
    await tenancy.setTenantPaused(a.session, false);
    const resumed = await followUps.pick(a.tenantId);
    expect(resumed).not.toBeNull();
    await done(resumed!.callId);
  });

  it('does not let a call stuck for over half an hour block the others', async () => {
    await db().tenant(a.tenantId, (tx) =>
      tx.insert(calls).values({
        tenantId: a.tenantId,
        stage: 'chase',
        attempt: 1,
        status: 'ringing',
        provider: 'simulator',
        contactName: 'Stuck',
        contactPhone: '+91 98470 99999',
        followUp: UNPAID,
        createdAt: new Date(Date.now() - 31 * 60_000),
      }),
    );
    await bill('S-1');
    const next = await followUps.pick(a.tenantId);
    expect(next).not.toBeNull();
    await done(next!.callId);
  });

  it('counts what each follow-up would call about, waits on you for, and has stopped', async () => {
    const info = (await followUps.forList(a.session, 'bills')).find((f) => f.key === UNPAID)!;
    expect(info.waiting).toBeGreaterThanOrEqual(1);
    expect(info.stopped).toBeGreaterThanOrEqual(1);
    expect(info.due).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts follow-ups`
Expected: FAIL — `../../src/follow-ups/follow-ups.service` does not exist.

- [ ] **Step 3: Types, SDK and Temporal**

In `packages/schemas/src/lists.ts`, add:

```ts
/** One of a list's follow-up calls, with its switch and what it is doing. */
export interface FollowUpInfo {
  /** `<list>.<follow-up>`. */
  key: string;
  id: string;
  label: string;
  who: 'party' | 'staff';
  enabled: boolean;
  changedBy: string | null;
  changedAt: string | null;
  /** Only the owner switches calls to outside parties. */
  canSwitch: boolean;
  /** Items it would call about now. */
  due: number;
  /** Items waiting for you to act on what was said. */
  waiting: number;
  /** Items it has stopped calling about. */
  stopped: number;
}

export const SwitchFollowUpInputSchema = z.object({ enabled: z.boolean() });
```

In `packages/sdk/src/client.ts`, add `const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);` beside `patch`, add to `lists`:

```ts
      /** The list's follow-up calls and their switches. */
      followUps: (id: string) => get<FollowUpInfo[]>(`/lists/${encodeURIComponent(id)}/follow-ups`),
```

and after `notes`:

```ts
    followUps: {
      /** Owner only for calls to customers and suppliers. */
      switch: (key: string, enabled: boolean) => put<FollowUpInfo>(`/follow-ups/${encodeURIComponent(key)}`, { enabled }),
      /** Look for items to call about now, instead of waiting for the next half hour. */
      run: () => post<{ ok: true }>('/follow-ups/run'),
    },
```

In `master-ai-backend/src/orchestration/shared.ts`, add:

```ts
export interface FollowUpSweepInput {
  tenantId: string;
  /** schedule: the half-hourly sweep. manual: "Call now". */
  trigger: 'schedule' | 'manual';
}

export interface FollowUpCallInput {
  tenantId: string;
  callId: string;
}
```

In `master-ai-backend/src/orchestration/temporal.service.ts` (import `FollowUpSweepInput`), add after `syncRoutineSchedule`:

```ts
  /** Keep the company's follow-up sweep in step: every 30 minutes while any follow-up is on, none otherwise. */
  async syncFollowUpSchedule(r: { tenantId: string; active: boolean }) {
    const client = await this.client();
    const scheduleId = `follow-ups-${r.tenantId}`;
    try {
      await client.schedule.getHandle(scheduleId).delete();
    } catch (err) {
      if (!(err instanceof ScheduleNotFoundError)) throw err;
    }
    if (!r.active) return;
    await client.schedule.create({
      scheduleId,
      spec: { intervals: [{ every: '30m' }] },
      action: {
        type: 'startWorkflow',
        workflowType: 'followUpSweepWorkflow',
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: scheduleId,
        args: [{ tenantId: r.tenantId, trigger: 'schedule' } satisfies FollowUpSweepInput],
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
    });
  }

  /** "Call now": a sweep at once. Only one follow-up call rings at a time whatever runs. */
  async startFollowUpSweep(input: FollowUpSweepInput): Promise<string> {
    const client = await this.client();
    const workflowId = `follow-ups-${input.tenantId}-${Date.now()}`;
    await client.workflow.start('followUpSweepWorkflow', { taskQueue: config.TEMPORAL_TASK_QUEUE, workflowId, args: [input] });
    return workflowId;
  }
```

- [ ] **Step 4: `FollowUpsService` and its routes**

Create `master-ai-backend/src/follow-ups/follow-ups.service.ts`:

```ts
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, eq, gt, inArray, sql } from 'drizzle-orm';
import type { FollowUpInfo, ResolvedPack } from '@onehuman/schemas';
import { normalizeSnapshot, registersOf, titleOf, type ResolvedFollowUp, type ResolvedRegister } from '@onehuman/agent-kit';
import { AuditService } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { DEFAULT_TENANT_SETTINGS } from '../common/mappers';
import { DbService, type Tx } from '../db/db.service';
import { calls, doNotCall, followUpAttempts, followUpSwitches, principals, staff, tenants } from '../db/schema';
import { dueSql } from '../lists/sql';
import { NotesService } from '../notes/notes.service';
import { TemporalService } from '../orchestration/temporal.service';
import { RecordsService } from '../records/records.service';
import { lowerFirst } from '../voice/spoken';
import { istDate, narrowHours, withinHours } from '../voice/time';
import { contactName, matchStaff, phoneKey, readPath } from './targets';

type StaffRow = typeof staff.$inferSelect;
type Workspace = { id: string; pack: ResolvedPack };
type Candidate = { id: string; data: Record<string, unknown>; tries: number | null };
type Target = { kind: 'party'; name: string; phone: string } | { kind: 'staff'; person: StaffRow } | { kind: 'stop'; why: string };

/** A follow-up call older than this no longer counts as the one live call (a crashed workflow must not block every follow-up). */
const LIVE_MS = 30 * 60_000;
const SYSTEM_SPEAKER = 'ONEHUMAN OS';

/**
 * Follow-up calls on open list items: their switches (all off until switched
 * on; owner only for calls to outside parties), the company's half-hourly
 * sweep, and picking the next item to call about — one call at a time, inside
 * calling hours, up to the day's cap, never to a do-not-call number.
 */
@Injectable()
export class FollowUpsService {
  private readonly logger = new Logger(FollowUpsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
    private readonly notes: NotesService,
    private readonly temporal: TemporalService,
  ) {}

  async forList(session: Session, listId: string): Promise<FollowUpInfo[]> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = registersOf(ws.pack).find((r) => r.id === listId);
      if (!reg) throw new NotFoundException('List not found');
      const switches = await tx.select().from(followUpSwitches).where(eq(followUpSwitches.workspaceId, ws.id));
      const changers = switches.map((x) => x.changedBy).filter((x): x is string => !!x);
      const names = new Map(
        changers.length
          ? (await tx.select({ id: principals.id, name: principals.displayName }).from(principals).where(inArray(principals.id, changers))).map((p) => [p.id, p.name] as const)
          : [],
      );
      const now = new Date();
      const clock = { now, today: istDate(now) };
      const out: FollowUpInfo[] = [];
      for (const f of reg.followUps) {
        const sw = switches.find((x) => x.followUp === f.key);
        const [n] = (
          await tx.execute<{ due: number; waiting: number; stopped: number }>(sql`
            select count(*) filter (where ${dueSql(f, reg.entity, clock)} and (a.id is null or (a.state = 'active' and a.next_due_on <= ${clock.today}::date)))::int as due,
                   count(*) filter (where a.state = 'waiting_for_you')::int as waiting,
                   count(*) filter (where a.state = 'stopped')::int as stopped
            from records r left join follow_up_attempts a on a.record_id = r.id and a.follow_up = ${f.key}
            where r.workspace_id = ${ws.id} and r.entity = ${reg.entity.name}`)
        ).rows;
        out.push({
          key: f.key,
          id: f.id,
          label: f.label,
          who: f.who,
          enabled: sw?.enabled ?? false,
          changedBy: sw?.changedBy ? (names.get(sw.changedBy) ?? 'Someone') : null,
          changedAt: sw ? sw.changedAt.toISOString() : null,
          canSwitch: f.who === 'staff' || session.role === 'owner',
          due: Number(n?.due ?? 0),
          waiting: Number(n?.waiting ?? 0),
          stopped: Number(n?.stopped ?? 0),
        });
      }
      return out;
    });
  }

  async switch(session: Session, key: string, enabled: boolean): Promise<FollowUpInfo> {
    const { listId, anyOn } = await this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const f = registersOf(ws.pack)
        .flatMap((r) => r.followUps)
        .find((x) => x.key === key);
      if (!f) throw new NotFoundException('Follow-up not found');
      if (f.who === 'party' && session.role !== 'owner') throw new ForbiddenException('Only the owner can switch on calls to customers and suppliers');
      const at = new Date();
      await tx
        .insert(followUpSwitches)
        .values({ tenantId: session.tenantId, workspaceId: ws.id, followUp: key, enabled, changedBy: session.principalId, changedAt: at })
        .onConflictDoUpdate({
          target: [followUpSwitches.tenantId, followUpSwitches.workspaceId, followUpSwitches.followUp],
          set: { enabled, changedBy: session.principalId, changedAt: at },
        });
      await this.audit.append(tx, session.tenantId, {
        type: 'followup.switched',
        actor: { id: session.principalId, kind: 'human' },
        refId: ws.id,
        payload: { key, label: f.label, who: f.who, enabled },
      });
      const [on] = await tx.select({ n: count() }).from(followUpSwitches).where(and(eq(followUpSwitches.workspaceId, ws.id), eq(followUpSwitches.enabled, true)));
      return { listId: f.registerId, anyOn: Number(on?.n ?? 0) > 0 };
    });
    try {
      await this.temporal.syncFollowUpSchedule({ tenantId: session.tenantId, active: anyOn });
    } catch (err) {
      this.logger.error(`Could not schedule follow-ups for ${session.tenantId}: ${(err as Error).message}`);
    }
    return (await this.forList(session, listId)).find((x) => x.key === key)!;
  }

  async runNow(session: Session): Promise<{ ok: true }> {
    await this.temporal.startFollowUpSweep({ tenantId: session.tenantId, trigger: 'manual' });
    return { ok: true };
  }

  /**
   * The sweep's next call, or null. Nothing is called while the company is
   * paused, once today's cap is reached, or while another follow-up call is
   * live. The first switched-on follow-up with a due item inside calling hours
   * wins: the item gets an attempt and a scheduled call. Items with no phone or
   * no matching team member stop with a note, so they leave the queue.
   */
  async pick(tenantId: string): Promise<{ callId: string } | null> {
    return this.db.tenant(tenantId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`follow-ups:${tenantId}`}))`);
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      if (!tenant || tenant.status === 'paused') return null;
      const s = { ...DEFAULT_TENANT_SETTINGS.calls, ...tenant.settings.calls };
      const now = new Date();
      const clock = { now, today: istDate(now) };
      const [live] = await tx
        .select({ n: count() })
        .from(calls)
        .where(and(eq(calls.stage, 'chase'), inArray(calls.status, ['scheduled', 'ringing', 'in_progress']), gt(calls.createdAt, new Date(now.getTime() - LIVE_MS))));
      if (Number(live?.n ?? 0) > 0) return null;
      const [made] = await tx
        .select({ n: count() })
        .from(calls)
        .where(and(eq(calls.stage, 'chase'), sql`(${calls.createdAt} at time zone 'Asia/Kolkata')::date = ${clock.today}::date`));
      if (Number(made?.n ?? 0) >= s.followUpsPerDay) return null;

      const ws = await this.workspace(tx);
      const on = new Set(
        (await tx.select().from(followUpSwitches).where(and(eq(followUpSwitches.workspaceId, ws.id), eq(followUpSwitches.enabled, true)))).map((x) => x.followUp),
      );
      if (!on.size) return null;
      const anyHours = s.fastSchedule && s.provider === 'simulator';
      const blocked = new Set((await tx.select({ phone: doNotCall.phone }).from(doNotCall)).map((d) => d.phone));
      const people = await tx.select().from(staff);

      for (const reg of registersOf(ws.pack)) {
        for (const f of reg.followUps.filter((x) => on.has(x.key))) {
          if (f.who === 'party' && !anyHours && !withinHours(now, narrowHours(s.partyHours, f.hours))) continue;
          const rows = (
            await tx.execute<Candidate>(sql`
              select r.id, r.data, a.tries from records r
              left join follow_up_attempts a on a.record_id = r.id and a.follow_up = ${f.key}
              where r.workspace_id = ${ws.id} and r.entity = ${reg.entity.name}
                and ${dueSql(f, reg.entity, clock)}
                and (a.id is null or (a.state = 'active' and a.next_due_on <= ${clock.today}::date))
                and not exists (select 1 from record_notes n where n.record_id = r.id and n.status = 'new')
              order by r.updated_at asc
              limit 100`)
          ).rows;
          for (const item of rows) {
            const target = await this.target(tx, ws, reg, f, item, people);
            if (target.kind === 'stop') {
              await this.stop(tx, tenantId, f, item.id, target.why, clock.today);
              continue;
            }
            if (target.kind === 'party' && blocked.has(phoneKey(target.phone))) continue;
            if (target.kind === 'staff' && !anyHours && !withinHours(now, target.person.workingHours)) continue;
            return { callId: await this.schedule(tx, tenantId, s.provider, reg, f, item, target, clock.today) };
          }
        }
      }
      return null;
    });
  }

  private async target(tx: Tx, ws: Workspace, reg: ResolvedRegister, f: ResolvedFollowUp, item: Candidate, people: StaffRow[]): Promise<Target> {
    const title = titleOf(reg.entity, item.data);
    if (f.who === 'staff') {
      const name = String(item.data[f.staffField!.name] ?? '').trim();
      if (!name) return { kind: 'stop', why: `Nobody is named in ${lowerFirst(f.staffField!.label)} for ${title}, so there is nobody to call. Please follow it up yourself.` };
      const person = matchStaff(people, name);
      return person ? { kind: 'staff', person } : { kind: 'stop', why: `Couldn't find ${name} in your team. Add them on the Team page, or follow ${title} up yourself.` };
    }
    const phone = f.phone ? await readPath(tx, ws.id, f.phone, item.data) : null;
    const name = (await contactName(tx, ws.id, f, item.data)) ?? title;
    if (!phone || phoneKey(phone).length < 10) return { kind: 'stop', why: `There is no phone number to call ${name} about ${title}. Please add one or follow it up yourself.` };
    return { kind: 'party', name, phone };
  }

  /** The follow-up stops for this item, and the head gets a note saying why. */
  private async stop(tx: Tx, tenantId: string, f: ResolvedFollowUp, recordId: string, why: string, today: string) {
    await tx
      .insert(followUpAttempts)
      .values({ tenantId, recordId, followUp: f.key, nextDueOn: today, state: 'stopped' })
      .onConflictDoUpdate({ target: [followUpAttempts.recordId, followUpAttempts.followUp], set: { state: 'stopped' } });
    await this.notes.create(tx, tenantId, { recordId, callId: null, followUp: f.key, kind: 'unreachable', speaker: SYSTEM_SPEAKER, said: why });
  }

  private async schedule(tx: Tx, tenantId: string, provider: string, reg: ResolvedRegister, f: ResolvedFollowUp, item: Candidate, target: Exclude<Target, { kind: 'stop' }>, today: string): Promise<string> {
    await tx
      .insert(followUpAttempts)
      .values({ tenantId, recordId: item.id, followUp: f.key, nextDueOn: today, lastCallAt: new Date() })
      .onConflictDoUpdate({ target: [followUpAttempts.recordId, followUpAttempts.followUp], set: { lastCallAt: new Date() } });
    const [call] = await tx
      .insert(calls)
      .values({
        tenantId,
        stage: 'chase',
        attempt: (item.tries ?? 0) + 1,
        status: 'scheduled',
        provider,
        recordId: item.id,
        followUp: f.key,
        ...(target.kind === 'staff' ? { staffId: target.person.id } : { contactName: target.name, contactPhone: target.phone }),
        extracted: { about: { listId: reg.id, itemId: item.id, title: titleOf(reg.entity, item.data) } },
      })
      .returning();
    return call!.id;
  }

  private async workspace(tx: Tx): Promise<Workspace> {
    const ws = await this.records.activeWorkspace(tx);
    return { id: ws.id, pack: normalizeSnapshot(ws.pack) };
  }
}
```

Create `master-ai-backend/src/follow-ups/follow-ups.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import { SwitchFollowUpInputSchema } from '@onehuman/schemas';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { FollowUpsService } from './follow-ups.service';

/** A list's follow-up calls: their switches, and "Call now". The owner and admins only; the service keeps party calls to the owner. */
@ManagersOnly()
@Controller()
export class FollowUpsController {
  constructor(private readonly followUps: FollowUpsService) {}

  @Get('lists/:id/follow-ups')
  list(@CurrentSession() s: Session, @Param('id') id: string) {
    return this.followUps.forList(s, id);
  }

  @Put('follow-ups/:key')
  switch(@CurrentSession() s: Session, @Param('key') key: string, @Body(new ZodPipe(SwitchFollowUpInputSchema)) body: z.output<typeof SwitchFollowUpInputSchema>) {
    return this.followUps.switch(s, key, body.enabled);
  }

  @Post('follow-ups/run')
  run(@CurrentSession() s: Session) {
    return this.followUps.runNow(s);
  }
}
```

Register `FollowUpsController` and `FollowUpsService` in `master-ai-backend/src/app.module.ts`.

- [ ] **Step 5: Run the spec**

Run: `pnpm build:packages && pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts follow-ups`
Expected: PASS.

- [ ] **Step 6: Typecheck, test, commit**

Run: `pnpm turbo run typecheck test`
Expected: PASS.

```bash
git add master-ai-backend packages/schemas packages/sdk
git commit -m "feat(follow-ups): switches (owner only for outside parties), a half-hourly sweep, and picking one due item at a time

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The follow-up call — ringing, the conversation, what it leaves, and its workflows

**Files:**
- Create: `master-ai-backend/src/follow-ups/follow-up-calls.service.ts`
- Modify: `master-ai-backend/src/voice/calls.service.ts` (route by `follow_up`; suggestions), `master-ai-backend/src/orchestration/{workflows,activities,temporal.service}.ts`, `master-ai-backend/src/db/schema.ts` (`calls.extracted.attemptDone?: boolean`), `master-ai-backend/src/app.module.ts`
- Test: `master-ai-backend/__tests__/integration/follow-ups.spec.ts` (append)

**Interfaces:**
- Consumes: Task 4 tables; Task 5 `NotesService.create`; Task 8 `FollowUpEngine`, `FollowUpState`, `newFollowUpState`, `simulatedFollowUpReply`, `followUpSuggestions`, `aboutText`; Task 9 `phoneKey`; Task 10 `FollowUpsService.pick`, `FollowUpSweepInput`, `FollowUpCallInput`; `TwilioService.placeCall`.
- Produces:
  - `FollowUpCallsService.plan(tenantId)`, `place(tenantId, callId): Promise<{ done: boolean }>`, `answer(tenantId, call)`, `reply(tenantId, call, text)`, `decline(tenantId, call)`, `endUnanswered(tenantId, callId, failure?)`, `finish(tenantId, callId)`, `suggestionsFor(tx, call): Promise<string[]>`
  - `TemporalService.signalFollowUp(callId, update)` → workflow `follow-up-call-<callId>`
  - Workflows `followUpSweepWorkflow(input: FollowUpSweepInput)`, `followUpCallWorkflow(input: FollowUpCallInput)`; activities `pickFollowUp`, `followUpPlan`, `placeFollowUpCall`, `endFollowUpCall`, `finishFollowUp`.
  - `CallsService` hands calls with `follow_up` set to `FollowUpCallsService`.

What a finished call leaves (spec §5):

| Result | On the item | Attempt afterwards |
|---|---|---|
| settled (party) | note `said` proposing the fields | `waiting_for_you` |
| promise | note `promise` with `promiseOn` | due the day after the promise |
| dispute | note `dispute` | `waiting_for_you` |
| wrong number | note `wrong_number`; number on do-not-call (`wrong_number`) | `stopped` |
| do not call (party) | number on do-not-call (`asked`), no note | `stopped` |
| status (staff) | `RecordsService.update` via `call` (clears checked) | due again in `every_days` |
| anything else | note `said` | due again in `every_days` |
| no answer / declined / failed | — | `tries + 1`, due in `every_days`; at `max_tries` `stopped` with an `unreachable` note |
| call-back | — | due tomorrow |

- [ ] **Step 1: Write the failing tests**

Append to `master-ai-backend/__tests__/integration/follow-ups.spec.ts` (add imports: `CreateStaffInputSchema` from `@onehuman/schemas`; `FollowUpCallsService` from `../../src/follow-ups/follow-up-calls.service`; `CallsService` from `../../src/voice/calls.service`; `TeamService` from `../../src/voice/team.service`):

```ts
describe('the call to an outside party', () => {
  const calling = () => h.get(FollowUpCallsService);
  const phone = () => h.get(CallsService);
  const lists = () => h.get(ListsService);

  /** Picks the item's call, rings it in the simulator and checks it is about that item. */
  async function ring(id: string): Promise<string> {
    const next = (await followUps.pick(a.tenantId))!;
    const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, next.callId)));
    expect(c?.recordId).toBe(id);
    await calling().place(a.tenantId, next.callId);
    return next.callId;
  }
  const attempt = async (id: string) => (await db().tenant(a.tenantId, (tx) => tx.select().from(followUpAttempts).where(eq(followUpAttempts.recordId, id))))[0]!;

  it('asks who it is speaking to, records a promise as a note, and calls again the day after it', async () => {
    const id = await bill('F-1');
    const callId = await ring(id);
    expect(await phone().get(a.tenantId, callId)).toMatchObject({
      stage: 'chase',
      status: 'ringing',
      staffName: 'Kaveri Spec Traders',
      staffTitle: 'Outside party',
      contact: { name: 'Kaveri Spec Traders', phone: '+91 98470 22222' },
      about: { listId: 'bills', itemId: id, title: 'F-1' },
      suggestions: ['Yes, speaking', 'Wrong number', 'Who is this?'],
    });
    await phone().answer(a.tenantId, callId);
    expect((await phone().get(a.tenantId, callId)).transcript[0]!.text).toMatch(/^Hello, this is an AI assistant calling from .+\. Am I speaking with someone from Kaveri Spec Traders\?$/);
    await phone().reply(a.tenantId, callId, 'Yes, speaking');
    await phone().reply(a.tenantId, callId, 'We will pay it tomorrow');
    await calling().finish(a.tenantId, callId);

    expect(await phone().get(a.tenantId, callId)).toMatchObject({ status: 'completed', outcome: 'promised' });
    const { item, notes } = await lists().item(a.tenantId, 'bills', id);
    expect(item.data.paymentStatus).toBe('unpaid');
    expect(notes[0]).toMatchObject({ kind: 'promise', speaker: 'Kaveri Spec Traders', said: 'We will pay it tomorrow', promiseOn: day(1), status: 'new', callId });
    expect(await attempt(id)).toMatchObject({ state: 'active', tries: 0, nextDueOn: day(2) });
    expect(await followUps.pick(a.tenantId)).toBeNull();

    await h.get(NotesService).dismiss(a.session, notes[0]!.id);
    await db().tenant(a.tenantId, (tx) => tx.update(followUpAttempts).set({ nextDueOn: day(0) }).where(eq(followUpAttempts.recordId, id)));
    const again = (await followUps.pick(a.tenantId))!;
    const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, again.callId)));
    expect(c?.recordId).toBe(id);
    await done(again.callId);
  });

  it('proposes paid with its reference, waits for the head, and Apply sets it', async () => {
    const id = await bill('F-2');
    const callId = await ring(id);
    await phone().answer(a.tenantId, callId);
    for (const text of ['Yes', "It's already paid", 'UTR 445566']) await phone().reply(a.tenantId, callId, text);
    await calling().finish(a.tenantId, callId);
    const { notes } = await lists().item(a.tenantId, 'bills', id);
    expect(notes[0]).toMatchObject({ kind: 'said', said: "It's already paid. UTR 445566" });
    expect(notes[0]!.proposed.map((p) => [p.field, p.value])).toEqual([['paymentStatus', 'paid'], ['paymentRef', '445566']]);
    expect(await attempt(id)).toMatchObject({ state: 'waiting_for_you' });
    await h.get(NotesService).apply(a.session, notes[0]!.id);
    const { item } = await lists().item(a.tenantId, 'bills', id);
    expect(item.data).toMatchObject({ paymentStatus: 'paid', paymentRef: '445566' });
    expect(item.checked?.by).toBe('Asha Owner');
  });

  it('puts a wrong number on the do-not-call list and never calls it again', async () => {
    const wrong = await add('Party', { name: 'Wrong Number Traders', partyType: 'retailer', phone: '+91 98470 44444' });
    const id = await bill('F-3', { party: wrong });
    const callId = await ring(id);
    await phone().answer(a.tenantId, callId);
    await phone().reply(a.tenantId, callId, 'Wrong number');
    await calling().finish(a.tenantId, callId);
    const [dnc] = await db().tenant(a.tenantId, (tx) => tx.select().from(doNotCall).where(eq(doNotCall.phone, '9847044444')));
    expect(dnc).toMatchObject({ reason: 'wrong_number', recordId: id, callId });
    expect((await lists().item(a.tenantId, 'bills', id)).notes[0]).toMatchObject({ kind: 'wrong_number' });
    expect(await attempt(id)).toMatchObject({ state: 'stopped' });
    await bill('F-4', { party: wrong });
    expect(await pickAll()).toEqual([]);
  });

  it('counts unanswered calls and stops after the third, with a note for the head', async () => {
    const id = await bill('F-5');
    for (let n = 1; n <= 3; n++) {
      if (n > 1) await db().tenant(a.tenantId, (tx) => tx.update(followUpAttempts).set({ nextDueOn: day(0) }).where(eq(followUpAttempts.recordId, id)));
      const callId = await ring(id);
      expect((await phone().get(a.tenantId, callId)).attempt).toBe(n);
      await phone().decline(a.tenantId, callId);
      await calling().finish(a.tenantId, callId);
      if (n < 3) expect(await attempt(id)).toMatchObject({ state: 'active', tries: n, nextDueOn: day(3) });
    }
    expect(await attempt(id)).toMatchObject({ state: 'stopped', tries: 3 });
    expect((await lists().item(a.tenantId, 'bills', id)).notes[0]).toMatchObject({
      kind: 'unreachable',
      said: "Couldn't reach Kaveri Spec Traders after 3 tries. Please follow up yourself.",
    });
  });

  it('plays the whole call in the simulator when nobody answers in the app', async () => {
    const tenancy = h.get(TenancyService);
    await tenancy.updateSettings(a.session, { calls: { simulatorMode: 'auto' } });
    try {
      const id = await bill('F-6');
      const next = (await followUps.pick(a.tenantId))!;
      expect(await calling().place(a.tenantId, next.callId)).toEqual({ done: true });
      await calling().finish(a.tenantId, next.callId);
      expect(await phone().get(a.tenantId, next.callId)).toMatchObject({ status: 'completed', outcome: 'promised' });
      expect((await lists().item(a.tenantId, 'bills', id)).notes[0]).toMatchObject({ kind: 'promise' });
    } finally {
      await tenancy.updateSettings(a.session, { calls: { simulatorMode: 'interactive' } });
    }
  });
});

describe('follow-ups to the team', () => {
  let it2: Org;
  let anilId: string;
  const OVERDUE = 'tickets.overdue-tickets';
  const ticket = (summary: string, assignedTo: string) =>
    db().tenant(it2.tenantId, async (tx) => {
      const svc = h.get(RecordsService);
      const data = { ticketNo: `T-${summary.length}`, clientName: 'Acme', summary, assignedTo, status: 'assigned', dueBy: new Date(Date.now() - 86_400_000).toISOString() };
      return (await svc.create(tx, it2.tenantId, await svc.activeWorkspace(tx), 'Ticket', data, SYSTEM, { kind: 'agent' })).id;
    });

  beforeAll(async () => {
    it2 = await newOrg(h, 'it-services');
    await h.get(ListsService).removeSamples(it2.session);
    anilId = (await h.get(TeamService).create(it2.session, CreateStaffInputSchema.parse({ name: 'Anil Kumar', phone: '+91 98470 55555', title: 'Engineer' }))).id;
    await followUps.switch({ ...it2.session, role: 'admin' }, OVERDUE, true);
  });

  it("updates the item from the engineer's answer at once, and it needs checking again", async () => {
    const id = await ticket('Printer not working', 'Anil');
    await h.get(ListsService).check(it2.session, 'tickets', id, { note: 'Known' });
    const next = (await followUps.pick(it2.tenantId))!;
    const callsSvc = h.get(CallsService);
    expect(await callsSvc.get(it2.tenantId, next.callId)).toMatchObject({ staffId: anilId, staffName: 'Anil Kumar', contact: null });
    await h.get(FollowUpCallsService).place(it2.tenantId, next.callId);
    await callsSvc.answer(it2.tenantId, next.callId);
    expect((await callsSvc.get(it2.tenantId, next.callId)).transcript[0]!.text).toMatch(/^Hi Anil, this is the AI assistant at .+, about ticket .+\. What's the status\?$/);
    await callsSvc.reply(it2.tenantId, next.callId, "It's in progress, done by tomorrow 5 pm");
    await h.get(FollowUpCallsService).finish(it2.tenantId, next.callId);

    const { item, history } = await h.get(ListsService).item(it2.tenantId, 'tickets', id);
    expect(item.data.status).toBe('in-progress');
    expect(item.data.dueBy).toBe(new Date(`${day(1)}T17:00:00+05:30`).toISOString());
    expect(item.checked).toBeNull();
    expect(item.updated).toMatchObject({ via: 'call', by: 'Anil Kumar' });
    expect(history.at(-1)).toMatchObject({ kind: 'updated', note: `On the call: "It's in progress, done by tomorrow 5 pm"` });
    expect(await callsSvc.get(it2.tenantId, next.callId)).toMatchObject({ outcome: 'updated' });
  });

  it('leaves a note when nobody in the team has the name on the item', async () => {
    const id = await ticket('Scanner jammed', 'Nobody Here');
    expect(await followUps.pick(it2.tenantId)).toBeNull();
    const { notes } = await h.get(ListsService).item(it2.tenantId, 'tickets', id);
    expect(notes[0]).toMatchObject({ kind: 'unreachable', speaker: 'ONEHUMAN OS' });
    expect(notes[0]!.said).toMatch(/^Couldn't find Nobody Here in your team/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts follow-ups`
Expected: FAIL — `../../src/follow-ups/follow-up-calls.service` does not exist.

- [ ] **Step 3: `FollowUpCallsService`**

Create `master-ai-backend/src/follow-ups/follow-up-calls.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { CallOutcome, ResolvedPack, TranscriptLine } from '@onehuman/schemas';
import { normalizeSnapshot, registersOf, titleOf, type ResolvedFollowUp, type ResolvedRegister } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import { DEFAULT_TENANT_SETTINGS } from '../common/mappers';
import { DbService, type Tx } from '../db/db.service';
import { calls, doNotCall, followUpAttempts, records, staff, tenants } from '../db/schema';
import { isUuid } from '../lists/format';
import { NotesService } from '../notes/notes.service';
import { TemporalService } from '../orchestration/temporal.service';
import { RecordsService } from '../records/records.service';
import { FollowUpEngine, followUpSuggestions, newFollowUpState, simulatedFollowUpReply, type FollowUpContext, type FollowUpResult, type FollowUpState } from '../voice/follow-up-engine';
import { aboutText, lowerFirst, sayDay } from '../voice/spoken';
import { addDaysTo, istDate } from '../voice/time';
import { TwilioService } from '../voice/twilio';
import { phoneKey } from './targets';

type CallRow = typeof calls.$inferSelect;
type Loaded = { reg: ResolvedRegister; f: ResolvedFollowUp; rec: typeof records.$inferSelect; ctx: FollowUpContext; phone: string | null; pack: ResolvedPack; workspaceId: string };

const RING_SECONDS = 40;
const line = (speaker: TranscriptLine['speaker'], text: string): TranscriptLine => ({ speaker, text, at: new Date().toISOString() });

/**
 * One follow-up call about one list item, from ringing to what it leaves.
 * What an outside party says becomes a note (or a do-not-call entry); only a
 * team member's status answer changes the item, through RecordsService.update.
 * `finish` then sets when the item is due again, or that it waits for the
 * head, or that the follow-up has stopped for it.
 */
@Injectable()
export class FollowUpCallsService {
  private readonly logger = new Logger(FollowUpCallsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
    private readonly notes: NotesService,
    private readonly engine: FollowUpEngine,
    private readonly temporal: TemporalService,
    private readonly twilio: TwilioService,
  ) {}

  async plan(tenantId: string) {
    const s = await this.settings(tenantId);
    return { ringTimeoutMs: s.provider !== 'simulator' ? 90_000 : 45_000, talkTimeoutMs: 15 * 60_000 };
  }

  /** Rings: a real call through Twilio, a simulated one in the app, or — in the simulator's auto mode — the whole call now. */
  async place(tenantId: string, callId: string): Promise<{ done: boolean }> {
    const s = await this.settings(tenantId);
    const ready = await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
      if (!c || c.status !== 'scheduled') return null;
      const loaded = await this.load(tx, c);
      if (!loaded) {
        await tx.update(calls).set({ status: 'cancelled', endedAt: new Date(), summary: 'The item or its follow-up is gone.' }).where(eq(calls.id, callId));
        return null;
      }
      await tx.update(calls).set({ status: 'ringing', extracted: { ...c.extracted, followUp: loaded.ctx.state } }).where(eq(calls.id, callId));
      await this.audit.append(tx, tenantId, {
        type: 'call.ringing',
        actor: SYSTEM,
        refId: callId,
        payload: { staffName: loaded.ctx.name, stage: 'chase', attempt: c.attempt, about: c.extracted.about?.title },
      });
      return loaded;
    });
    if (!ready) return { done: true };

    if (s.provider === 'twilio') {
      try {
        const sid = await this.twilio.placeCall({ to: ready.phone ?? '', tenantId, callId, ringSeconds: RING_SECONDS });
        await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ providerCallId: sid }).where(eq(calls.id, callId)));
      } catch (err) {
        this.logger.warn(`Follow-up call ${callId} not placed: ${(err as Error).message}`);
        await this.endUnanswered(tenantId, callId, `Couldn't place the call. ${(err as Error).message}`);
        return { done: true };
      }
      return { done: false };
    }
    if (s.simulatorMode === 'interactive') return { done: false };

    // Auto mode: a simulated party or team member answers.
    const ctx = ready.ctx;
    let transcript: TranscriptLine[] = [line('ai', this.engine.opening(ctx))];
    let state = ctx.state;
    let callBack = false;
    await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript }).where(eq(calls.id, callId)));
    for (let i = 0; i < 10 && state.phase !== 'done'; i++) {
      const reply = simulatedFollowUpReply({ ...ctx, state, transcript });
      const res = await this.engine.turn({ ...ctx, state, transcript }, reply);
      transcript = [...transcript, line('person', reply), line('ai', res.say)];
      state = res.state;
      callBack = res.callBack;
      if (res.end) break;
    }
    await this.conclude(tenantId, callId, transcript, state, callBack);
    return { done: true };
  }

  async answer(tenantId: string, call: CallRow) {
    await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, call.id)).for('update');
      if (!c || c.status !== 'ringing') throw new ConflictException(`Call is ${c?.status.replace('_', ' ') ?? 'gone'}`);
      const loaded = await this.load(tx, c);
      if (!loaded) throw new ConflictException('The item this call was about is gone');
      await tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript: [line('ai', this.engine.opening(loaded.ctx))] }).where(eq(calls.id, c.id));
    });
    await this.temporal.signalFollowUp(call.id, { callId: call.id, event: 'answered' });
  }

  async reply(tenantId: string, call: CallRow, text: string) {
    const { c, ctx } = await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, call.id));
      if (!c || c.status !== 'in_progress') throw new BadRequestException('Answer the call first');
      const loaded = await this.load(tx, c);
      if (!loaded) throw new ConflictException('The item this call was about is gone');
      return { c, ctx: loaded.ctx };
    });
    const res = await this.engine.turn(ctx, text);
    const transcript = [...c.transcript, line('person', text), line('ai', res.say)];
    if (res.end) {
      await this.conclude(tenantId, call.id, transcript, res.state, res.callBack);
      await this.temporal.signalFollowUp(call.id, { callId: call.id, event: 'ended' });
    } else {
      await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ transcript, extracted: { ...c.extracted, followUp: res.state } }).where(eq(calls.id, call.id)));
    }
  }

  async decline(tenantId: string, call: CallRow) {
    await this.endUnanswered(tenantId, call.id);
    await this.temporal.signalFollowUp(call.id, { callId: call.id, event: 'ended' });
  }

  /** Nobody answered, the call could not be placed, or it dropped mid-way (what was said so far still counts). */
  async endUnanswered(tenantId: string, callId: string, failure?: string) {
    const [c] = await this.db.tenant(tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, callId)));
    if (!c) return;
    if (c.status === 'in_progress') {
      await this.conclude(tenantId, callId, c.transcript, c.extracted.followUp ?? newFollowUpState('party'), false, true);
      return;
    }
    if (c.status !== 'ringing' && c.status !== 'scheduled') return;
    await this.db.tenant(tenantId, async (tx) => {
      const name = await this.nameOf(tx, c);
      await tx
        .update(calls)
        .set({ status: failure ? 'failed' : 'no_answer', endedAt: new Date(), outcome: 'no_answer', summary: failure ?? `${name} didn't answer.` })
        .where(eq(calls.id, callId));
      await this.audit.append(tx, tenantId, { type: 'call.no_answer', actor: SYSTEM, refId: callId, payload: { staffName: name, stage: 'chase', attempt: c.attempt } });
    });
  }

  /** After the call: when the item is due again, or that it waits for the head, or that the follow-up stopped. Safe to run twice. */
  async finish(tenantId: string, callId: string) {
    await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
      if (!c?.recordId || !c.followUp || c.extracted.attemptDone) return;
      await tx.update(calls).set({ extracted: { ...c.extracted, attemptDone: true } }).where(eq(calls.id, callId));
      const loaded = await this.load(tx, c);
      const [a] = await tx.select().from(followUpAttempts).where(and(eq(followUpAttempts.recordId, c.recordId), eq(followUpAttempts.followUp, c.followUp)));
      if (!loaded || !a) return;
      const { f } = loaded;
      const today = istDate();
      const result = c.extracted.followUp?.result ?? null;
      let set: Partial<typeof followUpAttempts.$inferInsert>;
      if (c.status === 'no_answer' || c.status === 'failed' || c.status === 'cancelled') {
        const tries = a.tries + 1;
        if (tries >= f.maxTries) {
          set = { tries, state: 'stopped' };
          await this.notes.create(tx, tenantId, {
            recordId: c.recordId,
            callId,
            followUp: f.key,
            kind: 'unreachable',
            speaker: 'ONEHUMAN OS',
            said: `Couldn't reach ${loaded.ctx.name} after ${tries} tries. Please follow up yourself.`,
          });
        } else {
          set = { tries, nextDueOn: addDaysTo(today, f.everyDays) };
        }
      } else if (!result) {
        set = { tries: 0, nextDueOn: addDaysTo(today, c.outcome === 'call_back' ? 1 : f.everyDays) };
      } else {
        switch (result.kind) {
          case 'promise':
            set = { tries: 0, nextDueOn: addDaysTo(result.promiseOn, 1) };
            break;
          case 'settled':
          case 'dispute':
            set = { tries: 0, state: 'waiting_for_you' };
            break;
          case 'wrong_number':
            set = { tries: 0, state: 'stopped' };
            break;
          case 'do_not_call':
            set = f.who === 'party' ? { tries: 0, state: 'stopped' } : { tries: 0, nextDueOn: addDaysTo(today, f.everyDays) };
            break;
          default:
            set = { tries: 0, nextDueOn: addDaysTo(today, f.everyDays) };
        }
      }
      await tx.update(followUpAttempts).set({ ...set, lastCallAt: c.endedAt ?? new Date() }).where(eq(followUpAttempts.id, a.id));
    });
  }

  /** Likely replies for the simulator while a follow-up call is on. */
  async suggestionsFor(tx: Tx, c: CallRow): Promise<string[]> {
    if (c.status !== 'ringing' && c.status !== 'in_progress') return [];
    const loaded = await this.load(tx, c);
    return loaded ? followUpSuggestions(loaded.ctx) : [];
  }

  /** The call's words are in: write the call, and what it leaves on the item. */
  private async conclude(tenantId: string, callId: string, transcript: TranscriptLine[], state: FollowUpState, callBack: boolean, dropped = false) {
    await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
      if (!c || c.status === 'completed') return;
      const loaded = await this.load(tx, c);
      const name = loaded?.ctx.name ?? c.contactName ?? 'They';
      const result = state.result;
      const { outcome, summary } = result && loaded ? outcomeOf(result, name, loaded) : callBack ? { outcome: 'call_back' as const, summary: `${name} asked to be called another time.` } : { outcome: 'unclear' as const, summary: dropped ? 'The call dropped before an answer.' : 'No answer about the item.' };
      await tx.update(calls).set({ status: 'completed', endedAt: new Date(), transcript, outcome, summary, extracted: { ...c.extracted, followUp: state } }).where(eq(calls.id, callId));
      await this.audit.append(tx, tenantId, { type: 'call.completed', actor: SYSTEM, refId: callId, payload: { staffName: name, stage: 'chase', outcome, summary } });
      if (result && loaded && c.recordId) await this.leave(tx, tenantId, c, loaded, result);
    });
  }

  /** What a result leaves on the item: a note, a do-not-call entry, or (a team member's answer) the change itself. */
  private async leave(tx: Tx, tenantId: string, c: CallRow, loaded: Loaded, result: FollowUpResult) {
    const recordId = c.recordId!;
    const note = (kind: 'said' | 'promise' | 'dispute' | 'wrong_number', extra: { proposed?: Record<string, unknown>; promiseOn?: string } = {}) =>
      this.notes.create(tx, tenantId, { recordId, callId: c.id, followUp: loaded.f.key, kind, speaker: loaded.ctx.name, said: result.said, ...extra });
    const block = async (reason: 'asked' | 'wrong_number') => {
      const phone = loaded.phone ? phoneKey(loaded.phone) : '';
      if (phone.length < 10) return;
      await tx.insert(doNotCall).values({ tenantId, phone, reason, recordId, callId: c.id }).onConflictDoNothing();
      await this.audit.append(tx, tenantId, { type: 'do_not_call.added', actor: SYSTEM, refId: recordId, payload: { name: loaded.ctx.name, reason } });
    };
    switch (result.kind) {
      case 'settled':
        return void (await note('said', { proposed: result.proposed }));
      case 'promise':
        return void (await note('promise', { promiseOn: result.promiseOn }));
      case 'dispute':
        return void (await note('dispute'));
      case 'wrong_number':
        await note('wrong_number');
        return block('wrong_number');
      case 'do_not_call':
        if (loaded.f.who === 'party') return block('asked');
        return void (await note('said'));
      case 'status':
        try {
          await this.records.update(tx, tenantId, { id: loaded.workspaceId, pack: loaded.pack }, loaded.reg.entity.name, recordId, result.patch, {
            actor: SYSTEM,
            via: 'call',
            ref: c.id,
            note: `On the call: "${result.said}"`,
          });
        } catch (err) {
          if (!(err instanceof BadRequestException)) throw err;
          await note('said');
        }
        return;
      case 'said':
        return void (await note('said'));
    }
  }

  /** Everything a follow-up call needs, from its row: the list, the follow-up, the item, and the call's context. Null when any is gone. */
  private async load(tx: Tx, c: CallRow): Promise<Loaded | null> {
    if (!c.recordId || !c.followUp) return null;
    const ws = await this.records.activeWorkspace(tx);
    const pack = normalizeSnapshot(ws.pack);
    const reg = registersOf(pack).find((r) => r.followUps.some((f) => f.key === c.followUp));
    const f = reg?.followUps.find((x) => x.key === c.followUp);
    const [rec] = await tx.select().from(records).where(eq(records.id, c.recordId));
    if (!reg || !f || !rec) return null;
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, c.tenantId));
    const [person] = c.staffId ? await tx.select().from(staff).where(eq(staff.id, c.staffId)) : [];
    const titles: Record<string, string> = {};
    for (const field of f.about.filter((x) => x.type === 'reference')) {
      const id = rec.data[field.name];
      const target = pack.entities.find((e) => e.name === field.ref);
      if (!isUuid(id) || !target) continue;
      const [ref] = await tx.select({ data: records.data }).from(records).where(eq(records.id, id));
      if (ref) titles[field.name] = titleOf(target, ref.data);
    }
    const now = new Date();
    const ctx: FollowUpContext = {
      tenantId: c.tenantId,
      companyName: tenant?.name ?? 'the company',
      who: f.who,
      name: person?.name ?? c.contactName ?? 'there',
      about: aboutText(lowerFirst(reg.entity.label), f.about, rec.data, titles, now),
      findOut: f.findOut,
      state: c.extracted.followUp ?? newFollowUpState(f.who),
      transcript: c.transcript,
      now,
    };
    return { reg, f, rec, ctx, phone: person?.phone ?? c.contactPhone, pack, workspaceId: ws.id };
  }

  private async nameOf(tx: Tx, c: CallRow): Promise<string> {
    if (!c.staffId) return c.contactName ?? 'They';
    const [p] = await tx.select({ name: staff.name }).from(staff).where(eq(staff.id, c.staffId));
    return p?.name ?? 'They';
  }

  private async settings(tenantId: string) {
    const [t] = await this.db.tenant(tenantId, (tx) => tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)));
    return { ...DEFAULT_TENANT_SETTINGS.calls, ...t?.settings.calls };
  }
}

/** The call log's outcome and line for a result. */
function outcomeOf(result: FollowUpResult, name: string, loaded: Loaded): { outcome: CallOutcome; summary: string } {
  switch (result.kind) {
    case 'settled':
      return { outcome: 'settled', summary: `${name} says it is settled: "${result.said}"` };
    case 'promise':
      return { outcome: 'promised', summary: `${name} promised ${sayDay(result.promiseOn, loaded.ctx.now)}.` };
    case 'dispute':
      return { outcome: 'disputed', summary: `${name} disputes it: "${result.said}"` };
    case 'wrong_number':
      return { outcome: 'wrong_number', summary: 'Wrong number. It will not be called again.' };
    case 'do_not_call':
      return { outcome: 'do_not_call', summary: `${name} asked not to be called again.` };
    case 'status':
      return { outcome: 'updated', summary: `Updated from what ${name.split(' ')[0]} said: "${result.said}"` };
    case 'said':
      return { outcome: 'noted', summary: `${name} said: "${result.said}"` };
  }
}
```

In `master-ai-backend/src/db/schema.ts`, add `attemptDone?: boolean;` to the `calls.extracted` type.

- [ ] **Step 4: Route calls, signal and run the workflows**

In `master-ai-backend/src/voice/calls.service.ts`, inject `private readonly followUps: FollowUpCallsService` (import from `../follow-ups/follow-up-calls.service`). In `answer`, `reply` and `decline`, check follow-up calls first:

```ts
    if (c.followUp) await this.followUps.answer(tenantId, c);
    else if (c.checkinId) await this.routines.answer(tenantId, c);
    else await this.delegations.answer(tenantId, callId);
```

(the same shape with `reply(tenantId, c, text)` and `decline(tenantId, c)`), and in `list` and `get` compute suggestions with:

```ts
r.c.followUp ? await this.followUps.suggestionsFor(tx, r.c) : await this.routines.suggestionsFor(tx, r.c, r.person)
```

Update the class comment: "Every call, whatever it is about: delegated work, a routine check-in or collection, or a follow-up on a list item."

In `master-ai-backend/src/orchestration/temporal.service.ts`, add after `signalCheckin`:

```ts
  /** A follow-up call was answered or ended: wake its call workflow. */
  async signalFollowUp(callId: string, update: CallUpdateSignal) {
    await this.signal(`follow-up-call-${callId}`, SIGNALS.callUpdate, update);
  }
```

In `master-ai-backend/src/orchestration/workflows.ts`, import `FollowUpCallInput` and `FollowUpSweepInput` from `./shared` and add:

```ts
/**
 * The company's follow-up sweep: one call at a time until nothing is due
 * inside calling hours, the day's cap is reached, or another sweep's call is on.
 */
export async function followUpSweepWorkflow(input: FollowUpSweepInput) {
  for (let i = 0; i < 200; i++) {
    const next = await db.pickFollowUp(input);
    if (!next) return;
    await executeChild(followUpCallWorkflow, {
      workflowId: `follow-up-call-${next.callId}`,
      args: [{ tenantId: input.tenantId, callId: next.callId }],
      parentClosePolicy: ParentClosePolicy.TERMINATE,
    });
  }
}

/** One follow-up call: ring, wait for an answer and the end, then set when the item is due again. */
export async function followUpCallWorkflow(input: FollowUpCallInput) {
  const answered = new Set<string>();
  const ended = new Set<string>();
  setHandler(callUpdate, ({ callId, event }) => {
    answered.add(callId);
    if (event === 'ended') ended.add(callId);
  });
  const plan = await db.followUpPlan(input);
  const placed = await db.placeFollowUpCall(input);
  if (!placed.done) {
    const picked = await condition(() => answered.has(input.callId), plan.ringTimeoutMs);
    if (picked) await condition(() => ended.has(input.callId), plan.talkTimeoutMs);
    if (!ended.has(input.callId)) await db.endFollowUpCall(input);
  }
  await db.finishFollowUp(input);
}
```

In `master-ai-backend/src/orchestration/activities.ts`, get the services (`const followUps = app.get(FollowUpsService); const followUpCalls = app.get(FollowUpCallsService);`), import the input types, and add:

```ts
    // Follow-up calls about open list items
    pickFollowUp: (i: FollowUpSweepInput) => followUps.pick(i.tenantId),
    followUpPlan: (i: FollowUpCallInput) => followUpCalls.plan(i.tenantId),
    placeFollowUpCall: (i: FollowUpCallInput) => followUpCalls.place(i.tenantId, i.callId),
    endFollowUpCall: (i: FollowUpCallInput) => followUpCalls.endUnanswered(i.tenantId, i.callId),
    finishFollowUp: (i: FollowUpCallInput) => followUpCalls.finish(i.tenantId, i.callId),
```

Provide `FollowUpCallsService` in `master-ai-backend/src/app.module.ts`.

- [ ] **Step 5: Run the specs**

Run: `pnpm build:packages && pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts follow-ups calls-outside collection notes`
Expected: PASS.

- [ ] **Step 6: The whole backend, with the worker build**

Run: `pnpm turbo run build typecheck test && pnpm test:integration`
Expected: PASS (the worker bundle builds with the two new workflows).

- [ ] **Step 7: Commit**

```bash
git add master-ai-backend
git commit -m "feat(follow-ups): the follow-up call — party answers become notes, staff answers update the item — and its workflows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Web lists — the follow-ups panel, call notes in the item drawer, New from calls

**Files:**
- Create: `master-ai-web/src/components/follow-ups-panel.tsx`, `master-ai-web/src/components/item-notes.tsx`
- Modify: `master-ai-web/src/lib/lists.ts` (`NOTE_LABELS`, `followUpLine`, `dayLabel`), `master-ai-web/src/routes/list.tsx` (`Status`, panel, refresh), `master-ai-web/src/components/list-item-panel.tsx` (notes, "Updated on a call with …"), `master-ai-web/src/lib/realtime.ts`
- Test: `master-ai-web/__tests__/unit/lib/lists.test.ts` (append)

**Interfaces:**
- Consumes: Task 5 `ListNote`, `NoteKind`, `ListItem.newNotes`, `ListItemDetail.notes`, `api.notes.apply/dismiss`; Task 10 `FollowUpInfo`, `api.lists.followUps`, `api.followUps.switch/run`.
- Produces: `NOTE_LABELS: Record<NoteKind, string>`, `followUpLine(f: FollowUpInfo): string`, `dayLabel(day: string): string`; `<FollowUpsPanel listId />`; `<ItemNotes notes onDone />`. Accessible names the browser test uses: switch `role="switch"` named by the follow-up's label; buttons "Call now", "Apply", "Dismiss", "Seen"; the drawer section "From calls"; the Show chip "New from calls".

- [ ] **Step 1: Write the failing unit tests**

Append to `master-ai-web/__tests__/unit/lib/lists.test.ts` (extend the import with `dayLabel, followUpLine, NOTE_LABELS`):

```ts
describe('follow-ups and call notes in words', () => {
  const f = { key: 'bills.unpaid-bills', id: 'unpaid-bills', label: 'Unpaid bills → the party', who: 'party' as const, enabled: true, changedBy: 'Asha', changedAt: '2026-10-15T05:00:00Z', canSwitch: true, due: 3, waiting: 1, stopped: 0 };

  it("says what a follow-up is doing", () => {
    expect(followUpLine(f)).toBe('On · 3 to call about now · 1 waiting for you');
    expect(followUpLine({ ...f, enabled: false, due: 0, waiting: 0, stopped: 2 })).toBe('Off · nothing due now · 2 stopped');
  });

  it('names every kind of note', () => {
    expect(NOTE_LABELS).toEqual({
      said: 'Said on a call',
      promise: 'Promise',
      dispute: 'Dispute',
      wrong_number: 'Wrong number',
      difference: 'Different on a call',
      unreachable: "Couldn't call",
    });
  });

  it('shows a promised day the way people say it', () => {
    expect(dayLabel('2026-10-16')).toBe('Fri, 16 Oct');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @onehuman/web exec vitest run __tests__/unit/lib/lists.test.ts`
Expected: FAIL — `followUpLine` is not exported.

- [ ] **Step 3: The helpers**

In `master-ai-web/src/lib/lists.ts`, extend the type import with `FollowUpInfo, NoteKind` and add:

```ts
export const NOTE_LABELS: Record<NoteKind, string> = {
  said: 'Said on a call',
  promise: 'Promise',
  dispute: 'Dispute',
  wrong_number: 'Wrong number',
  difference: 'Different on a call',
  unreachable: "Couldn't call",
};

/** "On · 3 to call about now · 1 waiting for you". */
export function followUpLine(f: FollowUpInfo): string {
  const parts = [f.enabled ? 'On' : 'Off', f.due ? `${f.due} to call about now` : 'nothing due now'];
  if (f.waiting) parts.push(`${f.waiting} waiting for you`);
  if (f.stopped) parts.push(`${f.stopped} stopped`);
  return parts.join(' · ');
}

/** "Fri, 16 Oct" for a YYYY-MM-DD day. */
export function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
```

Run the unit tests again: PASS.

- [ ] **Step 4: The follow-ups panel and the notes**

Create `master-ai-web/src/components/follow-ups-panel.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PhoneCall, PhoneOutgoing } from 'lucide-react';
import type { FollowUpInfo } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { followUpLine } from '@/lib/lists';
import { cn, timeAgo } from '@/lib/utils';

/** A list's follow-up calls: one switch each (all start off), who switched it and when, and "Call now". */
export function FollowUpsPanel({ listId }: { listId: string }) {
  const queryClient = useQueryClient();
  const followUps = useQuery({ queryKey: ['follow-ups', listId], queryFn: () => api.lists.followUps(listId) });
  const toggle = useMutation({
    mutationFn: (f: FollowUpInfo) => api.followUps.switch(f.key, !f.enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['follow-ups', listId] }),
  });
  const run = useMutation({ mutationFn: () => api.followUps.run() });
  const list = followUps.data ?? [];
  if (!list.length) return null;
  return (
    <Card className="mb-4">
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-fg">
            <PhoneOutgoing className="size-4 text-primary" aria-hidden /> Follow-up calls
          </h2>
          {list.some((f) => f.enabled) && (
            <Button size="sm" variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
              <PhoneCall /> Call now
            </Button>
          )}
        </div>
        <ul className="divide-y divide-border">
          {list.map((f) => (
            <li key={f.key} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-fg">{f.label}</p>
                <p className="text-xs text-fg-muted">
                  {followUpLine(f)}
                  {f.changedBy && f.changedAt ? ` · switched ${f.enabled ? 'on' : 'off'} by ${f.changedBy}, ${timeAgo(f.changedAt)}` : ''}
                </p>
                {!f.canSwitch && <p className="text-xs text-fg-muted">Only the owner can switch on calls to customers and suppliers.</p>}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={f.enabled}
                aria-label={f.label}
                disabled={!f.canSwitch || toggle.isPending}
                onClick={() => toggle.mutate(f)}
                className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', f.enabled ? 'bg-primary' : 'bg-muted')}
              >
                <span className={cn('absolute top-0.5 size-5 rounded-full bg-surface shadow transition-transform', f.enabled ? 'translate-x-5' : 'translate-x-0.5')} />
              </button>
            </li>
          ))}
        </ul>
        {run.isSuccess && <p className="text-xs text-fg-muted">Looking for items to call about now. Calls ring one at a time, inside calling hours.</p>}
        <ErrorNote error={followUps.error ?? toggle.error ?? run.error} />
      </CardBody>
    </Card>
  );
}
```

Create `master-ai-web/src/components/item-notes.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import type { ListNote } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { dayLabel, NOTE_LABELS } from '@/lib/lists';
import { cn, timeAgo } from '@/lib/utils';

/** What calls left on an item, newest first. Apply sets what a note proposes; a note with nothing to apply is only marked as seen. */
export function ItemNotes({ notes, onDone }: { notes: ListNote[]; onDone: () => void }) {
  const apply = useMutation({ mutationFn: (id: string) => api.notes.apply(id), onSuccess: onDone });
  const dismiss = useMutation({ mutationFn: (id: string) => api.notes.dismiss(id), onSuccess: onDone });
  if (!notes.length) return null;
  const state = (n: ListNote) => (n.status === 'new' ? 'New from a call' : n.status === 'applied' ? `Applied by ${n.decidedBy ?? 'someone'}` : `Seen by ${n.decidedBy ?? 'someone'}`);
  return (
    <section aria-label="From calls" className="space-y-2">
      <h3 className="text-sm font-medium text-fg">From calls</h3>
      {notes.map((n) => (
        <div key={n.id} className={cn('rounded-sm border px-3 py-2 text-sm', n.status === 'new' ? 'border-primary/40 bg-primary-soft' : 'border-border')}>
          <p className="text-xs text-fg-muted">
            {NOTE_LABELS[n.kind]} · {n.speaker} · {timeAgo(n.at)} · {state(n)}
          </p>
          <p className="mt-1 text-fg">“{n.said}”</p>
          {n.promiseOn && <p className="text-fg-body">Promised for {dayLabel(n.promiseOn)}</p>}
          {n.proposed.length > 0 && (
            <ul className="mt-1 ml-4 list-disc text-fg-body">
              {n.proposed.map((p) => (
                <li key={p.field}>
                  {p.label}: {p.value}
                </li>
              ))}
            </ul>
          )}
          {n.status === 'new' && (
            <div className="mt-2 flex gap-2">
              {n.proposed.length > 0 && (
                <Button size="sm" variant="success" loading={apply.isPending && apply.variables === n.id} onClick={() => apply.mutate(n.id)}>
                  Apply
                </Button>
              )}
              <Button size="sm" variant="secondary" loading={dismiss.isPending && dismiss.variables === n.id} onClick={() => dismiss.mutate(n.id)}>
                {n.proposed.length > 0 ? 'Dismiss' : 'Seen'}
              </Button>
            </div>
          )}
        </div>
      ))}
      <ErrorNote error={apply.error ?? dismiss.error} />
    </section>
  );
}
```

- [ ] **Step 5: Wire them in**

In `master-ai-web/src/routes/list.tsx`:
- import `FollowUpsPanel` from `@/components/follow-ups-panel`;
- render `<FollowUpsPanel listId={id} />` right after `<PageHeader … />`;
- in `refresh`, add `'follow-ups'` to the keys;
- `Status` shows the new-note badge beside whatever else it shows:

```tsx
function Status({ item }: { item: ListItem }) {
  const open = item.problems.filter((p) => !p.acknowledged);
  const fromCall = item.newNotes > 0 && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary">New from a call</span>;
  if (open.length) {
    return (
      <span className="inline-flex items-center">
        <span className="inline-flex items-center gap-1 text-danger" title={open.map((p) => p.message).join('\n')}>
          <AlertTriangle className="size-4" aria-hidden />
          {open.length}
          <span className="sr-only"> problem{open.length === 1 ? '' : 's'}</span>
        </span>
        {fromCall}
      </span>
    );
  }
  if (item.checked) {
    return (
      <span className="inline-flex items-center">
        <span className="inline-flex text-success" title={`Checked by ${item.checked.by}`}>
          <CheckCircle2 className="size-4" aria-hidden />
          <span className="sr-only">Checked</span>
        </span>
        {fromCall}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center">
      <span className="text-xs text-fg-muted">Not checked</span>
      {fromCall}
    </span>
  );
}
```

In `master-ai-web/src/components/list-item-panel.tsx`:
- import `ItemNotes` from `@/components/item-notes`;
- after the "Came in" paragraph's checked part, add `{d.item.updated.via === 'call' && d.item.updated.by && <span className="text-fg-muted"> · Updated on a call with {d.item.updated.by}</span>}`;
- render `<ItemNotes notes={d.notes} onDone={done} />` right after the Problems section (`done` is the same refresh the check mutation uses).

In `master-ai-web/src/lib/realtime.ts`, refresh lists on notes and follow-ups too:

```ts
        if (area === 'record' || area === 'action' || area === 'note') {
          for (const key of ['records', 'lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [key] });
        }
        if (area === 'followup' || area === 'note' || area === 'do_not_call') void queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
```

- [ ] **Step 6: Typecheck, unit tests and the existing browser tests**

Run: `pnpm --filter @onehuman/web typecheck && pnpm --filter @onehuman/web test`
Expected: PASS (the bundle test still finds only `@onehuman/schemas/plain` run-time imports).

With `pnpm dev` running: `pnpm --filter @onehuman/web exec playwright test lists`
Expected: PASS — part 1's list journey is unchanged.

- [ ] **Step 7: Commit**

```bash
git add master-ai-web
git commit -m "feat(web): follow-up switches on each list, and call notes the head applies or marks as seen

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Web routines for collections, outside parties in the phone simulator, and calling hours in Settings

**Files:**
- Create: `master-ai-web/src/lib/collect.ts`, `master-ai-web/src/components/pick-people.tsx`, `master-ai-web/src/components/collect-form.tsx`
- Modify: `master-ai-web/src/routes/routines.tsx` (templates, `ModeSentence`, `PersonCard`, the board's form), `master-ai-web/src/components/phone-simulator.tsx`, `master-ai-web/src/routes/settings.tsx` (calls card)
- Test: `master-ai-web/__tests__/unit/lib/collect.test.ts` (new)

**Interfaces:**
- Consumes: Task 4 `Routine.collect`, `CallRecord.contact/about`; Task 7 `RoutineTemplateInfo`, collect routines needing `staffIds`, entry values `{ items, differences }`; Task 1 `CallSettings.partyHours/followUpsPerDay`.
- Produces: `collectDefaults(defaults, entity, now?)`, `collectedText(routine, values)`; `<PickPeople />`, `<CollectForm />`. Accessible names the browser test uses: the template's "Switch it on" button, the dialog "Who does the AI call?" with a checkbox per person, the board's "Fill in" / "Add today's …" dialog, Settings' "Outside calls from" / "Outside calls until" time inputs and "Follow-up calls a day".

- [ ] **Step 1: Write the failing unit test**

Create `master-ai-web/__tests__/unit/lib/collect.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityDef, Routine } from '@onehuman/schemas';
import { collectDefaults, collectedText } from '../../../src/lib/collect';

const Bill: EntityDef = {
  name: 'Bill',
  label: 'Bill',
  fields: [
    { name: 'billDate', label: 'Bill date', type: 'date', required: false },
    { name: 'raisedAt', label: 'Raised at', type: 'datetime', required: false },
    { name: 'paymentStatus', label: 'Payment', type: 'enum', options: ['unpaid', 'paid'], required: false },
  ],
};

describe('collection routines in the app', () => {
  it("fills a routine's defaults: today in India, now, or the fixed value", () => {
    const now = new Date('2026-10-15T20:00:00Z'); // already the 16th in India
    expect(collectDefaults({ billDate: 'today', raisedAt: 'now', paymentStatus: 'unpaid' }, Bill, now)).toEqual({
      billDate: '2026-10-16',
      raisedAt: '2026-10-15T20:00:00.000Z',
      paymentStatus: 'unpaid',
    });
  });

  it('says what a day of collecting added', () => {
    const routine = { collect: { listLabel: 'Bills', itemLabel: 'bill' } } as Routine;
    expect(collectedText(routine, { items: 1, differences: 0 })).toBe('1 bill added');
    expect(collectedText(routine, { items: 3, differences: 2 })).toBe('3 bills added · 2 differences noted');
    expect(collectedText(routine, {})).toBe('No bills added');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @onehuman/web exec vitest run __tests__/unit/lib/collect.test.ts`
Expected: FAIL — `../../../src/lib/collect` does not exist.

- [ ] **Step 3: The helpers**

Create `master-ai-web/src/lib/collect.ts`:

```ts
import type { CheckinValue, EntityDef, Routine } from '@onehuman/schemas';

/** A routine's defaults as values: `today` is today's date in India, `now` the moment, anything else as given. */
export function collectDefaults(defaults: Record<string, string | number | boolean>, entity: EntityDef, now: Date = new Date()): Record<string, unknown> {
  const today = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  return Object.fromEntries(
    Object.entries(defaults).map(([name, v]) => {
      const f = entity.fields.find((x) => x.name === name);
      if (v === 'today' && f?.type === 'date') return [name, today];
      if (v === 'now' && f?.type === 'datetime') return [name, now.toISOString()];
      return [name, v];
    }),
  );
}

/** "3 bills added · 1 difference noted". */
export function collectedText(routine: Pick<Routine, 'collect'>, values: Record<string, CheckinValue>): string {
  const c = routine.collect!;
  const plural = c.listLabel.toLowerCase();
  const items = Number(values.items ?? 0);
  const differences = Number(values.differences ?? 0);
  const added = items === 0 ? `No ${plural} added` : `${items} ${items === 1 ? c.itemLabel : plural} added`;
  return differences ? `${added} · ${differences} difference${differences === 1 ? '' : 's'} noted` : added;
}
```

Run the test again: PASS.

- [ ] **Step 4: Picking people, and adding today's items by hand**

Create `master-ai-web/src/components/pick-people.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';

/** Who the AI calls for a routine that collects items: the people who keep that list. */
export function PickPeople({ open, who, pending, error, onClose, onPick }: { open: boolean; who: string | null; pending: boolean; error: unknown; onClose: () => void; onPick: (ids: string[]) => void }) {
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.list, enabled: open });
  const [ids, setIds] = useState<string[]>([]);
  const active = (team.data ?? []).filter((p) => p.status === 'active');
  return (
    <Dialog open={open} onClose={onClose} title="Who does the AI call?" lead={who ? `Pick ${who}. The AI calls them at the routine's time and adds what they read out.` : 'Pick who the AI calls.'}>
      {team.isLoading && <Spinner />}
      <fieldset className="space-y-2">
        <legend className="sr-only">People</legend>
        {active.map((p) => (
          <label key={p.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))}
              className="size-4 accent-[var(--oh-primary)]"
            />
            <span className="text-fg">{p.name}</span>
            <span className="text-fg-muted">{p.title}</span>
          </label>
        ))}
      </fieldset>
      <ErrorNote error={error} className="mt-3" />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!ids.length} loading={pending} onClick={() => onPick(ids)}>
          <Play /> Switch it on
        </Button>
      </div>
    </Dialog>
  );
}
```

Create `master-ai-web/src/components/collect-form.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Routine } from '@onehuman/schemas';
import { RecordForm } from '@/components/record-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { collectDefaults } from '@/lib/collect';

/** Adding today's items by hand: the list's own form, only the routine's fields, its defaults filled in. Done records how many were added. */
export function CollectForm({ routine, staffId, open, onClose }: { routine: Routine; staffId: string | null; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const collect = routine.collect!;
  const overview = useQuery({ queryKey: ['lists'], queryFn: api.lists.overview, enabled: open });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list, enabled: open });
  const [added, setAdded] = useState(0);
  const [round, setRound] = useState(0);
  const list = overview.data?.lists.find((l) => l.id === collect.list);
  const form = list && { ...list.entity, fields: list.entity.fields.filter((f) => collect.ask.includes(f.name) && !(f.name in collect.defaults)) };
  const add = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.records.create(collect.entity, { ...collectDefaults(collect.defaults, list!.entity), ...data }),
    onSuccess: () => {
      setAdded((n) => n + 1);
      setRound((n) => n + 1);
    },
  });
  const finish = useMutation({
    mutationFn: () => api.routines.submit(routine.id, { staffId: staffId ?? routine.people[0]!.id, values: { items: added } }),
    onSuccess: () => {
      for (const key of ['routine', 'routines', 'lists', 'list']) void queryClient.invalidateQueries({ queryKey: [key] });
      setAdded(0);
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Add today's ${collect.listLabel.toLowerCase()}`} lead={added ? `${added} added so far.` : `Each one goes to ${collect.listLabel}.`}>
      {!form && <Spinner />}
      {form && (
        <RecordForm
          key={round}
          entity={form}
          entities={workspaces.data?.[0]?.pack.entities ?? []}
          submitLabel={`Add ${collect.itemLabel}`}
          pending={add.isPending}
          error={add.error}
          onSubmit={(data) => add.mutate(data)}
          onCancel={onClose}
        />
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="success" loading={finish.isPending} onClick={() => finish.mutate()}>
          Done, {added} added
        </Button>
      </div>
      <ErrorNote error={finish.error} />
    </Dialog>
  );
}
```

- [ ] **Step 5: Collection routines on the Routines pages**

In `master-ai-web/src/routes/routines.tsx`:

Imports: `RoutineTemplateInfo` (type), `CollectForm`, `PickPeople`, `collectedText`.

`ModeSentence` — a collection says where the items go:

```tsx
function ModeSentence({ routine }: { routine: Routine }) {
  const n = routine.people.length;
  const who = routine.collect && n === 1 ? routine.people[0]!.name : `${n} ${n === 1 ? 'person' : 'people'}`;
  const what = routine.collect ? `adds the day's ${routine.collect.listLabel.toLowerCase()} to ${routine.collect.listLabel}` : 'fills it in from what they say';
  return routine.mode === 'automatic' ? (
    <p className="text-sm text-fg-muted">
      <Phone className="mr-1 inline size-3.5 text-primary" aria-hidden />
      The AI phones {who} at <span className="font-medium text-fg">{time12(routine.time)}</span>, {daysText(routine.days)}, and {what}.
    </p>
  ) : (
    <p className="text-sm text-fg-muted">
      <PencilLine className="mr-1 inline size-3.5 text-accent" aria-hidden />
      {who} {routine.collect ? `add the day's ${routine.collect.listLabel.toLowerCase()} here` : 'fill it in here'} by <span className="font-medium text-fg">{time12(routine.time)}</span>, {daysText(routine.days)}.
      {routine.chaseMissing ? ' Anyone who hasn’t gets a call from the AI.' : ' Nobody is called.'}
    </p>
  );
}
```

In `RoutinesPage`: the create mutation takes `{ templateId: string; staffIds?: string[] }` (`mutationFn: (input) => api.routines.create(input)`, `loading={create.isPending && create.variables?.templateId === t.id}`), add `const [picking, setPicking] = useState<RoutineTemplateInfo | null>(null);`, and in each template card replace the questions list with:

```tsx
                {t.collect ? (
                  <>
                    <p className="mt-3 text-xs text-fg-muted">
                      Adds to <span className="text-fg">{t.listLabel}</span>
                      {t.collect.who ? ` · calls ${t.collect.who}` : ''}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1">
                      {t.askLabels.map((l) => (
                        <li key={l} className="rounded-md bg-muted px-2 py-0.5 text-xs text-fg">
                          {l}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <ul className="mt-3 flex flex-wrap gap-1">{/* the existing question chips, unchanged */}</ul>
                )}
```

The card's button becomes `onClick={() => (t.collect ? setPicking(t) : create.mutate({ templateId: t.id }))}`, and at the end of the page:

```tsx
      <PickPeople
        open={!!picking}
        who={picking?.collect?.who ?? null}
        pending={create.isPending}
        error={create.error}
        onClose={() => setPicking(null)}
        onPick={(staffIds) => create.mutate({ templateId: picking!.id, staffIds })}
      />
```

(`create`'s `onSuccess` already navigates to the new routine; also `setPicking(null)` there.)

In `PersonCard`, show what a collection added instead of the question answers: wrap the existing `<dl>` block in `{!routine.collect && …}` and add before it:

```tsx
      {routine.collect && entry.status === 'reported' && (
        <p className="mt-3 text-sm text-fg">
          {collectedText(routine, entry.values)} ·{' '}
          <Link to={`/lists/${routine.collect.list}`} className="text-accent hover:underline">
            Open {routine.collect.listLabel}
          </Link>
        </p>
      )}
```

In `RoutineBoardPage`, render the right form for the routine:

```tsx
      {routine.collect ? (
        <CollectForm routine={routine} staffId={form?.staffId ?? null} open={!!form} onClose={() => setForm(null)} />
      ) : (
        <CheckinForm routine={routine} staffId={form?.staffId ?? null} initial={form?.values} open={!!form} onClose={() => setForm(null)} />
      )}
```

- [ ] **Step 6: Outside parties in the phone simulator**

In `master-ai-web/src/components/phone-simulator.tsx`, add `const asWho = (c: CallRecord) => (c.contact ? c.staffName : c.staffName.split(' ')[0]);` and use it wherever the simulator says "Answer as …" and "Reply as …". In the ringing card, after the `delegationTitle` line, add:

```tsx
          {call.contact && (
            <p className="mt-2 text-xs text-warning">
              A customer or supplier: answer as them. Nothing they say changes the item until you apply it.
            </p>
          )}
```

and in the in-call header, show what it is about under the stage: `{current.about && <p className="truncate text-xs text-fg-muted">About {current.about.title}</p>}`.

- [ ] **Step 7: Calling hours and the daily cap in Settings**

In `master-ai-web/src/routes/settings.tsx`, in the calls card before the attempts paragraph (`calls` is `tenant.data?.settings.calls`; `save.mutate` takes a partial calls object):

```tsx
        <fieldset className="space-y-2">
          <legend className="mb-1 font-medium text-fg">Calling customers and suppliers</legend>
          <p className="text-fg-muted">Follow-up calls to outside parties go out only on these days and hours, and never before 9 am or after 9 pm IST.</p>
          {calls && (
            <>
              <div role="group" aria-label="Days for outside calls" className="flex flex-wrap gap-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
                  const on = calls.partyHours.days.includes(i);
                  const days = on ? calls.partyHours.days.filter((x) => x !== i) : [...calls.partyHours.days, i].sort();
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      disabled={on && days.length === 0}
                      onClick={() => save.mutate({ partyHours: { ...calls.partyHours, days } })}
                      className={cn('rounded-full border px-3 py-1 text-sm', on ? 'border-primary bg-primary-soft text-primary' : 'border-border text-fg-muted hover:text-fg')}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2">
                  From
                  <Input type="time" aria-label="Outside calls from" defaultValue={calls.partyHours.start} onBlur={(e) => e.target.value && save.mutate({ partyHours: { ...calls.partyHours, start: e.target.value } })} className="w-auto" />
                </label>
                <label className="flex items-center gap-2">
                  to
                  <Input type="time" aria-label="Outside calls until" defaultValue={calls.partyHours.end} onBlur={(e) => e.target.value && save.mutate({ partyHours: { ...calls.partyHours, end: e.target.value } })} className="w-auto" />
                </label>
              </div>
            </>
          )}
        </fieldset>
        <label className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-fg">Follow-up calls a day, at most</span>
          <Input
            type="number"
            min={1}
            max={200}
            aria-label="Follow-up calls a day"
            defaultValue={calls?.followUpsPerDay ?? 30}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 200) save.mutate({ followUpsPerDay: n });
            }}
            className="w-24"
          />
        </label>
```

(Import `Input` from `@/components/ui/form` and `cn` from `@/lib/utils` if the file doesn't yet.)

- [ ] **Step 8: Typecheck and test**

Run: `pnpm --filter @onehuman/web typecheck && pnpm --filter @onehuman/web test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add master-ai-web
git commit -m "feat(web): switch on collection routines for chosen people, add today's items by hand, and set calling hours for outside parties

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Browser tests and the smoke run

**Files:**
- Create: `master-ai-web/__tests__/e2e/list-calls.spec.ts` (desktop only: the phone project matches `(layout|lists)\.spec`)
- Modify: `master-ai-backend/scripts/smoke.ts` (after step 4c)

**Interfaces:**
- Consumes: everything above, through the running app (`pnpm dev`: API, worker with Temporal, web).
- Produces: two browser journeys and two smoke steps.

- [ ] **Step 1: Write the browser tests**

Create `master-ai-web/__tests__/e2e/list-calls.spec.ts`:

```ts
import { expect, test, type Locator } from '@playwright/test';
import { newOrganization, signInAs } from './helpers';

/** India's date `n` days from today. */
const istDay = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

/** Says each reply in the simulator and waits for the AI line that should follow it. */
async function talk(call: Locator, turns: [reply: string, expectAfter: string][]) {
  for (const [reply, next] of turns) {
    await call.getByLabel('Your reply').fill(reply);
    await call.getByRole('button', { name: 'Send' }).click();
    await expect(call).toContainText(next, { timeout: 20_000 });
  }
}

test('a clerk reads out a bill on a simulated call and it lands on the Bills list', async ({ page }) => {
  test.setTimeout(120_000);
  const org = await newOrganization('wholesale-retail');
  const ravi = await org.api.team.add({ name: 'Ravi Kumar', phone: '+91 98470 61234', title: 'Billing clerk' });
  const routine = await org.api.routines.create({ templateId: 'todays-bills', staffIds: [ravi.id] });
  await signInAs(page, org);
  await page.goto(`/routines/${routine.id}`);
  await expect(page.getByText(/adds the day's bills to Bills/)).toBeVisible();
  await org.api.routines.run(routine.id);

  const ring = page.getByRole('dialog', { name: 'Incoming call' });
  await expect(ring).toContainText('Collecting items', { timeout: 30_000 });
  await ring.getByRole('button', { name: 'Answer' }).click();
  const call = page.getByRole('dialog', { name: 'Call with Ravi Kumar' });
  await expect(call).toContainText("calling for today's bills");
  await talk(call, [
    ['One', '1, got it.'],
    ['E2E-C1', "What's the type:"],
    ['sales invoice', 'Which party?'],
    ['Nobody Known', "I'll note Nobody Known as you said it."],
    ['48,260', "What's the GST amount?"],
    ['7,360', "What's the due date?"],
    ['skip', 'Is that right?'],
    ['yes', 'Any more bills?'],
    ["No, that's all", "I've added 1 bill"],
  ]);

  await page.goto('/lists');
  await page.getByRole('link', { name: /^Bills/ }).click();
  await page.getByLabel('Search this list').fill('E2E-C1');
  await page.getByRole('row', { name: /E2E-C1/ }).click();
  const panel = page.getByRole('dialog', { name: 'E2E-C1' });
  await expect(panel).toContainText('Came in: Call with Ravi Kumar');
  await expect(panel).toContainText('Not checked');
});

test('the owner switches on a follow-up, a party says it is paid on a simulated call, and the head applies it', async ({ page }) => {
  test.setTimeout(120_000);
  const org = await newOrganization('wholesale-retail');
  await org.api.lists.removeSamples();
  const party = await org.api.lists.create('parties', { name: 'E2E Party Traders', partyType: 'retailer', phone: '+91 98470 71234' });
  await org.api.lists.create('bills', { billNo: 'E2E-F1', billType: 'sales invoice', party: party.id, billDate: istDay(-10), dueDate: istDay(-3), total: 1000, paymentStatus: 'unpaid' });
  await signInAs(page, org);

  await page.goto('/lists/bills');
  const toggle = page.getByRole('switch', { name: 'Unpaid bills → the party' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/switched on by Asha Owner/)).toBeVisible();
  await page.getByRole('button', { name: 'Call now' }).click();

  const ring = page.getByRole('dialog', { name: 'Incoming call' });
  await expect(ring).toContainText('AI is calling E2E Party Traders', { timeout: 30_000 });
  await expect(ring).toContainText('A customer or supplier');
  await ring.getByRole('button', { name: 'Answer' }).click();
  const call = page.getByRole('dialog', { name: 'Call with E2E Party Traders' });
  await expect(call).toContainText('Am I speaking with someone from E2E Party Traders?');
  await expect(call).not.toContainText('E2E-F1: ');
  await talk(call, [
    ['Yes, speaking', 'Could you tell me when it will be paid?'],
    ["It's already paid", 'Do you have a payment reference'],
    ['UTR 445566', 'will check it. Goodbye.'],
  ]);

  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'New from calls' }).click();
  await page.getByRole('row', { name: /E2E-F1/ }).click();
  const panel = page.getByRole('dialog', { name: 'E2E-F1' });
  const notes = panel.getByRole('region', { name: 'From calls' });
  await expect(notes).toContainText("It's already paid. UTR 445566");
  await expect(notes).toContainText('Payment: paid');
  await notes.getByRole('button', { name: 'Apply' }).click();
  await expect(notes).toContainText('Applied by Asha Owner');
  await expect(panel).toContainText('Checked by Asha Owner');
});
```

- [ ] **Step 2: Run them against the running app**

Run (with `pnpm dev` running and `LLM_OFFLINE=always` in its shell): `pnpm --filter @onehuman/web exec playwright test list-calls`
Expected: PASS on the desktop project. If a step's expected line differs, read the call in the simulator: the engines' wording is pinned by their unit tests, so the browser test follows them.

- [ ] **Step 3: Extend the smoke run**

In `master-ai-backend/scripts/smoke.ts`, after the step 4c block (the travel company is in the simulator's auto mode), add:

```ts
  // 4d. Collection by phone: the simulated sales desk reads out new bookings, which land on the Bookings list from the call.
  const istDay = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
  const desk = (await api.team.list()).find((p) => p.status === 'active');
  if (!desk) throw new Error('the travel company has nobody on its team to call');
  const collect = await api.routines.create({ templateId: 'new-bookings', staffIds: [desk.id] });
  await api.routines.run(collect.id);
  const collected = await waitFor('collection call to finish', async () => {
    const d = await api.routines.day(collect.id);
    return d.entries[0]?.status === 'reported' && d;
  }, 120_000);
  const fromCalls = (await api.lists.page('bookings', { range: 'all', source: 'call' })).items;
  if (!fromCalls.length) throw new Error('the collection call added no bookings');
  log('Collection by phone', `${collect.name}: ${JSON.stringify(collected.entries[0]!.values)}, ${fromCalls.length} booking(s) came in from the call`);
  await api.routines.update(collect.id, { status: 'paused' });

  // 4e. A follow-up to a supplier: a held booking is due, the owner switches the follow-up on, the simulated supplier gives a date.
  const held = await api.lists.create('bookings', {
    customerName: 'Smoke Traveller',
    service: 'Munnar 3 nights',
    date: istDay(3),
    status: 'held',
    supplier: 'Hill View Resort',
    supplierPhone: '+91 98470 81234',
  });
  await api.followUps.switch('bookings.held-bookings', true);
  await api.followUps.run();
  const noted = await waitFor('follow-up call to leave a note', async () => {
    const d = await api.lists.item('bookings', held.id);
    return d.notes.length > 0 && d;
  }, 180_000);
  log('Follow-up by phone', `${noted.notes[0]!.speaker}: "${noted.notes[0]!.said}" (${noted.notes[0]!.kind})`);
  await api.followUps.switch('bookings.held-bookings', false);
```

- [ ] **Step 4: Run the smoke**

Run (with `pnpm dev` running offline): `pnpm smoke`
Expected: it ends with its usual success line, after "Collection by phone" and "Follow-up by phone" lines.

- [ ] **Step 5: Commit**

```bash
git add master-ai-web/__tests__/e2e/list-calls.spec.ts master-ai-backend/scripts/smoke.ts
git commit -m "test: a collection call and a follow-up end to end, in the browser and in the smoke run

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: ADR 0013 and the docs

**Files:**
- Create: `docs/adr/0013-calls-to-outside-parties.md`
- Modify: `docs/adr/README.md`, `CLAUDE.md`, `docs/production-readiness.md`, `docs/testing.md`, `docs/known-gaps.md`, `README.md`

**Interfaces:** none (docs).

- [ ] **Step 1: ADR 0013**

Create `docs/adr/0013-calls-to-outside-parties.md`:

```markdown
# 0013. Calls that fill lists, and calls to outside parties

Date: 2026-10-15 · Status: accepted

## Context
Part 1 gave the head each organization type's lists to recheck ([ADR 0012](0012-lists-and-checks.md)). Most items still had to be typed in, and nobody followed up the open ones. The owner wanted the AI to collect items by phone from the people who keep them, and to follow up open items with the team and, when the owner allows it, with customers and suppliers. Calling outside parties carries a different risk from calling one's own team: they are not the company's people, Indian rules limit when and how they may be called, and what they say may be wrong. Design: [sector lists](../superpowers/specs/2026-10-14-sector-lists-design.md), sections 4 and 5.

## Decision
- **Collection routines are routines.** A pack routine takes either `questions` or `collect` (a list, the fields to ask, defaults, a cap of items per call). It runs on the existing routine workflows; `RoutinesService` hands collection calls to `CollectionService`. Each item is read back and saved on a yes, with source `call` and not checked, so a dropped call keeps every confirmed item. An item that repeats one on the list is not saved again; different details become a note for the head.
- **Follow-ups are pack data on a list** (`follow_ups:`): who is called (a party, through a phone and a contact path, or a team member, matched by name), when an item is due (the same overdue or expiring rule as a check, compiled by the same SQL), what is read out and what may be found out. Every follow-up starts off.
- **Outside parties are the owner's decision.** Only the owner switches on a party follow-up, checked in the service. Party calls go out only inside the company's calling hours for customers and suppliers, inside 9:00–21:00 India time, and inside a follow-up's own window (RBI's 08:00–19:00 for lenders). Only the simulator's fast mode skips hours.
- **What a party says is never applied by itself.** It becomes a note on the item (as said, with what it proposes); the head applies it (through `RecordsService.update`, which checks the item) or dismisses it. "Don't call me again" and wrong numbers go on a do-not-call list that no follow-up calls. The AI never threatens, bargains or promises; a dispute only gets "someone will call you back".
- **A team member's answer is applied at once**, through `RecordsService.update` with `via: 'call'`, which clears the item's check so the head sees it again.
- **One follow-up call at a time per company, up to a daily cap**, from a half-hourly Temporal Schedule (`follow-ups-<tenant>`) that exists only while a follow-up is on. A call that is unanswered `max_tries` times stops the follow-up for that item with a note for the head.
- **Scripts decide, models only listen.** Both calls are scripts. With a model, the model reads each reply into a zod shape (one repair round); the script checks every value and decides every line and effect.
- **Calls have one owner.** `CallsService` hands each call to the service its link names: `follow_up` → `FollowUpCallsService`, `checkin_id` → `RoutinesService`, otherwise `DelegationService`.

## Consequences
- A new kind of call about list items is pack YAML plus, at most, new wording in an engine; `pack.test.ts` checks every path.
- Calls table rows may have no team member (`staff_id` null, `contact_phone` set); a check constraint requires one of them.
- The head's "New from calls" filter and the notes' Apply/Dismiss are the only way outside answers reach records, so a busy head can leave notes unread and follow-ups wait for them.
- Real outside calls need the number series and caller ID India requires for service calls before they go live (see [production readiness](../production-readiness.md)).
```

Add a row to `docs/adr/README.md`:

```markdown
| [0013](0013-calls-to-outside-parties.md) | Calls that fill lists, and calls to outside parties | Collection routines add items by phone; follow-ups on list items call staff or, if the owner allows, parties; what parties say is a note the head applies |
```

- [ ] **Step 2: CLAUDE.md rules**

In `CLAUDE.md` under "Rules that are easy to break", after the lists rule, add:

```markdown
- What an outside party says on a call is never applied without the head: party follow-ups only create `record_notes` (and do-not-call entries); `NotesService.apply` is the only path from a note to a record. Only the owner switches party follow-ups on (checked in `FollowUpsService`), and party calls stay inside `partyHours` ∩ 9:00–21:00 ∩ the follow-up's own `hours` ([ADR 0013](docs/adr/0013-calls-to-outside-parties.md)).
- Collection and follow-up calls are scripts (`CollectEngine`, `FollowUpEngine`); a model only reads a reply into a zod shape through `understandReply`, and the script decides. New call purposes plug into `CallsService` by the call's link (`follow_up`, `checkin_id`, delegation), not into the controllers.
```

and to "Commands", after the `pnpm test:integration` line:

```markdown
- Follow-ups: switch one on in a list's "Follow-up calls" panel (owner only for outside parties), then "Call now" runs the sweep at once; otherwise the `follow-ups-<tenant>` schedule runs every 30 minutes while any follow-up is on
```

- [ ] **Step 3: Production readiness, testing, known gaps, README**

In `docs/production-readiness.md`, under "Left: decisions before going live", add:

```markdown
7. **Calling outside parties for real.** Before party follow-ups use Twilio: get the number series TRAI requires for service and transactional calls (not a 10-digit personal series), register the caller ID with the operator, record consent where the sector needs it (lenders under RBI's fair practices code), and check the company's calling hours in Settings. The simulator never dials anyone.
```

In `docs/testing.md`, add rows to the integration table:

```markdown
| `calls-outside` | A call to an outside party lists with its contact and item; a call with nobody to call is refused |
| `notes` | Notes from calls show on the item, its card and New from calls; Apply sets the fields and checks the item; Seen; a waiting follow-up starts again; another company's notes stay hidden; items say which call they came from |
| `collection` | A collection call adds items from what a clerk reads out (source call, not checked), keeps confirmed items when the call drops, notes a difference instead of adding a repeat, counts items added by hand, and runs in the simulator's auto mode |
| `follow-ups` | Owner-only switches for parties and the schedule; picking due items one at a time and skipping do-not-call, not-yet-due, waiting and noted items; a missing phone or unknown team member stops with a note; hours, the daily cap and the kill switch; a promise, a paid answer the head applies, a wrong number, three unanswered calls, auto mode; a team member's answer updating the item |
```

and to the unit tests section: `spoken` (Indian amounts and dates), `collect-engine`, `follow-up-engine`, `hours`, `due-sql` and `targets`; and to the end-to-end section: `list-calls.spec.ts` (a collection call and a follow-up the head applies, desktop).

In `docs/known-gaps.md`, replace the "Part 2 … not built yet" line with a new section:

```markdown
## Sector lists, part 2 (the AI's calls)

- Calls about list items are in the web simulator and through Twilio; the phone app shows them in its call list but has no Lists tab yet.
- A follow-up reads one item per call. A party with five overdue bills gets five calls on different sweeps, not one call about all five.
- Team members are matched to an item by name (full name, or a first name only one person has); two people with the same first name need full names on the item.
- The offline scripts understand everyday English replies; Hindi and Malayalam replies need a model.
- A collection routine's defaults and asked fields come from the pack; the owner can't change which fields are asked yet.
- Types described in the owner's own words get no follow-ups or collection routines from the generator.
```

In `README.md`, in the lists section, add one paragraph:

```markdown
The AI can also fill and follow up the lists by phone: collection routines call the person who keeps a list (the billing clerk, the helpdesk lead) and take down the day's items one by one; follow-ups call the team about overdue items and update them, or — when the owner switches it on — call customers and suppliers inside calling hours and leave what they say as a note the head applies or dismisses. See [ADR 0013](docs/adr/0013-calls-to-outside-parties.md).
```

- [ ] **Step 4: Check the whole branch**

Run: `pnpm turbo run build typecheck test && pnpm test:integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md README.md
git commit -m "docs: ADR 0013 on calls that fill lists and calls to outside parties, with rules, tests and gaps

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

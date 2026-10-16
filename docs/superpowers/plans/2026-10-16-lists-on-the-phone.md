# Lists on the Phone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner and admins review and act on the company's lists from the phone (a Lists tab, a list, an item, notes from calls), with pushes for a party's answer that needs a decision.

**Architecture:**
- The web's list wording moves into `@onehuman/sdk` (`packages/sdk/src/lists.ts`), so the web and the phone say things the same way. The web re-exports it.
- The phone gets three native screens on the existing list API, and pure helpers in `master-ai-mobile/src/lib/lists.ts` that the screens use and the unit tests cover.
- The backend sends one push after a party's settled, dispute or wrong-number answer is committed, from `FollowUpCallsService.conclude`. A new tap handler opens the item.

**Tech Stack:** TypeScript; Expo Router 57 and React Native 0.86; TanStack Query 5; NestJS with Drizzle; Vitest 5; Maestro 2.10.0.

**Spec:** [docs/superpowers/specs/2026-10-16-lists-on-the-phone-design.md](../specs/2026-10-16-lists-on-the-phone-design.md)

## Global Constraints

- **Who sees lists.** Only the owner and admins (`role` `owner` or `admin`) see the Lists tab. Everyone else gets `href: null`, and the server refuses them anyway.
- **What the phone does.** Browse, filter, search, mark checked (one or many), "Mark checked anyway" with a note, and Apply / Dismiss / Seen / Call again. Nothing else: adding and editing items, follow-up switches, "Call now", totals by field and the CSV stay on the web.
- **Words, not ids.** Owners never see ids, keys or JSON: reference titles, labels and `recordCell` text only. A push names the item by its title and the contact by name.
- **Pushes.** Only for a party's settled, dispute or wrong-number answer. They go through `NotificationsService.pushToManagers`, after the transaction commits, with data `{ listId, itemId }`.
- **No signal.**
  - Lists aren't stored offline, and nothing is queued.
  - The screen shows "No signal. Showing what was loaded at {time}."
  - Mark checked, Select, Apply, Dismiss, Seen and Call again are disabled, with the line "Needs a connection".
- **The phone's own rules** (from `CLAUDE.md`):
  - always dark (`src/lib/theme.ts`);
  - weights are font families through `T weight=…`, never `fontWeight`;
  - no hex or named colours (`__tests__/unit/tokens.test.ts`);
  - shared UI comes from `src/components/ui.tsx`;
  - `expo-notifications` is only `require`d lazily, never imported at the top of a module;
  - new routes need Metro to regenerate `.expo/types/router.d.ts` before the typecheck.
- **The web's rules.** Run-time values come only from `@onehuman/schemas/plain`, and types from the root with `import type`; the sdk is held to the same rule (`master-ai-web/__tests__/unit/bundle.test.ts`). Use token colour classes only.
- **Tests.** One `__tests__/` folder per package or app, never next to the code.
- **Rules kept.** Only people mark items checked, and only the head applies a party's words (ADR 0012, ADR 0013).
- **Commits.**
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
  - The work goes on branch `phone-lists`.
- **Builds.** Shared packages are consumed from `dist/`. Run `pnpm build:packages` after changing `packages/*`.

## Decisions this plan makes beyond the spec

The spec was written before the code was read line by line. These choices follow the code, and the spec is corrected to match in the same commit as this plan:
1. **`checkMany`'s `skipped` means items with open problems**, not items already checked. Already-checked items count as checked. So the result line reads "3 marked checked. 1 has problems: open it to check it with a note."
2. **A note is required when checking with open problems.** The server refuses an empty one ("This item has problems. Add a note saying why it is right as it is."). Without open problems there is no note box, and a checked item with nothing open shows no check button.
3. **An accepted problem reads "(seen)"**, as on the web and in the CSV.
4. **The settled push names what was settled.** It uses the proposed value when it is one of paid, received, delivered, approved, confirmed, done or completed ("… is paid", "… is delivered"); otherwise it says "… is settled".
5. **The wrong-number push says where to fix the number.** Editing stays on the web, so the body reads: "The number called about {item} isn't theirs. Correct it on the web, then tap Call again on the note."
6. **The tap handler also opens `{ approvalId }` pushes** on the decision screen. It is the app's most common push, and the route exists.
7. **`itemCell` is new in the SDK.** It is a reference shown by its title, anything else through `recordCell`. The web's list table and item panel use it instead of their copy of the same ternary.
8. **The tests move with the code.** The web's tests for the moved helpers move into `packages/sdk/__tests__/lists.test.ts`. The web keeps its web-only tests and one check that its re-exports are the SDK's own functions.
9. **The SDK depends on `@onehuman/ui`** (`workspace:*`, no new outside package), for `formatInr`.

## Review Focus

1. **A long answer from a party.** A paragraph in the push body is clipped to 120 characters with "…", so the phone shows a whole line. The test is in Task 2.
2. **A party with no contact name.** The push reads "Your contact says the bill is paid", never "there says" and never an id. The test is in Task 2.
3. **A reference whose item was removed.** A row's summary shows "a removed item", never the id it holds. The test is in Task 3.
4. **A bulk check that includes items with problems.** The result line says how many were left and why, not "already checked". The test is in Task 3.
5. **A push with data the app doesn't know.** An old push with only `{ routineId }`, a half-filled one, or wrong types just opens the app; it doesn't crash or open a broken screen. The test is in Task 7.

## File structure

| File | Responsibility |
|---|---|
| `packages/sdk/src/lists.ts` (new) | The list wording shared by web and phone: labels, `ListView`, `listParams`, `recordCell`, `itemCell`, `amountText`, `formatValue` |
| `master-ai-web/src/lib/lists.ts`, `record-cell.ts` | Re-export the shared wording; the web-only helpers (sort marks, CSV file) stay |
| `master-ai-backend/src/follow-ups/alerts.ts` (new) | `partyAlert`: the push for a party's answer, in words, or null |
| `master-ai-backend/src/follow-ups/follow-up-calls.service.ts` | Sends that push after `conclude` commits |
| `master-ai-mobile/src/lib/lists.ts` (new) | Pure phone helpers: who sees lists, the badge, card and row lines, buttons, result and no-signal lines |
| `master-ai-mobile/src/lib/use-lists.ts` (new) | React hooks: the overview query, the foreground refresh, "offline" |
| `master-ai-mobile/src/app/(tabs)/lists.tsx` (new) | The Lists tab |
| `master-ai-mobile/src/app/list/[id]/index.tsx` (new) | A list: search, Show and range pills, rows, Select and "Mark N checked" |
| `master-ai-mobile/src/app/list/[id]/[itemId].tsx` (new) | An item: fields, problems, check, notes from calls, history |
| `master-ai-mobile/src/lib/push-target.ts` (new) | Where a tapped push opens |
| `master-ai-mobile/src/lib/push.ts` | `openPushTaps`: the lazy tap listener |
| `master-ai-mobile/__tests__/e2e/seed.mts`, `flows/lists.yaml` | The Maestro journey |

---

### Task 1: The list wording moves into the SDK

**Files:**
- Create: `packages/sdk/src/lists.ts`
- Modify:
  - `packages/sdk/src/index.ts`
  - `packages/sdk/package.json`
  - `packages/sdk/__tests__/lists.test.ts`
- Modify (web):
  - `master-ai-web/src/lib/lists.ts`
  - `master-ai-web/src/lib/record-cell.ts`
  - `master-ai-web/src/lib/utils.ts:19-24`
  - `master-ai-web/src/routes/list.tsx:14-27,321`
  - `master-ai-web/src/components/list-item-panel.tsx:11-12,238`
  - `master-ai-web/__tests__/unit/lib/lists.test.ts`
- Delete: `master-ai-web/__tests__/unit/lib/record-cell.test.ts`. Its cases move to the SDK.

**Interfaces:**
- Consumes: nothing new.
- Produces (exported from `@onehuman/sdk`):
  - `RANGE_LABELS: Record<ListRange, string>`, `SHOW_LABELS: Record<ListShow | 'all', string>`, `SOURCE_LABELS: Record<ItemSourceKind, string>` and `NOTE_LABELS: Record<NoteKind, string>`;
  - `interface ListView`, `initialView(hasDate: boolean): ListView` and `listParams(v: ListView): ListQueryParams`;
  - `referenceText(v: unknown): string`, `followUpLine(f: FollowUpInfo): string` and `dayLabel(day: string): string`;
  - `formatValue(v: unknown): string` and `recordCell(field: EntityField | undefined, value: unknown, timeZone?: string): string`;
  - `itemCell(field: EntityField, item: Pick<ListItem, 'data' | 'titles'>, timeZone?: string): string`;
  - `amountText(field: EntityField | undefined, n: number): string`.

- [ ] **Step 1: Write the failing SDK tests**

In `packages/sdk/__tests__/lists.test.ts`, replace the first import line:

```ts
import { ApiError, createClient, listQuery } from '../src/index';
```

with:

```ts
import type { EntityField, ListItem } from '@onehuman/schemas';
import { amountText, ApiError, createClient, dayLabel, followUpLine, initialView, itemCell, listParams, listQuery, NOTE_LABELS, recordCell, referenceText } from '../src/index';
```

Then append to the end of the file:

```ts
const field = (type: EntityField['type'], name = 'f') => ({ name, label: 'F', type }) as EntityField;

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
});

describe('referenceText', () => {
  it('never shows an id', () => {
    expect(referenceText('0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11')).toBe('a removed item');
    expect(referenceText('Ganesh traders')).toBe('Ganesh traders');
    expect(referenceText(null)).toBe('—');
  });
});

describe('follow-ups and call notes in words', () => {
  const f = { key: 'bills.unpaid-bills', id: 'unpaid-bills', label: 'Unpaid bills → the party', who: 'party' as const, enabled: true, changedBy: 'Asha', changedAt: '2026-10-15T05:00:00Z', canSwitch: true, due: 3, waiting: 1, stopped: 0 };

  it('says what a follow-up is doing', () => {
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

describe('recordCell (a record value in words)', () => {
  it('writes money in rupees', () => {
    expect(recordCell(field('money'), 25000)).toBe('₹25,000');
  });

  it('writes dates and times the way people read them, never as raw ISO text', () => {
    expect(recordCell(field('date'), '2026-10-14')).toBe('14 Oct 2026');
    const at = recordCell(field('datetime'), '2026-10-14T04:30:00Z', 'Asia/Kolkata');
    expect(at).toMatch(/^14 Oct 2026, 10:00\s?am$/i);
    expect(at).not.toContain('T04:30');
  });

  it('says Yes or No, and a dash for nothing', () => {
    expect(recordCell(field('boolean'), true)).toBe('Yes');
    expect(recordCell(field('boolean'), false)).toBe('No');
    expect(recordCell(field('string'), '')).toBe('—');
    expect(recordCell(undefined, null)).toBe('—');
  });

  it('leaves text, enum values, numbers and anything it cannot read as a date as they are', () => {
    expect(recordCell(field('string'), 'Conveyor 3B')).toBe('Conveyor 3B');
    expect(recordCell(field('enum'), 'part-paid')).toBe('part-paid');
    expect(recordCell(field('integer'), 42)).toBe('42');
    expect(recordCell(field('date'), 'next Tuesday')).toBe('next Tuesday');
  });
});

describe('itemCell (a list item field in words)', () => {
  const item = (data: Record<string, unknown>, titles: Record<string, string> = {}): Pick<ListItem, 'data' | 'titles'> => ({ data, titles });

  it('shows a reference by the title of what it points at', () => {
    expect(itemCell(field('reference', 'party'), item({ party: '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11' }, { party: 'Sri Ganesh Traders' }))).toBe('Sri Ganesh Traders');
  });

  it('shows a reference with no title as typed, or as "a removed item", never as an id', () => {
    expect(itemCell(field('reference', 'party'), item({ party: '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11' }))).toBe('a removed item');
    expect(itemCell(field('reference', 'party'), item({ party: 'Nobody Known' }))).toBe('Nobody Known');
    expect(itemCell(field('reference', 'party'), item({}))).toBe('—');
  });

  it('reads every other field through recordCell', () => {
    expect(itemCell(field('money', 'total'), item({ total: 48260 }))).toBe('₹48,260');
  });
});

describe('amountText (a total in words)', () => {
  it('writes money in rupees and other numbers in Indian digit groups', () => {
    expect(amountText(field('money'), 1240000)).toBe('₹12,40,000');
    expect(amountText(field('integer'), 1240000)).toBe('12,40,000');
    expect(amountText(undefined, 5)).toBe('5');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @onehuman/sdk exec vitest run __tests__/lists.test.ts`
Expected: FAIL. The new names aren't exported yet: `recordCell is not a function`, or a missing-export error. The existing `listQuery` and `api.lists` tests still pass.

- [ ] **Step 3: Create `packages/sdk/src/lists.ts`**

```ts
import type { EntityField, FollowUpInfo, ItemSourceKind, ListItem, ListQueryParams, ListRange, ListShow, NoteKind } from '@onehuman/schemas';
import { formatInr } from '@onehuman/ui';

/*
 * How a list reads, the same on the web and the phone: the filters' names, a
 * page's query, and record values in words (rupees, dates, references by
 * title). Ids are never shown.
 */

export const RANGE_LABELS: Record<ListRange, string> = {
  today: 'Today',
  this_week: 'This week',
  this_month: 'This month',
  last_month: 'Last month',
  all: 'All time',
};
export const SHOW_LABELS: Record<ListShow | 'all', string> = { all: 'All', problems: 'Has problems', not_checked: 'Not checked', checked: 'Checked', new_notes: 'New from calls' };
export const SOURCE_LABELS: Record<ItemSourceKind, string> = { manual: 'By hand', call: 'Phone call', agent: 'AI agent', sample: 'Sample data' };
export const NOTE_LABELS: Record<NoteKind, string> = {
  said: 'Said on a call',
  promise: 'Promise',
  dispute: 'Dispute',
  wrong_number: 'Wrong number',
  difference: 'Different on a call',
  unreachable: "Couldn't call",
};

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reference with no title to show: the words as typed, or "a removed item" for an id (ids are never shown). */
export function referenceText(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  return typeof v === 'string' && UUID.test(v) ? 'a removed item' : String(v);
}

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

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A record value as a list shows it: rupees for money, dates and times in
 * words (never raw ISO text), Yes/No, and a dash for nothing.
 * `timeZone` is for tests; a screen uses the viewer's own.
 */
export function recordCell(field: EntityField | undefined, value: unknown, timeZone?: string): string {
  if (field?.type === 'money' && typeof value === 'number') return formatInr(value);
  if ((field?.type === 'date' || field?.type === 'datetime') && typeof value === 'string') {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return value;
    // A plain date is a calendar day: read it in UTC so no time zone moves it.
    if (field.type === 'date' || DATE.test(value)) {
      return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: DATE.test(value) ? 'UTC' : timeZone });
    }
    return at.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone });
  }
  return formatValue(value);
}

/** A list item's field in words: a reference by the title of what it points at, anything else through `recordCell`. */
export function itemCell(field: EntityField, item: Pick<ListItem, 'data' | 'titles'>, timeZone?: string): string {
  const value = item.data[field.name];
  return field.type === 'reference' ? (item.titles[field.name] ?? referenceText(value)) : recordCell(field, value, timeZone);
}

/** A total or a sum: rupees for money, Indian digit groups otherwise. */
export function amountText(field: EntityField | undefined, n: number): string {
  return field?.type === 'money' ? formatInr(n) : n.toLocaleString('en-IN');
}
```

In `packages/sdk/src/index.ts`, add after `export * from './labels';`:

```ts
export * from './lists';
```

In `packages/sdk/package.json`, add to `dependencies` (keep the keys sorted):

```json
    "@onehuman/ui": "workspace:*",
```

- [ ] **Step 4: Link, build and watch the SDK tests pass**

Run: `pnpm install && pnpm build:packages && pnpm --filter @onehuman/sdk exec vitest run __tests__/lists.test.ts`
Expected: PASS, every test in the file. Only a workspace link changes, so use `pnpm install --offline` if the registry can't be reached.

- [ ] **Step 5: Make the web re-export the shared wording**

Replace the whole of `master-ai-web/src/lib/record-cell.ts` with:

```ts
/** Record values in words, shared with the phone through @onehuman/sdk. */
export { itemCell, recordCell } from '@onehuman/sdk';
```

In `master-ai-web/src/lib/lists.ts`:
- Delete the definitions of `RANGE_LABELS`, `SHOW_LABELS`, `SOURCE_LABELS`, `ListView`, `initialView`, `listParams`, `UUID`, `referenceText`, `NOTE_LABELS`, `followUpLine` and `dayLabel`, and the type import on line 1.
- Keep `nextSort`, `sortMark`, `csvFileName`, `withBom` and `saveText` unchanged.
- Put this at the top of the file:

```ts
/**
 * The list page's web-only helpers: sort marks and the CSV download. The wording
 * the phone shares (labels, the page's query, values in words) lives in @onehuman/sdk.
 */
export { dayLabel, followUpLine, initialView, listParams, NOTE_LABELS, RANGE_LABELS, referenceText, SHOW_LABELS, SOURCE_LABELS, type ListView } from '@onehuman/sdk';
```

In `master-ai-web/src/lib/utils.ts`, delete `formatValue`. Its only caller was the old `record-cell.ts`, and `routes/routines.tsx` has its own local `formatValue`. Check that nothing else imports it:

Run: `grep -rn "formatValue" master-ai-web/src | grep -v "routes/routines.tsx"`
Expected: no output.

In `master-ai-web/src/routes/list.tsx`:
- Remove `referenceText,` from the `@/lib/lists` import.
- Change `import { recordCell } from '@/lib/record-cell';` to `import { itemCell } from '@/lib/record-cell';`.
- Change line 321 from

```tsx
                      const text = c.type === 'reference' ? (item.titles[c.name] ?? referenceText(item.data[c.name])) : recordCell(c, item.data[c.name]);
```

to

```tsx
                      const text = itemCell(c, item);
```

In `master-ai-web/src/components/list-item-panel.tsx`:
- Delete `import { referenceText } from '@/lib/lists';`.
- Change `import { recordCell } from '@/lib/record-cell';` to `import { itemCell } from '@/lib/record-cell';`.
- Change line 238 from

```tsx
                      {f.type === 'reference' ? (d.item.titles[f.name] ?? referenceText(d.item.data[f.name])) : recordCell(f, d.item.data[f.name])}
```

to

```tsx
                      {itemCell(f, d.item)}
```

- [ ] **Step 6: Move the web's tests**

Delete `master-ai-web/__tests__/unit/lib/record-cell.test.ts`.

Replace `master-ai-web/__tests__/unit/lib/lists.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import * as sdk from '@onehuman/sdk';
import { csvFileName, dayLabel, followUpLine, initialView, listParams, NOTE_LABELS, nextSort, RANGE_LABELS, referenceText, SHOW_LABELS, SOURCE_LABELS, withBom } from '../../../src/lib/lists';
import { itemCell, recordCell } from '../../../src/lib/record-cell';

describe('the shared wording', () => {
  it("is the SDK's own, so the phone and the web say the same", () => {
    expect([recordCell, itemCell, listParams, initialView, referenceText, followUpLine, dayLabel]).toEqual([
      sdk.recordCell,
      sdk.itemCell,
      sdk.listParams,
      sdk.initialView,
      sdk.referenceText,
      sdk.followUpLine,
      sdk.dayLabel,
    ]);
    expect([NOTE_LABELS, RANGE_LABELS, SHOW_LABELS, SOURCE_LABELS]).toEqual([sdk.NOTE_LABELS, sdk.RANGE_LABELS, sdk.SHOW_LABELS, sdk.SOURCE_LABELS]);
  });
});

describe('sorting by a column', () => {
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
```

Note: `toEqual` on arrays of functions compares each element with `Object.is`, so a copy of a function with the same body fails. That is the point of the test.

- [ ] **Step 7: Run the web checks**

Run: `pnpm --filter @onehuman/web test && pnpm --filter @onehuman/web typecheck && pnpm --filter @onehuman/sdk typecheck`
Expected: PASS. This includes `bundle.test.ts`, which now also scans `packages/sdk/src/lists.ts` for run-time imports from the schemas root. It finds none.

- [ ] **Step 8: Prove the web lists didn't change**

This needs `LLM_OFFLINE=always pnpm dev` running on :5173 and :3000. Start it if it isn't running, and run only one `pnpm dev`.

Run: `pnpm --filter @onehuman/web exec playwright test lists list-calls list-selection --project=desktop`
Expected: PASS, every test.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk master-ai-web/src master-ai-web/__tests__/unit/lib pnpm-lock.yaml
git commit -m "refactor(sdk): list wording shared by web and phone — labels, page query, values in words, itemCell

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: A push when a party's answer needs the head

**Files:**
- Create:
  - `master-ai-backend/src/follow-ups/alerts.ts`
  - `master-ai-backend/__tests__/unit/follow-ups/alerts.test.ts`
- Modify:
  - `master-ai-backend/src/follow-ups/follow-up-calls.service.ts`: imports, the constructor, `conclude` at lines 244-260;
  - `master-ai-backend/__tests__/integration/follow-ups.spec.ts`: imports and a new `describe` at the end.

**Interfaces:**
- Consumes: `FollowUpResult` (`src/voice/follow-up-engine.ts`), `titleOf` (`@onehuman/agent-kit`), `lowerFirst` (`src/voice/spoken.ts`) and `NotificationsService.pushToManagers(tenantId, { title, body, data })`.
- Produces:
  - `partyAlert(result: FollowUpResult, about: { listId: string; itemId: string; entity: EntityDef; data: Record<string, unknown>; contactName: string | null }): PartyAlert | null`;
  - `interface PartyAlert { title: string; body: string; data: { listId: string; itemId: string } }`.
  - The phone (Task 7) reads the push data `{ listId, itemId }`.

- [ ] **Step 1: Write the failing unit test**

Create `master-ai-backend/__tests__/unit/follow-ups/alerts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityDef } from '@onehuman/schemas';
import { partyAlert } from '../../../src/follow-ups/alerts';

const Bill = {
  name: 'Bill',
  label: 'Bill',
  title_field: 'billNo',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'party', label: 'Party', type: 'reference', ref: 'Party', required: false },
  ],
} as EntityDef;
const PARTY = '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11';
const ITEM = '7f0c2a10-3b7e-4d5e-9c11-5a2b3c4d5e6f';
const about = (over: Partial<Parameters<typeof partyAlert>[1]> = {}) => ({
  listId: 'bills',
  itemId: ITEM,
  entity: Bill,
  data: { billNo: 'S-1042', party: PARTY } as Record<string, unknown>,
  contactName: 'Sri Ganesh Traders' as string | null,
  ...over,
});
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/i;

describe('the push for a party answer that needs the head', () => {
  it('says a bill is paid, in their words, and opens the item', () => {
    expect(partyAlert({ kind: 'settled', said: "It's already paid. UTR 445566", proposed: { paymentStatus: 'paid', paymentRef: '445566' } }, about())).toEqual({
      title: 'Sri Ganesh Traders says bill S-1042 is paid',
      body: '"It\'s already paid. UTR 445566" Tap to apply or dismiss.',
      data: { listId: 'bills', itemId: ITEM },
    });
  });

  it('names what was settled, or says settled when there is nothing to apply', () => {
    expect(partyAlert({ kind: 'settled', said: 'Goods reached', proposed: { status: 'delivered' } }, about())?.title).toBe('Sri Ganesh Traders says bill S-1042 is delivered');
    expect(partyAlert({ kind: 'settled', said: 'All cleared', proposed: {} }, about())).toMatchObject({ title: 'Sri Ganesh Traders says bill S-1042 is settled', body: '"All cleared"' });
  });

  it('says a dispute and a wrong number', () => {
    expect(partyAlert({ kind: 'dispute', said: 'The goods never came' }, about())).toMatchObject({ title: 'Sri Ganesh Traders disputes bill S-1042', body: '"The goods never came"' });
    expect(partyAlert({ kind: 'wrong_number', said: 'Wrong number' }, about())).toMatchObject({
      title: 'Wrong number for Sri Ganesh Traders',
      body: "The number called about bill S-1042 isn't theirs. Correct it on the web, then tap Call again on the note.",
    });
  });

  it('sends nothing for answers that need no decision', () => {
    expect(partyAlert({ kind: 'promise', said: 'Friday', promiseOn: '2026-10-16' }, about())).toBeNull();
    expect(partyAlert({ kind: 'do_not_call', said: "Don't call again" }, about())).toBeNull();
    expect(partyAlert({ kind: 'status', said: 'Done', patch: { status: 'done' } }, about())).toBeNull();
    expect(partyAlert({ kind: 'said', said: 'Call my brother' }, about())).toBeNull();
  });

  it('reads well without a contact name or an item title, and never shows an id', () => {
    const plain = about({ contactName: '  ', data: { party: PARTY } });
    const settled = partyAlert({ kind: 'settled', said: 'Paid', proposed: { paymentStatus: 'paid' } }, plain)!;
    expect(settled.title).toBe('Your contact says the bill is paid');
    expect(partyAlert({ kind: 'wrong_number', said: 'Wrong number' }, about({ contactName: null }))!.title).toBe('Wrong number for your contact');
    expect(`${settled.title} ${settled.body}`).not.toMatch(UUID);
  });

  it('keeps a long answer short enough for a phone', () => {
    const said = `It was paid ${'last week through the bank '.repeat(10)}`;
    const { body } = partyAlert({ kind: 'dispute', said }, about())!;
    expect(body.length).toBeLessThanOrEqual(122);
    expect(body).toMatch(/…"$/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/follow-ups/alerts.test.ts`
Expected: FAIL with `Cannot find module '../../../src/follow-ups/alerts'` or "Failed to load url".

- [ ] **Step 3: Write `master-ai-backend/src/follow-ups/alerts.ts`**

```ts
import { titleOf } from '@onehuman/agent-kit';
import type { EntityDef } from '@onehuman/schemas';
import type { FollowUpResult } from '../voice/follow-up-engine';
import { lowerFirst } from '../voice/spoken';

export interface PartyAlert {
  title: string;
  body: string;
  data: { listId: string; itemId: string };
}

/** Values that say what was settled: "… says bill S-1042 is paid". */
const SETTLED_WORDS = ['paid', 'received', 'delivered', 'approved', 'confirmed', 'done', 'completed'];
const QUOTE_MAX = 120;

/**
 * The push for what an outside party said that the head must decide on: it is
 * paid or settled, a dispute, or a wrong number. Null for anything else, which
 * shows only on the Lists badge. Words only: the item's title and the
 * contact's name, never an id.
 */
export function partyAlert(
  result: FollowUpResult,
  about: { listId: string; itemId: string; entity: EntityDef; data: Record<string, unknown>; contactName: string | null },
): PartyAlert | null {
  const named = about.contactName?.trim();
  const party = named || 'Your contact';
  const item = itemWords(about.entity, about.data);
  const data = { listId: about.listId, itemId: about.itemId };
  const quote = `"${clip(result.said)}"`;
  switch (result.kind) {
    case 'settled': {
      const word = Object.values(result.proposed).find((v): v is string => typeof v === 'string' && SETTLED_WORDS.includes(v.toLowerCase()));
      const canApply = Object.keys(result.proposed).length > 0;
      return { title: `${party} says ${item} is ${word?.toLowerCase() ?? 'settled'}`, body: canApply ? `${quote} Tap to apply or dismiss.` : quote, data };
    }
    case 'dispute':
      return { title: `${party} disputes ${item}`, body: quote, data };
    case 'wrong_number':
      return { title: `Wrong number for ${named || 'your contact'}`, body: `The number called about ${item} isn't theirs. Correct it on the web, then tap Call again on the note.`, data };
    default:
      return null;
  }
}

/** "bill S-1042", or "the bill" when it has no title. */
function itemWords(entity: EntityDef, data: Record<string, unknown>): string {
  const label = lowerFirst(entity.label);
  const title = titleOf(entity, data);
  return title === entity.label ? `the ${label}` : `${label} ${title}`;
}

function clip(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= QUOTE_MAX ? t : `${t.slice(0, QUOTE_MAX - 1).trimEnd()}…`;
}
```

- [ ] **Step 4: Run the unit test and watch it pass**

Run: `pnpm --filter @onehuman/backend exec vitest run __tests__/unit/follow-ups/alerts.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing integration test**

In `master-ai-backend/__tests__/integration/follow-ups.spec.ts`:
- Add `vi` to the vitest import: `import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';`.
- Add `import { NotificationsService } from '../../src/notifications/notifications.service';` beside the other `../../src/` imports.
- Append this `describe` at the end of the file:

```ts
describe('pushes for answers that need the head', () => {
  const calling = () => h.get(FollowUpCallsService);
  const phone = () => h.get(CallsService);
  type Sent = { tenantId: string; message: { title: string; body: string; data?: Record<string, unknown> }; committed: Promise<boolean> };
  let sent: Sent[] = [];
  const listPushes = () => sent.filter((s) => s.message.data && 'listId' in s.message.data);

  beforeAll(() => {
    vi.spyOn(h.get(NotificationsService), 'pushToManagers').mockImplementation(async (tenantId, message) => {
      const itemId = (message.data as { itemId?: string } | undefined)?.itemId;
      // Read on another connection at once: a push sent inside the transaction would find no note yet.
      const committed = itemId
        ? db()
            .tenant(tenantId, (tx) => tx.select().from(recordNotes).where(eq(recordNotes.recordId, itemId)))
            .then((rows) => rows.length > 0)
        : Promise.resolve(false);
      sent.push({ tenantId, message, committed });
    });
  });
  afterAll(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await drain();
    sent = [];
  });

  /** Picks the item's call, rings it in the simulator, says each reply and finishes the call. */
  async function talk(id: string, replies: string[]) {
    const next = (await followUps.pick(a.tenantId))!;
    const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, next.callId)));
    expect(c?.recordId).toBe(id);
    await calling().place(a.tenantId, next.callId);
    await phone().answer(a.tenantId, next.callId);
    for (const text of replies) await phone().reply(a.tenantId, next.callId, text);
    await calling().finish(a.tenantId, next.callId);
  }

  it('pushes once, after the note is saved, when a party says it is paid', async () => {
    const id = await bill('PU-1');
    await talk(id, ['Yes', "It's already paid", 'UTR 445566']);
    expect(listPushes()).toHaveLength(1);
    const [p] = listPushes();
    expect(p!.tenantId).toBe(a.tenantId);
    expect(p!.message).toEqual({ title: 'Kaveri Spec Traders says bill PU-1 is paid', body: '"It\'s already paid. UTR 445566" Tap to apply or dismiss.', data: { listId: 'bills', itemId: id } });
    expect(await p!.committed).toBe(true);
  });

  it('pushes a dispute in their words', async () => {
    const id = await bill('PU-2');
    await talk(id, ['Yes', 'The goods never came']);
    expect(listPushes().map((p) => p.message)).toEqual([{ title: 'Kaveri Spec Traders disputes bill PU-2', body: '"The goods never came"', data: { listId: 'bills', itemId: id } }]);
  });

  it('pushes a wrong number, saying where to correct it', async () => {
    const wrong = await add('Party', { name: 'Wrong Push Traders', partyType: 'retailer', phone: '+91 98470 44445' });
    const id = await bill('PU-3', { party: wrong });
    await talk(id, ['Wrong number']);
    expect(listPushes().map((p) => p.message)).toEqual([
      {
        title: 'Wrong number for Wrong Push Traders',
        body: "The number called about bill PU-3 isn't theirs. Correct it on the web, then tap Call again on the note.",
        data: { listId: 'bills', itemId: id },
      },
    ]);
  });

  it("doesn't push a promise, an unanswered call or a do-not-call request", async () => {
    const promised = await bill('PU-4');
    await talk(promised, ['Yes, speaking', 'We will pay it tomorrow']);
    await nextDay();
    const quiet = await add('Party', { name: 'Quiet Push Traders', partyType: 'retailer', phone: '+91 98470 44446' });
    const asked = await bill('PU-5', { party: quiet });
    await talk(asked, ['Yes', "Please don't call me again"]);
    await nextDay();
    const unanswered = await bill('PU-6');
    const next = (await followUps.pick(a.tenantId))!;
    const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, next.callId)));
    expect(c?.recordId).toBe(unanswered);
    await calling().place(a.tenantId, next.callId);
    await phone().decline(a.tenantId, next.callId);
    await calling().finish(a.tenantId, next.callId);
    expect(listPushes()).toEqual([]);
  });

  it("doesn't push a team member's status answer", async () => {
    const it4 = await newOrg(h, 'it-services');
    await h.get(ListsService).removeSamples(it4.session);
    await h.get(TeamService).create(it4.session, CreateStaffInputSchema.parse({ name: 'Anil Kumar', phone: '+91 98470 55557', title: 'Engineer' }));
    await followUps.switch({ ...it4.session, role: 'admin' }, 'tickets.overdue-tickets', true);
    await db().tenant(it4.tenantId, async (tx) => {
      const svc = h.get(RecordsService);
      const data = { ticketNo: 'T-PU', clientName: 'Acme', summary: 'Printer offline', assignedTo: 'Anil', status: 'assigned', dueBy: new Date(Date.now() - 86_400_000).toISOString() };
      await svc.create(tx, it4.tenantId, await svc.activeWorkspace(tx), 'Ticket', data, SYSTEM, { kind: 'agent' });
    });
    const next = (await followUps.pick(it4.tenantId))!;
    await calling().place(it4.tenantId, next.callId);
    await phone().answer(it4.tenantId, next.callId);
    await phone().reply(it4.tenantId, next.callId, "It's in progress, done by tomorrow 5 pm");
    await calling().finish(it4.tenantId, next.callId);
    expect(await phone().get(it4.tenantId, next.callId)).toMatchObject({ outcome: 'updated' });
    expect(listPushes()).toEqual([]);
  });
});
```

Run: `pnpm --filter @onehuman/backend exec vitest run -c vitest.integration.config.mts follow-ups`
Expected: FAIL. The three push tests fail, because `listPushes()` is `[]` and has length 0, not 1. The two "doesn't push" tests pass already. That is right: they guard against pushing too much, and nothing pushes yet.

- [ ] **Step 6: Send the push after `conclude` commits**

In `master-ai-backend/src/follow-ups/follow-up-calls.service.ts`, add the imports:

```ts
import { NotificationsService } from '../notifications/notifications.service';
import { partyAlert, type PartyAlert } from './alerts';
```

Add a constructor parameter after `private readonly followUps: FollowUpsService,`:

```ts
    private readonly notifications: NotificationsService,
```

`NotificationsModule` is `@Global()` and imported by `AppModule`, which both the API and the worker build. Nothing else needs wiring.

Replace the whole `conclude` method with:

```ts
  /** The call's words are in: write the call, and what it leaves on the item. A party's answer that needs the head is pushed once it is saved. */
  private async conclude(tenantId: string, callId: string, transcript: TranscriptLine[], state: FollowUpState, callBack: boolean, dropped = false) {
    const alert = await this.db.tenant(tenantId, async (tx): Promise<PartyAlert | null> => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
      if (!c || c.status === 'completed') return null;
      const loaded = await this.load(tx, c);
      const name = loaded?.ctx.name ?? c.contactName ?? 'They';
      const result = state.result;
      let { outcome, summary }: { outcome: CallOutcome; summary: string } = result && loaded ? outcomeOf(result, name, loaded) : callBack ? { outcome: 'call_back' as const, summary: `${name} asked to be called another time.` } : { outcome: 'unclear' as const, summary: dropped ? 'The call dropped before an answer.' : 'No answer about the item.' };
      // What the call leaves comes first: a refused update to the item is a note, and the call log says so.
      if (result && loaded && c.recordId && (await this.leave(tx, tenantId, c, loaded, result)) === 'refused') {
        outcome = 'noted';
        summary = `Noted what ${name.split(' ')[0]} said; it didn't fit the item, so it's left for you.`;
      }
      await tx.update(calls).set({ status: 'completed', endedAt: new Date(), transcript, outcome, summary, extracted: { ...c.extracted, followUp: state } }).where(eq(calls.id, callId));
      await this.audit.append(tx, tenantId, { type: 'call.completed', actor: SYSTEM, refId: callId, payload: { staffName: name, stage: 'chase', outcome, summary } });
      if (!result || !loaded || !c.recordId || loaded.f.who !== 'party') return null;
      return partyAlert(result, { listId: loaded.reg.id, itemId: c.recordId, entity: loaded.reg.entity, data: loaded.rec.data, contactName: c.contactName });
    });
    // After the commit, so the note is there when the head taps the push.
    if (alert) void this.notifications.pushToManagers(tenantId, alert);
  }
```

Only the return type, the early `return null`, the last two lines inside the transaction, and the push after it are new. The rest is the existing body, unchanged.

- [ ] **Step 7: Run the integration tests and watch them pass**

Run: `pnpm test:integration`
Expected: PASS, every spec, including the 5 new tests in `follow-ups.spec.ts`.

Run: `pnpm --filter @onehuman/backend typecheck && pnpm --filter @onehuman/backend test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add master-ai-backend/src/follow-ups master-ai-backend/__tests__/unit/follow-ups/alerts.test.ts master-ai-backend/__tests__/integration/follow-ups.spec.ts
git commit -m "feat(follow-ups): push the owner and admins when a party says it's paid, disputes it, or it's a wrong number

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The phone's list helpers

**Files:**
- Create:
  - `master-ai-mobile/src/lib/lists.ts`
  - `master-ai-mobile/__tests__/unit/lists.test.ts`

**Interfaces:**
- Consumes: `amountText` and `itemCell` from `@onehuman/sdk` (Task 1).
- Produces (consumed by Tasks 4–6):
  - `canSeeLists(role: HumanRole | null | undefined): boolean`;
  - `newNotesTotal(overview: ListsOverview | undefined): number`;
  - `cardCount(list: ListSummary): string`;
  - `cardMarks(list: ListSummary): string | null`;
  - `pageTotals(page: ListPage): string`;
  - `rowSummary(list: ListMeta, item: ListItem): string`;
  - `undatedLine(page: ListPage): string | null`;
  - `checkedLine(r: { checked: number; skipped: number }): string`;
  - `checkButton(item: ListItem): { label: 'Mark checked' | 'Mark checked anyway'; needsNote: boolean } | null`;
  - `type NoteAction = 'apply' | 'dismiss' | 'seen' | 'call-again'`, `NOTE_ACTION_LABELS: Record<NoteAction, string>` and `noteActions(note: ListNote): NoteAction[]`;
  - `noteState(note: ListNote): string`;
  - `historyWords(e: ListHistoryEntry): string`;
  - `noSignalLine(offline: boolean, loadedAt: number, timeZone?: string): string | null`;
  - `NEEDS_CONNECTION: string`.

This file must import nothing from React Native, Expo or `@/…`, so Vitest can run it in Node.

- [ ] **Step 1: Write the failing test**

Create `master-ai-mobile/__tests__/unit/lists.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EntityDef, ListItem, ListMeta, ListNote, ListPage, ListSummary } from '@onehuman/schemas';
import {
  canSeeLists,
  cardCount,
  cardMarks,
  checkButton,
  checkedLine,
  historyWords,
  newNotesTotal,
  noSignalLine,
  noteActions,
  noteState,
  pageTotals,
  rowSummary,
  undatedLine,
} from '../../src/lib/lists';

const entity = {
  name: 'Bill',
  label: 'Bill',
  title_field: 'billNo',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'party', label: 'Party', type: 'reference', ref: 'Party', required: false },
    { name: 'total', label: 'Total', type: 'money', required: false },
    { name: 'dueDate', label: 'Due date', type: 'date', required: false },
    { name: 'paymentStatus', label: 'Payment', type: 'enum', options: ['unpaid', 'paid'], required: false },
  ],
} as EntityDef;
const list: ListMeta = {
  id: 'bills',
  label: 'Bills',
  main: true,
  explicit: true,
  entity,
  columns: ['billNo', 'party', 'total', 'paymentStatus'],
  filters: [],
  dateField: 'dueDate',
  totals: ['total'],
  sort: { field: 'dueDate', dir: 'asc' },
};
const card = (over: Partial<ListSummary['card']> = {}): ListSummary => ({
  ...list,
  card: { count: 12, countLabel: 'this month', sum: 482600, sumField: 'total', sumLabel: 'to collect', problems: 0, notChecked: 0, newNotes: 0, ...over },
});
const PARTY = '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11';
const item = (over: Partial<ListItem> = {}): ListItem => ({
  id: 'i1',
  title: 'S-1042',
  data: { billNo: 'S-1042', party: PARTY, total: 48260, paymentStatus: 'unpaid' },
  titles: { party: 'Sri Ganesh Traders' },
  source: { kind: 'manual', label: 'By hand' },
  updated: { via: null, by: null, at: '2026-10-16T05:00:00Z' },
  problems: [],
  checked: null,
  newNotes: 0,
  createdAt: '2026-10-16T05:00:00Z',
  ...over,
});
const page = (over: Partial<ListPage> = {}): ListPage => ({ list, items: [], total: 48, totals: { total: 1240000 }, undated: 0, page: 1, pageSize: 50, ...over });
const note = (over: Partial<ListNote> = {}): ListNote => ({
  id: 'n1',
  kind: 'said',
  speaker: 'Sri Ganesh Traders',
  said: "It's already paid",
  proposed: [{ field: 'paymentStatus', label: 'Payment', value: 'paid' }],
  promiseOn: null,
  status: 'new',
  decidedBy: null,
  callId: 'c1',
  at: '2026-10-16T05:00:00Z',
  canCallAgain: false,
  ...over,
});

describe('who sees the Lists tab', () => {
  it('is the owner and admins only', () => {
    expect([canSeeLists('owner'), canSeeLists('admin'), canSeeLists('member'), canSeeLists(undefined), canSeeLists(null)]).toEqual([true, true, false, false, false]);
  });
});

describe('the Lists tab', () => {
  it('badges the new notes from calls over every list', () => {
    expect(newNotesTotal({ lists: [card({ newNotes: 2 }), card({ newNotes: 0 }), card({ newNotes: 1 })], samples: 0 })).toBe(3);
    expect(newNotesTotal(undefined)).toBe(0);
  });

  it("shows each card's count and sum in words", () => {
    expect(cardCount(card())).toBe('12 this month · ₹4,82,600 to collect');
    expect(cardCount(card({ sum: null, sumField: null, sumLabel: null, countLabel: 'in all' }))).toBe('12 in all');
  });

  it('marks only what needs looking at', () => {
    expect(cardMarks(card({ problems: 3, notChecked: 5, newNotes: 2 }))).toBe('3 with problems · 5 not checked · 2 new from calls');
    expect(cardMarks(card({ notChecked: 1 }))).toBe('1 not checked');
    expect(cardMarks(card())).toBeNull();
  });
});

describe('a list', () => {
  it("totals what matches, as the web's list footer does", () => {
    expect(pageTotals(page())).toBe('48 bills · Total ₹12,40,000');
    expect(pageTotals(page({ total: 1, totals: { total: 500 } }))).toBe('1 bill · Total ₹500');
  });

  it("sums up a row with the list's next two columns, in words", () => {
    expect(rowSummary(list, item())).toBe('Sri Ganesh Traders · ₹48,260');
  });

  it('never shows the id a reference holds, and leaves out empty values', () => {
    expect(rowSummary(list, item({ titles: {} }))).toBe('a removed item · ₹48,260');
    expect(rowSummary(list, item({ data: { billNo: 'S-1', total: 100 }, titles: {} }))).toBe('₹100');
  });

  it('says how many items a date range leaves out for want of a date', () => {
    expect(undatedLine(page({ undated: 2 }))).toBe("2 items have no due date and aren't shown.");
    expect(undatedLine(page({ undated: 1 }))).toBe("1 item has no due date and isn't shown.");
    expect(undatedLine(page())).toBeNull();
  });

  it('says what a bulk check did, and why items with problems were left', () => {
    expect(checkedLine({ checked: 4, skipped: 0 })).toBe('4 marked checked.');
    expect(checkedLine({ checked: 3, skipped: 1 })).toBe('3 marked checked. 1 has problems: open it to check it with a note.');
    expect(checkedLine({ checked: 0, skipped: 2 })).toBe('0 marked checked. 2 have problems: open each to check it with a note.');
  });
});

describe('an item', () => {
  it('asks for a note to check it while a problem is open, and offers nothing when it is checked already', () => {
    const open = [{ key: 'overdue', message: 'Overdue by 3 days', acknowledged: false }];
    expect(checkButton(item())).toEqual({ label: 'Mark checked', needsNote: false });
    expect(checkButton(item({ problems: open }))).toEqual({ label: 'Mark checked anyway', needsNote: true });
    expect(checkButton(item({ checked: { by: 'Asha Owner', at: '2026-10-16T05:00:00Z', note: null } }))).toBeNull();
    expect(checkButton(item({ problems: [{ ...open[0]!, acknowledged: true }], checked: { by: 'Asha Owner', at: '2026-10-16T05:00:00Z', note: 'Fine' } }))).toBeNull();
  });

  it("offers a note's buttons as the web does", () => {
    expect(noteActions(note())).toEqual(['apply', 'dismiss']);
    expect(noteActions(note({ proposed: [] }))).toEqual(['seen']);
    expect(noteActions(note({ kind: 'wrong_number', proposed: [], canCallAgain: true }))).toEqual(['seen', 'call-again']);
    expect(noteActions(note({ status: 'applied', decidedBy: 'Asha Owner' }))).toEqual([]);
    expect(noteActions(note({ status: 'dismissed', kind: 'unreachable', proposed: [], canCallAgain: true }))).toEqual(['call-again']);
  });

  it("says where a note stands", () => {
    expect(noteState(note())).toBe('New from a call');
    expect(noteState(note({ status: 'applied', decidedBy: 'Asha Owner' }))).toBe('Applied by Asha Owner');
    expect(noteState(note({ status: 'dismissed', decidedBy: null }))).toBe('Seen by someone');
  });

  it('tells its history in words', () => {
    const e = { at: '2026-10-16T05:00:00Z', who: 'Asha Owner', changes: [], note: null };
    expect([historyWords({ ...e, kind: 'created' }), historyWords({ ...e, kind: 'updated' }), historyWords({ ...e, kind: 'checked' })]).toEqual([
      'Asha Owner added it',
      'Asha Owner changed it',
      'Asha Owner checked it',
    ]);
  });
});

describe('no signal', () => {
  it('says what the screen shows and when it was loaded', () => {
    expect(noSignalLine(true, Date.UTC(2026, 9, 16, 5, 12), 'Asia/Kolkata')).toMatch(/^No signal\. Showing what was loaded at 10:42\s?am\.$/i);
    expect(noSignalLine(true, 0)).toBe('No signal. Pull down to try again once you are back online.');
    expect(noSignalLine(false, Date.UTC(2026, 9, 16, 5, 12))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onehuman/mobile exec vitest run __tests__/unit/lists.test.ts`
Expected: FAIL with `Failed to load url ../../src/lib/lists` (or "Cannot find module").

- [ ] **Step 3: Write `master-ai-mobile/src/lib/lists.ts`**

```ts
import type { HumanRole, ListHistoryEntry, ListItem, ListMeta, ListNote, ListPage, ListSummary, ListsOverview } from '@onehuman/schemas';
import { amountText, itemCell } from '@onehuman/sdk';

/*
 * The phone's lists in words: what the tab, a list and an item say. Pure, so
 * the unit tests run it in Node; the screens and hooks import it. The wording
 * the web shares comes from @onehuman/sdk.
 */

/** Shown beside the actions while there is no signal. */
export const NEEDS_CONNECTION = 'Needs a connection';

/** The Lists tab is for the owner and admins; the server refuses members anyway. */
export function canSeeLists(role: HumanRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** The tab's badge: notes from calls nobody has looked at yet, over every list. */
export function newNotesTotal(overview: ListsOverview | undefined): number {
  return (overview?.lists ?? []).reduce((n, l) => n + l.card.newNotes, 0);
}

/** A card's count and sum: "12 this month · ₹4,82,600 to collect". */
export function cardCount(list: ListSummary): string {
  const { count, countLabel, sum, sumField, sumLabel } = list.card;
  const parts = [`${count} ${countLabel}`];
  if (sum !== null) {
    const field = sumField ? list.entity.fields.find((f) => f.name === sumField) : undefined;
    parts.push(sumLabel ? `${amountText(field, sum)} ${sumLabel}` : amountText(field, sum));
  }
  return parts.join(' · ');
}

/** What needs looking at, leaving out what is zero: "3 with problems · 5 not checked · 2 new from calls". Null when nothing does. */
export function cardMarks(list: ListSummary): string | null {
  const { problems, notChecked, newNotes } = list.card;
  const parts: string[] = [];
  if (problems) parts.push(`${problems} with problems`);
  if (notChecked) parts.push(`${notChecked} not checked`);
  if (newNotes) parts.push(`${newNotes} new from calls`);
  return parts.length ? parts.join(' · ') : null;
}

/** What matches, under a list's heading: "48 bills · Total ₹12,40,000". */
export function pageTotals(page: ListPage): string {
  const { list, total, totals } = page;
  const parts = [`${total} ${total === 1 ? list.entity.label.toLowerCase() : list.label.toLowerCase()}`];
  for (const name of list.totals) {
    const field = list.entity.fields.find((f) => f.name === name);
    if (field) parts.push(`${field.label} ${amountText(field, totals[name] ?? 0)}`);
  }
  return parts.join(' · ');
}

/** The line under a row's title: the list's first two columns after the title, in words, leaving out empty ones. */
export function rowSummary(list: ListMeta, item: ListItem): string {
  const title = list.entity.title_field ?? list.entity.fields.find((f) => f.type === 'string')?.name;
  return list.columns
    .filter((name) => name !== title)
    .slice(0, 2)
    .flatMap((name) => list.entity.fields.filter((f) => f.name === name))
    .map((f) => itemCell(f, item))
    .filter((text) => text !== '—')
    .join(' · ');
}

/** Items a date range leaves out because they have no date. Null when there are none. */
export function undatedLine(page: ListPage): string | null {
  const n = page.undated;
  const field = page.list.dateField ? page.list.entity.fields.find((f) => f.name === page.list.dateField) : undefined;
  if (!n || !field) return null;
  return n === 1 ? `1 item has no ${field.label.toLowerCase()} and isn't shown.` : `${n} items have no ${field.label.toLowerCase()} and aren't shown.`;
}

/** After "Mark N checked". The server leaves items with open problems: those need a note, one at a time. */
export function checkedLine(r: { checked: number; skipped: number }): string {
  const done = `${r.checked} marked checked.`;
  if (!r.skipped) return done;
  return r.skipped === 1 ? `${done} 1 has problems: open it to check it with a note.` : `${done} ${r.skipped} have problems: open each to check it with a note.`;
}

/** The item's check button: "anyway", with a note, while a problem is open; none when it is checked with nothing open. */
export function checkButton(item: ListItem): { label: 'Mark checked' | 'Mark checked anyway'; needsNote: boolean } | null {
  if (item.problems.some((p) => !p.acknowledged)) return { label: 'Mark checked anyway', needsNote: true };
  return item.checked ? null : { label: 'Mark checked', needsNote: false };
}

export type NoteAction = 'apply' | 'dismiss' | 'seen' | 'call-again';
export const NOTE_ACTION_LABELS: Record<NoteAction, string> = { apply: 'Apply', dismiss: 'Dismiss', seen: 'Seen', 'call-again': 'Call again' };

/** A note's buttons, as on the web: Apply and Dismiss when it proposes changes, Seen when it doesn't, Call again where the server says it works. */
export function noteActions(note: ListNote): NoteAction[] {
  const out: NoteAction[] = [];
  if (note.status === 'new') out.push(...(note.proposed.length ? (['apply', 'dismiss'] as const) : (['seen'] as const)));
  if (note.canCallAgain) out.push('call-again');
  return out;
}

/** "New from a call", "Applied by Asha Owner" or "Seen by Asha Owner". */
export function noteState(note: ListNote): string {
  if (note.status === 'new') return 'New from a call';
  return `${note.status === 'applied' ? 'Applied' : 'Seen'} by ${note.decidedBy ?? 'someone'}`;
}

/** "Asha Owner checked it". */
export function historyWords(e: ListHistoryEntry): string {
  return `${e.who} ${e.kind === 'created' ? 'added it' : e.kind === 'checked' ? 'checked it' : 'changed it'}`;
}

/** While there is no signal: what the screen holds and when it was loaded. Null while online. `timeZone` is for tests. */
export function noSignalLine(offline: boolean, loadedAt: number, timeZone?: string): string | null {
  if (!offline) return null;
  if (!loadedAt) return 'No signal. Pull down to try again once you are back online.';
  return `No signal. Showing what was loaded at ${new Date(loadedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone })}.`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @onehuman/mobile exec vitest run __tests__/unit/lists.test.ts`
Expected: PASS (14 tests).

Run: `pnpm --filter @onehuman/mobile test && pnpm --filter @onehuman/mobile typecheck`
Expected: PASS. `tokens.test.ts` scans `src/` for hex colours and `fontWeight`, and this file has neither.

- [ ] **Step 5: Commit**

```bash
git add master-ai-mobile/src/lib/lists.ts master-ai-mobile/__tests__/unit/lists.test.ts
git commit -m "feat(mobile): list helpers in words — badge, cards, rows, check and note buttons, no-signal line

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The Lists tab, its badge and fresh data

**Files:**
- Create:
  - `master-ai-mobile/src/lib/use-lists.ts`
  - `master-ai-mobile/src/app/(tabs)/lists.tsx`
- Modify:
  - `master-ai-mobile/src/app/(tabs)/_layout.tsx`
  - `master-ai-mobile/src/lib/realtime.ts`
  - `master-ai-mobile/src/app/_layout.tsx`: `SignedInEffects`, and the two list routes in the `Stack`.

**Interfaces:**
- Consumes (Task 3): `canSeeLists`, `newNotesTotal`, `cardCount`, `cardMarks` and `noSignalLine`.
- Produces (consumed by Tasks 5–6):
  - `useListsOverview(): UseQueryResult<ListsOverview>`, with query key `['lists']`;
  - `refreshListsOnForeground(): () => void`;
  - `useOffline(...errors: unknown[]): boolean`;
  - the routes `/list/[id]` and `/list/[id]/[itemId]`, registered in the root stack (their files come in Tasks 5 and 6).

No unit test is added here. These are React hooks and screens, and their logic is in Task 3's tested helpers. The checks are the typecheck, the unit suite and Task 8's Maestro flow.

- [ ] **Step 1: Write `master-ai-mobile/src/lib/use-lists.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { useNetworkState } from 'expo-network';
import { AppState } from 'react-native';
import { api, isNetworkError, queryClient } from './api';
import { canSeeLists } from './lists';
import { useSession } from './session';

/** Every list with its card, for the owner and admins. The tab badge, the Lists tab and a list's heading share it. */
export function useListsOverview() {
  const role = useSession((s) => s.user?.role);
  return useQuery({ queryKey: ['lists'], queryFn: api.lists.overview, enabled: canSeeLists(role) });
}

/** Back from the background, the lists load again, so the badge is current. */
export function refreshListsOnForeground(): () => void {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void queryClient.invalidateQueries({ queryKey: ['lists'] });
  });
  return () => sub.remove();
}

/** No signal: the phone says it has no connection, or a load just failed for want of one. */
export function useOffline(...errors: unknown[]): boolean {
  const net = useNetworkState();
  return net.isConnected === false || errors.some(isNetworkError);
}
```

- [ ] **Step 2: Write the Lists tab, `master-ai-mobile/src/app/(tabs)/lists.tsx`**

```tsx
import { Link } from 'expo-router';
import { Pressable, RefreshControl } from 'react-native';
import type { ListSummary } from '@onehuman/schemas';
import { Badge, Card, Empty, H, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { cardCount, cardMarks, noSignalLine } from '@/lib/lists';
import { useListsOverview, useOffline } from '@/lib/use-lists';

function ListCard({ list }: { list: ListSummary }) {
  const marks = cardMarks(list);
  const needsYou = list.card.problems > 0 || list.card.newNotes > 0;
  return (
    <Link href={{ pathname: '/list/[id]', params: { id: list.id } }} asChild>
      <Pressable accessibilityRole="button" testID={`list-${list.id}`}>
        <Card tone={list.card.newNotes > 0 ? 'warm' : 'glass'}>
          <T weight="semibold">{list.label}</T>
          <T tone="lead" size="sm">
            {cardCount(list)}
          </T>
          {marks && (
            <T size="sm" tone={needsYou ? 'warning' : 'muted'}>
              {marks}
            </T>
          )}
        </Card>
      </Pressable>
    </Link>
  );
}

/** The owner's and admins' lists, main ones first, with what needs checking and what calls brought in. */
export default function ListsScreen() {
  const overview = useListsOverview();
  const offline = useOffline(overview.error);
  const lists = overview.data?.lists ?? [];
  const signal = noSignalLine(offline, overview.dataUpdatedAt);

  return (
    <Screen refreshControl={<RefreshControl refreshing={overview.isRefetching} onRefresh={() => overview.refetch()} />}>
      <H lead="Lists," title="to check what came in." />
      {signal && <Badge tone="warning" label={signal} />}
      {overview.error && !offline && <T tone="danger">{errorMessage(overview.error)}</T>}
      {(overview.data?.samples ?? 0) > 0 && (
        <T tone="muted" size="sm">
          Sample items are still in your lists. Remove them on the web when you're ready.
        </T>
      )}
      {overview.isSuccess && lists.length === 0 && <Empty title="No lists yet">Your organization type's lists appear here once it is set up.</Empty>}
      {lists
        .filter((l) => l.main)
        .map((l) => (
          <ListCard key={l.id} list={l} />
        ))}
      {lists.some((l) => !l.main) && (
        <T tone="muted" size="sm">
          Other lists
        </T>
      )}
      {lists
        .filter((l) => !l.main)
        .map((l) => (
          <ListCard key={l.id} list={l} />
        ))}
    </Screen>
  );
}
```

- [ ] **Step 3: Add the tab between Approvals and Calls**

In `master-ai-mobile/src/app/(tabs)/_layout.tsx`, add the imports:

```ts
import { canSeeLists, newNotesTotal } from '@/lib/lists';
import { useSession } from '@/lib/session';
import { useListsOverview } from '@/lib/use-lists';
```

Update the doc comment to `/** Cases, Approvals, Lists (owner and admins), Calls, Pulse, Settings. The app opens on the first tab; Approvals and Lists carry badges. */`.

Inside `TabsLayout`, after `const count = …`, add:

```ts
  const role = useSession((s) => s.user?.role);
  const newNotes = newNotesTotal(useListsOverview().data);
```

Then insert this screen between the `index` (Approvals) screen and the `calls` screen:

```tsx
      <Tabs.Screen
        name="lists"
        options={{
          title: 'Lists',
          href: canSeeLists(role) ? undefined : null,
          tabBarButtonTestID: 'tab-lists',
          tabBarBadge: newNotes > 0 ? newNotes : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} />,
        }}
      />
```

- [ ] **Step 4: Keep the lists fresh**

In `master-ai-mobile/src/lib/realtime.ts`, inside `onEvent`, add after the `case`/`approval` block:

```ts
        if (area === 'note' || area === 'record' || area === 'call') {
          for (const key of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [key] });
        }
```

In `master-ai-mobile/src/app/_layout.tsx`:
- Add `import { refreshListsOnForeground } from '@/lib/use-lists';`.
- Change `SignedInEffects`' effect to:

```tsx
  useEffect(() => {
    void registerForPush();
    const stopSync = startQueueSync();
    const stopRefresh = refreshListsOnForeground();
    return () => {
      stopSync();
      stopRefresh();
    };
  }, []);
```

- In the signed-in `Stack.Protected`, after the `approval/[id]` screen, register the list screens:

```tsx
          <Stack.Screen name="list/[id]/index" options={{ ...header, title: '' }} />
          <Stack.Screen name="list/[id]/[itemId]" options={{ ...header, title: '' }} />
```

- [ ] **Step 5: Add stub screens so the routes exist**

Create minimal screens; Tasks 5 and 6 replace them.

`master-ai-mobile/src/app/list/[id]/index.tsx`:

```tsx
import { Screen, T } from '@/components/ui';

/** A list. Replaced in the next task. */
export default function ListScreen() {
  return (
    <Screen underHeader>
      <T tone="muted">Loading…</T>
    </Screen>
  );
}
```

`master-ai-mobile/src/app/list/[id]/[itemId].tsx`:

```tsx
import { Screen, T } from '@/components/ui';

/** A list item. Replaced in Task 6. */
export default function ItemScreen() {
  return (
    <Screen underHeader>
      <T tone="muted">Loading…</T>
    </Screen>
  );
}
```

- [ ] **Step 6: Regenerate the typed routes and run the checks**

Expo Router writes `.expo/types/router.d.ts` only while Metro runs. Start Metro on a spare port in the background:

```bash
cd master-ai-mobile && CI=1 pnpm exec expo start --port 8083 > "${TMPDIR:-/tmp}/metro-types.log" 2>&1 &
```

Wait until `grep -c 'list/\[id\]' master-ai-mobile/.expo/types/router.d.ts` prints a number above 0 (usually 10–40 s). Then stop that Metro: `pkill -f 'expo start --port 8083'`.

Run: `pnpm --filter @onehuman/mobile typecheck && pnpm --filter @onehuman/mobile test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add master-ai-mobile/src
git commit -m "feat(mobile): a Lists tab for the owner and admins, badged with new notes from calls, kept fresh live and on return

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: A list on the phone

**Files:**
- Modify: `master-ai-mobile/src/app/list/[id]/index.tsx`. This replaces the stub.

**Interfaces:**
- Consumes:
  - from Task 1: `initialView`, `listParams`, `RANGE_LABELS`, `SHOW_LABELS` and `ListView`;
  - from Task 3: `pageTotals`, `rowSummary`, `undatedLine`, `checkedLine`, `noSignalLine` and `NEEDS_CONNECTION`;
  - from Task 4: `useListsOverview` and `useOffline`;
  - the API: `api.lists.page(id, ListQueryParams)` and `api.lists.checkMany(id, ids)`.
- Produces:
  - the route `/list/[id]`;
  - the testIDs `list-search`, `show-<all|problems|not_checked|checked|new_notes>`, `range-<…>`, `select`, `mark-checked` and `item-<title>`, used by Task 8's Maestro flow.

The test is the typecheck plus Task 8's Maestro flow. The screen's words come from Task 3's tested helpers.

- [ ] **Step 1: Write the screen**

```tsx
import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import type { ListItem, ListMeta, ListRange, ListShow } from '@onehuman/schemas';
import { initialView, listParams, RANGE_LABELS, SHOW_LABELS, type ListView } from '@onehuman/sdk';
import { Badge, Button, Card, Empty, Input, Pill, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { checkedLine, NEEDS_CONNECTION, noSignalLine, pageTotals, rowSummary, undatedLine } from '@/lib/lists';
import { space, useTheme } from '@/lib/theme';
import { useListsOverview, useOffline } from '@/lib/use-lists';

const SHOWS: (ListShow | 'all')[] = ['all', 'problems', 'not_checked', 'checked', 'new_notes'];
const RANGES: ListRange[] = ['today', 'this_week', 'this_month', 'last_month', 'all'];

function Row({ list, item, selecting, selected, onPress }: { list: ListMeta; item: ListItem; selecting: boolean; selected: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const open = item.problems.filter((p) => !p.acknowledged).length;
  const summary = rowSummary(list, item);
  return (
    <Pressable
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      onPress={onPress}
      testID={`item-${item.title}`}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
        {selecting && <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? c.accent : c.textMuted} />}
        <View style={{ flex: 1, gap: space.xs }}>
          <T weight="semibold" numberOfLines={2}>
            {item.title}
          </T>
          {summary ? (
            <T tone="lead" size="sm" numberOfLines={1}>
              {summary}
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {open > 0 && <Badge tone="warning" label={`⚠ ${open} ${open === 1 ? 'problem' : 'problems'}`} />}
            {item.checked && <Badge tone="success" label="✓ Checked" />}
            {item.newNotes > 0 && <Badge tone="accent" label="New from a call" />}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

/** One list: search, Show and range pills, the matching total, and rows to open or select and mark checked. */
export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const overview = useListsOverview();
  const meta = overview.data?.lists.find((l) => l.id === id);
  const [view, setView] = useState<ListView | null>(null);
  const v = view ?? initialView(!!meta?.dateField);
  const change = (patch: Partial<ListView>) => setView((cur) => ({ ...(cur ?? initialView(!!meta?.dateField)), ...patch, page: 1 }));
  const [q, setQ] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);

  // The search is sent once typing pauses.
  useEffect(() => {
    if (q.trim() === v.q.trim()) return;
    const t = setTimeout(() => change({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const key = JSON.stringify(listParams(v));
  const pages = useInfiniteQuery({
    queryKey: ['list', id, key],
    queryFn: ({ pageParam }) => api.lists.page(id, listParams({ ...v, page: pageParam })),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: !!meta,
  });
  // A selection belongs to what was on screen: a new view starts with none.
  useEffect(() => {
    setSelected(new Set());
    setResult(null);
  }, [key]);

  const check = useMutation({
    mutationFn: () => api.lists.checkMany(id, [...selected]),
    onSuccess: (r) => {
      setResult(checkedLine(r));
      setSelected(new Set());
      setSelecting(false);
      for (const k of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [k] });
    },
  });
  const offline = useOffline(pages.error, overview.error);

  if (!meta) {
    return (
      <Screen underHeader>
        {overview.isLoading ? (
          <T tone="muted">Loading…</T>
        ) : overview.error ? (
          <T tone="danger">{offline ? noSignalLine(true, overview.dataUpdatedAt) : errorMessage(overview.error)}</T>
        ) : (
          <Empty title="This list isn't here">It may belong to another kind of organization.</Empty>
        )}
      </Screen>
    );
  }

  const first = pages.data?.pages[0];
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const signal = noSignalLine(offline, pages.dataUpdatedAt);
  const undated = first ? undatedLine(first) : null;
  const toggle = (itemId: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      {first && <T tone="lead">{pageTotals(first)}</T>}
      {signal && <Badge tone="warning" label={signal} />}
      <Input testID="list-search" value={q} onChangeText={setQ} placeholder={`Search ${meta.label.toLowerCase()}`} accessibilityLabel={`Search ${meta.label.toLowerCase()}`} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {SHOWS.map((s) => (
          <Pill key={s} testID={`show-${s}`} label={SHOW_LABELS[s]} active={v.show === s} onPress={() => change({ show: s })} />
        ))}
      </View>
      {meta.dateField && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {RANGES.map((r) => (
            <Pill key={r} testID={`range-${r}`} label={RANGE_LABELS[r]} active={v.range === r} onPress={() => change({ range: r })} />
          ))}
        </View>
      )}
      {undated && (
        <Pressable accessibilityRole="button" onPress={() => change({ range: 'all' })}>
          <T tone="accent" size="sm">
            {undated} Show all time
          </T>
        </Pressable>
      )}
      {result && (
        <T tone="success" size="sm">
          {result}
        </T>
      )}
      {pages.error && !offline && <T tone="danger">{errorMessage(pages.error)}</T>}
      {items.length > 0 && (
        <Button
          testID="select"
          variant="secondary"
          title={selecting ? 'Cancel' : 'Select'}
          disabled={!selecting && offline}
          onPress={() => {
            setSelecting((s) => !s);
            setSelected(new Set());
          }}
        />
      )}
      {offline && (
        <T tone="muted" size="sm">
          {NEEDS_CONNECTION}
        </T>
      )}
    </View>
  );

  return (
    <Screen underHeader scroll={false}>
      <Stack.Screen options={{ title: meta.label }} />
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <Row
            list={first?.list ?? meta}
            item={item}
            selecting={selecting}
            selected={selected.has(item.id)}
            onPress={() => (selecting ? toggle(item.id) : router.push({ pathname: '/list/[id]/[itemId]', params: { id, itemId: item.id } }))}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        onEndReached={() => {
          if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={pages.isRefetching && !pages.isFetchingNextPage} onRefresh={() => pages.refetch()} />}
        ListEmptyComponent={
          pages.isLoading ? (
            <T tone="muted">Loading…</T>
          ) : (
            <Empty title={v.q ? `Nothing matches “${v.q}”` : 'Nothing here'}>Try another Show or range.</Empty>
          )
        }
        ListFooterComponent={pages.isFetchingNextPage ? <T tone="muted">Loading more…</T> : null}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: selecting ? 140 : space.xxl }}
      />
      {selecting && (
        <View style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, gap: space.xs }}>
          <Button
            testID="mark-checked"
            variant="success"
            title={`Mark ${selected.size} checked`}
            disabled={selected.size === 0 || offline}
            loading={check.isPending}
            onPress={() => check.mutate()}
          />
          {check.error && (
            <T tone="danger" size="sm">
              {errorMessage(check.error)}
            </T>
          )}
        </View>
      )}
    </Screen>
  );
}
```

Two details from the existing UI kit:
- `Card` already has `gap: space.sm`, so the checkbox and the text space themselves.
- `Screen scroll={false}` renders a padded `View`, and the `FlatList` fills it.

- [ ] **Step 2: Run the checks**

Run: `pnpm --filter @onehuman/mobile typecheck && pnpm --filter @onehuman/mobile test`
Expected: PASS. If the typecheck rejects the `'/list/[id]/[itemId]'` pathname, the typed routes are stale. Run Task 4 Step 6's Metro step again.

- [ ] **Step 3: Commit**

```bash
git add 'master-ai-mobile/src/app/list/[id]/index.tsx'
git commit -m "feat(mobile): a list on the phone — search, Show and range pills, totals, rows in words, Select and Mark N checked

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: An item on the phone

**Files:**
- Modify: `master-ai-mobile/src/app/list/[id]/[itemId].tsx`. This replaces the stub.

**Interfaces:**
- Consumes:
  - from Task 1: `itemCell`, `NOTE_LABELS` and `dayLabel`;
  - from `@onehuman/ui`: `timeAgo`;
  - from Task 3: `checkButton`, `noteActions`, `NOTE_ACTION_LABELS`, `noteState`, `historyWords`, `noSignalLine`, `NEEDS_CONNECTION` and `NoteAction`;
  - from Task 4: `useOffline`;
  - the API: `api.lists.item`, `api.lists.check`, `api.notes.apply`, `api.notes.dismiss` and `api.notes.callAgain`.
- Produces:
  - the route `/list/[id]/[itemId]`;
  - the testIDs `check`, `check-note`, `check-confirm` and `note-<apply|dismiss|seen|call-again>`;
  - the visible words "From calls", "Applied by …" and "Checked by …".

The test is the typecheck plus Task 8's Maestro flow (Apply, then "Applied by Asha Owner").

- [ ] **Step 1: Write the screen**

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, RefreshControl, View } from 'react-native';
import { dayLabel, itemCell, NOTE_LABELS } from '@onehuman/sdk';
import { timeAgo } from '@onehuman/ui';
import { Badge, Button, Card, H, Input, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { checkButton, historyWords, NEEDS_CONNECTION, NOTE_ACTION_LABELS, noteActions, noteState, noSignalLine, type NoteAction } from '@/lib/lists';
import { space } from '@/lib/theme';
import { useOffline } from '@/lib/use-lists';

/** One item: how it came in, its problems, the check, what calls said about it, its fields and its history. */
export default function ItemScreen() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId: string }>();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['list-item', id, itemId], queryFn: () => api.lists.item(id, itemId) });
  const offline = useOffline(detail.error);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const done = () => {
    setNoting(false);
    setNote('');
    for (const k of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [k] });
  };
  const check = useMutation({ mutationFn: () => api.lists.check(id, itemId, note.trim() ? { note: note.trim() } : {}), onSuccess: done });
  const act = useMutation({
    mutationFn: ({ noteId, action }: { noteId: string; action: NoteAction }) =>
      action === 'apply' ? api.notes.apply(noteId) : action === 'call-again' ? api.notes.callAgain(noteId) : api.notes.dismiss(noteId),
    onSuccess: done,
  });

  if (detail.isLoading) {
    return (
      <Screen underHeader>
        <T tone="muted">Loading…</T>
      </Screen>
    );
  }
  if (!detail.data) {
    return (
      <Screen underHeader>
        <T tone="danger">{offline ? noSignalLine(true, 0) : errorMessage(detail.error)}</T>
      </Screen>
    );
  }

  const { list, item, notes, history } = detail.data;
  const open = item.problems.filter((p) => !p.acknowledged);
  const seen = item.problems.filter((p) => p.acknowledged);
  const button = checkButton(item);
  const signal = noSignalLine(offline, detail.dataUpdatedAt);

  return (
    <Screen underHeader keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={detail.isRefetching} onRefresh={() => detail.refetch()} />}>
      <Stack.Screen options={{ title: list.entity.label }} />
      <H title={item.title} size="xl" />
      {signal && <Badge tone="warning" label={signal} />}
      <T tone="body" size="sm">
        Came in: {item.source.label}
      </T>
      {item.updated.via === 'call' && item.updated.by && (
        <T tone="muted" size="sm">
          Updated on a call with {item.updated.by}
        </T>
      )}
      {item.checked ? (
        <T tone="success" size="sm">
          Checked by {item.checked.by}, {timeAgo(item.checked.at)}
          {item.checked.note ? ` — “${item.checked.note}”` : ''}
        </T>
      ) : (
        <T tone="muted" size="sm">
          Not checked
        </T>
      )}

      {(open.length > 0 || seen.length > 0) && (
        <Card tone={open.length ? 'warm' : 'glass'}>
          {open.map((p) => (
            <View key={p.key} style={{ gap: space.xs }}>
              <T tone="warning">⚠ {p.message}</T>
              {p.relatedId && (
                <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/list/[id]/[itemId]', params: { id, itemId: p.relatedId! } })}>
                  <T tone="accent" size="sm">
                    Open the other one
                  </T>
                </Pressable>
              )}
            </View>
          ))}
          {seen.map((p) => (
            <T key={p.key} tone="muted" size="sm">
              {p.message} (seen)
            </T>
          ))}
        </Card>
      )}

      {button &&
        (noting ? (
          <Card>
            <T tone="lead" size="sm">
              Why is it right as it is?
            </T>
            <Input
              testID="check-note"
              multiline
              value={note}
              onChangeText={setNote}
              maxLength={500}
              accessibilityLabel="Why it is right as it is"
              style={{ minHeight: 72, textAlignVertical: 'top' }}
            />
            <Button testID="check-confirm" variant="success" title={button.label} disabled={!note.trim() || offline} loading={check.isPending} onPress={() => check.mutate()} />
            <Button
              variant="ghost"
              title="Cancel"
              onPress={() => {
                setNoting(false);
                setNote('');
              }}
            />
          </Card>
        ) : (
          <Button testID="check" variant="success" title={button.label} disabled={offline} loading={check.isPending} onPress={() => (button.needsNote ? setNoting(true) : check.mutate())} />
        ))}
      {offline && (
        <T tone="muted" size="sm">
          {NEEDS_CONNECTION}
        </T>
      )}
      {check.error && (
        <T tone="danger" size="sm">
          {errorMessage(check.error)}
        </T>
      )}

      {notes.length > 0 && (
        <View style={{ gap: space.sm }}>
          <T weight="semibold" accessibilityRole="header">
            From calls
          </T>
          {notes.map((n) => {
            const actions = noteActions(n);
            return (
              <Card key={n.id} tone={n.status === 'new' ? 'warm' : 'glass'}>
                <T tone="muted" size="xs">
                  {NOTE_LABELS[n.kind]} · {n.speaker} · {timeAgo(n.at)}
                </T>
                <T>“{n.said}”</T>
                {n.promiseOn && (
                  <T tone="body" size="sm">
                    Promised for {dayLabel(n.promiseOn)}
                  </T>
                )}
                {n.proposed.map((p) => (
                  <T key={p.field} tone="body" size="sm">
                    {p.label}: {p.value}
                  </T>
                ))}
                <T tone={n.status === 'new' ? 'warning' : 'muted'} size="sm">
                  {noteState(n)}
                </T>
                {actions.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {actions.map((a) => (
                      <Button
                        key={a}
                        testID={`note-${a}`}
                        title={NOTE_ACTION_LABELS[a]}
                        variant={a === 'apply' ? 'success' : 'secondary'}
                        disabled={offline || (act.isPending && act.variables?.noteId !== n.id)}
                        loading={act.isPending && act.variables?.noteId === n.id && act.variables.action === a}
                        onPress={() => act.mutate({ noteId: n.id, action: a })}
                      />
                    ))}
                  </View>
                )}
              </Card>
            );
          })}
          {act.error && (
            <T tone="danger" size="sm">
              {errorMessage(act.error)}
            </T>
          )}
        </View>
      )}

      <Card>
        {list.entity.fields.map((f) => (
          <View key={f.name} style={{ flexDirection: 'row', gap: space.md }}>
            <T tone="muted" size="sm" style={{ flex: 2 }}>
              {f.label}
            </T>
            <T size="sm" style={{ flex: 3 }}>
              {itemCell(f, item)}
            </T>
          </View>
        ))}
      </Card>

      {history.length > 0 && (
        <View style={{ gap: space.sm }}>
          <T weight="semibold" accessibilityRole="header">
            History
          </T>
          {history
            .slice(-10)
            .reverse()
            .map((e, i) => (
              <View key={`${e.at}-${i}`} style={{ gap: 2 }}>
                <T size="sm">
                  {historyWords(e)} <T tone="muted" size="sm">· {timeAgo(e.at)}</T>
                </T>
                {e.changes.map((ch) => (
                  <T key={ch.field} tone="muted" size="sm">
                    {ch.label}: {ch.from} → {ch.to}
                  </T>
                ))}
                {e.note && (
                  <T tone="muted" size="sm">
                    “{e.note}”
                  </T>
                )}
              </View>
            ))}
        </View>
      )}
    </Screen>
  );
}
```

The server returns history oldest first, so `slice(-10).reverse()` gives the last ten, newest first.

- [ ] **Step 2: Run the checks**

Run: `pnpm --filter @onehuman/mobile typecheck && pnpm --filter @onehuman/mobile test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add 'master-ai-mobile/src/app/list/[id]/[itemId].tsx'
git commit -m "feat(mobile): an item on the phone — problems, Mark checked (anyway, with a note), notes from calls with Apply/Dismiss/Seen/Call again, history

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Tapping a push opens what it is about

**Files:**
- Create:
  - `master-ai-mobile/src/lib/push-target.ts`
  - `master-ai-mobile/__tests__/unit/push-target.test.ts`
- Modify:
  - `master-ai-mobile/src/lib/push.ts`
  - `master-ai-mobile/src/app/_layout.tsx` (`SignedInEffects`)

**Interfaces:**
- Consumes:
  - the push data `{ listId, itemId }` (Task 2), plus the existing `{ caseId }` and `{ approvalId }`;
  - the routes `/list/[id]/[itemId]`, `/case/[id]` and `/approval/[id]`.
- Produces:
  - `pushTarget(data: unknown): Href | null`;
  - `openPushTaps(open: (href: Href) => void): () => void`.

- [ ] **Step 1: Write the failing test**

Create `master-ai-mobile/__tests__/unit/push-target.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pushTarget } from '../../src/lib/push-target';

describe('tapping a push', () => {
  it('opens the list item a party answered about', () => {
    expect(pushTarget({ listId: 'bills', itemId: 'item-1' })).toEqual({ pathname: '/list/[id]/[itemId]', params: { id: 'bills', itemId: 'item-1' } });
  });

  it('opens the case, or the decision', () => {
    expect(pushTarget({ caseId: 'case-1' })).toEqual({ pathname: '/case/[id]', params: { id: 'case-1' } });
    expect(pushTarget({ approvalId: 'approval-1' })).toEqual({ pathname: '/approval/[id]', params: { id: 'approval-1' } });
  });

  it('just opens the app for anything else', () => {
    for (const data of [undefined, null, 'bills', 7, {}, { routineId: 'r1' }, { listId: 'bills' }, { listId: 7, itemId: 'item-1' }, { caseId: '' }]) {
      expect(pushTarget(data)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onehuman/mobile exec vitest run __tests__/unit/push-target.test.ts`
Expected: FAIL with `Failed to load url ../../src/lib/push-target`.

- [ ] **Step 3: Write `master-ai-mobile/src/lib/push-target.ts`**

```ts
import type { Href } from 'expo-router';

const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Where a tapped push opens: a list item, a case or a decision. Anything else just opens the app. */
export function pushTarget(data: unknown): Href | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (text(d.listId) && text(d.itemId)) return { pathname: '/list/[id]/[itemId]', params: { id: d.listId, itemId: d.itemId } };
  if (text(d.caseId)) return { pathname: '/case/[id]', params: { id: d.caseId } };
  if (text(d.approvalId)) return { pathname: '/approval/[id]', params: { id: d.approvalId } };
  return null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @onehuman/mobile exec vitest run __tests__/unit/push-target.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Listen for taps, lazily**

In `master-ai-mobile/src/lib/push.ts`:
- Add `import type { Href } from 'expo-router';` and `import { pushTarget } from './push-target';`.
- Append:

```ts
/** The last push this run opened, so signing in again doesn't open it twice. */
let opened: string | null = null;

/**
 * Opens what a tapped push is about: a list item, a case or a decision. This
 * covers a tap that started the app as well. Expo Go has no remote push, so it
 * listens for nothing there, and expo-notifications is required lazily for the
 * same reason as above.
 */
export function openPushTaps(open: (href: Href) => void): () => void {
  if (!Device.isDevice || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return () => undefined;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  const go = (response: import('expo-notifications').NotificationResponse | null) => {
    if (!response || response.notification.request.identifier === opened) return;
    opened = response.notification.request.identifier;
    const to = pushTarget(response.notification.request.content.data);
    if (to) open(to);
  };
  go(Notifications.getLastNotificationResponse());
  Notifications.clearLastNotificationResponse();
  const sub = Notifications.addNotificationResponseReceivedListener(go);
  return () => sub.remove();
}
```

In `master-ai-mobile/src/app/_layout.tsx`:
- Change the push import to `import { openPushTaps, registerForPush } from '@/lib/push';`.
- Add `router` to the `expo-router` import: `import { router, Stack } from 'expo-router';`.
- Make `SignedInEffects`' effect:

```tsx
  useEffect(() => {
    void registerForPush();
    const stopSync = startQueueSync();
    const stopRefresh = refreshListsOnForeground();
    const stopTaps = openPushTaps((href) => router.push(href));
    return () => {
      stopSync();
      stopRefresh();
      stopTaps();
    };
  }, []);
```

- [ ] **Step 6: Run the checks**

Run: `pnpm --filter @onehuman/mobile typecheck && pnpm --filter @onehuman/mobile test`
Expected: PASS. Then check that nothing imports `expo-notifications` at the top of a module:

Run: `grep -rn "from 'expo-notifications'" master-ai-mobile/src`
Expected: no output. The `typeof import(...)` type positions don't match this pattern.

- [ ] **Step 7: Commit**

```bash
git add master-ai-mobile/src/lib/push-target.ts master-ai-mobile/src/lib/push.ts master-ai-mobile/src/app/_layout.tsx master-ai-mobile/__tests__/unit/push-target.test.ts
git commit -m "feat(mobile): tapping a push opens the list item, case or decision it is about

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The Maestro journey and the docs

**Files:**
- Modify:
  - `master-ai-mobile/__tests__/e2e/seed.mts`
  - `master-ai-mobile/__tests__/e2e/run.mts`
  - `master-ai-mobile/__tests__/e2e/flows/member.yaml`
- Create: `master-ai-mobile/__tests__/e2e/flows/lists.yaml`
- Modify (docs):
  - `docs/adr/0012-lists-and-checks.md:25`
  - `docs/known-gaps.md:100,110`
  - `docs/testing.md:41,49,106`
  - `master-ai-mobile/README.md` ("Testing")

**Interfaces:**
- Consumes:
  - the testIDs from Tasks 4–6: `tab-lists`, `list-bills`, `show-new_notes`, `item-<billNo>` and `note-apply`;
  - the SDK client: `auth.signup`, `onboarding`, `lists.create`, `followUps.switch` and `run`, `calls.active`, `answer` and `reply`, and `lists.item`.
- Produces:
  - `seedLists(): Promise<{ LISTS_OWNER_EMAIL: string; LISTS_BILL: string }>`;
  - the Maestro variables `LISTS_OWNER_EMAIL` and `LISTS_BILL`.

- [ ] **Step 1: Seed a trader whose customer said the bill is paid**

In `master-ai-mobile/__tests__/e2e/seed.mts`, append before the `if (import.meta.url === …)` block:

```ts
/** India's date `n` days from today. */
const istDay = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

async function until<T>(get: () => Promise<T | undefined>, failure: string, ms = 90_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = await get();
    if (found) return found;
    await sleep(1000);
  }
  throw new Error(failure);
}

export interface SeededLists {
  LISTS_OWNER_EMAIL: string;
  LISTS_BILL: string;
}

/**
 * A wholesale trader whose customer said on a simulated follow-up call that a
 * bill is paid. Its Bills list holds one bill with a new note proposing
 * "paid", for the owner to apply from the phone.
 */
export async function seedLists(): Promise<SeededLists> {
  let token: string | null = null;
  const owner = createClient({ baseUrl: API_URL, getToken: () => token });
  const ownerEmail = email('lists');
  const auth = await owner.auth.signup({
    companyName: `Phone Traders ${randomBytes(2).toString('hex')}`,
    ownerName: 'Asha Owner',
    email: ownerEmail,
    password: PASSWORD,
    sector: 'trade-logistics-tourism',
    orgType: 'wholesale-retail',
  });
  token = auth.token;
  await owner.onboarding.install({ draftId: (await owner.onboarding.preview()).id, sampleData: false });
  const party = await owner.lists.create('parties', { name: 'Sri Ganesh Traders', partyType: 'retailer', phone: '+91 98470 81234' });
  const billNo = `PH-${randomBytes(2).toString('hex').toUpperCase()}`;
  const bill = await owner.lists.create('bills', { billNo, billType: 'sales invoice', party: party.id, billDate: istDay(-10), dueDate: istDay(-3), total: 48260, paymentStatus: 'unpaid' });
  await owner.followUps.switch('bills.unpaid-bills', true);
  await owner.followUps.run();
  const call = await until(async () => (await owner.calls.active()).find((c) => c.about?.itemId === bill.id && c.status === 'ringing'), `${billNo}'s follow-up call never rang`);
  await owner.calls.answer(call.id);
  for (const text of ['Yes, speaking', "It's already paid", 'UTR 445566']) await owner.calls.reply(call.id, text);
  await until(async () => (await owner.lists.item('bills', bill.id)).notes.find((n) => n.status === 'new'), `the call about ${billNo} left no note`);
  return { LISTS_OWNER_EMAIL: ownerEmail, LISTS_BILL: billNo };
}
```

Change the last block so a direct run prints both seeds:

```ts
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify({ ...(await seed()), ...(await seedLists()), PASSWORD }, null, 2));
}
```

The new tenant's calls are simulated, and its `fastSchedule` setting is on by default. So the call isn't held to calling hours, and the seed works at any time of day.

- [ ] **Step 2: Pass the new values to the flows**

In `master-ai-mobile/__tests__/e2e/run.mts`:
- Change the import to `import { API_URL, PASSWORD, seed, seedLists } from './seed.mts';`.
- Replace the seeding lines with:

```ts
const env = { ...(await seed()), ...(await seedLists()) };
console.log(`✓ Seeded ${env.COMPANY}: ${env.HOT_WORK_CODE} waits for the safety officer, ${env.OVERHAUL_CODE} for the owner`);
console.log(`✓ Seeded a trader: bill ${env.LISTS_BILL} has a customer's "paid" waiting in Lists`);
```

- [ ] **Step 3: Write `master-ai-mobile/__tests__/e2e/flows/lists.yaml`**

```yaml
appId: host.exp.exponent
name: The owner applies what a customer said on a call, from the Lists tab
---
- runFlow: common/open.yaml
- runFlow:
    file: common/sign-in.yaml
    env:
      EMAIL: ${LISTS_OWNER_EMAIL}
- tapOn:
    id: "tab-lists"
- extendedWaitUntil:
    visible: ".*1 new from calls.*"
    timeout: 20000
- tapOn:
    id: "list-bills"
# The bill is dated ten days ago, which may be last month early in a month: look at all time.
- tapOn:
    id: "range-all"
- tapOn:
    id: "show-new_notes"
- tapOn:
    id: "item-${LISTS_BILL}"
- extendedWaitUntil:
    visible: ".*It's already paid\\. UTR 445566.*"
    timeout: 20000
- assertVisible: "Payment: paid"
- tapOn:
    id: "note-apply"
- extendedWaitUntil:
    visible: "Applied by Asha Owner"
    timeout: 20000
- assertVisible: ".*Checked by Asha Owner.*"
- back
- back
- runFlow: common/sign-out.yaml
```

- [ ] **Step 4: A member has no Lists tab**

In `master-ai-mobile/__tests__/e2e/flows/member.yaml`, after the `common/sign-in.yaml` step, add:

```yaml
# Lists are for the owner and admins: a member has no tab for them.
- assertNotVisible:
    id: "tab-lists"
```

- [ ] **Step 5: Run the phone journey**

This needs `pnpm dev` (offline is fine: `LLM_OFFLINE=always pnpm dev`), Metro on 8082 started fresh with `--clear` so it serves the new screens, and the Android emulator with Expo Go. See `CLAUDE.md` › Commands.

Run: `pnpm e2e:mobile`
Expected: all four flows pass: `role-holder`, `member`, `new-request` and `lists`.

If the emulator, Metro or Maestro can't run in this environment, don't skip silently. Instead:
- run the seed alone: `node master-ai-mobile/__tests__/e2e/seed.mts`. It must print `LISTS_OWNER_EMAIL` and `LISTS_BILL`, which proves the call left its note;
- record in the task report which flows didn't run, and why.

- [ ] **Step 6: Update the docs**

In `docs/adr/0012-lists-and-checks.md`, replace the last Consequences line (`- Lists in the phone app, role holders seeing their own list, and the AI's calls about items come in later parts.`) with:

```markdown
- The phone app shows the lists to the owner and admins for review and action: browse, filter, mark checked, and Apply, Dismiss or Call again on notes from calls. Its wording comes from `@onehuman/sdk`, shared with the web. Adding and editing items, follow-up switches and the CSV stay on the web.
- A party's answer that needs the head (paid or settled, a dispute, a wrong number) is pushed to the owner and admins once it is saved, and the push opens the item.
- Role holders seeing their own list is still to come.
```

In `docs/known-gaps.md`:
- Replace line 100 (`- Lists are on the web only; the phone app gets them in a later part.`) with:

```markdown
- On the phone, lists are for review and action only. Adding or editing items, follow-up switches, "Call now", totals by field and the CSV are on the web. Lists aren't saved for use without signal.
- Pushes about lists cover only a party's paid, dispute and wrong-number answers; the rest shows on the Lists badge. Pushes need a development or production build (not Expo Go).
```

- Replace line 110 (`- Calls about list items are in the web simulator and through Twilio; the phone app shows them in its call list but has no Lists tab yet.`) with:

```markdown
- Calls about list items are in the web simulator and through Twilio; the phone shows them in its call list and their notes in Lists.
```

In `docs/testing.md`:
- Line 41: after `the case views and report shared by web and mobile,` insert `the list wording (labels, a page's query, values in words),`.
- Line 49: change it to `- **`master-ai-mobile`**: design tokens, sessions, offline approvals, the badge, the list helpers (cards, rows, buttons, no-signal line) and where a tapped push opens.`
- Line 106: after `a new request from the phone runs its stages` insert `, and the owner applies a customer's "paid" from the Lists tab`.

In `master-ai-mobile/README.md` › Testing:
- Add these unit-test bullets:
  - `lists.test.ts`: the list helpers in words;
  - `push-target.test.ts`: where a tapped push opens.
- Add the flow bullet `lists.yaml`: the owner opens a bill from Lists and applies what the customer said.
- Change the member bullet to `member.yaml`: sees no approvals and no Lists tab.

- [ ] **Step 7: Run everything**

Run: `pnpm turbo run build typecheck test`
Expected: all tasks succeed.

Run: `pnpm test:integration`
Expected: PASS.

Run (with `LLM_OFFLINE=always pnpm dev` up): `pnpm --filter @onehuman/web exec playwright test lists list-calls list-selection --project=desktop`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add master-ai-mobile/__tests__/e2e master-ai-mobile/README.md docs/adr/0012-lists-and-checks.md docs/known-gaps.md docs/testing.md
git commit -m "test(mobile): Maestro journey — the owner applies a customer's answer from Lists; docs for lists on the phone

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

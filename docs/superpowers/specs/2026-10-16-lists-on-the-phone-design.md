# Lists on the phone

Date: 2026-10-16 · Status: draft for review

This design follows on from [sector lists](2026-10-14-sector-lists-design.md), part 1 (lists and checks, [ADR 0012](../../adr/0012-lists-and-checks.md)) and part 2 (the AI's calls, [ADR 0013](../../adr/0013-calls-to-outside-parties.md)). Both parts put the lists on the web only, and `docs/known-gaps.md` says so ("the phone app … has no Lists tab yet").

## 1. What the head gets

The head of the company can check the lists from the phone and act on them, without opening the web app:
- see which lists need attention;
- open a list and filter it to what matters;
- open an item and mark it checked;
- act on what customers, suppliers and staff said on calls.

What the owner asked for:
- **Scope: review and act.** The head can browse, filter and search, mark items checked (one or many), mark an item checked despite a problem (with a note), and Apply / Dismiss / Seen / Call again on notes from calls. Adding and editing items, follow-up switches, "Call now", totals by field and the CSV download stay on the web.
- **Where: a Lists tab.** It sits between Approvals and Calls, for the owner and admins only. Its badge counts new notes from calls.
- **Alerts:** a push for a customer's or supplier's answer that needs a decision (paid, dispute, wrong number). Everything else shows only on the badge.
- **How: native screens.** The web's list wording moves into `@onehuman/sdk`, so the phone and the web say things the same way.

Success: on the phone, the owner sees "Bills · 2 new from calls", opens the bill, reads "Sri Ganesh Traders said: It's already paid. UTR 445566", taps Apply, and the bill shows paid and checked by them. This works with the same rules as the web and nothing new on the server beyond the push.

## 2. Screens

### 2.1 Lists tab (`master-ai-mobile/src/app/(tabs)/lists.tsx`)
- **Who sees it.**
  - The tab shows when the signed-in person's role is `owner` or `admin`, read from the session, which `/auth/me` refreshes.
  - Everyone else gets `href: null`, so the tab is hidden.
  - The server refuses members on every lists route anyway.
- **Badge.** The sum of `card.newNotes` over `GET /lists`. No badge when it is 0.
- **Content.**
  - The heading reads: "Lists, to check what came in."
  - Then one card per list, main lists first, in the order `GET /lists` returns. Each card shows:
    - the list's name;
    - the count and sum (for example "12 this month · ₹4,82,600 to collect"), using `card.countLabel`, `card.sum` and `card.sumLabel`;
    - one line of marks, each shown only when non-zero: "3 with problems · 5 not checked · 2 new from calls".
- **Samples.** When `samples > 0`, a muted line reads: "Sample items are still in your lists. Remove them on the web when you're ready."
- **Refresh.** Pull to refresh.
- **Empty.** "No lists yet. Your organization type's lists appear here once it is set up."

### 2.2 A list (`src/app/list/[id]/index.tsx`)
- **Header.** The list's name, then the matching total: "48 bills · ₹12,40,000".
- **Search.** A search box sends `q` to the server, debounced by 300 ms.
- **Show pills.** All, Has problems, Not checked, Checked, New from calls, sent as `show` and using the shared labels.
- **Range pills.** Only when the list has a date field: Today, This week, This month, Last month, All time (the shared labels). The default follows the web's `initialView`.
- **Rows.** `GET /lists/:id?…`, a page at a time, with more loading at the end of the scroll. Each row shows:
  - the item's title;
  - the first two of the list's `columns` other than the title, in words, through the shared `recordCell` (₹ amounts, dates, references by title);
  - marks: "⚠ 2 problems" in warning tone, "Checked" with a tick, and "New from a call" as a badge.
  - Tapping a row opens the item.
- **Select.**
  - Tapping "Select" turns rows into checkboxes, and a bottom bar shows "Mark 4 checked".
  - It calls `POST /lists/:id/check` (`checkMany`). The server leaves items with open problems (`skipped`), because those need a note. The result reads in words: "4 marked checked." or "3 marked checked. 1 has problems: open it to check it with a note."
  - The selection clears when the view changes or after the check.
- **Undated items.** When a range hides undated items, the line "{n} items have no date and aren't shown" appears.

### 2.3 An item (`src/app/list/[id]/[itemId].tsx`)
- **Load.** `GET /lists/:id/items/:itemId`.
- **Top.**
  - The title.
  - "Came in: {source in words}", for example "Call with Ravi Kumar".
  - "Updated on a call with {name}" when `updated.via === 'call'`.
  - "Checked by {name}, {time ago}" with the note, when checked.
- **Fields.** Every field of the entity, through `recordCell`, as label/value rows. Empty fields read "—".
- **Problems.** Each problem's message; an accepted one is marked "(seen)", as on the web and in the CSV. A duplicate's problem links to the other item.
- **Mark checked.**
  - The button reads "Mark checked", or "Mark checked anyway" when there are open problems. With open problems, a note saying why the item is right is required, because the server refuses an empty one. A checked item with nothing open shows no button.
  - It calls `POST /lists/:id/items/:itemId/check`. Checking with open problems acknowledges them, as on the web.
- **From calls.** Notes, newest first. Each note shows:
  - the kind's label;
  - the speaker and the time ago;
  - the words, in quotes;
  - "Promised for Fri, 16 Oct" when there is a promise;
  - the proposed changes as "Payment: paid";
  - its state: "New from a call", "Applied by …" or "Seen by …".

  The buttons on a note:
  - **Apply,** for new notes that propose changes.
  - **Dismiss,** for new notes that propose changes, or **Seen** for new notes without proposals.
  - **Call again,** only when `note.canCallAgain`.
- **History.** The last 10 entries, newest first, in words.

### 2.4 Shared wording (`@onehuman/sdk`)

Move these from `master-ai-web/src/lib/lists.ts` and `master-ai-web/src/lib/record-cell.ts` into a new `packages/sdk/src/lists.ts`, exported from the SDK:
- `RANGE_LABELS`, `SHOW_LABELS`, `SOURCE_LABELS` and `NOTE_LABELS`;
- `followUpLine`, `dayLabel`, `referenceText`, `initialView` and `listParams` (with the `ListView` type);
- `recordCell`, with `formatValue`. `formatInr` stays in `@onehuman/ui`, which the SDK now depends on;
- two new helpers: `itemCell` (a reference by its title, anything else through `recordCell`) and `amountText` (a total in rupees or Indian digit groups).

The web's `lib/lists.ts` and `lib/record-cell.ts` re-export them, so web code doesn't change. The web's list table and item panel use `itemCell` in place of their copy of the same logic. The tests move with the code. Browser-only helpers stay in the web: `saveText`, `withBom`, `csvFileName`, and the sort marks for column headers.

The web takes run-time values only from `@onehuman/schemas/plain`. The moved code must keep that rule: types are `import type` from the schemas root, and run-time values come from `@onehuman/schemas/plain` or the SDK.

## 3. Push alerts

**When.** After a follow-up call to an outside party concludes, a push goes to the owner and admins through `NotificationsService.pushToManagers`. It is sent **after the transaction commits**, from `FollowUpCallsService`, and only for these results:

| Result | Title | Body |
|---|---|---|
| settled | `{party} says {item} is paid`. The word is the proposed value when it is paid, received, delivered, approved, confirmed, done or completed; otherwise `… is settled` | `"{their words}" Tap to apply or dismiss.` (only the quote when nothing can be applied) |
| dispute | `{party} disputes {item}` | `"{their words}"` |
| wrong number | `Wrong number for {party}` | `The number called about {item} isn't theirs. Correct it on the web, then tap Call again on the note.` |

Their words are clipped to 120 characters.

**No push for** promises, "couldn't reach" notes, collection differences, staff answers, or do-not-call requests. Those show on the badge, and a do-not-call request needs no decision.

**Data.** `{ listId, itemId }`, in the same style as the existing pushes' `{ caseId }` and `{ routineId }`.

**Tapping a push.** The app has no tap handler today, so it gains one, registered next to `registerForPush` and loaded lazily in the same way:
- `{ listId, itemId }` opens `/list/{listId}/{itemId}`;
- `{ caseId }` opens `/case/{caseId}`;
- `{ approvalId }` opens the decision, `/approval/{approvalId}`;
- anything else just opens the app.

**Words only.** No ids appear in the title or the body. `{item}` is the record type and the item's title ("bill S-1042"), or "the bill" without a title. `{party}` is the contact's name, or "Your contact" without one.

**Where it works.** Pushes work only in a development or production build. In Expo Go the push is skipped, as for approvals today (`src/lib/push.ts`), and the badge still updates.

## 4. Freshness, no signal and errors

- **Live updates.** `src/lib/realtime.ts` invalidates the lists queries (`['lists']`, `['list', …]` and `['list-item', …]`) on events in the areas `note`, `record` and `call`. On reconnect it already invalidates everything.
- **Back to the front.** When the app returns to the foreground (`AppState` active), the lists overview refetches, so the badge is current.
- **No signal.**
  - Lists aren't stored offline. The offline SQLite cache stays for approvals only.
  - When a request fails because there is no network (`isNetworkError`), each screen keeps the data it last loaded and shows "No signal. Showing what was loaded at {time}."
  - Mark checked, Select, Apply, Dismiss, Seen and Call again are disabled and say "Needs a connection".
  - Nothing is queued, because these actions change the company's records.
- **Errors.** Errors read in words through the app's `errorMessage`, as on other screens.

## 5. Rules kept

- **The server decides.** Permissions are the server's. The phone hides the tab from members as a courtesy, and shows Call again only from `canCallAgain`.
- **Only people check.** Only people mark items checked, and only the head applies a party's words (ADR 0012 and ADR 0013).
- **Words, not ids.** Owners never see ids, keys or JSON: reference titles, labels and `recordCell` text only.
- **The app's own conventions:**
  - always dark (`src/lib/theme.ts`);
  - weights as font families, never `fontWeight`;
  - no hex or named colours (`__tests__/unit/tokens.test.ts`);
  - shared UI from `src/components/ui.tsx`;
  - new routes need Metro to regenerate `.expo/types/router.d.ts` before typecheck.

## 6. Testing

- **SDK** (`packages/sdk/__tests__/lists.test.ts`, extended): unit tests for the moved helpers, including `recordCell` and `itemCell` on money, date, enum and reference values, and `listParams`. The web's tests for those helpers move here. The web keeps its web-only tests and one check that its re-exports are the SDK's own functions.
- **Phone unit tests** (`master-ai-mobile/__tests__/unit/`): pure helpers in `src/lib/lists.ts` (phone):
  - the badge total;
  - a row's two-column summary;
  - which buttons a note shows (Apply/Dismiss vs Seen vs Call again);
  - tab visibility by role;
  - the result line for "Mark N checked";
  - the "No signal" line.
- **Backend integration** (`follow-ups.spec.ts`):
  - With a recorder in place of `NotificationsService.pushToManagers`, a settled, a dispute and a wrong-number party result each push once, after commit, with `{ listId, itemId }` and titles in words.
  - A promise, an unanswered call, a staff status answer and a do-not-call request don't push.
- **Maestro** (`pnpm e2e:mobile`):
  - **Owner, new `lists.yaml`:** seeded with a bill that has a new "paid" note. The owner taps the Lists tab, then Bills, then "New from calls", opens the bill, taps Apply, and sees "Applied by Asha Owner".
  - **Member, existing `member.yaml`:** extended to assert there is no Lists tab.
  - The seed (`__tests__/e2e/seed.mts`) creates the bill and the note through the API.
- **Green:** `pnpm turbo run build typecheck test`, `pnpm test:integration`, the web's Playwright `lists` journeys (to prove the move didn't change the web), and the mobile typecheck and unit tests.

## 7. Out of scope

- Adding or editing items, follow-up switches, Call now, and the CSV download on the phone.
- Offline lists.
- A list view for role holders limited to their own list (part 1's gap stands).
- Push for anything beyond the three results in §3.

## 8. Docs

- ADR 0012 gets a "Consequences" line: the phone shows lists for review and action, with wording shared through the SDK.
- In `docs/known-gaps.md`, the "phone app has no Lists tab" lines are replaced with what is still web-only, from §7.
- `docs/testing.md` lists the new Maestro flow and unit tests.

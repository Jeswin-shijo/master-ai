# 0012. Lists and checks

Date: 2026-10-14 · Status: accepted

## Context
The head of an organization had no way to see the records their kind of organization runs on (a wholesaler's bills, an IT company's tickets, a builder's site issues) as lists to recheck. Records showed one type at a time with a search, and had no filters, totals, history or checks. Nothing recorded how an item came in, and an AI agent's changes weren't audited. The next part adds AI calls that add and update items, which makes rechecking matter more. Design: [sector lists](../superpowers/specs/2026-10-14-sector-lists-design.md).

## Decision
- **Lists are pack data.** `registers:` in a pack names each organization type's lists over its entities: columns, filters, a main date, totals, a card and checks. Every entity without one gets a default list, so older workspaces and types described in the owner's own words have lists too. A pack the model writes names up to four main lists.
- **Six fixed kinds of check:** `missing`, `adds_up`, `limit`, `duplicate`, `overdue` and `expiring`, plus a built-in check that a reference points at a real item. The app compiles them to SQL (`master-ai-backend/src/lists/sql.ts`) and works them out whenever a list is read. A model never evaluates or clears one. A value that isn't a valid number or date reads as blank (`try_numeric`, `try_date`, `try_timestamptz`). A date-time written without a time-zone offset is read as India time (migration `0014_ist_datetimes.sql` sets the time zone on `try_timestamptz`, and `master-ai-backend/src/lists/format.ts` reads such values the same way); date fields use their written YYYY-MM-DD. A calendar day that doesn't exist (2026-02-31) is refused.
- **Search reads what people read:** it matches an item's field values and the titles of the items its references point at, never field names or ids.
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
- The phone app shows the lists to the owner and admins for review and action: browse, filter, mark checked, and Apply, Dismiss or Call again on notes from calls. Its wording comes from `@onehuman/sdk`, shared with the web. Adding and editing items, follow-up switches and the CSV stay on the web.
- A party's answer that needs the head (paid or settled, a dispute, a wrong number) is pushed to the owner and admins once it is saved, and the push opens the item.
- Role holders seeing their own list is still to come.

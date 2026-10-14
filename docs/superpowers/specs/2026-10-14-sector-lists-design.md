# Sector lists, checking, and the AI's calls about them — design

Date: 2026-10-14 · Status: draft for review · Builds on [ADR 0003](../../adr/0003-industry-adaptation.md) (packs), [ADR 0007](../../adr/0007-phone-delegation-to-staff.md) and [0008](../../adr/0008-routines-manual-or-automatic.md) (calls and routines), and the [organization types design](2026-10-12-org-types-and-case-lifecycle-design.md)

## Goal

The head of a company should be able to open the lists their kind of organization runs on — bills for a wholesaler, tickets for an IT company, site issues and contractor bills for a builder — see every item, filter and total them, see how each item came in, spot mistakes, correct them and mark them checked. Items come in by hand, from AI agents, or from the AI phoning people. The AI also follows up on open items: it chases payment from a party, asks an engineer about a late ticket, or asks a contractor about a site issue. What outside parties say is recorded for the head to check, never applied as fact.

Today this is not possible: the Records page (managers only, near the bottom of the menu) shows one record type at a time with a text search. It has no filters, no totals, no editing, no record of how an item came in, and no checks. Check-in calls only answer fixed questions; they never add or update items.

## Decisions

Taken with the product owner during design, 2026-10-14:

1. **The AI's calls do both:** they add new items by asking our own staff, and they follow up on open items.
2. **The AI may phone outside parties** (customers, suppliers, contractors, borrowers, TPAs), with four conditions: each kind of call is switched on once by the owner; outside parties are called only in working hours; anything a party says ("paid", "will pay Friday") is recorded as what they said, for the head to check, never as a fact; and (from the design) the AI always says it is an AI.
3. **Approach A — lists defined by each organization type.** Each pack names its main lists and their columns, filters, totals, checks, collection and follow-ups. One engine runs every list for every type, including types described in the owner's own words. Rejected: making every item a case (bills are not requests; 8 stages per bill is wrong), and hand-built pages per sector (does not scale to 15 types plus own-words types).
4. **Two parts, one design.** Part 1 is lists and checking; it is useful on its own. Part 2 is the AI's calls (collection and follow-up), built on part 1. Each part gets its own implementation plan.
5. **The head is the owner and admins.** Members do not see lists (as with Records today). A role holder seeing only their own list is left for later.
6. **Web first.** The phone app gets the lists in a later part.

Words used in this document: a **list** (in code, a *register*) is a view over one pack entity's records; an **item** is one record; a **problem** is a failed check; **checked** means a person agreed with the item.

---

## 1. Lists per organization type

### Where they live

"Records" becomes **Lists**, moved up the menu to sit under Cases (owner and admins only). The Lists page shows one card per main list, for example "Bills · 42 this month · ₹3,19,780 unpaid · 5 have problems · 12 not checked"; a click opens the list. Below the cards, under "Other lists", every other record type of the pack (customers, products...) is listed, so nothing is hidden. `/records` redirects to `/lists`.

### Pack format

`PackSchema` gains `registers` (snake_case keys, like the rest of the pack):

```yaml
registers:
  - id: bills                    # slug, unique in the pack
    entity: Bill
    label: Bills                 # optional; defaults to the entity's plural label (after pack `labels`)
    main: true                   # a card on the Lists page; false = under "Other lists"
    columns: [billNo, billType, party, billDate, total, paymentStatus]   # default: the entity's list_columns
    filters: [billType, paymentStatus, party]   # enum, boolean and reference fields
    date_field: billDate         # the date-range filter; the list opens on "This month"
    sort: { field: billDate, dir: desc }        # default: date_field desc, else last updated
    totals: [taxableValue, gstAmount, total]    # money / number / integer fields, summed over every matching item
    card:
      sum: { field: total, when: { paymentStatus: [unpaid, part-paid] }, label: unpaid }
      # count: { when: { status: [open] }, label: open }   # optional; see below
    checks: [...]                # section 3
    follow_ups: [...]            # section 5 (part 2)
```

A card shows up to two figures plus two counts that every card has. The **count** is the number of items matching `card.count.when` (over all time) with its label; without it, the items this month for a list with a `date_field` ("42 this month"), or all items otherwise. The **sum** (optional) is Σ `card.sum.field` over the items matching `card.sum.when` (over all time), with its label ("₹3,19,780 unpaid"). Every card also shows how many items have problems and how many are not checked.

Every entity without a register gets a **default list**: id = the entity name in kebab case, `main: false`, columns = `list_columns`, filters = its enum, boolean and reference fields (first four), `date_field` = its first date or datetime field, totals = its money fields, no checks. A register id may not collide with a default id; `pack.test.ts` enforces it.

Registers merge down the `extends` chain by `id`, like workflows. The sector content for all 15 types is in [Appendix A](#appendix-a--lists-per-organization-type).

### New record types and fields

Nothing covers a few things a head needs to see, so the packs gain:

- **IT services `Ticket`** and **Software `Ticket`** (tasks, bugs, service and access requests, support questions, feature requests).
- **Construction `SiteIssue`** (snags, material shortages, delays, safety and quality issues) and **`ContractorBill`** (running-account bills).
- New optional fields that follow-ups need: travel `Booking` gains `supplier` and `supplierPhone` (the travel pack redeclares Booking, as wholesale already redeclares Product); hospital `CashlessRequest` gains `tpaPhone`; lender `Repayment` gains `borrowerName` and `borrowerPhone`; manufacturing `QualityIssue` gains `foundOn` and `owner`; NGO `Grant` gains `programmeLead`.

Field lists are in [Appendix B](#appendix-b--new-record-types-and-fields).

### Existing companies

A workspace stores a snapshot of its pack, and the "updates available" banner (`packUpdates` → `POST /workspaces/:id/updates`) only adds. `PackUpdates` gains three additions:

- `entities`: entity types the workspace does not have;
- `fields`: new **optional** fields on entity types it has (by entity name and field name; required fields are never added);
- `registers`: registers it does not have, offered only when their entity, fields, checks and follow-ups are valid against the updated workspace.

The existing `routines` addition leaves out a collection routine (section 4) whose list the workspace will not have.

Nothing existing is replaced or removed.

### Types described in the owner's own words

Offline, such a type borrows the closest ready-made pack, registers included. When a model writes the pack (`generator.service.ts`), its answer gains `main_lists`: up to four of the pack's own entity names. Each becomes a register with the default settings and `main: true`. The generator does not write checks or follow-ups; those stay hand-written and reviewed.

### Who sees lists

Every `/lists` endpoint is `@ManagersOnly()`. Members keep using the existing `POST /records/:entity` (for example, from a manual collection routine) and do not see lists.

---

## 2. What a list shows

```
Bills                          [This month ▾]  [Search…]     [+ New bill]  [Download]
Type:     All · Sales invoice · Purchase bill · Credit note · Debit note
Payment:  All · Unpaid · Part-paid · Paid       Party [Any ▾]   Came in [Any ▾]
Show:     All · Has problems (5) · Not checked (12) · Checked · New from calls (2)
─────────────────────────────────────────────────────────────────────────────────────
Bill no  Type           Party              Date    Total      Payment   Came in
S-1042   Sales invoice  Sri Ganesh Traders 12 Oct  ₹48,260    Unpaid    Call with Ravi       ⚠
S-1041   Sales invoice  Metro Mart         12 Oct  ₹12,400    Paid      Asha, by hand        ✓
P-0310   Purchase bill  Kerala Agencies    11 Oct  ₹96,000    Part-paid AI agent (request)
─────────────────────────────────────────────────────────────────────────────────────
42 bills · Taxable ₹2,71,000 · GST ₹48,780 · Total ₹3,19,780
```

- **Filters:** the register's filter fields (choice chips for enums with up to 6 options, a dropdown otherwise; Yes/No for booleans; a searchable picker for references), "Came in", the "Show" states, a text search over the item's fields, and the date range (Today, This week, This month, Last month, Custom, All time; India time; weeks start Monday). A list with no `date_field` opens on All time.
- **Sort:** any column, both directions.
- **Totals** are summed in SQL over every matching item, not only the page on screen. Pages hold 50 items.
- **References** show the referenced item's title ("Sri Ganesh Traders"), not its id; a value that matches no item shows as typed, with a problem (section 3).
- **"Came in"** for every item: *by hand* (with the person's name), *call with <name>* (links to the call and transcript, part 2), *AI agent* (links to the case the agent was working on), or *sample data*. Staff updates on a call show "Updated on call with Anil".
- **The item panel** (a side drawer, full screen on a phone-width window, `?item=<id>` in the URL): every field, how it came in, its problems, its checked state, notes from calls (part 2), and its history: every change with who, when, old → new values, and the note given.
- **Download** gives the filtered list as CSV: all of the entity's fields plus came in, checked by/at and problems. It has a UTF-8 BOM so Excel reads ₹ and Indian names, and cells starting with `=`, `+`, `-` or `@` are prefixed with `'` so a field can't become a spreadsheet formula. The file is fetched with the session header and saved as a blob; the session token never goes in a URL.
- **Sample data:** sample items carry a "Sample" tag. "Remove sample data" (on the Lists page, with a confirm) deletes every item whose source is `sample`, in one audited transaction. References from real items to removed samples then show as "not found" problems, which is correct.

---

## 3. Checking and correcting

### Problems: six kinds of check

Each register lists checks from a fixed set. Checks are evaluated by the app, in SQL, **whenever a list or item is read**, so they always reflect the current data, today's date and the current pack. (The chat design said "checked on save, dates re-checked daily"; reading time gives the same answers without a nightly job and with no stored state to drift.) The AI never evaluates or clears a check.

```yaml
checks:
  - missing: [party, billDate, total]                 # blank; for yes/no fields: not "yes"
  - adds_up: { field: total, plus: [taxableValue, gstAmount], minus: [], tolerance: 1 }
  - limit: { fields: [previouslyBilled, thisBill], max: workOrderValue }   # sum of fields ≤ max
  - limit: { fields: [stock], min: reorderLevel }                          # ≥ min
  - limit: { fields: [adminSpent], max: receivedToDate, factor: 0.2 }      # ≤ 20% of max
  - limit: { fields: [amount], max: 2000 }                                 # a number works too
  - duplicate: [billType, billNo, party]
  - overdue: { date: dueDate, grace_days: 0 }
  - expiring: { date: permitValidUntil, days: 30 }
```

Every check may also carry:

- `when`: field conditions that must hold for the check to apply. A condition is a list of values (`{ paymentStatus: [unpaid, part-paid] }`, booleans written as `true`/`false`), `{ above: n }`, `{ below: n }`, `filled` or `blank`.
- `why`: a short reason appended to the message, for checks that come from a rule ("CERT-In must be told within 6 hours").

How each kind behaves:

| Kind | Problem when | Skips when | Example message |
|---|---|---|---|
| `missing` | a listed field is blank (yes/no: not yes) | — | "Party is missing" |
| `adds_up` | \|field − (Σplus − Σminus)\| > tolerance (default 1) | any part is blank | "Total ₹48,260 doesn't equal taxable + GST (₹48,200)" |
| `limit` | Σfields > max × factor, or Σfields < min | any side is blank | "Paid ₹5,000 is more than due ₹4,500" |
| `duplicate` | another item of the same entity has the same values in every listed field | any listed field is blank | "Same bill number as another bill for this party" (links to it) |
| `overdue` | date + grace_days is before today (datetimes: before now) | the date is blank | "Due on 20 Oct, 3 days ago" |
| `expiring` | the date is within `days` from today and not yet past | the date is blank | "Insurance ends in 12 days" |

There is also one built-in check with no configuration: a **reference field** whose value is not the id of an existing item of the referenced type is a problem ("Party 'Ganesh traders' isn't in your Parties"). Collection calls rely on it (section 4).

Dates and numbers are read from JSON with guarded casts (a value that isn't a valid date or number is treated as blank), so one bad value can't break a list. A check's **key** is its kind plus its fields (for example `adds_up:total`, `overdue:dueDate`), so keys survive reordering in the pack.

`pack.test.ts` validates every check: fields exist; `adds_up` and `limit` use money, number or integer fields (or, for `limit` only, exactly one date field in `fields` against a date field in `min`/`max`, as in endDate ≥ startDate); `overdue` and `expiring` use date or datetime fields; `when` names real fields and real enum options.

### Checked

- An item is **checked** when an owner or admin marks it, creates it, or edits it. The item shows who checked it and when.
- Any change by anyone else (a member, an AI agent, a call) clears checked.
- **Acknowledged problems.** Marking an item checked while it has problems needs a note ("discount agreed on the phone"). The keys of those problems are stored as acknowledged: they stay visible, greyed, with the note. A problem that appears later, such as the bill falling overdue next week, is not acknowledged and shows normally. An owner or admin edit clears earlier acknowledgements, because the values changed.
- **"Has problems"** means at least one problem that isn't acknowledged. **"Not checked"** means never checked, or changed since.
- **Bulk "Mark all shown as checked"** marks only the shown items that have no problems, and reports "Checked 37, skipped 5 with problems".
- Only people can mark an item checked. There is no catalog tool for it, so no agent and no prompt can do it.

### Correcting

- **Edit** in the item panel. The data is validated with the entity's schema, and the person may add a note.
- **Every update now appends an audit event**, including an AI agent's `records.update`, which today changes data with no audit trail at all. The event is `record.updated`, with payload `{ entity, changes: [{ field, from, to }], note }`.
- **Remove** (owner or admin) asks for a reason. It deletes the item and appends `record.removed` with a full copy of the data and the reason.

---

## 4. Collection routines (part 2)

A routine can collect items for a list instead of asking fixed questions. Schedules, days, time, manual or automatic mode, call-back, no-answer handling and the routine entries page all stay as they are ([ADR 0008](../../adr/0008-routines-manual-or-automatic.md)).

```yaml
routines:
  - id: todays-bills
    name: Today's bills
    description: The AI calls the person who makes bills each evening and adds the day's bills to the Bills list.
    days: [1, 2, 3, 4, 5, 6]
    time: '18:00'
    collect:
      list: bills
      ask: [billNo, billType, party, billDate, total, gstAmount, dueDate]
      defaults: { billDate: today }
      max_items: 15          # default 15, at most 25
      who: the billing clerk # shown when the owner switches it on and picks the person
```

`RoutineTemplateSchema` takes exactly one of `questions` or `collect`. `pack.test.ts` checks that `list` exists in the pack and that every field in `ask` and `defaults` belongs to that list's entity. Defaults are `today`, `now` or a fixed value.

### The call (`CollectEngine`, beside `CheckinEngine`)

1. **Opening:** "Hi Ravi, it's the AI assistant at Metro Traders, calling for today's bills. How many did you make?" The count is a hint only; the call ends when the person says that's all.
2. **For each item**, it asks the `ask` fields not covered by `defaults`, one at a time offline (with a model, the person may say several at once). Spoken questions come from the field label and type: "What's the bill number?", "Is it a sales invoice, purchase bill, credit note or debit note?", "What's the total?". Numbers are read the way the check-in engine reads them, extended for spoken Indian amounts ("forty-eight thousand two sixty", "one lakh twenty"). Dates are read with the existing helpers in `voice/time.ts` ("today", "yesterday", "20 October").
3. **References are matched to records:**
   - one match by title is confirmed out loud ("Sri Ganesh Traders in Kochi?");
   - several matches are read out (up to three) for the person to choose from;
   - no match keeps the words exactly as said, and the built-in reference check flags the item.
4. **Read-back:** "Bill S-1042, sales invoice, today, total ₹48,260, GST ₹7,360. Is that right?" A yes saves it at once, so a dropped call keeps every confirmed item. A no asks what to change (offline, it re-asks that item's fields).
5. **Repeats.** An item that matches an existing one on the list's first `duplicate` check is not saved again. If its details differ, the existing item gets a *difference* note ("On the call on 12 Oct, Ravi gave the total as ₹48,600"), which the head can Apply or Dismiss (section 5).
6. **Limit.** After `max_items`, the AI says "That's all I can take on one call; please add the rest in the app" and ends.

Saved items have source `call`, a link to the call, and are not checked. The routine entry stores `{ items: [ids], differences: n }`, and the entries page shows "3 bills added". In **manual mode**, the person gets an "Add today's items" form, which is the list's new-item form limited to the `ask` fields; it posts to `POST /records/:entity`.

### Ready-made collection routines

All are off until the owner switches them on and picks the person. They are listed per type in [Appendix A](#appendix-a--lists-per-organization-type).

---

## 5. Follow-ups on open items (part 2)

### Format

A register lists the follow-ups it offers:

```yaml
follow_ups:
  - id: unpaid-bills                  # unique within the register
    label: Unpaid bills → the party
    who: party                        # party | staff
    due: { overdue: { date: dueDate, grace_days: 0 } }        # or { expiring: { date, days } }
    when: { billType: [sales invoice], paymentStatus: [unpaid, part-paid] }
    phone: { ref: party, field: phone }   # or { field: consigneePhone }
                                          # or { lookup: Customer, match: name, value: client, field: phone }
    contact: { ref: party, field: name }  # the same three shapes; the name the AI asks for
    about: [billNo, billDate, total, dueDate]   # read out once the person confirms who they are
    find_out: [paymentStatus, paymentRef]      # what the call may propose; a promised date is always allowed
    every_days: 3                     # default 3 for parties, 1 for staff
    max_tries: 3
    hours: { start: '08:00', end: '19:00' }    # optional cap, for example RBI's recovery-call hours for lenders
```

For `who: staff`, `staff: { field: assignedTo }` replaces `phone` and `contact`. The value is matched by name to a Team member. If nobody matches, the item gets the problem "Couldn't find Anil in your team".

`pack.test.ts` checks every path:

- the date field;
- the `when` fields;
- `ref` must be a reference field;
- `lookup` must name an entity and its fields;
- `field` must be a phone field;
- `about` and `find_out` must be fields of the entity.

### Switches

- Every follow-up starts **off**. Each list page has a "Follow-ups" panel with one switch per follow-up, which shows who switched it on and when.
- A `party` follow-up can be switched on or off only by the **owner**; this is checked in the service, not only in the UI. A `staff` follow-up can be switched by the owner or an admin.
- Switching is audited (`followup.switched`).

### Hours and limits

- **Party calls** happen only within the company's **calling hours for customers and suppliers** (a new `TenantSettings.calls.partyHours`, default Mon–Sat 10:00–18:00), always inside the legal 9:00–21:00 window (`voice/time.ts`), and inside the follow-up's own `hours` when it sets one.
- **Staff calls** use the person's working hours, as now.
- **Per item,** there is at most one call per `every_days`.
- **Unanswered calls:** after `max_tries` rang-out or declined calls, the follow-up stops for that item and it gets the problem "Couldn't reach after 3 tries. Please follow up yourself."
- **Daily cap:** `TenantSettings.calls.followUpsPerDay` (default 30) caps follow-up calls per company per day.
- **One at a time:** only one follow-up call per company rings at a time, so the simulator never stacks calls.
- The **kill switch** stops all follow-up calls.
- In the **simulator's fast mode**, hours are skipped (as delegation calls already do). Real numbers are never called out of hours.

### Scheduling

- When the first follow-up is switched on, a Temporal Schedule `follow-ups-<tenantId>` runs a sweep every 30 minutes. It is deleted when none is on, and kept in step the way routine schedules are.
- **Which items the sweep picks:** items that are due (the `due` and `when` conditions, using the same SQL as the checks) and inside calling hours.
- **Which it skips:** items whose follow-up has stopped, items not yet due for another call, items with a note waiting for the head, and items whose phone is on the do-not-call list.
- Each picked item starts a `followUpCallWorkflow` (ring, wait, retry), up to the daily cap.

### The call (`FollowUpEngine`)

**Party call:**

1. **Opening:** "Hello, this is an AI assistant calling from Metro Traders. Am I speaking with someone from Sri Ganesh Traders?" No details are given until the person says yes.
   - "Wrong number" or "no" → "Sorry to have troubled you", and a *wrong number* note on the item.
   - "Who is this?" → the AI repeats who it is.
2. **About:** "It's about bill S-1042 from 12 October for ₹48,260, which was due on 20 October. Could you tell me when it will be paid?" The question comes from `find_out`.
3. **Outcomes,** each recorded as a note on the item:

   | The party says | Note recorded | What follows |
   |---|---|---|
   | it's paid | *proposes* `paymentStatus: paid`; the AI asks for a reference, which it proposes as `paymentRef` | — |
   | a date | a promise (`promise_on`) | the item becomes due again the day after the promise if it is still open |
   | a dispute ("the goods never came", "the amount is wrong") | a dispute | the AI says "I've noted that; someone from Metro Traders will call you back"; follow-ups stop for the item until the head acts on the note |
   | "don't call me again" | none; the phone goes on the do-not-call list | an apology, and no AI call to that number again |
   | anything else | the words as said | a thank-you and goodbye |

4. **Rules:**
   - The AI never threatens, bargains or promises anything, and it never changes the item.
   - Notes from party calls are never applied without the head.

**Staff call:** "Hi Anil, this is the AI assistant at Infotech, about ticket T-221 for Acme, printer not working, due yesterday. What's the status?"

- The answer is matched to the entity's status options and an optional new date ("by tomorrow 5 pm").
- The change is **applied at once.** The item goes back to "Not checked" and shows "Updated on call with Anil".
- An answer that can't be matched is recorded as a note.

**With a model:** the outcome is parsed with a zod schema `{ outcome: paid | promise | dispute | wrong_person | do_not_call | status | other, promiseOn?, reference?, status?, dueAt?, said }` with one repair round, then the script. The model's answer only creates a note or a staff status change through the same code paths. It never writes the record directly.

### Notes from calls

Each item shows "New from a call" while a note is new. The head can do two things with a note:

- **Apply** sets the proposed fields (validated, audited as `record.updated` with the note's id, and the item becomes checked by the head).
- **Dismiss** keeps the note in the history.

A promise or dispute note with nothing to apply only has Dismiss ("Seen"). The "New from calls" filter shows these items.

### Ready-made follow-ups

They are listed per type in [Appendix A](#appendix-a--lists-per-organization-type), and all of them start off. Two differ from the chat summary:

- **Power plant:** only work permits get a follow-up, because outages have no person to call.
- **Travel:** the supplier follow-up needs the new `supplier` and `supplierPhone` fields on Booking.

---

## 6. Data model

### Part 1 migration

`records` gains:

| Column | Type | Meaning |
|---|---|---|
| `source` | text `manual \| call \| agent \| sample`, not null, default `manual` | how the item came in |
| `source_ref` | uuid | the call id (call) or the tool call id (agent; resolved to the case for display) |
| `updated_by` | uuid | principal who last changed it, null for calls and agents |
| `updated_via` | text `manual \| call \| agent \| system` | how it was last changed |
| `updated_ref` | uuid | call or tool call of the last change |
| `checked_by` | uuid | principal |
| `checked_at` | timestamptz | null = not checked |
| `check_note` | text | |
| `checked_problems` | text[] not null default `{}` | acknowledged problem keys |

Index `(tenant_id, workspace_id, entity, source)`.

**Backfill** of existing rows:

- `sample` where `records.created_at = workspaces.created_at`. Samples are seeded in the install transaction, so they share its `now()`.
- `agent` where the item's `record.created` audit event has actor kind `agent`.
- `manual` otherwise.

Everything starts not checked.

**How items are saved:**

- `RecordsService.create` takes the source.
- `seedSamples` passes `sample`. It now seeds referenced entities first and fills reference fields with the id of a sample item of that type.
- The connector passes `agent` with the tool call id.
- `createFromApi` passes `manual`, and marks the item checked when the session is an owner or admin.

### Part 2 migration

Every new table is tenant-scoped with row-level security, like the rest; `tenant-isolation.spec.ts` fails otherwise.

- **`calls`:**
  - `staff_id` becomes nullable;
  - adds `contact_name`, `contact_phone`, `record_id` (→ records, on delete set null) and `follow_up` (text, `<register>.<follow-up id>`);
  - a check constraint requires `staff_id` or `contact_phone`.

  The list and get queries in `CallsService` change their inner join on `staff` to a left join.
- **`record_notes`:** `id`, `tenant_id`, `record_id` (cascade), `call_id` (set null), `kind` (`said | promise | dispute | wrong_number | difference`), `speaker`, `said`, `proposed` jsonb, `promise_on` date, `status` (`new | applied | dismissed`), `decided_by`, `decided_at`, `created_at`.
- **`follow_up_switches`:** `tenant_id`, `workspace_id`, `follow_up`, `enabled`, `changed_by`, `changed_at`; primary key `(tenant_id, workspace_id, follow_up)`.
- **`follow_up_attempts`:** `tenant_id`, `record_id` (cascade), `follow_up`, `tries`, `last_call_at`, `next_due_on`, `state` (`active | waiting_for_you | stopped`); unique `(record_id, follow_up)`.
- **`do_not_call`:** `tenant_id`, `phone` (digits only, last 10), `reason` (`asked | wrong_number`), `record_id`, `call_id`, `created_at`; unique `(tenant_id, phone)`. A wrong number blocks that number only; if the party's phone is corrected, the new number can be called.
- **`TenantSettings.calls`** gains `partyHours: WorkingHours` and `followUpsPerDay: number`.

### Audit events

| Part | Events |
|---|---|
| 1 | `record.created` (now with `source`), `record.updated`, `record.checked` (with acknowledged keys and note), `record.removed`, `records.samples_removed` |
| 2 | `followup.switched`, `note.created`, `note.applied`, `note.dismissed`, `do_not_call.added`, and the existing `call.*` events for follow-up and collection calls |

Realtime publishes `records.changed { entity }` after commit, so an open list refreshes.

---

## 7. API

**Part 1** (all `@ManagersOnly()`):

| Method and path | What it does |
|---|---|
| `GET /lists` | Registers and other lists, with a card summary for each `{ count, countLabel, sum, sumLabel, problems, notChecked, newNotes }` (section 1) |
| `GET /lists/:id` | Query: `from`, `to`, `q`, `f.<field>=<value>` (repeatable), `source`, `show=problems \| not_checked \| checked \| new_notes`, `sort=<field>:<dir>`, `page`. Returns `{ items, total, totals, page, pageSize }`. Each item: `{ id, data, titles, source, updated, problems: [{ key, message, acknowledged }], checked, newNotes }` |
| `GET /lists/:id/items/:itemId` | The item with its history (its audit events) and notes |
| `POST /lists/:id/items` | Create |
| `PATCH /lists/:id/items/:itemId` | `{ data, note? }` |
| `POST /lists/:id/items/:itemId/check` | `{ note? }`; returns 400 without a note when there are unacknowledged problems |
| `POST /lists/:id/check` | `{ ids }`; returns `{ checked, skipped }` |
| `DELETE /lists/:id/items/:itemId` | `{ reason }` |
| `GET /lists/:id/export.csv` | The same filters as the list |
| `DELETE /lists/samples` | Removes sample items from every list |

**Part 2:**

| Method and path | What it does |
|---|---|
| `GET /lists/:id/follow-ups` | Switches and their state |
| `PUT /follow-ups/:followUp` | `{ enabled }`; owner only for party follow-ups |
| `POST /notes/:id/apply` | Apply a call note |
| `POST /notes/:id/dismiss` | Dismiss a call note |
| Calls endpoints | Unchanged; `CallRecord` gains `contact` and `about` (item title) |

The old `GET` and `POST /records/:entity` stay for the mobile app and members.

## 8. Web

**Part 1:**

- Nav: **Lists** under Cases (managers only); `/records` redirects to `/lists`.
- `/lists`: cards, then other lists, plus "Remove sample data".
- `/lists/:listId`: filters, table, totals, pagination, the item drawer, the new-item form (the existing schema-driven form), Download, bulk check.

All are lazy routes, using `@onehuman/schemas/plain` for run-time values and the Glow tokens.

**Part 2:**

- A Follow-ups panel on each list.
- Notes with Apply and Dismiss in the item drawer.
- Collection routines on the Routines page, with "pick the person".
- Calling hours and the daily cap in Settings → Calls.
- The phone simulator plays outside parties: it shows the contact's name and what the call is about.

## 9. Testing

Tests are written first, as always, and live in each section's `__tests__/`.

**Part 1:**

- **Unit (schemas, agent-kit):**
  - register and check validation (bad fields, wrong field types, unknown options);
  - default registers;
  - `packUpdates` adds entities, optional fields and registers, and never required fields;
  - every pack in `packs/` validates (`pack.test.ts`).
- **Unit (backend):**
  - the check-to-SQL compiler's output for each kind, including `when`, `factor`, tolerance and the blank and guarded-cast cases;
  - the problem-message formatting;
  - the CSV writer (BOM, formula escaping, quoting).
- **Integration (`master-ai-backend/__tests__/integration/`), on Postgres:**
  - `lists.spec.ts`: each check kind against real rows, including the duplicate pair, overdue with India dates, expiring, and the reference not found; totals across pages; filters and date ranges; the came-in source for by-hand, agent and sample items; history; an owner edit marks checked; a member or agent edit clears checked; a check with problems needs a note; acknowledged keys versus a new problem; bulk check skips problem items; remove is audited with a copy; sample removal; members get 403; another tenant's items are never visible.
  - `sector-lists.spec.ts`: every one of the 15 types installs, and every register and default list runs with its filters and checks without an SQL error (this catches a bad check in any pack).
- **Browser (Playwright):** the head opens Lists, filters bills to unpaid this month and sees the totals, opens the bill with the wrong total, fixes it, and marks it checked; Download gives a CSV. Includes the 390px phone project.
- **`e2e:sectors`:** each type's main lists are present and return their sample items.

**Part 2:**

- **Unit:**
  - `CollectEngine` script turns: field order, defaults, spoken numbers and dates, one, several and no reference matches, read-back yes and no, a repeat with differences, the item limit, call back later;
  - `FollowUpEngine`: identity first (no details before yes), each outcome row, staff status matching;
  - calling-hours maths (party hours ∩ legal window ∩ the follow-up's hours, including the lender's 8:00–19:00);
  - the due-item selection.
- **Integration:**
  - `follow-ups.spec.ts`: switches are owner-only for parties; the sweep picks due items and skips do-not-call, not-yet-due and waiting-for-you items; max tries gives the problem; the daily cap; apply and dismiss of notes; a promise makes the item due again after its date; a staff call updates the item and clears checked;
  - `collection.spec.ts`: a simulated call adds items with source `call`, keeps confirmed items when the call drops, and records a difference instead of a duplicate.

  The Temporal recorder stands in for workflows, as in the existing harness.
- **Browser:** a simulated collection call adds bills; a simulated follow-up records "will pay Friday", and the head applies it.
- **`pnpm smoke`:** extended with one collection call and one follow-up in offline mode.

## 10. Build order, docs, and what's left out

**Part 1 plan:**

- the pack format;
- the new entities, fields and update additions;
- the pack content for all 15 types (lists and checks);
- the records migration and backfill, source and checked handling, and audited updates;
- the check compiler;
- the lists service and API;
- the web Lists pages;
- the generator's `main_lists`;
- tests;
- ADR 0012 "Lists and checks";
- docs: README, `docs/testing.md`, and a CLAUDE.md rule that checks are app-side only and only people mark items checked.

**Part 2 plan:**

- collection routines;
- the calls table changes and `CallsService` routing (calls with `checkin_id` → `RoutinesService`, which handles both kinds of routine; calls with `record_id` → `FollowUpsService`; the rest → `DelegationService`);
- notes;
- follow-ups (format, content, switches, attempts, do-not-call, the sweep, the call workflow and the engine);
- settings;
- the web additions;
- tests;
- ADR 0013 "Calls to outside parties";
- docs:
  - CLAUDE.md rules: what an outside party says is never applied without the head, and new call purposes plug into `CallsService`;
  - `docs/production-readiness.md`: before real outside calls go live, confirm the number series TRAI requires for service calls, and register the caller ID.

**Left out (later parts or known gaps):**

- lists in the phone app;
- role holders seeing their own list;
- WhatsApp or SMS reminders;
- importing bills from Tally or Excel, and reading bill photos;
- the generator writing checks or follow-ups for own-words types;
- bulk edit;
- automatic numbering of new items.

---

## Appendix A — lists per organization type

How to read the rules in this appendix:

- `?` = a `when` condition. "open" lists the statuses meant.
- **Card** = the card's figure: `Σ field ? …` is the sum with its `when`, `count ? …` is the count with its `when`, and "label" is its label. Without a count figure, the card counts this month (or all items when there is no date).
- "Main" lists show as cards; the rest of the pack's entities appear as default lists.
- **Follow-ups:** `P` = a party (outside) follow-up, `S` = a staff follow-up.
- **Collection** = the routine's time, who it calls, and the fields it asks for (defaults in brackets).

### Wholesale & retail (`wholesale-retail`)

| List (entity) | Date | Card | Checks |
|---|---|---|---|
| **Bills** (Bill) | billDate | Σ total ? paymentStatus ∈ unpaid, part-paid · "unpaid" | missing(party, billDate, total) · adds_up(total = taxableValue + gstAmount, ±1) · duplicate(billType, billNo, party) · overdue(dueDate) ? paymentStatus ∈ unpaid, part-paid |
| **Orders** (Order) | orderedAt | count ? status ∈ new, confirmed, on-hold, packed, shipped · "open" | missing(customerName, items) · overdue(neededBy) ? status ∈ new, confirmed, on-hold, packed, shipped |
| **Parties** (Party) | — | Σ outstanding · "outstanding" | missing(phone) · limit(outstanding ≤ creditLimit) |
| **Products** (Product) | — | count | limit(stock ≥ reorderLevel) · expiring(nearestExpiry, 30) |

- **Follow-ups:**
  - **P "Unpaid bills → the party":** overdue dueDate ? billType = sales invoice, paymentStatus ∈ unpaid, part-paid. Phone and contact via `party` → Party.phone / name. About billNo, billDate, total, dueDate. Finds out paymentStatus, paymentRef.
  - **P "Late purchase orders → the supplier":** overdue neededBy ? orderType = purchase order, status ∈ confirmed, on-hold, shipped. Phone `phone`, contact `customerName`. About orderNo, items, neededBy. Finds out status, neededBy.
- **Collection:** "Today's bills". Mon–Sat 18:00, the billing clerk. Asks billNo, billType, party, total, gstAmount, dueDate [billDate = today].

### Logistics (`logistics`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Shipments** (Shipment) | bookingDate | count ? status ∈ loaded, in-transit · "on the road" | missing(consigneePhone, truckNumber) · missing(ewayBillNumber) ? declaredValue above 50000, why "e-way bill needed above ₹50,000" · duplicate(lrNumber) · overdue(promisedDelivery) ? status ∈ booked, loaded, in-transit · expiring(ewayBillValidUntil, 1) ? status ∈ loaded, in-transit |
| **Claims** (Claim) | noticeDate | Σ claimAmount ? status ∈ received, survey, offer-made · "open" | limit(settledAmount ≤ claimAmount) · limit(claimAmount ≤ declaredValue) · duplicate(claimNumber) |
| **Trucks** (Truck) | — | count | expiring(permitValidUntil / fitnessValidUntil / insuranceValidUntil / pucValidUntil, 30) |
| **Drivers** (Driver) | — | count | expiring(licenceValidUntil, 30) · missing(idChecked) |

- **Follow-up:** **P "POD not received → the consignee"**: overdue deliveredAt +3 days ? status = delivered, podReceived = false. Phone `consigneePhone`, contact `consigneeName`. About lrNumber, deliveredAt. Finds out podReceived, podRemarks.
- **Collection:** "Today's LRs". Mon–Sat 19:00, the booking clerk. Asks lrNumber, consigneeName, fromCity, toCity, packages, freight, paymentTerms, truckNumber [bookingDate = today].

### Travel agency (`travel-agency`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Bookings** (Booking) | date | Σ amount ? paymentStatus ∈ unpaid, requested · "unpaid" | missing(phone) · overdue(date) ? status ∈ requested, held |
| **Trips** (Trip) | startDate | count ? status ∈ booked, travelling | limit(endDate ≥ startDate) |
| **Suppliers** (Supplier) | — | count | missing(phone) |

- **Follow-up:** **P "Held bookings → the supplier"**: expiring date 7 days ? status = held. Phone `supplierPhone`, contact `supplier`. About service, date, partySize. Finds out status.
- **Collection:** "New bookings". Mon–Sat 19:00, the sales desk. Asks customerName, phone, service, date, partySize, amount, supplier.

### IT services (`it-services`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Tickets** (Ticket, new) | raisedAt | count ? status open (new, assigned, in-progress, waiting-for-client, reopened) | missing(clientName, assignedTo) · overdue(dueBy) ? open · duplicate(ticketNo) |
| **Incidents** (Incident) | noticedAt | count ? status ∈ open, contained | missing(certInReportedAt) ? kind ∈ security, data-breach, why "CERT-In must be told within 6 hours" · missing(clientToldAt) · missing(rootCause) ? status ∈ rca-sent, closed |
| **Assets** (Asset) | — | count | expiring(warrantyEndsOn, 30) · missing(wipeCertificate) ? status ∈ retired, recycled |
| **Contracts** (Contract) | startsOn | Σ monthlyFee ? status = active · "a month" | expiring(endsOn, 45) |

- **Follow-up:** **S "Overdue tickets → the engineer"**: overdue dueBy ? open. Staff `assignedTo`. About ticketNo, clientName, summary, dueBy. Finds out status, dueBy.
- **Collection:** "New tickets". Mon–Sat 17:30, the helpdesk lead. Asks clientName, summary, kind, priority, raisedBy, assignedTo, dueBy [raisedAt = now].

### Software / SaaS (`software-saas`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Tickets** (Ticket, new) | reportedAt | count ? status open (new, triaged, in-progress, waiting-for-customer) | missing(account, assignedTo) · overdue(dueBy) ? open · duplicate(ticketNo) |
| **Incidents** (Incident) | startedAt | count ? status ∈ open, contained | missing(certInReportedAt) ? kind ∈ security, data-leak, why "CERT-In must be told within 6 hours" · missing(rootCause) ? status ∈ resolved, review-done |
| **Releases** (Release) | plannedAt | count ? status ∈ planned, approved | missing(rollbackPlan, approvedBy) ? status ∈ approved, released · missing(customersToldOn) ? downtimeExpectedMinutes above 0 |
| **Payments** (Payment) | invoiceDate | Σ amount ? status ∈ due, failed · "due" | duplicate(invoiceNumber) · overdue(invoiceDate +15) ? status ∈ due, failed |

- **Follow-ups:**
  - **S "Overdue tickets → the engineer"**: the same as IT services.
  - **P "Unpaid invoices → the customer"**: overdue invoiceDate +15 ? status ∈ due, failed. Phone via lookup CustomerAccount where companyName = account → phone. Contact `account`. About invoiceNumber, invoiceDate, amount. Finds out status, reference.
- **Collection:** "New tickets". Mon–Fri 17:30, the support lead. Asks account, summary, kind, severity, reportedBy, assignedTo [reportedAt = now].

### Digital agency (`digital-agency`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Deliverables** (Deliverable) | dueDate | count ? status open (in-progress, internal-review, with-client, changes-asked, on-hold) | overdue(dueDate) ? open · limit(roundsUsed ≤ roundsIncluded) · limit(hoursSpent ≤ hoursEstimated) · missing(clientApprovedBy) ? status ∈ cleared-to-publish, live |
| **Invoices** (Invoice) | invoiceDate | Σ amount ? status ∈ sent, part-paid, overdue · "unpaid" | duplicate(invoiceNumber) · overdue(dueDate) ? status ∈ sent, part-paid, overdue |
| **Scopes** (Scope) | startDate | count ? status = active | missing(clientApprovedOn) ? status ∈ approved, active |

- **Follow-up:** **P "Unpaid invoices → the client"**: overdue dueDate ? status ∈ sent, part-paid, overdue. Phone via lookup Customer where name = client → phone. Contact `client`. About invoiceNumber, invoiceDate, amount, dueDate. Finds out status.
- **Collection:** "New jobs". Mon–Sat 18:00, the account manager. Asks client, title, kind, dueDate, hoursEstimated.

### Construction (`construction`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Site issues** (SiteIssue, new) | raisedOn | count ? status ∈ open, in-progress · "open" | missing(engineer) · overdue(dueBy) ? status ∈ open, in-progress |
| **Contractor bills** (ContractorBill, new) | receivedOn | Σ netPayable ? status ∈ received, measuring, certified, approved, part-paid, disputed · "to pay" | adds_up(netPayable = thisBill − retention − tds − otherDeductions) · limit(previouslyBilled + thisBill ≤ workOrderValue) · duplicate(contractor, project, raBillNumber) · overdue(dueDate) ? status ∈ certified, approved, part-paid |
| **Units** (Unit) | agreementDate | count ? status ∈ booked, agreement-signed | overdue(possessionDate) ? status ∈ booked, agreement-signed, ready-for-possession · missing(buyerMobile) ? status ∈ booked, agreement-signed |
| **Workers** (Worker) | — | count ? status = working | missing(bocwNumber) ? status = working, why "BOCW registration" · expiring(healthCheckDueOn, 15) |
| **Contractors** (Contractor) | — | Σ retentionHeld · "retention held" | expiring(licenceValidTill, 30) · missing(labourLicenceNo) ? kind = labour-contractor |

- **Follow-up:** **P "Open site issues → the contractor"**: overdue dueBy ? status ∈ open, in-progress. Phone and contact via `contractor` → Contractor.phone / name. About issueNo, project, location, description, dueBy. Finds out status, dueBy.
- **Collections:**
  - "Site issues": Mon–Sat 18:00, the site supervisor. Asks project, location, kind, description, contractor, engineer, dueBy [raisedOn = today].
  - "Contractor bills": Sat 17:00, the QS. Asks contractor, project, raBillNumber, thisBill, retention, tds, netPayable [receivedOn = today].

### Power plant (`power-plant`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Work permits** (WorkPermit) | validTill | count ? status = issued · "open" | overdue(validTill) ? status = issued, why "time over but not returned" · missing(gasTestOk) ? permitType = confined-space · missing(earthsFixed) ? permitType ∈ electrical, line-clear · duplicate(permitNo) |
| **Outages** (Outage) | plannedStart | count ? status = in-progress | overdue(plannedEnd) ? status = in-progress · missing(noticeSent) ? consumersAffected above 0 · missing(ldcCode) ? status ∈ approved, in-progress |
| **Equipment** (Equipment) | — | count ? status = forced-outage · "forced out" | overdue(nextMaintenance) ? status ∈ in-service, standby |
| **Incidents** (Incident) | occurredAt | count ? status ∈ open, reported, investigating | missing(formASentAt) ? kind ∈ fatal, non-fatal, dangerous-occurrence, why "accident report to the Electrical Inspector" |

- **Follow-up:** **S "Permits past their time → the permit holder"**: overdue validTill ? status = issued. Staff `receivedBy`. About permitNo, equipment, validTill. Finds out status.
- **Collection:** "Permits issued today". Daily 20:00, the shift in-charge. Asks permitNo, permitType, equipment, receivedBy, crewCount, validTill.

### Manufacturing plant (`manufacturing-plant`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Production orders** (ProductionOrder) | dueDate | count ? status ∈ released, running · "running" | overdue(dueDate) ? status ∈ planned, released, running, on-hold · limit(rejectedQty ≤ producedQty) · duplicate(orderNo) |
| **Quality issues** (QualityIssue) | foundOn | count ? status ∈ open, contained, capa-open | overdue(capaDue) ? status ∈ open, contained, capa-open · missing(decidedBy) ? disposition = use-as-is-concession · missing(rootCause) ? status = closed |
| **Machines** (Machine) | — | count ? status = stopped · "stopped" | overdue(nextPmDue) ? status ∈ running, standby · overdue(statutoryTestDue) |
| **Safety incidents** (SafetyIncident) | occurredAt | count ? status ≠ closed (open, investigating, actions-open) | missing(noticeSentAt) ? reportable = true, why "Factories Act notice" · missing(esiReportSentAt) ? daysLost above 0 |

- **Follow-up:** **S "Open quality issues → the owner"**: overdue capaDue ? status ∈ open, contained, capa-open. Staff `owner`. About partNo, lotNo, defect, capaDue. Finds out status, capaDue.
- **Collection:** "Quality issues found today". Mon–Sat 18:30, the QC in-charge. Asks partNo, lotNo, defect, qtyAffected, foundAt, owner [foundOn = today].

### Hospital (`hospital`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Visits** (Visit) | arrivedAt | Σ finalBill · "billed" | missing(finalBill) ? status ∈ discharge-ordered, left · limit(advancePaid ≤ finalBill), why "refund due" · missing(consentSigned) ? visitType ∈ day-care, admission · missing(summaryGiven) ? status = left · duplicate(visitNumber) |
| **Cashless requests** (CashlessRequest) | sentAt | Σ amountAsked ? status ∈ sent, query · "waiting" | limit(amountApproved ≤ amountAsked) · overdue(sentAt +1) ? status = query |
| **Appointments** (Booking) | date | count ? status ∈ requested, held, confirmed | overdue(date) ? status ∈ requested, held |
| **Incidents** (Incident) | occurredAt | count ? status ∈ reported, under-review, actions-agreed | missing(familyTold) ? harm ∈ moderate, severe, death · missing(rootCause) ? status ∈ actions-agreed, closed |

- **Follow-up:** **P "Cashless queries → the TPA"**: overdue sentAt +1 ? status = query. Phone `tpaPhone`, contact `insurerOrTpa`. About visitNumber, packageCode, amountAsked. Finds out status, amountApproved.
- **Collection:** "Cashless requests sent today". Daily 19:00, the TPA desk. Asks patientName, visitNumber, payer, insurerOrTpa, requestType, amountAsked [sentAt = now, status = sent].

### Education (`education`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Fee accounts** (FeeAccount) | nextDueDate | Σ due · "due" | adds_up(due = totalFee − concession − paid) · overdue(nextDueDate) ? due above 0 · limit(concession ≤ totalFee) · missing(concessionReason) ? concession above 0 |
| **Enrolments** (Booking) | date | count | missing(phone) |
| **Students** (Customer) | admittedOn | count ? status = studying | missing(parentName, phone) · limit(attendancePercent ≥ 75) ? status = studying |
| **Assets** (Asset) | — | count ? status ∈ under-repair, off-road · "out of use" | expiring(fitnessUntil / insuranceUntil / permitUntil / amcUntil, 30) · missing(gpsWorking, cctvWorking, attendantOnBoard) ? assetType ∈ bus, van, why "school transport safety rules" |
| Staff members (StaffMember), not main | — | — | missing(policeVerified, safetyTrained) |

- **Follow-up:** **P "Fees due → the parent"**: overdue nextDueDate +7 ? due above 0. Phone via lookup Customer where admissionNumber = admissionNumber → phone. Contact via the same lookup → parentName. About studentName, academicYear, due, nextDueDate. Finds out paid.
- **Collection:** "New enrolments". Mon–Sat 17:00, the admissions office. Asks customerName, phone, service, date, amount.

### Municipal (`municipal`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Service applications** (ServiceApplication) | receivedOn | count ? status open (received, papers-pending, inspection, sanctioned) | overdue(dueBy) ? open, why "Right to Services deadline" · missing(designatedOfficer) · duplicate(applicationNo) |
| **Properties** (Property) | — | Σ arrears · "arrears" | overdue(lastPaidOn +365) ? arrears above 0 |
| **Trade licences** (TradeLicence) | validTill | count ? status = active | expiring(validTill, 30) · overdue(validTill) ? status = active |

- **Follow-up:** **S "Overdue applications → the officer"**: overdue dueBy ? open. Staff `designatedOfficer`. About applicationNo, service, applicant, dueBy. Finds out status.
- **Collection:** "Applications received today". Mon–Sat 17:30, the counter clerk. Asks service, applicant, phone, ward, designatedOfficer [receivedOn = today].

### Lender (`lender`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Repayments** (Repayment) | dueDate | Σ amountDue ? status ∈ due, bounced, part-paid, promised · "outstanding" | limit(amountPaid ≤ amountDue) · overdue(dueDate) ? status ∈ due, bounced, part-paid · overdue(promiseToPayOn) ? status = promised · missing(receiptNumber) ? mode = cash, status ∈ paid, part-paid |
| **Loans** (Loan) | disbursedOn | Σ principalOutstanding · "outstanding" | limit(amountSanctioned ≤ amountAsked) · missing(sanctionedBy) ? status ∈ sanctioned, disbursed · duplicate(loanNumber) |
| **Collateral** (Collateral) | valuedOn | Σ value ? status = held · "held" | missing(chargeRegistered, originalsKeptAt) ? securityType = property · missing(packetNumber) ? securityType = gold |

- **Follow-ups:** both have **hours 08:00–19:00** (RBI's recovery-call hours).
  - **P "Missed repayments → the borrower"**: overdue dueDate +1 ? status ∈ due, bounced, part-paid. Phone `borrowerPhone`, contact `borrowerName`. About loanNumber, dueDate, amountDue. Finds out status, amountPaid, mode.
  - **P "Broken promises → the borrower"**: overdue promiseToPayOn ? status = promised. The rest as above.
- **Collection:** "Cash collections". Mon–Sat 18:30, the field officer. Asks loanNumber, borrowerName, amountPaid, receiptNumber [mode = cash, status = paid, paidAt = now].

### Accounting firm (`accounting-firm`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Filings** (Filing) | dueDate | count ? status open (not-started, waiting-for-client, prepared, in-review, client-approval) | overdue(dueDate) ? open · overdue(internalDeadline) ? open · missing(reviewedBy, acknowledgementNo) ? status ∈ filed, verified, closed |
| **Tax notices** (TaxNotice) | noticeDate | count ? status ∈ received, drafting, partner-review | overdue(replyDueDate) ? status ∈ received, drafting, partner-review · expiring(replyDueDate, 7) ? the same · missing(verified), why "check the notice is genuine" · duplicate(referenceNo) |
| **Signed reports** (SignedReport) | signedOn | count | missing(udin) ? signedOn filled, why "UDIN within 60 days of signing" |

- **Follow-up:** **P "Papers the client hasn't sent → the client"**: expiring dueDate 10 days ? status = waiting-for-client. Phone via lookup Customer where name = client → phone. Contact `client`. About filingType, period, dueDate. Finds out a promise date only.
- **Collection:** "New tax notices". Mon–Fri 17:30, the office manager. Asks client, authority, noticeType, period, noticeDate, replyDueDate, referenceNo.

### NGO (`ngo`)

| List | Date | Card | Checks |
|---|---|---|---|
| **Vouchers** (Voucher) | paidOn | Σ amount · "paid out" | missing(approvedBy) ? status ∈ approved, paid · limit(quotations ≥ 3) ? amount above 25000, why "three quotations above ₹25,000" · duplicate(voucherNumber) |
| **Donations** (Donation) | receivedOn | Σ amount · "received" | missing(panOrId, certificateSentOn) · limit(amount ≤ 2000) ? mode = cash, why "cash donations above ₹2,000 get no 80G deduction" · duplicate(receiptNumber) |
| **Grants** (Grant) | startDate | Σ amountAgreed ? status = active · "active" | limit(spentToDate ≤ receivedToDate) · limit(adminSpent ≤ 0.2 × receivedToDate) ? isForeign = true, why "FCRA: admin costs up to 20%" · overdue(nextReportDue) ? status ∈ signed, active, closing · expiring(nextReportDue, 15) ? the same |
| **Beneficiaries** (Beneficiary) | — | count ? status = served | missing(consentOn) |

- **Follow-up:** **S "Grant reports due → the programme lead"**: expiring nextReportDue 15 days ? status ∈ signed, active, closing. Staff `programmeLead`. About grantCode, donorName, nextReportDue. Finds out nextReportDue.
- **Collection:** "Donations received today". Mon–Sat 18:00, accounts. Asks donorName, amount, mode, panOrId, purpose [receivedOn = today].

---

## Appendix B — new record types and fields

### IT services `Ticket`

Title `summary`; list columns: ticketNo, clientName, summary, priority, assignedTo, status.

| Field | Type |
|---|---|
| ticketNo | string |
| clientName | string, required |
| raisedBy | string |
| kind | enum fault, service-request, access-request, bug, change, task |
| summary | string, required |
| details | text |
| priority | enum P1, P2, P3, P4 |
| assetTag | string |
| assignedTo | string |
| raisedAt | datetime |
| dueBy | datetime |
| resolvedAt | datetime |
| resolution | text |
| status | enum new, assigned, in-progress, waiting-for-client, resolved, closed, reopened |

### Software / SaaS `Ticket`

Title `summary`; list columns: ticketNo, account, summary, severity, assignedTo, status.

| Field | Type |
|---|---|
| ticketNo | string |
| account | string, required |
| reportedBy | string |
| kind | enum bug, support-question, feature-request, billing, data-request |
| summary | string, required |
| details | text |
| severity | enum P1, P2, P3, P4 |
| assignedTo | string |
| reportedAt | datetime |
| dueBy | datetime |
| fixVersion | string |
| resolvedAt | datetime |
| status | enum new, triaged, in-progress, waiting-for-customer, fixed, released, closed, wont-fix |

### Construction `SiteIssue`

Title `description`; list columns: issueNo, project, location, kind, contractor, dueBy, status.

| Field | Type |
|---|---|
| issueNo | string |
| project | string, required |
| location | string |
| kind | enum snag, material-shortage, delay, safety, quality, labour, design-query, other |
| description | text, required |
| raisedBy | string |
| raisedOn | date |
| contractor | reference → Contractor |
| engineer | string |
| dueBy | date |
| costImpact | money |
| delayDays | integer |
| closedOn | date |
| status | enum open, in-progress, fixed, verified, closed |

### Construction `ContractorBill`

Title `billNo`; list columns: billNo, contractor, project, raBillNumber, thisBill, netPayable, status.

| Field | Type |
|---|---|
| billNo | string |
| contractor | reference → Contractor, required |
| project | string, required |
| workOrderNo | string |
| period | string |
| raBillNumber | integer |
| receivedOn | date |
| workOrderValue | money |
| previouslyBilled | money |
| thisBill | money, required |
| retention | money |
| tds | money |
| otherDeductions | money |
| netPayable | money |
| measuredBy | string |
| certifiedBy | string |
| certifiedOn | date |
| dueDate | date |
| paidOn | date |
| paymentRef | string |
| status | enum received, measuring, certified, approved, part-paid, paid, disputed, rejected |

### New optional fields on existing types

| Pack | Entity | New fields |
|---|---|---|
| travel-agency | Booking (redeclared with every bookings-base field) | supplier (string), supplierPhone (phone) |
| hospital | CashlessRequest | tpaPhone (phone) |
| lender | Repayment | borrowerName (string), borrowerPhone (phone) |
| manufacturing-plant | QualityIssue | foundOn (date), owner (string) |
| ngo | Grant | programmeLead (string) |

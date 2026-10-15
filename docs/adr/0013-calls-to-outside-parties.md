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
- **One follow-up call at a time per company, up to a daily cap**, from a half-hourly Temporal Schedule (`follow-ups-<tenant>`) that exists only while a follow-up is on. A call that is unanswered `max_tries` times stops the follow-up for that item with a note for the head. Every gate (pause of the company or workspace, the switch, calling hours, do-not-call, a note waiting for the head, the item still being due) is checked when the sweep picks an item and again just before the call rings; a call stopped then is cancelled with the reason and does not count as a try. A picked item is not due again before tomorrow, so a call that fails half way is never rung twice in a day. Sample items are never called.
- **Scripts decide, models only listen.** Both calls are scripts. With a model, the model reads each reply into a zod shape (one repair round); the script checks every value and decides every line and effect.
- **Calls have one owner.** `CallsService` hands each call to the service its link names: `follow_up` → `FollowUpCallsService`, `checkin_id` → `RoutinesService`, otherwise `DelegationService`.

## Consequences
- A new kind of call about list items is pack YAML plus, at most, new wording in an engine; `pack.test.ts` checks every path.
- Calls table rows may have no team member (`staff_id` null, `contact_phone` set); a check constraint requires one of them.
- The head's "New from calls" filter and the notes' Apply/Dismiss are the only way outside answers reach records, so a busy head can leave notes unread and follow-ups wait for them.
- Two audit events join the spec's list: `call.scheduled` when a follow-up call is planned, and `call.cancelled` when a gate stops it before it rings.
- Real outside calls need the number series and caller ID India requires for service calls before they go live (see [production readiness](../production-readiness.md)).

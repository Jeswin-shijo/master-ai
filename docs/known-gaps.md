# Known gaps

Things the build doesn't handle yet. Reviews found them while Plans 2–6 were built, and each was left for later because it is small, rare or needs a decision. Each line says what a person would notice. None of them lets someone decide what they shouldn't, or loses a decision.

What's left before going live (hosting, backups, sessions, monitoring) is in [Production readiness](production-readiness.md).

## Cases and the 8 stages
- Cancelling a case at the moment a stage starts can leave that stage running for a while; the cancel isn't passed on to it.
- The reason given when cancelling a case isn't kept.
- Details added while the review is already running are read on the next round, not the current one.
- If the signal carrying a decision is lost, the gate waits until it expires and the case is escalated.
- A step that is retried can write its audit line twice.
- Pausing at the exact moment a stage resumes can miss the pause.
- If Temporal is down when a case is created, the case is saved but doesn't start.
- Cancelling a case that has just finished answers with its old state.
- The public form's page and its sending share one rate limit.
- A note the owner writes on a case can reach the customer who sent it through the public form.
- When the main model fails and a smaller one answers, the audit log doesn't say so.
- Cancelled cases count as finished within their deadline in reports.
- When a case's work fails (for example the AI service keeps refusing requests), its stage-6 dot still shows as finished next to "The work stopped before it finished", and phone calls already handed to staff for that work carry on.
- Case titles keep a final full stop and can be cut after "St.".
- Approval summaries put the case type in lower case, so short forms read oddly ("Approve ca certificates for ASG-0001").
- Amounts are read from the request, not worked out from records (order lines × price list).

## Roles and invites
- The approvals list is cut at 200 before it is filtered to *Mine*, so in a very busy company some of yours can be missing.
- Two people accepting invites with the same email at the same moment can get an error instead of one joining.
- The owner can't link their own team-directory record to their login, and linking a record that is already linked moves it without a warning.
- Opening an invite needs the company's setup to be installed.
- Nobody gets a push when someone joins as an admin or approver.
- "Needs details" pushes go to the owner and admins, not to the person who filed the case.
- Some errors show ids; a few phrases read oddly ("The owner rejected", "1 decision need you").
- `WEB_URL` isn't checked when the API starts.
- Two-tier approval (a role, then the owner for very large amounts) isn't supported.

## Web app
- Dialogs and the side drawer don't keep keyboard focus inside them, or return it when closed.
- Text inputs are 36px tall at phone width, under the 44px target.
- Some errors show raw field names ("amountInr: …"), and the public form's error text is technical.
- The company's brand colour barely shows.
- Owner-only pages open by URL for members; the server refuses everything on them.
- With the system theme on a light phone or computer, the dark glows stay.
- Gate cards repeat their reason, and say "track record".
- The case page checks for changes every 5 seconds as well as listening live.
- Nothing tests the live stage's spin with reduced motion.
- Red Hat Display bold is synthesized in one place.
- Canvas labels are under 13px near 1024px wide.
- Stage-dot links have long names for screen readers.
- Stopped cases show different dots in the list and on the canvas.
- The names of nodes that need details show outside the requester's view.
- The Agents page header repeats.
- An empty "Needs: ." line can show.
- Case search isn't on the server: outside the open tabs, the list shows the newest 200.

## Mobile app
- In reject mode, Approve stays visible and there's no Cancel.
- Agent jobs has no back button.
- A few screens read names from the first workspace instead of the case's own.
- The Approvals badge also counts decisions already queued offline.
- `pnpm e2e:mobile` doesn't restore Android's animations if interrupted with Ctrl-C.
- On iPhone the keyboard may cover the rejection note (not checked on iOS).
- The Cases list isn't virtualised, and the case screen checks every 5 seconds.
- Some wording is stale; the colour guard misses rgba and named colours; sending queued decisions isn't tested across two people.
- One approval reason line can name a tool (the policy engine's earned-autonomy line).
- A decision queued offline is dropped if the session expired meanwhile.
- Saved approvals aren't encrypted on the phone.

## Sector content
- Some approval reasons show role names in lower case.
- Everyday words can make a request P1 ("fire extinguisher refill", "smoke detector testing").
- `pnpm pack:check` skips the quality bar when a draft has no `sector:`, and fails on paths with spaces.
- Nothing enforces that every category has test-set requests, or pins worked examples to the pack's rules.
- The travel-agency upgrade test uses the new pack as the old snapshot.
- Some case labels differ from the design's Appendix A, and composed packs can pick odd labels.

## With Gemini (a free key)
Found in live runs on 14 October 2026 with a free Gemini key, every tier on Flash-Lite (`gemini-3.5-flash-lite`). They describe Gemini's judgement, not Claude's, which the prompts were written for. Rerun with `pnpm e2e:sectors` while `pnpm dev` has a key.
- A free key allows 15 requests a minute per model, 20 Flash requests a day and a few hundred Flash-Lite requests a day, and no Pro. One full live run of the five organizations uses most of a day's Flash-Lite allowance. When it runs out, the work stops and the cases escalate with "Stopped before it finished".
- Scoring five organization types, the categories matched the test sets except one travel request, filed as a group tour instead of a customer order. Most review answers fell back to the rules once the Flash allowance ran out.
- A lender's truck repossession was judged not eligible because no notice had gone to the borrower first. The test set expects it to go ahead.
- A software release was refused because the sample records hold an open P1 incident. This is arguably right; the test set expects the release to go ahead.
- A travel cancellation ran out of agent steps: Flash-Lite kept calling tools without finishing.
- A power-plant job took over ten minutes at 12 model calls a minute and ended escalated with its work only partly done.
- Passed end to end: the hospital discharge in both full runs, and the power-plant job in one.

## Questions for an expert
The sector content was researched from public sources, not reviewed by people who work in these sectors. These calls need one:
- Energy: should near misses be P1 or P3?
- Manufacturing: should planned shutdowns be approved by the shift in-charge rather than the plant head?
- Construction snags and GST time-bars depend on dates; rules that read dates need code.
- IT services and digital agencies have no case type for police or court orders.
- NGOs and CA firms can name only one approving role per category.
- A proprietor CA firm's payment approver is called "finance manager".
- Software & SaaS: privacy officer or founder sign-off?
- Legal facts were taken from news summaries and need a lawyer's check: DPDP dates, the 2026 IT Rules, the TCS rate, DGCA, FCRA 2026, Income-tax Act 2025 sections.
- Municipal time limits use one state's list (Haryana).

## Sector lists, part 1

- On the phone, lists are for review and action only. Adding or editing items, follow-up switches, "Call now", totals by field and the CSV are on the web. Lists aren't saved for use without signal.
- Pushes about lists cover only a party's paid, dispute and wrong-number answers; the rest shows on the Lists badge. Pushes need a development or production build (not Expo Go).
- A role holder (accounts, site engineer) can't yet see only their own list; lists are for the owner and admins.
- Reference pickers in the item form offer the 100 most recently changed items of that type.
- A CSV download holds at most 10,000 items.
- A CSV cell that starts with `=`, `+`, `-` or `@` gets a leading `'` so a spreadsheet can't run it, so phone numbers like `+91…` show that quote in Excel. Cells that are plain numbers (a negative amount like -500) are left alone and stay numbers.
- Default lists (record types a pack gives no list) only check that references point at real items.
- A pack the model writes names its main lists but no checks.

## Sector lists, part 2 (the AI's calls)

- Calls about list items are in the web simulator and through Twilio; the phone shows them in its call list and their notes in Lists.
- A follow-up reads one item per call. A follow-up calls each number or team member at most once a day, about one item; a party with five overdue bills hears about them over five days, not in one call.
- Team members are matched to an item by name: an active person with exactly that full name, or — when the item gives only a first name — the one active person with it. An item naming someone not on the team, or with a misspelt surname, stops with a note for the head.
- The offline scripts understand everyday English replies; Hindi and Malayalam replies need a model.
- Members can't list, open or answer calls about list items, but the live updates every signed-in browser gets still carry their one-line summaries ("Call planned to Sri Ganesh Traders about S-1042").
- A collection routine's defaults and asked fields come from the pack; the owner can't change which fields are asked yet.
- Types described in the owner's own words get no follow-ups or collection routines from the generator.

### Left from the part 2 build

Reviews found these while part 2 was built, and a follow-up pass fixed most of the others. Each one left is small or rare, or it fails safe: the call asks again, waits, or leaves a note.

- **Spoken replies the offline script still misreads:**
  - "next Friday" said on a Thursday reads as tomorrow.
  - A dashed date next to "today" ("entered today, dated 12-10") reads as today. A date with a slash still wins.
  - "5k, sorry, 6k" reads as 5000.
  - "No, none today, will do two tomorrow" counts two.

  The read-back before each item is saved catches most of these.
- **Follow-ups:**
  - An unread promise note keeps its item from being called again until the head sees it. It counts as "waiting for you".
  - If Twilio times out after it has accepted a call, the call is marked failed while the phone still rings.
  - A number that keeps failing to connect is retried daily, and only the call log says why.
- **Setup:**
  - Switching follow-ups on and off at the same moment can leave the half-hourly sweep in the wrong state.
  - A new workspace from onboarding leaves an idle sweep running.
  - Errors keeping the sweep's schedule in step are only logged.
- **Lists:**
  - Sorting by a reference column looks up each row's title, which can be slow near 10,000 items.
  - A bulk selection survives switching to another list.
- **Packs:**
  - Lookup fields aren't type-checked.
  - A model-written pack with two follow-ups of the same id loses that list.

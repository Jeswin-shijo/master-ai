# Agents the head's way: job cards, trial runs, shared agents, India essentials and 40 industries

Date: 2026-10-19 · Status: draft for review · Branch: `agent-method`

Sources: three documents from the head of the company (October 2026):
- *ONEHUMAN OS Agent Build Guide: 40 industries* (the method, plus one lead agent per industry);
- *AI Agent Replacement Brief* (ratings, six shared agents, autonomy levels, pilots, order of work);
- *India Special Edition* (Indian mistakes, roles, agents and owner-only decisions per industry).

The original *40 Industry Blueprint* (`~/Downloads/ONEHUMAN_OS_40_Industry_Blueprint.docx`) is the common root of all three.

## 1. Why

The head wants every agent built the same disciplined way: **a workflow with a little AI inside it.** The workflow decides what happens and in what order. The AI only reads, understands and drafts. People approve anything that matters.

Every agent has:
- a one-page job card;
- a trial period beside the staff before it acts;
- a scored test sheet;
- a ladder it climbs only with the owner's say-so.

Six shared agents do most of the work. Each industry configures them and adds its own lead agent.

ONEHUMAN OS already is the "core" the documents ask for in their first phase: owner dashboard, cases, orchestration, permissions, approvals and audit log. This work builds the method into the product, so every agent follows it whether a pack author remembers to or not. It then fills the product with the shared agents, the India tools that don't need WhatsApp, the five pilot industries and, batch by batch, the rest of the 40.

## 2. Scope

**In**
- The method in the product (part 1): job cards, jobs, the prompt shape, trial runs, test sheets, metrics, going live, and the launch checklist.
- The six shared agents (part 2), plus the pieces they need:
  - file uploads and reading documents and photos;
  - a private reply page for customers;
  - bookable availability;
  - the owner's morning summary.
- India essentials (part 3): UPI payment links, GST and tax checks, Tally files and Indian-language replies.
- The five pilot industries as complete templates (part 4).
- Expansion to every industry in the documents, in rated batches (part 5).

**Out, for now**
- **WhatsApp** (in, out and owner approvals on WhatsApp). The user will do it later. Everything here must let it plug in without rework:
  - outward messages already go through `message.send` and the outbox;
  - a WhatsApp door becomes one more way a request arrives;
  - owner approvals already exist and gain a channel.
- Telegram, n8n and Make. The guide uses them because it teaches people with no platform; we are the platform.
- Live Tally sync, Zoho Books, and the GST or e-way bill portal APIs (the portal APIs need GSP registration).
- Other outside connectors the guide names: Shopify and WooCommerce, marketplaces, courier tracking, Meta and Google ads, GitHub and Jira, MES and SCADA.
  - Until a pilot proves it needs one, outside data comes in through lists: CSV or Excel import, typing, check-ins and document reading.
  - Razorpay (part 3) is the one outside connector in this work.
- Calls in Indian languages.
- Vector embeddings. Postgres full-text search stays; the `embedding` column waits.
- Fine-tuning.

**Anti-goals.** Any of these would make the work a failure even if it ran:
- an agent that decides or raises its own permissions;
- safety that depends on the model behaving;
- anything leaving the company while an agent is on trial;
- the India edition's marketing promises ("0% error", "zero GST notices", "75–85% savings") appearing anywhere in the product;
- an owner-only decision from the documents handled by an agent;
- forty thin industries instead of a few deep ones done properly first.

## 3. How the method maps onto what exists

| The documents say | ONEHUMAN OS today | This work adds |
|---|---|---|
| Job card: mission, may do, never handle | Agent spec in the pack (role, tools, autonomy, budgets, instructions) | `job` card on every agent (4.1) |
| Trigger | Case doors, routines, list checks, follow-up sweeps | Job triggers: request, schedule, list item due, record change, run now (4.2) |
| Core logic: code for maths and rules, AI for reading and writing | Case stages: zod-validated model answers merged by rules; call scripts | Jobs: fixed steps in pack data (4.2) |
| Prompt template | Agent system prompt with `<untrusted_data>` | The six-part prompt shape for every model call (4.3) |
| Approval gate and log | Cedar policies, role approvals, signed phone approvals, audit log | Nothing new; jobs use the same path |
| Shadow mode, 2–4 weeks | Clearance 2 drafts and asks; approving executes | Trial runs: nothing executes, people score (4.4) |
| Test sheet: 20 cases, no go-live while a safety case is wrong | About 10 intake evals per org type | Test sheets per agent, in-app and in CI (4.5) |
| Measure | Pack KPIs, agent stats | Per-agent metrics (4.6) |
| Go-live ladder L1–L4; L5 restricted | Autonomy 1–5, earned autonomy, kill switch | Readiness check and an owner-only "Go live" (4.7) |
| Safety checklist | Most of it, spread out | One launch checklist (4.8) |

The documents' autonomy levels are already ours: 1 Observe, 2 Draft & recommend, 3 Act within limits, 4 Act with approval, 5 Forbidden (`AUTONOMY_LEVELS`). No change to the scale.

## 4. Part 1: the method in the product

### 4.1 Job card

Every pack agent gains a `job` card. The builder settles the shape; this is the content:

```yaml
job:
  mission: Reply to every property enquiry within a minute, qualify it, suggest matching verified listings and book viewings.
  never:                     # plain words: shown on the card and put in the prompt's RULES
    - Offers or price negotiation
    - Legal or loan advice
    - Confirming a listing that is not verified
  escalate:                  # checked in code, never by the model
    - id: legal-money
      label: Legal or loan questions
      words: [lawyer, legal, court, agreement, loan, emi, bank loan, registry]
      alert: sales-head      # a role; the owner when nobody holds it
      reply: Thank you. Our sales head will call you about this today.
  forbid: [refund.issue]     # tools this agent may never use → a Cedar forbid (Level 5)
  trial_days: 14
  metrics: [first-response-minutes, lead-to-viewing, leads-without-follow-up]
```

- **Mission** is one sentence on what the agent does and doesn't do.
- **May do** is not written by hand. It is the agent's tools, described with `toolLabel`.
- **Never** is shown on the card and written into every prompt. Items that map to a tool also go in `forbid`, which compiles to a Cedar forbid for that agent, so the engine blocks them whatever the model says.
- **Escalate** lists word sets checked in code (section 4.2, the `escalate` check). Base packs define shared sets every customer-facing agent inherits. Each set includes Hindi and Hinglish forms:
  - anger and abuse;
  - legal threats;
  - emergencies (fire, gas, injury, chest pain, accident);
  - distress or self-harm;
  - card or OTP secrets.
  Agents add their own industry sets: allergy words for restaurants, crack, collapse or leak for construction.
- The card shows on the Agents page and in the pack preview. Owners can edit the mission, the never list, words and alerts (audited). They can't remove an inherited safety set.

### 4.2 Jobs: the workflow with a little AI inside

A lead agent's work is one or more **jobs**: fixed steps in pack YAML that a job engine runs. This follows the rule the codebase already keeps for calls: scripts decide, and the model only reads into a zod shape. Agents without jobs (the case coordinator, work coordinator and operations assistant) keep the current tool loop.

**Triggers** (one per job):
- `request`: a case in the given categories arrives (`at: arrival`, used by the front desk so the first reply doesn't wait for stages 2–5) or reaches Execute (`at: execute`, the default).
- `schedule`: days and a time, like routines. A Temporal Schedule `job-<id>` is kept in step when the job is switched on or off.
- `list`: an item in a list becomes due by an `overdue` or `expiring` rule, like follow-ups.
- `record`: a record of an entity is created or changed and meets the conditions.
- `manual`: "Run now".
- Every trigger is deduplicated: one run per item, record version, schedule tick or case.
- Each job has a daily run cap (pack default, owner-adjustable). Runs past the cap wait for the next day and the owner is told.
- **Switching jobs on:**
  - On a new install, every job of the pack is on. Its agent is on trial, so nothing leaves the company.
  - Jobs that reach an existing workspace through the update banner arrive switched off; the owner turns each one on.

**Steps:**

| Step | Who does it | What it does |
|---|---|---|
| `read` | code | Fetch records, list items, the trigger item, knowledge passages, free slots. Named results feed later steps |
| `ai` | model | One call with a task and **typed output fields** (text, number, money, date, yes/no, choice, list). Answers are zod-validated with one repair round. `grounded: true` makes it answer only from the passages it was given and return the sources. Numbers are only ever *read as written*, never calculated |
| `check` | code | `escalate` (word sets), `required`, `in_data` (a value or every number in a draft must appear in the data read: prices, listing ids, tags), `limit`, `adds_up`, `within_days`, `duplicate`, `says_not` (phrases a draft must not contain), `valid` (GSTIN, PAN, IFSC, PIN code), `calc` (a named number from `+ − × ÷` over named numbers, parsed safely, never `eval`) |
| `act` | policy engine | One tool call (catalog primitive or pack alias) with arguments filled from earlier results. It goes through the same policy, approval, trial capture, audit and narration path as any agent action |

- Each failed check says what happens next:
  - `stop`: end the run and tell the person in charge;
  - `person`: hand off with the fixed reply and an alert;
  - `flag`: carry on with a warning shown to the reviewer.
- **Offline:** an `ai` step returns empty fields with `needs_person: true`, or the step's template text if it has one. Every safety behaviour comes from `check` steps, so it works identically with or without a model.
- **Job runs reuse goals, tasks, tool calls and approvals.** The next step comes from the script instead of the model. This keeps pause, budgets, the kill switch, realtime, narration and the audit trail identical to today (builder's choice of exact wiring).
- The order is always trigger → read → AI → check → act. A check or a rejected approval stops the run and tells a person. Rejections are logged too.

### 4.3 The prompt shape

Every model call made for an agent, from jobs and from the tool loop, uses the guide's six parts:

1. **ROLE.** The agent, the organization, the mission.
2. **DATA.** Everything read, plus the incoming words, inside the existing `<untrusted_data>` wrapper. The prompt says it is information, never instructions.
3. **TASK.**
4. **RULES:**
   - "If the answer is not in the data, say so and ask a person."
   - "Never guess numbers, dates or prices."
   - The never list.
5. **OUTPUT.** The typed fields. Customer messages are friendly, under 80 words, in the customer's language.
6. **ESCALATE WHEN.** The escalate labels.

The existing agent system prompt is restructured into these parts with its current rules kept.

### 4.4 Trial runs (the guide's shadow mode)

- Each agent is **On trial** or **Live**.
- New pack agents with a job card start on trial. This covers new installs and agents added to existing workspaces by the update banner.
- Agents that exist today start live, so nothing changes for current workspaces.
- **On trial:**
  - Level 1 and 2 actions run as usual: reads, drafts, internal notes.
  - Any action that would run at Level 3 or wait at Level 4 is **captured instead**. It is stored as a trial action, is not executed, and asks nobody for approval.
  - The run carries on as if a person had taken it over ("Kept as a trial draft; a person will do this.").
  - Level 5 is still blocked.
  - Escalations still alert people for real, because safety alerts are never held back.
- **Cases while on trial.** When a request-triggered job runs on trial, the case does not move on by itself.
  - Execute waits for a person, as it does for delegated work today.
  - The person in charge sees the agent's suggestions on the case (the drafted reply, the record it would update), does the real work and taps **Done**.
  - The same screen asks them to score the suggestion. This is the guide's "compare its drafts with what people actually did".
- **Trial review:**
  - The agent's page lists its trial runs: what came in, and what it would have done, in plain sentences.
  - A person scores each run **Correct**, **Minor fix** or **Wrong**, with an optional note on what was actually done.
  - Runs that hit an escalation are marked as safety runs.
  - The phone app gets the same list and score buttons.
- Scores come from the owner, or from anyone holding a role named in that agent's approval rules or escalation alerts.

### 4.5 Test sheets

- **Cases.** Every agent has a test sheet. Pack agents ship cases in the pack under the agent, never in `lifecycle.examples`:
  - lead agents ship 20: 10 normal, 5 awkward, 3 safety, 2 attacks, including the guide's three "run these first" cases;
  - other job agents ship at least 3.
- **Owner cases.** Owners add cases from scratch or turn a trial run into a case with "Add as test".
- **Expectations are structured** and scored by code:
  - escalated (and which set) or not;
  - needs a person;
  - field values, or `null` for "must not invent";
  - `says` and `says_not`;
  - `acts` and `acts_not` (which tools it would and wouldn't call).
  - Cases with no automatic expectation are scored by a person: Correct, Minor fix or Wrong.
- **What a case holds:**
  - the incoming words, the trigger item's fields, or both;
  - optionally, `data` fixtures that stand in for what the job's `read` steps would return.
  - Pack cases always carry fixtures, so they run the same in CI and in any workspace.
  - Owner cases may read live workspace data instead.
- **Running** a sheet executes each case through the job with every action captured, as on trial. Nothing is written or sent. Runs are kept, and the last run shows on the agent's page.
- **In CI**, `pnpm evals` also runs every pack agent's test sheet offline:
  - safety and attack cases must pass 100% offline, because they rest on checks, not the model;
  - normal and awkward cases are scored in `pnpm evals:live` and in-app.
- A completeness test fails the build when a lead agent has fewer than 20 cases or the wrong mix.

### 4.6 Metrics

- **For every agent:**
  - runs;
  - share handled without a person;
  - trial score (Correct, Minor fix and Wrong shares);
  - escalations;
  - median minutes from trigger to first draft;
  - cost per run;
  - rejected approvals.
- **Industry metrics** from the guide's "Track" lines are the job card's `metrics`. Each names a generic metric or a pack KPI.
  - KPIs gain the sources needed: for example, the share of list items done on time, and minutes from a case opening to its first reply.
  - A metric without data says so, as KPIs already do.

### 4.7 Going live

The agent's page shows the ladder and a **readiness check**:

| Condition | Default | Can the owner skip it? |
|---|---|---|
| On trial at least `trial_days` | 14 days | Yes, with a confirmation naming what's unmet |
| Scored trial runs | at least 20 | Yes, with a confirmation |
| Correct + Minor fix | at least 90%, Wrong at most 5% | Yes, with a confirmation |
| No safety run scored Wrong | — | **No** |
| Latest test-sheet run: no safety or attack case Wrong, and newer than the last change to the job card, jobs or prompt | — | **No** |
| Launch checklist has no red items | — | **No** |

- When every condition holds, the owner gets a push: "<Agent> is ready to go live."
- Only the owner taps **Go live**, which is audited as `agent.went_live`.
  - Going live sets clearance 3 (low-risk actions alone).
  - Level 4 rules still ask a person.
  - Earned autonomy per tool works as today.
- **Back to trial** is one tap at any time.
- Thresholds are workspace settings, with the defaults above as my call.

### 4.8 Launch checklist

One page (Settings → Launch checklist), worked out from configuration, green, amber or red:

1. **Least access.** Each agent's tools are listed. Tools unused for 30 days are amber.
2. **No keys in prompts.** Always green, by design: connectors hold credentials, and agents see tools.
3. **Human gates.** Every money-moving tool an agent holds has an approval rule, and every never-list item that names a tool is forbidden. Any gap is red.
4. **Every run logged.** Green (the audit log).
5. **Personal data.** "Mask personal data before the AI sees it" (`redactPii`), and the owner's one-time acknowledgement of a plain DPDP Act summary. Amber until acknowledged.
6. **Spend and rate limits.** Every agent has budgets, and the workspace has a **monthly AI spend limit**. This setting is new.
   - When the limit is reached, the platform runs on its built-in rules (offline mode) for the rest of the month and tells the owner.
   - Nothing stops; replies just stop using the model.
7. **Duplicates ignored.** Intake idempotency and job dedupe. Green.
8. **Kill switch and fallback.** The pause-all switch exists. A **fallback message** shown to customers while paused is new.
9. **AI disclosure.** "Tell customers they are talking to an assistant" adds one short line to customer messages. On by default.

## 5. Part 2: the six shared agents

These are defined once in the base packs (`core-business`, `crm-base`, `bookings-base`) as jobs, and configured per organization type through pack data: categories, words, lists, never lists. Each ships its job card, jobs, 20-case test sheet and metrics.

| Agent | Takes over | Jobs (triggers) | Needs |
|---|---|---|---|
| **Front desk & support** | Enquiry desks, L1 support, helplines, receptionists | Answer a customer question (a `request` in categories flagged `front_desk`) | Grounded answers with sources; "I don't know, a person will reply"; the customer reply page (5.1) |
| **Scheduling & coordination** | Appointment, viewing, dispatch, vendor and event coordinators | Offer slots and book; remind 24 h and 2 h before; reschedule or cancel | Bookable availability (5.3) |
| **Document & data entry** | Clerks, bookkeepers, document controllers, intake staff | Read an uploaded bill, invoice, receipt or form into a record or list item | Uploads and document reading (5.2); `adds_up`, `valid`, `duplicate` checks |
| **Reporting & analytics** | Report compilers, KPI trackers | Morning summary (5.4); the existing weekly report | Numbers in code, the AI writes sentences only |
| **Content & communication** | Copy drafters, description and update writers | Draft from a brief in brand voice, then a second pass against the approved-claims and never-claim lists | Knowledge docs tagged brand voice and approved claims; publishing is always Level 4 |
| **Monitoring & alert** | Alert triagers, status, inventory and expiry watchers | Watch list checks, KPI targets and flagged check-in answers; alert the role in charge; draft a reminder | Existing checks and routines; one alert per item per day |

Existing agents stay. The operations assistant and weekly report become part of Reporting. The booking coordinator becomes Scheduling's booking job.

**Grounded answers** come from knowledge documents split into short passages, searched with the existing Postgres full-text search. The top passages go to the model, and the sources it returns must be among them.

### 5.1 The customer reply page

- After the public form, the customer gets a private link: `/r/:tenantId/:token`. The token is hashed and checked under that tenant's row-level security, like invite links (ADR 0010). The page is noindex in `hosting.ts`.
- The page shows the request, its status in plain words and every reply sent to them, with a box to answer back.
  - An answer joins the case as new details from the customer, by the path needs-info uses today.
  - A new question in it runs the front desk again.
- Intake API callers get the link in the response.
- `message.send` to a case's requester delivers here, and still records in the outbox.
- **Messages to people without a reply page** (a tenant's rent reminder, a vendor chase):
  - They go to **Messages to send**, the outbox as a proper page on web and phone.
  - Each message shows who it is for, the text, **Copy** and **Mark sent**, so a person sends it by hand until WhatsApp arrives.
  - Where a pack offers a party follow-up call for the same list (ADR 0013), the call is the delivery instead.
- WhatsApp will later be one more delivery for the same messages.

### 5.2 Uploads and document reading

- Files can be attached to a new request, a case and a list item, on web and phone: JPG, PNG and PDF, up to 10 MB each.
- Files are stored through a storage adapter: local disk in dev and CI, and Supabase Storage in the demo. Metadata lives in a tenant table under row-level security.
- Files are served only through short-lived signed links, never a session token in a URL.
- `LlmService` gains image and PDF input for Claude and Gemini. The Gemini mapping stays in `agent-kit/src/gemini.ts`.
- Reading returns fields **as printed**, with `null` for anything unreadable. Code checks then decide.
- Offline, a document always goes to a person.
- Uploads on the public form wait for the WhatsApp phase.

### 5.3 Bookable availability

- **Bookables** are a team member, room, bay or table, each with working days, hours, slot length and capacity.
- Free slots are worked out in code from bookables and existing `Booking` records. Double booking and capacity are checked in code.
- Google Calendar sync is a later connector behind `schedule.create`.

### 5.4 The owner's morning summary

- A daily summary at a time the owner sets (default 08:00 IST), as a push and a Home card on web and phone.
- The numbers are worked out in code:
  - new and finished cases;
  - overdue items;
  - money collected and due (the lists' card totals);
  - approvals waiting;
  - list problems;
  - agents on trial with their scores;
  - AI spend.
- The AI writes up to five short lines from those numbers only. Offline, a template writes them.
- WhatsApp delivery comes later.

## 6. Part 3: India essentials (no WhatsApp)

1. **UPI payment links.**
   - `payment.request` creates a Razorpay Payment Link (UPI and cards) once the owner connects Razorpay keys. Keys are stored encrypted and shown masked.
   - Razorpay's webhook (`/payments/razorpay/:tenantId`, public, signature-verified, tenant from the URL) marks the linked list item paid through `RecordsService.update` with a new source, `payment`, and audits it.
   - Without keys, links stay in the sandbox outbox, as today.
   - Tests run against a fake Razorpay server, as Twilio's are.
2. **GST and tax checks, in code:**
   - The `valid` check: GSTIN format and check digit, PAN, IFSC, PIN code. It is available to lists and jobs.
   - Invoice arithmetic uses `adds_up`. Taxable value + CGST + SGST or IGST = total.
   - **GST rates are data, never hardcoded.** The slabs changed in September 2025, and the India edition's "5/12/18/28%" is out of date. The check is "the rate is one of the rates in your own item or service list."
   - **E-way bill validity** is calculated from distance: one day per 200 km or part of it, or 20 km a day for over-dimensional cargo. It feeds an `expiring` check.
   - **MSME payments (section 43B(h))** are an `overdue` check on payables to micro and small suppliers: 45 days with a written agreement, otherwise 15.
   - Each rule's sources and dates go in the pack's playbooks and in `docs/known-gaps.md` for an expert to confirm.
3. **Tally.**
   - Export chosen list items (sales and purchase bills, receipts) as Tally XML vouchers for Tally's Import Data.
   - **Import into lists from CSV or Excel** (Tally day book and ledger exports, or any sheet) through `RecordsService.create` with a new source, `import`. Each row goes through the list's checks, with a preview before saving.
   - Live sync and Zoho come later.
4. **Indian-language replies.**
   - The customer's language is detected in code: the Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada and Malayalam scripts, and Latin script with a Hindi word list for Hinglish. It is passed to every customer-facing `ai` step.
   - Escalation sets carry Hindi and Hinglish forms.
   - Each lead agent's test sheet has at least one Hinglish case, and a regional-language case where the guide names one (Marathi for farms).

## 7. Part 4: the five pilot industries

Each pilot gets:
- its lead agent, with the job card, jobs, 20-case test sheet and metrics from the guide's page;
- its two "next agents", each with at least 3 test cases;
- the lists, checks and roles they need;
- the India edition's mistakes as checks, and its owner-only decisions as approval or forbid rules;
- updated intake evals.

| Industry | Pack | Lead agent | Next agents | India extras |
|---|---|---|---|---|
| Accounting & Tax (38, and 13) | `accounting-firm` (exists) | Client Document Collector & Deadline | Reconciliation Drafting; Tax Checklist. Also the guide's industry 13 lead agent, Bookkeeping & Reconciliation, since the same type serves both | GSTR-2B vs purchase-register match list; advance tax and TDS deadline list; 43B(h) |
| Digital Marketing (04) | `digital-agency` (exists) | Content Calendar & Report | Lead Tracking; Campaign Spend Monitor | Festival calendar (Diwali, Dussehra…); spend above the client limit needs approval |
| Real Estate (02) | `real-estate` (**new**) | Lead Qualifier & Follow-up | Listing Content; Offer Tracker | 7/12, Patta/Khata and RERA document checklist; verified listings only |
| Property Management (36) | `property-management` (**new**, also housing societies and RWAs) | Rent & Maintenance | Inspection Scheduler; Tenant Helpdesk | Maintenance dues with a UPI link; vendor bill vs bank match |
| E-commerce (06) | `ecommerce` (**new**) | Support & Returns | Product Listing Writer; Stock Monitor | COD address check, using the existing party follow-up calls; marketplace return windows |

New types need a sector. My call is to keep five sectors and place them as in section 8.

## 8. Part 5: every industry in the documents

**Placement (my call).** Five sectors stay. Each industry becomes a ready-made type, or the lead agent of one that exists. With about 42 ready-made types, signup's type step gains search.

| Sector | Existing types (lead agent added) | New types |
|---|---|---|
| Energy & Heavy Industry | construction (01), manufacturing-plant (07), power-plant (renewables plant monitoring, 22) | rooftop-solar (22, companies selling and installing), ev-charging (35), e-waste-recycling (40), pharma (30, Guarded), agriculture (16) |
| Trade, Logistics & Tourism | logistics (12), wholesale-retail (23), travel-agency (03) | ecommerce (06), hotel (10), automobile-service (17), events (19), franchise (20), import-export (21), restaurant (24), fashion-textiles (29), beauty-salon (31), fitness (32) |
| Finance & Development | lender (39, Guarded: support and dispute triage only), accounting-firm (13, 38), ngo | real-estate (02), property-management (36), insurance (15), legal (14), consulting (33) |
| Technology & Innovation | software-saas and it-services (05), digital-agency (04) | cybersecurity (26), telecom-isp (27), media-production (25), e-learning (18), publishing (37), architecture-interiors (28) |
| Essential Public & Service | hospital (08, Guarded: admin only), education (11), municipal (34, Guarded: intake and FAQ only) | hr-recruitment (09) |

**Batches.** Each batch is its own plan and review, merged green:
1. **Pilots:** part 4.
2. **Lead agents for the other existing types:** construction, travel, IT, manufacturing, education, logistics, power plant, retail.
3. **New High-rated types:** hotel, automobile service, e-learning, events, restaurant, media, cybersecurity, fashion, beauty, fitness, publishing.
4. **New Medium-rated types:** HR, legal, insurance, agriculture, franchise, import-export, rooftop solar, telecom, architecture, consulting, EV charging, e-waste.
5. **Guarded:**
   - the new pharma type;
   - lead agents for hospital (appointments and FAQ, admin only), municipal (application intake) and lender (support and dispute triage).

   Each Guarded agent:
   - has the strictest never lists;
   - may only schedule, route and answer approved FAQs, with no autonomy above 2 without a named compliance reviewer;
   - ships an "involve a compliance reviewer before launch" item on its launch checklist.

**What every new type needs:**
- A full pack at the existing quality bar (`pnpm pack:check`): stage names, categories with keywords, details and rules, roles, records, lists, checks, policies, routines, KPIs and playbooks. The content is researched from Indian rules and practice, as the existing packs are.
- An intake eval suite (10+).
- The lead agent and two next agents.
- An `e2e:sectors` entry.
- The sector's `other_org_types` entry that used to point elsewhere moves to it.

Open sector questions go to `docs/known-gaps.md`.

## 9. Order of work

Each step is one design section here, one plan (`superpowers:writing-plans`), a subagent-driven build with reviews, and a merge to `main` with `pnpm turbo run build typecheck test`, `pnpm test:integration` and the browser tests green:

1. Part 1a: job card, jobs, prompt shape.
2. Part 1b: trial runs, test sheets, metrics, going live, launch checklist.
3. Part 2a: uploads, document reading, the customer reply page, availability.
4. Part 2b: the six shared agents and the morning summary.
5. Part 3: India essentials.
6. Part 4: the five pilots (batch 1).
7. Part 5: batches 2–5.

Pushing to GitHub happens only when the user asks.

## 10. Testing

- **Unit:**
  - job engine steps and every check kind;
  - the `calc` parser (including attempts to inject code);
  - escalation matching (case, punctuation, Hindi and Hinglish);
  - language detection;
  - GSTIN check digits;
  - e-way bill validity;
  - trial capture by level;
  - readiness rules;
  - test-sheet scoring.
- **Integration** (`pnpm test:integration`):
  - row-level security on every new table (the tenant-isolation spec fails otherwise);
  - trial capture never executes anything;
  - Go live is owner-only;
  - escalation alerts fire while on trial;
  - the reply-page token is checked under the tenant;
  - signed Razorpay webhooks and rejected bad signatures;
  - imports run through checks;
  - uploads served only through signed links.
- **Evals:**
  - every pack agent's test sheet offline in CI, with safety and attack at 100%;
  - `pnpm evals:live --agents` for model quality.
- **Browser (Playwright) and phone (Maestro):**
  - a job agent on trial;
  - scoring runs;
  - the readiness check;
  - Go live;
  - the customer reply page;
  - an upload read into a list item;
  - the morning summary card.
- **Smoke and `e2e:sectors`:** extended to every new type.

## 11. Constraints

These come from `CLAUDE.md` and still apply:
- every tenant query goes through `DbService.tenant`;
- every state change appends an audit event in the same transaction;
- approval rules live in pack policies, never in code or prompts;
- every record change goes through `RecordsService`;
- model answers are zod-validated and merged under rules;
- providers sit behind `LlmService`;
- people never see tool names, ids or JSON (`narrateStep`, `readableFields`);
- colours come from `@onehuman/ui` tokens;
- tests live in `__tests__/`;
- the browser imports run-time values from `@onehuman/schemas/plain`;
- public routes take the tenant id in the URL;
- new pack content reaches existing workspaces only through the update banner, which adds and never replaces (it must learn to add job cards, jobs and test sheets);
- new dependencies are pinned to versions at least 14 days old.

## 12. Calls I made (please check)

1. Build the method into ONEHUMAN OS rather than n8n.
2. Lead agents run as **jobs**, scripted steps with typed AI steps, not as free tool loops. Existing core agents keep the loop.
3. Existing agents start live and new ones start on trial, so nothing changes for today's workspaces.
4. Readiness defaults: 14 days, 20 scored runs, at least 90% Correct + Minor fix, at most 5% Wrong. Safety, test-sheet and checklist conditions can't be skipped.
5. Any approver for the area can score trial runs.
6. Without WhatsApp, customers get replies on a private reply page.
7. Uploads: in the app only (public-form uploads wait for WhatsApp); JPG, PNG and PDF; 10 MB; local disk and Supabase Storage.
8. Razorpay for payment links; Tally by XML export and CSV/Excel import; Zoho and live Tally later.
9. GST rates come from the owner's own data, never hardcoded.
10. Five sectors stay; placement as in section 8, with search on signup.
11. A new workspace setting for a monthly AI spend limit.
12. Accounting-firm carries both accounting lead agents (industries 13 and 38).
13. While on trial, a request's case waits at Execute for a person, who scores the agent's suggestion on the same screen.
14. When the monthly AI spend limit is reached, the platform falls back to its built-in rules instead of pausing.
15. Messages to people without a reply page go to a **Messages to send** page (Copy, Mark sent). There are no WhatsApp links either, since WhatsApp waits.
16. Jobs from the update banner arrive switched off; jobs in a new install arrive on, with their agent on trial.
17. The only outside connector here is Razorpay. Other data comes in through lists and imports.

## 13. Left to the builder

- Table and column names.
- Endpoints.
- Exact YAML keys for jobs and checks.
- How job runs hang off goals and tasks.
- Screen layouts within the existing design system.
- Storage adapter details.
- The wording of shared word sets (from the documents' examples, checked by tests).
- Per-pack thresholds where the guide says "choose with your manager", given sensible defaults in the pack.

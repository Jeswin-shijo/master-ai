# Writing an industry pack

A pack is YAML in `packs/<id>/pack.yaml`. It teaches ONEHUMAN OS how one kind of organization works: its records, its AI agents, the 8 stages every request runs through (named in its own words), its case types and approval rules, and the procedures its people follow. Read the [design spec](superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md) sections 1 and 4 first. The reference packs are `packs/sector-energy-heavy-industry` and `packs/power-plant`.

## Where things go

| What | Where |
|---|---|
| Sector base pack | `packs/sector-<sector id>/pack.yaml` (kind `base`, extends `crm-base`) |
| Organization pack | `packs/<org type id>/pack.yaml` (kind `industry`, extends its sector pack, plus one of `orders-base`, `bookings-base`, `projects-base` where it fits) |
| Test set | `evals/suites/<pack id>.yaml` |
| Work in progress | `.superpowers/drafts/<pack id>.pack.yaml` and `.suite.yaml` (gitignored) |

Check a draft with `pnpm pack:check --pack <draft> --suite <draft suite>`. Copy it into place only when it prints `✓ … no issues`, then run `pnpm evals`.

## The lifecycle

- `case`: what this organization calls one piece of work ("Job", "Loan case", "Patient request"), the plural, and a 2–4 capital-letter prefix (JOB-0042).
- `stages`: all 8 (`request, review, classify, assign, approve, execute, close, report`). Each name is 2–5 plain words, in sentence case and the organization's own words ("Permit-to-work check", "KYC and document check"). Each description is one sentence on what happens there. Give `checks` for review and close: what a careful person checks.
- `roles`: everyone who approves or signs off. Ids are kebab-case (`safety-officer`). Never use `admin` or `member`, which are access roles. The owner is inherited.
- `priorities`: P1–P4 with realistic `respond_within_hours` and `resolve_within_hours`.
- `urgent_keywords`: words that make any request P1. They **replace** the inherited list, so include the generic safety words that apply here (fire, injury, accident…) and leave out ones that are routine here (an IT company's planned "outage").
- `categories` (5–8 case types). For each:
  - `keywords`: at least 3. Use the words people really write: Indian English, common abbreviations, and both "tripped" and "trip". Avoid words that fit several categories. Matching scores each matched keyword by its number of words. The highest score wins; ties go to the more urgent priority, then to the earlier category. No match goes to the `general` category.
  - `priority`, `risk` (`low | medium | high`), `department`.
  - `required_details`: what review must find in the request. Each is `{ key, label, kind }`, where kind is `amount | date | phone | email | contact | keywords` (`keywords` needs a `keywords` list, e.g. which machine). Missing details make the case wait as "needs info".
  - `required_checks`: what a person must confirm (it can't be read from the request).
  - `not_eligible`: `{ keywords, amount_above_inr?, reason }` rules that close a case as not ours. A rule with both words and an amount needs both. Write keyword families ("own wiring", "inside the house", "licensed electrician"), not one test sentence.
  - `approval`: `always | above_amount (+ amount_inr) | high_risk_or_p1 | never`, plus the `role`.
  - `signoff`: `{ required, role }`.
  - `workflow`: the pack workflow that does the work in stage 6. `delegate-work` (inherited) hands it to a person by phone.
  - `execution`: `team | agents | both`.
- `examples`: 2–3 per category, `{ request, category, priority, approval }`. Write them fresh. **Never copy a test-set request.**

## Rules every pack inherits

- A case above ₹5 lakh needs the owner unless a category rule names a role first.
- An amount rule asks for approval when the request gives no amount.
- When several rules apply, a named role (safety officer, credit committee) is asked before the owner.
- The Case coordinator agent runs the stages. Never list it in a workflow step, never give an agent `case.proceed` or `case.close`, and never alias them.

## Everything else in the pack

- `sector`: one of the five sector ids.
- `match.keywords`: how people describe this kind of organization at signup.
- `labels`: shared record names in this sector's words (`Customer: Patient`).
- `entities` (up to 4): typed fields (string, text, number, integer, boolean, date, datetime, email, phone, money, enum with options, reference), a `title_field` and `list_columns`.
- `tools`: aliases over the catalog primitives (`records.search` with a fixed entity, `records.update` with a fixed status). Mark external reach and irreversibility honestly.
- `agents`: 1–3 work agents, each with a clear role, the tools it needs, a clearance (`autonomy` 1–4), a model tier and budgets.
- `workflows`: the stage-6 work for the categories (steps with an agent and plain instructions).
- `kpis`: 4–6. `unit` is one of count, percent, minutes, hours, inr. Use `source` only for record counts or the built-in operations metrics; without a source the KPI waits for a connector.
- `playbooks` (3–6): `{ id, title, body, source }`. The body is markdown: numbered steps in plain words, at least 200 characters. Sector playbook ids start with `sector-`; organization playbook ids never do.
- `routines` (optional): daily check-ins. Quote any `ask` that contains a comma, and end each with "?".

**YAML gotcha:** inside a flow map or list (`{ … }` or `[ … ]`) a comma ends the value. Quote any value there that contains a comma or a colon, e.g. `{ request: "Feeder 4 tripped, restore please", category: breakdown, … }`. The strict schema reports the leftover words as unrecognized keys.

## Job cards, escalation sets and jobs

Design: [ADR 0014](adr/0014-job-cards-and-jobs.md). **No pack ships `jobs:` yet.** Write them in a draft, check them with `pnpm pack:check`, and leave them out of `packs/` until trial runs land.

### The job card

Every agent has a `job:` card. All keys are snake_case.

```yaml
job:
  mission: "Reply to every enquiry within a minute and hand over anything sensitive."   # 1-300 characters
  customer_facing: true            # inherits the shared customer-facing escalation sets
  never:                           # plain words: shown on the card and put in the prompt's RULES
    - "Discounts outside policy"
  forbid: [refund.issue]           # tools this agent may never use: compiled to a forbid policy
  escalate:                        # this agent's own word sets
    - id: allergy
      label: Allergy or food safety
      words: [allergy, allergic, anaphylaxis]
      alert: owner                 # "owner" (the default) or a role; the owner when nobody holds the role
      reply: "Thank you for telling us. A person will call you right away."
  trial_days: 14                   # 1-90; used by trial runs (plan 1b)
  metrics: [first-response-minutes]
```

- "May do" is not written; the card shows the agent's `tools` in plain words.
- An item in `never` that maps to a tool should also go in `forbid`, so the policy engine blocks it whatever a model says.
- Shared sets live at the top of a base pack under `escalations:` (same keys as above plus `for: customer_facing | all`; `core-business` has anger, legal threats, emergencies, distress and secrets). Use `for: customer_facing` for anything an internal desk handles as routine work. An own set with a shared set's id adds its words to the shared one and may change its label, reply and alert.
- Word sets are checked by code (the `escalate` check). Write each word set with Hindi and Hinglish forms.
- **Word matching.** A word matches a whole word, or the word with one of these endings: s, es, d, ed, ing, er, ers ("leak" hits "leaking"). A phrase matches words in a row, and only its last word may carry an ending. It does not match doubled-consonant forms ("stop" vs "stopped") or -ies forms ("party" vs "parties"): list both forms when they matter. Do not list bare words that are routine for the agent (a repair desk's "leak"), and write secrets as phrases ("my otp is") rather than "otp". A spoken "otp 4821" is not caught by words.

### A job

A job has an `id`, `name`, `description`, the `agent` role that runs it, a `trigger`, an optional `daily_cap` (1-500, default 50) and `steps` (at least one). This job was checked with `validateJobs` against a pack whose `enquiry-intake` agent is customer-facing and holds `knowledge.search` and `message.draft`.

```yaml
jobs:
  - id: first-reply
    name: First reply to an enquiry
    description: Drafts the first reply to a new enquiry from the price list and hands over anything sensitive.
    agent: enquiry-intake
    daily_cap: 50
    trigger:
      request: { categories: [any], at: arrival }
    steps:
      - read:
          as: enquiry
          from: trigger
      - read:
          as: passages
          from: knowledge
          query: "{{ enquiry.text }}"
          limit: 5
      - check:
          escalate: { text: "{{ enquiry.text }}" }
          on_fail: person
          message: The enquiry needs a person, not a reply from the AI.
      - ai:
          as: draft
          task: Write the first reply to the enquiry using only the passages.
          data: [enquiry, passages]
          grounded: true
          customer: true
          words_max: 80
          output:
            - { name: reply, type: text, required: true }
            - { name: quotedPrice, type: money }
          offline:
            reply: "Thank you for writing to us. Someone from the team will reply shortly."
      - check:
          required: { fields: [draft.reply] }
          on_fail: stop
          message: The AI gave no reply.
      - check:
          in_data: { value: draft.reply, among: passages }
          on_fail: person
          message: The reply has a number that is not in the price list.
      - check:
          says_not: { text: draft.reply, phrases: [guarantee, discount, free of cost] }
          on_fail: person
          message: The reply promises something the company has not agreed to.
      - check:
          calc: { expr: "draft.quotedPrice * 18 / 100" }
          as: gst
          on_fail: flag
          message: The GST on the quoted price could not be worked out.
      - act:
          as: saved
          tool: message.draft
          args:
            channel: email
            to: "{{ enquiry.from }}"
            body: "{{ draft.reply }}"
```

Steps run in order. Each is exactly one of `read`, `ai`, `check` or `act`, and `as` names its result for later steps. Names are unique and cannot be `trigger` or `today`. Templates (`{{ draft.reply }}`) and paths may start only at `trigger`, `today` or an earlier step's `as`; a path that points at nothing is missing, and the check says so.

| Step | Keys | What it does |
|---|---|---|
| `read` | `as`, `from` (`trigger`, `records`, `list`, `knowledge`), `entity` (records), `list` (list), `query`, `when`, `limit` (1-50, default 10) | Code fetches. `trigger` is what started the run: for a request job `code`, `title`, `text`, `from`; for a manual job the typed `text`. A list read returns the items not yet marked checked that match `when`. |
| `ai` | `as`, `task`, `output` (typed fields), `data` (earlier results the model may see), `grounded`, `words_max`, `customer`, `offline` | One model call. Field types: `text`, `number`, `money`, `date`, `yes_no`, `choice` (needs `options`), `list`. The answer is parsed with zod, with one repair round. `grounded` answers only from the passages read and returns the ones used. `customer` adds the customer-message rule. `offline` is the text used with no model, by field name; without it the run goes to a person. Do not name a field `needs_person` or `sources`. |
| `check` | one check (below), `on_fail`, `message`, `as` | Code checks. `on_fail`: `stop` ends the run and tells the person in charge, `person` hands over with the set's reply and an alert, `flag` carries on with a warning. |
| `act` | `as`, `tool`, `args` | One tool call, through the policy engine, approvals and audit like any agent action. The agent must hold the tool and its card must not forbid it. |

### Checks

| Check | Keys | Passes when |
|---|---|---|
| `escalate` | `text` | No word of the agent's escalation sets is in the text. `on_fail` must be `person` or `stop`. |
| `required` | `fields` | Every path has a value |
| `in_data` | `value`, `among` | Every number in a text (or the value itself, for a non-text) is found in `among`. Reads "45 lakh", "45L" and "4,50,000"; fails closed on anything it cannot read |
| `limit` | `value`, one of `max` or `min` (a number or a path), `factor` (default 1) | The value is within the bound times the factor |
| `adds_up` | `total`, `plus`, `minus`, `tolerance` (default 1) | The total equals the sum of `plus` less `minus`, within the tolerance |
| `within_days` | `date`, `days` | The date lies between today and `days` days from today (negative: back) |
| `duplicate` | `key` (a template) | No earlier run of this job saw the same key |
| `says_not` | `text`, `phrases` | None of the phrases is in the text (same matching as word sets) |
| `valid` | `value`, `as` (`gstin`, `pan`, `ifsc`, `pincode`) | The value has that format |
| `calc` | `expr`, and `as` (required) | Always, unless the sum cannot be worked out. The result is kept under `as` for later steps |

Authoring limits and gotchas:
- **`calc`**: numbers, names, `+ - * /`, brackets and a minus sign only. An expression is at most 500 characters and brackets nest at most 50 deep. It is parsed, never evaluated as code. A name that is empty or not a number fails the check.
- **A bare identifier is a path.** In `says_not.text`, `required.fields`, `limit`, `adds_up` and similar keys, a string made of one name or dotted name (`refund`, `draft.reply`) is read as a path into the results, not as words, and a path with nothing behind it fails the check as missing. To check text with a literal in it, write a template: `"Refund note: {{ draft.reply }}"`. Fixed words to look for go in `phrases`, never in `text`.
- **Money.** An `act` argument that moves money must never use an `ai` result: that is `amount`, or any argument of a tool whose risk says `movesMoney` (`payment.request`, `refund.issue`). The rule follows a `calc` that read an AI result, and an `act` result that used one. `validateJobs` rejects it with "money argument uses {{ … }}, which comes from the AI". Take amounts and payment details from `records`, a `read`, or a `check`.
- `check.as` names a result for any kind of check; only `calc` keeps a value.

### Triggers

Exactly one per job.

```yaml
trigger: { request: { categories: [any], at: arrival } }      # `any` or case type ids; at: arrival | execute (default)
trigger: { schedule: { days: [1, 2, 3, 4, 5], time: "09:00" } }   # 0 = Sunday ... 6; default Monday to Saturday
trigger: { list: { list: open-invoices, due: { overdue: { date: dueDate } } } }   # or due: { expiring: { date: validTill, days: 30 } }, optional `when`
trigger: { record: { entity: Enquiry, on: created } }          # created | updated | either (default); optional `when`
trigger: { manual: { input: "Paste the customer's message" } } # Run now; `input` labels the text box
```

`at: arrival` runs when the case arrives, before stages 2 to 5; `at: execute` runs when the case reaches stage 6. Runs are deduplicated (one per case, per item and due date, per record version, per schedule tick). A new install has every job on; a job that reaches an existing workspace through the update banner arrives off. The owner switches each job and sets its daily cap on the Agents page.

## The test set

`evals/suites/<pack id>.yaml` holds 10 realistic requests as people would really write or say them, from varied sources (owner, staff, customer, system, partner). Include at least one each of: needs info, not eligible, P1, no approval, and decided by an amount (`amount_inr`). Each case is:

```yaml
- id: unit-trip
  request: "ALERT 02:14 Unit-2 TRIPPED. Drum level very low. Load before trip 205 MW."
  source: system
  expect:
    category: breakdown
    priority: P1
    review: complete            # complete | needs_info | not_eligible
    approval: { required: true, role: shift-charge-engineer }
    signoff: { required: true, role: shift-charge-engineer }
  why: Tripped is a breakdown word; P1 breakdowns go to the shift charge engineer.
```

- Every expectation must follow from the pack's rules and the inherited rules above.
- Gates (approval, sign-off) are scored only for `review: complete` cases, given the expected category and priority. Their risk is high for P1, otherwise the category's risk.
- Thresholds: category 90%, priority 90%, review 80%, approval and sign-off 100%.

When a case fails, fix the pack (keywords, details, rules) the way the organization really works, not the case, unless the case was wrong.

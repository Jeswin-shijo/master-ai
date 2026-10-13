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

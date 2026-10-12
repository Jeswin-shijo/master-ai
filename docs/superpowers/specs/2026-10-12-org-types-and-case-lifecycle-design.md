# Organization types and the 8-stage case lifecycle — design

Date: 2026-10-12 · Status: draft for review · Builds on the [architecture plan](../../architecture-plan.md) and ADRs [0001](../../adr/0001-monorepo-and-modular-monolith.md)–[0008](../../adr/0008-routines-manual-or-automatic.md)

## Goal

ONEHUMAN OS should fit any organization, not only small businesses. Signup asks for the organization type first. Every piece of work then runs through the same eight stages, named in that organization's own words. AI agents do the work. People with the right role approve and sign off. The web and mobile apps get a simpler, animated look inspired by the n8n.io website.

## Decisions

Taken with the product owner during design, 2026-10-12:

1. **Five sectors** cover most organizations: Energy & Heavy Industry; Trade, Logistics & Tourism; Finance & Development; Technology & Innovation; Essential Public & Service. Each has three ready-made organization types. People can also type their own.
2. **Every request is a case that runs all 8 stages.** Each stage is its own durable workflow, which takes the case file from the stage before and adds its result. Stage 5 is skipped when no approval is needed. The specific work (book suppliers, repair a pump, disburse a loan) runs inside stage 6.
3. **Cases wrap goals.** Stage 6 runs the existing goal engine (plan → agent tasks → policy → approvals → phone delegation), so none of it is rewritten. People see cases; goals become the work inside stage 6.
4. **Named roles approve.** Approvals and sign-offs go to people by role (owner, manager, finance, safety, compliance, plus roles a pack adds), each with their own login on web and mobile. Staff without a login are still reached by phone.
5. **No fine-tuning.** The system is taught through researched sector packs, playbooks in each company's knowledge base, worked examples in prompts, and scored test sets (evals).
6. **UI: the "Glow" look**, chosen from three mockups. It's closest to the n8n.io site: a violet-navy base, warm orange actions, glass cards lit from inside, and the case's 8 stages on an animated canvas. The mobile app gets a lighter version. See [section 6](#6-web-and-mobile-ui).

The generic stage names, used when nothing more specific is known:

| # | Key | Generic name | What it does |
|---|---|---|---|
| 1 | `request` | Request / Event Created | Takes in a request from a user, customer, employee, system alert or external partner |
| 2 | `review` | Admin Review & Validation | Checks details, documents, eligibility and completeness |
| 3 | `classify` | Classification & Priority | Sets category, urgency, risk, SLA and department |
| 4 | `assign` | Assignment | Names the responsible person or team and the deadline |
| 5 | `approve` | Approval Gate | Manager, finance, safety, compliance or another authorized approver, when the rules require it |
| 6 | `execute` | Execution & Monitoring | Does the work; tracks status, progress, cost, evidence and deadlines |
| 7 | `close` | Verification & Closure | Confirms the outcome; final sign-off when required |
| 8 | `report` | Reporting & Continuous Improvement | Report, KPIs, audit trail, recurring issues |

## 1. Sectors and organization types

### Taxonomy

| Sector id | Sector | Ready-made organization types (pack ids) |
|---|---|---|
| `energy-heavy-industry` | Energy & Heavy Industry | `power-plant`, `manufacturing-plant`, `construction` |
| `trade-logistics-tourism` | Trade, Logistics & Tourism | `logistics`, `wholesale-retail`, `travel-agency` |
| `finance-development` | Finance & Development | `lender`, `accounting-firm`, `ngo` |
| `technology-innovation` | Technology & Innovation | `software-saas`, `it-services`, `digital-agency` |
| `public-services` | Essential Public & Service | `hospital`, `education`, `municipal` |

The existing `travel-agency` pack moves under Trade, Logistics & Tourism and gains a lifecycle. Its entities, agents, tools, workflows and policies stay. The stage names per organization type are in [Appendix A](#appendix-a--stage-names-per-organization-type), and the sector defaults are in [Appendix B](#appendix-b--sector-defaults).

### Signup

1. **Organization type:** five sector cards.
2. **Your organization:** the three ready-made types in that sector, or "Something else", typed in their own words.
3. **Account:** company name, your name, email, password.
4. **Preview** (the existing onboarding page, redesigned): the 8 stages already named for the organization, its case name and categories, agents, approval roles and records. Then install.

`SignupInput` gains `sector` (required) and `orgType` (a pack id, or free text). `tenants` gains `sector` and `org_type`. The existing `industry` column keeps the owner's own words.

### Pack format

`PackSchema` (in `packages/schemas/src/pack.ts`) gains two optional keys:

```yaml
sector: energy-heavy-industry
lifecycle:
  case: { label: Work order, plural: Work orders, prefix: WO }
  stages:                      # any subset; missing stages inherit from parents
    review:   { name: Permit-to-work check, description: …, checks: [Isolation points listed, …] }
    approve:  { name: Safety (HSE) approval, description: … }
  priorities:                  # P1–P4
    - { id: P1, name: Critical, respond_within_hours: 1, resolve_within_hours: 4 }
  roles:                       # who approves or signs off; ids are referenced by categories
    - { id: safety-officer, name: Safety officer, approves: Hot work and confined-space permits }
  urgent_keywords: [fire, injury, trip, leak, outage]
  categories:
    - id: breakdown
      name: Breakdown repair
      keywords: [breakdown, tripped, vibration, leak, not working]
      priority: P1
      department: Maintenance
      required_details: [asset, location]      # what review checks for (see section 4)
      required_checks: [Isolation confirmed, Permit-to-work issued]
      not_eligible_when: { keywords: [outside our plant], amount_above_inr: null }   # review rejects these
      approval: { required: high_risk_or_p1, role: safety-officer }   # always | above_amount (+ amount_inr) | high_risk_or_p1 | never
      signoff: { required: true, role: maintenance-head }
      workflow: delegate-work                  # the pack workflow that runs in stage 6
  examples:                    # worked examples for stage prompts; never copied from evals
    - { request: …, category: breakdown, priority: P1, approval: true }
```

**Resolution** (`agent-kit` `resolvePack`) merges lifecycles down the `extends` chain, nearest pack wins:
- **Stage names:** per stage.
- **Categories, priorities and roles:** by id.
- **Case label:** replaced as a whole.

`core-business` carries the generic stage names and P1–P4 defaults, so every resolved pack has a complete lifecycle.

**Validation** (`validatePackRefs`, run by `pack.test.ts`):
- All 8 stages are present after resolution, and P1–P4 are defined.
- Every category's priority, workflow and roles exist, and `owner` is always a role.
- `above_amount` has an amount.

**Derived policies.** Category approval and sign-off rules compile into ordinary pack policies at resolution, with ids `lifecycle.<category>.approve` and `lifecycle.<category>.signoff`. They show in the policy viewer like any other rule. The rule "approval rules belong in pack policies, not prompts" still holds.

**Typed-in types:**
- **With a model:** `PackGenerator` designs the lifecycle as well, as structured output. It's validated with the same checks and one repair round, as today.
- **Offline:** `composeOfflinePack(industry, sector)` matches the text against the sector's `other_org_types` keywords (Appendix B) and extends the closest ready-made type. If nothing matches, it extends the sector base pack. The existing label hints (Customer → Patient) still apply.

**Existing workspaces** have no lifecycle in their snapshot. The pack update banner offers "8-stage case lifecycle" from `core-business` as an addition, which uses the generic names and the owner role only. `packUpdates` and `applyPackUpdates` learn to add a missing lifecycle, stage names, categories and roles, and never replace anything.

## 2. The case engine

### Data

New tables, all tenant-scoped with RLS (`tenant_isolation` policy) and audited:

**`cases`**
- **Identity:** `id`, `tenant_id`, `workspace_id`, `number` (per-workspace sequence; shown as `WO-0042`), `title`.
- **Where it came from:** `source` (`owner | staff | customer | system | partner`), `requester` (jsonb: name, phone, email, kind), `external_ref` (unique per tenant when set, for intake idempotency).
- **What the stages set:** `category`, `priority`, `risk` (`low | medium | high`), `department`, `amount_inr`, `assignee` (jsonb: staff id or role, name, title), `respond_by`, `resolve_by`.
- **State:** `stage` (current stage key), `status` (`open | needs_info | waiting_approval | in_progress | waiting_signoff | closed | rejected | cancelled | escalated`), `outcome` (plain sentence), `file` (jsonb, the case file below), `goal_id` (the stage-6 goal), `workflow_id`, `created_by`, timestamps (`created_at`, `updated_at`, `closed_at`).

**`case_stages`**
- One row per stage attempt: `case_id`, `stage`, `attempt`, `name` (as named for the organization at that time), `status` (`pending | running | needs_info | waiting_approval | done | skipped | failed`).
- What it took and produced: `input` (jsonb), `output` (jsonb), `summary` (plain sentence for people), `actor` (agent or person).
- Bookkeeping: `workflow_id`, `started_at`, `completed_at`.

**`workspace_counters`**: one row per workspace and kind (`case`). Numbers are allocated with `UPDATE … RETURNING`.

Changed tables:
- **`goals`:** + `case_id` (nullable). A goal with a case is shown inside the case.
- **`approval_requests`:** + `kind` (`action | case_gate`), `case_id`, `stage`. `goal_id`, `task_id` and `tool_call_id` become nullable. A check constraint requires `tool_call_id` for `action` and `case_id` + `stage` for `case_gate`. `agent_id` stays required: a gate is proposed by the Case coordinator agent.
- **`principals`:** + `approver_roles text[]` (see section 3).

Migrations: `0006_cases.sql` and `0007_cases_rls.sql`, generated from `schema.ts`, with RLS in its own file as before.

### The case file

Each stage reads the file and adds its own key. `CaseFile` is typed in `@onehuman/schemas`, and each part has a zod schema:

| Key | Written by stage | Content |
|---|---|---|
| `request` | 1 | title, summary, requester, source, received at, the raw text (kept as untrusted data) |
| `review` | 2 | outcome `complete \| needs_info \| not_eligible`, checks with pass/fail and a note, missing items, provisional category, reason |
| `classify` | 3 | category, priority, risk, department, amount, respond-by and resolve-by times, reasons |
| `assign` | 4 | assignee (person or team), deadline, why this person |
| `approve` | 5 | required?, rule that decided it, approver role, decision, by whom, notes |
| `execute` | 6 | goal id, workflow used, status, summary, cost, evidence (what was done, calls made) |
| `close` | 7 | verified?, findings, sign-off (role, decision, by whom), outcome `resolved \| not_resolved` |
| `report` | 8 | report text, SLA met?, time per stage, recurring-issue flag, KPI contributions |

### Workflows

Two new workflows in `orchestration/workflows.ts`, registered beside the existing ones.

**`caseWorkflow({ tenantId, caseId })`**, workflow id `case-<caseId>`:
1. Runs `stageWorkflow` children in order: `request`, `review`, `classify`, `assign`, `approve`, `execute`, `close`.
2. Ends early on a terminal outcome: `not_eligible`, a rejected gate, `cancelled` or `escalated`. Every later stage is marked `skipped`.
3. If `close` returns `rework` (the result was not accepted), runs `execute` and `close` once more as attempt 2. A second failure escalates the case.
4. Always runs `report` last, including for rejected, cancelled and escalated cases.
5. Signals: `cancelCase` (owner or admin), `pause` and `resume` (kill switch). Children use `ParentClosePolicy.TERMINATE`.

**`stageWorkflow({ tenantId, caseId, stage, attempt })`**, workflow id `case-<caseId>-<stage>-<attempt>`. Every stage starts by marking itself running (idempotent) and checking the kill switch; a paused tenant, workspace or coordinator waits for `resume`.
- **`request`, `classify`, `assign`, `report`:** one `runStage` activity (model or offline), which writes the output, summary and case columns, then completes.
- **`review`:**
  - Runs `runStage`. On `needs_info`, the case waits as *needs info* and the requester (or the owner, for outside requests) is asked for the missing items. An `infoAdded` signal re-runs the review, up to 3 rounds. After `needsInfoDays` (tenant setting, default 7) with no reply, the case is cancelled.
  - On `not_eligible`, the stage completes with that outcome.
- **`approve`:**
  - The `evaluateGate` activity asks the policy engine about `case.proceed`. Level ≤ 3: skipped ("No approval needed: …"). Level 5: rejected with the reasons.
  - Level 4: `requestGateApproval` creates a `case_gate` approval routed to the rule's role, and the workflow waits for `gateDecision` until it expires (`approvalTtlHours`). Rejected or expired ends the case as rejected or escalated, with the approver's note.
- **`execute`:**
  - `startExecution` creates the goal (`case_id` set; `origin: inbound` for customer, system and partner sources). The goal text is built from the case file: title, checked details, category, priority and deadline, assignee and approval note. It also names the category's workflow as the preferred plan.
  - It runs `goalWorkflow` as a child with `autoStart: true`; the plan review is replaced by stage 5. Then `summarizeExecution` writes progress, cost and evidence.
  - Action-level policy, approvals and phone delegation inside the goal work exactly as today.
- **`close`:**
  - `runStage` verifies the stage-6 result against the request. If it isn't verified, the stage returns `rework`.
  - Otherwise `evaluateGate` on `case.close` decides whether sign-off is needed, and the stage waits for the signed sign-off as in `approve`. Rejected sign-off returns `rework` with the note.

New signals in `shared.ts`: `gateDecision { approvalId, decision }`, `infoAdded`, `cancelCase`. `TemporalService` gains `startCase`, `deliverGateDecision(stageWorkflowId, …)`, `addCaseInfo`, `cancelCase` and case pause/resume. The stage workflow id is stored on `case_stages.workflow_id`, so signals reach the right attempt.

### Stage gates are policy decisions

- **Two catalog primitives:**
  - `case.proceed`: input `{ caseId, category, priority, risk, amount?, summary }`, base level 3, internal, reversible.
  - `case.close`: same shape.

  Only the Case coordinator agent has them, so work agents in stage 6 can't call them.
- **`PolicyRule` gains `when`:** `{ category?: string[], priority?: P1–P4[], risk?: low|medium|high[], source?: …[] }`. It compiles to Cedar conditions on new context keys `caseCategory`, `casePriority`, `caseRisk` and `caseSource`. These are empty strings for ordinary actions, so lifecycle rules only ever match gates.
- **Rule mapping:**
  - `always` → `require_approval` with `when.category`.
  - `above_amount` → `require_approval_above`.
  - `high_risk_or_p1` → two `require_approval` rules (`when.priority: [P1]`, and `when.risk: [high]`).
  - `never` → no rule.
- **The usual protections still apply:**
  - Risk banding can still demand owner approval (a very large amount, for example).
  - The kill switch and pause guards block gates.
  - Earned autonomy is never offered for gates.
- **Evaluation fails closed, as today.**

### Approvals for gates

- `approval_requests.kind = case_gate`, with `tool` set to `case.proceed` or `case.close`. `args` hold the gate context, shown through `readableFields`. `summary` reads like "Approve hot work permit for WO-0042 · Boiler feed pump B" and `evidence` lists what the earlier stages found.
- `ApprovalsService.decide` checks the signature exactly as today, then signals by kind: `action` → the task workflow (unchanged); `case_gate` → `deliverGateDecision`. Gates accept `approved` and `rejected` only; editing applies to actions.
- Autonomy suggestions and agent track records only count `kind = action`.

### Where requests come from (stage 1)

| Source | How | Trust |
|---|---|---|
| Owner, staff with a login | "New request" on web and mobile (replaces "Give a goal"). The Workflows gallery's *Start* opens it with the category preset | Trusted |
| Customer | A public form link per company, `/r/<tenantId>/<formKey>`: name, phone or email, what they need. The form key is checked under the tenant's RLS; no new global function | Untrusted |
| System alert, partner | `POST /intake/<tenantId>/cases` with `Authorization: Bearer <intake key>`; `external_ref` makes repeats idempotent | Untrusted |
| Routine problems | "Turn into a case" on a flagged answer (today it turns into a goal) | Trusted |

- **Intake keys** live in a new tenant-scoped table, `intake_keys`: `kind form | api`, `source`, `key_hash`, label, and `last_used_at`, plus `revoked_at` to revoke a key. They're created in **Settings → Requests**, and a key is shown once.
- **Rate limits:** public routes are rate-limited in process (per key and per IP) until Redis exists.
- **Untrusted sources** wrap requester text in `<untrusted_data>` in every stage prompt and set `goal.origin = inbound`, so the existing Cedar guard applies in stage 6.

### Other existing features

- **Routines:** problems flagged in a routine become cases, as shown in the table above.
- **Kill switch:** `TenancyService` pause and resume also signal open case and stage workflows.
- **Reports:**
  - `ReportsService` gains `CaseReport`: the stage timeline, the stage-6 `GoalReport`, the outcome, whether the SLA was met, and the recurring-issue flag.
  - **Reports** lists cases by period, and copy, print and share keep working.
- **Realtime:** new audit event types (`case.created`, `case.stage_started`, `case.stage_completed`, `case.needs_info`, `case.info_added`, `case.closed`, `case.cancelled`) stream over NATS like every other audit event, so the pipeline view updates live.
- **Plain words:** stage summaries are written by the stage itself, for people. Tool names, ids and JSON stay in the Audit page.

## 3. Roles and people

- **Two kinds of role:**
  - **Access role** (existing `principals.role`): `owner | admin | member`. It decides what a person can change.
  - **Approver roles** (new `principals.approver_roles text[]`): ids from the pack's `lifecycle.roles`, such as `safety-officer` or `credit-manager`. A person can hold several.
- **Invites:**
  - The owner or an admin adds a person on the Team page: name, email, access role, approver roles.
  - The server stores the invite in a new `invites` table (tenant-scoped: hashed token, expiry after 7 days, created by, accepted at, revoked at). It returns a link, `<web>/invite/<tenantId>/<token>`, which the owner sends themselves; there's no email connector yet.
  - Opening the link shows the company and the roles. The person sets a password, or signs in if their email already has a login, and joins as a new principal. Accepting runs under the tenant's RLS using the tenant id in the link, so no new security-definer function is needed. The invite is audited as `member.invited` and `member.joined`.
- **Staff:** phone-only staff records gain an optional `principal_id`, so one person can both get calls and approve in the app.
- **Routing:**
  - A gate goes to the role its rule names. If no active person holds that role, it goes to the owner, and the approval says why.
  - Push notifications go to the role holders and the owner (`NotificationsService.pushToRole`).
  - The inbox (`GET /approvals?mine=true`, the default in both apps) lists what the person can decide. The owner and admins can also open *All*.
- **Who may decide:**
  - The owner may decide anything.
  - An admin may decide anything routed to `owner`, plus their own roles.
  - A member may decide only approvals for roles they hold.

  The first decision wins (the row is locked). The signature, key id and person are stored and audited, as today. The role check reads `approver_roles` from the database at decision time, so a role change takes effect without signing in again.
- **What each access role sees:** everyone in the company sees all cases. Only the owner and admins change settings, the pack, rules, intake keys and the team, or use the kill switch. The web hides those pages for members, and the API enforces it.

## 4. Sector knowledge and output quality

### Content

Content comes from the research in Appendices A and B. Each organization type's profile was drafted from Indian regulations, standards and operator practice, then checked and corrected by an independent domain-expert pass.

- **Packs:**
  - Five sector base packs, `packs/sector-<id>/pack.yaml`, extending `core-business` and the right business base pack.
  - Fifteen organization-type packs, `packs/<org-type>/pack.yaml`. Each has the lifecycle, up to four entities, the agents its categories need, aliases over existing primitives, workflows for stage 6, KPIs and routines.
  - No new tool primitives except `case.proceed` and `case.close`.
- **Playbooks:**
  - Each pack's `playbooks` (title plus a markdown body) are loaded into the company's Knowledge at install as `source: pack` documents, and through the update banner later.
  - Stage and work agents already have `knowledge.search`. Their prompts tell them to follow the playbook for the category and to name it in their summary.
- **Worked examples:** two or three solved examples per category in `lifecycle.examples` go into the cached part of each stage prompt.

### The Case coordinator

- **`core-business` agent `case-coordinator`:** tools `case.proceed`, `case.close`, `records.search`, `knowledge.search`; autonomy 3; model tier `small`, with `standard` for review and close.
- **Model calls:**
  - Each stage is one structured-output call through `LlmService` with a stage-specific JSON schema. The stable prefix (role, pack lifecycle, stage definition, examples) is cached; the case file and new input go in the user turn.
  - Output is validated with zod and gets one repair attempt. If it's still invalid, the stage falls back to the offline strategy and the audit records it.
- **Offline strategies** (`packages/agent-kit/src/lifecycle/`, pure functions so evals and tests can call them):
  - **Request:** title and summary from the text; the requester comes from the input.
  - **Review:** a provisional category from keywords. Then the category's `required_details` are checked with extractors (amount, date, phone or email, asset or location word, document name) → `needs_info` with the missing items. `not_eligible` comes from category or sector rules (`not_eligible_when` keywords, amount limits).
  - **Classify:**
    - Category: best keyword score. Ties go to pack order, and a fallback category is used when nothing matches.
    - Priority: the category default, raised to P1 on any `urgent_keywords` match.
    - Risk: the category default, raised by urgency.
    - Times: respond-by and resolve-by from the priorities table.
    - Amount: extracted with Indian number formats ("₹1.2 lakh", "45,000", "2 crore").
  - **Assign:** `TeamService` matching, scored by overlap between staff responsibilities and the category's department and keywords. If nobody matches, it assigns the department name and says nobody on the team covers it yet.
  - **Close:** verified if the stage-6 goal completed and no task escalated.
  - **Report:**
    - A template report with time per stage.
    - SLA met if closed before resolve-by.
    - A recurring-issue flag when three or more cases in the same category arrived within 30 days.

### Evals (scored test sets)

- **Location:** `evals/<org-type>.yaml`, about 10 cases each from the research, ≈150 in total. Each case has the request, source, optional amount, and the expected category, priority, review outcome, approval (with role) and sign-off.
- **`pnpm evals` (offline, in CI):** runs the offline strategies plus the real `PolicyEngine` gates. It reports accuracy per stage and organization type, and fails the build below these thresholds:
  - Gate decisions: 100%, given the expected category and priority; the rules are deterministic.
  - Category: at least 90%.
  - Priority: at least 90%.
  - Review outcome: at least 80%.
- **`pnpm evals:live`:** runs the same cases through the model stage prompts when `ANTHROPIC_API_KEY` is set. It prints a scorecard per stage, plus the cost.
- **No leakage:** `pack.test.ts` fails if any eval request text appears in a pack's `examples`.
- **The improvement loop:** a wrong answer leads to a fix in the pack, playbook or examples, and the score shows the gain. This is the "training" the product owner asked for.

## 5. Testing

| Layer | What it proves |
|---|---|
| Unit (vitest, existing suites + new) | All 20 packs resolve and validate; lifecycle merging; `when` rules compile to Cedar and decide gates correctly; offline stage strategies per sector (amount extraction, keyword classification, needs-info); routing and who-may-decide rules; intake key hashing and checks; invite token expiry |
| Evals (`pnpm evals`) | Stage accuracy per organization type, gated in CI |
| Smoke (`pnpm smoke`, extended) | For each sector: signup with a ready-made type → stage names as expected → a request runs all 8 stages → a second user holding the approver role signs the gate, while a user without it is refused (403) → sign-off → report. Plus: a public-form request runs as untrusted; the intake API rejects a bad key and is idempotent on `external_ref`; needs-info waits and resumes on new details; a rejected gate ends the case with the note; kill switch pauses a case; RLS isolation for every new table; and every existing smoke check |
| Web end to end (Playwright, headless Chrome, new `master-ai-web/e2e/`) | Sector signup, preview and install; a new request; the pipeline advancing live; approval as the role holder in a second browser context; sign-off; the case report; the same flows at phone width |
| Mobile (Android emulator, Expo Go) | Sign in as a role holder, see only their approvals, approve with the fingerprint-signed key, view the case list and pipeline |
| Live model (when a key is set) | One real case per sector end to end, and `pnpm evals:live` scorecard |

CI keeps the two existing jobs. `checks` adds `pnpm evals`; `e2e` adds the Playwright run after the smoke test.

## 6. Web and mobile UI

The product owner chose **Glow** from three mockups, which were built from a study of the live n8n.io site (2026-10-12). The reference files are kept in `.superpowers/` (ignored by git):
- `design/direction-a.html`, the source of the chosen look;
- `brainstorm/*/content/looks-2.html`, all three looks side by side;
- `design/n8n-design-notes.md`, the n8n.io palette, type, components and motion, mostly verified against the live CSS.

The look is inspired by n8n.io and copies none of n8n's logo, name, illustrations or text.

### Tokens (`@onehuman/ui`)

The dark palette is replaced, and light stays available in Settings with the same hues at AA contrast. Mobile reads the same objects.

| Token | Value | Use |
|---|---|---|
| `background` | `#0e0918` | Violet-tinted navy. One background everywhere; sections are told apart by glows and panels, not stripes |
| `surface`, `surfaceMuted`, `node` | `#1b1728`, `#1f192a`, `#2a2633` | Cards and panels, big panels, canvas nodes |
| `line5/10/15/20` | white at 5 / 10 / 15 / 20 % | Borders and dividers, never grey hex |
| `text`, `textBody`, `textLead`, `textMuted` | `#ffffff`, `#d1cece`, `#b6b5b9`, `#9d9797` | Headings; body; the grey lead-in of two-tone headlines; captions |
| `action` (gradient) | `#ec6015 → #c41e0c` | Primary buttons. n8n's `#fd8925 → #ff0c00`, deepened so white labels pass AA (measured 4.8–5.1:1) |
| `glow` | `#ee4f27` | Blooms and lit edges behind actions and the live stage |
| `secondary` (gradient) | `#077ac7 → #6b21ef` | Secondary buttons, the active nav glow (lilac `#a06ff6`) |
| `waiting` | `#ff9b26` | Anything waiting on a person: the live stage, approval badges |
| `success` | `#35a670` (ports `#22af7a`) | Done |
| `danger` | `#ff492c` | Critical, P1 |

**Colour always means the same thing:** warm means a person is needed; green means done; cool violet and blue mean navigation and agents.

**Fonts:** Red Hat Display (300/400) for headings, which use two tones: a grey lead-in and a white payoff. Red Hat Text for the interface, with tabular numbers for times. Web self-hosts them through `@fontsource` packages, so there's no request to a font CDN at runtime. Mobile loads them with `@expo-google-fonts`. Versions are pinned like every other dependency.

Radii are 8 / 12 / 16. Cards have no drop shadows: depth comes from a 1px inner white/10 ring, a warm top highlight and soft radial glows.

### Web

- **Shell:** a glass sidebar with an active-item glow; a top bar with search, the gradient **New request** button, and **Pause all agents**. Navigation becomes Home, Cases, Approvals, Team, Routines, Calls, Reports, Knowledge, and for the owner and admins Workflows, Agents, Records, Industry pack, Audit and Settings.
- **Signup wizard:** three steps: sector cards with a warm selected ring, then organization type tiles, then the account.
- **Install preview:** the 8 stages animate in, named for the organization.
- **Home:** today's cases by stage, what's waiting on you, SLA risks, KPIs and routine progress.
- **Cases list:** filters by stage, priority, status and assignee, each row with a mini 8-dot stage bar.
- **Case page** (the hero), built on React Flow (`@xyflow/react`, already used):
  - The header: number, title, priority, risk, department, due and source chips.
  - The 8-stage canvas: rounded-square nodes with ports, green for done, dashed and muted for later stages.
  - The live stage gets a rotating light sweep, a pulsing halo, dots flowing along the edge into it, and a person node (the approver or assignee) hanging off it.
  - Beside it, the **Case file** timeline: what each finished stage added, in sentences. Then the latest activity, and the stage-6 work (the goal canvas and its calls), shown inside the execute stage.
- **Approvals inbox:** glass cards, with *Mine* as the default and *All* for the owner and admins.
- **All other pages** (Team with roles and invites, Routines, Calls, Reports, Knowledge, Settings including Requests and intake keys, Audit, Industry pack, Agents, Workflows) are restyled with the same tokens and components.
- **Motion:** the `motion` library. Content fades up 25px over 0.55s on entry, and hovers take 300ms. The live-stage effects are CSS keyframes. Everything respects reduced motion: `MotionConfig reducedMotion="user"` plus a CSS media query, and the halo becomes a static ring.

### Mobile (Expo)

- **Tabs:** Cases, Approvals (with a badge), Calls, Pulse, Settings.
- **Approval screen:** as in the mockup. The case number and title, a two-tone question, the stage it came from, a risk card, evidence ticks, the gradient **Approve with fingerprint** button (signs with the device key, as today) and **Reject with a note**.
- **Case detail:** a vertical stage list instead of a canvas. Done stages carry green ticks; the live stage pulses with `react-native-reanimated` (already installed); then the case file.
- **Glows** become flat tinted backgrounds and light borders, because heavy blur is slow on Android. Gradients use `expo-linear-gradient`, the one new dependency, pinned to the Expo SDK 57 version.
- The app stays always dark (`src/lib/theme.ts`), as before.

### Accessibility

- Text meets WCAG AA. Every white label on the action gradient was measured from rendered pixels.
- Focus rings are lilac and always visible.
- Interactive targets are at least 44px on mobile, and text is at least 13px.
- The dashed outlines of not-started stages are decorative, so each one also says "Not started" in words.

## Out of scope

- WhatsApp and email intake, and messages back to customers. They need the connectors, which are still to be built.
- People working stages from a queue (each stage set to AI, a person, or AI then a person) was considered and not chosen.
- Fine-tuning models.
- SSO, passkeys and Keycloak (ADR 0004 stands).
- Per-role data visibility beyond the approvals inbox.

## Docs to update with the build

- **ADR 0009**, organization types and the case lifecycle.
- **ADR 0010**, roles, invites and gate approvals.
- **README:** the "What works today" table, and run instructions for evals and Playwright.
- **`CLAUDE.md`**, new rules:
  - Case gates are policies on `case.proceed` and `case.close`.
  - Public routes take the tenant id in the URL and check a hashed key under RLS.
  - Stage outputs are zod-validated case-file parts.
  - Eval requests never go into pack examples.

## Appendix A — stage names per organization type

These come from research drafts, kept in `.superpowers/research/` until they become packs. Each draft has 8 categories, approval roles, KPIs, playbooks, 10 test requests and its sources. Fourteen were researched from Indian regulations and practice (RBI, CEA, CERT-In, NABH, FCRA, the labour codes and others). Municipal was drafted from general knowledge and is researched in the build. Every draft gets an independent expert check during the build, before it becomes a pack. That check has already spotted one fix: the lender draft files a complaint about a recovery agent's visit as a P1 fraud alert, when it belongs under complaints.

| Type | Case (prefix) | 1 Request | 2 Review | 3 Priority | 4 Assign | 5 Approve | 6 Execute | 7 Close | 8 Report |
|---|---|---|---|---|---|---|---|---|---|
| Power plant & utilities | Job (JOB) | Job raised | Engineer's first check | Category & priority set | Crew & supervisor named | Permit & clearance | Work under permit | Permit return & sign-off | Monthly review & lessons |
| Manufacturing plant | Work order (WO) | Request or alarm raised | Details and safety check | Priority and department | Assign in-charge and deadline | Permit or approval | Job in progress | Verify and sign off | MIS and improvement |
| Construction & infrastructure | Site request (SR) | Site request raised | Check details and papers | Set type, risk and priority | Assign in-charge and deadline | Approval before work | Site work and progress | Inspect and sign off | Monthly review and lessons |
| Logistics & transport | Job (JOB) | New booking or alert | Check papers and details | Set type and urgency | Assign truck and team | Approval if needed | Dispatch and track | POD and closure | Review and improve |
| Wholesale & retail trade | Trade request (TR) | Request comes in | Check party and papers | Set type and urgency | Assign person and deadline | Owner or manager okay | Carry out and track | Confirm and close | Weekly review and fixes |
| Travel agency & tour operator | Trip file (TF) | Query or alert received | Check details and documents | Set type and urgency | Assign consultant and deadline | Owner or manager approval | Book, pay and track | Settle and close file | Feedback and monthly review |
| Lender | Loan case (LN) | Case received | KYC and document check | Risk grade and priority | Assign officer and deadline | Sanction or approval | Disburse and follow up | Final check and close | Reports and portfolio review |
| Accounting & tax firm | Assignment (ASG) | Request or notice received | Documents & KYC check | Type, due date & priority | Assign team & partner | Partner review & approval | Prepare, file & track | Proof, sign-off & billing | Monthly practice review |
| NGO & development programme | Programme case (PRG) | Request or application received | Eligibility and document check | Priority, project and fund | Assign team and deadline | Approval by authorised person | Deliver and track progress | Verify proof and close | Donor reports and learning |
| Software & SaaS | Ticket (TKT) | New ticket or alert | Check details and account | Set severity and priority | Assign team and deadline | Approval to go ahead | Fix, release and update | Test, confirm and close | Reports and incident reviews |
| IT services & support | Ticket (TKT) | Ticket raised | Check contract and details | Set priority and SLA | Assign engineer and deadline | Change or cost approval | Fix, deliver and track | Confirm and close | SLA report and review |
| Digital agency | Job (JOB) | Brief or request received | Brief and scope check | Job type and priority | Assign team and deadline | Approval to start | Production and revisions | Client sign-off and handover | Reports and monthly review |
| Hospital & clinic | Patient request (PR) | Request or alert received | Registration and eligibility check | Triage and priority | Assign doctor and team | Approval and consent | Treatment and follow-up | Discharge and sign-off | Quality indicators and review |
| School, college & coaching | Request (REQ) | Request received | Documents and eligibility check | Type, urgency and department | Assign in-charge and deadline | Principal or management approval | Action and follow-up | Final check and sign-off | Reports and term review |
| Municipal & citizen services | Citizen request (CR) | Application or complaint received | Documents and eligibility check | Service, ward and time limit | Assign officer and deadline | Officer approval | Field work and tracking | Verify and close | Service report and review |

Approval roles in the drafts, by type:
- **Power plant:** plant head, shift charge engineer, safety officer, maintenance engineer, section engineer.
- **Manufacturing:** plant head, shift in-charge, safety officer, quality head.
- **Construction:** project manager, safety officer, quality manager, contracts manager, HR manager, CRM head.
- **Logistics:** operations manager, safety officer, accounts manager, fleet manager.
- **Wholesale & retail:** accounts, sales, purchase and godown in-charge.
- **Travel:** operations manager, accounts manager, grievance officer.
- **Lender:** credit manager, credit committee, branch manager, operations manager, collections head, grievance officer, compliance officer.
- **Accounting firm:** engagement partner, review manager.
- **NGO:** board, programme manager, finance manager, M&E officer.
- **Software & SaaS:** engineering head, engineering manager, QA lead, security officer, product manager, finance manager, privacy officer.
- **IT services:** service delivery manager, change manager, security lead.
- **Digital agency:** account director, creative director, tech lead.
- **Hospital:** treating doctor, medical superintendent, emergency in-charge, billing manager, administrator, grievance officer, quality manager.
- **Education:** principal, exam in-charge, accounts head, grievance committee, admin officer.
- **Municipal:** ward officer, executive engineer, health officer, revenue officer, grievance officer.

Every type also has the owner.

## Appendix B — sector defaults

These are used for a typed-in organization type that matches no ready-made one, such as a cement plant, a cold-storage chain or an insurance broker. During the build, each sector pack also gets its own broad categories, roles, playbooks and the `other_org_types` keyword list that offline mode uses to borrow the closest ready-made type.

| Sector | Case (prefix) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| Energy & Heavy Industry | Work order (WO) | Request or alarm raised | Details and safety check | Priority and risk | Assign in-charge and deadline | Permit or approval | Work in progress | Inspect and sign off | Monthly review and lessons |
| Trade, Logistics & Tourism | Job (JOB) | Request comes in | Check details and papers | Set type and urgency | Assign person and deadline | Approval if needed | Carry out and track | Confirm and close | Weekly review |
| Finance & Development | Case (CS) | Request received | Documents and KYC check | Type, risk and priority | Assign officer and deadline | Approval or sanction | Process and track | Final check and close | Reports and review |
| Technology & Innovation | Ticket (TKT) | Ticket or request raised | Check details and scope | Set priority and SLA | Assign team and deadline | Approval to go ahead | Build, fix and track | Confirm and close | Reports and reviews |
| Essential Public & Service | Request (REQ) | Request received | Documents and eligibility check | Urgency and department | Assign in-charge and deadline | Approval by authority | Service and follow-up | Verify and sign off | Reports and review |

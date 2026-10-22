# Glossary

The words ONEHUMAN OS uses, in the product and in the code. Code names are in `backticks`.

## The product

**Organization type**: what kind of organization this is (power plant, lender, hospital…). It is picked at signup and decides which pack is installed. There are 15 ready-made types; any other type is written in the owner's own words. Code: `orgType`, `ORG_TYPES`.

**Sector**: one of five groups of organization types (Energy & Heavy Industry; Trade, Logistics & Tourism; Finance & Development; Technology & Innovation; Essential Public & Service). Code: `SectorId`, `SECTORS`.

**Case**: one request, from arrival to report. It has a number in the organization's own style (JOB-0042, LN-0042) and runs the 8 stages. Code: `cases` table, `CasesService`.

**Stage**: one of the 8 steps every case runs: request, review, classify, assign, approve, execute, close, report. Each organization names them in its own words. Code: `StageKey`, `case_stages` table.

**Case file**: what a case knows so far. Each stage reads it and adds its own part (the review's checks, the classification, the assignee…). Code: `CaseFile` in `packages/schemas/src/case.ts`.

**Category** (case type): the kind of request, such as *breakdown repair* or *loan application*. A category brings its priority, its required details, and its approval and sign-off rules.

**Priority**: P1 (critical) to P4 (low), each with its own times to respond and to resolve. P1 cases never wait for missing details; the work starts while the details are asked for.

**Gate**: a stage that can stop the case until a person decides. The two gates are the **approval** at stage 5 and the **sign-off** at stage 7. Code: tools `case.proceed` and `case.close`.

**Approval**: a person's signed yes or no. There are two kinds: an *action* approval (one step an agent wants to take) and a *case gate* (stage 5 or stage 7). Code: `approval_requests`, `kind: 'action' | 'case_gate'`.

**Sign-off**: the stage-7 gate, where the role holder confirms the work is done.

**Escalated**: a case or task handed back to people because the AI couldn't finish it, or because a sign-off was refused twice.

**Needs details** (*needs info*): the review found something missing. The case asks for it and waits, unless it is urgent.

**Not eligible**: the review's rules say the organization doesn't handle this request, so the case ends at stage 2.

**Intake**: how requests arrive from outside: a public form link per company, or an API with a key. Keys are made in **Settings → Requests**. Code: `intake_keys`, `IntakeService`.

**Untrusted text**: words from customers, partners or systems. The AI is told to treat them as data, never as instructions.

## People and roles

**Owner**: the person who set up the organization. They may decide anything.

**Access role**: what a person may change: *owner*, *admin* or *member*. Code: `principals.role`.

**Approver role**: which decisions a person may make, such as *safety officer* or *credit manager*. The roles come from the pack, and a person can hold several. Code: `principals.approver_roles`.

**Role holder**: someone who holds the approver role a rule names.

**Invite**: a link the owner or an admin sends a new person. It works once and expires after 7 days. Code: `invites`, `MembersService`.

**Mine**: the approvals inbox filtered to what you yourself may decide. It is the default view in both apps.

**Staff**: people in the team directory. The AI can phone them even if they never log in, and a staff record can be linked to a login.

**Delegation**: work an agent hands to a staff member by phone (assign, follow up, confirm). Code: `staff.delegate`, `delegationWorkflow`.

**Routine**: a repeating check-in, such as a daily work report, run by hand or by AI phone calls. Code: `RoutinesService`, Temporal schedule `routine-<id>`.

## AI and safety

**Agent**: an AI worker with a role, a set of tools and budgets. It proposes one action per step.

**Case coordinator**: the agent that runs the case stages. It is the only agent that holds the gate tools.

**Tool**: an action an agent can propose. Generic *primitives* (`records.update`, `message.send`, `staff.delegate`…) live in the catalog. Packs give them industry names (*aliases*), such as `booking.confirm`. The model sees them as wire names (`records__update`).

**Goal**: the work inside stage 6: a plan of tasks that agents carry out. Before cases existed, goals were the main unit of work.

**Task**: one part of a goal's plan, worked by one agent.

**Policy engine**: the code that decides, for every proposed action, whether it may run. It scores risk and checks Cedar rules compiled from the pack. Code: `packages/policy`.

**Autonomy level**: 1–5. Levels 1–3 run on their own, Level 4 waits for a person, and Level 5 is blocked.

**Earned autonomy**: after 5 unchanged approvals of the same action, the platform suggests letting the agent do it alone. It never applies to case gates.

**Cedar**: the policy language the rules are written in (an open-source language from AWS).

**Kill switch**: pauses the agents and cases of a company or a workspace at once; new work is refused until it is switched back.

**Offline mode**: no AI key, so built-in rules answer every model call, deterministically. All tests run this way. Code: `LLM_OFFLINE`, each call's `offline()` strategy.

**LLM gateway**: the one place that talks to AI providers (Claude by default, Gemini optionally). It redacts personal data, meters cost, falls back to a smaller model, and can fall back to the rules. Code: `LlmService`.

**Device key**: a signing key kept on each phone or browser. Approvals are signed with it.

**Audit log**: every change, append-only and hash-chained, so tampering shows.

## Data and setup

**Tenant / company**: one organization's private space. Row-level security keeps each tenant's data apart. Code: `tenant_id`, `DbService.tenant()`.

**Workspace**: a company's installed setup: a snapshot of its pack, its agents and its records.

**Pack**: what the platform knows about one kind of organization: stages, categories, roles, agents, tools, records, workflows, rules, routines, KPIs and playbooks. It is written as YAML in `packs/`. Packs build on each other with `extends`.

**Job card**: what an agent is for, written in the pack: its mission, what it never does, tools it may never use, and the words that make it hand over to a person. Code: `job` on a pack agent, `JobCard`.

**Job**: a fixed list of steps (read, ask the AI, check, act) that a trigger starts and the task workflow runs. The AI only fills typed fields; code checks and decides. Code: `jobs:` in pack YAML, `JobDef`, `JobRunnerService`.

**Escalation set** (*stop words*): a named group of words that makes an agent stop and hand over to a person, with who is alerted and what the customer is told. Some are shared by every customer-facing agent. Code: `escalations:` and `job.escalate`, `EscalationSet`.

**Six-part prompt**: the shape of every model call made for an agent: ROLE, RULES, OUTPUT and ESCALATE WHEN in the system message, TASK and DATA in the user message, with the data fenced as untrusted. Code: `sixPartSystem`, `sixPartUser`.

**Lifecycle**: the part of a pack about cases: the stage names, priorities, roles, categories and worked examples.

**Snapshot**: the copy of its pack a workspace keeps. Later improvements to the base packs reach it only as additions the owner applies.

**Playbook**: a written procedure from a pack, added to the company's knowledge base.

**Test set / eval suite**: realistic requests for one organization type, with the answers each stage should give. Code: `evals/suites/<pack>.yaml`.

**Smoke test**: the end-to-end check of the whole platform through its API (`pnpm smoke`).

**Sector run**: the end-to-end check of every organization type (`pnpm e2e:sectors`).

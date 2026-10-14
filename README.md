# ONEHUMAN OS

One agent-native platform for any organization. At signup the owner picks the organization type, and the platform sets itself up for it: the 8 stages every request runs through, named in that organization's own words, its case types, who approves and signs off, its agents, records and KPIs. Agents do the work, a policy engine (not the AI) decides what they may do, and the people holding the right roles approve from web or phone with a signed decision.

This repository implements the [architecture plan](docs/architecture-plan.md) and the [organization types and case lifecycle design](docs/superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md). Every layer is real and connected end to end, and all of it runs with no AI key.

## What works today

| Flow | How it works |
| --- | --- |
| **Organization type first** | Signup asks for the sector, then the organization type: one of the 15 ready-made types below, or the owner's own words. Own words build on the ready-made type they match, or the closest one the sector lists as similar (a cement grinding unit gets the manufacturing plant's stages), or the sector's defaults; with a model, the generator designs one. The owner previews the stages, case types, roles, agents and records, then installs ([ADR 0009](docs/adr/0009-organization-types-and-the-case-lifecycle.md)). |
| **Every request is a case** | Each request runs through 8 stages in the organization's words — for a power plant: Job raised → Engineer's first check → Category & priority set → Crew & supervisor named → Permit & clearance → Work under permit → Permit return & sign-off → Monthly review & lessons. Agents do each stage; approval is skipped when no rule needs it; the work itself is stage 6; a sign-off that isn't verified sends it back once. Each case gets a number (JOB-0042 at a power plant), a deadline from its priority, and a report. |
| **Requests from anywhere** | **New request** on web and phone, the Workflows gallery, and a flagged routine answer start cases from inside. Customers use a public form link; systems and partners post to an intake API with a key (repeats are ignored). Outside words are treated as untrusted data in every prompt. Keys are made in **Settings → Requests**. |
| **Named roles approve** | The owner invites people from the Team page with an access role (admin or member) and approver roles from the pack (safety officer, credit manager, insurance desk…). Each gate goes to the person holding its role, or to the owner when nobody does, with the reason. Members can decide only their own roles; everyone else is refused. Both apps open the approvals inbox on *Mine* ([ADR 0010](docs/adr/0010-roles-invites-and-gate-approvals.md)). |
| **Goal → plan → agents** | The work in stage 6 is a durable Temporal workflow. The orchestrator plans a task graph from the case file; each task runs as its own workflow where an agent proposes one tool call per step. |
| **Policy gate** | Every proposed action, and every case gate, is risk-scored (action type, money, reversibility, external reach, data sensitivity, track record) and checked by Cedar policies compiled from the pack: Levels 1–3 run, Level 4 waits for approval, Level 5 is blocked. Kill switches, allow-lists, money budgets and prompt-injection guards are Cedar rules too. |
| **Signed approvals** | Each device has an Ed25519 key (browser storage on web; keychain + Face ID / fingerprint on mobile). Decisions are signed and verified server-side; forged signatures are refused. The workflow sleeps until the decision arrives, for days if needed. Rejections go back with the approver's note. |
| **Audit** | Every state change is an append-only, hash-chained event. The audit explorer verifies the chain and replays any goal step by step. |
| **Tenancy** | Postgres row-level security on every table; the app connects as a role that cannot bypass it. |
| **Live everywhere** | Audit events stream over NATS to WebSocket clients; agent text streams over SSE. A case's stages advance live on screen. |
| **Earned autonomy** | After 5 unchanged approvals of the same action, the platform suggests letting that agent do it alone. The owner grants or revokes in one tap; amount limits still apply. Case gates never become automatic. |
| **Work done by the team, by phone** | When work needs a person, the agent hands it to the staff member in charge and a durable workflow calls them: **assign**, **follow up** before it is due, **confirm** when it is due. Unanswered calls are retried; calls happen only in working hours. Declined, blocked or not-done work comes back to the owner. Real calls go through Twilio (Indian-English voice and speech recognition) or run in a built-in simulator ([ADR 0007](docs/adr/0007-phone-delegation-to-staff.md)). |
| **Routines: manual or automatic** | Repeating check-ins (daily work report, stock check, bookings check-in) come from the pack. Each one is **Manual** (people fill in a short form) or **Automatic** (the AI phones each person and fills in the answers). A live board shows who has reported, and any problem raised becomes a case in one click ([ADR 0008](docs/adr/0008-routines-manual-or-automatic.md)). |
| **Reports in plain words** | Every step is told as a sentence, never as tool names or data. Each case has a report: its stages, the work done, whether it met its deadline, and whether it keeps coming back. **Reports** collects them by period; owners copy, print, save as PDF or share from the phone. |
| **Quality without fine-tuning** | Each ready-made type was researched from Indian rules and practice: its pack, playbooks for the knowledge base, worked examples for the stage prompts, and a scored test set of real-sounding requests (16 sets, about 150 requests). `pnpm evals` scores the rules on every build; `pnpm evals:live` scores the model. |
| **Web app (Glow)** | A dark violet-navy look with warm orange actions, inspired by n8n.io. Home, Cases (with each case's 8 stages as dots), the case page (the stages on an animated canvas, the case file in sentences, the report), Approvals, Team with invites and roles, Reports, Routines, Calls, Records, Workflows, Agents, Knowledge, the Industry pack, Audit and Settings. Works at phone width. |
| **Phone app (Glow)** | Expo app with Cases, Approvals (with a badge), Calls, Pulse and Settings. The case screen shows the 8 stages with the live one pulsing (still under reduced motion); the approval screen asks the question in plain words with the risk and evidence, approves with the fingerprint and rejects with a note. Saved approvals work without signal and are kept per person on a shared phone. |

### Ready-made organization types

| Sector | Organization types |
| --- | --- |
| Energy & Heavy Industry | Power plant & utilities · Manufacturing plant · Construction & infrastructure |
| Trade, Logistics & Tourism | Logistics & transport · Wholesale & retail trade · Travel agency & tour operator |
| Finance & Development | Lender (NBFC, microfinance, co-op bank) · Accounting & tax firm · NGO & development programme |
| Technology & Innovation | Software & SaaS company · IT services & support · Digital agency |
| Essential Public & Service | Hospital & clinic · School, college & coaching · Municipal & citizen services |

### Verified end to end

- [`pnpm smoke`](master-ai-backend/scripts/smoke.ts): signup → pack → goal → plan → signed approval (a forged signature is refused) → execution → realtime → audit verification → RLS isolation → kill switch → phone delegation; then one organization per sector runs a case through all 8 stages, plus the public form, the intake API, needs-details, cancel, a rejected gate, not-eligible, the kill switch on cases, invites, role refusals, removal and demotion.
- [`pnpm e2e:sectors`](master-ai-backend/scripts/sectors.mts): all 15 ready-made types and one typed in the owner's own words per sector. Each invites its role holders and a member, sends a real request from its test set through the door it would really use, and checks the stage names, category, priority, who approved and signed off, that the member was refused, and that nothing people read names a tool or shows an id.
- `pnpm e2e` (Playwright, Chromium): signup to report in the browser at desktop width — sector, type, preview, install, a new request, the stages advancing live, approval by the role holder in a second browser, sign-off, the report — plus the main pages at 390px phone width.
- `pnpm e2e:mobile` (Maestro, Android emulator, Expo Go): a role holder sees only their approvals and approves with the fingerprint-signed key; a member sees none; a new request from the phone runs its stages.
- `pnpm evals`: the 16 test sets, scored offline in every build.

CI runs the build, typecheck and unit tests (with the test sets) on every push, then the smoke test, every organization type and the browser tests against the production web build ([ci.yml](.github/workflows/ci.yml), [infra/ci/e2e.sh](infra/ci/e2e.sh)).

## Repository

```
master-ai/
├─ master-ai-backend/   NestJS modular monolith (API) + Temporal worker (agents, cases); scripts/ has the smoke and sector runs
├─ master-ai-web/       Web app: React + Vite + Tailwind + TanStack Query + motion; e2e/ has the Playwright tests
├─ master-ai-mobile/    Phone app: Expo SDK 57 + Expo Router + Reanimated; e2e/ has the Maestro flows
├─ packages/
│  ├─ schemas/          Zod schemas + types for packs, cases, API and events (single source of truth)
│  ├─ agent-kit/        Tool catalog, pack resolution, lifecycles, offline stage strategies, stage prompts
│  ├─ policy/           Risk scoring + Cedar policy engine
│  ├─ sdk/              Typed API client, realtime client, approval signing, case views
│  └─ ui/               Glow design tokens for web (CSS variables) and mobile
├─ packs/               5 sector packs, 15 organization-type packs, core-business and the crm/bookings/orders/projects bases
├─ evals/               Scored test sets (suites/) and their runners; the sector run's plan
├─ infra/               Local stack (docker/: Postgres + pgvector, Temporal on Postgres, NATS JetStream) and CI's end-to-end script (ci/)
└─ docs/                Architecture plan, decision records (adr/), pack guide, known gaps
```

The backend modules map one-to-one to the plan's services (identity, orchestrator, workflows, cases, agent runtime, LLM gateway, policy and approval, knowledge, connector gateway, pack registry, audit, KPIs, notifications), so any one of them can be split into its own service later.

## Run it

Prerequisites: Node 24 (`nvm use`), Docker, and pnpm via Corepack (`corepack enable pnpm`).

```bash
pnpm install
pnpm infra:up                                   # Postgres, Temporal (+ UI on :8233), NATS
cp master-ai-backend/.env.example master-ai-backend/.env
pnpm db:migrate
pnpm dev                                        # shared packages (watch) + API :3000 + worker + web :5173
```

Open http://localhost:5173, choose **Set up your organization**, pick a sector and a type. `pnpm infra:down` stops the local stack.

- **Mobile:** `pnpm --filter @onehuman/mobile start` (Metro on :8082), then open it in Expo Go. The app finds the API on the same machine automatically; set `EXPO_PUBLIC_API_URL` to override. On the Android emulator, run `adb reverse tcp:3000 tcp:3000` and open `exp://127.0.0.1:8082`. Remote push needs a development build (`eas build --profile development`); Expo Go removed push on Android in SDK 53.
- **Real models:** set `ANTHROPIC_API_KEY` in `master-ai-backend/.env` and restart `pnpm dev`. Model tiers: frontier `claude-opus-5-5`, standard `claude-sonnet-5-5`, small `claude-haiku-5-5` (configurable). For testing you can use Google Gemini instead: set `GEMINI_API_KEY` (a free key from aistudio.google.com works; use test data only, as Google may use free-tier prompts) and match the tiers to what your key allows: a free key has no Pro and only 20 Flash requests a day, so set all three `GEMINI_MODEL_*` to `gemini-flash-lite-latest` and `LLM_MAX_RPM=12` to stay under its 15 requests a minute; with `LLM_RULES_WHEN_UNAVAILABLE=true` the built-in rules answer whenever the key is out of quota or Google can't be reached, until it is back ([ADR 0011](docs/adr/0011-gemini-as-a-second-model-provider.md)). With no key the LLM gateway runs in deterministic **offline mode** (labelled `offline` in metering), which is what tests and CI use; `LLM_OFFLINE=always` keeps it there even with a key. `GET /health` shows which provider answers.
- **Requests from outside:** in **Settings → Requests**, make a form link for customers or an API key for a system or partner. A key is shown once.
- **The team:** on the **Team** page, invite people with their roles and send them the link. Installing with *sample records* also adds three staff members the AI can phone.
- **Phone calls:** give a request that needs someone on site, such as *"Make sure the hotel rooms are inspected before Friday"*. In **Settings → Phone calls to the team**, choose who answers simulated calls. With **You do, in this app** (the default), each call rings at the bottom right of the web app and you answer as the staff member by typing, using quick replies, or speaking (Chrome). With **A simulated staff member**, calls answer themselves. **Fast schedule**, on by default, puts seconds between calls instead of hours.
- **Routines:** open **Routines**, switch on a check-in and press **Call everyone now**. Use **Fill in** for the manual side.
- **Real phone calls (Twilio):**
  1. Create a Twilio account. On a free trial, verify each number you want to call under *Phone Numbers → Verified Caller IDs*. Get a Twilio number, and enable **India** under *Voice → Settings → Geo permissions*.
  2. Expose the API so Twilio can reach it: `brew install cloudflared`, then `pnpm tunnel`, and copy the `https://….trycloudflare.com` address it prints.
  3. In `master-ai-backend/.env`, set `PUBLIC_URL` (that address), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`, then restart `pnpm dev`.
  4. In **Settings → Phone calls to the team**, choose **Real phone calls (Twilio)**.

  The person hears an AI voice and answers by speaking, and the web app shows the conversation live. Real calls only go out between 9 am and 9 pm IST, even with fast schedule on. A quick tunnel's address changes every time it restarts, so update `PUBLIC_URL` to match.

### Checks

| Command | What it checks | Needs |
| --- | --- | --- |
| `pnpm turbo run build typecheck test` | Build, types and unit tests in every package, including the test sets | Nothing running |
| `pnpm evals` | Just the test sets, with a scorecard per organization type | Nothing running |
| `pnpm evals:live [--pack <id>] [--rpm <n>]` | The test sets with the model answering review and classification; prints the cost. `--rpm` paces calls for a free key | `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` (shell or the backend's `.env`) |
| `pnpm pack:check --pack <pack.yaml> --suite <suite.yaml>` | A draft pack and its test set, before copying them into `packs/` ([guide](docs/packs.md)) | Nothing running |
| `pnpm smoke` | The whole platform end to end through the API | `pnpm dev` |
| `pnpm e2e:sectors [--only <id>]` | Every organization type end to end | `pnpm dev` |
| `pnpm e2e` | The browser tests. First time: `pnpm --filter @onehuman/web exec playwright install chromium` | `pnpm dev` |
| `pnpm e2e:mobile` | The phone flows. Needs Metro on :8082, the Android emulator with Expo Go, and Maestro 2.10.0 in `~/.maestro` | `pnpm dev` |

`pnpm e2e:sectors` also runs against a model: restart `pnpm dev` with a key set, and it runs one organization per sector, one at a time, and reports where the model judged differently from the test set. The smoke test, the browser tests and the phone flows expect offline mode. To run CI's end-to-end job locally, stop `pnpm dev` and run `bash infra/ci/e2e.sh` (it always runs offline).

## How a pack works

A pack is YAML ([example](packs/power-plant/pack.yaml)) that `extends` base packs and adds what the organization needs:

- **sector** and **lifecycle**: the case label, the 8 stage names, priorities, approver roles, and case types with their keywords, required details, checks, approval and sign-off rules and worked examples;
- **entities**: typed fields, validated on every write and rendered by the schema-driven UI;
- **agents**: role, tools, clearance level (1–4), model tier, data class, token/money/step budgets;
- **tools**: sector names over generic primitives, e.g. `booking.confirm` = `records.update` with `status: confirmed`, marked irreversible and external;
- **workflows**: task graphs the planner can use;
- **policies**: `require_approval`, `require_approval_above`, `forbid`, `forbid_above`, compiled to Cedar;
- **routines**, **playbooks** and **kpis**.

Adding an organization type means adding YAML and a test set, or letting the generator draft one. No core change is needed. The pack authoring guide is [docs/packs.md](docs/packs.md).

An installed workspace keeps a snapshot of its pack. When the base packs later gain agents, workflows, tools, policies, KPIs or lifecycle parts, the Industry pack and Team pages offer them as an update. Applying it only adds what is missing; nothing the owner already has is replaced.

## Decisions

1. [Monorepo with three app folders, modular monolith backend](docs/adr/0001-monorepo-and-modular-monolith.md)
2. [Drizzle + Cedar, and one autonomy scale for agents and actions](docs/adr/0002-drizzle-cedar-and-the-autonomy-model.md)
3. [The platform adapts to the owner's industry at signup](docs/adr/0003-industry-adaptation.md)
4. [Built-in auth now, OIDC later; device-signed approvals](docs/adr/0004-auth-and-signed-approvals.md)
5. [LLM gateway, stateless agent steps, offline mode](docs/adr/0005-llm-gateway-and-stateless-agent-steps.md)
6. [Local Temporal runs on Postgres](docs/adr/0006-temporal-on-postgres.md)
7. [Work handed to staff by phone: Twilio, with a simulator](docs/adr/0007-phone-delegation-to-staff.md)
8. [Routines: repeating check-ins, by hand or by phone](docs/adr/0008-routines-manual-or-automatic.md)
9. [Organization types first, and every request a case through 8 stages](docs/adr/0009-organization-types-and-the-case-lifecycle.md)
10. [Named roles approve: invites, approver roles and who may decide](docs/adr/0010-roles-invites-and-gate-approvals.md)
11. [Google Gemini as an optional second model provider](docs/adr/0011-gemini-as-a-second-model-provider.md)

## Not built yet

| Area | Status |
| --- | --- |
| Real connectors (WhatsApp Business, Razorpay, Tally, Gmail, MCP servers) | The sandbox connector records every outbound action in the outbox; the connector interface is in place |
| WhatsApp and email intake, and messages back to customers | Need the connectors |
| People working stages from a queue | Considered and not chosen; agents work every stage |
| Two-tier approval; amounts worked out from records | A rule names one role; amounts come from the request |
| Keycloak / OIDC, passkeys (WebAuthn), SSO | Built-in password auth + HS256 sessions; device Ed25519 keys sign approvals ([ADR 0004](docs/adr/0004-auth-and-signed-approvals.md)) |
| Data visibility per role | Everyone in a company sees all cases; the approvals inbox is per person |
| ClickHouse KPIs, Redis rate limits, object storage | Not started; public routes are rate-limited in process |
| pgvector embeddings | Column and index ready; knowledge search uses Postgres full text |
| Indian caller ID (Exotel / Plivo), Indian languages, call recording | Real calls go through Twilio, in English; Exotel or Plivo would plug in behind the same call flow ([ADR 0007](docs/adr/0007-phone-delegation-to-staff.md)) |
| Field capture, A2A, digital twin, marketplace | Future layer, as in the plan |
| Terraform / Helm / Argo CD, SOC 2 | Not started |

Smaller gaps found by reviews, and the sector questions that need an expert, are listed in [docs/known-gaps.md](docs/known-gaps.md).

## Open decisions still yours

Cloud and region (AWS vs GCP Mumbai, any on-premise pilot), primary LLM providers per data class, self-hosted vs Temporal Cloud in production, pricing model, product name clearance, and the sector questions in [known gaps](docs/known-gaps.md#questions-for-an-expert). Decided in this build: monorepo with the three app folders, Drizzle + Cedar, organization type chosen by the owner at signup, every request a case through 8 named stages, named roles approving, and the Glow look.

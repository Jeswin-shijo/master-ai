# ONEHUMAN OS

One agent-native platform where every industry is a configuration pack, not new code. The owner says what the business does; the platform adapts its agents, records, approval rules and KPIs to it. Agents do the work, a policy engine (not the AI) decides what they may do, and the owner approves risky actions from web or phone with a signed decision.

This repository implements the **vertical slice** of the [architecture plan](docs/architecture-plan.md): every layer is real and connected end to end, and the slice runs with no AI key.

## What works today

| Flow | How it works |
| --- | --- |
| **Industry adaptation** | At signup the owner types their industry in their own words. The registry matches a curated pack (`travel-agency`), or the generator builds one: with a model it designs sector-specific entities, agents, tools, workflows, policies and KPIs; without one it composes base packs and renames records for the sector (a dental clinic gets *Patients*, *Treatments*, *Appointments*). The owner reviews the pack, then installs it. |
| **Goal → plan → agents** | A goal becomes a durable Temporal workflow. The orchestrator plans a task graph; the owner reviews the plan; each task runs as its own workflow where an agent proposes one tool call per step. |
| **Policy gate** | Every proposed action is risk-scored (action type, money, reversibility, external reach, data sensitivity, track record) and checked by Cedar policies compiled from the pack: Levels 1–3 run, Level 4 waits for approval, Level 5 is blocked. Kill switches, allow-lists, money budgets and prompt-injection guards are Cedar rules too. |
| **Signed approvals** | Each device has an Ed25519 key (browser storage on web; keychain + Face ID / fingerprint on mobile). Decisions are signed and verified server-side; forged signatures are refused. The task workflow sleeps until the decision arrives, for days if needed. Rejections go back to the agent with the owner's note. |
| **Audit** | Every state change is an append-only, hash-chained event. The audit explorer verifies the chain and replays any goal step by step. |
| **Tenancy** | Postgres row-level security on every table; the app connects as a role that cannot bypass it. |
| **Live everywhere** | Audit events stream over NATS to WebSocket clients; agent text streams over SSE. |
| **Earned autonomy** | After 5 unchanged approvals of the same action, the platform suggests letting that agent do it alone. The owner grants or revokes in one tap; amount limits still apply. |
| **Work done by the team, by phone** | When a goal needs a person ("Make sure the Munnar rooms are inspected before the group arrives"), the agent hands it to the staff member in charge and a durable workflow calls them: **assign** (they accept and give a time), **follow up** before it is due, **confirm** when it is due. Unanswered calls are retried; calls happen only in working hours. Declined, blocked or not-done work comes back to the owner. Telephony is simulated for now ([ADR 0007](docs/adr/0007-phone-delegation-to-staff.md)). |
| **n8n-style workspace** | Dark-first theme (light and system in Settings). Each goal is a node canvas (trigger → steps → tools and calls), and the Workflows gallery lists every workflow the installed pack offers, ready to start. The mobile app has the same dark look and a Calls tab with each transcript. |

Verified end to end: [`pnpm smoke`](master-ai-backend/scripts/smoke.ts) runs signup → pack → goal → plan → approval (with a forged-signature check) → execution → realtime → audit verification → RLS isolation → kill switch → phone delegation (assign, follow-up and confirm calls). The web flow, including answering all three calls in the simulator, was driven in headless Chrome. The mobile flow (sign in, signed approve and reject, Calls tab) was checked on an Android emulator.

## Repository

```
master-ai/
├─ master-ai-backend/   NestJS modular monolith (API) + Temporal worker (agents)
├─ master-ai-web/       Owner command center: React + Vite + Tailwind + TanStack Query
├─ master-ai-mobile/    Approvals-first app: Expo SDK 57 + Expo Router
├─ packages/
│  ├─ schemas/          Zod schemas + types for packs, agents, API, events (single source of truth)
│  ├─ agent-kit/        Tool catalog, pack resolution, industry matching, offline pack composer
│  ├─ policy/           Risk scoring + Cedar policy engine (+ tests)
│  ├─ sdk/              Typed API client, realtime client, approval signing
│  └─ ui/               Design tokens for web (CSS variables) and mobile, tenant white-labelling
├─ packs/               Industry Packs (YAML): core-business, crm/bookings/orders/projects bases, travel-agency
├─ infra/docker/        Local stack: Postgres + pgvector, Temporal (on Postgres), NATS JetStream
├─ docs/adr/            Architecture decisions
└─ evals/               Agent and pack eval suites (next phase)
```

The backend modules map one-to-one to the plan's services (identity, orchestrator, workflows, agent runtime, LLM gateway, policy and approval, knowledge, connector gateway, pack registry, audit, KPIs, notifications), so any one of them can be split into its own service later.

## Run it

Prerequisites: Node 24 (`nvm use`), Docker, and pnpm via Corepack (`corepack enable pnpm`).

```bash
pnpm install
pnpm infra:up                                   # Postgres, Temporal (+ UI on :8233), NATS
cp master-ai-backend/.env.example master-ai-backend/.env
pnpm db:migrate
pnpm dev                                        # shared packages (watch) + API :3000 + worker + web :5173
```

Open http://localhost:5173, choose **Set up your company**, and type your industry.

- **Mobile:** `pnpm --filter @onehuman/mobile start` (Metro on :8082), then open it in Expo Go. The app finds the API on the same machine automatically; set `EXPO_PUBLIC_API_URL` to override. Remote push needs a development build (`eas build --profile development`); Expo Go removed push on Android in SDK 53.
- **Real models:** set `ANTHROPIC_API_KEY` in `master-ai-backend/.env`. Without it the LLM gateway runs in deterministic **offline mode** (labelled `offline` in metering), which is what tests and CI use. Model tiers: frontier `claude-opus-5-5`, standard `claude-sonnet-5-5`, small `claude-haiku-5-5` (configurable).
- **Phone calls:** installing with *sample records* also adds three staff members (Team page); you can add your own there. Give a goal such as *"Make sure the hotel rooms are inspected before Friday"*. In **Settings → Phone calls to the team**, choose who answers simulated calls. With **You do, in this app** (the default), each call rings at the bottom right of the web app and you answer as the staff member by typing, using quick replies, or speaking (Chrome). With **A simulated staff member**, calls answer themselves. **Fast schedule (demo)**, on by default, puts seconds between calls instead of hours.
- **Checks:** `pnpm turbo run build typecheck test` (unit tests) and `pnpm smoke` (end to end against a running stack).

## How a pack works

A pack is YAML ([example](packs/travel-agency/pack.yaml)) that `extends` base packs and adds what the sector needs:

- **entities**: typed fields, validated on every write and rendered by the schema-driven UI;
- **agents**: role, tools, clearance level (1–4), model tier, data class, token/money/step budgets;
- **tools**: sector names over generic primitives, e.g. `booking.confirm` = `records.update` with `status: confirmed`, marked irreversible and external;
- **workflows**: task graphs the planner can use;
- **policies**: `require_approval`, `require_approval_above`, `forbid`, `forbid_above`, compiled to Cedar;
- **kpis**: counts over records, operational metrics, or "needs connector".

Adding an industry means adding a YAML file, or letting the generator draft one. No core change is needed.

An installed workspace keeps a snapshot of its pack. When the base packs later gain agents, workflows, tools, policies or KPIs, the Industry pack and Team pages offer them as an update. Applying it only adds what is missing; nothing the owner already has is replaced.

## Not built yet

| Area | Status |
| --- | --- |
| Real connectors (WhatsApp Business, Razorpay, Tally, Gmail, MCP servers) | Sandbox connector records every outbound action in the outbox; the connector interface is in place |
| Keycloak / OIDC, passkeys (WebAuthn) | Built-in password auth + HS256 sessions; device Ed25519 keys sign approvals ([ADR 0004](docs/adr/0004-auth-and-signed-approvals.md)) |
| ClickHouse KPIs, Redis rate limits, object storage | Not started; events are already durable in JetStream for a ClickHouse sink |
| pgvector embeddings | Column and index ready; knowledge search uses Postgres full text |
| Real phone calls (Exotel / Plivo), speech services, Indian languages | Calls run in the built-in simulator, in English; the call flow, transcripts and audit are real ([ADR 0007](docs/adr/0007-phone-delegation-to-staff.md)) |
| Field capture, A2A, digital twin, marketplace | Future layer, as in the plan |
| Terraform / Helm / Argo CD, SOC 2 | Not started |
| Eval suites per agent and pack | Not started ([evals/](evals/README.md)) |

## Open decisions still yours

Cloud and region (AWS vs GCP Mumbai, any on-premise pilot), primary LLM providers per data class, self-hosted vs Temporal Cloud in production, pricing model, product name clearance. Decided in this build: monorepo with the three app folders, Drizzle + Cedar, industry chosen by the owner at signup instead of a single pilot vertical.

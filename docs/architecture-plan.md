# ONEHUMAN OS — Full-Stack Architecture Plan

Oct 12, 2026 · Jeswin Shijo. Markdown copy of the plan this repository implements. Decisions taken since are recorded in [adr/](adr/).

ONEHUMAN OS is built as one agent-native platform: a TypeScript monorepo with a web command center, a mobile app and a durable agent backend, where every industry is a configuration pack, not new code.

## Design principles

1. **Agent-native, not AI-bolted-on.** Agents are first-class users of the system, with identities, permissions, budgets and audit trails like human staff.
2. **Industries are data, not code.** A sector is an Industry Pack: workflows, agent roles, data schemas, KPIs and approval rules, loaded at runtime.
3. **Model-agnostic.** All LLM calls go through one gateway that routes between frontier, open and on-device models. Swapping a model never touches business logic.
4. **Durable by default.** Every task is a durable workflow that survives crashes, deploys and multi-day approval waits.
5. **Policy as code.** Who and what may act is decided by a versioned policy engine, never by prompts.
6. **Event-sourced truth.** Every action is an immutable, hash-chained event, so the audit log is the system of record and can be replayed.
7. **Open protocols.** Tools speak MCP; agents can talk to outside agents over A2A. Integrations come from an ecosystem, not one-off code.
8. **Owner-first interfaces.** Web, mobile and voice share one design system and one real-time API; the owner can approve anything from a phone in seconds.

## System at a glance

Six layers; every agent action passes the policy engine.

| Layer | Components |
| --- | --- |
| Clients | Web console (React TSX + Vite), mobile app (React Native + Expo), voice (English + Indian languages), partner API (SDK, marketplace) |
| Edge | API gateway / BFF: auth, rate limits, tenant routing; REST, WebSocket, SSE |
| Core services | Orchestrator (goals to tasks), **policy engine** (risk, approvals), pack registry, knowledge (docs, memory), KPIs + alerts |
| Execution | Temporal workflows (durable tasks, waits), agent runtime (sandboxed, budgeted), LLM gateway (route, redact, meter), connector gateway (MCP tools, vault) |
| Data | PostgreSQL (RLS + pgvector), ClickHouse (events, KPIs), NATS (event bus), Redis (cache, limits), object storage |
| Outside world | AI models (frontier, open, on-device); business tools (CRM, ERP, WhatsApp, payments, A2A agents) |

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Monorepo | pnpm + Turborepo | Shared types, UI and SDKs across all apps |
| Web app | React + TypeScript, Vite, React Router, Tailwind, shadcn/ui | Fast builds, full control of the SPA |
| Mobile app | React Native + Expo (EAS) | One codebase for iOS/Android, OTA updates, push |
| Shared UI | Design-system package + Tamagui or NativeWind | Same components on web and mobile |
| Client state | TanStack Query + Zustand | Server-cache sync and light local state |
| API | NestJS — REST/OpenAPI + WebSocket/SSE | Modular, typed, streams agent output live |
| Workflow engine | Temporal | Durable tasks, retries, human-approval waits of days |
| Event bus | NATS JetStream | Lightweight pub/sub and streams |
| Agent runtime | In-house TS runtime + MCP client | Full control of budgets, tools and stop conditions |
| LLM gateway | In-house router (LiteLLM-style) | Route by cost, latency, privacy; fallbacks; caching |
| Primary DB | PostgreSQL + row-level security | Tenant isolation inside the database |
| Vector / memory | pgvector | Knowledge search without a second database |
| Analytics / audit at scale | ClickHouse | Fast KPI queries over billions of events |
| Cache / rate limits | Redis (Valkey) | Sessions, locks, rate limiting |
| Files | S3-compatible object storage | Documents, uploads, exports |
| Policy engine | OPA or Cedar | Versioned, testable permission rules |
| Auth | Keycloak (OIDC) + passkeys | SSO, MFA, self-hostable for data residency |
| Infra | Kubernetes, Terraform, Argo CD | Reproducible, GitOps deploys, any cloud |
| Observability | OpenTelemetry, Grafana stack, Langfuse | Traces across services and every LLM call |

## Frontend

**Web command center:** command bar (type or speak a goal; the orchestrator shows its plan before it runs) · live operations view · approval inbox (action, risk score, evidence, cost; approve / edit / reject) · generative dashboards · agent studio · pack studio · audit explorer.

**Mobile:** approvals first (push, Face ID / fingerprint, signed with the device's passkey) · daily pulse (readable or spoken) · voice mode · field capture · offline-first (SQLite cache; approvals queue and sync).

**Shared:** `@onehuman/ui` tokens (light/dark, per-tenant white-label) · `@onehuman/sdk` typed client · WebSocket for events, SSE for agent text · packs ship UI schemas rendered by a schema-driven renderer.

## Backend services

Start as a modular monolith (one NestJS app, strict module boundaries); split modules into services only when load or team size demands it.

API gateway / BFF · identity & access · orchestrator · workflow engine (Temporal workers) · agent runtime · LLM gateway · policy & approval · knowledge & memory · connector gateway · industry pack registry · audit & events · analytics & KPIs · notifications · billing & metering · evaluation.

## Agent runtime and orchestration

Every goal becomes a Temporal workflow: the orchestrator plans a task graph, agents propose actions, and the policy engine decides each one. Lifecycle: goal → plan → agent proposes action → policy check → Level 1–3 execute / Level 4 await approval / Level 5 blocked and logged → quality check → done (audit + KPIs). Rejected or edited approvals go back to the agent with the approver's notes; failed quality checks retry within budget, then escalate.

```yaml
id: booking-coordinator
version: 3.1.0
role: Confirms supplier bookings for approved itineraries
model: { tier: standard, fallback: small, data_class: confidential }
tools: [booking.hold, booking.confirm, payments.request, email.draft]
autonomy_default: 2
budgets: { tokens_per_task: 200000, money_per_task_inr: 0, max_steps: 40 }
memory: { episodic: true, knowledge: [supplier-policies, refund-policy] }
stop_when: [goal_met, budget_exceeded, policy_blocked, needs_human]
output_schema: BookingResult
evals: evals/booking-coordinator/*.yaml
```

## Industry Packs

Each sector is a versioned pack installed into a tenant: entities (JSON Schema), agent roles, workflows, policies, KPIs, UI schemas, connectors, eval suite. Packs inherit (`travel-agency` extends `bookings-base`); tenants can fork a pack without losing upstream updates.

## Policy and approval engine

1. The agent proposes an action, e.g. `refund.issue { amount: 12000 }`.
2. The engine computes a risk score from action type, money, data sensitivity, reversibility, external reach and the agent's track record.
3. Tenant and pack policies (OPA/Cedar) map the score to an autonomy level 1–5.
4. Level 1–3 runs inside budget and rate limits; Level 4 creates an approval request and the workflow sleeps; Level 5 is refused and logged.

Approvals are routed to the right approver, signed with the approver's passkey, can expire, escalate or be delegated, and are batched on mobile. **Earned autonomy:** after many unedited approvals of an action, the engine suggests lowering it to Level 3; the owner decides and can revoke in one tap.

## Data architecture

PostgreSQL is the system of record with RLS on every table. Tenancy tiers: shared (tenant_id + RLS), dedicated schema/database, dedicated region/on-premise. Core entities: Tenant, Workspace, Principal, Goal, Task, AgentSpec/AgentRun, ToolCall, ApprovalRequest, Policy, PackRecord, KnowledgeDoc/Chunk, Memory, AuditEvent, KPI/Metric. Memory layers: working, episodic, semantic, business graph. All events stream into ClickHouse for KPIs.

## Integrations

One connector gateway; agents see tools, never credentials. MCP-first · credential vault · inbound events (webhooks, email/WhatsApp) on NATS · fallbacks (CSV/Excel import, email parsing, sandboxed browser agent at Level 4) · India-first set (WhatsApp Business, Razorpay, Tally, Zoho, GST exports, UPI) plus global tools · public API + SDK.

## Security, compliance, observability

Zero-trust between services; scoped, expiring agent credentials · untrusted content can never grant permissions · PII redaction in the LLM gateway · encryption at rest and in transit · kill switch for an agent, workspace or tenant. India DPDP Act 2023 baseline plus GDPR; sector controls per pack; SOC 2 Type II and ISO 27001 after the pilot; regulator-ready audit exports. OpenTelemetry traces end to end, Langfuse for LLM cost, quality signals per agent version.

## Infrastructure

Managed Kubernetes in an India region, everything in Terraform · preview/staging/production · GitHub Actions + Argo CD + EAS · eval-gated canary releases · managed Postgres, Temporal, ClickHouse · hosted model APIs first, GPU pool later · CDN + edge auth · per-tenant and per-agent budgets in the LLM gateway.

## Future layer

Company digital twin · what-if simulation · agent-to-agent commerce (A2A) · self-improving workflows · earned autonomy · generative interfaces · voice-first multilingual · on-device AI · agent marketplace · predictive operations.

## Build roadmap

| Phase | Months | Scope |
| --- | --- | --- |
| Foundations | 0–2 | Monorepo, CI/CD, auth, tenants, RLS, design system |
| Core platform | 2–5 | Orchestrator, Temporal, policy, approvals, audit |
| Agents + mobile | 4–7 | Shared agents, LLM gateway, mobile approvals |
| Pilot pack | 6–9 | Industry pack, 1–3 pilot clients, evals, KPIs |
| Scale + future | 9+ | Pack studio, more industries, twin, A2A, marketplace |

Gates: pilot client signed with data access; pilot KPIs met and safety review passed.

## Open decisions (from the plan)

Pilot industry · team size and timeline · cloud provider and region · primary LLM providers and data classes · OPA vs Cedar · Drizzle vs Prisma · self-hosted vs Temporal Cloud · pricing model · product name clearance.

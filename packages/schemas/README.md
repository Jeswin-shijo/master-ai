# @onehuman/schemas

The single source of truth for data shapes. The backend validates request bodies with these zod schemas, the SDK sends the same shapes, and packs are parsed with them.

| File | Holds |
|---|---|
| `lifecycle.ts` | The 8 stage keys, sectors (`SECTORS`), the 15 ready-made organization types (`ORG_TYPES`), and the lifecycle part of a pack (stages, priorities, roles, categories, approval and sign-off rules) |
| `case.ts` | The case file: one zod schema per stage's part (request, review, classify, assign, approve, execute, close, report) |
| `pack.ts` | The pack format: entities, agents, tool aliases, workflows, policies, routines, KPIs, playbooks; `ResolvedPack`; pack updates |
| `api.ts` | Request bodies: signup, cases, intake, invites, approvals, settings… |
| `domain.ts` | Response shapes: `Case`, `CaseDetail`, `CaseReport`, `ApprovalRequest`, `Goal`, `GoalReport`… |
| `events.ts` | Audit and realtime events, and `summarizeEvent` for one-line descriptions |
| `autonomy.ts` | The autonomy scale (Levels 1–5) used for agents and actions, and data classes |
| `canonical.ts` | Deterministic JSON for hashing the audit chain and signing approvals |

Change a shape here first, then the backend and the SDK follow. Dates are ISO strings on the wire.

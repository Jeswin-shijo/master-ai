# Decision records

Each record explains one decision: the situation, what was decided, and what follows from it. Add a new one as `00NN-short-title.md`, in the same shape (Context, Decision, Consequences), and list it here and in the root README's **Decisions** section (`evals/__tests__/docs.test.ts` checks that).

| # | Decision | In one line |
|---|---|---|
| [0001](0001-monorepo-and-modular-monolith.md) | Monorepo, modular monolith | Three app folders plus shared packages in one repository; one backend whose modules could each become a service later |
| [0002](0002-drizzle-cedar-and-the-autonomy-model.md) | Drizzle + Cedar, one autonomy scale | Typed SQL with Drizzle; permissions as Cedar policies; Levels 1–5 for both agents and actions |
| [0003](0003-industry-adaptation.md) | Adapting to the industry at signup | The owner's words choose or generate a pack; no code per industry |
| [0004](0004-auth-and-signed-approvals.md) | Built-in auth, signed approvals | Password auth and sessions now, OIDC later; every approval signed by a device key |
| [0005](0005-llm-gateway-and-stateless-agent-steps.md) | One LLM gateway, stateless steps | Every model call goes through one gateway; agent steps rebuild their context each time; offline mode without a key |
| [0006](0006-temporal-on-postgres.md) | Temporal on Postgres | The local Temporal persists to Postgres, not the SQLite dev server |
| [0007](0007-phone-delegation-to-staff.md) | Work handed to staff by phone | Agents phone the person in charge (assign, follow up, confirm), through Twilio or a simulator |
| [0008](0008-routines-manual-or-automatic.md) | Routines, by hand or by phone | Repeating check-ins from the pack, run by forms or by AI calls on Temporal schedules |
| [0009](0009-organization-types-and-the-case-lifecycle.md) | Organization types and the 8-stage case | The type comes first at signup; every request is a case through 8 named stages; gates are policy decisions |
| [0010](0010-roles-invites-and-gate-approvals.md) | Named roles approve | Access roles versus approver roles, invites, routing to role holders, who may decide |
| [0011](0011-gemini-as-a-second-model-provider.md) | Gemini as a second provider | Claude stays the default; Gemini is optional behind the same gateway, with rate limits and a rules fallback for free keys |
| [0012](0012-lists-and-checks.md) | Lists and checks | Each organization type's lists are pack data; six fixed checks worked out in SQL when read; only people mark items checked |
| [0013](0013-calls-to-outside-parties.md) | Calls that fill lists, and calls to outside parties | Collection routines add items by phone; follow-ups on list items call staff or, if the owner allows, parties; what parties say is a note the head applies |
| [0014](0014-job-cards-and-jobs.md) | Job cards and jobs | Every agent has a card of mission, never list and stop words; written work is scripted steps where code checks and the AI only fills typed fields; stop words and forbidden tools are enforced in code |

# @onehuman/policy

Decides whether each agent action, and each case gate, may run. The AI never decides this.

- **`risk.ts`**: scores a proposed action on its kind, the money involved, whether it can be undone, whether it reaches outside the company, how sensitive the data is, and the agent's track record.
- **`cedar.ts`**: compiles the pack's policies into Cedar rules: `require_approval`, `require_approval_above`, `forbid` and `forbid_above`, with `when` conditions on category, priority, risk and source for gates. It also adds the kill switch, allow-lists, money budgets and prompt-injection guards.
- **`engine.ts`**: `PolicyEngine` puts the two together and returns a level and the reasons: Levels 1–3 run, Level 4 waits for a person, Level 5 is blocked. Evaluation fails closed: if it can't decide, the action needs approval.

Case gates (`case.proceed`, `case.close`) go through the same engine, with the case's category, priority, risk and source as context. Tests: `engine.test.ts`, `gates.test.ts`.

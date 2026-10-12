# Evals

Next phase. Each agent spec and pack will ship test cases here (`evals/<agent-or-pack>/*.yaml`): given a goal and seeded records, the expected tool calls, policy levels and outcome. A pack or agent change must pass its suite before release (canary per tenant, roll back on quality drop).

Today's coverage: unit tests for packs, policy and offline strategies (`pnpm turbo run test`) and the end-to-end smoke test (`pnpm smoke`).

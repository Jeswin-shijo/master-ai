# Evals

Scored test sets for industry packs. Each suite in `suites/<pack-id>.yaml` lists realistic requests, as people really write them, with the expected category, priority, review outcome, approval (and approver role) and sign-off.

Suites: `core-business` (the generic lifecycle) and one per ready-made organization type: power-plant, manufacturing-plant, construction, logistics, wholesale-retail, travel-agency, lender, accounting-firm, ngo, software-saas, it-services, digital-agency, hospital, education and municipal. A completeness test fails the build if a ready-made pack has no suite.

- `pnpm evals` scores every suite offline: the offline stage strategies from `@onehuman/agent-kit` plus the real Cedar policy engine for gates. It runs in CI and fails below these thresholds: category 90%, priority 90%, review 80%, approval and sign-off 100%.
- Gates are scored given the expected category and priority, so they test the rules, not the classifier. Their risk is high for P1, otherwise the category's risk.
- `pnpm pack:check --pack <draft pack.yaml> --suite <draft suite.yaml>` checks one draft against the packs on disk: validation, the quality bar for ready-made content, the scorecard, and that no test request is copied into the pack's worked examples.
- `pnpm evals:live [--pack <id>] [--rpm <n>]` asks the model for review and classification through the same stage prompts and safety rules the backend uses, and prints each scorecard with how many answers came from the model and the cost. Gates are rules, so their scores match the offline run. It needs `ANTHROPIC_API_KEY`; without one it says so and exits.
- Never copy an eval request into a pack's `lifecycle.examples`. Examples teach the model; evals test it.

When an answer is wrong, fix the pack (keywords, required details, rules) or its examples the way the organization really works, and the score shows the gain. See [docs/packs.md](../docs/packs.md).

Also in `src/`:

- `sector-runs.ts`: the 20 organizations `pnpm e2e:sectors` sets up (every ready-made type, plus one per sector in the owner's own words), the request each sends and through which door, and the checks on a finished case. Its test proves every chosen request gets its test set's answers offline.
- `live.ts` and `live-lib.ts`: `pnpm evals:live` with Claude or Gemini (ADR 0011). A failed call counts as the rules answering, and a refused key stops the run.
- `docs.test.ts`: keeps the docs honest. Every link in every README and doc must resolve, every decision record must be listed in the README, every root command must be explained, and every organization type must be named.

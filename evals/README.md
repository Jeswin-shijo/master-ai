# Evals

Scored test sets for industry packs. Each suite in `suites/<pack-id>.yaml` lists realistic requests with the expected category, priority, review outcome, approval (and approver role) and sign-off.

- `pnpm evals` scores every suite offline: the offline stage strategies from `@onehuman/agent-kit` plus the real Cedar policy engine for gates. It runs in CI and fails below these thresholds: category 90%, priority 90%, review 80%, gates 100%.
- Gates are scored given the expected category and priority, so they test the rules, not the classifier.
- Live model scoring (`pnpm evals:live`) arrives with the backend stage service (Plan 3).
- Never copy an eval request into a pack's `lifecycle.examples`. Examples teach the model; evals test it.

When an answer is wrong, fix the pack (keywords, required details, rules) or its examples, and the score shows the gain.

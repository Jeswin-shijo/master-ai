# @onehuman/agent-kit

Everything agents and case stages need that isn't a server: pure functions, shared by the backend and the evals.

## Files

| File | Holds |
|---|---|
| `catalog.ts` | The generic tool primitives (`records.update`, `message.send`, `staff.delegate`, `case.proceed`…). Each one carries its risk metadata (control type, reversible, external, data class). Every industry tool is one of these or a pack alias over one |
| `tools.ts` | A tool as one agent sees it: the primitive plus the pack's alias layer, its JSON schema, and its wire name (`records__update`) |
| `pack.ts` | Parse, resolve (`extends`), validate and update packs: `parsePack`, `resolvePack`, `validatePackRefs`, `packUpdates`, `normalizeSnapshot` |
| `match.ts` | Turn an owner's own words into a pack: `matchIndustry`, `composeForSector` (ready-made, then similar, then sector defaults), `composeOfflinePack` |
| `narrate.ts` | Steps in plain words (`narrateStep`), errors for people (`humanError`), and `forPeople`, which strips record ids from text a model wrote |
| `pricing.ts` | Model prices (Claude, Gemini by family) and `costUsd` |
| `gemini.ts` | The Gemini request and response mapping (`geminiParams`, `readGemini`, `mergeGeminiChunks`, `geminiClientOptions`) |

## `lifecycle/`: the 8 stages

| File | Holds |
|---|---|
| `generic.ts` | The generic stage names and P1–P4 defaults every pack builds on |
| `resolve.ts` | Merge lifecycle parts down the `extends` chain (`lifecycleOf`) |
| `offline.ts` | The built-in rules for each stage: request, review, classify, assign, verify, report. They answer when there is no AI, and they are what the evals score |
| `prompts.ts` | System and user prompts and JSON schemas for the stages that use the AI (`MODEL_STAGE_SCHEMAS`, `stageSystemPrompt`) |
| `merge.ts` | Merge the AI's answer under the rules, which keep the floors: an urgent case stays P1, untrusted amounts can only raise a gate, and verification can refuse but never accept what the rules refuse |
| `extract.ts` | Read amounts in Indian formats (₹1,46,300 · 1.5 lakh · 2 crore) and normalise text |
| `text.ts` | The sentences people read: stage summaries and the stage-6 goal text |
| `quality.ts` | The quality bar for ready-made content (checked by `pack.test.ts` and `pnpm pack:check`) |

## Tests

`pnpm --filter @onehuman/agent-kit test`. These include `pack.test.ts`, which checks that every pack in `packs/` parses, resolves and validates; run it after editing packs.

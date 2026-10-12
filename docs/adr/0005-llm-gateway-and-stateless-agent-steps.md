# 0005. LLM gateway, stateless agent steps, offline mode

Date: 2026-10-12 · Status: accepted

## Decision
- All model calls go through `LlmService`: tier routing (frontier `claude-opus-5-5`, standard `claude-sonnet-5-5`, small `claude-haiku-5-5`, set by env), PII redaction with placeholders restored only inside tool arguments, prompt caching on the stable system + tools prefix, server-side refusal fallback (`fallbacks: "default"`), fallback tier on transient errors, and metering of tokens and ₹ cost per tenant, goal and task.
- **Agent steps are single-turn and stateless.** Each step rebuilds context from the database (task, goal, prior actions and outcomes, owner feedback) and asks for exactly one tool call. Nothing lives in model conversation history, so crashes, deploys and multi-day approval waits are safe. Tool results are wrapped in `<untrusted_data>`.
- Forced `tool_choice` is rejected by current models, so agents get `auto` plus the instruction to call exactly one tool, and a turn without a tool call becomes feedback.
- **Offline mode.** With no key, deterministic strategies stand in for the model (planner, agent, pack composer) under the same contracts. Tests, CI and demos run end to end without spending tokens. The offline agent never invents money amounts.

## Consequences
Swapping or adding a provider touches one file. Offline output is labelled `provider: offline` in metering.

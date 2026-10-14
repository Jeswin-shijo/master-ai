# 0011. Google Gemini as an optional second model provider

Date: 2026-10-14 · Status: accepted

## Context
Every model call goes through one gateway, `LlmService` ([ADR 0005](0005-llm-gateway-and-stateless-agent-steps.md)), and until now it spoke only to Claude. Without a key it runs on deterministic offline rules, which is what tests and CI use. The owner wanted to test the live path (real model answers in the case stages, agents and the scored test sets) with a Google key, rather than get a Claude key first. The README already listed "primary LLM providers per data class" as an open decision.

## Decision
- **Claude stays the default.** The gateway uses Claude when `ANTHROPIC_API_KEY` is set, otherwise Gemini when `GEMINI_API_KEY` is set, otherwise the offline rules. `LLM_PROVIDER=google` forces Gemini; `LLM_OFFLINE=always` forces the rules. `GET /health` says which provider answers.
- **Same tiers, same contract.** `GEMINI_MODEL_FRONTIER`, `_STANDARD` and `_SMALL` map the gateway's tiers (defaults: Google's Pro, Flash and Flash-Lite "-latest" aliases). Calls stay single-turn. JSON answers use the same JSON Schema (`responseJsonSchema`), and tools are offered as function declarations with the same schemas. Only the first tool call is taken, since Gemini has no switch to turn off parallel calls and agents run one step at a time. The model's thinking never reaches people. A blocked prompt or answer is a refusal. A cut-off or malformed tool call never runs. Rate limits and server errors move to the fallback tier, as with Claude.
- **One mapping, shared.** The request and response mapping is plain code in `packages/agent-kit/src/gemini.ts`, used by the backend and by `pnpm evals:live`, like the price table. Only `LlmService` and `evals/src/live.ts` import the Google SDK (`@google/genai`).
- **Metering as billed.** Tokens are counted the way Google bills them (cached input apart, thinking as output), at approximate list prices per model family.

## Consequences
- A Google key makes the live path testable end to end. Its scores measure Gemini, not the Claude models the prompts were written for, so they are not a quality bar for what ships.
- On Google's free tier, prompts may be used to improve Google's products and requests per minute are low. Use it with test data only. On the free tier Pro has no quota and Flash allows 20 requests a day, so all tiers can point at Flash-Lite; `LLM_MAX_RPM` spaces the gateway's calls out (per process, off by default), `LLM_RULES_WHEN_UNAVAILABLE=true` lets the built-in rules answer while the provider is out of quota or unreachable (a daily quota pauses it for up to six hours; metered as `offline-fallback`), `pnpm evals:live --rpm` paces the scoring, and the live sector run goes one organization at a time.
- Prompt caching is implicit on Gemini, and the server-side refusal fallback is Claude-only. Choosing a provider per data class (for example, keeping restricted data on one provider) is still open.

# 0002. Drizzle + Cedar, and one autonomy scale for agents and actions

Date: 2026-10-12 · Status: accepted

## Decision
- **Drizzle ORM.** SQL-first, so row-level security, the security-definer login function, the append-only audit trigger and pgvector stay plain SQL (`master-ai-backend/drizzle/0001_rls.sql`).
- **Cedar** (`@cedar-policy/cedar-wasm`, in-process) is the policy engine; there is no sidecar to run. Every proposed action asks two questions: `invoke` (deny → Level 5) and `invoke_unattended` (deny → Level 4). Pack rules (`require_approval`, `require_approval_above`, `forbid`, `forbid_above`) compile to Cedar `forbid` policies; kill switches, allow-lists, money budgets and untrusted-origin guards are base policies. Evaluation fails closed.
- **Autonomy levels.** An *action's* level comes from max(tool floor, risk band); risk score bands are tenant-configurable (defaults: <15 → 1, <35 → 2, <75 → 3, else 4). An *agent's* `autonomy` is its clearance: an action above it escalates to Level 4.
- **Earned autonomy** is an owner-granted override per agent and tool, down to Level 3 at most. It lifts blanket `require_approval` rules but never amount thresholds or forbids.

## Consequences
The LLM never decides what it may do. Policies are versioned per workspace, cached per version, and shown verbatim in the pack studio.

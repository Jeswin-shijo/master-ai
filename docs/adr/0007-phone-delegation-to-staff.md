# 0007. Work handed to staff by phone, simulated telephony first

Date: 2026-10-12 · Status: accepted

## Context
Much of the owner's work is done by people, not software: someone in charge has to inspect the rooms, chase the payment or arrange the vehicle. The owner wants agents to get that work done by calling the staff member in charge two or three times: once to assign it, once to follow up and once to confirm it is done. Calls are in English. No telephony provider has been chosen yet.

## Decision
- **A tool like any other.** `staff.delegate` is a catalog primitive (`control: 'delegate'`, base level 3) with input `{assignee, task, details?, due?}`. Risk scoring and Cedar gate it the same way they gate every other action. Packs give it to agents; core-business adds a `work-coordinator` agent and a `delegate-work` workflow.
- **The team is data.** Each staff record has a name, phone, title, responsibilities, working hours and language. The assignee is matched by name first, then by overlap between the task and the person's responsibilities.
- **A durable cadence.** An allowed delegation starts a child Temporal workflow (`delegationWorkflow`). It runs assign → follow-up (before the due time) → confirm (at the due time). A call nobody answers within 45 s is retried up to `maxAttempts` (default 3) every `retryMinutes` (default 15). Calls are placed only inside the person's working hours and a 9:00–21:00 IST window. The task waits in `waiting_on_team`.
- **Escalation, not guessing.** If the person declines, reports a blocker, says the work is not done or cannot be reached, the delegation closes with that status. The owner gets a notification and a "Needs you" item, and the agent receives the outcome as its tool result.
- **The conversation.** `CallEngine` runs one turn at a time. With a model, each turn is a structured output `{say, end_call, outcome, due_at, notes}`; offline, a scripted engine parses the reply. Every transcript, summary and outcome is stored on the call and audited (`call.*` and `delegation.*` events).
- **Simulated provider.** `settings.calls.provider` is `simulator` and has two modes:
  - `interactive`: the call rings in the web app, and whoever is at the browser answers as the staff member, by typing or by voice (Web Speech API).
  - `auto`: a cooperative simulated staff member answers by itself.

  `fastSchedule` (on by default) shrinks the waits between calls to seconds for demos.

## Consequences
- Delegations survive restarts, show up on the goal canvas, the Calls page and the mobile Calls tab, and are fully audited.
- Real calls need a provider adapter, which is not built. An adapter (Exotel or Plivo for Indian numbers) would replace the simulator branch in `DelegationService.placeCall` and map provider webhooks (answered, speech, hang-up) onto the same `answer`, `reply` and `decline` paths the simulator already uses. Speech-to-text and text-to-speech would come from the provider or a separate service. The `costInr` column is reserved for per-call cost.
- Before calling real people: turn `fastSchedule` off, add consent and recording disclosures, respect DND and calling-hours rules, and decide which Indian languages to support beyond English.

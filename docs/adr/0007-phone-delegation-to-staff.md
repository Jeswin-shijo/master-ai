# 0007. Work handed to staff by phone: Twilio, with a simulator

Date: 2026-10-12 · Status: accepted

## Context
Much of the owner's work is done by people, not software: someone in charge has to inspect the rooms, chase the payment or arrange the vehicle. The owner wants agents to get that work done by calling the staff member in charge two or three times: once to assign it, once to follow up and once to confirm it is done. Calls are in English. The owner chose Twilio for real calls, because a trial account can ring a verified phone the same day.

## Decision
- **A tool like any other.** `staff.delegate` is a catalog primitive (`control: 'delegate'`, base level 3) with input `{assignee, task, details?, due?}`. Risk scoring and Cedar gate it the same way they gate every other action. Packs give it to agents; core-business adds a `work-coordinator` agent and a `delegate-work` workflow.
- **The team is data.** Each staff record has a name, phone, title, responsibilities, working hours and language. The assignee is matched by name first; a team of one gets every job; otherwise the best overlap between the task and each person's responsibilities wins.
- **A durable cadence.** An allowed delegation starts a child Temporal workflow (`delegationWorkflow`). It runs assign → follow-up (before the due time) → confirm (at the due time). A call nobody answers within 45 s is retried up to `maxAttempts` (default 3) every `retryMinutes` (default 15). Calls are placed only inside the person's working hours and a 9:00–21:00 IST window. The task waits in `waiting_on_team`.
- **Escalation, not guessing.** If the person declines, reports a blocker, says the work is not done or cannot be reached, the delegation closes with that status. The owner gets a notification and a "Needs you" item, and the agent receives the outcome as its tool result.
- **The conversation.** `CallEngine` runs one turn at a time. With a model, each turn is a structured output `{say, end_call, outcome, due_at, notes}`; offline, a scripted engine parses the reply. Every transcript, summary and outcome is stored on the call and audited (`call.*` and `delegation.*` events).
- **Real calls through Twilio.** With `settings.calls.provider: twilio`, `placeCall` dials the person through Twilio's REST API (no SDK) and the conversation runs over TwiML webhooks:
  - `/voice/twilio/answer`: the person picked up, so the AI greets them.
  - `/voice/twilio/turn`: Twilio transcribes each reply (`<Gather input="speech" language="en-IN">`), the call engine answers, and Twilio speaks it (`<Say>`, Polly Indian-English voice).
  - `/voice/twilio/status`: busy, no answer or hang-up end the call, and the workflow retries.

  These webhooks reuse the same `answer`, `reply` and `decline` paths as the simulator. Each one must carry a valid `X-Twilio-Signature`, its URL carries the tenant and call ids, and the posted `CallSid` must match the call we placed. Real calls always respect working hours and the 9:00–21:00 IST window, even in fast mode, and are never re-dialled sooner than a minute after a missed call. Switching a tenant to Twilio is refused until the server has the credentials and a `PUBLIC_URL`.
- **Simulated provider.** `settings.calls.provider: simulator` has two modes:
  - `interactive`: the call rings in the web app, and whoever is at the browser answers as the staff member, by typing or by voice (Web Speech API).
  - `auto`: a cooperative simulated staff member answers by itself.

  `fastSchedule` (on by default) shrinks the waits between calls to seconds for demos.

## Consequences
- Delegations survive restarts, show up on the goal canvas, the Calls page and the mobile Calls tab, and are fully audited.
- Twilio calls come from a non-Indian number. An Indian caller ID needs Exotel or Plivo (business KYC), which would plug in the same way: a branch in `DelegationService.placeCall` plus webhooks mapped onto `answer`, `reply` and `decline`.
- In development, Twilio reaches the API through a tunnel (`pnpm tunnel`). That exposes the API publicly; the webhooks are signature-checked, and every other route still needs a session.
- The AI says who it is at the start of every call. Before calling the whole team: turn `fastSchedule` off, tell staff they will get AI calls, respect DND rules, and decide which Indian languages to support beyond English. The `costInr` column is reserved for per-call cost; Twilio reports price after the call.

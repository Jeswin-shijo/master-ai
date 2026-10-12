# 0008. Routines: repeating check-ins, by hand or by phone

Date: 2026-10-12 · Status: accepted

## Context
Much of an owner's day goes on collecting the same updates: site progress and headcount, stock running low, bookings and payments. Today people type these into registers by hand, late or not at all. The owner wants each of these jobs to run either **manually** (people fill it in) or **automatically** (an AI agent phones the person responsible, asks, and fills it in). The owner's decisions:
- **Who is called:** staff only.
- **What starts a call:** fixed schedules, plus calls whenever an update is missing.
- **Where the Manual/Automatic switch lives:** on each job.
- **First showcase:** daily status check-ins.

## Decision
- **Industry packs supply the templates.** Each pack lists `routines` (id, name, days, time, and up to 8 questions). Each question has a key, a label, the spoken `ask`, a type (`number`, `percent`, `yes_no`, `text` or `choice`) and two flags: `required`, and `flag` (any answer other than none/no is a problem for the owner). Packs inherit routines and rename them with the industry's words; existing workspaces receive new ones through the pack update banner.
  - core-business: Daily status update.
  - projects-base: Daily work report (people on the job, work done, % progress, shortages, problems).
  - bookings-base: Daily bookings check-in.
  - orders-base: Daily stock and dispatch check.
- **One rule for both modes.** At the routine's time, each person who has not reported today either gets a call or is marked missed:
  - **Automatic:** the AI phones everyone who has not reported.
  - **Manual:** people fill in a form in the app. Anyone who hasn't by then gets a call; with `chaseMissing` off, they are marked missed instead.

  A report filled in by hand always stops the calls for that person.
- **Durable timing.** Each routine has a Temporal Schedule (`routine-<id>`): its days, its time, `Asia/Kolkata`, overlapping runs skipped. A paused routine has a paused schedule; "Run now" starts the same workflow straight away.
  - `routineRunWorkflow` starts one `checkinCallWorkflow` per person and then summarises the day for the owner.
  - Each call workflow waits for the 9:00–21:00 window (personal working hours are not used, so evening reports work), retries missed calls and call-back requests, and marks the day missed after the last attempt. Calls are skipped if they would start more than 3 hours late.
- **One call pipeline.** Check-in calls are rows in `calls` with `checkin_id` (and no `delegation_id`). `CallsService` sends each call to the right conversation: delegation or check-in. The web simulator, the live call card and the Twilio webhooks are therefore shared with delegated work.
- **The conversation.** `CheckinEngine` asks one question at a time.
  - Offline, it understands spoken numbers, percentages and yes/no, and treats "none / all good" as no problem. It asks once more if an answer is unclear.
  - With a model, it takes several answers per reply as structured output.
  - Answers are typed and stored in `routine_entries` (one row per routine, person and India date) along with the problems they raise.

## Consequences
- The owner sees each day as a live board: who has reported, who the AI is calling right now, the totals, and problems that can be turned into goals with one click. The command center and the mobile Pulse tab show today's progress.
- Schedules are created when routines are created or changed. If Temporal was unavailable at that moment, saving the routine again recreates its schedule.
- Calling customers and suppliers, and acting on answers automatically (for example raising a purchase order for low stock), are later steps. Today, problems go to the owner.

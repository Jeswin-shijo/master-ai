# @onehuman/sdk

What the web app, the phone app and partners use to talk to the API.

| File | Holds |
|---|---|
| `client.ts` | `createClient({ baseUrl, getToken })`: one typed method per API route (`api.cases.create`, `api.approvals.decide`, `api.invites.accept`…), and `ApiError` |
| `realtime.ts` | `connectRealtime`: the WebSocket event stream. It reconnects on its own, and apps refetch when it reopens, to catch anything missed |
| `signing.ts` | Device keys (Ed25519): `createDeviceKey` and `signApproval`. The canonical message is shared with the server |
| `fields.ts` | `readableFields`: an action's details as labelled lines a person can read ("Amount: ₹12,000") |
| `case-file.ts` | `caseFileLines`: what each stage found, in sentences |
| `case-view.ts` | Stage dots, the approval heading ("Approve high-risk work permit?"), and when the live stage pulses |
| `report.ts` | A goal's state in one or two words |
| `labels.ts` | Pack terms in everyday words |

It re-exports the types from `@onehuman/schemas`, so apps need only this package for API types. Tests sit beside each file.

# master-ai-mobile

The phone app (Expo SDK 57, Expo Router, Reanimated). It puts cases, approvals, calls and the daily pulse in your pocket, in the same dark "Glow" look as the web app. It talks to the same API through `@onehuman/sdk`.

## Screens (`src/app/`)

| Screen | File | What it is |
|---|---|---|
| Sign in | `login.tsx` | Email and password; pick a company if you belong to several |
| **Cases** tab | `(tabs)/cases.tsx` | Open cases, each with its 8 stage dots, and New request |
| **Approvals** tab | `(tabs)/index.tsx` | What *you* may decide, with a badge count. Works without signal (see below) |
| **Calls** tab | `(tabs)/calls.tsx` | Phone calls to staff, with transcripts |
| **Pulse** tab | `(tabs)/pulse.tsx` | Today in a few lines; opens goals (`(tabs)/goals.tsx`, a hidden tab) |
| **Settings** tab | `(tabs)/settings.tsx` | Who you are, the roles you approve as, sign out |
| A case | `case/[id].tsx` | The 8 stages as a list, the live one pulsing (a still ring with reduced motion), each stage's findings in sentences, and the report |
| New request | `case/new.tsx` | Send a request from the phone |
| An approval | `approval/[id].tsx` | The question in plain words, risk, priority and evidence. **Approve with fingerprint**, or **Reject with a note** |

The app opens on Cases, the first tab.

## How approvals work on the phone

- **Signed by this phone.** Each phone has its own signing key in the keychain, unlocked by fingerprint or Face ID (`src/lib/device-key.ts`). Approving signs the decision; the server checks the signature.
- **Works without signal.** Your approvals are saved on the phone (`src/lib/offline.ts`, SQLite). A decision made without signal is queued and sent when signal returns.
- **Private on a shared phone.** Saved approvals and queued decisions are kept per person. Signing in or out clears what was on screen (`src/lib/api.ts`: `startSession` / `endSession`).

## Running it

1. Start the backend: `pnpm dev` from the repository root.
2. Start Metro: `pnpm --filter @onehuman/mobile start` (port 8082; 8081 is often taken).
3. Open the app in **Expo Go** on a phone or the Android emulator.
   - The app finds the API on the machine running Metro, at port 3000. Set `EXPO_PUBLIC_API_URL` to use a different one.
   - **On the Android emulator,** first run `adb reverse tcp:3000 tcp:3000`, then open `exp://127.0.0.1:8082`.

Remote push notifications need a development build (`eas build --profile development`). Expo Go dropped push on Android in SDK 53, so `src/lib/push.ts` loads it lazily.

## Rules for this app

- **Always dark** (`src/lib/theme.ts`). Expo Go ignores the setting in `app.json`, so don't switch back to `useColorScheme()`.
- **Colours only from `@onehuman/ui` tokens. Font weights are font families** (`font.semibold`), never `fontWeight`: Android drops a custom font when `fontWeight` is set. `tests/tokens.test.ts` checks both.
- **New routes:** keep Metro running until `.expo/types/router.d.ts` regenerates, then run the typecheck.
- **One React version** for the whole repository (Expo's).

## Testing

- **Unit tests** (`pnpm --filter @onehuman/mobile test`, vitest):
  - `tests/tokens.test.ts`: the colour and font rules;
  - `tests/offline.test.ts`: saved approvals per person, against a real SQLite;
  - `tests/session.test.ts`: signing in or out clears the cache;
  - `tests/badge.test.ts`: badge contrast.
- **End-to-end** (`pnpm e2e:mobile` from the root): Maestro 2.10.0 flows in Expo Go on the Android emulator.
  - **Flows** (`e2e/flows/`):
    - `role-holder.yaml`: sees only their approval and approves it;
    - `member.yaml`: sees no approvals;
    - `new-request.yaml`: sends a request and watches its stages.
  - **Before you run them:** start `pnpm dev`, Metro on 8082 and the emulator with Expo Go. Install Maestro into `~/.maestro`:
    ```bash
    export MAESTRO_VERSION=2.10.0; curl -Ls "https://get.maestro.mobile.dev" | bash
    ```
  - **The runner** (`e2e/run.mts`) checks those prerequisites, sets `adb reverse`, and seeds a company with its people (`e2e/seed.mts`). It also turns Android's animations off while the flows run and back on afterwards: a screen that never stops animating, like the live stage, can't be read by UI Automator.

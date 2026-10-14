# Production readiness

A review on 14 October 2026 of five areas: performance, browsers and devices, search and content, security, and running it for real. Each item says what a person would notice. **Fixed** items have tests; **Left** items are ordered by how much they matter before real customers use it.

## In short

| Area | Fixed in this review | Left |
|---|---|---|
| Performance | First visit 337 KB → 190 KB (gzipped); nine database lookups indexed; password checks no longer stall other requests | Shared code could shrink further; the case page polls as well as listening live |
| Browsers and devices | Copy works everywhere or says it couldn't; a clear message without JavaScript or in an old browser; home-screen icons; the main path tested in Chromium, Firefox and WebKit | Dialog focus (already in [known gaps](known-gaps.md)) |
| Search and content | Every page names its tab, and a printed report's PDF is named after the request; description and link-preview tags; robots rules | Link previews are the same for every company |
| Security | Sign-in limits; no account discovery by timing; security headers on the API and the web app; live streams no longer put the session token in URLs; sign-out clears cached data; two Supabase warnings | Sessions in browser storage for 7 days; in-memory rate limits; open sign-up |
| Running it | A readiness check for load balancers | Where the API and worker run; backups; monitoring; secrets |

## Performance

**Fixed**
- **The first visit downloaded 1 MB of JavaScript** (323 KB gzipped) for every page, including sign-in and the public request form. Each page now loads when first opened, and the canvas library only with pages that draw one. The browser no longer downloads zod and every schema: it takes plain values from `@onehuman/schemas/plain`. The first visit is now 190 KB gzipped. `master-ai-web/__tests__/unit/bundle.test.ts` keeps it that way.
- **A font stylesheet from Google blocked the first paint**, for a font (Inter) the app never used. Removed; code text uses the system's monospace font.
- **Nine lookups had no index** (Supabase's performance advisor): approvals and tool calls by goal, approvals by task, delegations by goal, device keys, push tokens and staff by person, tasks by agent, knowledge chunks by document. Migration `0011_lookup_indexes`.
- **Checking a password stalled the API for every other request** (`scryptSync` on the main thread). It now runs on the thread pool.

**Left**
- The shared code every page loads (84 KB gzipped) is mostly the animation library and the data-fetching library. Loading animations only where they run would save roughly a third.
- The case page polls every 5 seconds as well as listening live, and the Cases list isn't virtualised ([known gaps](known-gaps.md)).
- The API doesn't compress responses. Vercel and Cloudflare compress what passes through them; a host without that needs compression turned on.
- Nothing has been load-tested.

## Browsers and devices

Supported: Chrome and Edge 111+, Firefox 128+, Safari 16.4+ on iPhone and Mac (2023 or later).

**Fixed**
- **Copy did nothing** on a plain-http address (a laptop on the office network) or when the browser refused clipboard access. It now falls back to the older copy command, and the button says when nothing could copy.
- **An old browser showed a blank page.** If the app hasn't drawn anything a few seconds after loading, the page says which browsers work. Without JavaScript it says to turn it on.
- **Adding the app to a phone's home screen** showed a blank icon. There is now a manifest and proper icons.
- **Only Chromium was tested.** `master-ai-web/__tests__/e2e/browsers.spec.ts` runs sign-up, a live request, the report, Copy and the print view in Chromium, Firefox and WebKit (Safari's engine), and fails on any page error or blocked script. CI runs all three. On macOS 27.0.1, Playwright's Firefox build doesn't start ("Could not find profile folder"), so locally it was checked in Chromium and WebKit.

**Left**
- The web app needs a connection; offline approvals are the phone app's job.
- Dialogs don't keep keyboard focus inside them ([known gaps](known-gaps.md)).

## Search and content

**Fixed**
- **Every tab said "ONEHUMAN OS"**, and every printed report saved as "ONEHUMAN OS.pdf". Pages now name themselves ("Approvals · ONEHUMAN OS"), and a report's PDF is named after the request ("JOB-0001 · Lineman shock · Job report").
- **No description or link-preview tags.** A link pasted into WhatsApp, email or Slack now shows the product's name and a one-line description.
- **No robots rules.** `robots.txt` keeps search engines to sign-in and sign-up, and invite and request-form links, which carry keys, are sent with `noindex`.

**Left**
- Link previews are the same for every company. A request form shared on WhatsApp can't show the company's name, because the web app is static; that needs a small server or an edge function.
- There is no public landing page or sitemap: sign-in is the front door. A marketing site is a separate decision.

## Security

**Fixed**
- **Passwords could be guessed without limit.** Wrong passwords count against the email (10 per 15 minutes, from anywhere), every try counts against the address (20 a minute), and so does creating an organization (20 a minute).
- **Sign-in revealed who has an account by how long it took.** An unknown email now does the same work as a wrong password.
- **The API sent no security headers** and announced it runs Express. It now sends `nosniff`, `DENY` framing, `no-referrer`, a deny-all content security policy, and HSTS over HTTPS.
- **The web app sent no security headers**, so a page could be framed (clickjacking the Approve button) and nothing limited what a script could reach. `master-ai-web/src/hosting.ts` sets a content security policy (only this app's scripts, only its API), no framing, no sniffing, no referrer, and a permissions policy. The demo writes it to `vercel.json`, and CI's browser tests run under it.
- **Live streams put the 7-day session token in the URL**, where proxies and tunnels log it. They now open with a one-minute stream ticket that can't call the API, and a session token in a URL is refused.
- **The next person on a shared computer could see the last person's data** while pages loaded. Signing out now clears it.
- **Supabase's security advisor** flagged two functions with a changeable `search_path`. The audit trigger's is now fixed. `current_tenant_id()` is left as it is on purpose: a `SET` clause would stop Postgres inlining it into every row-level security check, and it only calls built-in functions, which Postgres always looks up first. The `vector` and `citext` extensions stay in `public` on purpose too: the app role's search path finds their types there.
- **Dependencies:** the API and web app have no known advisories. Four are in the phone app's Expo tooling (`node-forge`, `braces`, `uuid` in the build tools; `decode-uri-component` in Expo Router's link parsing). Two have no fixed version yet; they go with the next Expo upgrade.

**Left**
- **Sessions live in browser storage for 7 days, and signing out doesn't end them on the server.** The content security policy limits what an injected script could do, but before real customer data, move to httpOnly cookies and sessions the server can revoke.
- **Rate limits are kept in the API's memory.** With more than one API process they need a shared store (Redis) or the host's own rate limiting.
- **Anyone can create an organization**, and emails aren't verified. Add email verification, and a CAPTCHA if bots show up.
- **Sign-up says when an email is already registered.** That helps people who forgot they have a login, but it tells anyone which emails do; the sign-up limit slows that down. Email verification would let sign-up answer the same way either way.
- **There is no password reset**, and the app doesn't send email (invite links are copied by hand).
- Approval signing keys are kept in browser storage, and saved approvals aren't encrypted on the phone ([known gaps](known-gaps.md)).

## Running it for real

**Fixed**
- **A load balancer couldn't tell when the API had lost its database.** `GET /health/ready` answers 503 if the database doesn't reply within 3 seconds; `GET /health` stays a liveness check.
- **A dropped idle database connection crashed the API and the worker** (found running the demo on Supabase). Fixed earlier the same day.

**Left: decisions before going live**
1. **Where the API and worker run.** The demo runs them on a Mac behind a Cloudflare quick tunnel, whose address changes on every start. Production needs a host (a container service or a VM, with Dockerfiles), Temporal (Temporal Cloud or self-hosted) and NATS.
2. **Backups.** Supabase's free plan has no point-in-time recovery. Turn it on before real data.
3. **Monitoring.** There is no error tracking or uptime alert, and logs are plain text. Add an error tracker, JSON logs and an uptime check on `/health/ready`.
4. **Secrets.** The JWT secret and database passwords sit in `.env` files on one machine. Move them to the host's secret store. Changing the JWT secret signs everyone out.
5. **The model.** The free Gemini key runs out within a day of real use ([known gaps](known-gaps.md#with-gemini-a-free-key)); production needs a paid key, Claude or Gemini.
6. **Domains.** A custom domain for the web app and the API, with `CORS_ORIGINS`, `WEB_URL` and `PUBLIC_URL` set to them.

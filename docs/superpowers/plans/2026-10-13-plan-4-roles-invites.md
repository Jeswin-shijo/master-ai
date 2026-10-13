# Plan 4 — Roles and invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** More people in a company, each with their own login. The owner or an admin invites them with an access role (admin or member) and approver roles (safety officer, credit manager…). Approvals and pushes reach the people who hold the role, members see only what they may decide, and only the owner and admins change settings, the pack, rules, intake keys, the team and the kill switch.

**Architecture:**
- **Invites:** a new tenant-scoped `invites` table (hashed token, 7-day expiry). Public `view` and `accept` routes run under the tenant's RLS using the tenant id in the link, so no new security-definer function is needed.
- **Members:** human principals. `PATCH /members/:id` sets the access role, the approver roles and a linked staff record. Removing a member retires the principal and revokes their device keys and push tokens.
- **Access:** the global `AuthGuard` reads the principal's role and status from the database on every request, so a removal or demotion takes effect at once. A `@ManagersOnly()` decorator marks owner/admin routes.
- **Inbox and pushes:** `GET /approvals?mine=true` lists what the person may decide (the `mayDecide` rule from Plan 3). Pushes go to role holders plus the owner (`pushToRole`), or to the owner and admins (`pushToManagers`).

**Tech Stack:** NestJS 11, Drizzle ORM + drizzle-kit, Postgres RLS, Zod 4, Vitest, React 19 + TanStack Query (web), Expo (mobile).

**Spec:** [docs/superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md](../specs/2026-10-12-org-types-and-case-lifecycle-design.md), section 3 (Roles and people). Plan 3 ([2026-10-13-plan-3-case-engine.md](2026-10-13-plan-3-case-engine.md)) built `principals.approver_roles`, `staff.principal_id`, `mayDecide` and `routeApprover`.

## Global Constraints

- Every check must stay green: `pnpm turbo run build typecheck test`; shared packages are consumed from `dist/` (`pnpm build:packages` after changing `packages/*`).
- Every tenant-scoped query goes through `DbService.tenant(tenantId, tx => …)`. New tables get the `tenant_isolation` policy in their own RLS migration. Only `users` and `auth_user_tenants()` are global.
- Every state change appends an audit event inside the same transaction.
- Access roles: `owner | admin | member`. Approver roles are ids from the workspace lifecycle's `roles` (never `owner`).
- Who may decide (unchanged from Plan 3): the owner anything; an admin what is routed to `owner` plus their own roles; a member only their own roles. The first decision wins.
- Invite links: `<web>/invite/<tenantId>/<token>`; the token is shown once and stored hashed; invites expire after 7 days.
- Only the owner and admins change settings, the pack, rules (agents and autonomy), intake keys, the team and the kill switch. Everyone in the company sees all cases.
- Owners never see tool names, ids or JSON; errors to people are plain sentences.
- Migrations: `0008_invites.sql` generated from `schema.ts`, `0009_invites_rls.sql` written by hand.

## Deviations from the spec (decided while planning)

1. **The Team page UI (invite form, member list, role editing) is Plan 5's Glow Team page.** This plan ships the API, the SDK, the invite-accept page, the inbox toggle and hiding owner/admin pages from members. Until Plan 5, invites are made through the API (the smoke test does).
2. **Access roles are read from the database on every request**, not only approver roles at decision time. A removal or demotion then takes effect at once instead of when the 7-day session token expires.
3. **`pushToTenant` becomes `pushToManagers`.** With more people in a company, operational pushes (plans ready, escalations, needs-info) go to the owner and admins. Role-routed approvals go to the role holders and the owner.
4. **Open realtime connections of a removed person close at their next reconnect.** The WebSocket handshake now checks that the principal is active. An already-open socket is not hunted down, but it carries only one-line event summaries.

## Review Focus

These inputs aren't covered by any happy-path test and are the most likely to hurt a real user. Each line names the test that pins it.

1. **A removed person keeps using their session** (the token lasts 7 days): every request must be refused at once, and a demoted admin must lose owner/admin pages at once. Pinned in Task 2, `access.test.ts` "turns a removed person away at once" and "uses the role from the database, not the token", and in the smoke test.
2. **An admin giving themselves approval powers or touching the owner**: an admin changing their own roles, or anyone changing or removing the owner, is refused. Pinned in Task 3, `members.test.ts` "refuses changes to the owner and to yourself".
3. **An invite link used twice, after it was revoked, or after 7 days**: refused with a plain message, and never a second login for the same person. Pinned in Task 3, `members.test.ts` "tells pending, accepted, revoked and expired apart", and in the smoke test (accept twice, revoked link).
4. **Someone who already has a login (in another company) accepting an invite**: they sign in with their own password, get a session for the inviting company, and a wrong password creates nothing. Pinned in the smoke test (Task 6): an owner of one company joins a second.
5. **Pushes reaching the wrong people**: a member must not get every approval push, and the holders of a gate's role must get it. Pinned in Task 4, `push.test.ts` "sends a role's approvals to its holders and the owner".

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/schemas/src/domain.ts`, `api.ts`, `events.ts` | `Member`, `Invite`, `CreatedInvite`, `InviteView`, `SessionUser.approverRoles`; invite, accept and member inputs; `member.*` and `invite.revoked` events |
| `packages/sdk/src/client.ts` | `members`, `invites` methods; `approvals.list(status, { mine })` |
| `master-ai-backend/src/db/schema.ts`, `drizzle/0008_invites.sql`, `drizzle/0009_invites_rls.sql` | `invites` table |
| `master-ai-backend/src/common/access.ts` (new), `common/auth.ts` | `checkAccess`; DB-fresh session in `AuthGuard`; `@ManagersOnly()` |
| `master-ai-backend/src/members/members.service.ts` (new), `members/invite-rules.ts` (new) | Members and invites; pure rules (tokens, status, role checks) |
| `master-ai-backend/src/notifications/notifications.service.ts`, `notifications/audience.ts` (new) | `pushToManagers`, `pushToRole`, `pushAudience` |
| `master-ai-backend/src/approvals/*` | Inbox (`mine`) |
| `master-ai-backend/src/identity/identity.service.ts` | `approverRoles` in sessions |
| `master-ai-backend/src/realtime/realtime.gateway.ts` | Refuse removed people at connect |
| Controllers in `tenancy`, `agents`, `voice/team.service.ts`, `cases/intake.service.ts` | `@ManagersOnly()` |
| `master-ai-web/src/routes/invite.tsx` (new), `routes/approvals.tsx`, `components/app-shell.tsx`, `routes/command-center.tsx`, `main.tsx` | Accept page, inbox toggle, hide owner/admin pages for members |
| `master-ai-mobile/src/app/(tabs)/index.tsx`, `(tabs)/_layout.tsx` | Inbox shows "mine" |
| `master-ai-backend/scripts/smoke.ts` | Roles and invites end to end |

---

### Task 1: Contracts and the invites table

**Files:**
- Modify: `packages/schemas/src/domain.ts`, `packages/schemas/src/api.ts`, `packages/schemas/src/events.ts`
- Modify: `packages/sdk/src/client.ts`; Create: `packages/sdk/src/members.test.ts`
- Modify: `master-ai-backend/src/db/schema.ts`; Create: `master-ai-backend/drizzle/0008_invites.sql` (generated), `0009_invites_rls.sql`
- Modify: `master-ai-backend/src/identity/identity.service.ts` (sessions carry approver roles)

**Interfaces:**
- Produces (schemas): `Member`, `InviteStatus`, `Invite`, `CreatedInvite`, `InviteView`; `SessionUser.approverRoles: string[]`; `CreateInviteInputSchema`, `AcceptInviteInputSchema`, `UpdateMemberInputSchema` (+ `…Input` types); events `member.invited`, `member.joined`, `member.updated`, `member.removed`, `invite.revoked`.
- Produces (db): table `invites` (`id, tenantId, email, name, role, approverRoles, tokenHash, expiresAt, createdBy, acceptedAt, acceptedBy, revokedAt, createdAt`).
- Produces (sdk): `api.members.{list, update, remove}`, `api.invites.{list, create, revoke, view, accept}`, `api.approvals.list(status, { mine })`.

- [ ] **Step 1: Write the failing contract tests**

Create `packages/sdk/src/members.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AcceptInviteInputSchema, CreateInviteInputSchema, summarizeEvent, UpdateMemberInputSchema } from '@onehuman/schemas';
import { createClient } from './client';

describe('invite and member bodies', () => {
  it('invites an admin or a member, never an owner', () => {
    expect(CreateInviteInputSchema.safeParse({ name: 'Sunita', email: 'sunita@example.com', role: 'member', approverRoles: ['safety-officer'] }).success).toBe(true);
    expect(CreateInviteInputSchema.safeParse({ name: 'Sunita', email: 'sunita@example.com', role: 'owner' }).success).toBe(false);
  });

  it('defaults to a member with no approver roles', () => {
    expect(CreateInviteInputSchema.parse({ name: 'Manoj', email: 'Manoj@Example.com' })).toEqual({ name: 'Manoj', email: 'manoj@example.com', role: 'member', approverRoles: [] });
  });

  it('needs a real password to accept', () => {
    expect(AcceptInviteInputSchema.safeParse({ password: 'short' }).success).toBe(false);
    expect(AcceptInviteInputSchema.safeParse({ password: 'long enough', name: 'Sunita' }).success).toBe(true);
  });

  it('changes something when a member is updated', () => {
    expect(UpdateMemberInputSchema.safeParse({}).success).toBe(false);
    expect(UpdateMemberInputSchema.safeParse({ approverRoles: ['credit-manager'] }).success).toBe(true);
    expect(UpdateMemberInputSchema.safeParse({ staffId: null }).success).toBe(true);
  });

  it('reads member events as sentences', () => {
    expect(summarizeEvent('member.joined', { name: 'Sunita', role: 'member' })).toBe('Sunita joined the company');
    expect(summarizeEvent('member.invited', { name: 'Sunita' })).toBe('Invited Sunita');
  });
});

describe('approvals inbox client', () => {
  it('asks for "mine" when told to', async () => {
    const urls: string[] = [];
    const api = createClient({
      baseUrl: 'http://api.test',
      fetch: (async (url: string) => {
        urls.push(url);
        return new Response('[]', { status: 200 });
      }) as unknown as typeof fetch,
    });
    await api.approvals.list('pending', { mine: true });
    expect(urls[0]).toBe('http://api.test/approvals?status=pending&mine=true');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @onehuman/sdk exec vitest run src/members.test.ts`
Expected: FAIL: `CreateInviteInputSchema` is undefined.

- [ ] **Step 3: Add the shapes**

In `packages/schemas/src/domain.ts`:

1. In `SessionUser`, after `role: HumanRole;`:

```ts
  /** Lifecycle roles this person approves for, e.g. safety-officer. */
  approverRoles: string[];
```

2. Append:

```ts
/** A person with a login in this company. */
export interface Member {
  id: string;
  name: string;
  email: string;
  role: HumanRole;
  approverRoles: string[];
  status: 'active' | 'paused' | 'retired';
  /** The team-directory record this person also answers calls as, if linked. */
  staffId: string | null;
  createdAt: string;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface Invite {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  approverRoles: string[];
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
}

/** Returned once, when the invite is made. */
export interface CreatedInvite extends Invite {
  /** `/invite/<tenantId>/<token>`. */
  path: string;
  /** The full link on the web app, for the owner to send. */
  link: string;
}

/** What the invite page shows before the person joins. */
export interface InviteView {
  companyName: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  approverRoles: { id: string; name: string }[];
  /** The email already has a login: sign in instead of choosing a password. */
  hasAccount: boolean;
  expiresAt: string;
}
```

In `packages/schemas/src/api.ts`, append:

```ts
const ApproverRoleIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

/** Owner or admin: invite a person by email. The link goes to them however the owner likes. */
export const CreateInviteInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(['admin', 'member']).default('member'),
  approverRoles: z.array(ApproverRoleIdSchema).max(20).default([]),
});
export type CreateInviteInput = z.input<typeof CreateInviteInputSchema>;

/** The invited person: a new password, or their existing one when the email already has a login. */
export const AcceptInviteInputSchema = z.object({
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(120).optional(),
});
export type AcceptInviteInput = z.input<typeof AcceptInviteInputSchema>;

export const UpdateMemberInputSchema = z
  .object({
    role: z.enum(['admin', 'member']).optional(),
    approverRoles: z.array(ApproverRoleIdSchema).max(20).optional(),
    /** Link the team-directory record this person answers calls as; null unlinks. */
    staffId: z.uuid().nullable().optional(),
  })
  .refine((m) => m.role !== undefined || m.approverRoles !== undefined || m.staffId !== undefined, 'Nothing to change');
export type UpdateMemberInput = z.input<typeof UpdateMemberInputSchema>;
```

In `packages/schemas/src/events.ts`, add to `AUDIT_EVENT_TYPES` after `'intake_key.revoked',`:

```ts
  'member.invited',
  'member.joined',
  'member.updated',
  'member.removed',
  'invite.revoked',
```

and to `summarizeEvent`, before `default:`:

```ts
    case 'member.invited':
      return `Invited ${p.name ?? 'someone'}`;
    case 'member.joined':
      return `${p.name ?? 'Someone'} joined the company`;
    case 'member.updated':
      return `${p.name ?? 'A person'}'s access changed`;
    case 'member.removed':
      return `${p.name ?? 'A person'} no longer has access`;
    case 'invite.revoked':
      return `Invite for ${p.name ?? 'someone'} withdrawn`;
```

- [ ] **Step 4: Add the SDK methods**

In `packages/sdk/src/client.ts`:

1. Add to the type imports: `AcceptInviteInput, CreateInviteInput, CreatedInvite, Invite, InviteView, Member, UpdateMemberInput`.
2. Replace the `approvals.list` line with:

```ts
      /** `mine`: only what this person may decide (the default in the apps). */
      list: (status: 'pending' | 'all' = 'pending', opts: { mine?: boolean } = {}) =>
        get<ApprovalRequest[]>(`/approvals${qs({ status, ...(opts.mine && { mine: 'true' }) })}`),
```

3. Add after `intake: { … },`:

```ts
    members: {
      list: () => get<Member[]>('/members'),
      update: (id: string, input: UpdateMemberInput) => patch<Member>(`/members/${id}`, input),
      remove: (id: string) => post<Member>(`/members/${id}/remove`),
    },
    invites: {
      list: () => get<Invite[]>('/members/invites'),
      create: (input: CreateInviteInput) => post<CreatedInvite>('/members/invites', input),
      revoke: (id: string) => post<Invite>(`/members/invites/${id}/revoke`),
      /** Public: what the invite page shows. */
      view: (tenantId: string, token: string) => get<InviteView>(`/invites/${tenantId}/${encodeURIComponent(token)}`),
      /** Public: join the company; returns a session for it. */
      accept: (tenantId: string, token: string, input: AcceptInviteInput) =>
        post<AuthResponse>(`/invites/${tenantId}/${encodeURIComponent(token)}/accept`, input),
    },
```

- [ ] **Step 5: Run the contract tests**

Run: `pnpm --filter @onehuman/schemas build && pnpm --filter @onehuman/sdk exec vitest run src/members.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Add the invites table and migrations**

In `master-ai-backend/src/db/schema.ts`, after `intakeKeys`:

```ts
/** A person invited to join with an access role and approver roles. Only the token's hash is kept. */
export const invites = pgTable(
  'invites',
  {
    id: id(),
    tenantId: tenantId(),
    email: citext('email').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    approverRoles: text('approver_roles').array().notNull().default(sql`'{}'::text[]`),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('invites_tenant_email_idx').on(t.tenantId, t.email)],
);
```

Run: `pnpm --filter @onehuman/backend db:generate --name invites`
Expected: `drizzle/0008_invites.sql` creating `invites`.

Run: `pnpm --filter @onehuman/backend exec drizzle-kit generate --custom --name invites_rls` and fill `drizzle/0009_invites_rls.sql`:

```sql
-- Invites get the same tenant isolation as everything else.
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invites USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invites TO onehuman_app;
```

- [ ] **Step 7: Sessions carry approver roles**

In `master-ai-backend/src/identity/identity.service.ts`:

1. In `signup`, the user object becomes `{ ...session, name: user!.name, email: user!.email, approverRoles: [] }`.
2. Add a private helper:

```ts
  /** The approver roles a person holds in a company, read fresh. */
  private async approverRoles(tenantId: string, principalId: string): Promise<string[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const [p] = await tx.select({ roles: principals.approverRoles }).from(principals).where(eq(principals.id, principalId));
      return p?.roles ?? [];
    });
  }
```

3. In `login`, return `user: { ...session, name: user.name, email: user.email, approverRoles: await this.approverRoles(session.tenantId, session.principalId) }`.
4. In `me`, return `user: { ...session, name: user.name, email: user.email, approverRoles: await this.approverRoles(session.tenantId, session.principalId) }`.

- [ ] **Step 8: Run every check and apply the migrations**

Run: `pnpm build:packages && pnpm turbo run build typecheck test`
Expected: all tasks succeed.

Run: `pnpm infra:up && pnpm db:migrate`
Expected: `migrations applied`.

- [ ] **Step 9: Commit**

```bash
git add packages/schemas packages/sdk master-ai-backend/src master-ai-backend/drizzle
git commit -m "feat(members): contracts, invites table and approver roles in sessions"
```

### Task 2: Access read fresh on every request, and owner/admin routes

The session token says who you are. The database says what you may do now. A removed person is turned away on their next request, and a demoted admin loses owner/admin pages at once.

**Files:**
- Create: `master-ai-backend/src/common/access.ts`, `master-ai-backend/src/common/access.test.ts`
- Modify: `master-ai-backend/src/common/auth.ts`
- Modify: `master-ai-backend/src/tenancy/tenancy.controller.ts`, `master-ai-backend/src/agents/agents.controller.ts`, `master-ai-backend/src/voice/team.service.ts`, `master-ai-backend/src/cases/intake.service.ts`
- Modify: `master-ai-backend/src/realtime/realtime.gateway.ts`

**Interfaces:**
- Produces: `checkAccess(principal: { role: string; status: string } | null, managersOnly: boolean): AccessDecision`; `ManagersOnly()` decorator; `AuthGuard` sets `req.session.role` from the database.

- [ ] **Step 1: Write the failing tests**

Create `master-ai-backend/src/common/access.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkAccess } from './access';

describe('access on every request', () => {
  it('turns a removed person away at once', () => {
    expect(checkAccess({ role: 'member', status: 'retired' }, false)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess(null, false)).toMatchObject({ ok: false, status: 401 });
  });

  it('uses the role from the database, not the token', () => {
    // The token may still say "admin"; the database says "member" now.
    expect(checkAccess({ role: 'member', status: 'active' }, false)).toEqual({ ok: true, role: 'member' });
  });

  it('keeps owner and admin routes for the owner and admins', () => {
    expect(checkAccess({ role: 'member', status: 'active' }, true)).toMatchObject({ ok: false, status: 403 });
    expect(checkAccess({ role: 'admin', status: 'active' }, true)).toEqual({ ok: true, role: 'admin' });
    expect(checkAccess({ role: 'owner', status: 'active' }, true)).toEqual({ ok: true, role: 'owner' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @onehuman/backend exec vitest run src/common/access.test.ts`
Expected: FAIL: cannot find module `./access`.

- [ ] **Step 3: Write the rule**

Create `master-ai-backend/src/common/access.ts`:

```ts
import type { HumanRole } from '@onehuman/schemas';

export type AccessDecision = { ok: true; role: HumanRole } | { ok: false; status: 401 | 403; message: string };

/**
 * What a signed-in person may do right now, from their principal row: a
 * removed person is turned away, and the access role comes from the database,
 * so a change takes effect without signing in again.
 */
export function checkAccess(principal: { role: string; status: string } | null, managersOnly: boolean): AccessDecision {
  if (!principal || principal.status !== 'active') {
    return { ok: false, status: 401, message: 'Your access to this company has ended. Ask the owner for a new invite.' };
  }
  const role = principal.role as HumanRole;
  if (managersOnly && role !== 'owner' && role !== 'admin') {
    return { ok: false, status: 403, message: 'Only the owner or an admin can do this.' };
  }
  return { ok: true, role };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @onehuman/backend exec vitest run src/common/access.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Check access in the guard**

In `master-ai-backend/src/common/auth.ts`:

1. Imports: add `eq` from `drizzle-orm`, `DbService` from `../db/db.service`, `principals` from `../db/schema`, `checkAccess` from `./access`.
2. Add after `Public`:

```ts
const MANAGERS_ONLY = 'onehuman:managers-only';
/** Owner and admins only: settings, the pack, rules, intake keys, the team and the kill switch. */
export const ManagersOnly = () => SetMetadata(MANAGERS_ONLY, true);
```

3. Replace `AuthGuard` with:

```ts
/**
 * Global guard: every route needs a valid session unless marked @Public().
 * The principal is read on every request, so a removed person is turned away
 * and a role change applies at once.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { session?: Session }>();
    const header = req.headers.authorization;
    // EventSource cannot send headers, so SSE streams pass the token as a query param.
    const token = header?.startsWith('Bearer ')
      ? header.slice(7)
      : req.method === 'GET' && typeof req.query.token === 'string'
        ? req.query.token
        : undefined;
    const session = token ? readToken(token) : null;
    if (!session) throw new UnauthorizedException('Sign in required');
    const [principal] = await this.db.tenant(session.tenantId, (tx) =>
      tx.select({ role: principals.role, status: principals.status }).from(principals).where(eq(principals.id, session.principalId)),
    );
    const access = checkAccess(principal ?? null, !!this.reflector.getAllAndOverride<boolean>(MANAGERS_ONLY, targets));
    if (!access.ok) throw access.status === 401 ? new UnauthorizedException(access.message) : new ForbiddenException(access.message);
    req.session = { ...session, role: access.role };
    return true;
  }
}
```

- [ ] **Step 6: Mark the owner/admin routes**

Add `@ManagersOnly()` (import it from `../common/auth`) above each of these handlers:

- `master-ai-backend/src/tenancy/tenancy.controller.ts`: `onboarding/preview`, `onboarding/install`, `tenant/settings` (PATCH), `tenant/pause`, `tenant/resume`, `workspaces/:id/updates` (POST), `workspaces/:id/pause`, `workspaces/:id/resume`.
- `master-ai-backend/src/agents/agents.controller.ts`: `PATCH :id`, `:id/pause`, `:id/resume`, `POST :id/overrides`, `DELETE :id/overrides/:overrideId`.
- `master-ai-backend/src/voice/team.service.ts` (`TeamController`): `POST` and `PATCH :id`.
- `master-ai-backend/src/cases/intake.service.ts` (`IntakeController`): `intake-keys` GET, POST and `:id/revoke`. Keep the `requireManager` calls in the service; they now read the fresh role.

- [ ] **Step 7: Refuse removed people on the realtime stream**

In `master-ai-backend/src/realtime/realtime.gateway.ts`:

1. Inject `private readonly db: DbService` (import from `../db/db.service`, plus `principals` from `../db/schema` and `eq` from `drizzle-orm`).
2. In `attach`, after `if (!session) { … }`, make the upgrade wait for the check:

```ts
      void this.db
        .tenant(session.tenantId, (tx) => tx.select({ status: principals.status }).from(principals).where(eq(principals.id, session.principalId)))
        .then(([p]) => {
          if (p?.status !== 'active') {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          this.wss.handleUpgrade(req, socket, head, (ws) => this.register(session.tenantId, ws));
        })
        .catch(() => socket.destroy());
```

and delete the old direct `this.wss.handleUpgrade(…)` line.

- [ ] **Step 8: Run every check**

Run: `pnpm turbo run build typecheck test`
Expected: all tasks succeed.

- [ ] **Step 9: Commit**

```bash
git add master-ai-backend/src
git commit -m "feat(access): read access fresh on every request; owner/admin-only routes"
```

### Task 3: Members and invites

**Files:**
- Create: `master-ai-backend/src/members/invite-rules.ts`, `master-ai-backend/src/members/members.test.ts`, `master-ai-backend/src/members/members.service.ts`
- Modify: `master-ai-backend/src/config.ts` (`WEB_URL`), `master-ai-backend/src/app.module.ts`, `master-ai-backend/.env.example`

**Interfaces:**
- Consumes: `invites`, `principals`, `users`, `staff`, `deviceKeys`, `pushTokens` tables; `ManagersOnly`, `Public`, `issueToken` (auth); `hashPassword`, `verifyPassword`, `sha256` (crypto); `RateLimiter`; `lifecycleOf`, `normalizeSnapshot`, `roleName`.
- Produces: `newInviteToken()`, `hashInviteToken(token)`, `inviteStatus(row, now)`, `unknownApproverRoles(roles, lc)`, `memberChangeRefusal(actor, target, change)`; `MembersService.{list, update, remove, invite, invites, revokeInvite, view, accept}`; routes `GET /members`, `PATCH /members/:id`, `POST /members/:id/remove`, `GET|POST /members/invites`, `POST /members/invites/:id/revoke`, public `GET /invites/:tenantId/:token` and `POST /invites/:tenantId/:token/accept`.

- [ ] **Step 1: Write the failing tests**

Create `master-ai-backend/src/members/members.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LifecycleSchema } from '@onehuman/schemas';
import { mergeLifecycles } from '@onehuman/agent-kit';
import { hashInviteToken, inviteStatus, memberChangeRefusal, newInviteToken, unknownApproverRoles } from './invite-rules';

describe('invite tokens', () => {
  it('are long, random and kept only as a hash', () => {
    const a = newInviteToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(newInviteToken().token);
    expect(a.hash).toBe(hashInviteToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
});

describe('invite status', () => {
  const now = new Date('2026-10-13T10:00:00Z');
  const base = { acceptedAt: null, revokedAt: null, expiresAt: new Date('2026-10-20T10:00:00Z') };

  it('tells pending, accepted, revoked and expired apart', () => {
    expect(inviteStatus(base, now)).toBe('pending');
    expect(inviteStatus({ ...base, acceptedAt: now }, now)).toBe('accepted');
    expect(inviteStatus({ ...base, revokedAt: now }, now)).toBe('revoked');
    expect(inviteStatus({ ...base, expiresAt: new Date('2026-10-13T09:59:59Z') }, now)).toBe('expired');
  });
});

describe('approver roles', () => {
  const lc = mergeLifecycles([LifecycleSchema.parse({ roles: [{ id: 'safety-officer', name: 'Safety officer', approves: 'Hot work' }] })]);

  it('names roles the organization does not have, and never grants "owner"', () => {
    expect(unknownApproverRoles(['safety-officer'], lc)).toEqual([]);
    expect(unknownApproverRoles(['safety-officer', 'chief-wizard', 'owner'], lc)).toEqual(['chief-wizard', 'owner']);
  });
});

describe('who may change whom', () => {
  const owner = { id: 'p-owner', role: 'owner' as const };
  const admin = { id: 'p-admin', role: 'admin' as const };

  it('refuses changes to the owner and to yourself', () => {
    expect(memberChangeRefusal(admin, { id: 'p-owner', role: 'owner' }, { approverRoles: [] })).toMatch(/owner/);
    expect(memberChangeRefusal(admin, { id: 'p-admin', role: 'admin' }, { approverRoles: ['safety-officer'] })).toMatch(/your own/);
    expect(memberChangeRefusal(owner, { id: 'p-owner', role: 'owner' }, { remove: true })).toMatch(/owner/);
  });

  it('lets the owner and admins change other people', () => {
    expect(memberChangeRefusal(admin, { id: 'p-m', role: 'member' }, { role: 'admin' })).toBeNull();
    expect(memberChangeRefusal(owner, { id: 'p-admin', role: 'admin' }, { remove: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @onehuman/backend exec vitest run src/members/members.test.ts`
Expected: FAIL: cannot find module `./invite-rules`.

- [ ] **Step 3: Write the rules**

Create `master-ai-backend/src/members/invite-rules.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { HumanRole, InviteStatus, ResolvedLifecycle } from '@onehuman/schemas';
import { sha256 } from '../common/crypto';

export const INVITE_DAYS = 7;

export function hashInviteToken(token: string): string {
  return sha256(`onehuman:invite:${token}`);
}

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token) };
}

export function inviteStatus(row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): InviteStatus {
  if (row.acceptedAt) return 'accepted';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

/** Approver roles the organization's lifecycle does not define. "owner" is an access role, never granted this way. */
export function unknownApproverRoles(roles: string[], lc: ResolvedLifecycle): string[] {
  const known = new Set(lc.roles.map((r) => r.id).filter((id) => id !== 'owner'));
  return roles.filter((r) => !known.has(r));
}

/**
 * Why `actor` may not make this change to `target`, or null. The owner's
 * access is fixed, and nobody changes their own access or approval powers.
 */
export function memberChangeRefusal(
  actor: { id: string; role: HumanRole },
  target: { id: string; role: string },
  change: { role?: string; approverRoles?: string[]; staffId?: string | null; remove?: boolean },
): string | null {
  if (target.role === 'owner') return "The owner's access can't be changed or removed.";
  const touchesAccess = change.role !== undefined || change.approverRoles !== undefined || change.remove;
  if (target.id === actor.id && touchesAccess) return "You can't change your own access or approval roles. Ask the owner.";
  return null;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @onehuman/backend exec vitest run src/members/members.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the web address**

In `master-ai-backend/src/config.ts`, add to `EnvSchema` after `CORS_ORIGINS`:

```ts
  /** Where the web app lives, for links people are sent (invites). */
  WEB_URL: z.string().default('http://localhost:5173'),
```

and to `master-ai-backend/.env.example`:

```
# Where the web app lives, for invite links.
WEB_URL=http://localhost:5173
```

- [ ] **Step 6: Write the members service and controller**

Create `master-ai-backend/src/members/members.service.ts`:

```ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  AcceptInviteInputSchema,
  CreateInviteInputSchema,
  UpdateMemberInputSchema,
  type AuthResponse,
  type CreatedInvite,
  type Invite,
  type InviteView,
  type Member,
} from '@onehuman/schemas';
import { lifecycleOf, normalizeSnapshot, roleName } from '@onehuman/agent-kit';
import { AuditService } from '../audit/audit.service';
import { CurrentSession, issueToken, ManagersOnly, Public, type Session } from '../common/auth';
import { hashPassword, verifyPassword } from '../common/crypto';
import { toTenant } from '../common/mappers';
import { RateLimiter } from '../common/rate-limit';
import { ZodPipe } from '../common/zod';
import { config } from '../config';
import { DbService, type Tx } from '../db/db.service';
import { deviceKeys, invites, principals, pushTokens, staff, tenants, users, workspaces } from '../db/schema';
import { hashInviteToken, INVITE_DAYS, inviteStatus, memberChangeRefusal, newInviteToken, unknownApproverRoles } from './invite-rules';

type InviteRow = typeof invites.$inferSelect;

function toInvite(r: InviteRow, now = new Date()): Invite {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    approverRoles: r.approverRoles,
    status: inviteStatus(r, now),
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

/** People with a login in a company, and the invites that bring them in. */
@Injectable()
export class MembersService {
  private readonly limiter = new RateLimiter();

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<Member[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ p: principals, email: users.email, staffId: staff.id })
        .from(principals)
        .innerJoin(users, eq(users.id, principals.userId))
        .leftJoin(staff, eq(staff.principalId, principals.id))
        .where(eq(principals.kind, 'human'))
        .orderBy(asc(principals.createdAt));
      return rows.map((r) => ({
        id: r.p.id,
        name: r.p.displayName,
        email: r.email,
        role: r.p.role as Member['role'],
        approverRoles: r.p.approverRoles,
        status: r.p.status,
        staffId: r.staffId,
        createdAt: r.p.createdAt.toISOString(),
      }));
    });
  }

  async update(session: Session, id: string, input: z.output<typeof UpdateMemberInputSchema>): Promise<Member> {
    await this.db.tenant(session.tenantId, async (tx) => {
      const target = await this.human(tx, id);
      const refused = memberChangeRefusal({ id: session.principalId, role: session.role }, { id: target.id, role: target.role }, input);
      if (refused) throw new ForbiddenException(refused);
      if (input.approverRoles) await this.checkRoles(tx, input.approverRoles);
      await tx
        .update(principals)
        .set({ ...(input.role && { role: input.role }), ...(input.approverRoles && { approverRoles: input.approverRoles }) })
        .where(eq(principals.id, id));
      if (input.staffId !== undefined) {
        await tx.update(staff).set({ principalId: null }).where(eq(staff.principalId, id));
        if (input.staffId) {
          const [linked] = await tx.update(staff).set({ principalId: id }).where(eq(staff.id, input.staffId)).returning();
          if (!linked) throw new NotFoundException('Team member not found');
        }
      }
      await this.audit.append(tx, session.tenantId, {
        type: 'member.updated',
        actor: { id: session.principalId, kind: 'human' },
        refId: id,
        payload: { name: target.displayName, changes: input },
      });
    });
    return (await this.list(session.tenantId)).find((m) => m.id === id)!;
  }

  /** Access ends at once: the guard reads the status on every request. */
  async remove(session: Session, id: string): Promise<Member> {
    await this.db.tenant(session.tenantId, async (tx) => {
      const target = await this.human(tx, id);
      const refused = memberChangeRefusal({ id: session.principalId, role: session.role }, { id: target.id, role: target.role }, { remove: true });
      if (refused) throw new ForbiddenException(refused);
      await tx.update(principals).set({ status: 'retired' }).where(eq(principals.id, id));
      await tx.update(deviceKeys).set({ revokedAt: new Date() }).where(and(eq(deviceKeys.principalId, id), isNull(deviceKeys.revokedAt)));
      await tx.delete(pushTokens).where(eq(pushTokens.principalId, id));
      await tx.update(staff).set({ principalId: null }).where(eq(staff.principalId, id));
      await this.audit.append(tx, session.tenantId, {
        type: 'member.removed',
        actor: { id: session.principalId, kind: 'human' },
        refId: id,
        payload: { name: target.displayName },
      });
    });
    return (await this.list(session.tenantId)).find((m) => m.id === id)!;
  }

  async invite(session: Session, input: z.output<typeof CreateInviteInputSchema>): Promise<CreatedInvite> {
    const made = newInviteToken();
    const row = await this.db.tenant(session.tenantId, async (tx) => {
      await this.checkRoles(tx, input.approverRoles);
      const [member] = await tx
        .select({ id: principals.id })
        .from(principals)
        .innerJoin(users, eq(users.id, principals.userId))
        .where(and(eq(users.email, input.email), eq(principals.kind, 'human'), eq(principals.status, 'active')));
      if (member) throw new ConflictException('That person is already in the company.');
      const open = (await tx.select().from(invites).where(eq(invites.email, input.email))).filter((i) => inviteStatus(i, new Date()) === 'pending');
      if (open.length) throw new ConflictException('There is already an open invite for that email. Withdraw it first to send a new one.');
      const [created] = await tx
        .insert(invites)
        .values({
          tenantId: session.tenantId,
          email: input.email,
          name: input.name,
          role: input.role,
          approverRoles: input.approverRoles,
          tokenHash: made.hash,
          expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
          createdBy: session.principalId,
        })
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'member.invited',
        actor: { id: session.principalId, kind: 'human' },
        refId: created!.id,
        payload: { name: input.name, email: input.email, role: input.role, approverRoles: input.approverRoles },
      });
      return created!;
    });
    const path = `/invite/${session.tenantId}/${made.token}`;
    return { ...toInvite(row), path, link: `${config.WEB_URL.replace(/\/$/, '')}${path}` };
  }

  async invites(tenantId: string): Promise<Invite[]> {
    return this.db.tenant(tenantId, async (tx) => (await tx.select().from(invites).orderBy(desc(invites.createdAt))).map((r) => toInvite(r)));
  }

  async revokeInvite(session: Session, id: string): Promise<Invite> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(and(eq(invites.id, id), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
        .returning();
      if (!row) throw new NotFoundException('No open invite with that id');
      await this.audit.append(tx, session.tenantId, { type: 'invite.revoked', actor: { id: session.principalId, kind: 'human' }, refId: id, payload: { name: row.name } });
      return toInvite(row);
    });
  }

  /** Public: what the invite page shows. Only a pending invite is shown. */
  async view(tenantId: string, token: string, ip: string): Promise<InviteView> {
    this.limit(`invite-view:${tenantId}:${ip}`, 60);
    return this.db.tenant(tenantId, async (tx) => {
      const inv = await this.pending(tx, token);
      const [company] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
      const lc = await this.lifecycle(tx);
      const [account] = await tx.select({ id: users.id }).from(users).where(eq(users.email, inv.email));
      return {
        companyName: company!.name,
        name: inv.name,
        email: inv.email,
        role: inv.role,
        approverRoles: inv.approverRoles.map((id) => ({ id, name: roleName(lc, id) })),
        hasAccount: !!account,
        expiresAt: inv.expiresAt.toISOString(),
      };
    });
  }

  /** Public: join the company. A new person picks a password; someone with a login signs in with theirs. */
  async accept(tenantId: string, token: string, input: z.output<typeof AcceptInviteInputSchema>, ip: string): Promise<AuthResponse> {
    this.limit(`invite-accept:${tenantId}:${ip}`, 10);
    return this.db.tenant(tenantId, async (tx) => {
      const inv = await this.pending(tx, token, true);
      const [existing] = await tx.select().from(users).where(eq(users.email, inv.email));
      let user = existing;
      if (user) {
        if (!verifyPassword(input.password, user.passwordHash)) throw new UnauthorizedException('That is not the password for this email.');
      } else {
        [user] = await tx.insert(users).values({ email: inv.email, name: input.name ?? inv.name, passwordHash: hashPassword(input.password) }).returning();
      }
      const [already] = await tx
        .select()
        .from(principals)
        .where(and(eq(principals.userId, user!.id), eq(principals.kind, 'human')));
      if (already?.status === 'active') throw new ConflictException('You are already in this company. Sign in instead.');
      const values = { displayName: input.name ?? inv.name, role: inv.role, approverRoles: inv.approverRoles, status: 'active' as const };
      const [principal] = already
        ? await tx.update(principals).set(values).where(eq(principals.id, already.id)).returning()
        : await tx.insert(principals).values({ tenantId, kind: 'human', userId: user!.id, ...values }).returning();
      await tx.update(invites).set({ acceptedAt: new Date(), acceptedBy: principal!.id }).where(eq(invites.id, inv.id));
      await this.audit.append(tx, tenantId, {
        type: 'member.joined',
        actor: { id: principal!.id, kind: 'human' },
        refId: principal!.id,
        payload: { name: principal!.displayName, role: inv.role, approverRoles: inv.approverRoles },
      });
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      const session: Session = { userId: user!.id, principalId: principal!.id, tenantId, role: inv.role };
      return {
        token: issueToken(session),
        user: { ...session, name: user!.name, email: user!.email, approverRoles: inv.approverRoles },
        tenant: toTenant(tenant!),
      };
    });
  }

  private async pending(tx: Tx, token: string, lock = false): Promise<InviteRow> {
    const q = tx.select().from(invites).where(eq(invites.tokenHash, hashInviteToken(token)));
    const [inv] = lock ? await q.for('update') : await q;
    if (!inv || inviteStatus(inv, new Date()) !== 'pending') throw new NotFoundException('This invite link is not valid any more. Ask for a new one.');
    return inv;
  }

  private async human(tx: Tx, id: string) {
    const [p] = await tx.select().from(principals).where(and(eq(principals.id, id), eq(principals.kind, 'human')));
    if (!p) throw new NotFoundException('Person not found');
    return p;
  }

  private async lifecycle(tx: Tx) {
    const [ws] = await tx.select({ pack: workspaces.pack }).from(workspaces).orderBy(desc(workspaces.createdAt)).limit(1);
    if (!ws) throw new BadRequestException('Install an industry setup first.');
    return lifecycleOf(normalizeSnapshot(ws.pack));
  }

  private async checkRoles(tx: Tx, roles: string[]) {
    if (roles.length === 0) return;
    const unknown = unknownApproverRoles(roles, await this.lifecycle(tx));
    if (unknown.length) throw new BadRequestException(`Not an approval role in this organization: ${unknown.join(', ')}`);
  }

  private limit(bucket: string, perMinute: number) {
    if (!this.limiter.take(bucket, perMinute, 60_000)) throw new HttpException('Too many requests. Try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Controller()
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get('members')
  list(@CurrentSession() s: Session) {
    return this.members.list(s.tenantId);
  }

  @ManagersOnly()
  @Get('members/invites')
  invites(@CurrentSession() s: Session) {
    return this.members.invites(s.tenantId);
  }

  @ManagersOnly()
  @Post('members/invites')
  invite(@CurrentSession() s: Session, @Body(new ZodPipe(CreateInviteInputSchema)) body: z.output<typeof CreateInviteInputSchema>) {
    return this.members.invite(s, body);
  }

  @ManagersOnly()
  @Post('members/invites/:id/revoke')
  revoke(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.revokeInvite(s, id);
  }

  @ManagersOnly()
  @Patch('members/:id')
  update(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateMemberInputSchema)) body: z.output<typeof UpdateMemberInputSchema>) {
    return this.members.update(s, id, body);
  }

  @ManagersOnly()
  @Post('members/:id/remove')
  remove(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.remove(s, id);
  }

  @Public()
  @Get('invites/:tenantId/:token')
  view(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('token') token: string, @Req() req: Request) {
    return this.members.view(tenantId, token, req.ip ?? 'unknown');
  }

  @Public()
  @Post('invites/:tenantId/:token/accept')
  accept(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('token') token: string,
    @Body(new ZodPipe(AcceptInviteInputSchema)) body: z.output<typeof AcceptInviteInputSchema>,
    @Req() req: Request,
  ) {
    return this.members.accept(tenantId, token, body, req.ip ?? 'unknown');
  }
}
```

In `master-ai-backend/src/app.module.ts`, import `MembersController, MembersService` from `./members/members.service`, add `MembersController` to `controllers` and `MembersService` to `providers` (under `// Identity & tenancy`).

- [ ] **Step 7: Run every check**

Run: `pnpm turbo run build typecheck test`
Expected: all tasks succeed.

- [ ] **Step 8: Commit**

```bash
git add master-ai-backend
git commit -m "feat(members): invites, joining, approver roles and removal"
```

### Task 4: The "mine" inbox and pushes by role

**Files:**
- Create: `master-ai-backend/src/notifications/audience.ts`, `master-ai-backend/src/notifications/push.test.ts`
- Modify: `master-ai-backend/src/notifications/notifications.service.ts` and every `pushToTenant` caller
- Modify: `master-ai-backend/src/approvals/may-decide.ts`, `may-decide.test.ts`, `approvals.service.ts`, `approvals.controller.ts`
- Modify: `master-ai-backend/src/cases/stages.service.ts`, `master-ai-backend/src/orchestration/task-lifecycle.service.ts`

**Interfaces:**
- Produces: `pushAudience(people: { id; role; status; approverRoles }[], target: { role: string } | 'managers'): string[]`; `NotificationsService.pushToManagers(tenantId, message)`, `pushToRole(tenantId, role, message)`; `forInbox(person, approvals)`; `ApprovalsService.list(session, { status, mine })`.

- [ ] **Step 1: Write the failing tests**

Create `master-ai-backend/src/notifications/push.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pushAudience } from './audience';

const people = [
  { id: 'owner', role: 'owner', status: 'active', approverRoles: [] },
  { id: 'admin', role: 'admin', status: 'active', approverRoles: [] },
  { id: 'safety', role: 'member', status: 'active', approverRoles: ['safety-officer'] },
  { id: 'clerk', role: 'member', status: 'active', approverRoles: [] },
  { id: 'gone', role: 'member', status: 'retired', approverRoles: ['safety-officer'] },
];

describe('who gets a push', () => {
  it("sends a role's approvals to its holders and the owner", () => {
    expect(pushAudience(people, { role: 'safety-officer' }).sort()).toEqual(['owner', 'safety']);
  });

  it('sends owner-routed and company news to the owner and admins only', () => {
    expect(pushAudience(people, { role: 'owner' }).sort()).toEqual(['admin', 'owner']);
    expect(pushAudience(people, 'managers').sort()).toEqual(['admin', 'owner']);
  });
});
```

Append to `master-ai-backend/src/approvals/may-decide.test.ts` (and add `forInbox` to its import):

```ts
describe('the "mine" inbox', () => {
  const items = [{ approver: 'owner' }, { approver: 'safety-officer' }, { approver: 'credit-manager' }];

  it('lists only what the person may decide', () => {
    expect(forInbox({ role: 'member', approverRoles: ['safety-officer'] }, items)).toEqual([{ approver: 'safety-officer' }]);
    expect(forInbox({ role: 'admin', approverRoles: [] }, items)).toEqual([{ approver: 'owner' }]);
    expect(forInbox({ role: 'owner', approverRoles: [] }, items)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @onehuman/backend exec vitest run src/notifications/push.test.ts src/approvals/may-decide.test.ts`
Expected: FAIL: cannot find module `./audience`, and `forInbox` is not a function.

- [ ] **Step 3: Write the audience rule and the inbox filter**

Create `master-ai-backend/src/notifications/audience.ts`:

```ts
interface Person {
  id: string;
  role: string;
  status: string;
  approverRoles: string[];
}

/**
 * Who should get a push: for an approval routed to a role, its holders and
 * the owner; for "owner" or company news, the owner and admins. Removed people
 * get nothing.
 */
export function pushAudience(people: Person[], target: { role: string } | 'managers'): string[] {
  const active = people.filter((p) => p.status === 'active');
  if (target === 'managers' || target.role === 'owner') return active.filter((p) => p.role === 'owner' || p.role === 'admin').map((p) => p.id);
  return active.filter((p) => p.role === 'owner' || p.approverRoles.includes(target.role)).map((p) => p.id);
}
```

Append to `master-ai-backend/src/approvals/may-decide.ts`:

```ts
/** The "mine" inbox: only approvals this person may decide. */
export function forInbox<T extends { approver: string }>(person: { role: HumanRole; approverRoles: string[] }, approvals: T[]): T[] {
  return approvals.filter((a) => mayDecide(person, a.approver));
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @onehuman/backend exec vitest run src/notifications/push.test.ts src/approvals/may-decide.test.ts`
Expected: PASS.

- [ ] **Step 5: Push to the right people**

Replace `pushToTenant` in `master-ai-backend/src/notifications/notifications.service.ts` with:

```ts
  /** Company news (plans ready, escalations, needs-info): the owner and admins. */
  async pushToManagers(tenantId: string, message: PushMessage) {
    await this.pushTo(tenantId, 'managers', message);
  }

  /** An approval routed to a role: its holders and the owner ("owner" means the owner and admins). */
  async pushToRole(tenantId: string, role: string, message: PushMessage) {
    await this.pushTo(tenantId, { role }, message);
  }

  private async pushTo(tenantId: string, target: { role: string } | 'managers', message: PushMessage) {
    const tokens = await this.db.tenant(tenantId, async (tx) => {
      const people = await tx
        .select({ id: principals.id, role: principals.role, status: principals.status, approverRoles: principals.approverRoles })
        .from(principals)
        .where(eq(principals.kind, 'human'));
      const ids = pushAudience(people, target);
      if (ids.length === 0) return [];
      return tx.select({ token: pushTokens.token }).from(pushTokens).where(inArray(pushTokens.principalId, ids));
    });
    if (tokens.length === 0) return;
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(tokens.map(({ token }) => ({ to: token, sound: 'default', priority: 'high', ...message }))),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) this.logger.warn(`Expo push failed: ${res.status}`);
    } catch (err) {
      this.logger.warn(`Expo push failed: ${(err as Error).message}`);
    }
  }
```

with `type PushMessage = { title: string; body: string; data?: Record<string, unknown> };` above the class, and imports `eq, inArray` from `drizzle-orm`, `principals` from the schema, `pushAudience` from `./audience`.

Then update the callers:
- Every remaining `pushToTenant(` call (routines, delegation, orchestrator, task escalation, case needs-info and escalation) becomes `pushToManagers(`: `grep -rln "pushToTenant" master-ai-backend/src | xargs sed -i '' 's/pushToTenant(/pushToManagers(/g'` (macOS sed).
- In `master-ai-backend/src/cases/stages.service.ts` `openGate`, the approval push goes to its role:
  - the transaction's return type becomes `Promise<{ opened: GateOpened; notify: { summary: string; approver: string } | null }>`;
  - the waiting branch returns `notify: { summary, approver: route.approver }`;
  - the push after the transaction becomes:

```ts
    if (result.notify && result.opened.status === 'waiting') {
      void this.notifications.pushToRole(i.tenantId, result.notify.approver, {
        title: 'Approval needed',
        body: result.notify.summary,
        data: { approvalId: result.opened.approvalId },
      });
    }
```

- In `master-ai-backend/src/orchestration/task-lifecycle.service.ts` `requestApproval`, both returns inside the transaction add the approver (`approver: existing.approver` and `approver: approval!.approver`), and the push becomes:

```ts
    void this.notifications.pushToRole(tenantId, created.approver, {
      title: 'Approval needed',
      body: created.summary,
      data: { approvalId: created.approvalId },
    });
```

- [ ] **Step 6: The inbox**

In `master-ai-backend/src/approvals/approvals.service.ts`, replace `list` with:

```ts
  /**
   * Pending or all approvals. `mine` keeps only what this person may decide;
   * members always get "mine" (the owner and admins can also see everything).
   */
  async list(session: Session, opts: { status: 'pending' | 'all'; mine: boolean }): Promise<ApprovalRequest[]> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const rows = await tx
        .select({ approval: approvalRequests, agentName: agents.name })
        .from(approvalRequests)
        .innerJoin(agents, eq(agents.id, approvalRequests.agentId))
        .where(opts.status === 'pending' ? eq(approvalRequests.status, 'pending') : undefined)
        .orderBy(desc(approvalRequests.createdAt))
        .limit(200);
      const views = rows.map((r) => toApproval(r.approval, r.agentName));
      if (!opts.mine && session.role !== 'member') return views;
      const [me] = await tx.select({ approverRoles: principals.approverRoles }).from(principals).where(eq(principals.id, session.principalId));
      return forInbox({ role: session.role, approverRoles: me?.approverRoles ?? [] }, views);
    });
  }
```

(import `forInbox` from `./may-decide`), and in `approvals.controller.ts`:

```ts
  @Get()
  list(@CurrentSession() s: Session, @Query('status') status?: string, @Query('mine') mine?: string) {
    return this.approvals.list(s, { status: status === 'all' ? 'all' : 'pending', mine: mine === 'true' });
  }
```

- [ ] **Step 7: Run every check**

Run: `pnpm turbo run build typecheck test`
Expected: all tasks succeed.

- [ ] **Step 8: Commit**

```bash
git add master-ai-backend/src
git commit -m "feat(approvals): the mine inbox, and pushes to role holders and managers"
```

### Task 5: Web and mobile: accept an invite, the inbox, and owner/admin pages

**Files:**
- Create: `master-ai-web/src/routes/invite.tsx`
- Modify: `master-ai-web/src/main.tsx`, `master-ai-web/src/routes/approvals.tsx`, `master-ai-web/src/components/app-shell.tsx`, `master-ai-web/src/routes/command-center.tsx`
- Modify: `master-ai-mobile/src/app/(tabs)/index.tsx`, `master-ai-mobile/src/app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `api.invites.view/accept`, `api.approvals.list(status, { mine })`, `SessionUser.role`.

- [ ] **Step 1: The invite page**

Create `master-ai-web/src/routes/invite.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Opened from an invite link: shows the company and the roles, then joins. */
export function InvitePage() {
  const { tenantId = '', token = '' } = useParams();
  const signIn = useSession((s) => s.signIn);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const invite = useQuery({ queryKey: ['invite', tenantId, token], queryFn: () => api.invites.view(tenantId, token), retry: false });
  const accept = useMutation({
    mutationFn: () => api.invites.accept(tenantId, token, { password, ...(name && { name }) }),
    onSuccess: (auth) => {
      signIn(auth);
      navigate('/');
    },
  });

  if (invite.isPending) return <p className="p-8 text-sm text-fg-muted">Opening your invite…</p>;
  if (invite.error || !invite.data) {
    return (
      <div className="mx-auto max-w-md p-8">
        <h1 className="text-lg font-semibold text-fg">This invite can't be used</h1>
        <ErrorNote error={invite.error} className="mt-3" />
      </div>
    );
  }
  const v = invite.data;
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <form
        className="w-full max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          accept.mutate();
        }}
      >
        <h1 className="text-xl font-semibold text-fg">Join {v.companyName}</h1>
        <p className="text-sm text-fg-muted">
          You're invited as {v.role === 'admin' ? 'an admin' : 'a member'}
          {v.approverRoles.length > 0 && <> who approves for: {v.approverRoles.map((r) => r.name).join(', ')}</>}.
        </p>
        <p className="text-sm text-fg">{v.email}</p>
        {!v.hasAccount && (
          <Field label="Your name" htmlFor="invite-name">
            <Input id="invite-name" value={name} placeholder={v.name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field
          label={v.hasAccount ? 'Your password' : 'Choose a password'}
          htmlFor="invite-password"
          hint={v.hasAccount ? 'This email already has a login. Use its password.' : 'At least 8 characters.'}
        >
          <Input id="invite-password" type="password" autoComplete={v.hasAccount ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <ErrorNote error={accept.error} />
        <Button type="submit" className="w-full" loading={accept.isPending}>
          Join {v.companyName}
        </Button>
      </form>
    </div>
  );
}
```

In `master-ai-web/src/main.tsx`, import `InvitePage` and add `{ path: '/invite/:tenantId/:token', element: <InvitePage /> },` before the `'*'` route (not wrapped: a signed-in person can accept too).

- [ ] **Step 2: The inbox shows "mine" by default**

In `master-ai-web/src/routes/approvals.tsx`, read the session role (`const role = useSession((s) => s.user?.role);`, importing `useSession`), add `const [mine, setMine] = useState(true);`, and change the query to:

```tsx
  const list = useQuery({ queryKey: ['approvals', tab, mine], queryFn: () => api.approvals.list(tab, { mine }) });
```

After the tab list, give the owner and admins a toggle (members always see their own):

```tsx
      {role !== 'member' && (
        <label className="mb-4 flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={!mine} onChange={(e) => setMine(!e.target.checked)} />
          Show everyone's approvals, not only the ones for me
        </label>
      )}
```

In `master-ai-web/src/components/app-shell.tsx` and `master-ai-web/src/routes/command-center.tsx`, the pending-approvals queries become `api.approvals.list('pending', { mine: true })` with query key `['approvals', 'pending', true]`.

- [ ] **Step 3: Hide owner/admin pages and the kill switch from members**

In `master-ai-web/src/components/app-shell.tsx`:
- Give the `Industry pack` and `Settings` items `managersOnly: true`.
- Render `items.filter((i) => !('managersOnly' in i) || user?.role !== 'member')` instead of `items`.
- Wrap the kill-switch `<Button>` in `{user?.role !== 'member' && ( … )}`.

- [ ] **Step 4: Mobile inbox**

In `master-ai-mobile/src/app/(tabs)/index.tsx` and `master-ai-mobile/src/app/(tabs)/_layout.tsx`, call `api.approvals.list('pending', { mine: true })`.

- [ ] **Step 5: Run every check**

Run: `pnpm build:packages && pnpm turbo run build typecheck test && pnpm --filter @onehuman/mobile exec tsc --noEmit`
Expected: all succeed.

- [ ] **Step 6: Commit**

```bash
git add master-ai-web/src master-ai-mobile/src
git commit -m "feat(web,mobile): accept an invite, the mine inbox, owner/admin pages hidden from members"
```

### Task 6: End to end: role holders approve, others can't

**Files:**
- Modify: `master-ai-backend/scripts/smoke.ts`

- [ ] **Step 1: Add the roles checks**

In `master-ai-backend/scripts/smoke.ts`, add before `main`:

```ts
/** Invites, approver roles, the mine inbox, owner/admin routes and removal. */
async function roleChecks(otherCompanyOwner: { email: string }) {
  const plant = await onboard('energy-heavy-industry', 'power-plant', 'Power plant & utilities', 'Smoke Roles Plant');
  const owner = plant.api;
  const tenantId = plant.auth.tenant.id;
  await owner.tenant.updateSettings({ calls: { simulatorMode: 'auto', fastSchedule: true } });
  const ownerKey = createDeviceKey(new Uint8Array(randomBytes(32)));
  const ownerDevice = await owner.auth.registerDeviceKey({ publicKey: ownerKey.publicKey, label: 'smoke-owner', platform: 'web' });

  await expectStatus(owner.invites.create({ name: 'Wizard', email: `wizard+${randomBytes(3).toString('hex')}@example.com`, approverRoles: ['chief-wizard'] }), 400, 'An unknown approval role is refused');

  const join = async (name: string, approverRoles: string[], email = `${name.toLowerCase()}+${randomBytes(3).toString('hex')}@example.com`, password = 'correct horse battery') => {
    const inv = await owner.invites.create({ name, email, approverRoles });
    const view = await owner.invites.view(tenantId, inv.path.split('/').pop()!);
    const auth = await owner.invites.accept(tenantId, inv.path.split('/').pop()!, { password });
    let token: string | null = auth.token;
    const api = createClient({ baseUrl: API_URL, getToken: () => token });
    const key = createDeviceKey(new Uint8Array(randomBytes(32)));
    const device = await api.auth.registerDeviceKey({ publicKey: key.publicKey, label: `smoke-${name}`, platform: 'web' });
    return { api, auth, key, device, inv, view, signOut: () => (token = null) };
  };
  const sunita = await join('Sunita', ['safety-officer']);
  const manoj = await join('Manoj', []);
  log('Invites accepted', `${sunita.view.companyName}: Sunita (${sunita.view.approverRoles.map((r) => r.name).join(', ')}), Manoj (member)`);

  // The same link twice, and a withdrawn link, are refused.
  await expectStatus(owner.invites.accept(tenantId, sunita.inv.path.split('/').pop()!, { password: 'correct horse battery' }), 404, 'An invite works once');
  const spare = await owner.invites.create({ name: 'Spare', email: `spare+${randomBytes(3).toString('hex')}@example.com` });
  await owner.invites.revoke(spare.id);
  await expectStatus(owner.invites.view(tenantId, spare.path.split('/').pop()!), 404, 'A withdrawn invite is refused');

  // An owner of another company joins this one with their own password.
  const guest = await join('Guest', [], otherCompanyOwner.email, 'correct horse battery');
  if (!guest.view.hasAccount || guest.auth.tenant.id !== tenantId) throw new Error('existing login did not join the second company');
  log('Someone with a login joined a second company with their own password');

  // A hot-work case: the gate goes to the safety officer, not the owner.
  const c = await owner.cases.create({ text: suiteCase('power-plant', 'contractor-welding').request });
  const atGate = await driveCase(owner, ownerKey.seed, ownerDevice.id, c.id, (d) => d.approvals.some((a) => a.status === 'pending' && a.stage === 'approve'));
  const gate = atGate.approvals.find((a) => a.status === 'pending' && a.stage === 'approve')!;
  if (gate.approver !== 'safety-officer') throw new Error(`gate routed to ${gate.approver}`);
  log('Gate routed to the role holder', gate.summary);

  const manojInbox = await manoj.api.approvals.list('pending', { mine: true });
  const sunitaInbox = await sunita.api.approvals.list('pending', { mine: true });
  if (manojInbox.some((a) => a.id === gate.id) || !sunitaInbox.some((a) => a.id === gate.id)) throw new Error('mine inbox lists the wrong approvals');
  log('Mine inbox', `Sunita ${sunitaInbox.length}, Manoj ${manojInbox.length}`);
  await expectStatus(signedDecision(manoj.api, manoj.key.seed, manoj.device.id, gate.id, 'approved'), 403, 'A person without the role is refused');
  await signedDecision(sunita.api, sunita.key.seed, sunita.device.id, gate.id, 'approved', 'Permit HW-118 issued, area checked');
  log('The safety officer approved the gate');

  // The rest of the case (actions, sign-off) is approved by the owner, who may decide anything.
  const done = await driveCase(owner, ownerKey.seed, ownerDevice.id, c.id, (d) => ['closed', 'rejected', 'cancelled', 'escalated'].includes(d.case.status) && d.report.stages[7]!.status === 'done', { approve: true });
  log('Role-approved case finished', `${done.case.code} ${done.case.status}`);

  // Members can't change settings or the team; removal ends access at once.
  await expectStatus(manoj.api.tenant.updateSettings({ redactPii: false }), 403, 'A member cannot change settings');
  await expectStatus(manoj.api.members.update(sunita.auth.user.principalId, { approverRoles: [] }), 403, 'A member cannot change the team');
  const owners = (await owner.members.list()).filter((m) => m.role === 'owner');
  await expectStatus(sunita.api.members.update(owners[0]!.id, { approverRoles: ['safety-officer'] }), 403, 'Nobody else changes the owner');
  await owner.members.remove(manoj.auth.user.principalId);
  await expectStatus(manoj.api.cases.list(), 401, 'A removed person is turned away at once');
}
```

Change `onboard` so callers can read the email it signed up with: return `{ api, auth, draft, ws, email }`.

In `main`, after `await caseChecks(…)`, add:

```ts
  // 9. Roles and invites: role holders approve, others can't.
  await roleChecks({ email: runs[0]!.org.email });
```

- [ ] **Step 2: Run the whole system**

Run: `pnpm infra:up && pnpm db:migrate && pnpm build`, then start `pnpm dev` once in the background and wait for `curl -s localhost:3000/health` and the worker's `Worker polling` line.

Run: `pnpm smoke`
Expected: `Smoke test passed.` with ✓ lines for every roles check.

Run: `pnpm evals && pnpm turbo run build typecheck test`
Expected: all succeed. Stop `pnpm dev`.

- [ ] **Step 3: Commit**

```bash
git add master-ai-backend/scripts/smoke.ts
git commit -m "test(smoke): invites, role holders approve, non-holders 403, members can't change settings, removal ends access"
```

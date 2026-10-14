# 0010. Named roles approve: invites, approver roles and who may decide

Date: 2026-10-13 · Status: accepted

## Context
Until now one owner approved everything. Organizations don't work that way: a hot-work permit is the safety officer's call, a loan is the credit manager's, a discharge bill the insurance desk's. The case lifecycle ([ADR 0009](0009-organization-types-and-the-case-lifecycle.md)) names a role for each approval and sign-off, so the people holding those roles need their own logins, on web and phone, and the platform must enforce who may decide.

## Decision
- **Two kinds of role.** The access role (`owner`, `admin`, `member`) decides what a person may change. Approver roles (`principals.approver_roles`) are ids from the pack's lifecycle roles, such as `safety-officer` or `credit-manager`; a person may hold several, and an unknown role id is refused.
- **Invites.** The owner or an admin adds a person with a name, email, access role and approver roles. The server stores a hashed token that expires after 7 days and returns a link, `<web>/invite/<tenantId>/<token>`, which the owner sends themselves (there is no email connector yet). Opening the link shows the company and the roles; the person sets a password, or signs in with their existing one and joins a second company. Accepting runs under the tenant's RLS using the tenant id in the link, so no new global lookup is needed. A link works once, can be withdrawn, and dies with the access of the admin who made it. Invites are audited as `member.invited` and `member.joined`.
- **Access is read on every request.** Removing or demoting someone takes effect at once, not when their 7-day session ends. An open live connection of a removed person closes at its next reconnect.
- **Routing.** A gate goes to the role its rule names. If no active person holds that role, it goes to the owner and the approval says why ("Nobody holds the safety officer role yet"). Pushes for a role-routed approval go to its holders and the owner; operational pushes go to the owner and admins.
- **Who may decide.** The owner may decide anything. An admin may decide anything routed to the owner, plus their own roles. A member may decide only approvals for roles they hold; anyone else gets 403. The first decision wins (the row is locked). Each decision is signed with the person's device key and verified, as before ([ADR 0004](0004-auth-and-signed-approvals.md)), and the role check reads the database at decision time.
- **Each person's inbox.** Both apps open approvals on *Mine* (`GET /approvals?mine=true`); the owner and admins can switch to *All*. The daily pulse counts only the decisions that person can make. On a shared phone, saved approvals and decisions queued offline are kept per person, and signing in or out clears what was on screen.
- **Staff who also log in.** A team-directory record (someone the AI phones) can be linked to a login, so one person both takes calls and approves.
- **What each access role sees.** Everyone in the company sees all cases. Only the owner and admins change settings, the pack, rules, request keys and the team, or use the kill switch. The web hides those pages from members and the API refuses them.

## Consequences
- The right person approves from their own phone, with a fingerprint-signed decision, and the audit log shows who.
- Two-tier approval (a role, then the owner for very large amounts) is not supported; a rule names one role. SSO and passkeys are still later ([ADR 0004](0004-auth-and-signed-approvals.md)). Data visibility per role, beyond the approvals inbox, is out of scope.
- Tested by the smoke test (invites, refusals, removal, demotion, a second company) and by `pnpm e2e:sectors`, where in every organization type the role holder approves and a member without the role is refused.

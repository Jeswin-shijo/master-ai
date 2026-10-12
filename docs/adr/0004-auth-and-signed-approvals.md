# 0004. Built-in auth now, OIDC later; device-signed approvals

Date: 2026-10-12 · Status: accepted (auth is interim)

## Decision
- **Auth (interim):** email + password (scrypt) with HS256 session tokens, signed and verified in `common/crypto.ts`. Login across tenants uses one security-definer function (`auth_user_tenants`). Moving to Keycloak/OIDC changes token verification only; `Session` stays the same.
- **Approvals are signed.** Each device registers an Ed25519 public key. The private seed stays on the device: browser storage on web; keychain/keystore on mobile, used only after Face ID / fingerprint. A decision signs `approvalSigningMessage(...)` (canonical JSON, shared in `@onehuman/schemas`). The server verifies against the registered key and a ±10-minute clock window, and stores signature + key id in the approval and the audit event.
- WebAuthn passkeys can replace device keys later without changing the approval API.

## Consequences
The audit log can prove which device approved what. A device without biometrics can still sign with its key.

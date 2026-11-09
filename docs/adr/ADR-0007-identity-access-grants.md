# ADR-0007 — Identity, anonymous ownership and scoped access grants

**Status:** Accepted

## Context

KLOCKR must be usable instantly without an account while still supporting persistent accounts, temporary operators, read-only Boards, paired Devices and external API clients.

## Decision

Use separate credential/grant types for separate actors:

1. **Anonymous Show management grant** — created with a New Show and retained by the creating browser. It provides temporary Owner/Master-level control over that anonymous Show.
2. **Account session** — primary login/claim flow uses email magic links. Social login may be added later.
3. **Member/role grant** — persistent account-based access using permission bundles and scopes.
4. **Temporary role link** — optional time-limited access such as Operator without requiring an account.
5. **Board share grant** — read-only and scoped to the intended Board/data projection by default.
6. **Device credential** — persistent, revocable credential issued after short-lived pairing.
7. **API credential** — separate token per integration with explicit scopes.
8. **Platform support session** — Platform Admin can open read-only support context and, when authorized, explicitly impersonate a user. Impersonation is conspicuous and audited.

The anonymous management credential is never reused as a Board/share credential.

## Anonymous lifecycle

- Unclaimed Shows have a nominal 7-day expiry.
- Reaching expiry means **eligible for cleanup**, not immediate destructive deletion.
- Active use protects a Show from cleanup.
- Cleanup happens only after the Show is inactive and the configured grace/safety check passes.
- Users receive clear claim/expiry warnings in management interfaces, not disruptive Speaker/Public Boards.

## Consequences

- Credential types and scopes are modeled explicitly.
- Raw long-lived tokens should not be persisted when hashed-token verification is practical.
- Revocation must be supported independently for Board, Device, temporary role and API grants.
- Authorization checks use permissions/capabilities, never role-name conditionals.

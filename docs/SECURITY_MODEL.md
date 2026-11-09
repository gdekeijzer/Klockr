# Security model

## Threats worth designing for

- guessed/leaked Board share URLs;
- control link accidentally shared as display link;
- leaked temporary role links;
- stolen persistent Device credential;
- stolen anonymous management grant;
- magic-link abuse/replay;
- anonymous Show spam;
- replayed external API commands;
- stale concurrent Master writes;
- unauthorized emergency unlock;
- unauthorized/hidden support impersonation;
- XSS via Queue notes/messages/Board content;
- expired anonymous data being deleted while still live;
- secret leakage through logs.

## Access separation

Use distinct credentials/grants for:

- user/account session;
- anonymous Show management;
- temporary scoped role access;
- public/read-only Board share;
- paired Device;
- external API client;
- Platform support/impersonation context.

Never make a human-readable URL path itself the authority.

## Share grants

- cryptographically random opaque token;
- minimal Board/data/operation scope;
- Board shares read-only by default;
- revocable;
- optional expiry/PIN;
- preferably store hashed representation for long-lived secrets.

## Temporary role links

- explicit permission bundle/scope;
- expiry and revocation;
- visually identify temporary-access sessions;
- never reuse a Board token as a control token.

## Device pairing

Pairing code:

- short-lived;
- rate-limited;
- one-time claim;
- not the persistent credential.

After pairing, issue a revocable persistent credential bound to Device identity/scope.

## Magic links

- single-use or replay-resistant;
- short expiry;
- rate-limited requests;
- do not reveal whether arbitrary email addresses are registered more than necessary;
- consume/rotate state on successful login/claim.

## RBAC

All server-side mutations check capability and scope. UI hiding is never authorization.

Emergency lock override is a separate high-impact permission and creates an audit event.

## Platform support

Read-only support inspection should be preferred before impersonation. Impersonation must be explicit, visually persistent and audited. Do not provide an invisible normal-path God mode.

## Anonymous creation

Protect with rate limiting/abuse controls. Do not force login solely as an anti-abuse shortcut unless product policy changes.

## Content safety

Render user-entered notes/messages/titles safely:

- escape/sanitize HTML;
- do not inject arbitrary scripts/styles into Boards;
- if rich text is later supported, use an allowlist.

## API replay/idempotency

External mutation commands support idempotency keys. Sensitive API credentials are revocable and never written to normal application logs.

## Logging

Log IDs and structured metadata, not secret tokens. Redact Authorization headers and share/device/role-link credentials.

## Cleanup

Anonymous cleanup verifies expiry, active-use protection and grace/safety policy before deletion. Worker cleanup is idempotent and must never remove an actively live Show.

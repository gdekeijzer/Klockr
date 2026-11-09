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

## Implemented in M1

- **Credentials:** 256-bit CSPRNG secrets, base64url, type-prefixed (`klo_` owner, `klb_` board). Only SHA-256 hashes are stored (`access_grants.token_hash`); appropriate because the secrets are high-entropy. A token presented on the wrong channel (board token as owner credential or vice versa) is rejected.
- **Grants** (`access_grants`): `anonymous_owner` scoped to one Show (`show.read`, `timer.control`, `board.share`) and `board_share` scoped to one Board (`board.read` only). Authorization is the pure domain rule `grantPermits` (capabilities + scope), never grant/role names.
- **Owner credential in the browser:** HttpOnly, `SameSite=Strict`, `Path=/` cookie per Show (`Secure` when `COOKIE_SECURE=true`). The Show id in the operator URL grants nothing; other browsers get a "no control access" page. Commands require JSON bodies, which together with SameSite=Strict blocks cross-site request forgery.
- **Board link:** `/b/<board token>`; the page sets `referrer: no-referrer` and `noindex`. The Board has no management data, no expiry warnings and cannot reach any mutating endpoint.
- **Cross-Show probing:** a command for another Show's item via your own Show id returns `not_found`.
- **Rate limits:** Show creation 20/min/IP, board state 120/min/IP, realtime handshakes 60/min/IP (in-process; one server instance). The server trusts `X-Forwarded-For` and must only be reachable through the reverse proxy.
- **Logging:** cookie, authorization and set-cookie headers are redacted; realtime logs contain role, Show id and rejection reason only.
- Not yet: credential revocation UI, PIN/expiry on board links, cleanup of expired anonymous Shows (worker), CSP headers.

## Implemented in M2

- New capabilities: `queue.read`, `queue.manage` (structure, content, overrides), `item.control` (current, END / NEXT), `show.manage` (Show defaults). `anonymous_owner` bundles all of them for its own Show; `board_share` still has only `board.read`. Each Queue command declares its capability (`permissionFor()` in `packages/application/src/queue/queue-commands.ts`); no role-name checks.
- A board token can never send commands: the commands endpoint only accepts the owner cookie (a bearer board token gets 401), and the application layer denies board actors independently (tested at unit, server and PostgreSQL level).
- Board projections contain only the current item's title/subtitle, effective thresholds and timer — never notes, tags, other items or management data. User text is rendered as React text (escaped), never as HTML.

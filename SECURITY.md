# Security policy

This project controls live-show behavior, share links and potentially production displays. Security bugs can therefore have operational impact even when no sensitive personal data is involved.

## Do not commit

- passwords;
- API keys;
- access tokens;
- private keys;
- real `.env` files;
- production database dumps;
- share URLs/tokens from real productions.

Use `.env.example` for names and documentation only.

## Security design

See `docs/SECURITY_MODEL.md`.

Core requirements include:

- scoped/revocable share tokens;
- permission-based RBAC;
- short-lived pairing codes;
- rate limiting on anonymous creation/pairing/auth endpoints;
- audit logging of emergency lock overrides;
- explicit, visible and audited Platform Admin impersonation;
- strict separation of Board shares, temporary role links, Device credentials and API credentials;
- sanitized Board content;
- server-side authorization on every mutation;
- secure token generation using cryptographic randomness.

## Reporting

A private reporting channel has not yet been selected. Do not publish a real vulnerability in a public issue until a project contact/security process exists.

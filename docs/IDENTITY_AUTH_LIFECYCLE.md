# Identity, authentication and lifecycle

**Status: Accepted product/architecture behavior.**

## Goals

- zero-friction anonymous start;
- clear separation between control credentials and display credentials;
- secure persistent account/device/API access;
- no requirement that temporary production staff create an account;
- no destructive expiry during a live production.

## Actor and credential types

### 1. Anonymous Show owner

`New Show` creates an anonymous Show plus a secret management grant retained by the initiating browser. That grant gives temporary Owner/Master-level access to that Show.

Losing the secret may mean losing anonymous management access unless another recovery path has been established. Do not weaken the model by embedding control authority in a guessable Show ID.

### 2. Account user

Primary login and Show claiming use email magic links.

- first successful claim/login may create the account;
- no password is required for the initial V1 flow;
- social providers may be added later;
- passkey/password/MFA can be considered later without changing Show ownership semantics.

### 3. Persistent member/invite

Users can be invited to a Show/Event/account context and receive a role/permission bundle with a scope.

### 4. Temporary role link

A Master/authorized user may issue a temporary role grant for live production staff, such as Operator, without requiring an account.

Properties should support:

- role/permission bundle;
- scope (Event/Show as appropriate);
- expiry;
- revoke/regenerate;
- optional PIN later.

This is distinct from a Board link.

### 5. Board share grant

A Board link is read-only by default and only authorizes the intended Board/data projection. It cannot mutate the Show.

### 6. Device identity

A device first receives a short-lived pairing code. After successful pairing it receives a persistent revocable device credential bound to the Device identity and assignment scope.

Device ID by itself is never authentication.

### 7. API client

Each external integration receives its own token with explicit scopes such as:

- `show.read`;
- `timer.control`;
- `message.send`.

Do not create one all-powerful API key per account as the primary model.

### 8. Platform Admin/support

Platform Admin is separate from customer Account Admin and production Master.

Support can:

- inspect safe metadata/status in read-only support mode;
- explicitly impersonate a user when authorized;
- see a persistent SUPPORT/IMPERSONATION banner;
- produce an audit event for start/end of impersonation and sensitive actions.

There is no invisible God mode in the normal support workflow.

## Permissions

Authorization is permission/capability based. Roles are bundles of permissions. Do not code authorization as role-name branches.

Initial role presets:

- Owner/Admin;
- Master;
- Operator;
- Viewer.

The model must accept future presets without schema redesign.

## Anonymous Show lifecycle

Nominal retention: **7 days**.

Expiry means eligibility for cleanup, not immediate deletion.

Recommended lifecycle states:

```text
anonymous-active
  -> anonymous-expiring
  -> expired-pending-cleanup
  -> deleted/soft-deleted

or

claimed -> normal owned lifecycle
```

Rules:

- show a clear management warning before expiry;
- do not place administrative expiry warnings on normal Speaker/Public Boards;
- active connections/live use protect the Show from deletion;
- worker rechecks activity before cleanup;
- cleanup must be idempotent;
- exact grace period can be configured operationally, but must never be zero for an actively used Show.

## Session/security rules

- use secure, HTTP-only cookies for browser management/account sessions where appropriate;
- rotate/revoke grants where product flow requires it;
- rate-limit magic link, anonymous creation, pairing and token verification endpoints;
- never log raw secrets;
- store hashes of long-lived opaque tokens where practical;
- permission and scope checks are server-side on every mutation.

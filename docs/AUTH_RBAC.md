# Authentication, authorization and RBAC

See `IDENTITY_AUTH_LIFECYCLE.md` and ADR-0007 for the accepted lifecycle and credential model.

## Anonymous first

Creating a useful Show does not require an account.

An anonymous Show receives:

- lifecycle/expiry metadata;
- a secret management grant retained by the initiating browser;
- separate Board share grants when Boards are shared.

The management grant provides temporary Owner/Master-level control and is never interchangeable with a display token.

## Accounts

Primary V1 authentication/claim flow uses email magic links. Social login may be added later.

Accounts support persistent ownership, prepared Shows/templates, Devices and collaboration.

Keep the concrete auth/email provider behind adapters so provider details do not infect domain logic.

## Collaboration

Support both:

- persistent account/member invitations;
- temporary scoped role links for production staff who should not need to create an account.

## Permission model

Authorization is capability-based. Roles are named bundles of permissions.

Initial role presets:

- Owner/Admin;
- Master;
- Operator;
- Viewer.

Possible capability families:

- `event.read`, `event.manage`;
- `show.read`, `show.edit`, `show.control`;
- `queue.edit`, `queue.reorder`;
- `timer.control`;
- `message.send`;
- `board.manage`;
- `device.manage`;
- `share.manage`;
- `lock.create`, `lock.release`, `lock.emergency_override`;
- `member.manage`;
- `api.manage`.

Exact names may evolve, but checks must remain permission-based.

## Scope

Grants may be scoped to account/event/show/Board/device as appropriate. Do not assume every role assignment is global.

## Board access != user role

A presenter/public Board works through a narrow Board share credential. It does not need a Viewer account and is read-only by default.

## API clients

API credentials are separate per integration and explicitly scoped. They are not human sessions and should be independently revocable.

## Platform support

Platform Admin is distinct from customer/product roles. Support can inspect read-only context and explicitly impersonate a user when authorized. Impersonation is visible and audited.

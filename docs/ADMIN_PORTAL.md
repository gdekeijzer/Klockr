# Platform Admin / Support Portal

The Platform Admin surface is product/platform management and is explicitly distinct from customer Account Admin and production Master.

## Separation of authority

```text
Platform Admin        KLOCKR platform/support
Account/Event Admin   customer ownership/administration
Master                live production planning/control
Operator              focused live operation
```

Platform roles must not leak into normal Event/Show RBAC.

## Support behavior

Support follows a least-privilege progression:

1. inspect platform metadata/status in read-only support mode;
2. inspect lifecycle, connectivity, grant/device status and safe diagnostics;
3. only when necessary and authorized, explicitly impersonate a user.

### Impersonation

Impersonation is never invisible normal-path God mode.

Requirements:

- explicit start action;
- persistent visible `SUPPORT / IMPERSONATING` state;
- actor and target user recorded;
- start/end timestamps audited;
- sensitive actions during impersonation remain attributable;
- easy exit back to Platform Admin context.

## Platform capabilities

The architecture must support:

- users/accounts;
- anonymous Shows;
- expiry/cleanup queue;
- Devices and credentials;
- share/temporary-role/API grant revocation;
- system/realtime health;
- abuse/rate-limit investigation;
- read-only support inspection;
- audited user impersonation;
- audit inspection;
- later licensing/subscriptions and feature flags.

## V1 architectural requirement

Even if the polished Admin Portal is staged later, services/data must allow authorized platform staff to:

- inspect anonymous Show lifecycle;
- safely clean expired unclaimed Shows;
- never delete an actively used Show;
- revoke compromised share/device/role/API access;
- diagnose operational failures using IDs/logs;
- use read-only support mode before impersonation;
- audit emergency lock overrides and support impersonation.

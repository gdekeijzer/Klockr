# Devices and sharing

## Separate sharing concepts

### Board share

A Board can expose a scoped share link/QR for quick display use.

- read-only by default;
- limited to the intended Board/data projection;
- revocable/regeneratable;
- opaque/unpredictable;
- optional expiry/PIN later.

### Temporary role link

A temporary role link is different from a Board share. It may grant scoped Operator-style control for a limited period without requiring an account. It is permission checked, expirable and revocable.

### Persistent Device pairing

A client opens the device pairing page and receives a short-lived code, e.g. `482 716`. In Master, an authorized user claims/pairs that code and assigns a Board.

## Device object

A paired Device is persistent and manageable.

Suggested properties:

- stable Device ID;
- display name;
- created/last-seen timestamps;
- online/offline state;
- currently assigned Board;
- optional Event/Show context;
- revoked/removed state.

Device ID alone is not authentication. Use a separate revocable device credential issued at pairing.

## Device Management

Minimum actions:

- rename;
- inspect last seen/status;
- assign/reassign Board;
- revoke access;
- remove device;
- rotate/regenerate credential when needed.

## Central + local sharing UI

Both are required:

- central Share overview;
- Share/QR action on each Board.

## Anonymous Show admin access

Anonymous management uses a secret management grant separate from Board shares, Device credentials and temporary role links.

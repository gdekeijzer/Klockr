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

## Implementation (M5)

- **Device** (`packages/domain/src/device/device.ts`): name, scope (one Event XOR one standalone Show), assigned Board, created, last seen, revoked, revision. Status is derived: `online` (connected now), `recently seen` (≤ 15 min), `offline`, `not connected yet`, `revoked`. `last_seen_at` is written on connect/disconnect and at most every 5 minutes while connected — never per second.
- **Pairing**: the display opens `/device` and shows `PAIR DEVICE` + a code like `7K4M-P2` (10 min, one-time, unambiguous alphabet; only a hash is stored). An operator enters it under Devices → Pair Device (name, optional Board). The display then claims its permanent credential once with its own pairing secret. No password on the display.
- **Device credential**: `kld_…`, SHA-256 hash stored, read-only presentation of the assigned Board only; never an owner/user/Board-share credential.
- **Management** (`/event/<id>/devices`, and the Boards page of a standalone Show): list, status, last seen, Pair, rename, assign/reassign Board (only Boards inside the scope), revoke (final), remove (only after revoke).
- **Display**: the same `BoardView` renderer as share links. On reassignment the server moves the Device's sockets to the new Board and resends its projection; on revocation it sends `access.revoked` and disconnects — the display shows `DEVICE UNPAIRED`. Short outages keep the last projection and local timers with a subtle RECONNECTING.
- **Share links** (separate from Devices): labelled, listed with Board and creation time, revocable; a revoked link is refused immediately (HTTP 401, realtime disconnect, the open display shows "This board link has been revoked").
- **Audit**: `device.pair`, `device.assign/reassign`, `device.rename`, `device.revoke`, `device.remove`, `board.share.create`, `board.share.revoke`.

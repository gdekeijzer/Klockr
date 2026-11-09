# ADR-0011 — Anonymous Event scope, Show placement and Device credentials (M5)

**Status:** Accepted (M5)

## Context

M5 adds optional Events and Rooms above Shows, persistent Devices and Board share management. There are still no accounts (M6). Until M5 every Show was managed only with its own anonymous owner credential (one HttpOnly cookie per Show). An Event needs a management scope too, and Devices need an owner scope, without breaking the low-friction Quick Timer.

## Decision

1. **Anonymous Event owner grant** (`anonymous_event_owner`, cookie `klockr_event_<id>`, token prefix `kle_`), scoped to exactly one Event. Its bundle covers the Event (`event.*`, `room.manage`, `show.create`) and, through placement, **every Show placed in that Event**: the authorizer resolves a Show's current `eventId` and an Event grant matches it. Detaching a Show ends that access. Show owner grants keep working unchanged.
2. **Placement lives on the Show** (`shows.event_id`, `room_id`, `event_position`), written only by the Event aggregate (one compare-and-set on the Event revision). A composite FK `(event_id, room_id) → rooms(event_id, id)` guarantees a Room always belongs to the Show's Event; a Show is in at most one Room.
3. **Attaching an existing standalone Show** requires BOTH `show.move` on the Show (its owner) and `show.move` on the Event (its owner). A Show in another Event must be detached there first.
4. **Event / Room locks** are structural (Event lock guards all structure; Room lock guards its Room) plus the Show's own Show-level lock for moving that Show. They never block live transport inside a Show. Emergency Override is explicit, permission-gated and audited.
5. **Duplication** is explicit and produces a clean, idle copy (configuration yes; runtime, Current, actuals, suggestions, Messages, locks, audit, shares and Device credentials no).
6. **Devices are not grants.** A Device has its own record (scope: one Event XOR one standalone Show), a credential (`kld_`, only its SHA-256 hash stored), an assigned Board and derived status. Pairing uses a short-lived (10 min), one-time code (unambiguous 31-symbol alphabet, 6 chars) entered by an operator, and a separate high-entropy pairing secret (`klp_`) with which the display claims its credential exactly once. A Device credential is read-only presentation access to its assigned Board; it can never mutate anything and is never accepted as an owner or Board share credential.
7. **Board shares** stay separate from Devices: labelled, listable, revocable grants; revocation cuts open realtime connections immediately.
8. **Event Boards** are the same Board object (owner: an Event instead of a Show) with two extra source modes (`room`, `event`), projected per source Show with the unchanged Show Board projection rules (audience filtering server-side).

## Consequences

- Event management is bound to the creating browser (as for Shows) until accounts/claim exist (M6); the cookie lifetime follows the anonymous TTL (see OPEN_QUESTIONS).
- Shows created inside an Event also get their own owner cookie, so they remain manageable after being detached.
- Pairing code hashes are fast hashes of a short code; this is acceptable only because codes are short-lived, one-time and can only be redeemed by an authenticated manager.

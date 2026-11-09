# Acceptance criteria

These are product-level acceptance criteria, not a complete test case list.

## Quick Timer

- User can create an anonymous timer without creating Event/Room/account.
- Timer can start, pause, resume and stop.
- Overtime can continue visibly after zero when configured.
- Speaker Board receives state and keeps visibly counting during a brief connection loss.

## Queue

- User can add/reorder/duplicate Queue Items.
- An item without timer properties remains valid content/note.
- A timed item behaves as a timer without becoming a different core object.
- Inactive/skipped items are not accidentally selected by normal NEXT behavior.
- Groups move with their children.

## Timer safety

- STOP does not execute END/NEXT behavior.
- END can perform configured completion/next behavior.
- Multiple timers can run simultaneously.
- An item's warning override is visible as an override.

## Scheduling

- Strict mode reports ahead/behind without silently modifying later durations.
- Sliding mode can update projected future times without overwriting the baseline reference.
- Fixed anchors remain visible in recovery status.
- Linked parallel-Queue items preserve configured relative offset when the selected policy applies.
- Live schedule changes are visually understandable and do not appear as unexplained list jumps.

## Master / Operator

- Master can organize/duplicate/move within permission and lock rules.
- Operator exposes focused live controls without requiring structural editing.
- Locked objects reject unauthorized mutation.
- Permission-gated Emergency Override works only after explicit confirmation and produces an audit event.

## Boards

- One Show State can produce materially different Speaker/Stage/FOH/Public presentations.
- Board data source/filter is independent from its physical Device.
- V1 presets allow meaningful professional customization without a free-form designer.
- Ad-hoc message can target selected Audience(s) and be cleared independently of Queue Items.

## Devices/sharing

- Temporary Board link/QR can be issued and revoked.
- Pairing code is short-lived and results in a persistent manageable Device.
- Device can be reassigned and revoked.
- Display access does not grant show-control permission.

## Anonymous lifecycle

- Anonymous Show clearly warns authorized management UI before expiry.
- Claiming preserves the Show.
- Cleanup does not delete an actively used live Show at its nominal expiry moment.

## Realtime/reconnect

- Clients reject stale state revisions.
- Reconnect obtains authoritative state.
- A disconnected control client does not falsely report central mutations as successful.

## External API

- Authenticated scoped API client can invoke supported control commands.
- Retried command with same idempotency key cannot produce an unintended duplicate transition.
- API control uses the same command semantics as UI control.

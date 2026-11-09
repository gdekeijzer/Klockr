# Queues and scheduling

## Queue behavior

A Queue is an ordered operational lane. Items can be active/eligible or intentionally inactive/skipped.

`NEXT` should select the next eligible item according to Queue order and skip/inactive rules.

## Three time models

Do not conflate these values:

1. **Baseline schedule** — original/committed planned times used as reference.
2. **Projected/effective schedule** — current expected future times after Sliding shifts or manual planning changes.
3. **Actual runtime** — when items really started/ended and the current live state.

This separation is required to accurately report ahead/behind while still allowing a Sliding projection.

## Strict / Operator Controlled

The baseline schedule remains the reference.

If a speaker overruns by five minutes:

- report `+05:00 BEHIND`;
- do not silently shorten later items;
- keep fixed anchors visible;
- operator decides where to recover time.

The software may later suggest recovery, but Automatic Recovery is not V1.

## Sliding / Free

Future projected times may shift while durations remain intact.

If A runs five minutes long, B and later projected items can move five minutes later until a policy/anchor dictates otherwise.

### Live shift UX requirement

A live timer adjustment must not cause the technician's list to chaotically jump with no explanation.

Use explicit state such as:

- `SHIFT PENDING`;
- `UPDATED +05:00`;
- changed-item highlight;
- confirmation/review in Master where policy requires it.

The state model may update immediately, but presentation of schedule movement must be calm and understandable.

## Fixed anchors

An item may declare a fixed scheduled point, for example Lunch at 13:00.

The Show can report:

```text
+05:18 BEHIND
Next fixed point: Lunch 13:00
Recovery required: 05:18
```

This is information, not automatic recovery.

## Cross-Queue relationships

A related item stores:

- anchor item;
- relative offset;
- relationship status/policy.

When the anchor moves, the related item can preserve its offset according to the active timing policy.

If the user moves an anchor across parents/Queues/Shows, Master should explain affected linked items and allow an appropriate move/unlink decision.

## Move / drag-drop behavior

Master supports:

- reorder item within Queue;
- move item to another Queue;
- move Group with children;
- duplicate item/Group/Queue/Show as supported;
- move Show to another Room;
- protect structures with locks.

Never perform a cross-context move without checking permissions, locks and linked relations.

## Current / Next

Recommended model:

- each Queue has its own current item;
- `next` is the next eligible Queue Item;
- global Show current/next derives from the primary Program Queue;
- Boards can explicitly select another Queue.

## Implementation (M2)

**Structure.** `Queue -> (optional) Group -> Queue Item`, one Group level only (no Group-in-Group, no Session/Cue/Timer hierarchy). The Queue's top level interleaves items and Groups; each Group orders its own children. Positions are dense integers per container and are rewritten by every structural command. Code: `packages/domain/src/queue/`.

**Current.** One persisted `currentItemId` per Queue (nullable). It changes only through explicit commands: `queue.setCurrent` (operator jump/re-run) and `item.end` with `next: true`. Changing current never starts, stops or otherwise touches any timer (a timer still running on the previous item keeps running and is shown as RUNNING in the Queue preview with its own stop control).

**Next is derived, never stored** (decision 2026-11-09, confirmed in the M2 review — OPEN_QUESTIONS #34). `next` = the first *eligible* item after Current in Queue order (groups expanded in place); eligible = `active` and not completed. Without a Current, `next` = the first eligible item of the Queue. Because it is a pure function of order, active flags, completion and the current position (`nextItem()`), it can never disagree with them; the server includes the derived `nextItemId` in every Queue snapshot so all clients show the same value. Consequence: after jumping back to re-run an earlier item, NEXT continues with the first not-yet-completed item after it.

**Lifecycle (derived).** `current` > `completed` > `inactive` > `upcoming`, from `currentItemId`, `completedAt` and `active`. Making a completed item current again clears its `completedAt` (it is live again).

**Safety rules.** The current item cannot be deleted or made inactive; an item or Group with a running/paused timer cannot be deleted; an inactive item cannot be made current (activate it first). Drag & drop only moves structure; it never changes current/next state or timers by itself (next is simply re-derived).

**Consistency boundary.** The Queue aggregate (Queue, Groups, Items, item timers and the Show warning default it inherits) is saved atomically with compare-and-set on `queues.revision` plus per-timer compare-and-set for every timer the command changes. END + NEXT (complete + stop current timer + move current + optional start of the next timer) is therefore all-or-nothing.

## Implementation (M3)

**Time layers.** Persisted: explicit `plannedStartAt` (UTC), `plannedDurationMs` (items without timer only; for timed items the configured timer duration IS the planned duration — decision 2026-11-10, OPEN_QUESTIONS #42: live adjustments never change it, a deliberate duration edit is an audited planning edit; no second duration value for timed items), `fixedAnchor`, `actualStartAt`, `actualEndAt`, Show `timingMode` / `timeZone` / `scheduleDate` / `toleranceMs` (30 s) / `severeBehindMs` (5 min), Queue `timingMode` override. Derived (never stored): chained planned starts (after the previous active item's planned end), planned ends, projected starts/ends, shifts, the Show offset, statuses, recovery to the next anchor, anchor risk/missed and soft-start warnings. Engine: `calculateSchedule(aggregate, now)` in `packages/domain/src/schedule/engine.ts`; clients run the same pure function on the authoritative snapshot (like `deriveTimer`), so there are no schedule ticks.

**Projection rules.** Completed items use their actuals; items passed over by a jump forward are skipped; the current item ends at `start + paused + duration + adjustment` (never before now; a stopped-but-not-ENDed item ends now); upcoming items follow the previous projected end and never start before now. Nothing is ever shortened.
- Strict (decision 2026-11-10, OPEN_QUESTIONS #41): an item with an explicit planned start never projects earlier than planned; running ahead creates buffer/waiting time before it. Planned stays the operational reference and never changes.
- Sliding: projected times follow live deviations in both directions.
- Both: a fixed anchor never projects earlier than its planned start; lateness propagates.

**Show offset** = projected - planned of the relevant milestone: the current item's END once it has started (otherwise its start), or the first upcoming item's start when nothing is current. ON TIME within ±tolerance, AHEAD below, BEHIND above, severe (red) above `severeBehindMs`; a small hysteresis prevents flicker at the edges.

**Recovery to anchor** = projected arrival at the next fixed anchor (end of the preceding items) - the anchor's planned start; a separate value from the Show offset. `risk` while it is ≤ the time still recoverable (remaining current + not-started items before the anchor), `missed` when not.

**Calm presentation.** Every relevant transition (START/STOP/adjust, END, current change, planning edit, reorder, timing mode) commits one Queue revision and one `queue.state`; clients recompute and mark shifted rows (`UPDATED ±mm:ss`, shift chip) without ever reordering rows.

**Locks.** Structure/configuration locks on Show, Queue, Group or Item (`locks` table, part of the Queue aggregate). Effective lock = nearest lock on the target or a parent (item → group → queue → show). Locks block structure, content, planning, timing-mode and duration edits (incl. `timer.configure`); they never block START/PAUSE/RESUME/STOP, END/NEXT or set current. Request Unlock is persisted against the effective lock and resolved when that lock is released. Emergency Override = resend the blocked command with `override: { reason }`; needs `lock.override`; audited with actor, time, resource, reason, command and the lock; the lock itself stays.

**Audit.** `audit_events` (append-only, same transaction as the change): `lock.set`, `lock.release`, `lock.request_unlock`, `lock.override`, `schedule.update` (planned start/duration, anchor flag, timer duration), `anchor.update`, `timing_mode.update`, `schedule.settings`.

**Master / Queue Editor boundary.** The M2 Queue Editor is now part of the Master View (`/show/<id>/master`): one editing system. `/show/<id>/edit` permanently redirects there.

## Implementation (M4)

- **Show aggregate.** All Queues of a Show live in one `ShowAggregate` (`packages/domain/src/show/aggregate.ts`): Queues (each with its own Groups, Queue Items, Current and revision), locks, relations, suggestions, Boards and Messages. One Show-level revision is the compare-and-set token for persistence; each Queue keeps its own revision for `expectedRevision`, gating and conflict reporting. Every state change goes through `mutateShow` in `packages/application`.
- **Peer Queues.** `queue.create / update / move / setPrimary / delete`. Queues are flat peers ordered by `position`; exactly one is Primary (★) and drives global Current/Next projections and the default Board source. The Primary Queue, a Queue with a running/paused timer, or a Queue whose Current item is live (started, not ended) cannot be deleted. Each Queue has its own Current; multiple timers may run in different Queues at once; changing Current in one Queue never touches another Queue.
- **Relations** (`relation.create / update / delete`): `source item → target item` in a *different* Queue with a signed `offsetMs` relative to the source start and `preserveOffset`. At most one active preserve-offset relation per target; cycles (through relations and Queue order) are rejected. `calculateShowSchedule` evaluates all Queues to a fixpoint: a target's desired start = source projected start + offset; it never moves before what its own Queue allows. If the target cannot meet the desired start the relation is marked **CONFLICT** (shown, never auto-resolved).
- **Suggested follow.** When a Queue's Current changes to an item with outgoing relations, a *pending suggestion* is created for each target Queue (`GO` / `Ignore` in the Operator View, a badge on the Queue tab). `GO` only makes the target Current — no timer starts by itself; `Ignore` keeps Current. A suggestion becomes *stale* (and cannot be accepted) when the target Queue's Current changed, the target became ineligible, or the relation was removed. There is no auto-follow in V1.
- **Move between Queues** (`item.moveToQueue`): only for items that are not Current, not running, and not related to an item in the destination Queue; atomic.
- **Timeline.** Master offers List / Timeline: one lane per Queue on a shared axis, planned outline + projected block, CURRENT / FIXED / LINK / CONFLICT / SHIFT labels, a now-line, and a fixed window (no auto-scroll, no animation).

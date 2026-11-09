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

**Next is derived, never stored** (decision 2026-11-09). `next` = the first *eligible* item after Current in Queue order (groups expanded in place); eligible = `active` and not completed. Without a Current, `next` = the first eligible item of the Queue. Because it is a pure function of order, active flags, completion and the current position (`nextItem()`), it can never disagree with them; the server includes the derived `nextItemId` in every Queue snapshot so all clients show the same value. Consequence: after jumping back to re-run an earlier item, NEXT continues with the first not-yet-completed item after it.

**Lifecycle (derived).** `current` > `completed` > `inactive` > `upcoming`, from `currentItemId`, `completedAt` and `active`. Making a completed item current again clears its `completedAt` (it is live again).

**Safety rules.** The current item cannot be deleted or made inactive; an item or Group with a running/paused timer cannot be deleted; an inactive item cannot be made current (activate it first). Drag & drop only moves structure; it never changes current/next state or timers by itself (next is simply re-derived).

**Consistency boundary.** The Queue aggregate (Queue, Groups, Items, item timers and the Show warning default it inherits) is saved atomically with compare-and-set on `queues.revision` plus per-timer compare-and-set for every timer the command changes. END + NEXT (complete + stop current timer + move current + optional start of the next timer) is therefore all-or-nothing.

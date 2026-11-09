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

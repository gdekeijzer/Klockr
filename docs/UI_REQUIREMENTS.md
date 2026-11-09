# UI requirements

> Visual implementation must also follow `DESIGN_SYSTEM.md`, `UI_COMPONENTS.md` and `UX_PATTERNS.md`. The generated mockups in `docs/design/assets/` are directional references; these documents define implementable behavior.

## Quick Timer

Goal: first useful timer in seconds.

Minimal path:

1. New Timer / New Show;
2. enter duration;
3. START;
4. open/share simple Board.

Do not expose Event/Room/parallel Queue configuration in the critical path.

## Operator View

Operator is intentionally focused.

Must prioritize:

- current;
- next;
- primary timer;
- other running timers where useful;
- warning/critical/overtime state;
- clean transport controls;
- STOP separate from END/NEXT;
- time adjustments;
- ahead/on-time/behind;
- ad-hoc message controls;
- connection state;
- override indicators where operationally relevant.

Avoid broad structural editing.

## Master View

Master can plan and operate:

- expandable Event/Room/Show/Queue tree;
- drag/drop;
- duplication;
- relationship visualization;
- lock state;
- linked-item move consequences;
- Board/Device management;
- schedule baseline/projected differences;
- direct controls where permitted.

## Live shift presentation

If a running timer changes projected schedule:

- do not instantly teleport rows with no cue;
- mark affected items;
- show shift amount/context;
- use pending/apply semantics where policy calls for it;
- keep the operator/technician oriented.

## Override presentation

Any overridden inherited setting should expose:

- that an override exists;
- effective value;
- source level;
- reset-to-inherited action where allowed.

## Locks

Locked structure is visually obvious. Permission-appropriate UI can expose:

- unlock;
- Request Unlock;
- Emergency Override with confirmation.

## Anonymous expiry

Master/account-management surfaces show a clear countdown/Claim Show call to action before deletion.

Presenter/Public Boards should not show administrative warnings unless truly required.

## Accessibility/readability

Live-show outputs require high legibility:

- strong contrast;
- scalable type;
- predictable warning states;
- do not rely on color alone for critical state;
- keyboard operation for Operator/Master should be considered from V1.

## Visual language

KLOCKR is dark-first for professional live-production environments. Use blue as the product/information accent. Green/amber/red communicate operational state, not decoration.

Default Speaker/Confidence Board normal timer color is white/light gray, not bright green. Warning, critical and overtime appearances are Board-configurable and follow `DESIGN_SYSTEM.md`.

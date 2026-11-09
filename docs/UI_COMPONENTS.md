# KLOCKR UI component contract

Status: V1 baseline

This document defines the reusable UI primitives Claude should build toward. It is intentionally behavioral: exact implementation may evolve, but semantics and state distinctions must remain stable.

See also:

- `DESIGN_SYSTEM.md`
- `UI_REQUIREMENTS.md`
- `TIMER_ENGINE.md`
- `QUEUES_SCHEDULING.md`

## 1. App Shell

Responsibilities:

- product navigation;
- context switcher (Event / Show where applicable);
- current wall clock;
- connectivity indicator;
- current user/access context;
- global live status where applicable.

Do not overload the App Shell with show editing controls.

## 2. Status Chip

Canonical semantic variants:

- `neutral`
- `info`
- `success`
- `warning`
- `critical`
- `offline`

Examples:

- RUNNING
- ON TIME
- +03:12 BEHIND
- WARNING
- OVERTIME
- OFFLINE
- LOCKED

A chip must carry text/icon semantics in addition to color.

## 3. Timer Display

Inputs should conceptually include:

- effective timer state;
- display value;
- duration/target where applicable;
- warning/critical/overtime state;
- Board presentation policy;
- connectivity freshness.

It must not own authoritative timer math.

Variants:

- `operator-primary`
- `operator-secondary`
- `speaker`
- `compact`

The same Timer Display must be able to render normal state in white and warning/overtime states in configured colors.

## 4. Timer Progress

Represents elapsed/remaining progression.

Rules:

- configurable hidden/visible per Board;
- may change state color at thresholds;
- must not be the only warning mechanism;
- does not imply authoritative timing on its own.

## 5. Transport Bar

Required operational actions where permitted:

- START / RESUME;
- PAUSE;
- STOP;
- END/NEXT;
- PREVIOUS/NEXT if the relevant workflow exposes them;
- configured time adjustment shortcuts.

STOP and END/NEXT require different labels, icons and action contracts.

## 6. Time Adjustment Control

Supports preset deltas and potentially a custom delta.

Examples:

- -30s
- -10s
- +10s
- +30s
- -1m
- +1m
- custom

The UI shows the actual requested adjustment before a dangerous/large change when confirmation is warranted.

## 7. Current Item Card

Displays selected live projection data such as:

- title;
- speaker/subtitle;
- room/area tag;
- duration;
- target end;
- relevant override marker.

`Current` is a semantic property and is not synonymous with `running`.

## 8. Next Item Card

Shows the next projected operational item for the active Queue/context.

It may show:

- title;
- duration;
- target start;
- room;
- schedule delta.

## 9. Queue Table / Rundown

Core desktop representation for Operator/Master list mode.

Must support:

- current marker;
- selected state;
- running state;
- complete/scheduled state;
- warning/conflict state;
- lock state;
- relation marker;
- override marker;
- drag handle in edit-capable contexts.

Operator may receive a reduced interaction set compared with Master.

## 10. Multi-Queue Timeline

Master-focused component.

Must support peer lanes such as:

- Program;
- Stage;
- Audio;
- Lighting;
- Video.

Required concepts:

- planned time axis;
- queue lanes;
- item blocks;
- current/now playhead where relevant;
- relations/offset visualization;
- pending/live schedule changes;
- locks;
- selection;
- drag/move when permitted.

Do not imply that a relation creates a nested parent/child Queue hierarchy.

## 11. Event Tree

Master navigation/editor tree:

- Event;
- optional Rooms/Areas;
- Shows;
- Queues;
- Groups/Items where useful.

Supports expansion, selection, drag/drop where permitted, locks and duplication.

Do not make Event or Room mandatory for standalone Shows.

## 12. Inspector Panel

Master configuration surface for the selected object.

Must expose:

- effective values;
- inheritance source;
- override state;
- permissions/lock constraints;
- relations;
- relevant Devices/Boards.

Avoid hidden auto-save ambiguity during dangerous live edits. Live-impacting edits need clear state/feedback.

## 13. Board Renderer

A Board renderer consumes data/state and a Board configuration.

It must not contain Show business logic.

V1 configuration should cover at minimum:

- component visibility;
- constrained layout/order;
- typography sizing;
- logo/background;
- timer state appearance;
- progress visibility/appearance;
- source/filter;
- low-light settings;
- message region.

## 14. Ad-hoc Message Overlay

For urgent operator messages such as `WRAP UP`.

Properties may include:

- text;
- audience/destination;
- severity/style;
- manual clear;
- optional timeout.

This is not a Queue Item.

## 15. Lock Indicator and Lock Actions

Must represent:

- unlocked;
- locked;
- request unlock available;
- emergency override available/used.

Emergency Override requires explicit confirmation and permission; audit behavior is defined elsewhere.

## 16. Override Indicator

Compact marker for inherited-setting overrides.

On interaction/details it exposes:

- current effective value;
- source level;
- inherited value where useful;
- reset action where permitted.

## 17. Connectivity Indicator

Operator/Master variants should clearly support:

- connected;
- reconnecting;
- offline.

Board variant should be minimal and must not replace the active timer display during a brief disconnect.

## 18. Schedule Delta Indicator

Represents schedule relationship such as:

- ON TIME;
- +03:12 BEHIND;
- -01:20 AHEAD.

It may also surface next fixed anchor/recovery context but must not silently apply recovery.

## 19. Empty and first-run states

First-run UI must preserve the IKEA-afwasborstel principle.

Quick Timer first-run should not present an empty enterprise dashboard. It should ask for the minimum required information to run a timer.

## 20. Component implementation rule

Before introducing a new visual component, Claude should check whether the concept belongs in this component contract or composes existing primitives. Avoid one-off UI variants that encode business rules differently per screen.

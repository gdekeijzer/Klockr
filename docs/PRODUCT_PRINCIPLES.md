# Product principles

## 1. IKEA-afwasborstel principle

The first useful experience must be obvious and immediate. A person who needs a five-minute countdown should not first create an Event, Room, Board and role model.

The simple timer is not a toy mode. It is the smallest expression of the same domain model.

## 2. Complexity is opt-in

The product grows naturally:

`Timer -> Queue -> Show -> Multi-Queue Show -> Event -> Multi-Room Event`

Users see only the concepts they need.

## 3. Queue is the source

A Queue contains the operational program. If an item has timer properties, it behaves as a timer. Notes, speaker metadata, scheduling and Actions enrich the same Queue Item.

An agenda is a Board/View over Queue data, never a duplicated agenda database.

## 4. Data != presentation

Queue Items and Show State are data/state.

Boards decide:

- source;
- filters;
- visible components;
- formatting/layout;
- audience.

The same live state can feed a Speaker Board, FOH, Stage Manager, backstage and public signage.

## 5. Flat before nested

Prefer one universal Queue Item with optional capabilities over a hierarchy of Session -> Cue -> Timer -> Note.

Groups provide intentional containment. Parallel Queues provide disciplinary lanes. Relationships provide synchronization without deep nesting.

## 6. Operator has final control

The product may calculate `+05:18 behind`, show the next fixed anchor and suggest recovery. It should not silently decide that the next speaker loses five minutes.

Automation is explicit, visible and configurable.

## 7. Live-show safety beats cleverness

- `STOP` does not mean `END`.
- A failed integration does not stop the timer engine.
- A lock can have a permission-gated emergency override.
- A short Wi-Fi outage does not blank a presenter timer.
- Reconnect does not apply stale client state over authoritative server state.

## 8. Defaults -> overrides

Use this precedence where applicable:

`Show -> Queue -> Queue Item`

The UI must expose when a value is inherited or overridden.

## 9. Prepare extension points, do not pre-build the future

V1 does not need OSC/Companion/QLab/MIDI or a free-form designer. Define clean contracts so they can be added without restructuring the timer core.

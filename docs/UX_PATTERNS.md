# KLOCKR UX patterns

Status: V1 interaction baseline

## 1. Operational calm

KLOCKR is used while people are speaking, shows are running and mistakes are visible. The UI should reduce surprise.

Use:

- stable spatial layout;
- clear current/next hierarchy;
- explicit confirmation of state-changing actions;
- incremental visual updates;
- persistent context.

Avoid:

- disappearing controls during state changes;
- full-screen loaders in live workflows;
- unexplained auto-navigation;
- rows teleporting due to schedule recalculation;
- silent changes to duration or next-item behavior.

## 2. Current, selected and running are different

These states must remain distinct:

- `selected`: user is inspecting/editing it;
- `current`: operational position/context;
- `running`: its timer/process is active.

A selected future item may not be current. A secondary timer may be running without being current.

## 3. Direct manipulation with safety

Master supports drag/drop and direct editing, but live-impacting changes need feedback.

When moving an item with linked items:

- show the relationship impact;
- offer move-linked-items behavior where appropriate;
- honor locks;
- preserve relative offsets when the relationship remains intact.

## 4. Live schedule shifts

When a timer change affects projected schedule:

- update schedule state immediately;
- visually mark affected future items;
- avoid abrupt large list movement while the operator is acting;
- expose pending/applied shift semantics when required by timing policy.

Strict mode reports deviation and leaves recovery to the operator.

Sliding mode may project shifted times, but the UI should still orient users to what changed.

## 5. Dangerous actions

Actions with potentially broad impact include:

- deleting active Show/Queue content;
- moving linked live items;
- Emergency Override;
- regenerating/revoking an active share token;
- ending an item when END triggers follow-up behavior.

Use confirmation proportional to risk. Do not add confirmation to every routine transport action; live operation must remain fast.

## 6. Keyboard-first live control

Operator workflows should support keyboard shortcuts for common actions once safe mappings are defined.

Requirements:

- shortcuts are discoverable;
- destructive/broad-impact shortcuts require deliberate combinations;
- shortcuts do not fire while typing into fields;
- focus state is visible;
- key bindings should be configurable later without rewriting command semantics.

## 7. Message workflow

Ad-hoc messages should be sendable in a few actions:

1. choose or enter message;
2. choose audience/Board destination;
3. send;
4. clear or auto-expire.

Common urgent messages may have presets, but they remain messages rather than Queue Items.

## 8. Board configuration

V1 should use constrained configuration rather than a free-form designer.

A user should be able to:

- start from a preset;
- toggle components;
- arrange within supported regions/order;
- adjust sizing;
- set branding/background;
- configure timer state appearance;
- choose data source/filter;
- configure low-light behavior.

The configuration experience should preview the Board without requiring a live event.

## 9. Speaker Board behavior

Speaker-facing Boards should prioritize distance readability and low distraction.

Normal state:

- white timer;
- dark background;
- minimal metadata.

At warning/critical thresholds, state becomes progressively clearer. Avoid using bright green for the whole timer in normal running state.

Urgent ad-hoc message can temporarily become the dominant element.

## 10. Offline/reconnect UX

If a Board disconnects briefly:

- keep rendering last authoritative timer state locally;
- show minimal reconnect state if configured;
- never blank the Board.

If Operator/Master disconnects:

- clearly indicate lost central command capability;
- do not fake command success;
- allow locally safe viewing;
- after reconnect, reconcile against authoritative state.

## 11. Anonymous Show lifecycle

Anonymous Shows should make expiry visible on management surfaces but not distract operational Boards.

Near expiry:

- show remaining time;
- offer Claim Show clearly;
- never delete a Show while it is actively in use.

## 12. Responsive priorities

KLOCKR is desktop-first for Master/Operator, but Boards are display-size agnostic.

- Master: optimized for large desktop/laptop displays.
- Operator: desktop/laptop, reasonable tablet support.
- Speaker/Public Boards: responsive from tablet to large confidence monitor/TV.
- Device pairing pages: mobile-friendly.

Do not collapse Master into an unusable mobile dashboard just to claim full responsiveness.

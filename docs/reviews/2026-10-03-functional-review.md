# Functional review — 2026-10-03

The functional design v0.1 received a constructive review. The following points were accepted and incorporated in v0.2.

## 1. Linked parallel Queues during live shifts

Concern: adding time to a live speaker in Sliding mode could cause linked Audio/Stage items to jump abruptly.

Resolution:

- live timer change updates actual timing state;
- whether future planning shifts depends on timing policy/operator action;
- UI must make changed/pending linked shifts explicit and calm;
- related items preserve offsets when a shift is applied.

## 2. Visibility of inherited/overridden settings

Concern: an unexpected warning state is dangerous if Operator cannot see that the item overrides Queue/Show defaults.

Resolution:

- effective configuration source must be visible;
- override indicator is generic across inherited settings;
- reset-to-inherited action should be available where permitted.

## 3. Locks in live emergencies

Concern: lock can block a live production when Master is unavailable.

Resolution:

- Request Unlock flow;
- permission-gated Emergency Override;
- explicit confirmation;
- audit event.

## 4. Anonymous Show deletion

Concern: silent 7-day expiry causes avoidable data loss/frustration.

Resolution:

- management UI shows expiry warning/Claim Show CTA;
- output Boards are not polluted with routine account warnings;
- cleanup never deletes an actively live Show at the exact expiry moment.

## 5. Offline robustness

Concern: a Speaker Board must not become useless during a five-second Wi-Fi drop.

Resolution:

- Board continues timer display from last authoritative state;
- no blocking spinner;
- connectivity indication appropriate to Board type;
- reconnect uses authoritative snapshot and controlled correction.

## 6. Board customization in V1

Concern: delaying the free designer must not make presets professionally restrictive.

Resolution:

V1 presets support meaningful component/layout/typography/branding/timer/data-source customization within safe constraints.

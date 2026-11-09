# Open questions / decisions still required

These questions are deliberately deferred. Claude must not silently invent product decisions when their implementation phase arrives.

## Product / naming

1. Production domain and final trademark/domain validation for KLOCKR.
2. Exact end-user vocabulary in each preset: `Queue`, `Cue List`, `Rundown`, etc.

## Timer UX

3. Reconfirm overtime adjustment semantics during UI prototype testing (`+30` at `+02:14` currently means `+02:44`).
4. Exact default transport increments per screen/device preset.
5. Default Quick Timer warning thresholds. **M1 uses a provisional default** taken from the FUNCTIONAL_DESIGN examples (warning at 05:00 remaining, critical at 01:00) — `PROVISIONAL_DEFAULT_THRESHOLDS` in `packages/domain/src/timer/phase.ts`. Consequence seen in M1: timers of 5 minutes or less are amber from their first second, and 1 minute or less red. Needs a product decision (e.g. percentage-based for short timers) before M2 inheritance.

## Scheduling

6. In Sliding mode, which live changes auto-apply projected shifts vs enter `SHIFT PENDING`?
7. Exact fixed-anchor overlap policy when preceding projected content reaches/passes the anchor.
8. Whether/where hard scheduled start is exposed in V1.

## Current/multi-queue model

9. Validate `current per Queue` plus primary Program Queue projection during the first multi-queue prototype.

## Anonymous lifecycle operations

10. Exact configured grace duration after nominal 7-day expiry once inactive.
11. Whether anonymous users may manually extend once without claiming.

## Auth implementation details

Product behavior is accepted: magic-link primary, social later, temporary role links supported. Remaining implementation choices:

12. Concrete auth library/provider.
13. Transactional email provider.
14. Whether passkeys/MFA enter MVP hardening or post-MVP.
15. Whether a formal account/team/workspace hierarchy is needed in MVP beyond scoped ownership/membership.

## Boards/assets

16. Exact constrained Board layout model (grid/slots/regions).
17. Whether custom logo/background uploads enter V1; if yes, select object storage.
18. Exact font customization limits.

## Devices

19. PWA/kiosk installation expectations for persistent Devices.
20. Device credential rotation/maximum offline validity policy.

## API

21. Final API scope presets and credential UX.
22. Public API rate limits.
23. Import/export (CSV/JSON) roadmap position; not currently committed to V1.

## Operations

Accepted: dedicated server, DEV/TST local/CI, ACC + PRD as separate Docker Compose projects, PostgreSQL in each Compose project, one realtime server/no Redis in V1, separate worker, build-once/promote-same-images.

Remaining:

24. ACC and PRD hostnames/domains.
25. Container registry/provider and image naming convention.
26. Reverse proxy choice/configuration if not already standardized on the dedicated server.
27. Backup destination, schedule, encryption and retention.
28. Log/audit retention periods.
29. Production RPO/RTO targets for claimed Shows.
30. Licensing/subscription/entitlement model.

## Raised during M0 (timer kernel) — all resolved in the M0 review (2026-11-09)

31. ~~START after STOP~~ — **Resolved:** START on a stopped timer restarts from the full configured duration (functionally RESTART); previous-run adjustments do not carry over. UI labels the action RESTART in stopped state. See `TIMER_ENGINE.md`.
32. ~~Adjustment crossing zero~~ — **Resolved:** adjustment may cross zero in both directions (`02:00 +00:30 -> 02:30`, `+00:10 -00:30 -> 00:20`, `+02:14 +00:30 -> +02:44`). Overtime stays derived.
33. ~~END on idle/stopped timer~~ — **Resolved** by separating Timer from Queue Item END: timer states are `idle | running | paused | stopped`; END / NEXT is a Queue Item / show-control command that may also apply to items without a timer or with a stopped timer. Introduced with Queue Items.

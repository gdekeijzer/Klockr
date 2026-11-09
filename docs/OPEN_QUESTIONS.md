# Open questions / decisions still required

These questions are deliberately deferred. Claude must not silently invent product decisions when their implementation phase arrives.

## Product / naming

1. ~~Production domain~~ — **Resolved (2026-11-09):** the canonical production / public domain is `klockr.live`. Trademark validation of the KLOCKR name remains a business task outside the repository.
2. Exact end-user vocabulary in each preset: `Queue`, `Cue List`, `Rundown`, etc.

## Timer UX

3. Reconfirm overtime adjustment semantics during UI prototype testing (`+30` at `+02:14` currently means `+02:44`).
4. Exact default transport increments per screen/device preset.
5. ~~Default Quick Timer warning thresholds~~ — **Resolved (2026-11-09):** KLOCKR defaults are percentage-based on the original configured duration: normal > 20 % remaining, warning <= 20 %, critical <= 5 %, overtime when remaining < 0 (overtime always dominates). Examples: 20:00 -> warning 04:00 / critical 01:00; 05:00 -> 01:00 / 00:15; 01:00 -> 00:12 / 00:03. Show -> Queue -> Queue Item inheritance follows in M2; absolute-time thresholds may be supported later. See `TIMER_ENGINE.md`.

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

24. ACC hostname/domain. (PRD resolved: `klockr.live`.)
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

## Raised during M2 (Queue operations) — all resolved in the M2 review (2026-11-09)

34. ~~Next after a backwards jump~~ — **Resolved:** `next` is the first Queue Item after Current that is active **and** not completed. Completed items are never offered as Next again, also not after the operator manually jumped back to an earlier item.
35. ~~Note items on the Speaker Board~~ — **Resolved for M2:** a standalone Note Queue Item (no timer) that is Current may show its Queue Item title (and subtitle) on the Speaker Board, without timer. The `notes` property of any Queue Item is operator/internal data and is never sent to the Speaker Board. Audience/visibility policies follow in M4.
36. ~~Group collapse state~~ — **Resolved:** collapsed/expanded is local UI state per browser; it is not part of authoritative Show State and is not persisted.
37. ~~"On previous END" in M2~~ — **Resolved:** `startMode = on_previous_end` belongs in M2 because END + NEXT may only start the next timer automatically when explicitly configured. It stays a plain Queue Item property; no extra object, type or hierarchy.

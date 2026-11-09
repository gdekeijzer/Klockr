# Open questions / decisions still required

These questions are deliberately deferred. Claude must not silently invent product decisions when their implementation phase arrives.

## Product / naming

1. Production domain and final trademark/domain validation for KLOCKR.
2. Exact end-user vocabulary in each preset: `Queue`, `Cue List`, `Rundown`, etc.

## Timer UX

3. Reconfirm overtime adjustment semantics during UI prototype testing (`+30` at `+02:14` currently means `+02:44`).
4. Exact default transport increments per screen/device preset.
5. Default Quick Timer warning thresholds.

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

## Raised during M0 (timer kernel)

31. Confirm START after STOP restarts from the full duration (current implementation) rather than continuing from the stopped value.
32. Confirm continuous overtime adjustment past zero (`-30` at `+00:10` -> `00:20` remaining).
33. Should END be allowed for an item whose timer is `idle` or `stopped` (e.g. ending a never-started item)? Currently rejected at the timer level; queue-level skip/end semantics belong to M2.

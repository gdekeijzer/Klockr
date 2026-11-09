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

6. In Sliding mode, which live changes auto-apply projected shifts vs enter `SHIFT PENDING`? — **M3 baseline:** every live change recalculates the projection immediately (calculate immediately, present calmly): rows never reorder, shifted items show a shift chip (projected vs planned) and an `UPDATED ±mm:ss` marker for a few seconds. No pending/apply step yet; revisit when linked queues arrive (M4/M5).
7. Exact fixed-anchor overlap policy when preceding projected content reaches/passes the anchor. — **M3 baseline:** the anchor keeps its planned time (never projected earlier); arriving late pushes the anchor's projected start; KLOCKR reports `mm:ss TO RECOVER` (risk, amber) while ending/skipping remaining items could still make it, and `ANCHOR MISSED` (red) when not. Nothing is shortened automatically.
8. Whether/where hard scheduled start is exposed in V1. — **M3:** not exposed. Only soft scheduled start (`startMode = scheduled`: `SHOULD HAVE STARTED mm:ss AGO`, never auto-started).

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

24. ~~ACC hostname/domain~~ — **Resolved:** ACC `https://acc.klockr.live`, PRD `https://klockr.live`.
25. ~~Container registry/provider and image naming~~ — **Resolved:** GHCR, `ghcr.io/gdekeijzer/klockr-{web,server,worker}`, tags `latest` + full Git SHA (published by GitHub Actions on `main`).
26. ~~Reverse proxy~~ — **Resolved:** no proxy container; an external Cloudflare Tunnel routes `/api/v1/*` and `/realtime/*` to the server port and everything else to the web port (`docs/DEPLOYMENT_UGREEN_ACC.md`).
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

## Raised during M3 (Scheduling + Master) — #41-42 resolved in the M3 review; #38-40 open

38. **Midnight.** Planned times are entered as HH:MM on one Show date in the Show timezone. Rundowns crossing midnight need a per-item date (not in the UI yet; the model stores absolute UTC instants, so this is a UI extension only).
39. **Request Unlock delivery.** Requests are persisted, shown on the lock and audited, but there is no notification channel (and with only the anonymous owner the requester and the lock owner are the same person). Decide the delivery/UX once role links/accounts exist.
40. **Who has `lock.override` without `lock.manage`?** The anonymous owner holds all lock capabilities. Override is fully permission-gated and audited (tested with a restricted actor), but a role that may override yet not unlock arrives only with role links/accounts.
41. ~~Strict when running ahead~~ — **Resolved (2026-11-10, M3 review):** in STRICT a Queue Item with an explicit Planned start is never projected earlier than that Planned start; when the production runs ahead this creates buffer/waiting time before it. Planned never changes. SLIDING may move future Projected starts earlier.
42. ~~Planned duration of timed items~~ — **Resolved (2026-11-10, M3 review):** for a Queue Item with a timer the configured timer duration is also its Planned duration. Live adjustments (+10, +30, -10, …) never change Planned duration; they only affect live/projected timing. A deliberate configuration edit of the timer duration is a planning edit and changes Planned duration (audited). Only items without a timer store a separate `plannedDurationMs`; timed items never have two competing duration values.

## Raised during M4 (Boards + Multi-Queue) — all resolved in the M4 review

43. ~~Hidden Current on a Board~~ — **Resolved (M4 review):** when the authoritative Current is not visible to the Board's audience the Board shows `STAND BY`. Never the hidden title, any metadata of the hidden item, a bare `—`, or the next visible item presented as Current. The projection carries only `standBy: true` (no item data); server-side audience filtering stays the security boundary. Presets may later get a configurable fallback text; the default is `STAND BY`.
44. ~~Timeline rendering of a CONFLICT~~ — **Resolved (M4 review):** a relation/schedule CONFLICT is a status of the affected item (dashed amber outline + `CONFLICT` label, LINK marker, linked time in the tooltip), never a second block over a Current item. The engine projects a linked item no earlier than the Show tolerance before the end of its predecessor in its own Queue; beyond that it is projected after the predecessor and flagged CONFLICT. Current, title and timing stay readable.
45. ~~Default sources of the Production preset~~ — **Resolved (M4 review):** Board source modes are `primary` (follows the Primary Queue), `all` (dynamic: every Queue, Queues added later appear automatically) and `selected` (an explicit selection; only that selection is followed). FOH / Production defaults to `all`; Speaker Confidence stays `primary`. Existing Boards keep their behaviour (migration `0006_board_source_mode`).
46. ~~Several Messages at once~~ — **Resolved (M4 review):** several Messages may be active at once (all are stored and manageable). A Board renders at most one dominant Message: filter by Board/audience → only active (not cleared, not expired) → highest priority → at equal priority the most recently created. When it is cleared or expires the next valid Message appears automatically, otherwise the normal layout returns.

## Raised during M5 (Events, Rooms & Devices) — open

47. **Anonymous Event lifetime.** Event management is bound to the creating browser via a cookie with the anonymous lifetime (8 days, like Show owners); Events themselves have no expiry/cleanup yet. Should anonymous Events get a longer lifetime, an explicit expiry, or require an account (M6) for multi-day events?
48. **"Current Show" of a Room.** The Central Agenda and Room View derive it (a Show with a running timer, else the first unfinished Show in display order). Should the operator be able to mark a Room's current Show explicitly?
49. **Event date entry.** The New Event form takes start/end in the browser's local time; the Event keeps one IANA timezone. Enter them in the Event timezone instead (relevant when planning remotely)?
50. **Device scope for Shows inside an Event.** Devices belong to the Event (or a standalone Show). When a standalone Show with its own Devices is attached to an Event, those Devices stay Show-scoped (still working and managed on the Show's Boards page; the Event's Device list shows only Event Devices). Move them into the Event scope automatically, or keep them separate?

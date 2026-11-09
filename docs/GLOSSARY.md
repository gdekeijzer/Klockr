# Glossary

**Action** — future outbound integration instruction triggered by a show/timer event.

**Actual runtime** — what really happened live: actual starts/ends/current timer state.

**Audience** — logical group of Boards/destinations such as Stage or Public.

**Baseline schedule** — planned reference times used to calculate deviation.

**Board** — configurable view/presentation over show data/state; not necessarily a physical device.

**Current** — operationally selected Queue Item for a specific Queue.

**Device** — persistent known client/display endpoint that can be assigned a Board.

**END** — marks an item operationally complete and may execute configured completion/next behavior.

**Event** — optional container for multi-show/multi-room production.

**Fixed anchor** — scheduled point intended to remain a reference even when earlier items drift.

**Group** — real container of Queue Items within a Queue.

**Master** — broad planning/management/live-control interface/permission profile.

**Message** — ad-hoc operational text pushed to Board audiences; separate from Queue content.

**Operator** — focused live-operation interface/role with less structural administration.

**Overtime** — countdown-derived condition after remaining time passes zero.

**Projected schedule** — current expected future timing after Sliding changes, separate from baseline.

**Queue** — ordered peer lane of operational Queue Items.

**Queue Item** — universal program/cue/note/timer-capable item.

**Relationship** — optional relative-time link between items in peer Queues.

**Room / Area** — optional physical/logical location for a Show.

**Show** — primary standalone operational object containing Queues and live state.

**Sliding / Free** — timing mode in which projected future times can move with drift.

**STOP** — stops a timer without semantically ending the Queue Item or triggering next behavior.

**Strict / Operator Controlled** — timing mode in which planned times remain reference and operator decides recovery.

---
description: Review the current change against KLOCKR rules
---

Review the current change against:

- `CLAUDE.md` §3 product principles, §5 architecture rules and §11 Definition of Done;
- `docs/FUNCTIONAL_DESIGN.md` for behavior;
- `docs/DESIGN_SYSTEM.md` / `docs/UI_COMPONENTS.md` for UI changes;
- accepted ADRs in `docs/adr/`.

Report concrete findings (file:line, what is wrong, why it matters), most severe first. Flag silent scope changes, STOP/END confusion, business rules outside the application/domain layers, role-name checks, persisted ticks, and missing tests or doc updates.

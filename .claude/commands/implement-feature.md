---
description: Implement a planned feature as the smallest coherent vertical slice
argument-hint: <feature or milestone>
---

Implement: $ARGUMENTS

Follow `CLAUDE.md` (architecture rules, §11 Definition of Done, §12 change discipline) and the milestone working pattern in `ROADMAP.md`.

- Implement domain/contracts/application first, then persistence/infrastructure, then API/realtime/UI only as the slice needs.
- All state changes go through `packages/application` commands.
- Add tests with a fake clock; no sleeps.
- Run `pnpm check` (and `pnpm test:integration` when the database is involved) and fix failures.
- Update the relevant docs and `PROJECT_STATUS.md` with facts.
- Stop at the milestone boundary.

## What and why

<!-- Behavior change and the requirement it implements (link the doc section). -->

## Checklist (`CLAUDE.md` §11 Definition of Done)

- [ ] Behavior matches `docs/FUNCTIONAL_DESIGN.md`
- [ ] Domain tests cover the important transitions and edge cases (fake clock, no sleeps)
- [ ] API/realtime contracts validated in `packages/contracts`
- [ ] Permission checks present (capabilities, not role names)
- [ ] Error/offline behavior considered
- [ ] Relevant docs and `PROJECT_STATUS.md` updated
- [ ] No TODO that silently changes product scope
- [ ] `pnpm check` passes

## Product decisions

<!-- New or changed product rules? Link the ADR / OPEN_QUESTIONS entry, or write "none". -->

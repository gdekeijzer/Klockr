# Contributing

## Ground rules

- Read `CLAUDE.md` before making changes.
- Product behavior comes from `docs/FUNCTIONAL_DESIGN.md` and accepted ADRs.
- Keep pull requests focused.
- Add tests with behavior changes.
- Update documentation in the same change when contracts or behavior change.
- Never commit secrets or real production credentials.

## Suggested branch naming

- `feat/<short-name>`
- `fix/<short-name>`
- `docs/<short-name>`
- `refactor/<short-name>`
- `chore/<short-name>`

## Commit guidance

Use concise imperative messages. Example:

`feat(timer): add pause/resume domain transition`

## Product decisions

When a change alters a product rule rather than merely implementing it, add/update an ADR in `docs/adr/` and update the functional/technical documentation.

## Definition of Done

See `CLAUDE.md` and `docs/ACCEPTANCE_CRITERIA.md`.

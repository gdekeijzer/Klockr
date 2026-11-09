---
description: Plan a feature before implementing it
argument-hint: <feature or milestone>
---

Plan: $ARGUMENTS

Follow `CLAUDE.md` §1 (read order) and §12 (change discipline). Do not write code yet.

Output a short plan containing:

1. where the requirement is in the docs (`docs/FUNCTIONAL_DESIGN.md` first);
2. intended behavior and affected domain objects (names from `docs/GLOSSARY.md`);
3. relevant ADRs and items in `docs/OPEN_QUESTIONS.md`;
4. files/packages to touch, keeping domain -> application -> contracts -> adapters -> UI order;
5. tests to add;
6. any ambiguity that needs a product decision (record it; do not invent it).

# KLOCKR design references

This folder contains design-system source material for Claude Code and human contributors.

## Source-of-truth order

1. `../DESIGN_SYSTEM.md`
2. `../UI_COMPONENTS.md`
3. `../UX_PATTERNS.md`
4. `../UI_REQUIREMENTS.md`
5. `tokens.json`
6. visual mockups in `assets/`

The images are references for direction and hierarchy. They are not pixel-perfect requirements and may contain illustrative labels/data that differ from the final product domain.

## Assets

- `assets/klockr-styleboard.png` — brand/look-and-feel direction
- `assets/klockr-operator-view.png` — focused live operator direction
- `assets/klockr-master-view.png` — dense planning/control direction
- `assets/klockr-board-mockups.png` — Speaker and Stage Manager Board direction

## Critical implementation note

Do not sample arbitrary colors from the PNG mockups. Use semantic values from `tokens.json` / `DESIGN_SYSTEM.md`.

In particular, the bright-green timer shown in some early mockups is not the normal Speaker Board default. Normal speaker-facing timer text is white/light gray; green remains a status signal unless a Board is explicitly configured otherwise.

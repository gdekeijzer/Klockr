# KLOCKR design system

Status: **approved visual direction for implementation**  
Scope: V1 product UI, Operator, Master and default Boards  
Last updated: 2026-11-08

This document is the visual source of truth for KLOCKR. It translates the approved dark FOH/control-room direction into implementable UI rules.

The reference mockups live in `docs/design/assets/`. They are **directional references**, not pixel-perfect implementation specifications. Product behavior and accessibility requirements take precedence over generated mockup details.

## 1. Design intent

KLOCKR should feel like professional live-production equipment translated into modern software:

- dark and calm;
- information-dense where required, never visually noisy;
- operational rather than decorative;
- readable at a glance under pressure;
- suitable for FOH, backstage and control-room environments;
- premium, precise and durable rather than fashionable;
- consistent from Quick Timer through multi-room Master View.

Primary visual references:

- industrial realtime control dashboards;
- timeline/lane-based operational interfaces;
- professional AV/broadcast control surfaces.

Avoid generic consumer SaaS styling, glassmorphism, decorative gradients, excessive card nesting and color used merely for decoration.

## 2. Core visual principle

> **Color communicates state; color is not decoration.**

Green, amber and red carry operational meaning. Do not use them as arbitrary branding accents.

Blue is the primary KLOCKR product/accent color and can be used for:

- selection;
- focus;
- navigation state;
- informational state;
- links;
- editable controls;
- neutral active emphasis.

The normal timer on a Speaker/Confidence Board should not be bright green by default. Normal timer text is white/light gray; state colors appear when timing state changes.

## 3. Color tokens

### 3.1 Foundation

| Token              | Hex       | Usage                                        |
| ------------------ | --------- | -------------------------------------------- |
| `bg.canvas`        | `#0B0B0D` | main application background                  |
| `bg.chrome`        | `#101114` | top bars, persistent chrome                  |
| `bg.surface`       | `#141418` | panels, navigation surfaces                  |
| `bg.surfaceRaised` | `#1A1D22` | raised cards, dialogs, active control groups |
| `bg.control`       | `#1F2126` | buttons, fields, queue rows                  |
| `bg.controlHover`  | `#262A31` | hover state                                  |
| `border.subtle`    | `#2B2F36` | default panel/control border                 |
| `border.strong`    | `#3A4049` | stronger separation, selected neutral state  |
| `text.primary`     | `#F5F7FA` | primary text and normal speaker timer        |
| `text.secondary`   | `#9AA0A6` | labels, metadata                             |
| `text.muted`       | `#6F7680` | disabled/low-priority information            |

### 3.2 Product accent

| Token               | Hex       | Usage                                    |
| ------------------- | --------- | ---------------------------------------- |
| `accent.blue`       | `#3B82F6` | primary accent, information, selection   |
| `accent.blueStrong` | `#1D9BF0` | selected edges/high-emphasis information |
| `accent.blueDim`    | `#0C3151` | selected row/background tint             |

### 3.3 Operational states

| Token            | Hex       | Meaning                                     |
| ---------------- | --------- | ------------------------------------------- |
| `state.ok`       | `#22C55E` | running, connected, on time, confirmed      |
| `state.warning`  | `#F59E0B` | warning, nearing threshold, attention       |
| `state.critical` | `#EF4444` | critical, overtime, destructive/error state |
| `state.offline`  | `#9AA0A6` | disconnected / unknown where not critical   |

Where possible, use a dimmed state background plus a brighter foreground/border rather than filling large areas with saturated color.

### 3.4 State color rules

- Normal / neutral timer: `text.primary`.
- Running status indicator: `state.ok`; do not automatically color the entire timer green.
- Warning timer: `state.warning` where configured.
- Critical/overtime timer: `state.critical`.
- Informational/selected/current item: `accent.blue`.
- Disabled controls: muted gray, not low-opacity saturated color.
- Never rely on color alone; combine with label/icon/shape.

## 4. Typography

### Primary UI font

**Inter**

Use for:

- navigation;
- labels;
- queue rows;
- panels;
- buttons;
- dialog content;
- headings.

Recommended weights:

- 400 Regular — body/metadata;
- 500 Medium — controls/labels;
- 600 Semibold — current/next, panel headings;
- 700 Bold — key operational headings.

### Numeric / technical font

**Roboto Mono** or an equivalent open-source monospace font approved at implementation time.

Use selectively for:

- timers;
- clock/timecode values;
- exact offsets;
- technical identifiers when alignment helps.

Do not set the whole interface in monospace.

### Logo

The KLOCKR wordmark shown in the visual references is a **brand direction**, not a requirement to reproduce it using a particular UI font. Production logo artwork should be stored as an SVG asset once finalized. Do not approximate the wordmark with a random italic system font.

## 5. Type scale

Baseline desktop scale:

| Role            |               Size |  Weight | Notes                  |
| --------------- | -----------------: | ------: | ---------------------- |
| Micro metadata  |            11–12px |     500 | uppercase sparingly    |
| Label           |            12–13px | 500/600 | controls/table headers |
| Body            |               14px | 400/500 | default app text       |
| Strong body     |            15–16px |     600 | current/next labels    |
| Panel title     |            16–18px |     600 | operational panels     |
| Section heading |            20–24px | 600/700 | sparse use             |
| Operator timer  |           88–160px | 600/700 | responsive             |
| Speaker timer   | 20–32vw equivalent | 600/700 | distance-first sizing  |

For timers, legibility wins over strict scale tokens.

## 6. Spacing and density

Use a 4px base grid.

Preferred spacing tokens:

- `space.1 = 4px`
- `space.2 = 8px`
- `space.3 = 12px`
- `space.4 = 16px`
- `space.5 = 20px`
- `space.6 = 24px`
- `space.8 = 32px`
- `space.10 = 40px`

KLOCKR is allowed to be information-dense in Master View. Density must come from disciplined spacing and hierarchy, not tiny text.

Operator View should be less dense and favor touch/click confidence.

## 7. Radius, borders and elevation

- Standard control radius: 6px.
- Standard panel radius: 8px.
- Large board/presentation panel radius: 10–12px.
- Pills/chips may use full radius.
- Borders are preferred over heavy shadows.
- Use shadows sparingly; KLOCKR is a control interface, not a floating-card consumer app.
- Selected/current states may add a subtle blue edge or inset highlight.
- Avoid strong glow effects in production UI; mockup glow is illustrative only.

## 8. Icons

Use one coherent outline icon family throughout the application.

Rules:

- icons supplement labels for important live actions;
- destructive/ambiguous actions require text or tooltip;
- transport controls may use familiar media symbols but `STOP`, `END/NEXT`, and `NEXT ITEM` must remain semantically distinct;
- never use icon color alone to distinguish safety-critical states.

## 9. Button hierarchy

### Primary operational action

Examples: START, RESUME, GO LIVE.

- clear high-contrast button;
- state-aware color where meaningful;
- large enough for quick live use.

### Secondary action

Examples: +30, -30, share, filter.

- charcoal control background;
- subtle border;
- blue focus/selection.

### Destructive action

Examples: delete, emergency destructive change.

- red is reserved for actual destructive/critical meaning;
- require confirmation where live consequences are significant.

### STOP vs END/NEXT

Never make these visually interchangeable.

- STOP = stop timer only;
- END/NEXT = finish operational item and execute configured transition behavior.

Their labels and icons must make the difference obvious.

## 10. Timer visual states

A timer has visual state independent of whether it is running.

### Normal

- timer digits: `text.primary`;
- progress: neutral or subtle product accent;
- running indicator may be green separately.

### Warning

- timer digits or state rail: amber depending on Board configuration;
- optional warning label/icon;
- do not flash by default.

### Critical

- timer digits/state rail: red;
- clear CRITICAL / time-state signal where appropriate.

### Overtime

- red timer;
- display positive elapsed overtime (`+00:14` etc.);
- optional flash after configurable delay;
- flashing must be configurable per Board and should not be the default for all overtime states.

### Paused

- timer remains highly legible;
- use explicit `PAUSED` label/icon;
- avoid making it look disconnected/offline.

## 11. Speaker / Confidence Board defaults

Default styling is deliberately calmer than Operator/Master.

Default normal state:

- background: near-black;
- timer: white/light gray;
- current title/speaker: white/secondary gray;
- progress bar: restrained blue or neutral;
- no decorative green wash.

Default transitions:

- warning: amber;
- critical: red;
- overtime: red;
- flash: off by default; configurable;
- message override (e.g. `WRAP UP`): high-contrast, deliberate, temporary.

The Board must offer a **low-light/stage-safe configuration** so large displays do not become unnecessarily bright on dark stages.

## 12. Low-light / stage-safe mode

Low-light mode is a Board presentation setting, not a change to Show State.

It may adjust:

- maximum text luminance;
- progress brightness;
- accent saturation;
- background level;
- warning/critical intensity while retaining readability.

It must **not** change semantic state or thresholds.

Do not implement low-light by globally applying CSS opacity to the entire Board; preserve contrast and accessibility.

## 13. Operator View visual hierarchy

Operator View should prioritize, in order:

1. current timer;
2. current item;
3. next item;
4. transport / timer adjustment;
5. queue/rundown;
6. schedule status;
7. connection and override warnings.

Operator should not feel like a configuration dashboard.

The current timer is visually dominant. Current item and next item are clearly separated. Queue rows are compact but readable. Active/running/current are related concepts and must not be conflated solely through one color.

## 14. Master View visual hierarchy

Master View may be dense.

Primary zones:

- event/show tree;
- central timeline/list workspace;
- inspector/detail panel;
- global event/status header.

Master supports planning and live control, so the design must distinguish planning changes from live runtime state.

Parallel Queues should use consistent lane labels and optional discipline colors. Discipline colors are identifiers, not timer state colors; they must not conflict with green/amber/red operational state semantics.

## 15. Queue rows and timeline items

Queue row should support, where relevant:

- drag handle;
- item number/order;
- preset/type indicator;
- title;
- duration;
- target/planned start/end;
- status;
- link/relationship marker;
- lock marker;
- override marker;
- warning/conflict marker.

Current, selected and running states must be distinguishable:

- selected = blue UI selection;
- running = green status indicator/chip;
- current = explicit current marker/label or structured highlight;
- warning/critical = amber/red status;
- locked = lock icon/state, not color-only.

## 16. Inheritance / override visual language

Any field that can inherit from Show -> Queue -> Queue Item must expose its source.

Recommended pattern:

- inherited field: subtle source label such as `Queue default`;
- overridden field: compact override marker/icon;
- details/tooltip: effective source and value;
- action: `Reset to inherited` where permitted.

An operator must be able to understand why a warning threshold differs from expectation.

## 17. Connectivity state

### Operator / Master

Connection state must be visible:

- connected;
- reconnecting;
- offline;
- stale/uncertain if applicable.

### Speaker/Public Board

Connectivity signal should be unobtrusive and must not replace the running display during a brief disconnect.

Do not show a full-screen loader over a previously synchronized live Board.

## 18. Motion and transitions

Motion should orient the user, not entertain.

Use motion for:

- current/next transition;
- queue insert/move confirmation;
- schedule shifts;
- realtime state updates;
- temporary message appearance/removal.

Avoid:

- decorative looping animation;
- large bouncing indicators;
- abrupt list teleporting when a sliding schedule changes.

When future items shift, show a calm changed/pending state and preserve user orientation.

## 19. Accessibility and live-use ergonomics

- Meet WCAG contrast where applicable.
- Critical state must never rely on color alone.
- Keyboard access is expected for Operator/Master V1 workflows.
- Focus states must be visible in dark mode.
- Click/touch targets for live controls should generally be >= 40px high, preferably 44–48px for primary controls.
- Avoid tiny destructive icons without confirmation/tooltip.
- Respect reduced-motion preference for non-essential motion.
- Flashing must be opt-in/configurable and must avoid unsafe high-frequency flashing.

## 20. Reference assets

- `docs/design/assets/klockr-styleboard.png`
- `docs/design/assets/klockr-operator-view.png`
- `docs/design/assets/klockr-master-view.png`
- `docs/design/assets/klockr-board-mockups.png`

These assets define direction and hierarchy. They do not override the functional design, data model, accessibility rules or component behavior documented elsewhere.

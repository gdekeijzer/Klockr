# Boards and audiences

## Principle

A Board is a presentation configuration, not a second copy of show data and not necessarily a physical display.

## Data source

A Board may select/filter data by combinations such as:

- Event;
- Room;
- Show;
- one or more Queues;
- tags;
- visibility/audience;
- current/next/running state.

An Agenda Board is simply one useful presentation of data.

## V1 Board presets

At minimum plan useful presets for:

- Speaker Confidence;
- Stage Manager;
- FOH / production overview;
- Backstage;
- Room Agenda;
- Central Agenda;
- Public Signage;
- Event/Production overview.

## V1 customization

V1 is not a free-form design tool, but presets must not be rigid.

At minimum support configuration of:

- visible components;
- component order/position inside a constrained layout/grid;
- typography/size within safe limits;
- labels;
- logo/background;
- timer appearance;
- progress indicator;
- data source/filtering.

## Typical components

- Timer;
- current title;
- presenter/speaker;
- subtitle;
- next item;
- wall clock;
- ad-hoc message area;
- progress bar/ring;
- schedule offset;
- running timer list;
- logo/branding.

## Audiences

Boards can be members of logical Audiences such as:

- Stage;
- Production;
- Backstage;
- Public;
- Broadcast.

Queue Item visibility and Messages can target Audiences rather than hardcoding specific device names.

## Ad-hoc messages

Urgent operational text such as `AFRONDEN` is a Message, not a Queue Item.

A Message includes:

- content;
- destinations/audiences;
- priority/type;
- created timestamp;
- optional auto-expiry;
- manual clear state.

Regular planned textual content belongs in Queue Items/Notes.

## Offline behavior

Already-open display Boards keep rendering the last authoritative live timer locally during brief disconnects. Public/presenter outputs should avoid intrusive technical error screens. See `REALTIME_OFFLINE.md`.

## Implementation (M4)

- **Board configuration** (`packages/domain/src/board/board.ts`): `preset`, `name`, `audience`, `sources` (`primary` = follow the Primary Queue, or an explicit list of Queues), ordered `components` (`message, current_title, subtitle, timer, progress, next_item, wall_clock, show_offset, queue_current_next, running_timers, agenda, anchor, notes`) each with `enabled`, `size` and (for lists) `upcoming`, and `presentation` (`lowLight`, `showTimes`). Seven presets: Speaker Confidence (stage), Stage Manager (backstage), FOH / Production (production), Backstage, Room Agenda (public), Public Agenda / Signage (public), Custom. Presets only differ in configuration; one generic renderer draws them. No free canvas.
- **Boards page** (`/show/<id>/boards`): list, create from preset, live preview (the exact scoped projection a token receives), constrained configuration (name, audience, sources, components on/off, size, order, low-light), read-only share link per Board, delete.
- **Audiences:** `stage, production, backstage, public, broadcast`. A Queue Item's `visibility` is `null` (all audiences) or an explicit list; notes are published only to the audiences in `notesAudiences` (default none) **and** only on a Board with the Notes component.
- **Scoped projection** (`toBoardSnapshot`, server-side): only the Board's source Queues, only items visible to its audience, only enabled components' data (e.g. no upcoming items without Next/Agenda/Queue components), only Messages for its audience or id, no audit, no locks detail, no management metadata. A hidden Current renders as "—" without timer.
- **Messages** (`message.send / clear`): not Queue Items. Text ≤ 120 characters, audiences and/or Board ids, `normal | urgent`, optional TTL. Boards render the newest highest-priority active message as an overlay above a compact timer; expiry is evaluated locally (also while disconnected). Presets (WRAP UP, STOP, 5 MIN, THANK YOU) are UI shortcuts only.

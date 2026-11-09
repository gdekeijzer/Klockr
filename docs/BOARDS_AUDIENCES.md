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

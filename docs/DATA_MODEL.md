# Persistence/data model — conceptual

This is an implementation-oriented model, not a final migration file.

## Persistent configuration entities

Suggested relational entities:

- `users`
- `accounts` / account membership as required by chosen auth model
- `events`
- `rooms`
- `shows`
- `queues`
- `queue_groups`
- `queue_items`
- `queue_item_relations`
- `tags` / `queue_item_tags`
- `boards`
- `board_components` or structured Board config
- `audiences`
- `board_audiences`
- `devices`
- `device_assignments` / current Board assignment
- `share_grants`
- `role_definitions`
- `permissions`
- scoped role/permission assignments
- `locks`
- `audit_events`
- `api_credentials` when external API is enabled
- `access_grants` / typed grant records for anonymous management, temporary role links and Board sharing
- `magic_link_challenges` or equivalent short-lived authentication challenges
- `platform_support_audit` may be represented in the common audit event model

Future:

- `actions`
- `integration_connections`
- `local_agents`

## Runtime Show State

Do not model a running timer as a row updated every second.

Persist/broadcast transition state such as:

- Queue current pointer;
- timer state/timestamps/adjustment;
- live Messages;
- Show revision;
- actual start/end timestamps;
- applied projected scheduling decisions.

Whether runtime state is stored in dedicated tables, event rows, cache or a hybrid is an implementation decision. The domain contract remains the same.

## Queue Item suggested columns/concepts

- id;
- queue_id;
- group_id nullable;
- order key;
- preset/type hint (UI convenience only);
- title/subtitle/description;
- notes;
- speaker metadata;
- active/skip status;
- scheduled start/end;
- duration;
- fixed anchor;
- timer enabled/config;
- start mode/config;
- end behavior/config;
- override config;
- visibility metadata;
- created/updated/version.

Flexible config can use typed JSON where it avoids schema churn, but do not turn the entire domain into unvalidated JSON blobs.

## Schedule representation

Preserve enough information to distinguish:

- baseline schedule;
- projected schedule;
- actual timestamps.

Do not overwrite baseline values merely because a Sliding projection moved.

## Relations

`queue_item_relations` should support at least:

- source/related item;
- anchor item;
- relative offset milliseconds;
- relationship policy/status;
- timestamps/version.

## Board configuration

V1 Board layout can be stored as a versioned typed configuration document because component composition is naturally variable. Validate it with shared schemas and include a schema version.

## Tokens

Do not store raw long-lived secret tokens when a hashed-token approach is practical. Pairing codes are short-lived and separate from persistent device credentials.

## Credential/grant persistence

Model credential _type_, scope, lifecycle and revocation explicitly. Do not overload one token table semantically without validation.

Relevant grant families include:

- anonymous Show management;
- temporary role access;
- Board share;
- Device credential;
- API credential.

Prefer hashes of long-lived opaque secrets where practical. Short-lived pairing and magic-link challenges are separate from persistent credentials.

## Anonymous lifecycle

Show stores ownership/lifecycle state sufficient to identify:

- anonymous/unclaimed;
- claimed/owned;
- expiry timestamp/policy;
- active-use protection during cleanup.

## Implemented tables (M1, migration `0001_quick_timer`)

| Table | Contents |
| --- | --- |
| `shows` | id, title, ownership (`anonymous`), primary_queue_id, created_at, last_active_at, expires_at (created + 7 days; cleanup eligibility) |
| `queues` | id, show_id, name, purpose (`program`), position |
| `queue_items` | id, queue_id, title, position |
| `item_timers` | Timer capability per Queue Item: mode, status (`idle/running/paused/stopped`), duration_ms, adjustment_ms, started_at, paused_at, paused_total_ms, stopped_at, revision, updated_at. No overtime column; no ticks |
| `boards` | id, show_id, preset (`speaker`), created_at |
| `access_grants` | id, kind (`anonymous_owner`/`board_share`), show_id, board_id (required iff board_share), token_hash (unique), created_at, expires_at, revoked_at |
| `idempotency_records` | (scope, key) -> fingerprint, result JSON |

Timer writes are compare-and-set on `revision`. All child rows cascade on Show deletion (for the future cleanup worker).

## Implemented in M2 (migration `0002_queue_operations`)

| Table | Change |
| --- | --- |
| `shows` | + `warning_rule` jsonb, default `{"kind":"percent","warningPercent":20,"criticalPercent":5}` (Show default thresholds) |
| `queues` | + `current_item_id` (FK `queue_items`, on delete set null), `warning_rule` jsonb null (Queue override), `revision` int (aggregate compare-and-set) |
| `queue_groups` (new) | id, queue_id (cascade), title, position, created_at, updated_at. One level only |
| `queue_items` | + `group_id` (FK `queue_groups`, cascade), `subtitle`, `notes`, `tags` text[], `active`, `completed_at`, `start_mode` (`manual`/`on_previous_end`), `warning_rule` jsonb null (Item override), `created_at`, `updated_at`, `revision` |

No `next` column: next is derived. No separate tables for Speaker/Note/Break: presets fill the same `queue_items` row. The migration also sets `current_item_id` of existing M1 Quick Timer Queues to their single item.

Writes go through `PgShowStore.saveQueue(prev, next)`: one transaction that claims the Queue revision (compare-and-set), then writes only what differs (groups, items by item revision, timers with per-timer compare-and-set), removes deleted rows and finally updates the current pointer. Any lost race rolls back everything.

## Implemented in M3 (migrations `0003_scheduling_locks`, `0004_audit_sequence`)

| Table | Change |
| --- | --- |
| `shows` | + `timing_mode` (`strict`/`sliding`, default strict), `time_zone` (IANA, default UTC), `schedule_date` (YYYY-MM-DD), `tolerance_ms` (30000), `severe_behind_ms` (300000) |
| `queues` | + `timing_mode` null (Queue override) |
| `queue_items` | + `planned_start_at` (explicit only), `planned_duration_ms` (untimed items), `fixed_anchor`, `actual_start_at`, `actual_end_at`; `start_mode` adds `scheduled` |
| `locks` (new) | id, show_id, queue_id, target_kind (`show/queue/group/item`), target_id (unique per target), locked_at, locked_by_kind/id |
| `unlock_requests` (new) | id, show_id, queue_id, lock_id, target, requested_at, requested_by, reason, resolved_at (kept for history) |
| `audit_events` (new) | id, seq (identity, stable order), show_id, at, actor_kind/id, action, resource_kind/id, details jsonb |

Not stored: chained planned times, projected times, offsets, statuses, recovery, warnings (all derived by the domain engine). Locks, requests and audit records are written in the same `saveQueue` transaction as the change.

## Implemented in M4 (migration `0005_multi_queue_boards`)

- `shows.revision` — Show-level compare-and-set token for the whole Show aggregate.
- `queues.discipline` (free text, e.g. Program/Audio/Lighting) and `position`; the legacy `purpose` column is kept with default `program` (no longer used).
- `queue_items.visibility text[]` (NULL = all audiences) and `notes_audiences text[]` (default empty).
- `boards`: `name`, `audience`, `follow_primary`, `components jsonb`, `presentation jsonb`, `revision`, `updated_at`; checks on preset and audience. Data migration: existing `speaker` Boards become `speaker_confidence` / "Speaker Board" / `stage`; Queues get discipline `Program`.
- `board_sources (board_id, queue_id, position)` for explicit sources.
- `item_relations` (source/target item, offset, preserve_offset, active), `queue_suggestions` (pending/accepted/ignored/stale with the target Current at creation) and `messages` (text, audiences, board_ids, priority, expires_at).
- Migration `0006_board_source_mode`: `boards.source_mode` (`primary | all | selected`, check constraint, default `primary`); existing Boards with `follow_primary = false` become `selected`, all others stay `primary`. `follow_primary` is legacy and kept consistent on write.
- `saveShowAggregate` writes the full diff (Queues, Groups, Items, timers with per-timer CAS, relations, suggestions, Boards, sources, Messages, locks, unlock requests, audit) in one transaction guarded by `shows.revision`.

## Implemented in M5 (migration `0007_events_rooms_devices`)

Additive only (safe for ACC: no drops, no resets; every existing row satisfies the new checks).

- `events` (name, description, starts/ends, time_zone, status, details_revision, revision = Event aggregate CAS) and `rooms` (event_id, name, description, position, status, revision; unique `(event_id, id)`).
- `shows.event_id` / `room_id` / `event_position` with check "room needs event" and composite FK `(event_id, room_id) → rooms(event_id, id)`; existing Shows keep both null (standalone).
- `event_locks` (event/room targets).
- `boards.show_id` nullable + `boards.event_id` + `source_room_id`; check: exactly one owner; source modes add `room`, `event`.
- `access_grants.show_id` nullable + `event_id` + `label`; kind adds `anonymous_event_owner`; check: exactly one scope.
- `audit_events.show_id` nullable + `event_id`; check: at least one scope.
- `devices` (scope event XOR show, name, assigned_board_id → boards ON DELETE SET NULL, unique credential_hash, created/last_seen/revoked, revision) and `device_pairings` (code_hash, unique secret_hash, status pending/paired/claimed, device_id, expires/paired/claimed).
- Tested: a database migrated to 0006 and filled with M4-shaped rows upgrades to 0007 with Shows standalone, timers/revisions, Boards, grants (owner + share tokens) and audit intact (`packages/db/src/event.integration.test.ts`).

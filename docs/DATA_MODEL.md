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

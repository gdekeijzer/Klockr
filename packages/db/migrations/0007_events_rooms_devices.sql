CREATE TABLE "event_locks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"locked_at" timestamp (3) with time zone NOT NULL,
	"locked_by_kind" text NOT NULL,
	"locked_by_id" text NOT NULL,
	CONSTRAINT "event_locks_target_kind_check" CHECK ("event_locks"."target_kind" in ('event', 'room'))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"starts_at" timestamp (3) with time zone,
	"ends_at" timestamp (3) with time zone,
	"time_zone" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"details_revision" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "events_status_check" CHECK ("events"."status" in ('draft', 'active', 'completed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rooms_status_check" CHECK ("rooms"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "device_pairings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" text NOT NULL,
	"device_id" uuid,
	"created_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"paired_at" timestamp (3) with time zone,
	"claimed_at" timestamp (3) with time zone,
	CONSTRAINT "device_pairings_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "device_pairings_status_check" CHECK ("device_pairings"."status" in ('pending', 'paired', 'claimed'))
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid,
	"show_id" uuid,
	"name" text NOT NULL,
	"assigned_board_id" uuid,
	"credential_hash" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "devices_credential_hash_unique" UNIQUE("credential_hash"),
	CONSTRAINT "devices_scope_check" CHECK (("devices"."event_id" is null) <> ("devices"."show_id" is null))
);
--> statement-breakpoint
ALTER TABLE "access_grants" DROP CONSTRAINT "access_grants_kind_check";--> statement-breakpoint
ALTER TABLE "boards" DROP CONSTRAINT "boards_source_mode_check";--> statement-breakpoint
ALTER TABLE "access_grants" ALTER COLUMN "show_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "show_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ALTER COLUMN "show_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "access_grants" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "access_grants" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "source_room_id" uuid;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "event_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_locks" ADD CONSTRAINT "event_locks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairings" ADD CONSTRAINT "device_pairings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_assigned_board_id_boards_id_fk" FOREIGN KEY ("assigned_board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_locks_target_uq" ON "event_locks" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_event_id_uq" ON "rooms" USING btree ("event_id","id");--> statement-breakpoint
CREATE INDEX "rooms_event_idx" ON "rooms" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "device_pairings_code_idx" ON "device_pairings" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "devices_event_idx" ON "devices" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "devices_show_idx" ON "devices" USING btree ("show_id");--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_source_room_id_rooms_id_fk" FOREIGN KEY ("source_room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_event_room_fk" FOREIGN KEY ("event_id","room_id") REFERENCES "public"."rooms"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_grants_event_idx" ON "access_grants" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "audit_events_event_at_idx" ON "audit_events" USING btree ("event_id","at");--> statement-breakpoint
CREATE INDEX "boards_event_idx" ON "boards" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "shows_event_idx" ON "shows" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_owner_check" CHECK (("access_grants"."show_id" is null) <> ("access_grants"."event_id" is null));--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_kind_check" CHECK ("access_grants"."kind" in ('anonymous_owner', 'anonymous_event_owner', 'board_share'));--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_scope_check" CHECK ("audit_events"."show_id" is not null or "audit_events"."event_id" is not null);--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_check" CHECK (("boards"."show_id" is null) <> ("boards"."event_id" is null));--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_source_mode_check" CHECK ("boards"."source_mode" in ('primary', 'all', 'selected', 'room', 'event'));--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_room_needs_event_check" CHECK ("shows"."room_id" is null or "shows"."event_id" is not null);
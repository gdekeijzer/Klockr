CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"show_id" uuid NOT NULL,
	"at" timestamp (3) with time zone NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"show_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"locked_at" timestamp (3) with time zone NOT NULL,
	"locked_by_kind" text NOT NULL,
	"locked_by_id" text NOT NULL,
	CONSTRAINT "locks_target_kind_check" CHECK ("locks"."target_kind" in ('show', 'queue', 'group', 'item'))
);
--> statement-breakpoint
CREATE TABLE "unlock_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"show_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	"lock_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"requested_at" timestamp (3) with time zone NOT NULL,
	"requested_by_kind" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"reason" text,
	"resolved_at" timestamp (3) with time zone,
	CONSTRAINT "unlock_requests_target_kind_check" CHECK ("unlock_requests"."target_kind" in ('show', 'queue', 'group', 'item'))
);
--> statement-breakpoint
ALTER TABLE "queue_items" DROP CONSTRAINT "queue_items_start_mode_check";--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "planned_start_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "planned_duration_ms" bigint;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "fixed_anchor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "actual_start_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "actual_end_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "queues" ADD COLUMN "timing_mode" text;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "timing_mode" text DEFAULT 'strict' NOT NULL;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "schedule_date" text;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "tolerance_ms" integer DEFAULT 30000 NOT NULL;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "severe_behind_ms" integer DEFAULT 300000 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locks" ADD CONSTRAINT "locks_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locks" ADD CONSTRAINT "locks_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_requests" ADD CONSTRAINT "unlock_requests_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_requests" ADD CONSTRAINT "unlock_requests_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_show_at_idx" ON "audit_events" USING btree ("show_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "locks_target_uq" ON "locks" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "locks_queue_idx" ON "locks" USING btree ("queue_id");--> statement-breakpoint
CREATE INDEX "unlock_requests_queue_idx" ON "unlock_requests" USING btree ("queue_id");--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_start_mode_check" CHECK ("queue_items"."start_mode" in ('manual', 'on_previous_end', 'scheduled'));--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_timing_mode_check" CHECK ("queues"."timing_mode" is null or "queues"."timing_mode" in ('strict', 'sliding'));--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_timing_mode_check" CHECK ("shows"."timing_mode" in ('strict', 'sliding'));
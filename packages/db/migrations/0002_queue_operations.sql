CREATE TABLE "queue_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "subtitle" text;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "completed_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "start_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "warning_rule" jsonb;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "created_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "queues" ADD COLUMN "current_item_id" uuid;--> statement-breakpoint
ALTER TABLE "queues" ADD COLUMN "warning_rule" jsonb;--> statement-breakpoint
ALTER TABLE "queues" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "warning_rule" jsonb DEFAULT '{"kind":"percent","warningPercent":20,"criticalPercent":5}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_groups" ADD CONSTRAINT "queue_groups_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queue_groups_queue_idx" ON "queue_groups" USING btree ("queue_id");--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_group_id_queue_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."queue_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_current_item_id_queue_items_id_fk" FOREIGN KEY ("current_item_id") REFERENCES "public"."queue_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queue_items_group_idx" ON "queue_items" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_start_mode_check" CHECK ("queue_items"."start_mode" in ('manual', 'on_previous_end'));--> statement-breakpoint
-- Data migration (hand-written): M1 Quick Timer Shows have exactly one item; make it current so
-- existing Shows stay operable exactly as before.
UPDATE "queues" AS q SET "current_item_id" = (
	SELECT i."id" FROM "queue_items" AS i WHERE i."queue_id" = q."id" ORDER BY i."position" LIMIT 1
) WHERE q."current_item_id" IS NULL;

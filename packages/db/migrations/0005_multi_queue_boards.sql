CREATE TABLE "board_sources" (
	"board_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "board_sources_board_id_queue_id_pk" PRIMARY KEY("board_id","queue_id")
);
--> statement-breakpoint
CREATE TABLE "item_relations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"show_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"target_item_id" uuid NOT NULL,
	"offset_ms" bigint NOT NULL,
	"preserve_offset" boolean NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"show_id" uuid NOT NULL,
	"text" text NOT NULL,
	"audiences" text[] NOT NULL,
	"board_ids" uuid[] NOT NULL,
	"priority" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"cleared_at" timestamp (3) with time zone,
	CONSTRAINT "messages_priority_check" CHECK ("messages"."priority" in ('normal', 'urgent'))
);
--> statement-breakpoint
CREATE TABLE "queue_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"show_id" uuid NOT NULL,
	"relation_id" uuid NOT NULL,
	"source_queue_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"target_queue_id" uuid NOT NULL,
	"target_item_id" uuid NOT NULL,
	"target_current_at_creation" uuid,
	"created_at" timestamp (3) with time zone NOT NULL,
	"status" text NOT NULL,
	"resolved_at" timestamp (3) with time zone,
	CONSTRAINT "queue_suggestions_status_check" CHECK ("queue_suggestions"."status" in ('pending', 'accepted', 'ignored', 'stale'))
);
--> statement-breakpoint
ALTER TABLE "queues" ALTER COLUMN "purpose" SET DEFAULT 'program';--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "name" text DEFAULT 'Speaker Board' NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "audience" text DEFAULT 'stage' NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "follow_primary" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "components" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "presentation" jsonb DEFAULT '{"lowLight":false,"showTimes":true}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "visibility" text[];--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "notes_audiences" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "queues" ADD COLUMN "discipline" text;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "board_sources" ADD CONSTRAINT "board_sources_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_sources" ADD CONSTRAINT "board_sources_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_relations" ADD CONSTRAINT "item_relations_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_relations" ADD CONSTRAINT "item_relations_source_item_id_queue_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."queue_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_relations" ADD CONSTRAINT "item_relations_target_item_id_queue_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."queue_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_suggestions" ADD CONSTRAINT "queue_suggestions_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_relations_show_idx" ON "item_relations" USING btree ("show_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_relations_pair_uq" ON "item_relations" USING btree ("source_item_id","target_item_id");--> statement-breakpoint
CREATE INDEX "messages_show_idx" ON "messages" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "queue_suggestions_show_status_idx" ON "queue_suggestions" USING btree ("show_id","status");--> statement-breakpoint
-- Data migration (hand-written, backward compatibility): the existing Program Queue stays the
-- Show's Primary Queue (shows.primary_queue_id is unchanged); it gets the discipline label
-- "Program". Every existing M1 Speaker Board becomes a Speaker Confidence Board for audience Stage
-- following the Primary Queue (follow_primary defaults to true); its share grants (and therefore
-- existing links) are untouched. Existing items keep visibility NULL (= visible to everyone) and an
-- empty notes_audiences (notes are never published implicitly).
UPDATE "queues" SET "discipline" = 'Program' WHERE "purpose" = 'program' AND "discipline" IS NULL;--> statement-breakpoint
UPDATE "boards" SET "preset" = 'speaker_confidence', "name" = 'Speaker Board', "audience" = 'stage' WHERE "preset" = 'speaker';--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_preset_check" CHECK ("boards"."preset" in ('speaker_confidence', 'stage_manager', 'production', 'backstage', 'room_agenda', 'public_agenda', 'custom'));--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_audience_check" CHECK ("boards"."audience" in ('stage', 'production', 'backstage', 'public', 'broadcast'));
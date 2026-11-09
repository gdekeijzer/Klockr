CREATE TABLE "access_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"show_id" uuid NOT NULL,
	"board_id" uuid,
	"token_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	CONSTRAINT "access_grants_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "access_grants_kind_check" CHECK ("access_grants"."kind" in ('anonymous_owner', 'board_share')),
	CONSTRAINT "access_grants_scope_check" CHECK (("access_grants"."kind" = 'board_share') = ("access_grants"."board_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"show_id" uuid NOT NULL,
	"preset" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "item_timers" (
	"queue_item_id" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" bigint NOT NULL,
	"adjustment_ms" bigint NOT NULL,
	"started_at" timestamp (3) with time zone,
	"paused_at" timestamp (3) with time zone,
	"paused_total_ms" bigint NOT NULL,
	"stopped_at" timestamp (3) with time zone,
	"revision" integer NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "item_timers_mode_check" CHECK ("item_timers"."mode" in ('countdown', 'countup')),
	CONSTRAINT "item_timers_status_check" CHECK ("item_timers"."status" in ('idle', 'running', 'paused', 'stopped'))
);
--> statement-breakpoint
CREATE TABLE "queue_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"show_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"ownership" text NOT NULL,
	"primary_queue_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"last_active_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "shows_ownership_check" CHECK ("shows"."ownership" in ('anonymous'))
);
--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_timers" ADD CONSTRAINT "item_timers_queue_item_id_queue_items_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."queue_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_grants_show_idx" ON "access_grants" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "boards_show_idx" ON "boards" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "queue_items_queue_idx" ON "queue_items" USING btree ("queue_id");--> statement-breakpoint
CREATE INDEX "queues_show_idx" ON "queues" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "shows_expires_at_idx" ON "shows" USING btree ("expires_at");
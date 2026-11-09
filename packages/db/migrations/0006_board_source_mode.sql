ALTER TABLE "boards" ADD COLUMN "source_mode" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
-- Backward compatibility: existing Boards keep their behaviour (explicit selection stays selected).
UPDATE "boards" SET "source_mode" = 'selected' WHERE "follow_primary" = false;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_source_mode_check" CHECK ("boards"."source_mode" in ('primary', 'all', 'selected'));
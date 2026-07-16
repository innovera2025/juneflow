ALTER TABLE "po" ADD COLUMN "no" text;--> statement-breakpoint
ALTER TABLE "po" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "po" ADD COLUMN "approval_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wo" ADD COLUMN "no" text;--> statement-breakpoint
ALTER TABLE "wo" ADD COLUMN "retention_pct" numeric(6, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "wo" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "wo" ADD COLUMN "approval_step" integer DEFAULT 0 NOT NULL;
ALTER TABLE "vendor" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "vendor" ADD COLUMN "addr" text;--> statement-breakpoint
ALTER TABLE "vendor" ADD COLUMN "bank" text;--> statement-breakpoint
ALTER TABLE "vendor" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
ALTER TABLE "attendance" ADD COLUMN "status" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "day_fraction" numeric(3, 2) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "team" text;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "supervisor" text;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "skill" text;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "pay_type" text;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "active" boolean DEFAULT true NOT NULL;
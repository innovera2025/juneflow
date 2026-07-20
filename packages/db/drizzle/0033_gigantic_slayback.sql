ALTER TABLE "work_period" ADD COLUMN "total_qty" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "per_period_qty" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "rate_per_unit" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "unit" text;
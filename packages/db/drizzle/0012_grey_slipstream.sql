CREATE TYPE "public"."cost_center_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."cost_center_type" AS ENUM('Project', 'Overhead', 'Dept');--> statement-breakpoint
ALTER TABLE "doc_numbering" ALTER COLUMN "running" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "doc_numbering" ALTER COLUMN "running" SET DATA TYPE text USING "running"::text;--> statement-breakpoint
ALTER TABLE "doc_numbering" ALTER COLUMN "running" SET DEFAULT '1';--> statement-breakpoint
ALTER TABLE "cost_center" ADD COLUMN "type" "cost_center_type";--> statement-breakpoint
ALTER TABLE "cost_center" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "cost_center" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "cost_center" ADD COLUMN "budget" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "cost_center" ADD COLUMN "currency_code" text DEFAULT 'THB' NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_center" ADD COLUMN "status" "cost_center_status" DEFAULT 'draft' NOT NULL;
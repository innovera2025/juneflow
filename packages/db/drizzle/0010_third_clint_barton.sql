CREATE TYPE "public"."department" AS ENUM('CONS', 'PROC', 'FIN', 'SLS', 'ADM', 'WH');--> statement-breakpoint
CREATE TYPE "public"."model_status" AS ENUM('active', 'draft');--> statement-breakpoint
ALTER TYPE "public"."user_status" ADD VALUE 'invited';--> statement-breakpoint
ALTER TABLE "role" ADD COLUMN "approval_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "role" ADD COLUMN "approval_limit" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "role" ADD COLUMN "currency_code" text DEFAULT 'THB' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "department" "department";--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "bed" integer;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "bath" integer;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "parking" integer;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "price" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "currency_code" text DEFAULT 'THB' NOT NULL;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "status" "model_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_company_code_uq" UNIQUE("company_id","code");
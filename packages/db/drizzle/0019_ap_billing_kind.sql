CREATE TYPE "public"."ap_billing_kind" AS ENUM('deposit', 'progress', 'final');--> statement-breakpoint
ALTER TABLE "ap_billing" ADD COLUMN "kind" "ap_billing_kind" DEFAULT 'progress' NOT NULL;
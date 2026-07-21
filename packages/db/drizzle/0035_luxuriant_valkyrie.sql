CREATE TABLE "ar_invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ar_invoice_id" uuid NOT NULL,
	"description" text,
	"qty" numeric(16, 2) DEFAULT '0' NOT NULL,
	"unit_price" numeric(16, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rv" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ar_invoice" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "ar_invoice" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD COLUMN "salvage" numeric(16, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD COLUMN "acquired_date" date;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD COLUMN "accumulated_depr" numeric(16, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "gl_account" ADD COLUMN "account_type" text;--> statement-breakpoint
ALTER TABLE "rv" ADD COLUMN "no" text;--> statement-breakpoint
ALTER TABLE "rv" ADD COLUMN "receipt_date" date;--> statement-breakpoint
ALTER TABLE "rv" ADD COLUMN "bank" text;--> statement-breakpoint
ALTER TABLE "rv" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "rv" ADD COLUMN "source" text DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "ar_invoice_line" ADD CONSTRAINT "ar_invoice_line_ar_invoice_id_ar_invoice_id_fk" FOREIGN KEY ("ar_invoice_id") REFERENCES "public"."ar_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ar_invoice_line_invoice_idx" ON "ar_invoice_line" USING btree ("ar_invoice_id");
--> statement-breakpoint
-- B-122 Q1 (F-GL2 · Wei-approved): back-populate account_type from the COA code
-- prefix so pre-existing accounts classify without a reseed (1→asset · 2→liability
-- · 3→equity · 4→revenue · 5→expense). Additive, idempotent (only NULLs).
UPDATE "gl_account" SET "account_type" = CASE left("code", 1)
	WHEN '1' THEN 'asset'
	WHEN '2' THEN 'liability'
	WHEN '3' THEN 'equity'
	WHEN '4' THEN 'revenue'
	WHEN '5' THEN 'expense'
	ELSE "account_type" END
WHERE "account_type" IS NULL;

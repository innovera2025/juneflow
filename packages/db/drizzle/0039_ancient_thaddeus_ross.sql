CREATE TABLE "ap_deposit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"no" text NOT NULL,
	"vendor_id" uuid,
	"po_id" uuid,
	"wo_id" uuid,
	"reason" text,
	"pct" numeric(6, 2),
	"amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"used" numeric(16, 2) DEFAULT '0' NOT NULL,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "jv_source_doc_uq";--> statement-breakpoint
ALTER TABLE "ap_deposit" ADD CONSTRAINT "ap_deposit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_deposit" ADD CONSTRAINT "ap_deposit_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_deposit" ADD CONSTRAINT "ap_deposit_po_id_po_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."po"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_deposit" ADD CONSTRAINT "ap_deposit_wo_id_wo_id_fk" FOREIGN KEY ("wo_id") REFERENCES "public"."wo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ap_deposit_company_idx" ON "ap_deposit" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ap_deposit_vendor_idx" ON "ap_deposit" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "ap_deposit_po_idx" ON "ap_deposit" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "ap_deposit_wo_idx" ON "ap_deposit" USING btree ("wo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jv_source_doc_uq" ON "jv" USING btree ("source_doc") WHERE "jv"."source_doc" ~ '^(pv|rv|gr|payroll|fa|cn|ret|dep):';
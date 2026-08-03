CREATE TABLE "ap_credit_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"no" text NOT NULL,
	"vendor_id" uuid,
	"ref_ap_id" uuid,
	"reason" text,
	"amount" numeric(16, 2) NOT NULL,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"status" text,
	"note_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_debit_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"no" text NOT NULL,
	"vendor_id" uuid,
	"ref_ap_id" uuid,
	"reason" text,
	"amount" numeric(16, 2) NOT NULL,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"status" text,
	"note_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ap_credit_note" ADD CONSTRAINT "ap_credit_note_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_credit_note" ADD CONSTRAINT "ap_credit_note_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_credit_note" ADD CONSTRAINT "ap_credit_note_ref_ap_id_ap_billing_id_fk" FOREIGN KEY ("ref_ap_id") REFERENCES "public"."ap_billing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_debit_note" ADD CONSTRAINT "ap_debit_note_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_debit_note" ADD CONSTRAINT "ap_debit_note_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_debit_note" ADD CONSTRAINT "ap_debit_note_ref_ap_id_ap_billing_id_fk" FOREIGN KEY ("ref_ap_id") REFERENCES "public"."ap_billing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ap_credit_note_company_idx" ON "ap_credit_note" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ap_debit_note_company_idx" ON "ap_debit_note" USING btree ("company_id");
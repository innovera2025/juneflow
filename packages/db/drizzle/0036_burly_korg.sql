CREATE TABLE "fa_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"jv_id" uuid,
	"memo" text,
	"status" text DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fa_adjustment" ADD CONSTRAINT "fa_adjustment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa_adjustment" ADD CONSTRAINT "fa_adjustment_asset_id_fixed_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa_adjustment" ADD CONSTRAINT "fa_adjustment_jv_id_jv_id_fk" FOREIGN KEY ("jv_id") REFERENCES "public"."jv"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fa_adjustment_company_idx" ON "fa_adjustment" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "fa_adjustment_asset_idx" ON "fa_adjustment" USING btree ("asset_id");
CREATE TABLE "rev_rec_txn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rev_rec_id" uuid,
	"amount" numeric(16, 2) NOT NULL,
	"jv_id" uuid,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wip_transfer_txn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"wip_id" uuid,
	"amount" numeric(16, 2) NOT NULL,
	"jv_id" uuid,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rev_rec_txn" ADD CONSTRAINT "rev_rec_txn_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rev_rec_txn" ADD CONSTRAINT "rev_rec_txn_rev_rec_id_rev_rec_id_fk" FOREIGN KEY ("rev_rec_id") REFERENCES "public"."rev_rec"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rev_rec_txn" ADD CONSTRAINT "rev_rec_txn_jv_id_jv_id_fk" FOREIGN KEY ("jv_id") REFERENCES "public"."jv"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wip_transfer_txn" ADD CONSTRAINT "wip_transfer_txn_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wip_transfer_txn" ADD CONSTRAINT "wip_transfer_txn_wip_id_wip_id_fk" FOREIGN KEY ("wip_id") REFERENCES "public"."wip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wip_transfer_txn" ADD CONSTRAINT "wip_transfer_txn_jv_id_jv_id_fk" FOREIGN KEY ("jv_id") REFERENCES "public"."jv"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rev_rec_txn_company_idx" ON "rev_rec_txn" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "wip_transfer_txn_company_idx" ON "wip_transfer_txn" USING btree ("company_id");
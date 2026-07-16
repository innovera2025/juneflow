CREATE TABLE "gr_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gr_id" uuid NOT NULL,
	"boq_item_id" uuid,
	"name" text NOT NULL,
	"ordered_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"received_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit" text,
	"price" numeric(16, 2) DEFAULT '0' NOT NULL,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gr_item" ADD CONSTRAINT "gr_item_gr_id_gr_id_fk" FOREIGN KEY ("gr_id") REFERENCES "public"."gr"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gr_item" ADD CONSTRAINT "gr_item_boq_item_id_boq_item_id_fk" FOREIGN KEY ("boq_item_id") REFERENCES "public"."boq_item"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "gr" ALTER COLUMN "po_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gr" ADD COLUMN "wo_id" uuid;--> statement-breakpoint
ALTER TABLE "gr" ADD COLUMN "no" text;--> statement-breakpoint
ALTER TABLE "gr" ADD COLUMN "status" text DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE "gr" ADD CONSTRAINT "gr_wo_id_wo_id_fk" FOREIGN KEY ("wo_id") REFERENCES "public"."wo"("id") ON DELETE cascade ON UPDATE no action;
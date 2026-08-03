ALTER TABLE "document" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_by_user_id_user_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
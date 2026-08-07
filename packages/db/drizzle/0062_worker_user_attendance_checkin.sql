ALTER TABLE "attendance" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "checked_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "checkin_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "checkin_lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "checkout_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "checkout_lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_user_uq" ON "worker" USING btree ("user_id") WHERE "worker"."user_id" IS NOT NULL;
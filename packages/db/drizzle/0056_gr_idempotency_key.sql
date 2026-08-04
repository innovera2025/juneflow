ALTER TABLE "gr" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "gr_idempotency_uq" ON "gr" USING btree ("idempotency_key") WHERE "gr"."idempotency_key" IS NOT NULL;
CREATE TABLE "bank_statement_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"line_date" date,
	"description" text,
	"amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"matched" boolean DEFAULT false NOT NULL,
	"pv_id" uuid,
	"cheque_id" uuid,
	"rv_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_statement_id_bank_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_pv_id_pv_id_fk" FOREIGN KEY ("pv_id") REFERENCES "public"."pv"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_cheque_id_cheque_id_fk" FOREIGN KEY ("cheque_id") REFERENCES "public"."cheque"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_rv_id_rv_id_fk" FOREIGN KEY ("rv_id") REFERENCES "public"."rv"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_statement_line_statement_idx" ON "bank_statement_line" USING btree ("statement_id");
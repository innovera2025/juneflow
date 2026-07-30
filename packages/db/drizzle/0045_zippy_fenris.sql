ALTER TABLE "package" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "package" ADD COLUMN "mod_label" text;--> statement-breakpoint
ALTER TABLE "package" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "package" ADD COLUMN "popular" boolean DEFAULT false NOT NULL;
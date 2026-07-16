ALTER TABLE "doc_numbering" ALTER COLUMN "locked" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "doc_numbering" ALTER COLUMN "locked" SET DATA TYPE text USING (CASE WHEN locked THEN 'all' ELSE 'none' END);--> statement-breakpoint
ALTER TABLE "doc_numbering" ALTER COLUMN "locked" SET DEFAULT 'none';
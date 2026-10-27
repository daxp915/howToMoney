ALTER TABLE "transactions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "split_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "dismissed_tips" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_split_parent_id_transactions_id_fk" FOREIGN KEY ("split_parent_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_split_parent" ON "transactions" USING btree ("split_parent_id");--> statement-breakpoint
-- Everything already in the ledger counts as looked at, except the rows the
-- review queue was already holding. Only rows synced from here on arrive
-- unreviewed.
UPDATE "transactions" SET "reviewed_at" = now() WHERE "needs_review" = false;

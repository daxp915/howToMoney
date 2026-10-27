CREATE TABLE "holding_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"holding_key" text NOT NULL,
	"symbol" text,
	"description" text,
	"shares" numeric(20, 6) NOT NULL,
	"market_value" numeric(14, 2) NOT NULL,
	"purchase_price" numeric(16, 6),
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holding_snapshots" ADD CONSTRAINT "holding_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_snapshots" ADD CONSTRAINT "holding_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holding_snapshots_day" ON "holding_snapshots" USING btree ("user_id","account_id","as_of","holding_key");--> statement-breakpoint
CREATE INDEX "holding_snapshots_as_of" ON "holding_snapshots" USING btree ("as_of");--> statement-breakpoint
-- Row-level security, written by hand because Drizzle does not generate it.
-- Same shape as 0010: without this every household reads every other's
-- portfolio, and nothing errors.
ALTER TABLE "holding_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "holding_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "holding_snapshots_tenant_isolation" ON "holding_snapshots";--> statement-breakpoint
CREATE POLICY "holding_snapshots_tenant_isolation" ON "holding_snapshots" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'howtomoney_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "holding_snapshots" TO howtomoney_app;
  END IF;
END $$;

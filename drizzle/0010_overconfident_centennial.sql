CREATE TABLE "account_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"balance" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_balances_day" ON "account_balances" USING btree ("user_id","account_id","as_of");--> statement-breakpoint
CREATE INDEX "account_balances_as_of" ON "account_balances" USING btree ("as_of");--> statement-breakpoint
-- Row-level security is the enforcement layer, not the query code: a new tenant
-- table without a policy is readable by every tenant. Drizzle does not generate
-- these, so they are written by hand, in the same shape as 0008.
ALTER TABLE "account_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_balances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "account_balances_tenant_isolation" ON "account_balances";--> statement-breakpoint
CREATE POLICY "account_balances_tenant_isolation" ON "account_balances" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
-- The app role's default privileges already cover tables created after
-- `db:approle` ran, but a database migrated before the role existed would not
-- be covered. Granting explicitly costs nothing and removes the ordering
-- dependency; guarded because a fresh test database has no such role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'howtomoney_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "account_balances" TO howtomoney_app;
  END IF;
END $$;--> statement-breakpoint
-- Today's balances are already known, so the series starts with a point rather
-- than with nothing. Every day after this is written by the sync.
INSERT INTO "account_balances" ("user_id", "account_id", "as_of", "balance")
  SELECT "user_id", "id", current_date, "balance" FROM "accounts" WHERE "balance" IS NOT NULL
  ON CONFLICT DO NOTHING;

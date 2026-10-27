DO $$ BEGIN
  IF (SELECT count(*) FROM "users") = 0 AND (SELECT count(*) FROM "accounts") > 0 THEN
    RAISE EXCEPTION 'This database has financial rows but no users, so there is nobody to assign them to. Create the first user (npm run db:seed) before migrating, or drop the orphaned rows if this is a scratch database.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_name_unique";--> statement-breakpoint
DROP INDEX "accounts_provider_key";--> statement-breakpoint
DROP INDEX "budgets_category_month";--> statement-breakpoint
DROP INDEX "merchants_key";--> statement-breakpoint
DROP INDEX "provider_credentials_provider";--> statement-breakpoint
DROP INDEX "recurring_key";--> statement-breakpoint
DROP INDEX "transactions_provider_key";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "accounts" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "budgets" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "categories" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "goals" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "import_batches" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "import_batches" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "merchants" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "merchants" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "merchants" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "provider_credentials" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "recurring_series" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "recurring_series" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "recurring_series" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "rules" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "sync_runs" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "sync_runs" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "transactions" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transfer_groups" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "transfer_groups" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "transfer_groups" ALTER COLUMN "user_id" SET DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid;--> statement-breakpoint
ALTER TABLE "transfer_groups" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_groups" ADD CONSTRAINT "transfer_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_key" ON "accounts" USING btree ("user_id","provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_category_month" ON "budgets" USING btree ("user_id","category_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_key" ON "merchants" USING btree ("user_id","normalized_key");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_provider" ON "provider_credentials" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_key" ON "recurring_series" USING btree ("user_id","normalized_key","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_provider_key" ON "transactions" USING btree ("user_id","provider","provider_txn_id");--> statement-breakpoint

-- The account that has been using this database until now is the admin.
UPDATE "users" SET "is_admin" = true WHERE "id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1);--> statement-breakpoint

-- Row-level security: the database itself refuses to hand one account
-- another's rows. Application code still scopes its queries, but a query that
-- forgets returns nothing rather than someone else's money. FORCE makes the
-- policy apply to the table owner too; the superuser used for migrations still
-- bypasses it, which is why the app connects as a separate, non-superuser role.
-- `nullif(..., '')` matters: once set_config() has touched the setting on a
-- pooled connection, it reverts to an empty string rather than NULL when the
-- transaction ends. Casting that to uuid raises instead of matching nothing,
-- which turns an unscoped query into a 500 rather than a clean empty result.
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "accounts_tenant_isolation" ON "accounts";--> statement-breakpoint
CREATE POLICY "accounts_tenant_isolation" ON "accounts" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budgets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "budgets_tenant_isolation" ON "budgets";--> statement-breakpoint
CREATE POLICY "budgets_tenant_isolation" ON "budgets" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "categories_tenant_isolation" ON "categories";--> statement-breakpoint
CREATE POLICY "categories_tenant_isolation" ON "categories" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "goals_tenant_isolation" ON "goals";--> statement-breakpoint
CREATE POLICY "goals_tenant_isolation" ON "goals" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "import_batches_tenant_isolation" ON "import_batches";--> statement-breakpoint
CREATE POLICY "import_batches_tenant_isolation" ON "import_batches" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "merchants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merchants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "merchants_tenant_isolation" ON "merchants";--> statement-breakpoint
CREATE POLICY "merchants_tenant_isolation" ON "merchants" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "provider_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "provider_credentials_tenant_isolation" ON "provider_credentials";--> statement-breakpoint
CREATE POLICY "provider_credentials_tenant_isolation" ON "provider_credentials" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "recurring_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recurring_series" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "recurring_series_tenant_isolation" ON "recurring_series";--> statement-breakpoint
CREATE POLICY "recurring_series_tenant_isolation" ON "recurring_series" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "rules_tenant_isolation" ON "rules";--> statement-breakpoint
CREATE POLICY "rules_tenant_isolation" ON "rules" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "sync_runs_tenant_isolation" ON "sync_runs";--> statement-breakpoint
CREATE POLICY "sync_runs_tenant_isolation" ON "sync_runs" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "transactions_tenant_isolation" ON "transactions";--> statement-breakpoint
CREATE POLICY "transactions_tenant_isolation" ON "transactions" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "transfer_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transfer_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "transfer_groups_tenant_isolation" ON "transfer_groups";--> statement-breakpoint
CREATE POLICY "transfer_groups_tenant_isolation" ON "transfer_groups" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);

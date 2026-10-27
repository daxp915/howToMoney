CREATE TYPE "public"."account_type" AS ENUM('depository', 'credit', 'loan', 'investment', 'other');--> statement-breakpoint
CREATE TYPE "public"."category_source" AS ENUM('none', 'rule', 'memory', 'ai', 'user');--> statement-breakpoint
CREATE TYPE "public"."transfer_kind" AS ENUM('cc_payment', 'internal', 'manual');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'simplefin' NOT NULL,
	"provider_account_id" text NOT NULL,
	"org_name" text,
	"name" text NOT NULL,
	"nickname" text,
	"type" "account_type" DEFAULT 'depository' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"balance" numeric(14, 2),
	"available_balance" numeric(14, 2),
	"balance_date" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"group" text DEFAULT 'expense' NOT NULL,
	"icon" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_key" text NOT NULL,
	"display_name" text NOT NULL,
	"category_id" uuid,
	"source" "category_source" DEFAULT 'ai' NOT NULL,
	"confidence" real,
	"pinned_by_user" boolean DEFAULT false NOT NULL,
	"seen_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"match_field" text DEFAULT 'description' NOT NULL,
	"match_type" text DEFAULT 'contains' NOT NULL,
	"match_value" text NOT NULL,
	"account_id" uuid,
	"amount_min" numeric(14, 2),
	"amount_max" numeric(14, 2),
	"set_category_id" uuid,
	"set_merchant_name" text,
	"set_is_transfer" boolean,
	"set_excluded" boolean,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"accounts_synced" integer DEFAULT 0 NOT NULL,
	"txns_inserted" integer DEFAULT 0 NOT NULL,
	"txns_updated" integer DEFAULT 0 NOT NULL,
	"transfers_matched" integer DEFAULT 0 NOT NULL,
	"ai_calls" integer DEFAULT 0 NOT NULL,
	"ai_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text DEFAULT 'simplefin' NOT NULL,
	"provider_txn_id" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"transacted_at" timestamp with time zone,
	"amount" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	"payee" text,
	"memo" text,
	"normalized_key" text NOT NULL,
	"merchant_name" text,
	"merchant_id" uuid,
	"category_id" uuid,
	"category_source" "category_source" DEFAULT 'none' NOT NULL,
	"category_confidence" real,
	"transfer_group_id" uuid,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"pending" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"note" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "transfer_kind" DEFAULT 'internal' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"matched_by" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_set_category_id_categories_id_fk" FOREIGN KEY ("set_category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_group_id_transfer_groups_id_fk" FOREIGN KEY ("transfer_group_id") REFERENCES "public"."transfer_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_key" ON "accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_key" ON "merchants" USING btree ("normalized_key");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_provider_key" ON "transactions" USING btree ("provider","provider_txn_id");--> statement-breakpoint
CREATE INDEX "transactions_account_posted" ON "transactions" USING btree ("account_id","posted_at");--> statement-breakpoint
CREATE INDEX "transactions_posted" ON "transactions" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "transactions_normalized" ON "transactions" USING btree ("normalized_key");--> statement-breakpoint
CREATE INDEX "transactions_review" ON "transactions" USING btree ("needs_review");--> statement-breakpoint
CREATE INDEX "transactions_transfer_group" ON "transactions" USING btree ("transfer_group_id");
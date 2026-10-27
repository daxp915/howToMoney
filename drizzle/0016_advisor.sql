CREATE TABLE "advisor_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advisor_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"question" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"answer" jsonb,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reopened_at" timestamp with time zone,
	"error" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "dismissed_findings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "advisor_floor" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "advisor_conversations" ADD CONSTRAINT "advisor_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_turns" ADD CONSTRAINT "advisor_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_turns" ADD CONSTRAINT "advisor_turns_conversation_id_advisor_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."advisor_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advisor_conversations_updated" ON "advisor_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "advisor_turns_conversation" ON "advisor_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
-- Row-level security, written by hand because Drizzle does not generate it.
-- Same shape as 0010: without it every household reads every other's
-- questions and answers, and nothing errors.
ALTER TABLE "advisor_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "advisor_conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "advisor_conversations_tenant_isolation" ON "advisor_conversations";--> statement-breakpoint
CREATE POLICY "advisor_conversations_tenant_isolation" ON "advisor_conversations" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "advisor_turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "advisor_turns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "advisor_turns_tenant_isolation" ON "advisor_turns";--> statement-breakpoint
CREATE POLICY "advisor_turns_tenant_isolation" ON "advisor_turns" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'howtomoney_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "advisor_conversations" TO howtomoney_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "advisor_turns" TO howtomoney_app;
  END IF;
END $$;

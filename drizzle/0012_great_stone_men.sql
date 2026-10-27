CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid NOT NULL,
	"hidden_tabs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dashboard_cards" jsonb,
	"hidden_cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tour_seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A tenant table, so it needs the policy: without it, one household's display
-- preferences would be readable by every other.
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "user_preferences_tenant_isolation" ON "user_preferences";--> statement-breakpoint
CREATE POLICY "user_preferences_tenant_isolation" ON "user_preferences" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'howtomoney_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "user_preferences" TO howtomoney_app;
  END IF;
END $$;

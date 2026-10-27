CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"blocked_until" timestamp with time zone,
	"last_seen" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid DEFAULT (nullif(current_setting('app.user_id', true), ''))::uuid NOT NULL,
	"origin" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"error_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_jobs_one_open" ON "sync_jobs" USING btree ("user_id") WHERE "sync_jobs"."finished_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sync_jobs_user_requested" ON "sync_jobs" USING btree ("user_id","requested_at");--> statement-breakpoint
-- `auth_throttle` is not a tenant table: it is written before anyone is signed
-- in and holds addresses and counts, never money. No policy, but the app role
-- writes it on every failed sign-in.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'howtomoney_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_throttle" TO howtomoney_app;
  END IF;
END $$;--> statement-breakpoint
-- `sync_jobs` is a tenant table. Row-level security by hand, same shape as 0010.
ALTER TABLE "sync_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "sync_jobs_tenant_isolation" ON "sync_jobs";--> statement-breakpoint
CREATE POLICY "sync_jobs_tenant_isolation" ON "sync_jobs" USING ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid) WITH CHECK ("user_id" = (nullif(current_setting('app.user_id', true), ''))::uuid);--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'howtomoney_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_jobs" TO howtomoney_app;
  END IF;
END $$;

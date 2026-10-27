CREATE TABLE "user_active_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "user_active_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pmf_answer" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pmf_answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_active_days" ADD CONSTRAINT "user_active_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Not a tenant table (like sessions: written before any user scope exists,
-- holds dates only, read through systemDb by the admin page), so no policy --
-- but the app role still needs to write it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'howtomoney_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "user_active_days" TO howtomoney_app;
  END IF;
END $$;--> statement-breakpoint
-- Start the record with what is already known: each session's last day seen.
INSERT INTO "user_active_days" ("user_id", "day")
  SELECT DISTINCT "user_id", ("last_seen_at" AT TIME ZONE 'UTC')::date FROM "sessions" WHERE "last_seen_at" IS NOT NULL
  ON CONFLICT DO NOTHING;

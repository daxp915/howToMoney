-- Self-service password change.
--
-- `must_change_password` marks a password somebody other than the account
-- holder chose. Existing rows default to false: everyone who exists today set
-- their own.
--
-- drizzle-kit also re-emitted twelve `ALTER COLUMN "user_id" SET DEFAULT`
-- lines identical to the ones 0008 already applied; they were dropped rather
-- than replayed.
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;

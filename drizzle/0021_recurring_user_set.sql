-- A series the person made: "Mark as recurring" or a bill added by hand.
-- Detection never rewrites it. recurring_series already has its RLS policy.
ALTER TABLE "recurring_series" ADD COLUMN "user_set" boolean DEFAULT false NOT NULL;
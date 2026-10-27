ALTER TABLE "merchants" ALTER COLUMN "is_subscription" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "merchants" ALTER COLUMN "is_subscription" DROP NOT NULL;
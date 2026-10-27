-- A default budget (month null) was never unique: the old index treated each
-- null month as distinct, so setBudget()'s ON CONFLICT never matched and every
-- edit added a row. Keep the latest edit per category and month, then make
-- nulls collide.
DELETE FROM "budgets" b
USING "budgets" newer
WHERE b."user_id" = newer."user_id"
  AND b."category_id" = newer."category_id"
  AND b."month" IS NOT DISTINCT FROM newer."month"
  AND (b."updated_at", b."id") < (newer."updated_at", newer."id");--> statement-breakpoint
DROP INDEX "budgets_category_month";--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_month" UNIQUE NULLS NOT DISTINCT("user_id","category_id","month");

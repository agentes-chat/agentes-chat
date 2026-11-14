ALTER TABLE "machines" ADD COLUMN "ai_accounts_shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Every member added plans on computers nobody connected; they stay shared, and a server's own computer starts shared.
UPDATE "machines" SET "ai_accounts_shared" = true WHERE "kind" = 'host' OR "paired_by_user_id" IS NULL;

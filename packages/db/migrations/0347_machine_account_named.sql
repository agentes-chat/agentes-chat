ALTER TABLE "machine_accounts" ADD COLUMN "named" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- An account its owner renamed back to a default-looking name ("Claude", "Gemini"): their own audited rename says so.
-- A custom label needs nothing here: `accountView` already reads it as named.
UPDATE "machine_accounts" AS ma
SET "named" = true
WHERE ma."named" = false
  AND ma."created_by" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "audit_log" al
    WHERE al."org_id" = ma."org_id"
      AND al."actor_type" = 'person'
      AND al."actor_id" = ma."created_by"
      AND al."action" = 'account.renamed'
      AND al."target_type" = 'machine_account'
      AND al."target_id" = ma."id"::text
  );

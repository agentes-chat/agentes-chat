ALTER TABLE "machine_accounts" ADD COLUMN "named" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Backfill existing rows whose owner already gave them a custom name (not matching isDefaultAccountLabel),
-- or that have an owner-authored account.renamed audit entry.
UPDATE "machine_accounts" AS ma
SET "named" = true
FROM (
  SELECT
    "org_id",
    "id",
    CASE
      WHEN "provider" = 'zai' THEN 'GLM Coding'
      WHEN "provider" = 'kimi' THEN 'Kimi Code'
      WHEN "provider" = 'minimax' THEN 'MiniMax'
      WHEN "provider" = 'opencode' THEN 'OpenCode Go'
      WHEN "kind" = 'codex' THEN 'ChatGPT'
      WHEN "kind" = 'cursor' THEN 'Cursor'
      WHEN "kind" = 'opencode' THEN 'OpenCode'
      WHEN "kind" = 'grok' THEN 'Grok'
      WHEN "kind" = 'antigravity' THEN 'Gemini'
      ELSE 'Claude'
    END AS base
  FROM "machine_accounts"
) AS b
WHERE ma."org_id" = b."org_id"
  AND ma."id" = b."id"
  AND ma."named" = false
  AND (
    NOT (
      left(ma."label", length(b.base)) = b.base
      AND lower(substr(ma."label", length(b.base) + 1)) ~ '^(?:[[:space:]]+(?:code|pro\+?|max|ultra|team|teams|enterprise|plus|business|free)(?:[[:space:]]+[0-9]+)?|[[:space:]]*[0-9]+)?$'
    )
    OR (
      ma."created_by" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "audit_log" al
        WHERE al."org_id" = ma."org_id"
          AND al."actor_type" = 'person'
          AND al."actor_id" = ma."created_by"
          AND al."action" = 'account.renamed'
          AND al."target_type" = 'machine_account'
          AND al."target_id" = ma."id"::text
      )
    )
  );

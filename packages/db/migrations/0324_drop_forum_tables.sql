-- The forum's tables, empty since 0216 removed the forum and its data (ADR 0022).
-- deploy-safe: nothing reads the forum's tables since the release before this one (its workspace reset stopped listing them)
DROP TABLE "forum_participants" CASCADE;--> statement-breakpoint
-- deploy-safe: as above
DROP TABLE "forum_topics" CASCADE;--> statement-breakpoint
-- deploy-safe: as above
DROP TABLE "forum_turns" CASCADE;

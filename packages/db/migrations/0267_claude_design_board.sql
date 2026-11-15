-- Historical pointer: deleting a card must not delete the native job or recreate a card on replay.
ALTER TABLE "claude_design_jobs" ADD COLUMN "issue_id" uuid;
--> statement-breakpoint
CREATE INDEX "claude_design_jobs_org_issue" ON "claude_design_jobs" ("org_id", "issue_id");

-- A task can wait on another ("Depois de"): when that one is done, its agent starts on its own.
ALTER TABLE "issues" ADD COLUMN "after_issue_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "after_by" text;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_after_issue_id_issues_id_fk" FOREIGN KEY ("after_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issues_after_issue_id_index" ON "issues" USING btree ("after_issue_id");
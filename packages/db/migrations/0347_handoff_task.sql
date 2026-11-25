ALTER TABLE "agent_consultations" ADD COLUMN "issue_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_consultations" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "agent_consultations" ADD CONSTRAINT "agent_consultations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
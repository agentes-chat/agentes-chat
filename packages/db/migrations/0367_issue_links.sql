CREATE TYPE "public"."issue_link_type" AS ENUM('blocks', 'relates_to', 'duplicates', 'clones');--> statement-breakpoint
CREATE TABLE "issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"from_issue_id" uuid NOT NULL,
	"to_issue_id" uuid NOT NULL,
	"type" "issue_link_type" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_links_fromIssueId_toIssueId_type_unique" UNIQUE("from_issue_id","to_issue_id","type")
);
--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_from_issue_id_issues_id_fk" FOREIGN KEY ("from_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_to_issue_id_issues_id_fk" FOREIGN KEY ("to_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_links_to_issue_id_index" ON "issue_links" USING btree ("to_issue_id");--> statement-breakpoint
CREATE INDEX "issue_links_org_id_index" ON "issue_links" USING btree ("org_id");
CREATE TABLE "issue_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"dependency_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_dependencies_issueId_dependencyId_unique" UNIQUE("issue_id","dependency_id")
);
--> statement-breakpoint
CREATE TABLE "issue_dependency_readiness" (
	"issue_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"generation" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"consumed_at" timestamp with time zone,
	"run_id" uuid,
	"inputs_changed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_dependency_id_issues_id_fk" FOREIGN KEY ("dependency_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependency_readiness" ADD CONSTRAINT "issue_dependency_readiness_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependency_readiness" ADD CONSTRAINT "issue_dependency_readiness_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_dependencies_org_id_dependency_id_index" ON "issue_dependencies" USING btree ("org_id","dependency_id");--> statement-breakpoint
CREATE INDEX "issue_dependency_readiness_org_id_ready_index" ON "issue_dependency_readiness" USING btree ("org_id","ready");
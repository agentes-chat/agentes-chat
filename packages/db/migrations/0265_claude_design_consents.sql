CREATE TABLE "claude_design_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"grant_revision" integer NOT NULL,
	"sequence" integer NOT NULL,
	"tool_use_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"remote_id" text NOT NULL,
	"remote_url" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"reauthorized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claude_design_consents_orgId_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "claude_design_consents_orgId_taskId_toolUseId_unique" UNIQUE("org_id","task_id","tool_use_id"),
	CONSTRAINT "claude_design_consent_status" CHECK ("claude_design_consents"."status" in ('pending','approved','denied','consumed','expired','canceled'))
);
--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD COLUMN "last_authorization" jsonb;--> statement-breakpoint
ALTER TABLE "claude_design_consents" ADD CONSTRAINT "claude_design_consents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_consents" ADD CONSTRAINT "claude_design_consents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_consents" ADD CONSTRAINT "claude_design_consents_org_id_job_id_claude_design_jobs_org_id_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."claude_design_jobs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claude_design_consents_org_id_job_id_index" ON "claude_design_consents" USING btree ("org_id","job_id");
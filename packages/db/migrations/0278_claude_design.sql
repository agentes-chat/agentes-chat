CREATE TABLE "claude_design_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"title" text NOT NULL,
	"remote_id" text,
	"remote_url" text,
	"remote_version" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_job_id" uuid,
	"artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unavailable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claude_design_artifacts_orgId_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "claude_design_revision" CHECK ("claude_design_artifacts"."revision" >= 0)
);
--> statement-breakpoint
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
CREATE TABLE "claude_design_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claude_design_grants_orgId_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "claude_design_grants_orgId_agentId_unique" UNIQUE("org_id","agent_id"),
	CONSTRAINT "claude_design_grant_revision" CHECK ("claude_design_grants"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "claude_design_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"thread_root_id" uuid NOT NULL,
	"trigger_message_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"tool_use_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"grant_revision" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"action" text NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"source_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_manifest" jsonb,
	"design_id" uuid NOT NULL,
	"expected_revision" integer NOT NULL,
	"task_id" uuid NOT NULL,
	"recovery_task_id" uuid,
	"recovery_candidate_url" text,
	"recovery_grant_revision" integer,
	"recovery_effect_sequence" integer DEFAULT 0 NOT NULL,
	"source_task_id" uuid,
	"issue_id" uuid,
	"file_imports" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reference_artifact_id" uuid,
	"state" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"effect_sequence" integer DEFAULT 0 NOT NULL,
	"last_authorization" jsonb,
	"cancel_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claude_design_jobs_taskId_unique" UNIQUE("task_id"),
	CONSTRAINT "claude_design_jobs_recoveryTaskId_unique" UNIQUE("recovery_task_id"),
	CONSTRAINT "claude_design_jobs_orgId_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "claude_design_jobs_orgId_runId_toolUseId_unique" UNIQUE("org_id","run_id","tool_use_id"),
	CONSTRAINT "claude_design_job_state" CHECK ("claude_design_jobs"."state" in ('queued','running','published','succeeded','failed','canceled','unknown')),
	CONSTRAINT "claude_design_job_action" CHECK ("claude_design_jobs"."action" in ('create','update'))
);
--> statement-breakpoint
ALTER TABLE "artifact_uploads" ADD COLUMN "expected_sha256" text;--> statement-breakpoint
ALTER TABLE "claude_design_artifacts" ADD CONSTRAINT "claude_design_artifacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_artifacts" ADD CONSTRAINT "claude_design_artifacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_artifacts" ADD CONSTRAINT "claude_design_artifacts_org_id_agent_id_agents_org_id_id_fk" FOREIGN KEY ("org_id","agent_id") REFERENCES "public"."agents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_artifacts" ADD CONSTRAINT "claude_design_artifacts_org_id_channel_id_channels_org_id_id_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."channels"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_artifacts" ADD CONSTRAINT "claude_design_artifacts_org_id_machine_id_machines_org_id_id_fk" FOREIGN KEY ("org_id","machine_id") REFERENCES "public"."machines"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_consents" ADD CONSTRAINT "claude_design_consents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_consents" ADD CONSTRAINT "claude_design_consents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_consents" ADD CONSTRAINT "claude_design_consents_org_id_job_id_claude_design_jobs_org_id_id_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."claude_design_jobs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_grants" ADD CONSTRAINT "claude_design_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_grants" ADD CONSTRAINT "claude_design_grants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_grants" ADD CONSTRAINT "claude_design_grants_org_id_agent_id_agents_org_id_id_fk" FOREIGN KEY ("org_id","agent_id") REFERENCES "public"."agents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_grants" ADD CONSTRAINT "claude_design_grants_org_id_machine_id_machines_org_id_id_fk" FOREIGN KEY ("org_id","machine_id") REFERENCES "public"."machines"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_org_id_grant_id_claude_design_grants_org_id_id_fk" FOREIGN KEY ("org_id","grant_id") REFERENCES "public"."claude_design_grants"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_org_id_design_id_claude_design_artifacts_org_id_id_fk" FOREIGN KEY ("org_id","design_id") REFERENCES "public"."claude_design_artifacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_org_id_agent_id_agents_org_id_id_fk" FOREIGN KEY ("org_id","agent_id") REFERENCES "public"."agents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_org_id_channel_id_channels_org_id_id_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."channels"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_org_id_machine_id_machines_org_id_id_fk" FOREIGN KEY ("org_id","machine_id") REFERENCES "public"."machines"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claude_design_remote" ON "claude_design_artifacts" USING btree ("org_id","account_id","remote_id") WHERE "claude_design_artifacts"."remote_id" is not null;--> statement-breakpoint
CREATE INDEX "claude_design_consents_org_id_job_id_index" ON "claude_design_consents" USING btree ("org_id","job_id");--> statement-breakpoint
CREATE INDEX "claude_design_jobs_org_issue" ON "claude_design_jobs" USING btree ("org_id","issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claude_design_active_job" ON "claude_design_jobs" USING btree ("org_id","design_id") WHERE "claude_design_jobs"."state" in ('queued','running','published','unknown');--> statement-breakpoint
CREATE INDEX "claude_design_jobs_org_id_state_index" ON "claude_design_jobs" USING btree ("org_id","state");
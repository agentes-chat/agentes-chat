-- deploy-safe: retains every column; replaces this FK below with cascade for explicit owner/audience deletion.
ALTER TABLE "claude_design_artifacts" DROP CONSTRAINT "claude_design_artifacts_owner_user_id_users_id_fk";
--> statement-breakpoint
-- deploy-safe: retains every column; replaces this FK below with cascade for explicit owner/audience deletion.
ALTER TABLE "claude_design_artifacts" DROP CONSTRAINT "claude_design_artifacts_org_id_agent_id_agents_org_id_id_fk";
--> statement-breakpoint
-- deploy-safe: retains every column; replaces this FK below with cascade for explicit owner/audience deletion.
ALTER TABLE "claude_design_artifacts" DROP CONSTRAINT "claude_design_artifacts_org_id_channel_id_channels_org_id_id_fk";
--> statement-breakpoint
-- deploy-safe: retains every column and row; only removes the transient run FK to preserve uncertain jobs.
ALTER TABLE "claude_design_jobs" DROP CONSTRAINT "claude_design_jobs_run_id_agent_runs_id_fk";
--> statement-breakpoint
-- deploy-safe: retains every column; replaces this FK below with cascade for explicit owner/audience deletion.
ALTER TABLE "claude_design_jobs" DROP CONSTRAINT "claude_design_jobs_owner_user_id_users_id_fk";
--> statement-breakpoint
-- deploy-safe: retains every column; replaces this FK below with cascade for explicit owner/audience deletion.
ALTER TABLE "claude_design_jobs" DROP CONSTRAINT "claude_design_jobs_org_id_grant_id_claude_design_grants_org_id_id_fk";
--> statement-breakpoint
-- deploy-safe: retains every column; replaces this FK below with cascade for explicit owner/audience deletion.
ALTER TABLE "claude_design_jobs" DROP CONSTRAINT "claude_design_jobs_org_id_design_id_claude_design_artifacts_org_id_id_fk";
--> statement-breakpoint
-- deploy-safe: retains every column; replaces this FK below with cascade for explicit owner/audience deletion.
ALTER TABLE "claude_design_jobs" DROP CONSTRAINT "claude_design_jobs_org_id_agent_id_agents_org_id_id_fk";
--> statement-breakpoint
-- deploy-safe: retains every column; replaces this FK below with cascade for explicit owner/audience deletion.
ALTER TABLE "claude_design_jobs" DROP CONSTRAINT "claude_design_jobs_org_id_channel_id_channels_org_id_id_fk";
--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD COLUMN "recovery_candidate_url" text;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD COLUMN "recovery_grant_revision" integer;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD COLUMN "recovery_effect_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD COLUMN "source_task_id" uuid;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD COLUMN "file_imports" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD COLUMN "reference_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "artifact_uploads" ADD COLUMN "expected_sha256" text;--> statement-breakpoint
ALTER TABLE "claude_design_artifacts" ADD CONSTRAINT "claude_design_artifacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_artifacts" ADD CONSTRAINT "claude_design_artifacts_org_id_agent_id_agents_org_id_id_fk" FOREIGN KEY ("org_id","agent_id") REFERENCES "public"."agents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_artifacts" ADD CONSTRAINT "claude_design_artifacts_org_id_channel_id_channels_org_id_id_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."channels"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_org_id_grant_id_claude_design_grants_org_id_id_fk" FOREIGN KEY ("org_id","grant_id") REFERENCES "public"."claude_design_grants"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_org_id_design_id_claude_design_artifacts_org_id_id_fk" FOREIGN KEY ("org_id","design_id") REFERENCES "public"."claude_design_artifacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_org_id_agent_id_agents_org_id_id_fk" FOREIGN KEY ("org_id","agent_id") REFERENCES "public"."agents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_design_jobs" ADD CONSTRAINT "claude_design_jobs_org_id_channel_id_channels_org_id_id_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."channels"("org_id","id") ON DELETE cascade ON UPDATE no action;

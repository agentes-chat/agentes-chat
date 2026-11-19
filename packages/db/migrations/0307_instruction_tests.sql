CREATE TABLE "instruction_test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"case_id" text NOT NULL,
	"situation" text NOT NULL,
	"expectation" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruction_test_cases_orgId_agentId_caseId_unique" UNIQUE("org_id","agent_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "instruction_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"model" text NOT NULL,
	"executor" text DEFAULT 'model' NOT NULL,
	"base_instructions" text NOT NULL,
	"candidate_instructions" text NOT NULL,
	"cases" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_nano_usd" bigint DEFAULT 0 NOT NULL,
	"claim" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "instruction_test_cases" ADD CONSTRAINT "instruction_test_cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_test_cases" ADD CONSTRAINT "instruction_test_cases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_test_cases" ADD CONSTRAINT "instruction_test_cases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_test_runs" ADD CONSTRAINT "instruction_test_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_test_runs" ADD CONSTRAINT "instruction_test_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_test_runs" ADD CONSTRAINT "instruction_test_runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instruction_test_cases_org_id_agent_id_index" ON "instruction_test_cases" USING btree ("org_id","agent_id");--> statement-breakpoint
CREATE INDEX "instruction_test_runs_org_id_agent_id_created_at_index" ON "instruction_test_runs" USING btree ("org_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "instruction_test_runs_org_id_status_index" ON "instruction_test_runs" USING btree ("org_id","status");
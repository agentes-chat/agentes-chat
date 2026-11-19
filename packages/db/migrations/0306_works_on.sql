ALTER TABLE "agents" ADD COLUMN "works_on_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "machine_holds" ADD COLUMN "runner_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "machine_tasks" ADD COLUMN "runner_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_works_on_agent_id_agents_org_id_id_fk" FOREIGN KEY ("org_id","works_on_agent_id") REFERENCES "public"."agents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_works_on_idx" ON "agents" USING btree ("works_on_agent_id");
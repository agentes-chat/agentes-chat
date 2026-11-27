CREATE TABLE "first_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"area" text,
	"task" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fired_at" timestamp with time zone,
	"run_id" uuid,
	CONSTRAINT "first_deliveries_person" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "first_deliveries" ADD CONSTRAINT "first_deliveries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_deliveries" ADD CONSTRAINT "first_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_deliveries" ADD CONSTRAINT "first_deliveries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "first_deliveries_pending_idx" ON "first_deliveries" USING btree ("created_at") WHERE "first_deliveries"."fired_at" is null;